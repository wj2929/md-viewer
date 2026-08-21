import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { registerWindowHandlers } from '../ipc/windowHandlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}))
vi.mock('../ipc/senderSecurity', () => ({ validateSenderReadPath: vi.fn() }))
vi.mock('../workspaceSessionStore', () => ({
  workspaceSessionStore: { takeRestoredRuntime: vi.fn(), load: vi.fn(), save: vi.fn() },
}))

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const registered = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registered) throw new Error(`Missing handler: ${channel}`)
  return registered[1] as T
}

describe('workspace merge source presentations', () => {
  const target = { id: 1 }
  const source = { id: 2, webContents: { send: vi.fn() } }
  const presentations = new Map<string, any>()
  const workspaces = [
    { id: 'empty', primaryRoot: null, lifecycleEpoch: 1 },
    { id: 'video-a', primaryRoot: '/docs/video', lifecycleEpoch: 1 },
    { id: 'video-b', primaryRoot: '/docs/video', lifecycleEpoch: 1 },
  ]
  const windowManager = {
    setWorkspacePresentations: vi.fn(() => true),
    getAllWindows: vi.fn(() => [target, source]),
    getActiveWorkspaceId: vi.fn(() => 'video-a'),
    listWorkspaces: vi.fn((windowId: number) => windowId === 2 ? workspaces : []),
    getWorkspacePresentation: vi.fn((_windowId: number, workspaceId: string) => presentations.get(workspaceId)),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    presentations.clear()
    registerWindowHandlers({ windowManager } as any)
  })

  it('按存活窗口分组、过滤纯空占位并保留同根会话', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(target as any)
    presentations.set('empty', { label: '空白会话', isEmptyPlaceholder: true, hasMeaningfulState: false, tabCount: 0, activeTabName: null, hasSplit: false, hasDraft: false })
    presentations.set('video-a', { label: 'video', isEmptyPlaceholder: false, hasMeaningfulState: true, tabCount: 2, activeTabName: 'a.md', hasSplit: false, hasDraft: false })
    presentations.set('video-b', { label: 'video', isEmptyPlaceholder: false, hasMeaningfulState: true, tabCount: 1, activeTabName: 'b.md', hasSplit: true, hasDraft: true })

    const list = handler<(event: any) => any[]>('workspace:listMergeSources')({ sender: {} })
    expect(list).toEqual([{
      windowId: 2,
      title: '窗口 1 · video',
      workspaceCount: 2,
      summary: '2 个会话 · 3 个标签 · 含分屏 · 含草稿',
      workspaces: [
        { id: 'video-a', name: 'video', summary: '当前：a.md · 2 个标签' },
        { id: 'video-b', name: 'video（会话 2）', summary: '当前：b.md · 1 个标签 · 分屏 · 有草稿' },
      ],
    }])
  })

  it('排除带目录但没有阅读状态的来源会话', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(target as any)
    presentations.set('video-a', { label: 'video', isEmptyPlaceholder: false, hasMeaningfulState: false, tabCount: 0, activeTabName: null, hasSplit: false, hasDraft: false })
    presentations.set('video-b', { label: 'video', isEmptyPlaceholder: false, hasMeaningfulState: true, tabCount: 1, activeTabName: 'b.md', hasSplit: false, hasDraft: false })

    const list = handler<(event: any) => any[]>('workspace:listMergeSources')({ sender: {} })
    expect(list[0]).toMatchObject({ workspaceCount: 1, workspaces: [{ id: 'video-b' }] })
  })

  it('排除没有可转移会话的来源窗口并保持窗口序号连续', () => {
    const emptySource = { id: 2, webContents: { send: vi.fn() } }
    const meaningfulSource = { id: 3, webContents: { send: vi.fn() } }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(target as any)
    windowManager.getAllWindows.mockReturnValue([target, emptySource, meaningfulSource] as any)
    windowManager.listWorkspaces.mockImplementation((windowId: number) => windowId === 2
      ? [{ id: 'empty-source', primaryRoot: '/docs/empty', lifecycleEpoch: 1 }]
      : windowId === 3
        ? [{ id: 'meaningful-source', primaryRoot: '/docs/kept', lifecycleEpoch: 1 }]
        : [])
    windowManager.getActiveWorkspaceId.mockImplementation(((windowId: number) => (
      windowId === 2 ? 'empty-source' : 'meaningful-source'
    )) as any)
    windowManager.getWorkspacePresentation.mockImplementation((_windowId: number, workspaceId: string) => (
      workspaceId === 'empty-source'
        ? { label: '空目录', isEmptyPlaceholder: false, hasMeaningfulState: false, tabCount: 0, activeTabName: null, hasSplit: false, hasDraft: false }
        : workspaceId === 'meaningful-source'
          ? { label: '有效目录', isEmptyPlaceholder: false, hasMeaningfulState: true, tabCount: 1, activeTabName: 'kept.md', hasSplit: false, hasDraft: false }
          : undefined
    ))

    const list = handler<(event: any) => any[]>('workspace:listMergeSources')({ sender: {} })
    expect(list).toEqual([expect.objectContaining({
      windowId: 3,
      title: '窗口 1 · 有效目录',
      workspaceCount: 1,
    })])
  })

  it('只允许 sender 更新属于当前窗口的展示摘要', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(source as any)
    const update = handler<(event: any, payload: any[]) => void>('workspace:updatePresentations')
    const result = update({ sender: {} }, [{
      workspaceId: 'video-a', lifecycleEpoch: 1, label: 'video', isEmptyPlaceholder: false, hasMeaningfulState: true,
      tabCount: 1, activeTabName: 'a.md', tabNames: ['a.md'], hasSplit: false, hasDraft: false,
    }])
    expect(result).toEqual({ applied: true })
    expect(windowManager.setWorkspacePresentations).toHaveBeenCalledWith(2, [expect.objectContaining({
      workspaceId: 'video-a', lifecycleEpoch: 1, label: 'video',
    })])
  })
})
