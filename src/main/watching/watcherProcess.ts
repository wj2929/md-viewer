import chokidar from 'chokidar'
import { lstatSync, realpathSync } from 'node:fs'
import * as path from 'node:path'
import { createRootWatchPolicy } from './watchPolicy'
import { isPathInside } from './watchPaths'
import { WATCH_LIMITS, safeWatchError, type PhysicalWatchEvent, type WatchCommand, type WatchIdentity, type WatchResponse, type WatchStartupStage } from './watchProtocol'

const port = process.parentPort
if (!port) throw new Error('Watcher entry requires Electron utilityProcess')

interface ChildWatch {
  identity: WatchIdentity
  root: string
  kind: 'root' | 'file'
  watcher: ReturnType<typeof chokidar.watch>
  sequence: number
  gapId: number
  overflow: boolean
  failed: boolean
  errors: Set<string>
  queue: PhysicalWatchEvent[]
  barriers: number[]
  flights: number[]
}
const watches = new Map<number, ChildWatch>()
let buffered = 0
let flights = 0
let scheduled = false
const send = (message: WatchResponse): void => port.postMessage(message)
const wirePath = (value: string): string => value.split(path.sep).join('/')

function fail(state: ChildWatch, error: unknown): void {
  const code = safeWatchError(error)
  if (state.errors.has(code)) return
  state.errors.add(code)
  state.failed = true
  buffered -= state.queue.length
  flights -= state.flights.length
  state.queue = []
  state.flights = []
  state.barriers = []
  send({ ...state.identity, type: 'error', code })
  scheduleFlush()
}

// Chokidar does not follow symlinks; also reject paths whose ancestors were exchanged after authorization.
function safeEventPath(state: ChildWatch, candidate: string): boolean {
  if (state.kind === 'file' ? candidate !== state.root : !isPathInside(state.root, candidate)) return false
  let existing = candidate
  while (true) {
    try {
      if (lstatSync(existing).isSymbolicLink()) return false
      return realpathSync(existing) === existing
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
      const parent = path.dirname(existing)
      if (parent === existing) return false
      existing = parent
    }
  }
}

function event(state: ChildWatch, kind: PhysicalWatchEvent['kind'], candidate: string): void {
  if (state.failed || watches.get(state.identity.watchId) !== state || !safeEventPath(state, candidate)) return
  const relative = state.kind === 'file' ? '' : wirePath(path.relative(state.root, candidate))
  const sequence = ++state.sequence
  if (relative.length > WATCH_LIMITS.pathLength || buffered >= WATCH_LIMITS.bufferedEvents) {
    if (!state.overflow) {
      state.overflow = true
      send({ ...state.identity, type: 'gap', gapId: ++state.gapId })
    }
    return
  }
  state.queue.push({ kind, path: relative, sequence, observedAt: performance.now() })
  buffered++
  scheduleFlush()
}

function scheduleFlush(): void {
  if (scheduled) return
  scheduled = true
  setImmediate(() => { scheduled = false; flush() })
}

function flush(): void {
  for (const state of watches.values()) {
    if (state.queue.length && flights < WATCH_LIMITS.inFlightBatches) {
      const events = state.queue.splice(0, WATCH_LIMITS.batch)
      buffered -= events.length
      flights++
      state.flights.push(events.at(-1)!.sequence)
      send({ ...state.identity, type: 'events', events })
      state.overflow = false
    }
    if (state.queue.length === 0) {
      for (const requestId of state.barriers.splice(0)) {
        send({ ...state.identity, type: 'barrier', requestId, sequence: state.sequence })
      }
    } else if (flights < WATCH_LIMITS.inFlightBatches) scheduleFlush()
  }
}

