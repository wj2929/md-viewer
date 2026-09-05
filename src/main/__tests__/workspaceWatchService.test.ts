import { beforeEach, describe, expect, it, vi } from 'vitest'
import chokidar from 'chokidar'
import { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      add: vi.fn(),
      unwatch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      getWatched: vi.fn(() => ({})),
    })),
  },
}))

function listener(watcher: any, event: string): (...args: any[]) => void {
  const found = watcher.on.mock.calls.find(([name]: [string]) => name === event)
  if (!found) throw new Error(`missing listener: ${event}`)
  return found[1]
}

describe('WorkspaceWatchService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('同根 UI 与索引 consumer 共享一个递归 watcher', () => {
    const service = new WorkspaceWatchService()
    const deliver = vi.fn()
    const consume = vi.fn()
    service.attachRoot('/ws/root', {
      key: '1:a', workspaceId: 'a', lifecycleEpoch: 1, primaryRoot: '/ws/root', strict: true, deliver,
    })
    service.attachIndexConsumer('/ws/root', 'index', consume)

    expect(chokidar.watch).toHaveBeenCalledTimes(1)
    expect(chokidar.watch).toHaveBeenCalledWith('/ws/root', expect.not.objectContaining({ depth: expect.anything() }))
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value
    listener(watcher, 'change')('/ws/root/deep/a/b/c.md')

    expect(deliver).toHaveBeenCalledWith('file:changed', expect.objectContaining({ path: '/ws/root/deep/a/b/c.md' }))
    expect(consume).toHaveBeenCalledWith({ kind: 'changed', path: '/ws/root/deep/a/b/c.md' })
  })

  it('只有 UI 与索引 consumer 都 detach 后才关闭物理 watcher', () => {
    const service = new WorkspaceWatchService()
    service.attachRoot('/ws/root', {
      key: '1:a', workspaceId: 'a', lifecycleEpoch: 1, primaryRoot: '/ws/root', strict: true, deliver: vi.fn(),
    })
    service.attachIndexConsumer('/ws/root', 'index', vi.fn())
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value

    service.detachUi('1:a')
    expect(watcher.close).not.toHaveBeenCalled()
    service.detachIndexConsumer('/ws/root', 'index')
    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('rename hint 对 UI 保持单事件，对索引保留 remove + add 原始事实', async () => {
    vi.useFakeTimers()
    try {
      const service = new WorkspaceWatchService()
      const deliver = vi.fn()
      const consume = vi.fn()
      service.attachRoot('/ws/root', {
        key: '1:a', workspaceId: 'a', lifecycleEpoch: 1, primaryRoot: '/ws/root', strict: true, deliver,
      })
      service.attachIndexConsumer('/ws/root', 'index', consume)
      const watcher = vi.mocked(chokidar.watch).mock.results[0].value

      listener(watcher, 'unlink')('/ws/root/old.md')
      listener(watcher, 'add')('/ws/root/new.md')
      await vi.advanceTimersByTimeAsync(600)

      expect(deliver).toHaveBeenCalledWith('file:renamed', expect.objectContaining({
        oldPath: '/ws/root/old.md', newPath: '/ws/root/new.md',
      }))
      expect(consume.mock.calls.map(([delta]) => delta)).toEqual([
        { kind: 'removed', path: '/ws/root/old.md' },
        { kind: 'added', path: '/ws/root/new.md' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
