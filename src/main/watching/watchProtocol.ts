export const WATCH_LIMITS = {
  watches: 512,
  batch: 128,
  bufferedEvents: 2048,
  inFlightBatches: 8,
  exclusions: 2048,
  pathLength: 4096,
  requests: 256,
  heartbeatMs: 1000,
  unresponsiveMs: 5000,
  startupMs: 30000,
  slowStartupMs: 120000,
  barrierMs: 5000,
  minimumRestartMs: 2000,
  retryWindowMs: 300000,
} as const

export const WATCH_STARTUP_STAGES = ['path-check-start', 'path-checked', 'watch-create-start', 'watch-created', 'crawl-progress'] as const
export type WatchStartupStage = typeof WATCH_STARTUP_STAGES[number]

export type PhysicalWatchKind = 'root' | 'file'
export type PhysicalEventKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
export interface WatchIdentity {
  processGeneration: number
  watchId: number
  watchGeneration: number
}
export interface PhysicalWatchEvent {
  kind: PhysicalEventKind
  path: string
  sequence: number
  observedAt: number
}
export type WatchCommand =
  | (WatchIdentity & { type: 'create'; requestId: number; path: string; kind: PhysicalWatchKind })
  | (WatchIdentity & { type: 'close' | 'barrier'; requestId: number })
  | (WatchIdentity & { type: 'ack'; sequence: number })
  | { type: 'ping'; processGeneration: number; requestId: number }

export type WatchResponse =
  | (WatchIdentity & { type: 'startup-progress'; stage: WatchStartupStage; elapsedMs: number; pathChecks: number; directoryChecks: number })
  | (WatchIdentity & { type: 'accepted' | 'close-start' | 'closed'; requestId: number })
  | (WatchIdentity & { type: 'crawl-complete'; excluded: string[]; directories: number; entries: number })
  | (WatchIdentity & { type: 'events'; events: PhysicalWatchEvent[] })
  | (WatchIdentity & { type: 'gap'; gapId: number })
  | (WatchIdentity & { type: 'error'; code: WatchErrorCode })
  | (WatchIdentity & { type: 'barrier'; requestId: number; sequence: number })
  | { type: 'pong'; processGeneration: number; requestId: number }

export type WatchErrorCode = 'EMFILE' | 'ENOSPC' | 'EACCES' | 'EPERM' | 'ENOENT' | 'OVERFLOW' | 'UNKNOWN'
export function safeWatchError(error: unknown): WatchErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && ['EMFILE', 'ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'OVERFLOW'].includes(code)
    ? code as WatchErrorCode : 'UNKNOWN'
}

const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
export function isWatchResponse(value: unknown): value is WatchResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!integer(v.processGeneration)) return false
  if (v.type === 'pong') return integer(v.requestId)
  if (!integer(v.watchId) || !integer(v.watchGeneration)) return false
  switch (v.type) {
    case 'accepted': case 'close-start': case 'closed': return integer(v.requestId)
    case 'startup-progress': return WATCH_STARTUP_STAGES.includes(v.stage as WatchStartupStage) &&
      integer(v.elapsedMs) && integer(v.pathChecks) && integer(v.directoryChecks)
    case 'barrier': return integer(v.requestId) && integer(v.sequence)
    case 'gap': return integer(v.gapId)
    case 'error': return ['EMFILE', 'ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'OVERFLOW', 'UNKNOWN'].includes(v.code as string)
    case 'crawl-complete': return integer(v.directories) && integer(v.entries) && Array.isArray(v.excluded) &&
      v.excluded.length <= WATCH_LIMITS.exclusions && v.excluded.every(value => isRelativeWatchPath(value))
    case 'events': return Array.isArray(v.events) && v.events.length > 0 && v.events.length <= WATCH_LIMITS.batch && v.events.every(e => (
      e && ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].includes(e.kind) &&
      isRelativeWatchPath(e.path) && integer(e.sequence) && Number.isFinite(e.observedAt) && e.observedAt >= 0
    ))
    default: return false
  }
}

// Forward slashes on the wire, including on Windows. Empty path denotes the watched root/file itself.
export function isRelativeWatchPath(value: unknown, platform: NodeJS.Platform = process.platform): value is string {
  return typeof value === 'string' && value.length <= WATCH_LIMITS.pathLength && !/[\\\0]/.test(value) &&
    (platform !== 'win32' || !value.includes(':')) &&
    !value.startsWith('/') && value.split('/').every(part => part !== '..' && part !== '.')
}
