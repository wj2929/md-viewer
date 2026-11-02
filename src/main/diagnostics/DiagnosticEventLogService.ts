import { constants as fsConstants } from 'fs'
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  type FileHandle,
} from 'fs/promises'
import { createHmac, randomBytes } from 'crypto'
import { performance } from 'perf_hooks'
import * as path from 'path'
import {
  DEFAULT_DIAGNOSTIC_LOG_SETTINGS,
  DIAGNOSTIC_EVENT_NAMES,
  DIAGNOSTIC_EVENT_SCHEMA_VERSION,
  type DiagnosticClearResult,
  type DiagnosticEventName,
  type DiagnosticEventPriority,
  type DiagnosticLogErrorCode,
  type DiagnosticLogSettings,
  type DiagnosticLogState,
  type DiagnosticLogStatus,
  type DiagnosticMetadata,
  type DiagnosticOperationOutcome,
  type DiagnosticPathCorrelation,
  type DiagnosticRetentionPolicy,
  type DiagnosticSource,
  type PersistedDiagnosticEvent,
  type RendererDiagnosticEventInput,
  isDiagnosticId,
  isDiagnosticOperationOutcome,
  normalizeDiagnosticLogSettings,
  sanitizeDiagnosticMetadata,
  sanitizeRendererDiagnosticEvent,
} from '../../shared/diagnostics'
import { isProtectedPath } from '../security'

const LOG_FILE_PATTERN = /^md-viewer-events-(\d{4}-\d{2}-\d{2})-([a-f0-9]{12})-(\d{2})\.jsonl$/
const SEGMENT_BYTES = 2 * 1024 * 1024
const MAX_QUEUE_BYTES = 1024 * 1024
const CRITICAL_RESERVE_BYTES = Math.floor(MAX_QUEUE_BYTES * 0.2)
const MAX_EVENT_BYTES = 2 * 1024
const BATCH_BYTES = 32 * 1024
const FLUSH_DELAY_MS = 200
const WRITE_TIMEOUT_MS = 2000
const WRITER_DEGRADED_MS = 500
const DIRECTORY_TIMEOUT_MS = 1500
const ACTIVE_FOREIGN_FILE_MS = 5 * 60 * 1000
const MAX_LOG_FILES = 512
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const HEALTH_MONITOR_INTERVAL_MS = 60 * 1000
const HEALTH_ACTIVITY_REPORT_INTERVAL_MS = 10 * 60 * 1000
const HEALTH_IDLE_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000
const INSTALL_KEY_BYTES = 32
const BUNDLE_EVENT_BYTES = 10 * 1024 * 1024

export interface DiagnosticEventDraft {
  event: DiagnosticEventName
  operationId?: string
  spanId?: string
  parentSpanId?: string
  outcome?: DiagnosticOperationOutcome
  metadata?: DiagnosticMetadata
  rawPath?: string
  rawWorkspacePath?: string
  priority?: DiagnosticEventPriority
  observedUnixMs?: number
  monotonicMs?: number
}

interface QueuedEvent {
  event: Omit<PersistedDiagnosticEvent, 'writerRecordedUnixMs'>
  priority: DiagnosticEventPriority
  estimatedBytes: number
  queuedMonotonicMs: number
  rawPath?: string
  rawWorkspacePath?: string
}

interface LogFileInfo {
  path: string
  name: string
  date: string
  bootFragment: string
  segment: number
  size: number
  mtimeMs: number
  active: boolean
}

export interface CleanupPlan {
  files: LogFileInfo[]
  bytes: number
  skippedActiveFiles: number
}

interface MaintenanceResult {
  deletedFiles: number
  deletedBytes: number
  skippedActiveFiles: number
  partial: boolean
}

export interface DiagnosticEventSnapshot {
  events: PersistedDiagnosticEvent[]
  totalBytes: number
  invalidLines: number
  truncated: boolean
  omittedFiles: number
  oldestEventUnixMs: number | null
  newestEventUnixMs: number | null
}

export interface DiagnosticEventLogInit {
  defaultDirectory: string
  userDataDirectory: string
  settings: unknown
}

export interface DiagnosticWriterHealth {
  eventsAccepted: number
  eventsWritten: number
  invalidEvents: number
  droppedEvents: number
  bytesWritten: number
  batchCount: number
  appendP95Ms: number
  appendMaxMs: number
  queueLagP95Ms: number
  queueLagMaxMs: number
  maxQueueBytes: number
  cleanupDurationMs: number
  destinationFallbacks: number
  writerWriteActive: boolean
}

export interface DiagnosticEventLogOptions {
  writeTimeoutMs?: number
  appendFile?: (handle: FileHandle, content: string) => Promise<void>
}

export class DiagnosticEventLogService {
  private settings: DiagnosticLogSettings = { ...DEFAULT_DIAGNOSTIC_LOG_SETTINGS }
  private state: DiagnosticLogState = 'initializing'
  private defaultDirectory: string | null = null
  private configuredDirectory: string | null = null
  private effectiveDirectory: string | null = null
  private lastErrorCode: DiagnosticLogErrorCode | undefined
  private pathKey = randomBytes(INSTALL_KEY_BYTES)
  private pathKeyInitialized = false
  private pathCorrelation: DiagnosticPathCorrelation = 'session-only'
  private readonly bootId = randomBytes(6).toString('hex')
  private readonly mainProcessInstanceId = `main_${randomBytes(8).toString('hex')}`
  private mainSequence = 0
  private readonly queue: QueuedEvent[] = []
  private queueBytes = 0
  private flushTimer: NodeJS.Timeout | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private maintenanceChain: Promise<void> = Promise.resolve()
  private currentHandle: FileHandle | null = null
  private currentPath: string | null = null
  private currentDate = ''
  private currentSegment = 0
  private currentBytes = 0
  private generation = 0
  private initialized = false
  private lastMaintenanceUnixMs = 0
  private readonly operations = new Map<string, {
    senderId: number
    expiresAt: number
    active: boolean
    kind: 'file' | 'folder'
    source: DiagnosticSource
    rawPath?: string
    startedMonotonicMs: number
  }>()
  private readonly activeMainOperations = new Set<string>()
  private watchActivityTailUntil = 0
  private eventLoopTimer: NodeJS.Timeout | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private healthDirty = false
  private lastHealthRecordedUnixMs = 0
  private lastReportedInvalidEvents = 0
  private lastReportedDroppedEvents = 0
  private lastReportedDestinationFallbacks = 0
  private lastReportedDegraded = false
  private expectedEventLoopTick = 0
  private ignoreEventLoopLagUntil = 0
  private health: DiagnosticWriterHealth = emptyHealth()
  private readonly appendDurations: number[] = []
  private readonly queueLags: number[] = []
  private fastAppendStreak = 0
  private shutdownPromise: Promise<void> | null = null

