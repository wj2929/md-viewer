import { BrowserWindow, ipcMain, shell, app, net } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import { IPCContext } from './context'
import { validateNotProtected, validateSecurePathInBase } from '../security'
import { getSenderWorkspaceForOperation, validateSenderReadPath, validateWorkspaceOperationPath, resolveRecentFolderRoot } from './senderSecurity'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import type { FolderSplitLayoutV1 } from '../../shared/folderTabSession'
import { activateFolderForWindow, activateHistoryFolderForWindow } from '../folderActivation'
import { syncClipboardState, getClipboardState } from '../clipboardState'
import { readFilesFromSystemClipboard, writeFilesToSystemClipboard, hasFilesInSystemClipboard } from '../clipboardManager'
import * as contextMenuManager from '../contextMenuManager'
import { validateSecurePath as validateLaunchPath } from '../security/pathValidator'
import { getCliShimStatus, installCliShim, uninstallCliShim } from '../cliShimInstaller'
import { isDocumentMarkColor, isMarkdownPath } from '../../shared/documentMarks'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { findHeadingLine } from '../markdownHeadingLine'
import { resolveAuthorizedWorkspaceResource } from '../localResourceResolver'
import { realpath, stat } from 'node:fs/promises'
import { readLocalTextSnapshot, sameTextFile } from '../localTextSnapshot'
import { getSenderWindow } from './senderSecurity'
import { isLargeDocumentSize } from '../../shared/largeDocumentApproval'
import { isFileTreeSort, normalizeFileTreeSort } from '../../shared/fileTreeSort'

const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])
const MARKDOWN_LINK_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function toBookmarkSortEntries(bookmarks: unknown): Array<{ id: string; order: number }> {
  if (!Array.isArray(bookmarks)) {
    throw new Error('无效的书签排序')
  }

  return bookmarks.map((bookmark) => {
    if (!bookmark || typeof bookmark !== 'object') {
      throw new Error('无效的书签排序')
    }

    const { id, order } = bookmark as { id?: unknown; order?: unknown }
    if (typeof id !== 'string' || !isNonNegativeInteger(order)) {
      throw new Error('无效的书签排序')
    }
    return { id, order }
  })
}

