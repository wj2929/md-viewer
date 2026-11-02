import chokidar from 'chokidar'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const physical = vi.hoisted(() => ({ watchers: [] as any[] }))
vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => {
  const watcher = new EventEmitter() as any
  watcher.close = vi.fn().mockResolvedValue(undefined)
  watcher.getWatched = () => ({ '/fixture': ['a.md'] })
  physical.watchers.push(watcher)
  return watcher
}) } }))
let root: string
let port: EventEmitter & { postMessage: ReturnType<typeof vi.fn> }
const identity = { processGeneration: 1, watchId: 1, watchGeneration: 1 }
function command(data: Record<string, unknown>) { port.emit('message', { data: { ...identity, ...data } }) }
function messages(type: string): any[] { return port.postMessage.mock.calls.map(([message]) => message).filter(message => message.type === type) }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setImmediate'] })
  vi.resetModules()
  physical.watchers.length = 0
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'md-watch-child-')))
  writeFileSync(path.join(root, 'a.md'), '# test')
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port })
  await import('../watching/watcherProcess')
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(process, 'parentPort')
  rmSync(root, { recursive: true, force: true })
})

describe('physical watcher child', () => {
  it('reports startup stages and throttled callback counts without paths or post-ready progress', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    command({ type: 'create', requestId: 1, path: root, kind: 'root' })
    expect(messages('startup-progress').map(message => message.stage)).toEqual([
      'path-check-start', 'path-checked', 'watch-create-start', 'watch-created',
    ])
    const ignored = vi.mocked(chokidar.watch).mock.calls.at(-1)![1]!.ignored as any
    for (let i = 0; i < 1000; i++) expect(ignored(path.join(root, 'a.md'))).toBe(false)
    expect(messages('startup-progress')).toHaveLength(4)
    now = 5000
    expect(ignored(root, { isDirectory: () => true, isSymbolicLink: () => false })).toBe(false)
    expect(messages('startup-progress').at(-1)).toMatchObject({
      stage: 'crawl-progress', elapsedMs: 5000, pathChecks: 1001, directoryChecks: 1,
    })
    physical.watchers[0].emit('ready')
    const count = messages('startup-progress').length
    now = 10000
    ignored(path.join(root, 'a.md'))
    expect(messages('startup-progress')).toHaveLength(count)
    expect(messages('crawl-complete')).toHaveLength(1)
    expect(JSON.stringify(messages('startup-progress'))).not.toContain(root)
    clock.mockRestore()
  })

  it('retains the failing path-check stage and only sends a safe error code', () => {
    command({ type: 'create', requestId: 1, path: path.join(root, 'private-missing'), kind: 'root' })
    expect(messages('startup-progress').map(message => message.stage)).toEqual(['path-check-start'])
    expect(messages('error')).toEqual([{ ...identity, type: 'error', code: 'ENOENT' }])
    expect(physical.watchers).toHaveLength(0)
    expect(JSON.stringify(messages('startup-progress'))).not.toContain(root)
  })

  it('bounds queued/in-flight events, reports overflow, and orders the final barrier after delivery', async () => {
    command({ type: 'create', requestId: 1, path: root, kind: 'root' })
    const watcher = physical.watchers[0]
    for (let i = 0; i < 2050; i++) watcher.emit('change', path.join(root, 'a.md'))
    expect(messages('gap')).toHaveLength(1)
    await vi.runAllTimersAsync()
    expect(messages('events')).toHaveLength(8)
    command({ type: 'barrier', requestId: 2 })
    expect(messages('barrier')).toHaveLength(0)
    const first = messages('events')
    for (const batch of first) command({ type: 'ack', sequence: batch.events.at(-1).sequence })
    await vi.runAllTimersAsync()
    expect(messages('events').flatMap(batch => batch.events)).toHaveLength(2048)
    expect(messages('barrier')).toEqual([{ ...identity, type: 'barrier', requestId: 2, sequence: 2050 }])
    const ordered = port.postMessage.mock.calls.map(([message]) => message.type)
    expect(ordered.lastIndexOf('barrier')).toBeGreaterThan(ordered.lastIndexOf('events'))
  })

  it('failed watches release batch capacity; resource errors still escalate after a permission error', async () => {
    command({ type: 'create', requestId: 1, path: root, kind: 'root' })
    command({ type: 'create', requestId: 2, watchId: 2, path: path.join(root, 'a.md'), kind: 'file' })
    const failed = physical.watchers[0]
    for (let i = 0; i < 2048; i++) failed.emit('change', path.join(root, 'a.md'))
    await vi.runAllTimersAsync()
    failed.emit('error', { code: 'EACCES', message: 'private path' })
    failed.emit('error', { code: 'EACCES', message: 'private path' })
    physical.watchers[1].emit('change', path.join(root, 'a.md'))
    await vi.runAllTimersAsync()
    expect(messages('events').at(-1).watchId).toBe(2)
    failed.emit('error', { code: 'EMFILE', message: 'private path' })
    expect(messages('error').map(message => message.code)).toEqual(['EACCES', 'EMFILE'])
    expect(JSON.stringify(messages('error'))).not.toContain('private path')
  })

  it.skipIf(process.platform === 'win32')('does not forward paths through exchanged symlink ancestors', async () => {
    const outside = path.join(root, 'outside')
    const watched = path.join(root, 'watched')
    mkdirSync(outside)
    mkdirSync(watched)
    writeFileSync(path.join(outside, 'a.md'), '# outside')
    symlinkSync(outside, path.join(watched, 'link'))
    command({ type: 'create', requestId: 1, path: watched, kind: 'root' })
    physical.watchers[0].emit('change', path.join(watched, 'link/a.md'))
    physical.watchers[0].emit('unlink', path.join(watched, 'link/missing.md'))
    await vi.runAllTimersAsync()
    expect(messages('events')).toHaveLength(0)
  })
})
