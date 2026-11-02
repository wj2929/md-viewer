import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceWatchService } from '../watching/WorkspaceWatchService'
import { WatchReconcileSupersededError } from '../../shared/workspaceWatch'

const runtime = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve() },
  utilityProcess: { fork: vi.fn(() => {
    const child = new EventEmitter() as any
    child.postMessage = vi.fn((command: any) => {
      if (command.type === 'ping') queueMicrotask(() => child.emit('message', { ...command, type: 'pong' }))
      if (command.type === 'barrier') queueMicrotask(() => child.emit('message', { ...command, type: 'barrier', sequence: 0 }))
    })
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true })
    runtime.children.push(child)
    return child
  }) },
}))
let service: WorkspaceWatchService
beforeEach(() => { vi.useFakeTimers(); runtime.children.length = 0; service = new WorkspaceWatchService() })
afterEach(async () => { await service.shutdown(); vi.useRealTimers() })
function subscription(key = '1:a', epoch = 1, deliver = vi.fn()) {
  return { key, workspaceId: key.split(':')[1], lifecycleEpoch: epoch, primaryRoot: '/ws/root', strict: true, deliver }
}
async function childAndWatch(): Promise<{ child: any; create: any }> {
  await vi.advanceTimersByTimeAsync(0)
  const child = runtime.children.at(-1)
  child.emit('spawn')
  return { child, create: child.postMessage.mock.calls.find(([m]: any[]) => m.type === 'create')[0] }
}
function events(child: any, create: any, values: Array<{ kind: string; path: string; observedAt: number }>) {
  child.emit('message', { ...create, type: 'events', events: values.map((value, i) => ({ ...value, sequence: i + 1 })) })
}