  constructor(private readonly options: DiagnosticEventLogOptions = {}) {}

  initialize(input: DiagnosticEventLogInit): void {
    if (this.initialized) return
    this.initialized = true
    this.defaultDirectory = path.resolve(input.defaultDirectory)
    this.settings = normalizeDiagnosticLogSettings(input.settings)
    this.configuredDirectory = this.settings.directory ?? null

    void this.completeInitialization(input.userDataDirectory)
  }

  private async completeInitialization(userDataDirectory: string): Promise<void> {
    await this.initializePathKey(userDataDirectory)
    await this.resolveInitialDestination()
    this.startEventLoopMonitor()
    this.startHealthMonitor()
  }

  getBootId(): string {
    return `boot_${this.bootId}`
  }

  markSystemSuspend(): void {
    this.ignoreEventLoopLagUntil = Number.POSITIVE_INFINITY
  }

  markSystemResume(): void {
    this.ignoreEventLoopLagUntil = performance.now() + 2000
    this.expectedEventLoopTick = performance.now() + 250
    this.recordMainEvent({ event: 'clock.anchor', priority: 'critical' })
  }

  getHealth(): DiagnosticWriterHealth {
    return {
      ...this.health,
      appendP95Ms: percentile(this.appendDurations, 0.95),
      appendMaxMs: max(this.appendDurations),
      queueLagP95Ms: percentile(this.queueLags, 0.95),
      queueLagMaxMs: max(this.queueLags),
      writerWriteActive: this.health.writerWriteActive,
    }
  }

