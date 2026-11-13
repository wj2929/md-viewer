import { writeTextToSystemClipboard } from '../clipboardManager'
import { BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import * as path from 'node:path'
import { isWorkspaceRelativePath, type WorkspaceBrowserAction, type WorkspaceBrowserInput, type WorkspaceBrowserResult, type WorkspaceBrowserSelection, type WorkspaceBrowserTarget } from '../../shared/directoryBrowser'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import { activateFolderForWorkspace, openFolderInNewWindow } from '../folderActivation'
import { canOpenAttachment } from '../localAttachmentPolicy'
import { validateNotProtected } from '../security'
import type { IPCContext } from './context'
import { broadcastDocumentMarksChanged } from './fileHandlers'
import { executeWorkspaceLinkMove } from './linkRewriteHandlers'
import { getSenderWorkspaceForOperation, validateWorkspaceOperationPath } from './senderSecurity'

const trashLabel = process.platform === 'win32' ? '回收站' : '废纸篓'

type Target = {
  public: WorkspaceBrowserTarget
  senderId: number
  operation: WorkspaceOperationContext
  root: string
  rootIdentity: Stats
  identity: Stats
  expiresAt: number
}

function sameIdentity(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
    && (a.isDirectory() || (a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs))
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 255
    || /[\\/\u0000-\u001f<>:"|?*]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..'
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('请输入有效名称，不能包含路径或保留字符')
}

export function registerDirectoryBrowserActions(ctx: IPCContext): void {
  const targets = new Map<number, Target>()
  const busy = new Set<number>()
  const assertActive = (event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || ctx.windowManager.getActiveWorkspaceId(window.id) !== workspace.id) throw new Error('当前工作区已变化')
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    return { workspace, window }
  }
  const resolveTarget = async (event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, relativePath: unknown): Promise<Target> => {
    if (!isWorkspaceRelativePath(relativePath)) throw new Error('无效的工作区相对路径')
    const { workspace } = assertActive(event, operation)
    const root = await realpath(workspace.primaryRoot!)
    const rootIdentity = await lstat(root)
    let current = root
    for (const part of relativePath ? relativePath.split('/') : []) {
      current = path.join(current, part)
      if ((await lstat(current)).isSymbolicLink()) throw new Error('不操作符号链接')
    }
    const canonical = await validateWorkspaceOperationPath(ctx, event, operation, current)
    const identity = await lstat(canonical)
    if (!identity.isDirectory() && !identity.isFile()) throw new Error('不支持此类文件操作')
    validateNotProtected(identity.isDirectory() ? path.join(canonical, '_') : canonical)
    if (canonical !== current) throw new Error('目标已变化，请刷新重试')
    const latest = assertActive(event, operation).workspace
    if (latest.primaryRoot !== workspace.primaryRoot || await realpath(latest.primaryRoot!) !== root) throw new Error('当前工作区已变化')
    if (assertActive(event, operation).workspace.primaryRoot !== workspace.primaryRoot) throw new Error('当前工作区已变化')
    return { senderId: event.sender.id, operation: { ...operation }, root, rootIdentity, identity, expiresAt: Date.now() + 5 * 60_000,
      public: { id: randomUUID(), path: canonical, name: path.basename(canonical), relativePath, kind: identity.isDirectory() ? 'directory' : 'file' } }
  }
  const requireTarget = async (event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, id: unknown): Promise<Target> => {
    const target = targets.get(event.sender.id)
    if (!target || target.public.id !== id || target.expiresAt < Date.now()
      || target.operation.workspaceId !== operation?.workspaceId || target.operation.lifecycleEpoch !== operation?.lifecycleEpoch) throw new Error('操作目标已失效，请重新打开右键菜单')
    const current = await resolveTarget(event, operation, target.public.relativePath)
    if (current.root !== target.root || !sameIdentity(current.rootIdentity, target.rootIdentity)
      || current.public.path !== target.public.path || !sameIdentity(current.identity, target.identity)) throw new Error('目标已变化，请刷新重试')
    return target
  }

  ipcMain.handle('browser:showContextMenu', async (event, operation: WorkspaceOperationContext, relativePath: unknown): Promise<WorkspaceBrowserSelection | null> => {
    if (busy.has(event.sender.id)) throw new Error('文件操作正在执行')
    targets.delete(event.sender.id)
    const target = await resolveTarget(event, operation, relativePath)
    targets.set(event.sender.id, target)
    const directory = target.public.kind === 'directory'
    const root = target.public.relativePath === ''
    return new Promise((resolve, reject) => {
      let selected: WorkspaceBrowserAction | null = null
      const item = (label: string, action: WorkspaceBrowserAction): MenuItemConstructorOptions => ({ label, click: () => { selected = action } })
      const separator: MenuItemConstructorOptions = { type: 'separator' }
      const template: MenuItemConstructorOptions[] = directory ? [
        item('新建文件…', 'create-file'), item('新建文件夹…', 'create-directory'), separator,
        ...(!root ? [item('在当前窗口打开', 'open-folder')] : []), item('在新窗口打开', 'new-window'),
      ] : [item(/\.(md|markdown|mdown|mkd|mkdn|excalidraw)$/i.test(target.public.name) ? '在标签页打开' : '临时预览', 'open'),
        ...(canOpenAttachment(path.extname(target.public.name).toLowerCase()) ? [item('用系统默认应用打开…', 'system-open')] : [])]
      template.push(separator, item(process.platform === 'darwin' ? '在 Finder 中显示' : '在文件管理器中显示', 'reveal'))
      if (!root) template.push(item('重命名…', 'rename'), item(`移到${trashLabel}…`, 'trash'))
      template.push(separator, item('复制完整路径', 'copy-path'), item('复制相对路径', 'copy-relative-path'))
      if (directory) template.push(separator, item('刷新', 'refresh'))
      Menu.buildFromTemplate(template).popup({ window: assertActive(event, operation).window, callback: () => {
        if (!selected) { if (targets.get(event.sender.id) === target) targets.delete(event.sender.id); resolve(null); return }
        void requireTarget(event, operation, target.public.id).then(() => resolve({ action: selected!, target: target.public }), reject)
      } })
    })
  })

  ipcMain.handle('browser:performAction', async (event, operation: WorkspaceOperationContext, id: unknown, action: WorkspaceBrowserAction, input?: WorkspaceBrowserInput): Promise<WorkspaceBrowserResult> => {
    if (busy.has(event.sender.id)) throw new Error('文件操作正在执行')
    busy.add(event.sender.id)
    try {
      const target = await requireTarget(event, operation, id)
      const { public: entry } = target
      const directory = entry.kind === 'directory'
      const assertCurrent = async () => { await requireTarget(event, operation, id) }
      const { window } = assertActive(event, operation)
      if (action === 'validate') { if (input?.name !== undefined) validateName(input.name); return {} }
      if (action === 'open' || action === 'refresh' || action === 'system-open') return {}
      if (action === 'copy-path' || action === 'copy-relative-path') {
        const copied = await writeTextToSystemClipboard(action === 'copy-path' ? entry.path : entry.relativePath || '.')
        if (!copied) throw new Error('无法写入系统剪贴板')
        return {}
      }
      if (action === 'reveal') { shell.showItemInFolder(entry.path); return {} }
      if (action === 'open-folder' || action === 'new-window') {
        if (!directory) throw new Error('目标不是文件夹')
        if (action === 'new-window') { openFolderInNewWindow(ctx, entry.path, assertCurrent); return {} }
        if (!entry.relativePath) throw new Error('已在当前工作区')
        return { activation: await activateFolderForWorkspace(ctx, window, operation.workspaceId, entry.path, { beforeActivate: assertCurrent }) }
      }
      if (action === 'create-file' || action === 'create-directory') {
        if (!directory) throw new Error('只能在文件夹中新建')
        validateName(input?.name)
        const name = input.name
        const relativePath = entry.relativePath ? `${entry.relativePath}/${name}` : name
        const destination = path.join(entry.path, name)
        await validateWorkspaceOperationPath(ctx, event, operation, destination)
        validateNotProtected(path.join(destination, '_'))
        await assertCurrent()
        if (action === 'create-directory') await mkdir(destination)
        else { const file = await open(destination, 'wx'); await file.close() }
        targets.delete(event.sender.id)
        return { entry: { name, relativePath, kind: action === 'create-directory' ? 'directory' : 'file' } }
      }
      if (!entry.relativePath) throw new Error('不能重命名或移除当前工作区根目录')
      if (action === 'rename') {
        validateName(input?.name)
        const parent = path.posix.dirname(entry.relativePath)
        const newRelativePath = parent === '.' ? input.name : `${parent}/${input.name}`
        const renamed = await executeWorkspaceLinkMove(ctx, event, operation, {
          impactId: input.impactId ?? '', mapping: { oldRelativePath: entry.relativePath, newRelativePath }, reason: 'rename', confirm: true,
        }, assertCurrent)
        targets.delete(event.sender.id)
        return { renamed }
      }
      if (action === 'trash') {
        const confirmation = await dialog.showMessageBox(window, { type: 'warning', title: `移到${trashLabel}`,
          message: `确定移除“${entry.name}”？`, detail: directory ? `整个文件夹及其内容将移到${trashLabel}，不会永久删除。` : `文件将移到${trashLabel}，不会永久删除。`,
          buttons: [`移到${trashLabel}`, '取消'], defaultId: 1, cancelId: 1, noLink: true })
        if (confirmation.response !== 0) return { deleted: false }
        await assertCurrent()
        await shell.trashItem(entry.path)
        targets.delete(event.sender.id)
        if (ctx.appDataManager?.removeDocumentMarks(target.root, entry.path, directory)) await broadcastDocumentMarksChanged(ctx, event.sender.id).catch(error => console.warn('[Browser] Failed to broadcast marks:', error))
        return { deleted: true }
      }
      throw new Error('不支持的工作区文件操作')
    } finally { busy.delete(event.sender.id) }
  })
}