port.on('message', ({ data }: { data: WatchCommand }) => {
  const command = data
  if (!command || typeof command !== 'object') return
  if (command.type === 'ping') {
    send({ type: 'pong', processGeneration: command.processGeneration, requestId: command.requestId })
    return
  }
  const identity: WatchIdentity = {
    processGeneration: command.processGeneration, watchId: command.watchId, watchGeneration: command.watchGeneration,
  }
  if (command.type === 'create') {
    if (!path.isAbsolute(command.path) || command.path.length > WATCH_LIMITS.pathLength ||
      watches.size >= WATCH_LIMITS.watches || watches.has(command.watchId)) {
      send({ ...identity, type: 'error', code: 'OVERFLOW' })
      return
    }
    send({ ...identity, type: 'accepted', requestId: command.requestId })
    const startedAt = performance.now()
    let lastProgressAt = startedAt
    let pathChecks = 0
    let directoryChecks = 0
    let starting = true
    const progress = (stage: WatchStartupStage): void => {
      lastProgressAt = performance.now()
      send({ ...identity, type: 'startup-progress', stage,
        elapsedMs: Math.max(0, Math.floor(lastProgressAt - startedAt)), pathChecks, directoryChecks })
    }
    try {
      progress('path-check-start')
      if (realpathSync(command.path) !== command.path) {
        send({ ...identity, type: 'error', code: 'EPERM' })
        return
      }
      progress('path-checked')
      const policy = command.kind === 'root' ? createRootWatchPolicy(command.path) : undefined
      progress('watch-create-start')
      const watcher = chokidar.watch(command.path, {
        persistent: true, ignoreInitial: true, followSymlinks: false,
        ...(policy ? { ignored: (candidate, stats) => {
          if (starting) {
            // These are callback checks, not unique filesystem entries.
            pathChecks++
            if (stats?.isDirectory()) directoryChecks++
            if (performance.now() - lastProgressAt >= 5000) progress('crawl-progress')
          }
          return policy.ignored(candidate, stats)
        } } : {}),
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      })
      progress('watch-created')
      const state: ChildWatch = {
        identity, root: command.path, kind: command.kind, watcher, sequence: 0, gapId: 0,
        overflow: false, failed: false, errors: new Set(), queue: [], barriers: [], flights: [],
      }
      watches.set(command.watchId, state)
      watcher.on('error', error => { starting = false; fail(state, error) })
      watcher.on('ready', () => {
        if (starting) progress('crawl-progress')
        starting = false
        const excluded = [...(policy?.excluded ?? [])].map(wirePath)
        if (excluded.length > WATCH_LIMITS.exclusions) { fail(state, { code: 'OVERFLOW' }); return }
        const watched = watcher.getWatched()
        send({ ...identity, type: 'crawl-complete', excluded,
          directories: Object.keys(watched).length,
          entries: Object.values(watched).reduce((sum, names) => sum + names.length, 0),
        })
      })
      for (const kind of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
        watcher.on(kind, candidate => event(state, kind, path.resolve(candidate)))
      }
    } catch (error) { send({ ...identity, type: 'error', code: safeWatchError(error) }) }
    return
  }
  const state = watches.get(command.watchId)
  if (!state || state.identity.processGeneration !== command.processGeneration || state.identity.watchGeneration !== command.watchGeneration) return
  if (command.type === 'ack') {
    const count = state.flights.filter(sequence => sequence <= command.sequence).length
    state.flights.splice(0, count)
    flights -= count
    scheduleFlush()
  } else if (command.type === 'barrier') {
    if (state.barriers.length >= WATCH_LIMITS.requests) { fail(state, { code: 'OVERFLOW' }); return }
    state.barriers.push(command.requestId)
    flush()
  } else if (command.type === 'close') {
    watches.delete(command.watchId)
    buffered -= state.queue.length
    flights -= state.flights.length
    send({ ...identity, type: 'close-start', requestId: command.requestId })
    // close may block synchronously before returning its Promise. Only this child pays that cost.
    void state.watcher.close().then(() => {
      send({ ...identity, type: 'closed', requestId: command.requestId })
      scheduleFlush()
    }).catch(error => send({ ...identity, type: 'error', code: safeWatchError(error) }))
  }
})