  recordMainEvent(draft: DiagnosticEventDraft): void {
    const metadata = sanitizeDiagnosticMetadata(draft.metadata)
    if (draft.metadata !== undefined && metadata === null) {
      this.health.invalidEvents += 1
      this.healthDirty = true
      return
    }
    const observedUnixMs = draft.observedUnixMs ?? Date.now()
    const monotonicMs = draft.monotonicMs ?? performance.now()
    const event: Omit<PersistedDiagnosticEvent, 'writerRecordedUnixMs'> = {
      schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
      event: draft.event,
      observedUnixMs,
      monotonicMs,
      processRole: 'main',
      processInstanceId: this.mainProcessInstanceId,
      processSeq: this.mainSequence++,
      bootId: this.getBootId(),
      ...(draft.operationId ? { operationId: draft.operationId } : {}),
      ...(draft.spanId ? { spanId: draft.spanId } : {}),
      ...(draft.parentSpanId ? { parentSpanId: draft.parentSpanId } : {}),
      ...(draft.outcome ? { outcome: draft.outcome } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      tokenScope: this.pathCorrelation,
    }
    this.enqueue(event, draft.priority ?? eventPriority(draft.event), {
      rawPath: draft.rawPath,
      rawWorkspacePath: draft.rawWorkspacePath,
    })
    if (draft.operationId && draft.event.endsWith('.start')) {
      this.activeMainOperations.add(draft.operationId)
    } else if (draft.operationId && draft.event.endsWith('.terminal')) {
      this.activeMainOperations.delete(draft.operationId)
      if (draft.event === 'watcher.work.terminal') this.watchActivityTailUntil = monotonicMs + 2000
    }
  }

  recordRendererEvent(senderId: number, input: unknown): void {
    this.pruneOperations()
    const event = sanitizeRendererDiagnosticEvent(input)
    if (!event) {
      this.health.invalidEvents += 1
      this.healthDirty = true
      return
    }
    if (event.operationId) {
      const key = this.operationKey(senderId, event.operationId)
      const existing = this.operations.get(key)
      if (event.event === 'file.open.start') {
        this.operations.set(key, {
          senderId,
          expiresAt: Date.now() + 10 * 60 * 1000,
          active: true,
          kind: 'file',
          source: typeof event.metadata?.source === 'string'
            ? event.metadata.source as DiagnosticSource
            : 'unknown',
          startedMonotonicMs: performance.now(),
        })
      } else if (!existing || existing.senderId !== senderId) {
        this.health.invalidEvents += 1
        this.healthDirty = true
        return
      } else {
        existing.expiresAt = Date.now() + 10 * 60 * 1000
      }
      if (event.event.endsWith('.terminal')) {
        existing!.active = false
        existing!.expiresAt = Date.now() + 10 * 60 * 1000
      }
    }

    const persisted: Omit<PersistedDiagnosticEvent, 'writerRecordedUnixMs'> = {
      ...event,
      processRole: 'renderer',
      bootId: this.getBootId(),
      tokenScope: this.pathCorrelation,
    }
    this.enqueue(persisted, eventPriority(event.event))
  }

  completeRegisteredOperation(senderId: number, operationId: string): void {
    const operation = this.operations.get(this.operationKey(senderId, operationId))
    if (!operation) return
    operation.active = false
    operation.expiresAt = Date.now() + 10 * 60 * 1000
  }

  isRegisteredOperation(
    senderId: number,
    operationId: string,
    kind: 'file' | 'folder',
    rawPath?: string,
  ): boolean {
    this.pruneOperations()
    const operation = this.operations.get(this.operationKey(senderId, operationId))
    return Boolean(
      operation
      && operation.kind === kind
      && (rawPath === undefined || operation.rawPath === path.resolve(rawPath)),
    )
  }

  bindRegisteredOperationPath(senderId: number, operationId: string, rawPath: string): void {
    const operation = this.operations.get(this.operationKey(senderId, operationId))
    if (operation) operation.rawPath = path.resolve(rawPath)
  }

  findRegisteredOperation(
    senderId: number,
    kind: 'file' | 'folder',
    rawPath: string,
  ): { operationId: string; source: DiagnosticSource } | null {
    this.pruneOperations()
    const expectedPath = path.resolve(rawPath)
    let selected: { operationId: string; source: DiagnosticSource; startedMonotonicMs: number } | null = null
    for (const [key, operation] of this.operations) {
      if (
        !operation.active
        || operation.senderId !== senderId
        || operation.kind !== kind
        || operation.rawPath !== expectedPath
      ) continue
      const operationId = key.slice(key.indexOf(':') + 1)
      if (!selected || operation.startedMonotonicMs > selected.startedMonotonicMs) {
        selected = { operationId, source: operation.source, startedMonotonicMs: operation.startedMonotonicMs }
      }
    }
    return selected ? { operationId: selected.operationId, source: selected.source } : null
  }

  registerOperation(
    senderId: number,
    operationId: string,
    kind: 'file' | 'folder' = 'file',
    source: DiagnosticSource = 'unknown',
  ): void {
    this.operations.set(this.operationKey(senderId, operationId), {
      senderId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      active: true,
      kind,
      source,
      startedMonotonicMs: performance.now(),
    })
    this.pruneOperations()
  }

  async getStatus(): Promise<DiagnosticLogStatus> {
    this.pruneOperations()
    const files = this.effectiveDirectory
      ? await this.listLogFiles(this.effectiveDirectory).catch(() => [])
      : []
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    const oldestEventUnixMs = files.length > 0
      ? Math.min(...files.map(file => file.mtimeMs))
      : null
    return this.buildStatus(files.length, totalBytes, oldestEventUnixMs)
  }

  async validateCustomDirectory(candidatePath: string): Promise<string> {
    const candidate = path.resolve(candidatePath)
    const resolved = await withTimeout(realpath(candidate), DIRECTORY_TIMEOUT_MS, 'DIRECTORY_UNAVAILABLE')
    const resolvedDefaultDirectory = this.defaultDirectory
      ? await realpath(this.defaultDirectory).catch(() => path.resolve(this.defaultDirectory!))
      : null
    const root = path.parse(resolved).root
    if (
      resolved === root
      || (isProtectedPath(`${resolved}${path.sep}`) && resolved !== resolvedDefaultDirectory)
    ) {
      throw diagnosticError('DIRECTORY_PROTECTED')
    }
    const stats = await withTimeout(stat(resolved), DIRECTORY_TIMEOUT_MS, 'DIRECTORY_UNAVAILABLE')
    if (!stats.isDirectory()) throw diagnosticError('DIRECTORY_UNAVAILABLE')
    await this.probeWritable(resolved)
    return resolved
  }

  async applyConfiguredDirectory(directory: string | null): Promise<void> {
    const defaultDirectory = this.defaultDirectory
    if (!defaultDirectory) throw diagnosticError('DEFAULT_DIRECTORY_UNAVAILABLE')
    let nextDirectory: string
    if (directory) {
      nextDirectory = await this.validateCustomDirectory(directory)
      this.configuredDirectory = nextDirectory
    } else {
      await mkdir(defaultDirectory, { recursive: true, mode: 0o700 })
      await this.probeWritable(defaultDirectory)
      nextDirectory = defaultDirectory
      this.configuredDirectory = null
    }
    this.settings = {
      ...this.settings,
      ...(this.configuredDirectory
        ? { directory: this.configuredDirectory }
        : { directory: undefined }),
    }
    await this.switchDestination(nextDirectory, 'ready')
  }

  async retryConfiguredDirectory(): Promise<void> {
    if (!this.configuredDirectory) return
    const resolved = await this.validateCustomDirectory(this.configuredDirectory)
    await this.switchDestination(resolved, 'ready')
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.state = 'disabled'
      await this.flushAndClose()
      this.settings = { ...this.settings, enabled: false }
      this.state = 'disabled'
      return
    }
    this.settings = { ...this.settings, enabled: true }
    if (!this.effectiveDirectory) await this.resolveInitialDestination()
    else {
      this.state = this.configuredDirectory && this.effectiveDirectory === this.defaultDirectory
        ? 'fallback'
        : 'ready'
      this.scheduleFlush(true)
    }
  }

  async previewRetentionPolicy(policy: DiagnosticRetentionPolicy): Promise<CleanupPlan> {
    if (!this.effectiveDirectory) return { files: [], bytes: 0, skippedActiveFiles: 0 }
    const files = await this.listLogFiles(this.effectiveDirectory)
    return this.buildCleanupPlan(files, policy)
  }

  async applyRetentionPolicy(policy: DiagnosticRetentionPolicy): Promise<{
    deletedFiles: number
    deletedBytes: number
    skippedActiveFiles: number
    partial: boolean
  }> {
    this.settings = { ...this.settings, ...policy }
    return this.runMaintenance(policy, true)
  }

  async clearLogs(): Promise<Omit<DiagnosticClearResult, 'canceled' | 'status'>> {
    await this.flushAndClose()
    await this.maintenanceChain
    const directory = this.effectiveDirectory
    if (!directory) {
      return { deletedFiles: 0, deletedBytes: 0, skippedActiveFiles: 0, partial: false }
    }
    const files = await this.listLogFiles(directory)
    let deletedFiles = 0
    let deletedBytes = 0
    let skippedActiveFiles = 0
    let partial = false
    for (const file of files) {
      if (file.bootFragment !== this.bootId && Date.now() - file.mtimeMs < ACTIVE_FOREIGN_FILE_MS) {
        skippedActiveFiles += 1
        continue
      }
      try {
        const info = await lstat(file.path)
        if (!info.isFile() || info.isSymbolicLink()) continue
        await unlink(file.path)
        deletedFiles += 1
        deletedBytes += file.size
      } catch {
        partial = true
      }
    }
    this.currentPath = null
    this.currentBytes = 0
    this.currentSegment = 0
    if (this.settings.enabled) this.scheduleFlush(true)
    return { deletedFiles, deletedBytes, skippedActiveFiles, partial }
  }

