import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerWorkspaceIndexHandlers } from '../ipc/workspaceIndexHandlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) },
}))

const OPERATION = { workspaceId: 'workspace-a', lifecycleEpoch: 3 }
const workspaceIndexService = {
  attach: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn(() => ({ state: 'ready', indexedDocuments: 2 })),
  subscribeStatus: vi.fn(),
  unsubscribeStatus: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  waitUntilIdle: vi.fn().mockResolvedValue(undefined),
  detach: vi.fn(),
  getBacklinks: vi.fn(() => []),
  rebuild: vi.fn().mockResolvedValue({ state: 'ready' }),
}
const ctx = {
  workspaceIndexService,
  windowManager: {
    getWorkspace: vi.fn(() => ({ id: 'workspace-a', lifecycleEpoch: 3, primaryRoot: '/ws/root' })),
  },
  folderHistoryManager: {
    resolveHistoryFolder: vi.fn(async (id: string) => id === 'history-a' ? '/history/root' : null),
    findContainingFolder: vi.fn(async () => null),
  },
  appDataManager: {
    getRecentFile: vi.fn(() => null),
  },
}

function handler(channel: string): (...args: any[]) => any {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!found) throw new Error(`missing handler: ${channel}`)
  return found[1] as (...args: any[]) => any
}

describe('workspace index IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerWorkspaceIndexHandlers(ctx as any)
  })

  it('每个请求从 sender workspace/epoch 解析 root', async () => {
    await handler('workspace-index:getStatus')({ sender: { id: 9 } }, OPERATION)
    expect(workspaceIndexService.attach).toHaveBeenCalledWith('/ws/root', 'workspace:9:workspace-a')
    expect(workspaceIndexService.getStatus).toHaveBeenCalledWith('/ws/root')
  })

  it('索引状态订阅绑定 sender 并拒绝跨窗口取消', async () => {
    const sender = {
      id: 9,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    }
    const subscriptionId = await handler('workspace-index:subscribeStatus')({ sender }, OPERATION)
    expect(subscriptionId).toEqual(expect.any(String))
    expect(workspaceIndexService.subscribeStatus).toHaveBeenCalledWith(
      '/ws/root',
      expect.stringContaining(`status:9:${subscriptionId}`),
      expect.any(Function),
    )

    expect(() => handler('workspace-index:unsubscribeStatus')({ sender: { id: 10 } }, subscriptionId))
      .toThrow('索引订阅无效')
    await handler('workspace-index:unsubscribeStatus')({ sender }, subscriptionId)
    expect(workspaceIndexService.unsubscribeStatus).toHaveBeenCalledWith(
      '/ws/root',
      expect.stringContaining(`status:9:${subscriptionId}`),
    )
  })

  it('同一 sender 反复订阅只绑定一个 destroyed 清理监听器', async () => {
    const sender = {
      id: 9,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    }
    const subscribe = handler('workspace-index:subscribeStatus')
    const unsubscribe = handler('workspace-index:unsubscribeStatus')

    const firstId = await subscribe({ sender }, OPERATION)
    await unsubscribe({ sender }, firstId)
    const secondId = await subscribe({ sender }, OPERATION)

    expect(sender.once).toHaveBeenCalledTimes(1)
    expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))

    const onDestroyed = sender.once.mock.calls[0][1]
    onDestroyed()
    expect(workspaceIndexService.unsubscribeStatus).toHaveBeenCalledWith(
      '/ws/root',
      expect.stringContaining(`status:9:${secondId}`),
    )
  })

  it('全部记录只接受有界 opaque history ids 并在查询后释放临时 consumer', async () => {
    workspaceIndexService.query.mockResolvedValueOnce([{
      relativePath: 'doc.md', displayName: 'doc.md', score: 2, lineStart: 1, snippet: 'hit', revisionToken: 'revision',
    }])
    const result = await handler('workspace-index:queryHistory')(
      { sender: { id: 9 } }, OPERATION, 'hit', ['history-a', 'missing'], [], 20,
    )

    expect(ctx.folderHistoryManager.resolveHistoryFolder).toHaveBeenCalledWith('history-a')
    expect(workspaceIndexService.attach).toHaveBeenCalledWith('/history/root', 'history-query:9:history-a')
    expect(workspaceIndexService.detach).toHaveBeenCalledWith('/history/root', 'history-query:9:history-a')
    expect(result).toEqual([expect.objectContaining({ historyId: 'history-a', filePath: '/history/root/doc.md' })])

    await expect(handler('workspace-index:queryHistory')(
      { sender: { id: 9 } }, OPERATION, 'hit', Array.from({ length: 11 }, (_, index) => `history-${index}`), [], 20,
    )).rejects.toThrow('历史记录标识无效')
  })

  it('最近文件索引结果保留 recentFileId 而不冒充文件夹 historyId', async () => {
    ctx.appDataManager.getRecentFile.mockReturnValue({
      id: 'recent-a',
      name: 'recent.md',
      path: '/history/root/docs/recent.md',
    } as any)
    ctx.folderHistoryManager.findContainingFolder.mockResolvedValue('/history/root' as any)
    workspaceIndexService.query.mockResolvedValueOnce([{
      relativePath: 'docs/recent.md', displayName: 'recent.md', score: 3, lineStart: 2, snippet: 'hit', revisionToken: 'revision',
    }])

    const result = await handler('workspace-index:queryHistory')(
      { sender: { id: 9 } }, OPERATION, 'hit', [], ['recent-a'], 20,
    )

    expect(result).toEqual([expect.objectContaining({
      recentFileId: 'recent-a',
      filePath: '/history/root/docs/recent.md',
    })])
    expect(result[0]).not.toHaveProperty('historyId')
  })

  it('拒绝旧 epoch 和逃逸相对路径', async () => {
    await expect(handler('workspace-index:getStatus')({ sender: {} }, {
      workspaceId: 'workspace-a', lifecycleEpoch: 2,
    })).rejects.toThrow('工作区已失效')
    await expect(handler('workspace-index:getBacklinks')({ sender: {} }, OPERATION, '../outside.md'))
      .rejects.toThrow('相对路径无效')
  })
})