function isPreviewableFilePath(filePath: string): boolean {
  return PREVIEWABLE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

async function readHeadingSnapshot(ctx: IPCContext, event: Electron.IpcMainInvokeEvent, canonicalPath: string): Promise<string> {
  const window = getSenderWindow(ctx, event)
  const workspaceId = ctx.windowManager.getActiveWorkspaceId(window.id)
  const workspace = workspaceId ? ctx.windowManager.getWorkspace(window.id, workspaceId) : undefined
  if (!workspace) throw new Error('unavailable')
  const epoch = workspace.lifecycleEpoch, root = workspace.primaryRoot
  const generation = ctx.windowManager.getLinkReadActivationGeneration(window.id)
  const assertCurrent = () => {
    if (event.sender.isDestroyed() || window.isDestroyed() || getSenderWindow(ctx, event) !== window
      || ctx.windowManager.getActiveWorkspaceId(window.id) !== workspaceId
      || ctx.windowManager.getWorkspace(window.id, workspaceId!) !== workspace
      || workspace.lifecycleEpoch !== epoch || workspace.primaryRoot !== root
      || ctx.windowManager.getLinkReadActivationGeneration(window.id) !== generation) throw new Error('stale')
  }
  const info = await stat(canonicalPath, { bigint: true })
  const validate = async () => {
    assertCurrent()
    if (await validateSenderReadPath(ctx, event, canonicalPath) !== canonicalPath
      || await realpath(canonicalPath) !== canonicalPath
      || !sameTextFile(info, await stat(canonicalPath, { bigint: true }))) throw new Error('stale')
    assertCurrent()
  }
  await validate()
  const snapshot = await readLocalTextSnapshot(canonicalPath, info, validate)
  if ('notice' in snapshot) throw new Error(snapshot.notice)
  return snapshot.content
}

async function resolveMarkdownLinkTarget(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  currentFilePath: string,
  href: string
): Promise<{
  success: boolean
  targetPath?: string
  targetLine?: number
  headingId?: string
  error?: string
}> {
  if (href.startsWith('wiki:')) {
    let rawWikiTarget: string
    try {
      rawWikiTarget = decodeURIComponent(href.slice('wiki:'.length))
    } catch {
      return { success: false, error: 'Wiki 链接编码无效' }
    }
    const target = splitMarkdownTarget(rawWikiTarget)
    if (!target.decodedPath) {
      if (!target.anchor?.startsWith('^')) {
        return { success: false, error: 'Wiki 链接目标为空' }
      }
      try {
        return {
          success: true,
          targetPath: await validateSenderReadPath(ctx, event, currentFilePath),
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Wiki 链接解析失败' }
      }
    }
    try {
      const resource = await resolveAuthorizedWorkspaceResource(
        ctx,
        event,
        currentFilePath,
        target.decodedPath,
        'workspace-wiki',
        { allowExtensionlessMarkdown: true },
      )
      if (!MARKDOWN_LINK_EXTENSIONS.has(path.extname(resource.canonicalPath).toLowerCase())) {
        return { success: false, error: 'Wiki 链接目标不是 Markdown 文件' }
      }
      let targetLine: number | undefined
      if (target.anchor && !target.anchor.startsWith('^')) {
        const markdown = await readHeadingSnapshot(ctx, event, resource.canonicalPath)
        targetLine = findHeadingLine(markdown, target.anchor)
      }
      return {
        success: true,
        targetPath: resource.canonicalPath,
        ...(targetLine === undefined ? {} : { targetLine }),
        ...(target.anchor && !target.anchor.startsWith('^') ? { headingId: target.anchor } : {}),
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Wiki 链接解析失败' }
    }
  }

  const target = splitMarkdownTarget(href)
  const cleanHref = target.decodedPath
  const headingId = target.anchor
  if (!cleanHref) return { success: false, error: '链接目标为空' }

  const canonicalCurrentFilePath = await validateSenderReadPath(ctx, event, currentFilePath)
  const dir = path.dirname(canonicalCurrentFilePath)
  const targetPath = path.resolve(dir, cleanHref)
  if (!MARKDOWN_LINK_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
    return { success: false, error: '目标不是 Markdown 文件' }
  }

  let canonicalTargetPath: string
  try {
    canonicalTargetPath = await validateSenderReadPath(ctx, event, targetPath)
  } catch {
    return { success: false, error: '目标文件不在已授权目录内' }
  }

  try {
    const stat = await fs.stat(canonicalTargetPath)
    if (!stat.isFile()) return { success: false, error: '目标不是 Markdown 文件' }
  } catch {
    return { success: false, error: '文件不存在' }
  }

  let targetLine: number | undefined
  if (headingId) {
    try {
      targetLine = findHeadingLine(await readHeadingSnapshot(ctx, event, canonicalTargetPath), headingId)
    } catch {
      return { success: false, error: '目标正文不可安全读取' }
    }
  }

  return { success: true, targetPath: canonicalTargetPath, targetLine, headingId }
}

export function sanitizeSettingsUpdates(updates: unknown): Record<string, unknown> {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('无效的应用设置')
  }
  const {
    readAloud: _ignoredReadAloud,
    diagnosticLogs: _ignoredDiagnosticLogs,
    ...safeUpdates
  } = updates as Record<string, unknown>
  if (
    Object.hasOwn(safeUpdates, 'autoRenderRemoteCharts')
    && typeof safeUpdates.autoRenderRemoteCharts !== 'boolean'
  ) {
    throw new Error('联网图表自动渲染设置必须是布尔值')
  }
  if (
    Object.hasOwn(safeUpdates, 'folderPinyinSearchEnabled')
    && typeof safeUpdates.folderPinyinSearchEnabled !== 'boolean'
  ) {
    throw new Error('目录拼音搜索设置必须是布尔值')
  }
  if (Object.hasOwn(safeUpdates, 'fileTreeSort') && !isFileTreeSort(safeUpdates.fileTreeSort)) {
    throw new Error('无效的目录树排序设置')
  }
  return safeUpdates
}

export function registerDataHandlers(ctx: IPCContext): void {
  const bookmarkActivationRequests = new WeakMap<Electron.WebContents, symbol>()
  // ============== 剪贴板 ==============

// ============== v1.3 阶段 3：剪贴板状态同步 ==============

// 同步剪贴板状态
ipcMain.handle('clipboard:sync-state', async (
  event,
  files: string[],
  isCut: boolean,
  operation: WorkspaceOperationContext
) => {
  for (const filePath of files) {
    await validateWorkspaceOperationPath(ctx, event, operation, filePath)
  }
  syncClipboardState(event.sender.id, files, isCut)
})

// 查询剪贴板状态
ipcMain.handle('clipboard:query-state', async (event) => {
  return getClipboardState(event.sender.id)
})

// v1.3 阶段 6：从系统剪贴板读取文件
ipcMain.handle('clipboard:read-system', async () => {
  const files = readFilesFromSystemClipboard()
  console.log('[CLIPBOARD] Read from system:', files.length, 'files')
  return files
})

// v1.3 阶段 6：写入文件到系统剪贴板
ipcMain.handle('clipboard:write-system', async (_, paths: string[], isCut: boolean) => {
  const result = writeFilesToSystemClipboard(paths, isCut)
  console.log('[CLIPBOARD] Write to system:', paths.length, 'files, success:', result)
  return result
})

// v1.3 阶段 6：检查系统剪贴板是否有文件
ipcMain.handle('clipboard:has-system-files', async () => {
  return hasFilesInSystemClipboard()
})

  // ============== Shell 操作 ==============

// v1.4：在 Finder/Explorer 中显示文件
ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
  try {
    // 使用 shell.showItemInFolder 在文件管理器中显示并选中文件
    shell.showItemInFolder(filePath)
    return { success: true }
  } catch (error) {
    console.error('Failed to show item in folder:', error)
    throw error
  }
})

// 打开外部链接（用于 Pandoc 安装指南等）
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  try {
    const urlObj = new URL(url)
    // 只允许 http/https 协议（阻止 file://、javascript: 等危险协议）
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      console.error(`[IPC] Blocked non-http external URL: ${url}`)
      return { success: false, error: '只允许打开 http/https 链接' }
    }
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('[IPC] Failed to open external URL:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
})

  // ============== 历史文件夹管理 ==============

