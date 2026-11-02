import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatchProcessHost } from '../watching/WatchProcessHost'
import { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

const runtime = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve() },
  utilityProcess: { fork: vi.fn(() => {
    const child = new EventEmitter() as any
    child.postMessage = vi.fn((message: any) => {
      if (message.type === 'ping') queueMicrotask(() => child.emit('message', { ...message, type: 'pong' }))
      if (message.type === 'barrier') queueMicrotask(() => child.emit('message', { ...message, type: 'barrier', sequence: 0 }))
    })
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true })
    runtime.children.push(child)
    return child
  }) },
}))

let host: WatchProcessHost
let service: WorkspaceWatchService
const subscription = (key = '1:a', root = '/ws/root', epoch = 1) => ({
  key, workspaceId: key.split(':')[1], lifecycleEpoch: epoch, primaryRoot: root, strict: true,
  deliver: vi.fn(), isCurrent: vi.fn(() => true), reconcile: vi.fn().mockResolvedValue(undefined),
})
async function spawn() {
  await vi.advanceTimersByTimeAsync(0)
  const child = runtime.children.at(-1)
  child.emit('spawn')
  return child
}
const commands = (child: any, type = 'create') => child.postMessage.mock.calls.map(([m]: any[]) => m).filter((m: any) => m.type === type)
const ready = (child: any, create: any) => child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })

beforeEach(() => {
  vi.useFakeTimers()
  runtime.children.length = 0
  host = new WatchProcessHost()
  service = new WorkspaceWatchService(host)
})
afterEach(async () => { await service.shutdown(); vi.useRealTimers() })

