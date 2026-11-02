import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatchProcessHost } from '../watching/WatchProcessHost'

const runtime = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve() },
  utilityProcess: { fork: vi.fn(() => {
    const child = new EventEmitter() as any
    child.postMessage = vi.fn()
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true })
    runtime.children.push(child)
    return child
  }) },
}))

let host: WatchProcessHost
async function spawned(): Promise<any> {
  await vi.advanceTimersByTimeAsync(0)
  const child = runtime.children.at(-1)
  child.emit('spawn')
  return child
}
function reply(child: any, type: string, extra = {}): void {
  const create = child.postMessage.mock.calls.find(([m]: any[]) => m.type === 'create')[0]
  child.emit('message', { ...create, type, ...extra })
}

beforeEach(() => { vi.useFakeTimers(); runtime.children.length = 0; host = new WatchProcessHost() })
afterEach(async () => { await host.shutdown(); vi.useRealTimers() })

describe('watch process supervision', () => {
  it('reports an empty selection without starting a process', () => {
    const observe = vi.fn()
    host.retry([], observe)
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ watchRetryStage: 'host-skipped', watchRetryReason: 'no-subscriptions', watchSelectedCount: 0 }))
    expect(runtime.children).toHaveLength(0)
  })

  it('reports shutdown and stopping separately without resetting failed watches', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    await spawned()
    host.fail(watch, 'permission')
    const observe = vi.fn()
    host.retry([watch], observe)
    host.fail(watch, 'permission')
    host.retry([watch], observe)
    expect(observe.mock.calls.at(-1)?.[0]).toMatchObject({ watchRetryStage: 'host-skipped', watchRetryReason: 'stopping' })
    expect(watch.failed).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    await host.shutdown()
    host.retry([watch], observe)
    expect(observe.mock.calls.at(-1)?.[0]).toMatchObject({ watchRetryStage: 'host-skipped', watchRetryReason: 'shutting-down' })
    expect(watch.failed).toBe(true)
  })

  it('records a restart request with no child and preserves the existing retry cooldown', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'error', { code: 'EMFILE' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(child.kill).toHaveBeenCalledTimes(1)
    const observe = vi.fn()
    host.retry([watch], observe)
    expect(observe.mock.calls[0][0]).toMatchObject({ watchRetryStage: 'restart-requested', watchProcessPresent: false,
      watchSelectedCount: 1, watchCapacitySkippedCount: 0, watchRetryEligibleCount: 1 })
    const next = await spawned()
    reply(next, 'error', { code: 'EMFILE' })
    await vi.advanceTimersByTimeAsync(0)
    host.retry([watch], observe)
    expect(observe.mock.calls.at(-1)?.[0]).toMatchObject({ watchRetryStage: 'host-skipped', watchRetryReason: 'cooldown' })
    expect(watch.failed).toBe(true)
    expect(runtime.children).toHaveLength(2)
  })

  it('reports capacity-skipped selections without granting an untracked watch', () => {
    const callbacks = { event: vi.fn(), change: vi.fn() }
    Array.from({ length: 512 }, (_, i) => host.add(`/ws/${i}`, 'root', callbacks))
    const rejected = host.add('/ws/overflow', 'root', callbacks)
    const observe = vi.fn()
    host.retry([rejected], observe)
    expect(observe.mock.calls[0][0]).toMatchObject({ watchRetryStage: 'restart-requested', watchCapacitySkippedCount: 1 })
    expect(rejected.failed).toBe(true)
    expect(host.health(rejected).reason).toBe('overflow')
  })

  it('records accepted and current-generation startup stages, then ready and reconciled health', async () => {
    const diagnostics = vi.fn()
    host.setDiagnostics(diagnostics)
    const watch = host.add('/ws/private-root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'create-sent', acceptedMs: null })
    await vi.advanceTimersByTimeAsync(25)
    reply(child, 'accepted')
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'accepted', acceptedMs: 25 })
    const progress = { stage: 'watch-created', elapsedMs: 20, pathChecks: 3, directoryChecks: 1 }
    reply(child, 'startup-progress', progress)
    const count = diagnostics.mock.calls.length
    reply(child, 'startup-progress', { ...progress, watchGeneration: 99 })
    reply(child, 'startup-progress', { ...progress, processGeneration: 99 })
    reply(child, 'startup-progress', { ...progress, elapsedMs: 19 })
    expect(diagnostics).toHaveBeenCalledTimes(count)
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 3 })
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'ready', state: 'recovering' })
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'ready', state: 'healthy' })
    reply(child, 'startup-progress', { ...progress, elapsedMs: 30 })
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'ready', state: 'healthy' })
  })

  it('samples a slow startup and degrades at 30 seconds while retaining one bounded continuation', async () => {
    const diagnostics = vi.fn()
    host.setDiagnostics(diagnostics)
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 0, pathChecks: 0, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(29999)
    expect(watch.failed).toBe(false)
    expect(diagnostics.mock.calls.filter(call => call[0] === 'summary').length).toBeLessThanOrEqual(8)
    await vi.advanceTimersByTimeAsync(1)
    expect(host.health(watch)).toMatchObject({ state: 'degraded', reason: 'timeout' })
    const terminal = diagnostics.mock.calls.find(call => call[0] === 'terminal' && call[3].watchReason === 'timeout')
    expect(terminal?.[3]).toMatchObject({ watchStage: 'watch-created', stageAgeMs: 30000,
      lastPongAgeMs: 0, startupElapsedMs: 30000, acceptedMs: 0, watchPathChecks: 0 })
    await vi.advanceTimersByTimeAsync(6000)
    expect(runtime.children).toHaveLength(1)
    expect(child.kill).not.toHaveBeenCalled()
    expect(watch.startupRecoveryPending).toBe(true)
    expect(diagnostics.mock.calls.some(call => call[1] === 'watch_process_1')).toBe(false)
  })

  it('records heartbeat absence separately from startup progress before bounded process recovery', async () => {
    const diagnostics = vi.fn()
    host.setDiagnostics(diagnostics)
    host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'startup-progress', { stage: 'path-check-start', elapsedMs: 0, pathChecks: 0, directoryChecks: 0 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(diagnostics.mock.calls.some(call => call[0] === 'summary' &&
      call[3].watchStage === 'path-check-start' && call[3].lastPongAgeMs === 5000)).toBe(true)
    expect(host.automaticRecoveryCount).toBe(1)
    expect(diagnostics.mock.calls.some(call => call[1] === 'watch_process_1' && call[3].recycleReason === 'abnormal')).toBe(true)
  })

  it('retains the last startup stage and safe native error across late ready/progress', async () => {
    const diagnostics = vi.fn()
    host.setDiagnostics(diagnostics)
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'startup-progress', { stage: 'path-check-start', elapsedMs: 0, pathChecks: 0, directoryChecks: 0 })
    reply(child, 'error', { code: 'EACCES' })
    expect(diagnostics.mock.calls.at(-1)?.[3]).toMatchObject({ watchStage: 'path-check-start', watchErrorCode: 'EACCES', state: 'degraded' })
    const count = diagnostics.mock.calls.length
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 5, pathChecks: 1, directoryChecks: 1 })
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    expect(diagnostics).toHaveBeenCalledTimes(count)
    expect(host.health(watch).state).toBe('degraded')
  })

  it('continues one responsive created watcher through a 65-second startup, then requires reconciliation', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(65000)
    expect(watch).toMatchObject({ failed: true, reason: 'timeout', startupRecoveryPending: true })
    expect(child.kill).not.toHaveBeenCalled()
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    expect(host.health(watch).state).toBe('recovering')
    expect(watch.generation).toBe(1)
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(host.health(watch).state).toBe('healthy')
    expect(host.automaticRecoveryCount).toBe(0)
    expect(runtime.children).toHaveLength(1)
  })

  it.each(['EACCES', 'EPERM', 'EMFILE', 'ENOSPC', 'OVERFLOW', 'ENOENT', 'UNKNOWN'])('locks %s received during slow-start continuation against late ready', async code => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(35000)
    expect(watch).toMatchObject({ startupRecoveryPending: true })
    reply(child, 'error', { code })
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    expect(host.health(watch)).toMatchObject({ state: 'degraded', reason:
      ['EACCES', 'EPERM'].includes(code) ? 'permission' : ['EMFILE', 'ENOSPC', 'OVERFLOW'].includes(code) ? 'resource' : 'process' })
    expect(watch).toMatchObject({ startupRecoveryPending: false })
    expect(watch.errorCode).toBe(code)
  })

  it('bounds slow startup to 120 seconds without replay; manual retry can still establish a new generation', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(119999)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(20000)
    expect(host.health(watch)).toMatchObject({ state: 'degraded', reason: 'timeout' })
    expect(watch).toMatchObject({ startupRecoveryPending: false })
    expect(runtime.children).toHaveLength(1)
    host.retry([watch])
    const next = await spawned()
    reply(next, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(watch.generation).toBe(2)
    expect(host.health(watch).state).toBe('healthy')
  })

  it('rejects old identities and revokes slow-start continuation when the process exits', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(35000)
    reply(child, 'crawl-complete', { watchGeneration: 99, excluded: [], directories: 1, entries: 1 })
    reply(child, 'crawl-complete', { processGeneration: 99, excluded: [], directories: 1, entries: 1 })
    expect(watch).toMatchObject({ startupRecoveryPending: true, failed: true })
    reply(child, 'startup-progress', { stage: 'crawl-progress', elapsedMs: 35000, pathChecks: 3, directoryChecks: 1 })
    expect(watch.startup?.pathChecks).toBe(3)
    expect(watch.failed).toBe(true)
    child.emit('exit', 1)
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    await vi.advanceTimersByTimeAsync(10000)
    expect(watch).toMatchObject({ startupRecoveryPending: false, failed: true })
    expect(runtime.children).toHaveLength(1)
  })

  it('slow startup does not recycle a healthy watch sharing its process', async () => {
    const healthy = host.add('/ws/healthy', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    host.reconciled(healthy, healthy.gapVersion, healthy.generation)
    const slow = host.add('/ws/slow', 'root', { event: vi.fn(), change: vi.fn() })
    const create = child.postMessage.mock.calls.findLast(([m]: any[]) => m.type === 'create')[0]
    child.emit('message', { ...create, type: 'accepted' })
    child.emit('message', { ...create, type: 'startup-progress', stage: 'watch-created', elapsedMs: 1, pathChecks: 1, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(65000)
    expect(host.health(healthy).state).toBe('healthy')
    expect(slow.startupRecoveryPending).toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('message', { ...create, type: 'crawl-complete', excluded: [], directories: 1, entries: 1 })
    expect(host.health(slow).state).toBe('recovering')
  })

  it.each([false, true])('does not grant continuation to an unaccepted or uncreated startup (accepted=%s)', async accepted => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    if (accepted) reply(child, 'accepted')
    reply(child, 'startup-progress', { stage: accepted ? 'path-check-start' : 'watch-created', elapsedMs: 0, pathChecks: 0, directoryChecks: 0 })
    child.postMessage.mockImplementation((message: any) => {
      if (message.type === 'ping') child.emit('message', { ...message, type: 'pong' })
    })
    await vi.advanceTimersByTimeAsync(30000)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(host.health(watch)).toMatchObject({ state: 'degraded', reason: 'timeout' })
  })

  it('capacity rejection remains observable and can be retried after a slot is released', () => {
    const callbacks = { event: vi.fn(), change: vi.fn() }
    const watches = Array.from({ length: 512 }, (_, i) => host.add(`/ws/${i}`, 'root', callbacks))
    const rejected = host.add('/ws/overflow', 'root', callbacks)
    expect(host.health(rejected)).toMatchObject({ state: 'degraded', reason: 'overflow' })
    host.remove(watches[0])
    host.retry([rejected])
    expect(rejected.failed).toBe(false)
  })

  it('resource errors during close degrade every shared-backend subscription without replay', async () => {
    const survivor = host.add('/ws/keep', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    const removed = host.add('/ws/remove', 'root', { event: vi.fn(), change: vi.fn() })
    host.remove(removed)
    const close = child.postMessage.mock.calls.find(([message]: any[]) => message.type === 'close')[0]
    child.emit('message', { ...close, type: 'error', code: 'EMFILE' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(survivor.failed).toBe(true)
    expect(runtime.children).toHaveLength(1)
    expect(host.automaticRecoveryCount).toBe(0)
  })

  it('suspend/resume grants fresh heartbeat and close deadlines', async () => {
    host.add('/ws/keep', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    host.suspend()
    await vi.advanceTimersByTimeAsync(60000)
    expect(child.kill).not.toHaveBeenCalled()
    host.resume()
    await vi.advanceTimersByTimeAsync(4000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('abnormal recovery is bounded and manual retry creates a fresh generation', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    let child = await spawned()
    child.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2100)
    child = await spawned()
    child.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2100)
    expect(runtime.children).toHaveLength(2)
    expect(watch.failed).toBe(true)
    host.retry([watch])
    await spawned()
    expect(runtime.children).toHaveLength(3)
    expect(watch.failed).toBe(false)
    expect(watch.generation).toBe(3)
  })

  it('barriers have a bounded deadline rather than waiting for idle forever', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    const pending = expect(host.barrier(watch)).rejects.toThrow('监听屏障失效')
    await vi.advanceTimersByTimeAsync(5001)
    await pending
  })

  it('a dropped tail event advances only at a barrier and requires another scan', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    reply(child, 'gap', { gapId: 1 })
    const oldGap = watch.gapVersion
    const rejected = expect(host.barrier(watch)).rejects.toThrow('监听补查已被新的缺口取代')
    const command = child.postMessage.mock.calls.findLast(([m]: any[]) => m.type === 'barrier')[0]
    child.emit('message', { ...command, sequence: 20 })
    await rejected
    expect(watch.sequence).toBe(20)
    host.reconciled(watch, oldGap, watch.generation)
    expect(host.health(watch).state).toBe('recovering')
    const next = host.barrier(watch)
    const second = child.postMessage.mock.calls.findLast(([m]: any[]) => m.type === 'barrier')[0]
    child.emit('message', { ...second, sequence: 20 })
    await next
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(host.health(watch).state).toBe('healthy')
  })

  it('locks failure across ready, pong and successful reconciliation', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'error', { code: 'EACCES' })
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(host.health(watch).state).toBe('degraded')
  })

  it('old reconciliation cannot settle a second same-generation gap', async () => {
    const watch = host.add('/ws/root', 'root', { event: vi.fn(), change: vi.fn() })
    const child = await spawned()
    reply(child, 'crawl-complete', { excluded: [], directories: 1, entries: 1 })
    const first = watch.gapVersion
    reply(child, 'gap', { gapId: 1 })
    host.reconciled(watch, first, watch.generation)
    expect(host.health(watch).state).toBe('recovering')
    host.reconciled(watch, watch.gapVersion, watch.generation)
    expect(host.health(watch).state).toBe('healthy')
  })

  it('repeated confirmed normal close timeouts never spend abnormal recovery allowance', async () => {
    const survivor = host.add('/ws/keep', 'root', { event: vi.fn(), change: vi.fn() })
    let child = await spawned()
    for (let i = 0; i < 3; i++) {
      const temporary = host.add(`/ws/temp${i}`, 'root', { event: vi.fn(), change: vi.fn() })
      host.remove(temporary)
      const close = child.postMessage.mock.calls.findLast(([m]: any[]) => m.type === 'close')[0]
      child.emit('message', { ...close, type: 'close-start' })
      await vi.advanceTimersByTimeAsync(6100)
      child = await spawned()
    }
    expect(host.automaticRecoveryCount).toBe(0)
    expect(survivor.failed).toBe(false)
    child.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2100)
    expect(host.automaticRecoveryCount).toBe(1)
  })

  it('rejects stale generations and discontinous sequences without forwarding unsafe paths', async () => {
    const event = vi.fn()
    const watch = host.add('/ws/root', 'root', { event, change: vi.fn() })
    const child = await spawned()
    reply(child, 'events', { watchGeneration: 99, events: [{ kind: 'change', path: 'a.md', sequence: 1, observedAt: 1 }] })
    expect(event).not.toHaveBeenCalled()
    reply(child, 'events', { events: [{ kind: 'change', path: '../secret', sequence: 1, observedAt: 1 }] })
    expect(watch.failed).toBe(true)
    expect(event).not.toHaveBeenCalled()
  })
})