// v1.3.4：历史文件夹管理
ipcMain.handle('folder-history:get', async () => {
  return ctx.folderHistoryManager.getHistory()
})

ipcMain.handle('folder-history:remove', async (_, historyId: string) => {
  ctx.folderHistoryManager.removeFolder(historyId)
})

ipcMain.handle('folder-history:clear', async () => {
  ctx.folderHistoryManager.clearHistory()
})

// 激活主进程持有的历史目录记录；禁止 renderer 提供路径扩大授权根。
ipcMain.handle('folder-history:activate', async (event, historyId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    throw new Error('无法识别当前窗口')
  }

  return activateHistoryFolderForWindow(ctx, win, historyId)
})

  // ============== 右键菜单安装 ==============

// v1.3.4：右键菜单安装
ipcMain.handle('context-menu:check-status', async () => {
  return contextMenuManager.checkStatus()
})

ipcMain.handle('context-menu:install', async () => {
  return contextMenuManager.install()
})

ipcMain.handle('context-menu:uninstall', async () => {
  return contextMenuManager.uninstall()
})

// v2.5：命令行工具安装
ipcMain.handle('cli-shim:status', async () => {
  return getCliShimStatus()
})

ipcMain.handle('cli-shim:install', async () => {
  return installCliShim()
})

ipcMain.handle('cli-shim:uninstall', async () => {
  return uninstallCliShim()
})

