// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerDirectoryBrowserActions } from '../ipc/directoryBrowserActions'
import type { IPCContext } from '../ipc/context'
import type { WorkspaceBrowserAction, WorkspaceBrowserSelection } from '../../shared/directoryBrowser'
import { resetSecurity } from '../security'
import { activateFolderForWorkspace, openFolderInNewWindow } from '../folderActivation'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() },
  clipboard: { writeText: vi.fn() }, shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
  dialog: { showMessageBox: vi.fn() }, Menu: { buildFromTemplate: vi.fn() } }))
vi.mock('../ipc/fileHandlers', () => ({ broadcastDocumentMarksChanged: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../folderActivation', () => ({ activateFolderForWorkspace: vi.fn(), openFolderInNewWindow: vi.fn() }))

describe('workspace browser actions', () => {
  let root: string
  let epoch: number
  let active: string
  let labels: string[]
  let selected: string
  let ctx: IPCContext
  const operation = { workspaceId: 'workspace', lifecycleEpoch: 1 }
  const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent
  function handler(channel: string): (...args: any[]) => Promise<any> {
    return vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1] as any
  }
  const choose = async (relativePath: string, label = '复制完整路径'): Promise<WorkspaceBrowserSelection> => {
    selected = label
    return handler('browser:showContextMenu')(event, operation, relativePath)
  }
  const perform = (selection: WorkspaceBrowserSelection, action: WorkspaceBrowserAction = selection.action, input?: object) =>
    handler('browser:performAction')(event, operation, selection.target.id, action, input)

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSecurity()
    root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-browser-action-'))
    await fs.mkdir(path.join(root, 'folder'))
    await fs.writeFile(path.join(root, 'folder', 'child.md'), '# Child')
    await fs.writeFile(path.join(root, 'data.json'), '{}')
    await fs.writeFile(path.join(root, 'unsafe.html'), '<script>never executed</script>')
    epoch = 1; active = 'workspace'; selected = ''; labels = []
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => false } as Electron.BrowserWindow)
    vi.mocked(Menu.buildFromTemplate).mockImplementation(template => {
      labels = template.map(item => item.label ?? '').filter(Boolean)
      return { popup: ({ callback }: { callback: () => void }) => {
        const item = template.find(item => item.label === selected)
        ;(item?.click as (() => void) | undefined)?.()
        callback()
      } } as unknown as Electron.Menu
    })
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
    vi.mocked(shell.trashItem).mockResolvedValue(undefined)
    ctx = { windowManager: {
      getWorkspace: (_id: number, id: string) => id === 'workspace' ? { id, primaryRoot: root, lifecycleEpoch: epoch } : undefined,
      getActiveWorkspaceId: () => active,
    }, appDataManager: { removeDocumentMarks: vi.fn().mockReturnValue(false), relocateDocumentMarks: vi.fn().mockReturnValue(false) },
    linkRewritePlanner: { executeOperation: vi.fn(async input => ({ result: await input.execute(), receipt: { operationReceiptId: 'receipt' } })) },
    workspaceIndexService: { refreshMovedRelativePaths: vi.fn().mockResolvedValue(undefined) } } as unknown as IPCContext
    registerDirectoryBrowserActions(ctx)
  })
  afterEach(async () => { vi.restoreAllMocks(); resetSecurity(); await fs.rm(root, { recursive: true, force: true }) })

  it('builds object-specific menus and never offers execution for HTML', async () => {
    await choose('unsafe.html')
    expect(labels).toContain('临时预览')
    expect(labels).not.toContain('用系统默认应用打开…')
    await choose('data.json')
    expect(labels).toContain('用系统默认应用打开…')
    await choose('folder/child.md')
    expect(labels).toContain('在标签页打开')
    await choose('folder')
    expect(labels).toEqual(expect.arrayContaining(['新建文件…', '新建文件夹…', '在当前窗口打开', '在新窗口打开', '重命名…', '移到废纸篓…']))
    await choose('')
    expect(labels).not.toContain('重命名…')
    expect(labels).not.toContain('移到废纸篓…')
    expect(labels).not.toContain('在当前窗口打开')
  })
  it('copies canonical and workspace-relative paths and reveals the bound target', async () => {
    const target = await choose('folder/child.md')
    await perform(target)
    expect(clipboard.writeText).toHaveBeenLastCalledWith(path.join(root, 'folder', 'child.md'))
    await perform(target, 'copy-relative-path')
    expect(clipboard.writeText).toHaveBeenLastCalledWith('folder/child.md')
    await perform(target, 'reveal')
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(root, 'folder', 'child.md'))
    await perform(await choose(''), 'copy-relative-path')
    expect(clipboard.writeText).toHaveBeenLastCalledWith('.')
  })
  it('copy action waits for system write and rejects a failed write', async () => {
    const target = await choose('folder/child.md')
    let finish!: () => void
    vi.mocked(clipboard.writeText).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    let completed = false
    const pending = perform(target).then(result => { completed = true; return result })
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalled())
    expect(completed).toBe(false)
    finish()
    await expect(pending).resolves.toEqual({})
    vi.mocked(clipboard.writeText).mockRejectedValueOnce(new Error('system refused'))
    await expect(perform(target)).rejects.toThrow('无法写入系统剪贴板')
  })
  it('creates files and folders without overwriting or recursively creating parents', async () => {
    let target = await choose('folder')
    expect(await perform(target, 'create-file', { name: '新建.md' })).toMatchObject({ entry: { relativePath: 'folder/新建.md', kind: 'file' } })
    expect(await fs.readFile(path.join(root, 'folder', '新建.md'), 'utf8')).toBe('')
    target = await choose('folder')
    await expect(perform(target, 'create-file', { name: 'child.md' })).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'folder', 'child.md'), 'utf8')).toBe('# Child')
    await expect(perform(target, 'create-directory', { name: 'child.md' })).rejects.toThrow()
    await perform(target, 'create-directory', { name: '空目录' })
    expect((await fs.stat(path.join(root, 'folder', '空目录'))).isDirectory()).toBe(true)
  })
  it.each(['../escape.md', '/absolute.md', 'a/b', 'a\\b', '.', '..', 'a\0b', 'CON', 'trailing.', ' ', 'x:y'])('rejects unsafe creation name %j', async name => {
    await expect(perform(await choose(''), 'create-file', { name })).rejects.toThrow('名称')
  })
  it('rejects protected directories, symlinks, unknown owner, stale epoch and inactive workspace', async () => {
    await fs.mkdir(path.join(root, '.ssh'))
    await fs.symlink(path.join(root, 'folder'), path.join(root, 'linked'))
    for (const value of ['../outside', '/etc', 'C:/x', 'folder/../data.json', '.ssh', 'linked', 'linked/child.md']) await expect(choose(value)).rejects.toThrow()
    await expect(handler('browser:showContextMenu')(event, { ...operation, workspaceId: 'other' }, '')).rejects.toThrow()
    const target = await choose('data.json')
    epoch++
    await expect(perform(target)).rejects.toThrow()
    epoch = 1; active = 'other'
    await expect(perform(target)).rejects.toThrow('工作区')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
  it('rejects a replaced file or parent directory and expired or foreign target token', async () => {
    let target = await choose('data.json')
    await fs.rename(path.join(root, 'data.json'), path.join(root, 'original.json'))
    await fs.writeFile(path.join(root, 'data.json'), '{}')
    await expect(perform(target)).rejects.toThrow('变化')
    target = await choose('folder')
    await fs.rename(path.join(root, 'folder'), path.join(root, 'original-folder'))
    await fs.mkdir(path.join(root, 'folder'))
    await expect(perform(target, 'create-file', { name: 'do-not-create.md' })).rejects.toThrow('变化')
    await expect(handler('browser:performAction')(event, operation, 'foreign', 'trash')).rejects.toThrow('失效')
    target = await choose('data.json')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)
    await expect(perform(target)).rejects.toThrow('失效')
  })
  it('defaults trash to cancel and revalidates after confirmation; never permanently deletes', async () => {
    const target = await choose('folder')
    expect(await perform(target, 'trash')).toEqual({ deleted: false })
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultId: 1, cancelId: 1 }))
    expect(shell.trashItem).not.toHaveBeenCalled()
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(async () => { epoch++; return { response: 0, checkboxChecked: false } })
    await expect(perform(target, 'trash')).rejects.toThrow()
    expect(shell.trashItem).not.toHaveBeenCalled()
    epoch = 1
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
    vi.mocked(shell.trashItem).mockRejectedValueOnce(new Error('fixture trash unavailable'))
    await expect(perform(target, 'trash')).rejects.toThrow('trash unavailable')
    expect((await fs.stat(path.join(root, 'folder', 'child.md'))).isFile()).toBe(true)
    expect(await perform(target, 'trash')).toEqual({ deleted: true })
  })
  it('blocks root mutation even when directly invoking the action IPC', async () => {
    const target = await choose('')
    await expect(perform(target, 'rename', { name: 'renamed', impactId: 'fixture' })).rejects.toThrow('根目录')
    await expect(perform(target, 'trash')).rejects.toThrow('根目录')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
  it('renames through the existing link transaction and preserves its symlink boundary', async () => {
    const target = await choose('folder')
    const result = await perform(target, 'rename', { name: 'renamed', impactId: 'fixture' })
    expect(result.renamed.newPath).toBe(path.join(root, 'renamed'))
    expect(await fs.readFile(path.join(root, 'renamed', 'child.md'), 'utf8')).toBe('# Child')
    expect(ctx.workspaceIndexService!.refreshMovedRelativePaths).toHaveBeenCalledWith(root, [{ oldRelativePath: 'folder', newRelativePath: 'renamed' }])
    await fs.symlink(path.join(root, 'data.json'), path.join(root, 'renamed', 'linked'))
    await expect(perform(await choose('renamed'), 'rename', { name: 'blocked', impactId: 'fixture' })).rejects.toThrow('符号链接')
  })
  it('rechecks current scope after the rename directory walk before the physical move', async () => {
    const target = await choose('folder')
    vi.mocked(ctx.linkRewritePlanner!.executeOperation).mockImplementationOnce((async (input: { execute: () => Promise<unknown> }) => { epoch++; return { result: await input.execute(), receipt: {} } }) as any)
    await expect(perform(target, 'rename', { name: 'must-not-move', impactId: 'fixture' })).rejects.toThrow()
    expect((await fs.stat(path.join(root, 'folder'))).isDirectory()).toBe(true)
  })
  it('opens only verified directories and passes a live guard to folder activation', async () => {
    const target = await choose('folder')
    await perform(target, 'new-window')
    expect(openFolderInNewWindow).toHaveBeenCalledWith(ctx, path.join(root, 'folder'), expect.any(Function))
    const guard = vi.mocked(openFolderInNewWindow).mock.calls[0][2]!
    epoch++
    await expect(guard()).rejects.toThrow()
    epoch = 1
    await perform(target, 'open-folder')
    expect(activateFolderForWorkspace).toHaveBeenCalledWith(ctx, expect.anything(), 'workspace', path.join(root, 'folder'), expect.objectContaining({ beforeActivate: expect.any(Function) }))
    await expect(perform(await choose('data.json'), 'new-window')).rejects.toThrow('文件夹')
  })
})
