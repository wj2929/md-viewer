import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as os from 'node:os'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { registerDataHandlers } from '../ipc/dataHandlers'
import { activateFolderForWindow } from '../folderActivation'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getName: vi.fn(() => 'md-viewer') },
  net: { fetch: vi.fn() }
}))
vi.mock('../folderActivation', () => ({
  activateFolderForWindow: vi.fn(), activateHistoryFolderForWindow: vi.fn()
}))

function activationHandler() {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'bookmarks:activate')?.[1]
  if (!handler) throw new Error('Missing bookmarks:activate')
  return handler
}

describe('已有书签直接打开', () => {
  let root: string
  let current: string
  let bookmarked: string
  let target: string
  let bookmark: any
  let win: any
  let event: any
  let ctx: any
  let workspace: any
  let activeId: string | null

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-bookmark-direct-'))
    current = path.join(root, 'current')
    bookmarked = path.join(root, 'bookmarked')
    await fs.ensureDir(current)
    await fs.ensureDir(bookmarked)
    target = path.join(bookmarked, 'target.md')
    await fs.writeFile(target, '# Synthetic bookmark')
    bookmark = { id: 'bookmark-id', filePath: target, fileName: 'target.md' }
    win = { id: 1, isDestroyed: vi.fn(() => false) }
    event = { sender: { id: 7, isDestroyed: vi.fn(() => false) } }
    workspace = { id: 'workspace-a', primaryRoot: current, lifecycleEpoch: 1 }
    activeId = workspace.id
    ctx = {
      appDataManager: { getBookmark: vi.fn((id: string) => id === bookmark?.id ? bookmark : null) },
      windowManager: {
        getWindowFolderPath: vi.fn(() => current), getAllWindowFolderRoots: vi.fn(() => [current]),
        getActiveWorkspaceId: vi.fn(() => activeId), getWorkspace: vi.fn(() => workspace)
      },
      folderHistoryManager: { getHistory: vi.fn(async () => []), findContainingFolder: vi.fn(async () => null) }
    }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win)
    vi.mocked(dialog.showOpenDialog).mockRejectedValue(new Error('Unexpected directory confirmation'))
    vi.mocked(activateFolderForWindow).mockImplementation(async (_ctx, _win, folder) => ({
      id: 'folder-id', name: path.basename(folder), path: folder,
      workspace: { id: workspace.id, primaryRoot: folder, lifecycleEpoch: 2 }
    }))
    registerDataHandlers(ctx)
  })

  afterEach(async () => { await fs.remove(root) })

  it('仍优先使用已有目录根，不弹对话框', async () => {
    ctx.folderHistoryManager.getHistory.mockResolvedValue([{ path: bookmarked }])
    ctx.folderHistoryManager.findContainingFolder.mockResolvedValue(bookmarked)
    const result = await activationHandler()(event, bookmark.id)
    expect(result.filePath).toBe(target)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(activateFolderForWindow).toHaveBeenCalledWith(ctx, win, bookmarked, { diagnosticSource: 'recent' })
  })

  it('缺少历史根时按保存的书签直接打开，忽略 renderer 额外路径', async () => {
    const original = { ...bookmark }
    const result = await activationHandler()(event, bookmark.id, { filePath: '/untrusted', root: '/' })
    expect(result.filePath).toBe(target)
    expect(bookmark).toEqual(original)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(activateFolderForWindow).toHaveBeenCalledWith(ctx, win, bookmarked, expect.anything())
  })

  it('恢复根仅取真实文件的直接父目录，不扩大到祖先目录', async () => {
    target = path.join(bookmarked, 'nested', 'target.md')
    await fs.outputFile(target, '# Nested')
    bookmark.filePath = target
    await expect(activationHandler()(event, bookmark.id)).resolves.toMatchObject({ filePath: target })
    expect(activateFolderForWindow).toHaveBeenCalledWith(ctx, win, path.dirname(target), expect.anything())
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('未知 opaque ID 不弹框，不激活', async () => {
    await expect(activationHandler()(event, target)).rejects.toThrow('书签不存在')
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(activateFolderForWindow).not.toHaveBeenCalled()
  })

  it('无效窗口不弹框，不激活', async () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null)
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('缺失文件保留书签并提示文件不存在，不要求重新授权', async () => {
    bookmark.filePath = path.join(bookmarked, 'missing.md')
    const original = { ...bookmark }
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow(/不存在|已移动/)
    expect(bookmark).toEqual(original)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(activateFolderForWindow).not.toHaveBeenCalled()
  })

  it('目录不能当作书签文件激活', async () => {
    bookmark.filePath = bookmarked
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow(/不是文件/)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('受保护路径仍拒绝，不弹授权框', async () => {
    bookmark.filePath = path.join(root, '.ssh/id_rsa')
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow('受保护')
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(activateFolderForWindow).not.toHaveBeenCalled()
  })

  it('普通名称符号链接指向受保护文件仍拒绝', async () => {
    const protectedTarget = path.join(root, '.ssh/secret.md')
    await fs.outputFile(protectedTarget, '# Synthetic protected file')
    await fs.ensureSymlink(protectedTarget, path.join(bookmarked, 'alias.md'))
    bookmark.filePath = path.join(bookmarked, 'alias.md')
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow('受保护')
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('解析期间符号链接逃逸时不激活旧根', async () => {
    const alias = path.join(bookmarked, 'alias.md')
    const outside = path.join(current, 'outside.md')
    await fs.writeFile(outside, '# Outside')
    await fs.ensureSymlink(target, alias)
    bookmark.filePath = alias
    ctx.folderHistoryManager.getHistory.mockImplementation(async () => {
      await fs.unlink(alias)
      await fs.ensureSymlink(outside, alias)
      return []
    })
    await expect(activationHandler()(event, bookmark.id)).rejects.toThrow('安全错误')
    expect(activateFolderForWindow).not.toHaveBeenCalled()
  })

  it.each(['window', 'sender', 'workspace', 'epoch', 'bookmark', 'bookmarkPath'] as const)('解析期间 %s 失效时不再切根', async kind => {
    const id = bookmark.id
    ctx.folderHistoryManager.getHistory.mockImplementation(async () => {
      if (kind === 'window') win.isDestroyed.mockReturnValue(true)
      if (kind === 'sender') event.sender.isDestroyed.mockReturnValue(true)
      if (kind === 'workspace') activeId = 'workspace-b'
      if (kind === 'epoch') workspace.lifecycleEpoch++
      if (kind === 'bookmark') bookmark = null
      if (kind === 'bookmarkPath') bookmark = { ...bookmark, filePath: path.join(current, 'other.md') }
      return []
    })
    await expect(activationHandler()(event, id)).rejects.toThrow('已失效')
    expect(activateFolderForWindow).not.toHaveBeenCalled()
  })

  it('较晚发起的打开使旧异步结果失效', async () => {
    let release!: (history: []) => void
    ctx.folderHistoryManager.getHistory.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = activationHandler()(event, bookmark.id)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(activationHandler()(event, bookmark.id)).resolves.toMatchObject({ filePath: target })
    release([])
    await expect(first).rejects.toThrow('已失效')
    expect(activateFolderForWindow).toHaveBeenCalledTimes(1)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })
})