// v1.3.4：打开系统设置
ipcMain.handle('system:openSettings', async (_event, section: string) => {
  try {
    if (process.platform === 'darwin') {
      // macOS 系统设置深度链接
      const urlMap: Record<string, string> = {
        'extensions': 'x-apple.systempreferences:com.apple.preferences.extensions',
        'finder-extensions': 'x-apple.systempreferences:com.apple.preferences.extensions?Finder',
        'security': 'x-apple.systempreferences:com.apple.preference.security'
      }
      const url = urlMap[section] || urlMap['extensions']
      await shell.openExternal(url)
      return { success: true }
    } else if (process.platform === 'win32') {
      // Windows 默认程序设置
      await shell.openExternal('ms-settings:defaultapps')
      return { success: true }
    } else if (process.platform === 'linux') {
      // Linux：尝试打开系统设置应用（降级策略）
      const { exec } = await import('child_process')
      const tryOpen = (cmd: string): Promise<boolean> => {
        return new Promise((resolve) => {
          exec(`which ${cmd.split(' ')[0]}`, (err) => {
            if (err) { resolve(false); return }
            exec(cmd, (execErr) => resolve(!execErr))
          })
        })
      }
      // 按桌面环境优先级尝试
      if (await tryOpen('gnome-control-center info')) return { success: true }
      if (await tryOpen('systemsettings5')) return { success: true }
      if (await tryOpen('xfce4-settings-manager')) return { success: true }
      return { success: false, error: '请手动打开系统设置' }
    }
    return { success: false, error: '不支持的平台' }
  } catch (error) {
    console.error('[System] Failed to open settings:', error)
    return { success: false, error: String(error) }
  }
})

// v1.3.4：用户确认右键菜单已启用
ipcMain.handle('context-menu:confirm-enabled', async () => {
  return contextMenuManager.confirmEnabled()
})

  // ============== 最近文件管理 ==============

// ============== v1.3.6：最近文件管理 ==============

ipcMain.handle('recent-files:get', async () => {
  return ctx.appDataManager.getRecentFiles()
})

ipcMain.handle('recent-files:activate', async (event, recentId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const recentFile = ctx.appDataManager.getRecentFile(recentId)
  if (!win || !recentFile) {
    throw new Error('安全错误：最近文件不存在或当前窗口无效')
  }

  const canonicalFilePath = await validateSenderReadPath(ctx, event, recentFile.path)
  const rootPath = await resolveRecentFolderRoot(ctx, event, canonicalFilePath)
  const activation = await activateFolderForWindow(ctx, win, rootPath, {
    diagnosticSource: 'recent',
  })
  const resolvedFilePath = await validateSecurePathInBase(canonicalFilePath, activation.path)
  return { ...activation, filePath: resolvedFilePath, fileName: path.basename(resolvedFilePath) }
})

ipcMain.handle('recent-files:add', async (event, file: { path: string; name: string; folderPath: string }) => {
  const canonicalFilePath = await validateSenderReadPath(ctx, event, file.path)
  const folderPath = await resolveRecentFolderRoot(ctx, event, canonicalFilePath)
  await ctx.appDataManager.addRecentFile({
    path: canonicalFilePath,
    name: path.basename(canonicalFilePath),
    folderPath,
  })
})

ipcMain.handle('recent-files:remove', async (_, filePath: string) => {
  ctx.appDataManager.removeRecentFile(filePath)
})

ipcMain.handle('recent-files:clear', async () => {
  ctx.appDataManager.clearRecentFiles()
})

  // ============== 固定标签管理 ==============

// ============== v1.3.6：固定标签管理（按文件夹分组） ==============

ipcMain.handle('pinned-tabs:get-for-folder', async (event, folderPath: string) => {
  const canonicalRoot = await validateSenderReadPath(ctx, event, folderPath)
  const stats = await fs.stat(canonicalRoot)
  if (!stats.isDirectory()) {
    throw new Error('安全错误：目标不是目录')
  }
  return ctx.appDataManager.getPinnedTabsForFolder(canonicalRoot)
})

ipcMain.handle('pinned-tabs:add', async (
  event,
  filePath: string,
  operation: WorkspaceOperationContext
) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, filePath)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return ctx.appDataManager.addPinnedTabForFolder(canonicalPath, workspace.primaryRoot)
})