describe('WorkspaceWatchService', () => {
  it('reports only the requesting subscriber root and opened-file selections', async () => {
    service.attachRoot('/ws/root', subscription())
    await childAndWatch()
    service.watchOpenedFile('/ws/outside-a.md', subscription())
    service.watchOpenedFile('/ws/outside-b.md', subscription('2:b'))
    const observe = vi.fn()
    service.retry('1:a', observe)
    expect(observe.mock.calls[0][0]).toEqual({ watchRetryStage: 'subscriptions-selected', watchSelectedCount: 2,
      watchRootSelected: true, watchOpenedSelectedCount: 1 })
    expect(observe.mock.calls[1][0]).toMatchObject({ watchRetryStage: 'restart-requested', watchSelectedCount: 2 })
    expect(JSON.stringify(observe.mock.calls)).not.toContain('/ws/')
    expect(JSON.stringify(observe.mock.calls)).not.toContain('1:a')
  })

  it('reports zero UI subscriptions even when an index-only root exists', () => {
    service.attachIndexConsumer('/ws/root', 'index-only', vi.fn())
    const observe = vi.fn()
    service.retry('1:a', observe)
    expect(observe.mock.calls.map(([row]) => row.watchRetryStage)).toEqual(['subscriptions-selected', 'host-skipped'])
    expect(observe.mock.calls[0][0]).toMatchObject({ watchSelectedCount: 0, watchRootSelected: false, watchOpenedSelectedCount: 0 })
    expect(observe.mock.calls[1][0].watchRetryReason).toBe('no-subscriptions')
  })

  it('65秒慢启动只有 ready 加补查屏障及 drain 完成后才恢复 UI 与索引覆盖', async () => {
    let finish!: () => void
    const reconcile = vi.fn().mockImplementation((phase: string) => phase === 'refresh'
      ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve())
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    service.attachIndexConsumer('/ws/root', 'index', vi.fn())
    service.setIndexReconciler(vi.fn().mockResolvedValue(undefined))
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(65000)
    expect(service.getHealth('1:a')).toMatchObject({ state: 'degraded', reason: 'timeout' })
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth('1:a').state).toBe('recovering')
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    expect(reconcile).toHaveBeenCalledWith('refresh')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(reconcile).toHaveBeenCalledWith('drain')
    expect(service.getHealth('1:a').state).toBe('healthy')
    expect(service.getIndexCoverage('/ws/root').complete).toBe(true)
  })

  it('index-only coverage 不依赖 UI key；协调、挂起及断连均撤销健康状态', async () => {
    const phases: string[] = []
    service.setIndexReconciler(async (_root, phase) => {
      phases.push(phase)
      expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    })
    expect(service.getIndexCoverage('/ws/root')).toEqual({ token: 'detached', complete: false })
    expect(runtime.children).toHaveLength(0)
    service.attachIndexConsumer('/ws/root', 'index-only', vi.fn())
    const { child, create } = await childAndWatch()
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const healthy = service.getIndexCoverage('/ws/root')
    expect(healthy.complete).toBe(true)
    expect(phases).toContain('refresh')
    expect(phases).toContain('drain')
    service.attachIndexConsumer('/ws/other', 'other', vi.fn())
    expect(service.getIndexCoverage('/ws/root')).toEqual(healthy)
    service.detachIndexConsumer('/ws/other', 'other')
    service.suspend()
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    service.resume()
    expect(service.getIndexCoverage('/ws/root').complete).toBe(true)
    expect(service.getIndexCoverage('/ws/root').token).not.toBe(healthy.token)
    child.emit('exit', 1)
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
    service.detachIndexConsumer('/ws/root', 'index-only')
    expect(service.getIndexCoverage('/ws/root')).toEqual({ token: 'detached', complete: false })
  })
  it('同根 UI 与索引 consumer 共享一个递归 watcher', async () => {
    const sub = subscription()
    const consume = vi.fn()
    service.attachRoot('/ws/root', sub)
    service.attachIndexConsumer('/ws/root', 'index', consume)
    const { child, create } = await childAndWatch()
    expect(child.postMessage.mock.calls.filter(([m]: any[]) => m.type === 'create')).toHaveLength(1)
    events(child, create, [{ kind: 'change', path: 'deep/a/b/c.md', observedAt: 1 }])
    expect(sub.deliver).toHaveBeenCalledWith('file:changed', expect.objectContaining({ path: '/ws/root/deep/a/b/c.md' }))
    expect(consume).toHaveBeenCalledWith({ kind: 'changed', path: '/ws/root/deep/a/b/c.md' })
  })

  it('只有 UI 与索引 consumer 都 detach 后才关闭物理 watcher', async () => {
    service.attachRoot('/ws/root', subscription())
    service.attachIndexConsumer('/ws/root', 'index', vi.fn())
    const { child } = await childAndWatch()
    service.detachUi('1:a')
    expect(child.kill).not.toHaveBeenCalled()
    service.detachIndexConsumer('/ws/root', 'index')
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('rename hint 对 UI 保持单事件，对索引保留 remove + add 原始事实', async () => {
    const sub = subscription()
    const consume = vi.fn()
    service.attachRoot('/ws/root', sub)
    service.attachIndexConsumer('/ws/root', 'index', consume)
    const { child, create } = await childAndWatch()
    events(child, create, [{ kind: 'unlink', path: 'old.md', observedAt: 10 }, { kind: 'add', path: 'new.md', observedAt: 210 }])
    await vi.advanceTimersByTimeAsync(600)
    expect(sub.deliver.mock.calls).toHaveLength(1)
    expect(sub.deliver).toHaveBeenCalledWith('file:renamed', expect.objectContaining({ oldPath: '/ws/root/old.md', newPath: '/ws/root/new.md' }))
    expect(consume.mock.calls.map(([delta]) => delta)).toEqual([
      { kind: 'removed', path: '/ws/root/old.md' }, { kind: 'added', path: '/ws/root/new.md' },
    ])
  })

  it('同一批到达但源时间相隔数秒的 unlink/add 不能猜成 rename', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const { child, create } = await childAndWatch()
    events(child, create, [{ kind: 'unlink', path: 'old.md', observedAt: 10 }, { kind: 'add', path: 'new.md', observedAt: 3010 }])
    await vi.advanceTimersByTimeAsync(600)
    expect(sub.deliver.mock.calls.map(([channel]) => channel)).toEqual(['file:added', 'file:removed'])
  })

  it('历史查询增加索引 consumer 不触发文件树补查反馈循环', async () => {
    const reconcile = vi.fn().mockResolvedValue(undefined)
    service.setIndexReconciler(vi.fn().mockResolvedValue(undefined))
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    service.attachIndexConsumer('/ws/root', 'workspace', vi.fn())
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const gap = service.getHealth('1:a').gapVersion
    reconcile.mockClear()
    for (let i = 0; i < 5; i++) {
      service.attachIndexConsumer('/ws/root', `history:${i}`, vi.fn())
      service.detachIndexConsumer('/ws/root', `history:${i}`)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(reconcile).not.toHaveBeenCalled()
    expect(service.getHealth('1:a')).toMatchObject({ state: 'healthy', gapVersion: gap })
  })

  it('生成目录不算根监听覆盖；打开文件共享精确补充监听', async () => {
    service.attachRoot('/ws/root', subscription())
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: ['bin'], directories: 1, entries: 1 })
    expect(service.hasRootSubscription('1:a', '/ws/root/bin/manual.md')).toBe(false)
    expect(service.hasRootSubscription('1:a', '/ws/root/docs/a.md')).toBe(true)
    service.watchOpenedFile('/ws/root/docs/a.md', subscription())
    expect(service.getOpenedFileCount('1:a')).toBe(0)
    service.watchOpenedFile('/ws/root/bin/manual.md', subscription())
    service.watchOpenedFile('/ws/root/bin/manual.md', subscription('2:b'))
    expect(service.getOpenedFileCount('1:a')).toBe(1)
    expect(service.getOpenedFileCount('2:b')).toBe(1)
    expect(child.postMessage.mock.calls.filter(([m]: any[]) => m.type === 'create' && m.kind === 'file')).toHaveLength(1)
  })

  it('旧 epoch 的 cleanup 不撤销新订阅', async () => {
    service.attachRoot('/ws/root', subscription('1:a', 2))
    const { child } = await childAndWatch()
    service.cleanupWebContents(1, 'a', 1)
    expect(child.kill).not.toHaveBeenCalled()
    service.cleanupWebContents(1, 'a', 2)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('新进程不继承正常切换前旧代补查额度', async () => {
    service.attachRoot('/ws/root', subscription())
    let { child, create } = await childAndWatch()
    const ready = () => child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    ready()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 2; i++) {
      service.reportGap('1:a')
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(service.getHealth('1:a').state).toBe('healthy')
    child.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2100)
    ;({ child, create } = await childAndWatch())
    ready()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth('1:a').state).toBe('healthy')
  })

  it('缺口清理 rename 候选前已向索引交付删除事实', async () => {
    const consume = vi.fn()
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    service.attachIndexConsumer('/ws/root', 'index', consume)
    const { child, create } = await childAndWatch()
    events(child, create, [{ kind: 'unlink', path: 'removed.md', observedAt: 1 }])
    expect(consume).toHaveBeenCalledWith({ kind: 'removed', path: '/ws/root/removed.md' })
    expect(sub.deliver).not.toHaveBeenCalled()
    service.reportGap('1:a')
    await vi.advanceTimersByTimeAsync(600)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('连续三轮 superseded 不消耗实际失败额度，成功后新恢复不继承旧额度', async () => {
    let attempts = 0
    const reconcile = vi.fn(async (phase: string) => {
      if (phase === 'refresh' && ++attempts <= 3) throw new WatchReconcileSupersededError()
    })
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(service.getHealth('1:a').state).toBe('recovering')
    await vi.advanceTimersByTimeAsync(1000)
    expect(attempts).toBe(4)
    expect(service.getHealth('1:a').state).toBe('healthy')
    for (let i = 0; i < 3; i++) {
      service.reportGap('1:a')
      await vi.advanceTimersByTimeAsync(0)
      expect(service.getHealth('1:a').state).toBe('healthy')
    }
  })

  it('一个恢复过程内三次实际失败才降级', async () => {
    const reconcile = vi.fn().mockRejectedValue(new Error('injected read failure'))
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(1999)
    expect(service.getHealth('1:a').state).toBe('recovering')
    await vi.advanceTimersByTimeAsync(1)
    expect(reconcile).toHaveBeenCalledTimes(3)
    expect(service.getHealth('1:a')).toMatchObject({ state: 'degraded', reason: 'reconcile' })
  })

  it('恢复总期限可终止永不完成的补查，迟到成功不得洗白', async () => {
    let finish!: () => void
    const reconcile = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(29000)
    expect(service.getHealth('1:a').state).toBe('recovering')
    await vi.advanceTimersByTimeAsync(1000)
    expect(service.getHealth('1:a')).toMatchObject({ state: 'degraded', reason: 'reconcile' })
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth('1:a').state).toBe('degraded')
  })

  it('不断被取代的扫描不能重置恢复总期限', async () => {
    const reconcile = vi.fn().mockRejectedValue(new WatchReconcileSupersededError())
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(29000)
    expect(service.getHealth('1:a').state).toBe('recovering')
    await vi.advanceTimersByTimeAsync(1000)
    expect(service.getHealth('1:a').state).toBe('degraded')
    expect(reconcile.mock.calls.length).toBeLessThanOrEqual(30)
  })

  it('休眠不占恢复总期限，恢复后给予在途工作处理机会', async () => {
    let finish!: () => void
    const reconcile = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(28000)
    service.suspend()
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.getHealth('1:a').state).toBe('recovering')
    service.resume()
    await vi.advanceTimersByTimeAsync(4000)
    expect(service.getHealth('1:a').state).toBe('recovering')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth('1:a').state).toBe('healthy')
  })

  it('补查中二次缺口保留后续补查，不能提前恢复健康', async () => {
    let finish!: () => void
    const reconcile = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
    service.attachRoot('/ws/root', { ...subscription(), reconcile })
    const { child, create } = await childAndWatch()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(0)
    child.emit('message', { ...create, type: 'gap', gapId: 1 })
    expect(service.getHealth('1:a').state).toBe('recovering')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth('1:a').state).toBe('recovering')
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconcile.mock.calls.filter(([phase]) => phase === 'refresh')).toHaveLength(2)
    expect(service.getHealth('1:a').state).toBe('healthy')
  })
})
