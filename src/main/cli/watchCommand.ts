import chokidar from 'chokidar'
import * as path from 'path'
import { realpath } from 'fs/promises'
import { CLI_SCHEMA_VERSION } from './types'
import { validateSecurePath } from '../security/pathValidator'
import { hasIgnoredPathSegment } from '../watching/WorkspaceWatchService'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn'])
const RENAME_WINDOW_MS = 550

export interface WatchIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

interface WatchEventBase {
  schemaVersion: typeof CLI_SCHEMA_VERSION
  event: string
  sequence: number
}

export async function runWatchCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  io: WatchIo,
): Promise<number> {
  const input = positional[0]
  if (!input || positional.length !== 1) {
    writeEvent(io, { event: 'error', sequence: 1 }, {
      code: 'INVALID_ARGUMENT',
      message: 'watch 需要一个 Markdown 文件或目录路径',
    })
    return 2
  }
  if (flags.jsonl !== true) {
    writeEvent(io, { event: 'error', sequence: 1 }, {
      code: 'INVALID_ARGUMENT',
      message: 'watch 当前要求显式使用 --jsonl',
    })
    return 2
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || (validation.type !== 'md-file' && validation.type !== 'directory')) {
    writeEvent(io, { event: 'error', sequence: 1 }, {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '监听路径不可用',
    })
    return validation.error === '路径不存在' ? 3 : 2
  }

  const targetPath = await realpath(validation.normalizedPath)
  const isFile = validation.type === 'md-file'
  if (isFile && !MARKDOWN_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
    writeEvent(io, { event: 'error', sequence: 1 }, {
      code: 'INPUT_NOT_ALLOWED',
      message: 'watch 只支持 Markdown 文件或目录',
    })
    return 2
  }
  const relativeRoot = isFile ? path.dirname(targetPath) : targetPath
  const maxEvents = parsePositiveInteger(flags['max-events'])
  const timeoutMs = parsePositiveInteger(flags.timeout)
  let sequence = 0
  let observedEvents = 0
  let stopped = false
  let exitCode = 0
  const pendingRemovals = new Map<string, { timer: ReturnType<typeof setTimeout>; timestamp: number }>()

  const emit = (event: string, payload: Record<string, unknown> = {}): void => {
    sequence += 1
    writeEvent(io, { event, sequence }, payload)
    if (!['ready', 'initial', 'stopped', 'error'].includes(event)) {
      observedEvents += 1
      if (maxEvents !== null && observedEvents >= maxEvents) void stop('max-events')
    }
  }

  const watcher = chokidar.watch(targetPath, {
    persistent: true,
    ignoreInitial: false,
    ignored: (candidatePath: string, stats) => {
      if (candidatePath === targetPath) return false
      if (!isFile && hasIgnoredPathSegment(candidatePath, targetPath)) return true
      if (!stats || stats.isDirectory()) return false
      return !MARKDOWN_EXTENSIONS.has(path.extname(candidatePath).toLowerCase())
    },
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })

  let resolveDone: (code: number) => void = () => {}
  const done = new Promise<number>(resolve => { resolveDone = resolve })
  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const stop = async (reason: string, code = exitCode): Promise<void> => {
    if (stopped) return
    stopped = true
    exitCode = code
    for (const pending of pendingRemovals.values()) clearTimeout(pending.timer)
    pendingRemovals.clear()
    if (timeout) clearTimeout(timeout)
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
    await watcher.close().catch(error => {
      io.stderr(`[watch] ${error instanceof Error ? error.message : String(error)}\n`)
      exitCode = 1
    })
    emit('stopped', { reason })
    resolveDone(exitCode)
  }

  const relativePath = (filePath: string): string =>
    path.relative(relativeRoot, filePath).split(path.sep).join('/') || path.basename(filePath)

  watcher.on('add', filePath => {
    if (stopped) return
    const canonical = path.resolve(filePath)
    const samePath = pendingRemovals.get(canonical)
    if (samePath) {
      clearTimeout(samePath.timer)
      pendingRemovals.delete(canonical)
      emit('changed', { relativePath: relativePath(canonical) })
      return
    }
    const now = Date.now()
    const candidates = [...pendingRemovals.entries()].filter(([oldPath, pending]) =>
      now - pending.timestamp < RENAME_WINDOW_MS &&
      path.extname(oldPath).toLowerCase() === path.extname(canonical).toLowerCase()
    )
    const sameDirectory = candidates.filter(([oldPath]) => path.dirname(oldPath) === path.dirname(canonical))
    const match = sameDirectory.length === 1 ? sameDirectory[0] : candidates.length === 1 ? candidates[0] : null
    if (match) {
      const [oldPath, pending] = match
      clearTimeout(pending.timer)
      pendingRemovals.delete(oldPath)
      emit('removed', { relativePath: relativePath(oldPath) })
      emit('added', { relativePath: relativePath(canonical) })
      emit('renamed', {
        inferred: true,
        oldRelativePath: relativePath(oldPath),
        relativePath: relativePath(canonical),
      })
      return
    }
    emit(sequence === 0 ? 'initial' : 'added', { relativePath: relativePath(canonical) })
  })
  watcher.on('change', filePath => {
    if (!stopped) emit('changed', { relativePath: relativePath(filePath) })
  })
  watcher.on('unlink', filePath => {
    if (stopped) return
    const canonical = path.resolve(filePath)
    const previous = pendingRemovals.get(canonical)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => {
      if (pendingRemovals.get(canonical)?.timer !== timer || stopped) return
      pendingRemovals.delete(canonical)
      emit('removed', { relativePath: relativePath(canonical) })
    }, RENAME_WINDOW_MS)
    pendingRemovals.set(canonical, { timer, timestamp: Date.now() })
  })
  watcher.on('ready', () => {
    if (!stopped) emit('ready', { targetType: isFile ? 'file' : 'folder' })
  })
  watcher.on('error', error => {
    if (stopped) return
    emit('error', { code: 'WATCH_ERROR', message: error instanceof Error ? error.message : String(error) })
    void stop('error', 1)
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = (): void => { void stop(signal) }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }
  const timeout = timeoutMs === null ? null : setTimeout(() => { void stop('timeout') }, timeoutMs)
  return done
}

function writeEvent(
  io: WatchIo,
  base: Omit<WatchEventBase, 'schemaVersion'>,
  payload: Record<string, unknown>,
): void {
  io.stdout(`${JSON.stringify({ schemaVersion: CLI_SCHEMA_VERSION, ...base, ...payload })}\n`)
}

function parsePositiveInteger(value: string | boolean | undefined): number | null {
  if (value === undefined) return null
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