ipcMain.handle('pinned-tabs:remove', async (
  event,
  filePath: string,
  operation: WorkspaceOperationContext
) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, filePath)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  ctx.appDataManager.removePinnedTabForFolder(canonicalPath, workspace.primaryRoot)
})

ipcMain.handle('pinned-tabs:is-pinned', async (
  event,
  filePath: string,
  operation: WorkspaceOperationContext
) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  const canonicalPath = await validateSenderReadPath(ctx, event, filePath)
  if (!workspace.primaryRoot) return false
  return ctx.appDataManager.isTabPinnedInFolder(canonicalPath, workspace.primaryRoot)
})

  // ============== v2.8.0：按文件夹归档 tab 会话 ==============

ipcMain.handle('folder-tab-session:save', async (
  event,
  payload: {
    tabs: Array<{ filePath: string; isPinned?: boolean }>
    activeFilePath: string | null
    splitLayout?: FolderSplitLayoutV1
  },
  operation: WorkspaceOperationContext
) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')

  // 逐个校验 tab 路径落在发起窗口工作区根内，拒绝越权路径
  const validTabs: Array<{ filePath: string; isPinned?: boolean }> = []
  for (const tab of payload.tabs) {
    try {
      const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, tab.filePath)
      validTabs.push({ filePath: canonicalPath, isPinned: tab.isPinned })
    } catch {
      // 越权或失效路径直接跳过，不写入归档
    }
  }

  let activeCanonical: string | null = null
  if (payload.activeFilePath) {
    try {
      activeCanonical = await validateWorkspaceOperationPath(ctx, event, operation, payload.activeFilePath)
    } catch {
      activeCanonical = null
    }
  }

  ctx.appDataManager.saveFolderTabSession(
    workspace.primaryRoot,
    validTabs,
    activeCanonical,
    payload.splitLayout,
  )
})

ipcMain.handle('folder-tab-session:get-for-folder', async (event, folderPath: string) => {
  const canonicalRoot = await validateSenderReadPath(ctx, event, folderPath)
  const stats = await fs.stat(canonicalRoot)
  if (!stats.isDirectory()) {
    throw new Error('安全错误：目标不是目录')
  }
  return ctx.appDataManager.getFolderTabSession(canonicalRoot)
})

  // ============== 应用设置管理 ==============

// ============== v1.3.6：应用设置管理 ==============

ipcMain.handle('settings:get', async () => {
  const { diagnosticLogs: _diagnosticLogs, ...settings } = ctx.appDataManager.getSettings()
  return settings
})

let fileTreeSortRevision = 0
const sortSnapshot = () => ({ value: normalizeFileTreeSort(ctx.appDataManager.getSettings().fileTreeSort), revision: fileTreeSortRevision })
ipcMain.handle('settings:fileTreeSort', () => sortSnapshot())
ipcMain.handle('settings:update', async (_, updates: Record<string, unknown>) => {
  const safeUpdates = sanitizeSettingsUpdates(updates)
  ctx.appDataManager.updateSettings(safeUpdates)
  if (Object.hasOwn(safeUpdates, 'fileTreeSort')) {
    fileTreeSortRevision++
    const snapshot = sortSnapshot()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:fileTreeSortChanged', snapshot)
    }
  }
})

ipcMain.handle('folder-tree-state:get', async (event, operation: WorkspaceOperationContext) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return ctx.appDataManager.getFolderTreeState(workspace.primaryRoot)
})

ipcMain.handle('folder-tree-state:save', async (
  event,
  folders: Record<string, unknown>,
  operation: WorkspaceOperationContext
) => {
  if (!folders || typeof folders !== 'object' || Array.isArray(folders)) {
    throw new Error('无效的文件树状态')
  }

  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return ctx.appDataManager.saveFolderTreeState(workspace.primaryRoot, folders)
})

ipcMain.handle('folder-tree-state:clear', async (event, operation: WorkspaceOperationContext) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  ctx.appDataManager.clearFolderTreeState(workspace.primaryRoot)
})

ipcMain.handle('document-marks:get', async (event, operation: WorkspaceOperationContext) => {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return ctx.appDataManager.getDocumentMarks(workspace.primaryRoot)
})