describe('successful authorized access recovery', () => {
  it('restarts a timed-out subscription once after its original delayed read succeeds', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const accessed = service.captureAccess(sub)
    const child = await spawn()
    await vi.advanceTimersByTimeAsync(30000)
    expect(service.getHealth(sub.key)).toMatchObject({ state: 'degraded', reason: 'timeout' })
    expect(child.kill).toHaveBeenCalledTimes(1)
    accessed('/ws/root/a.md')
    accessed('/ws/root/b.md')
    const next = await spawn()
    expect(runtime.children).toHaveLength(2)
    expect(commands(next)).toHaveLength(1)
    ready(next, commands(next)[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth(sub.key).state).toBe('healthy')
    expect(sub.reconcile.mock.calls.map(([phase]) => phase)).toEqual(['refresh', 'drain'])
  })

  it('coalesces successful access to two failed roots while a shared process stops', async () => {
    const a = subscription(), b = subscription('2:b', '/ws/other')
    service.attachRoot('/ws/root', a)
    service.attachRoot('/ws/other', b)
    const child = await spawn()
    const accessA = service.captureAccess(a), accessB = service.captureAccess(b)
    await vi.advanceTimersByTimeAsync(30000)
    accessA('/ws/root/a.md')
    accessB('/ws/other/b.md')
    const next = await spawn()
    expect(runtime.children).toHaveLength(2)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(commands(next).map((m: any) => m.path).sort()).toEqual(['/ws/other', '/ws/root'])
  })

  it('does not unlock another failed root or replay once per loaded tab', async () => {
    const sub = subscription(), other = subscription('2:b', '/ws/other')
    service.attachRoot('/ws/root', sub)
    service.attachRoot('/ws/other', other)
    await spawn()
    const reads = Array.from({ length: 30 }, () => service.captureAccess(sub))
    await vi.advanceTimersByTimeAsync(30000)
    reads.forEach((accessed, i) => accessed(`/ws/root/tab-${i}.md`))
    const next = await spawn()
    expect(commands(next).map((m: any) => m.path)).toEqual(['/ws/root'])
    expect(service.getHealth(other.key)).toMatchObject({ state: 'degraded', reason: 'timeout' })
    await vi.advanceTimersByTimeAsync(30000)
    for (let i = 0; i < 10; i++) service.captureAccess(sub)('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(300000)
    expect(runtime.children).toHaveLength(2)
    expect(service.getHealth(sub.key).state).toBe('degraded')
  })

  it('retains the 120-second continuation and uses early access proof only if it expires', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const child = await spawn(), create = commands(child)[0]
    const accessed = service.captureAccess(sub)
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(35000)
    accessed('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(84999)
    expect(child.kill).not.toHaveBeenCalled()
    expect(runtime.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const next = await spawn()
    expect(runtime.children).toHaveLength(2)
    ready(next, commands(next)[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth(sub.key).state).toBe('healthy')
  })

  it('does not restart a slow continuation that subsequently becomes healthy', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const child = await spawn(), create = commands(child)[0]
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(35000)
    service.captureAccess(sub)('/ws/root/a.md')
    ready(child, create)
    await vi.advanceTimersByTimeAsync(150000)
    expect(service.getHealth(sub.key).state).toBe('healthy')
    expect(child.kill).not.toHaveBeenCalled()
    expect(runtime.children).toHaveLength(1)
  })

  it.each(['EMFILE', 'ENOSPC', 'OVERFLOW', 'ENOENT', 'UNKNOWN'])('does not unlock %s on a readable file', async code => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const child = await spawn(), create = commands(child)[0]
    const accessed = service.captureAccess(sub)
    child.emit('message', { ...create, type: 'error', code })
    await vi.advanceTimersByTimeAsync(3000)
    accessed('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(300000)
    expect(service.getHealth(sub.key).state).toBe('degraded')
    expect(runtime.children).toHaveLength(1)
  })

  it('revokes pending access proof when the continued watcher reports resource exhaustion', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const child = await spawn(), create = commands(child)[0]
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(35000)
    service.captureAccess(sub)('/ws/root/a.md')
    child.emit('message', { ...create, type: 'error', code: 'EMFILE' })
    await vi.advanceTimersByTimeAsync(300000)
    expect(runtime.children).toHaveLength(1)
    expect(service.getHealth(sub.key).state).toBe('degraded')
  })

  it.each(['detach', 'epoch', 'root', 'current', 'shutdown'])('ignores delayed access after %s invalidation', async change => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    await spawn()
    const accessed = service.captureAccess(sub)
    await vi.advanceTimersByTimeAsync(30000)
    if (change === 'detach') service.detachUi(sub.key)
    if (change === 'epoch') service.attachRoot('/ws/root', subscription(sub.key, '/ws/root', 2))
    if (change === 'root') service.attachRoot('/ws/new', subscription(sub.key, '/ws/new', 2))
    if (change === 'current') sub.isCurrent.mockReturnValue(false)
    if (change === 'shutdown') await service.shutdown()
    const count = runtime.children.length
    accessed('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(0)
    if (change === 'epoch' || change === 'root') {
      const next = runtime.children.at(-1)
      next.emit('spawn')
      expect(commands(next).map((m: any) => m.path)).toEqual([change === 'root' ? '/ws/new' : '/ws/root'])
    } else expect(runtime.children).toHaveLength(count)
  })

  it('does not use an unrelated authorized root or an ignored subtree as proof', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    await spawn()
    const accessed = service.captureAccess(sub)
    await vi.advanceTimersByTimeAsync(30000)
    accessed('/ws/root-other/a.md')
    accessed('/ws/root/node_modules/a.md')
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.children).toHaveLength(1)
    expect(service.getHealth(sub.key).state).toBe('degraded')
  })

  it.each(['detach', 'current'])('revokes queued slow-start proof after %s, including an index-owned root', async change => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    service.attachIndexConsumer('/ws/root', 'index', vi.fn())
    const child = await spawn(), create = commands(child)[0]
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(35000)
    service.captureAccess(sub)('/ws/root/a.md')
    if (change === 'detach') service.detachUi(sub.key)
    else sub.isCurrent.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(300000)
    expect(runtime.children).toHaveLength(1)
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
  })

  it('preserves the two-second start cooldown and defers proof during suspend', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    const child = await spawn(), create = commands(child)[0]
    child.emit('message', { ...create, type: 'error', code: 'EPERM' })
    service.suspend()
    service.captureAccess(sub)('/ws/root/a.md')
    expect(child.kill).not.toHaveBeenCalled()
    service.resume()
    await vi.advanceTimersByTimeAsync(1999)
    expect(runtime.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(runtime.children).toHaveLength(2)
  })

  it('rechecks a queued proof before native creation if its UI owner disappears during cooldown', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    service.attachIndexConsumer('/ws/root', 'index', vi.fn())
    const child = await spawn(), create = commands(child)[0]
    child.emit('message', { ...create, type: 'error', code: 'EACCES' })
    service.captureAccess(sub)('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(0)
    service.detachUi(sub.key)
    await vi.advanceTimersByTimeAsync(2000)
    const next = await spawn()
    expect(commands(next)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getIndexCoverage('/ws/root').complete).toBe(false)
  })

  it('does not let an old read revive a newer failed generation after manual retry', async () => {
    const sub = subscription()
    service.attachRoot('/ws/root', sub)
    await spawn()
    const accessed = service.captureAccess(sub)
    await vi.advanceTimersByTimeAsync(30000)
    service.retry(sub.key)
    const next = await spawn()
    const create = commands(next)[0]
    next.emit('message', { ...create, type: 'error', code: 'EACCES' })
    accessed('/ws/root/a.md')
    await vi.advanceTimersByTimeAsync(10000)
    expect(runtime.children).toHaveLength(2)
    expect(service.getHealth(sub.key).state).toBe('degraded')
  })

  it('adds a recovered old-generation root to a live newer child without recycling its healthy root', async () => {
    const a = subscription(), b = subscription('2:b', '/ws/other')
    service.attachRoot('/ws/root', a)
    service.attachRoot('/ws/other', b)
    await spawn()
    const accessed = service.captureAccess(b)
    await vi.advanceTimersByTimeAsync(30000)
    service.captureAccess(a)('/ws/root/a.md')
    const next = await spawn()
    ready(next, commands(next)[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth(a.key).state).toBe('healthy')
    accessed('/ws/other/b.md')
    expect(next.kill).not.toHaveBeenCalled()
    expect(commands(next).map((m: any) => m.path)).toEqual(['/ws/root', '/ws/other'])
    ready(next, commands(next)[1])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth(b.key).state).toBe('healthy')
  })

  it('recovers a standalone opened file only on an exact current-file access', async () => {
    const sub = subscription()
    service.watchOpenedFile('/ws/external.md', sub)
    const child = await spawn(), create = commands(child)[0]
    const accessed = service.captureAccess(sub)
    child.emit('message', { ...create, type: 'error', code: 'EACCES' })
    accessed('/ws/neighbor.md')
    expect(child.kill).not.toHaveBeenCalled()
    accessed('/ws/external.md')
    await vi.advanceTimersByTimeAsync(2000)
    const next = await spawn()
    expect(commands(next)).toEqual([expect.objectContaining({ path: '/ws/external.md', kind: 'file' })])
    ready(next, commands(next)[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getHealth(sub.key).state).toBe('healthy')
  })
})