  async readEventsForBundle(maxBytes = BUNDLE_EVENT_BYTES): Promise<DiagnosticEventSnapshot> {
    await this.flush()
    await this.maintenanceChain
    if (!this.effectiveDirectory) return emptySnapshot()
    const files = (await this.listLogFiles(this.effectiveDirectory))
      .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))
    const selected: LogFileInfo[] = []
    let selectedBytes = 0
    for (const file of files) {
      if (selected.length > 0 && selectedBytes + file.size > maxBytes) break
      selected.push(file)
      selectedBytes += file.size
      if (selectedBytes >= maxBytes) break
    }
    selected.reverse()

    const events: PersistedDiagnosticEvent[] = []
    let invalidLines = 0
    let consumedBytes = 0
    for (const file of selected) {
      let content: string
      try {
        content = await readFile(file.path, 'utf8')
      } catch {
        invalidLines += 1
        continue
      }
      const lines = content.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        consumedBytes += Buffer.byteLength(line) + 1
        if (consumedBytes > maxBytes) break
        const parsed = parsePersistedEvent(line)
        if (parsed) events.push(parsed)
        else invalidLines += 1
      }
      if (consumedBytes > maxBytes) break
    }

    const observedTimes = events.map(event => event.observedUnixMs)
    return {
      events,
      totalBytes: Math.min(consumedBytes, maxBytes),
      invalidLines,
      truncated: selected.length < files.length || consumedBytes > maxBytes,
      omittedFiles: Math.max(0, files.length - selected.length),
      oldestEventUnixMs: observedTimes.length > 0 ? Math.min(...observedTimes) : null,
      newestEventUnixMs: observedTimes.length > 0 ? Math.max(...observedTimes) : null,
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    while (this.queue.length > 0 && this.canWrite()) {
      await this.enqueueFlush()
    }
    await this.writeChain
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.completeShutdown()
    return this.shutdownPromise
  }

  private async completeShutdown(): Promise<void> {
    this.recordWriterHealth(true)
    if (this.eventLoopTimer) {
      clearInterval(this.eventLoopTimer)
      this.eventLoopTimer = null
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    this.recordMainEvent({ event: 'session.end', priority: 'critical' })
    let timer: NodeJS.Timeout | undefined
    const budget = new Promise<void>(resolve => {
      timer = setTimeout(resolve, 400)
      timer.unref?.()
    })
    await Promise.race([this.flushAndClose(), budget])
    if (timer) clearTimeout(timer)
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) return
    this.healthTimer = setInterval(
      () => this.recordWriterHealth(false),
      HEALTH_MONITOR_INTERVAL_MS,
    )
    this.healthTimer.unref?.()
  }

  private recordWriterHealth(force: boolean): void {
    this.pruneOperations()
    if (!this.canWrite()) return
    const now = Date.now()
    const health = this.getHealth()
    const degraded = this.state === 'degraded' || this.state === 'fallback'
    const abnormalChanged = health.invalidEvents !== this.lastReportedInvalidEvents
      || health.droppedEvents !== this.lastReportedDroppedEvents
      || health.destinationFallbacks !== this.lastReportedDestinationFallbacks
      || degraded !== this.lastReportedDegraded
    const elapsedMs = now - this.lastHealthRecordedUnixMs
    const activityDue = this.healthDirty
      && (this.lastHealthRecordedUnixMs === 0 || elapsedMs >= HEALTH_ACTIVITY_REPORT_INTERVAL_MS)
    const heartbeatDue = this.lastHealthRecordedUnixMs === 0
      || elapsedMs >= HEALTH_IDLE_HEARTBEAT_INTERVAL_MS
    if (!force && !abnormalChanged && !activityDue && !heartbeatDue) return

    this.healthDirty = false
    this.lastHealthRecordedUnixMs = now
    this.lastReportedInvalidEvents = health.invalidEvents
    this.lastReportedDroppedEvents = health.droppedEvents
    this.lastReportedDestinationFallbacks = health.destinationFallbacks
    this.lastReportedDegraded = degraded
    this.recordMainEvent({
      event: 'diagnostic.writer.health',
      priority: abnormalChanged ? 'critical' : 'normal',
      metadata: {
        eventsAccepted: health.eventsAccepted,
        eventsWritten: health.eventsWritten,
        eventsInvalid: health.invalidEvents,
        eventsDropped: health.droppedEvents,
        bytesWritten: health.bytesWritten,
        batchCount: health.batchCount,
        appendP95Ms: health.appendP95Ms,
        appendMaxMs: health.appendMaxMs,
        queueLagP95Ms: health.queueLagP95Ms,
        queueLagMaxMs: health.queueLagMaxMs,
        maxQueueBytes: health.maxQueueBytes,
        cleanupDurationMs: health.cleanupDurationMs,
        destinationFallbacks: health.destinationFallbacks,
        writerWriteActive: health.writerWriteActive,
        degraded,
      },
    })
  }

  private startEventLoopMonitor(): void {
    if (this.eventLoopTimer) return
    const intervalMs = 250
    this.expectedEventLoopTick = performance.now() + intervalMs
    this.eventLoopTimer = setInterval(() => {
      const now = performance.now()
      const lagMs = Math.max(0, now - this.expectedEventLoopTick)
      this.expectedEventLoopTick = now + intervalMs
      if (now < this.ignoreEventLoopLagUntil || lagMs < 100) return
      const hasActiveRendererOperation = [...this.operations.values()].some(operation => operation.active)
      if (this.activeMainOperations.size === 0 && !hasActiveRendererOperation && now > this.watchActivityTailUntil) return
      this.recordMainEvent({
        event: 'main.event-loop.window',
        metadata: {
          durationMs: lagMs,
          activeWatchOperations: [...this.activeMainOperations].filter(id => id.startsWith('watch_')).length,
          activeIndexBuilds: [...this.activeMainOperations].filter(id => id.startsWith('index_')).length,
          activeIndexReads: 0,
        },
        priority: lagMs >= 500 ? 'critical' : 'detail',
      })
    }, intervalMs)
    this.eventLoopTimer.unref?.()
  }

  private async resolveInitialDestination(): Promise<void> {
    const defaultDirectory = this.defaultDirectory
    if (!defaultDirectory) return
    await mkdir(defaultDirectory, { recursive: true, mode: 0o700 }).catch(() => {})

    let destination = defaultDirectory
    let nextState: DiagnosticLogState = 'ready'
    if (this.configuredDirectory) {
      try {
        destination = await this.validateCustomDirectory(this.configuredDirectory)
      } catch (error) {
        nextState = 'fallback'
        this.lastErrorCode = diagnosticCode(error, 'DIRECTORY_UNAVAILABLE')
        this.health.destinationFallbacks += 1
        try {
          await this.probeWritable(defaultDirectory)
        } catch {
          this.state = 'error'
          this.lastErrorCode = 'DEFAULT_DIRECTORY_UNAVAILABLE'
          return
        }
      }
    } else {
      try {
        await this.probeWritable(defaultDirectory)
      } catch {
        this.state = 'error'
        this.lastErrorCode = 'DEFAULT_DIRECTORY_UNAVAILABLE'
        return
      }
    }

    this.effectiveDirectory = destination
    this.state = this.settings.enabled ? nextState : 'disabled'
    if (nextState === 'fallback') {
      this.recordMainEvent({
        event: 'diagnostic.destination.fallback',
        priority: 'critical',
        metadata: { errorCode: this.lastErrorCode ?? 'DIRECTORY_UNAVAILABLE' },
      })
    }
    if (this.settings.enabled) this.scheduleFlush(true)
    void this.runMaintenance(this.settings, false)
  }

  private async initializePathKey(userDataDirectory: string): Promise<void> {
    const directory = path.join(userDataDirectory, 'diagnostics')
    const keyPath = path.join(directory, 'path-token.key')
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      let createdKeyFile = false
      try {
        const handle = await open(keyPath, 'wx', 0o600)
        createdKeyFile = true
        try {
          const key = randomBytes(INSTALL_KEY_BYTES)
          await handle.writeFile(key)
        } finally {
          await handle.close().catch(() => {})
        }
      } catch (error) {
        if (createdKeyFile) await unlink(keyPath).catch(() => {})
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const key = await readFile(keyPath)
      if (key.byteLength !== INSTALL_KEY_BYTES) throw new Error('invalid key size')
      this.pathKey = key
      this.pathCorrelation = 'installation'
    } catch {
      this.pathCorrelation = 'session-only'
      this.lastErrorCode = 'TOKEN_KEY_UNAVAILABLE'
    } finally {
      this.pathKeyInitialized = true
    }
  }

  private async probeWritable(directory: string): Promise<void> {
    await withTimeout(access(directory, fsConstants.W_OK), DIRECTORY_TIMEOUT_MS, 'DIRECTORY_NOT_WRITABLE')
    const probePath = path.join(directory, `.md-viewer-write-probe-${randomBytes(6).toString('hex')}`)
    let handle: FileHandle | null = null
    const pendingOpen = open(probePath, 'wx', 0o600)
    try {
      handle = await withTimeout(pendingOpen, DIRECTORY_TIMEOUT_MS, 'DIRECTORY_NOT_WRITABLE')
    } catch (error) {
      void pendingOpen.then(async lateHandle => {
        await lateHandle.close().catch(() => {})
        await unlink(probePath).catch(() => {})
      }).catch(() => {})
      throw error
    } finally {
      await handle?.close().catch(() => {})
      await unlink(probePath).catch(() => {})
    }
  }

  private async switchDestination(directory: string, state: DiagnosticLogState): Promise<void> {
    await this.flushAndClose()
    this.generation += 1
    this.effectiveDirectory = directory
    this.state = this.settings.enabled ? state : 'disabled'
    this.fastAppendStreak = 0
    this.lastErrorCode = undefined
    this.currentPath = null
    this.currentDate = ''
    this.currentSegment = 0
    this.currentBytes = 0
    if (this.settings.enabled) this.scheduleFlush(true)
    void this.runMaintenance(this.settings, false)
  }

  private enqueue(
    event: Omit<PersistedDiagnosticEvent, 'writerRecordedUnixMs'>,
    priority: DiagnosticEventPriority,
    paths: { rawPath?: string; rawWorkspacePath?: string } = {},
  ): void {
    if (!this.settings.enabled || this.state === 'disabled') return
    const estimatedEvent = {
      ...event,
      writerRecordedUnixMs: Date.now(),
      ...(paths.rawPath ? { pathToken: 'path_000000000000000000000000' } : {}),
      ...(paths.rawWorkspacePath ? { workspaceToken: 'path_000000000000000000000000' } : {}),
    }
    const estimatedBytes = Buffer.byteLength(JSON.stringify(estimatedEvent)) + 1
    if (estimatedBytes > MAX_EVENT_BYTES) {
      this.health.invalidEvents += 1
      this.healthDirty = true
      return
    }

    const item: QueuedEvent = {
      event,
      priority,
      estimatedBytes,
      queuedMonotonicMs: performance.now(),
      ...(paths.rawPath ? { rawPath: paths.rawPath } : {}),
      ...(paths.rawWorkspacePath ? { rawWorkspacePath: paths.rawWorkspacePath } : {}),
    }
    if (!this.makeQueueRoom(item)) {
      this.health.droppedEvents += 1
      this.healthDirty = true
      return
    }
    this.queue.push(item)
    this.queueBytes += estimatedBytes
    this.health.eventsAccepted += 1
    if (event.event !== 'diagnostic.writer.health') this.healthDirty = true
    this.health.maxQueueBytes = Math.max(this.health.maxQueueBytes, this.queueBytes)
    this.scheduleFlush(this.queueBytes >= BATCH_BYTES)
  }

  private makeQueueRoom(item: QueuedEvent): boolean {
    if (this.queueBytes + item.estimatedBytes <= MAX_QUEUE_BYTES) return true
    if (item.priority === 'detail') return false
    const minimumFree = item.priority === 'critical' ? CRITICAL_RESERVE_BYTES : item.estimatedBytes
    while (this.queue.length > 0 && this.queueBytes + minimumFree > MAX_QUEUE_BYTES) {
      const index = this.queue.findIndex(queued => queued.priority === 'detail')
      const fallbackIndex = item.priority === 'critical'
        ? this.queue.findIndex(queued => queued.priority === 'normal')
        : -1
      const removeIndex = index >= 0 ? index : fallbackIndex
      if (removeIndex < 0) break
      const [removed] = this.queue.splice(removeIndex, 1)
      this.queueBytes -= removed.estimatedBytes
      this.health.droppedEvents += 1
      this.healthDirty = true
    }
    return this.queueBytes + item.estimatedBytes <= MAX_QUEUE_BYTES
  }

  private scheduleFlush(immediate = false): void {
    if (!this.canWrite() || this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.enqueueFlush()
    }, immediate ? 0 : FLUSH_DELAY_MS)
    this.flushTimer.unref?.()
  }

  private enqueueFlush(): Promise<void> {
    this.writeChain = this.writeChain
      .then(() => this.performFlush())
      .catch(() => {})
    return this.writeChain
  }

  private async performFlush(): Promise<void> {
    if (!this.canWrite() || this.queue.length === 0) return
    const batch: QueuedEvent[] = []
    let batchBytes = 0
    while (this.queue.length > 0 && batchBytes < BATCH_BYTES) {
      const item = this.queue.shift()!
      this.queueBytes -= item.estimatedBytes
      batch.push(item)
      batchBytes += item.estimatedBytes
    }
    if (batch.length === 0) return

    const recordedAt = Date.now()
    const lines = batch.map(item => JSON.stringify({
      ...item.event,
      tokenScope: this.pathCorrelation,
      ...(item.rawPath ? { pathToken: this.pathToken(item.rawPath) } : {}),
      ...(item.rawWorkspacePath ? { workspaceToken: this.pathToken(item.rawWorkspacePath) } : {}),
      writerRecordedUnixMs: recordedAt,
    })).join('\n') + '\n'
    const bytes = Buffer.byteLength(lines)
    const generation = this.generation
    const started = performance.now()
    let appendStarted = false
    this.health.writerWriteActive = true
    try {
      const segmentRotated = await this.ensureSegment(bytes)
      if (!this.currentHandle) throw diagnosticError('WRITE_FAILED')
      appendStarted = true
      const append = this.options.appendFile
        ? this.options.appendFile(this.currentHandle, lines)
        : this.currentHandle.appendFile(lines, 'utf8').then(() => undefined)
      await withTimeout(append, this.options.writeTimeoutMs ?? WRITE_TIMEOUT_MS, 'WRITE_TIMEOUT')
      if (generation !== this.generation) return
      const duration = performance.now() - started
      this.currentBytes += bytes
      this.health.eventsWritten += batch.length
      this.health.bytesWritten += bytes
      this.health.batchCount += 1
      this.pushMetric(this.appendDurations, duration)
      if (duration >= WRITER_DEGRADED_MS && this.state === 'ready') {
        this.state = 'degraded'
        this.fastAppendStreak = 0
      } else if (this.state === 'degraded' && duration < WRITER_DEGRADED_MS / 2) {
        this.fastAppendStreak += 1
        if (this.fastAppendStreak >= 3) {
          this.state = 'ready'
          this.fastAppendStreak = 0
        }
      }
      for (const item of batch) this.pushMetric(this.queueLags, performance.now() - item.queuedMonotonicMs)
      if (segmentRotated || Date.now() - this.lastMaintenanceUnixMs >= MAINTENANCE_INTERVAL_MS) {
        void this.runMaintenance(this.settings, segmentRotated)
      }
    } catch (error) {
      // appendFile 失败或超时后，底层写入可能已经部分或完整落盘。此时重试同一批次会制造重复事件，
      // 因此只有在 append 尚未开始（例如 segment 创建失败）时才重排 critical 事件。
      for (const item of batch) {
        if (!appendStarted && item.priority === 'critical' && this.makeQueueRoom(item)) {
          this.queue.unshift(item)
          this.queueBytes += item.estimatedBytes
        } else {
          this.health.droppedEvents += 1
          this.healthDirty = true
        }
      }
      await this.handleWriteFailure(error)
    } finally {
      this.health.writerWriteActive = false
      if (this.queue.length > 0) this.scheduleFlush(true)
    }
  }

  private async ensureSegment(incomingBytes: number): Promise<boolean> {
    const directory = this.effectiveDirectory
    if (!directory) throw diagnosticError('WRITE_FAILED')
    const date = new Date().toISOString().slice(0, 10)
    if (
      this.currentHandle
      && this.currentDate === date
      && this.currentBytes + incomingBytes <= SEGMENT_BYTES
    ) return false

    await this.closeCurrentHandle()
    this.currentDate = date
    for (let offset = 0; offset < 100; offset += 1) {
      const segment = (this.currentSegment + offset) % 100
      const fileName = `md-viewer-events-${date}-${this.bootId}-${String(segment).padStart(2, '0')}.jsonl`
      const filePath = path.join(directory, fileName)
      try {
        this.currentHandle = await open(filePath, 'wx', 0o600)
        this.currentPath = filePath
        this.currentSegment = segment + 1
        this.currentBytes = 0
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw diagnosticError('WRITE_FAILED')
  }

  private async handleWriteFailure(error: unknown): Promise<void> {
    const code = diagnosticCode(error, 'WRITE_FAILED')
    this.lastErrorCode = code
    this.generation += 1
    void this.closeCurrentHandle()
    if (this.effectiveDirectory && this.defaultDirectory && this.effectiveDirectory !== this.defaultDirectory) {
      this.health.destinationFallbacks += 1
      this.effectiveDirectory = this.defaultDirectory
      this.state = 'fallback'
      this.currentPath = null
      this.currentDate = ''
      this.currentSegment = 0
      this.currentBytes = 0
      await mkdir(this.defaultDirectory, { recursive: true, mode: 0o700 }).catch(() => {})
      this.recordMainEvent({
        event: 'diagnostic.destination.fallback',
        priority: 'critical',
        metadata: { errorCode: code },
      })
      return
    }
    this.state = 'error'
  }

  private async flushAndClose(): Promise<void> {
    await this.flush().catch(() => {})
    await this.closeCurrentHandle()
  }

  private async closeCurrentHandle(): Promise<void> {
    const handle = this.currentHandle
    this.currentHandle = null
    this.currentPath = null
    if (handle) await handle.close().catch(() => {})
  }

  private async runMaintenance(
    policy: DiagnosticRetentionPolicy,
    force: boolean,
  ): Promise<MaintenanceResult> {
    let result: MaintenanceResult = {
      deletedFiles: 0,
      deletedBytes: 0,
      skippedActiveFiles: 0,
      partial: false,
    }
    this.maintenanceChain = this.maintenanceChain.then(async () => {
      result = await this.performMaintenance(policy, force)
    })
    await this.maintenanceChain
    return result
  }

  private async performMaintenance(
    policy: DiagnosticRetentionPolicy,
    force: boolean,
  ): Promise<MaintenanceResult> {
    if (!this.effectiveDirectory) {
      return { deletedFiles: 0, deletedBytes: 0, skippedActiveFiles: 0, partial: false }
    }
    if (!force && Date.now() - this.lastMaintenanceUnixMs < MAINTENANCE_INTERVAL_MS) {
      return { deletedFiles: 0, deletedBytes: 0, skippedActiveFiles: 0, partial: false }
    }
    const started = performance.now()
    this.lastMaintenanceUnixMs = Date.now()
    const files = await this.listLogFiles(this.effectiveDirectory).catch(() => [])
    const plan = this.buildCleanupPlan(files, policy)
    let deletedFiles = 0
    let deletedBytes = 0
    let partial = false
    for (const file of plan.files) {
      try {
        const info = await lstat(file.path)
        if (!info.isFile() || info.isSymbolicLink()) continue
        await unlink(file.path)
        deletedFiles += 1
        deletedBytes += file.size
      } catch {
        partial = true
      }
    }
    this.health.cleanupDurationMs = performance.now() - started
    if (partial) this.lastErrorCode = 'RETENTION_CLEANUP_PARTIAL'
    return {
      deletedFiles,
      deletedBytes,
      skippedActiveFiles: plan.skippedActiveFiles,
      partial,
    }
  }

  private buildCleanupPlan(
    files: LogFileInfo[],
    policy: DiagnosticRetentionPolicy,
  ): CleanupPlan {
    const sorted = [...files].sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
    const maxBytes = policy.maxTotalMiB * 1024 * 1024
    const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000
    const selected = new Set<string>()
    let remainingBytes = sorted.reduce((sum, file) => sum + file.size, 0)
    let remainingFiles = sorted.length
    let skippedActiveFiles = 0

    const canDelete = (file: LogFileInfo): boolean => {
      if (file.path === this.currentPath) return false
      if (file.bootFragment !== this.bootId && Date.now() - file.mtimeMs < ACTIVE_FOREIGN_FILE_MS) {
        skippedActiveFiles += 1
        return false
      }
      return true
    }

    for (const file of sorted) {
      if (file.mtimeMs >= cutoff) continue
      if (!canDelete(file)) continue
      selected.add(file.path)
      remainingBytes -= file.size
      remainingFiles -= 1
    }
    for (const file of sorted) {
      if (remainingBytes <= maxBytes && remainingFiles <= MAX_LOG_FILES) break
      if (selected.has(file.path) || !canDelete(file)) continue
      selected.add(file.path)
      remainingBytes -= file.size
      remainingFiles -= 1
    }

    const selectedFiles = sorted.filter(file => selected.has(file.path))
    return {
      files: selectedFiles,
      bytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
      skippedActiveFiles,
    }
  }

  private async listLogFiles(directory: string): Promise<LogFileInfo[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files: LogFileInfo[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = LOG_FILE_PATTERN.exec(entry.name)
      if (!match) continue
      const filePath = path.join(directory, entry.name)
      try {
        const info = await lstat(filePath)
        if (!info.isFile() || info.isSymbolicLink()) continue
        files.push({
          path: filePath,
          name: entry.name,
          date: match[1],
          bootFragment: match[2],
          segment: Number(match[3]),
          size: info.size,
          mtimeMs: info.mtimeMs,
          active: filePath === this.currentPath,
        })
      } catch {
        // 文件可能在其他进程轮转后消失。
      }
    }
    return files
  }

  private buildStatus(
    fileCount: number,
    totalBytes: number,
    oldestEventUnixMs: number | null,
  ): DiagnosticLogStatus {
    const effectiveCoverageDays = oldestEventUnixMs === null
      ? 0
      : Math.max(0, (Date.now() - oldestEventUnixMs) / (24 * 60 * 60 * 1000))
    const effectiveDirectory = this.effectiveDirectory
    const usingCustomDirectory = Boolean(
      this.configuredDirectory
      && effectiveDirectory
      && path.resolve(effectiveDirectory) === path.resolve(this.configuredDirectory),
    )
    return {
      state: this.state,
      enabled: this.settings.enabled,
      configuredDirectory: this.configuredDirectory,
      effectiveDirectory,
      defaultDirectory: this.defaultDirectory,
      usingCustomDirectory,
      usingFallback: this.state === 'fallback',
      maxTotalMiB: this.settings.maxTotalMiB,
      retentionDays: this.settings.retentionDays,
      fileCount,
      totalBytes,
      oldestEventUnixMs,
      effectiveCoverageDays,
      droppedEvents: this.health.droppedEvents,
      invalidEvents: this.health.invalidEvents,
      pathCorrelation: this.pathCorrelation,
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
      capabilities: {
        canChooseDirectory: true,
        canRetryDirectory: Boolean(this.configuredDirectory),
        canResetDirectory: Boolean(this.configuredDirectory),
        canOpenDirectory: Boolean(effectiveDirectory),
        canApplyRetention: true,
        canExportBundle: true,
        canClearLogs: Boolean(effectiveDirectory && fileCount > 0),
      },
    }
  }

  private pathToken(value: string): string {
    return `path_${createHmac('sha256', this.pathKey).update(path.resolve(value)).digest('hex').slice(0, 24)}`
  }

  private canWrite(): boolean {
    return this.initialized
      && this.settings.enabled
      && Boolean(this.effectiveDirectory)
      && this.state !== 'error'
  }

  private operationKey(senderId: number, operationId: string): string {
    return `${senderId}:${operationId}`
  }

  private pruneOperations(): void {
    const now = Date.now()
    for (const [key, operation] of this.operations) {
      if (operation.expiresAt >= now) continue
      if (operation.active) {
        const operationId = key.slice(key.indexOf(':') + 1)
        this.recordMainEvent({
          event: operation.kind === 'folder' ? 'folder.open.terminal' : 'file.open.terminal',
          operationId,
          outcome: 'incomplete',
          metadata: {
            source: 'unknown',
            durationMs: performance.now() - operation.startedMonotonicMs,
          },
          priority: 'critical',
        })
      }
      this.operations.delete(key)
    }
  }

  private pushMetric(values: number[], value: number): void {
    values.push(value)
    if (values.length > 100) values.shift()
  }
}

function parsePersistedEvent(line: string): PersistedDiagnosticEvent | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (event.schemaVersion !== DIAGNOSTIC_EVENT_SCHEMA_VERSION) return null
  if (typeof event.event !== 'string' || !DIAGNOSTIC_EVENT_NAMES.has(event.event as DiagnosticEventName)) return null
  if (typeof event.observedUnixMs !== 'number' || !Number.isFinite(event.observedUnixMs)) return null
  if (typeof event.monotonicMs !== 'number' || !Number.isFinite(event.monotonicMs)) return null
  if (event.processRole !== 'main' && event.processRole !== 'renderer') return null
  if (!isDiagnosticId(event.processInstanceId)) return null
  if (!Number.isSafeInteger(event.processSeq) || (event.processSeq as number) < 0) return null
  if (typeof event.writerRecordedUnixMs !== 'number' || !Number.isFinite(event.writerRecordedUnixMs)) return null
  if (typeof event.bootId !== 'string' || !/^boot_[a-f0-9]{12}$/.test(event.bootId)) return null
  if (event.tokenScope !== 'installation' && event.tokenScope !== 'session-only') return null
  if (event.operationId !== undefined && !isDiagnosticId(event.operationId)) return null
  if (event.spanId !== undefined && !isDiagnosticId(event.spanId)) return null
  if (event.parentSpanId !== undefined && !isDiagnosticId(event.parentSpanId)) return null
  if (event.outcome !== undefined && !isDiagnosticOperationOutcome(event.outcome)) return null
  if (event.pathToken !== undefined && (typeof event.pathToken !== 'string' || !/^path_[a-f0-9]{24}$/.test(event.pathToken))) return null
  if (event.workspaceToken !== undefined && (typeof event.workspaceToken !== 'string' || !/^path_[a-f0-9]{24}$/.test(event.workspaceToken))) return null
  const metadata = sanitizeDiagnosticMetadata(event.metadata)
  if (event.metadata !== undefined && metadata === null) return null

  const rendererCandidate = event.processRole === 'renderer'
    ? sanitizeRendererDiagnosticEvent({
        ...event,
        metadata,
      }, event.writerRecordedUnixMs as number)
    : null
  if (event.processRole === 'renderer' && !rendererCandidate) return null

  return {
    schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
    event: event.event as DiagnosticEventName,
    observedUnixMs: event.observedUnixMs,
    monotonicMs: event.monotonicMs,
    processRole: event.processRole,
    processInstanceId: event.processInstanceId,
    processSeq: event.processSeq as number,
    writerRecordedUnixMs: event.writerRecordedUnixMs,
    bootId: event.bootId,
    tokenScope: event.tokenScope,
    ...(typeof event.operationId === 'string' ? { operationId: event.operationId } : {}),
    ...(typeof event.spanId === 'string' ? { spanId: event.spanId } : {}),
    ...(typeof event.parentSpanId === 'string' ? { parentSpanId: event.parentSpanId } : {}),
    ...(typeof event.outcome === 'string' ? { outcome: event.outcome as DiagnosticOperationOutcome } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(typeof event.pathToken === 'string' ? { pathToken: event.pathToken } : {}),
    ...(typeof event.workspaceToken === 'string' ? { workspaceToken: event.workspaceToken } : {}),
  }
}

function eventPriority(event: DiagnosticEventName): DiagnosticEventPriority {
  if (
    event.endsWith('.start')
    || event.endsWith('.terminal')
    || event === 'diagnostic.writer.error'
    || event === 'diagnostic.destination.fallback'
  ) return 'critical'
  if (event.includes('activity') || event.includes('post-render')) return 'detail'
  return 'normal'
}

function diagnosticError(code: DiagnosticLogErrorCode): Error {
  return Object.assign(new Error(code), { code })
}

function diagnosticCode(error: unknown, fallback: DiagnosticLogErrorCode): DiagnosticLogErrorCode {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code
    if (code === 'DIRECTORY_UNAVAILABLE' || code === 'ENOENT' || code === 'ENOTDIR') return 'DIRECTORY_UNAVAILABLE'
    if (code === 'DIRECTORY_NOT_WRITABLE' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'DIRECTORY_NOT_WRITABLE'
    if (code === 'DIRECTORY_PROTECTED') return 'DIRECTORY_PROTECTED'
    if (code === 'WRITE_TIMEOUT') return 'WRITE_TIMEOUT'
    if (code === 'ENOSPC') return 'WRITE_FAILED'
  }
  return fallback
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: DiagnosticLogErrorCode,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(diagnosticError(code)), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

function max(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0
}

function emptyHealth(): DiagnosticWriterHealth {
  return {
    eventsAccepted: 0,
    eventsWritten: 0,
    invalidEvents: 0,
    droppedEvents: 0,
    bytesWritten: 0,
    batchCount: 0,
    appendP95Ms: 0,
    appendMaxMs: 0,
    queueLagP95Ms: 0,
    queueLagMaxMs: 0,
    maxQueueBytes: 0,
    cleanupDurationMs: 0,
    destinationFallbacks: 0,
    writerWriteActive: false,
  }
}

function emptySnapshot(): DiagnosticEventSnapshot {
  return {
    events: [],
    totalBytes: 0,
    invalidLines: 0,
    truncated: false,
    omittedFiles: 0,
    oldestEventUnixMs: null,
    newestEventUnixMs: null,
  }
}