ipcMain.handle('document-marks:set', async (
  event,
  filePath: string,
  color: unknown,
  operation: WorkspaceOperationContext
) => {
  if (color !== null && !isDocumentMarkColor(color)) throw new Error('无效的背景标记色')
  if (!isMarkdownPath(filePath)) throw new Error('仅支持标记 Markdown 文件')

  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  const canonicalPath = await validateSenderReadPath(ctx, event, filePath)
  const stat = await fs.stat(canonicalPath)
  if (!stat.isFile()) throw new Error('仅支持标记 Markdown 文件')

  const marks = ctx.appDataManager.setDocumentMark(workspace.primaryRoot, canonicalPath, color)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'document-marks:changed')
  }
  return marks
})

ipcMain.handle('large-document-approval:get', async (event, filePath: string) => {
  getSenderWindow(ctx, event)
  const canonicalPath = await validateSenderReadPath(ctx, event, filePath)
  if (!isMarkdownPath(canonicalPath) || !(await fs.stat(canonicalPath)).isFile()) throw new Error('仅支持 Markdown 文件')
  return ctx.appDataManager.getLargeDocumentApproval(canonicalPath)
})

ipcMain.handle('large-document-approval:set', async (event, filePath: string, size: unknown, operation: WorkspaceOperationContext) => {
  if (size !== null && !isLargeDocumentSize(size)) throw new Error('无效的大文档规模')
  const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, filePath)
  if (!isMarkdownPath(canonicalPath) || !(await fs.stat(canonicalPath)).isFile()) throw new Error('仅支持 Markdown 文件')
  getSenderWorkspaceForOperation(ctx, event, operation)
  ctx.appDataManager.setLargeDocumentApproval(canonicalPath, size)
})

ipcMain.handle('read-position:get', async (event, filePath: string) => {
  const canonicalPath = await validateSenderReadPath(ctx, event, filePath)
  return ctx.appDataManager.getReadPosition(canonicalPath)
})

ipcMain.handle('read-position:save', async (event, position: {
  canonicalPath: string
  scrollRatio?: number
  headingId?: string
  updatedAt?: number
  contentHash?: string
  workspace: WorkspaceOperationContext
}) => {
  const canonicalPath = await validateWorkspaceOperationPath(ctx, event, position.workspace, position.canonicalPath)
  const { workspace: _workspace, ...readPosition } = position
  return ctx.appDataManager.saveReadPosition({ ...readPosition, canonicalPath })
})

ipcMain.handle('read-position:clear', async (event, filePath: string, operation: WorkspaceOperationContext) => {
  const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, filePath)
  ctx.appDataManager.clearReadPosition(canonicalPath)
})

  // ============== 搜索历史管理（原子操作） ==============

ipcMain.handle('search-history:load', async () => {
  return ctx.appDataManager.getSearchHistory()
})

ipcMain.handle('search-history:add', async (_, type: 'searchBar' | 'inPage', keyword: string) => {
  return type === 'searchBar'
    ? ctx.appDataManager.addSearchBarHistory(keyword)
    : ctx.appDataManager.addInPageSearchHistory(keyword)
})

ipcMain.handle('search-history:remove', async (_, type: 'searchBar' | 'inPage', keyword: string) => {
  return type === 'searchBar'
    ? ctx.appDataManager.removeSearchBarHistory(keyword)
    : ctx.appDataManager.removeInPageSearchHistory(keyword)
})

ipcMain.handle('search-history:clear', async (_, type: 'searchBar' | 'inPage') => {
  type === 'searchBar'
    ? ctx.appDataManager.clearSearchBarHistory()
    : ctx.appDataManager.clearInPageSearchHistory()
})

  // ============== 书签管理 ==============

// ============== v1.3.6：书签管理 ==============

ipcMain.handle('bookmarks:get', async () => {
  return ctx.appDataManager.getBookmarks()
})

ipcMain.handle('bookmarks:activate', async (event, bookmarkId: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const bookmark = ctx.appDataManager.getBookmark(bookmarkId)
  if (!win || !bookmark) {
    throw new Error('安全错误：书签不存在或当前窗口无效')
  }
  const request = Symbol()
  bookmarkActivationRequests.set(event.sender, request)
  const workspaceId = ctx.windowManager.getActiveWorkspaceId(win.id)
  const epoch = workspaceId ? ctx.windowManager.getWorkspace(win.id, workspaceId)?.lifecycleEpoch : undefined
  const assertCurrent = () => {
    if (win.isDestroyed() || event.sender.isDestroyed() ||
      bookmarkActivationRequests.get(event.sender) !== request ||
      ctx.windowManager.getActiveWorkspaceId(win.id) !== workspaceId ||
      (workspaceId && ctx.windowManager.getWorkspace(win.id, workspaceId)?.lifecycleEpoch !== epoch) ||
      ctx.appDataManager.getBookmark(bookmarkId)?.filePath !== bookmark.filePath) {
      throw new Error('书签打开请求已失效，请重试')
    }
  }
  assertCurrent()
  validateNotProtected(bookmark.filePath)
  let canonicalFilePath: string
  try {
    canonicalFilePath = await realpath(bookmark.filePath)
    if (!(await stat(canonicalFilePath)).isFile()) throw new Error('书签目标不是文件')
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error('书签文件不存在或已移动，请重新定位文件')
    }
    throw error
  }
  validateNotProtected(canonicalFilePath)
  let rootPath: string
  try {
    await validateSenderReadPath(ctx, event, canonicalFilePath)
    rootPath = await resolveRecentFolderRoot(ctx, event, canonicalFilePath)
  } catch {
    assertCurrent()
    // 单人本机：激活已有书签就是打开动作，缺少历史根时使用文件所在目录。
    rootPath = path.dirname(canonicalFilePath)
  }
  canonicalFilePath = await validateSecurePathInBase(bookmark.filePath, rootPath)
  assertCurrent()
  const activation = await activateFolderForWindow(ctx, win, rootPath, {
    diagnosticSource: 'recent',
  })
  const resolvedFilePath = await validateSecurePathInBase(canonicalFilePath, activation.path)
  return { ...activation, filePath: resolvedFilePath, fileName: path.basename(resolvedFilePath) }
})

ipcMain.handle('bookmarks:add', async (event, bookmark: {
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
}) => {
  // 保存书签不改变读权限；显式激活已有书签时才恢复其目录。
  const canonicalFilePath = await validateSenderReadPath(ctx, event, bookmark.filePath)
  const result = ctx.appDataManager.addBookmark({
    ...bookmark,
    filePath: canonicalFilePath,
    fileName: path.basename(canonicalFilePath),
  })
  // v1.6.0: 广播书签变更到其他窗口
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
  return result
})

ipcMain.handle('bookmarks:update', async (event, id: string, updates: {
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  order?: number
}) => {
  const allowedUpdates = {
    ...(typeof updates?.title === 'string' ? { title: updates.title } : {}),
    ...(typeof updates?.headingId === 'string' ? { headingId: updates.headingId } : {}),
    ...(typeof updates?.headingText === 'string' ? { headingText: updates.headingText } : {}),
    ...(typeof updates?.scrollPosition === 'number' ? { scrollPosition: updates.scrollPosition } : {}),
    ...(isNonNegativeInteger(updates?.order) ? { order: updates.order } : {}),
  }
  ctx.appDataManager.updateBookmark(id, allowedUpdates)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:remove', async (event, id: string) => {
  ctx.appDataManager.removeBookmark(id)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:update-all', async (event, bookmarks: unknown) => {
  const sortEntries = toBookmarkSortEntries(bookmarks)
  const existing = new Map(ctx.appDataManager.getBookmarks().map(bookmark => [bookmark.id, bookmark]))
  if (sortEntries.length !== existing.size || new Set(sortEntries.map(bookmark => bookmark.id)).size !== existing.size) {
    throw new Error('无效的书签排序')
  }

  const reordered = sortEntries.map(({ id, order }) => {
    if (!existing.has(id)) {
      throw new Error('无效的书签排序')
    }
    return { ...existing.get(id)!, order }
  })
  ctx.appDataManager.updateBookmarks(reordered)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

ipcMain.handle('bookmarks:clear', async (event) => {
  ctx.appDataManager.clearBookmarks()
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'bookmarks:changed')
  }
})

  // ============== 拖拽 & 导航 ==============

// v1.5.1: 拖拽支持 — 处理从 Finder 拖入的文件/文件夹
ipcMain.handle('drop:openPaths', async (event, paths: string[]) => {
  const folders: string[] = []
  const mdFiles: string[] = []
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  for (const p of paths) {
    const validation = await validateLaunchPath(p)
    if (!validation.valid) continue
    if (validation.type === 'directory') {
      folders.push(validation.normalizedPath)
    } else if (isPreviewableFilePath(validation.normalizedPath)) {
      mdFiles.push(validation.normalizedPath)
    }
  }

  if (folders.length > 0) {
    ctx.openPathInWindow(folders[0], 'directory', senderWindow || undefined)
  } else if (mdFiles.length > 0) {
    ctx.openPathInWindow(mdFiles[0], 'md-file', senderWindow || undefined)
    for (let i = 1; i < mdFiles.length; i++) {
      setTimeout(() => {
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.webContents.send('open-specific-file', mdFiles[i])
        }
      }, 500 + i * 200)
    }
  }
})

// v2.4.0: 内部 Markdown 链接解析 — 仅返回目标，打开前由渲染进程统一处理脏草稿确认
ipcMain.handle('navigate:resolveMdLink', async (event, currentFilePath: string, href: string) => {
  return resolveMarkdownLinkTarget(ctx, event, currentFilePath, href)
})

// v1.5.1: 内部 .md 链接跳转 — 解析相对路径并打开目标 .md 文件
ipcMain.handle('navigate:openMdLink', async (event, currentFilePath: string, href: string) => {
  const result = await resolveMarkdownLinkTarget(ctx, event, currentFilePath, href)
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  if (!result.success || !result.targetPath) return result

  ctx.openPathInWindow(result.targetPath, 'md-file', senderWindow || undefined)
  return { success: true }
})

  // ============== 应用版本 & 更新 ==============

// v1.5.2: 获取应用版本和系统信息
ipcMain.handle('app:getVersion', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch
}))

// v1.5.2: 检查更新（多源容错）
ipcMain.handle('app:checkForUpdates', async () => {
  // semver 比较：a > b 返回 true
  const isNewerVersion = (remote: string, local: string): boolean => {
    const r = remote.split('.').map(Number)
    const l = local.split('.').map(Number)
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0
      const lv = l[i] || 0
      if (rv > lv) return true
      if (rv < lv) return false
    }
    return false
  }

  const GITHUB_REPO = 'wj2929/md-viewer'
  const SOURCES = [
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@latest/package.json`
  ]
  const TIMEOUT_MS = 5000

  // 源1: GitHub Releases API
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await net.fetch(SOURCES[0], {
      headers: {
        'User-Agent': 'MD-Viewer',
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const latestVersion = data.tag_name?.replace(/^v/, '')
    const currentVersion = app.getVersion()
    console.log(`[UpdateCheck] GitHub API: current=${currentVersion}, latest=${latestVersion}`)
    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
      releaseNotes: data.body,
      publishedAt: data.published_at
    }
  } catch (err) {
    console.warn('[UpdateCheck] GitHub API failed:', err)
  }

  // 源2: jsDelivr CDN (读取 package.json 的 version 字段)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await net.fetch(SOURCES[1], {
      headers: { 'User-Agent': 'MD-Viewer' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const latestVersion = data.version
    const currentVersion = app.getVersion()
    console.log(`[UpdateCheck] jsDelivr: current=${currentVersion}, latest=${latestVersion}`)
    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
      publishedAt: undefined
    }
  } catch (err) {
    console.warn('[UpdateCheck] jsDelivr failed:', err)
  }

  return { error: '无法连接到更新服务器，请检查网络连接后重试' }
})
}
