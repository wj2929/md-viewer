export const DIAGNOSTIC_EVENT_SCHEMA_VERSION = 1 as const

export const DIAGNOSTIC_LOG_SIZE_OPTIONS = [10, 25, 50] as const
export const DIAGNOSTIC_LOG_RETENTION_OPTIONS = [7, 14, 30] as const

export type DiagnosticLogMaxTotalMiB = typeof DIAGNOSTIC_LOG_SIZE_OPTIONS[number]
export type DiagnosticLogRetentionDays = typeof DIAGNOSTIC_LOG_RETENTION_OPTIONS[number]

export interface DiagnosticLogSettings {
  enabled: boolean
  directory?: string
  maxTotalMiB: DiagnosticLogMaxTotalMiB
  retentionDays: DiagnosticLogRetentionDays
}

export const DEFAULT_DIAGNOSTIC_LOG_SETTINGS: DiagnosticLogSettings = {
  enabled: true,
  maxTotalMiB: 10,
  retentionDays: 7,
}

export type DiagnosticLogState =
  | 'initializing'
  | 'ready'
  | 'fallback'
  | 'disabled'
  | 'degraded'
  | 'error'

export type DiagnosticPathCorrelation = 'installation' | 'session-only'

export interface DiagnosticLogCapabilities {
  canChooseDirectory: boolean
  canRetryDirectory: boolean
  canResetDirectory: boolean
  canOpenDirectory: boolean
  canApplyRetention: boolean
  canExportBundle: boolean
  canClearLogs: boolean
}

export interface DiagnosticLogStatus {
  state: DiagnosticLogState
  enabled: boolean
  configuredDirectory: string | null
  effectiveDirectory: string | null
  defaultDirectory: string | null
  usingCustomDirectory: boolean
  usingFallback: boolean
  maxTotalMiB: DiagnosticLogMaxTotalMiB
  retentionDays: DiagnosticLogRetentionDays
  fileCount: number
  totalBytes: number
  oldestEventUnixMs: number | null
  effectiveCoverageDays: number
  droppedEvents: number
  invalidEvents: number
  pathCorrelation: DiagnosticPathCorrelation
  lastErrorCode?: DiagnosticLogErrorCode
  capabilities: DiagnosticLogCapabilities
}

export type DiagnosticLogErrorCode =
  | 'DIRECTORY_UNAVAILABLE'
  | 'DIRECTORY_NOT_WRITABLE'
  | 'DIRECTORY_PROTECTED'
  | 'DEFAULT_DIRECTORY_UNAVAILABLE'
  | 'WRITE_FAILED'
  | 'WRITE_TIMEOUT'
  | 'OPEN_DIRECTORY_FAILED'
  | 'CLEAR_FAILED'
  | 'RETENTION_CLEANUP_PARTIAL'
  | 'TOKEN_KEY_UNAVAILABLE'
  | 'BUNDLE_READ_FAILED'

export type DiagnosticOperationOutcome =
  | 'success'
  | 'error'
  | 'cancel'
  | 'superseded'
  | 'timeout'
  | 'incomplete'
  | 'observed'

export type DiagnosticEventName =
  | 'clock.anchor'
  | 'session.start'
  | 'session.end'
  | 'diagnostic.destination.fallback'
  | 'diagnostic.writer.health'
  | 'diagnostic.writer.error'
  | 'folder.open.start'
  | 'folder.open.summary'
  | 'folder.open.terminal'
  | 'folder.scan.summary'
  | 'file.open.start'
  | 'file.io.summary'
  | 'file.io.client'
  | 'file.preview.summary'
  | 'file.preview.post-render'
  | 'file.preview.state'
  | 'file.open.terminal'
  | 'workspace.pane.change'
  | 'index.work.start'
  | 'index.activity.window'
  | 'index.query.window'
  | 'index.work.summary'
  | 'index.work.terminal'
  | 'main.event-loop.window'
  | 'watcher.work.start'
  | 'watcher.work.summary'
  | 'watcher.work.terminal'

export type RendererDiagnosticEventName =
  | 'clock.anchor'
  | 'folder.open.summary'
  | 'folder.open.terminal'
  | 'file.open.start'
  | 'file.io.client'
  | 'file.preview.summary'
  | 'file.preview.post-render'
  | 'file.preview.state'
  | 'file.open.terminal'
  | 'workspace.pane.change'

export type PreviewDiagnosticState = 'loading-approval' | 'awaiting-choice' | 'source-ready' | 'render-requested' | 'dom-committed' | 'awaiting-visibility' | 'preview-core-ready' | 'preview-ready' | 'unmounted'

export const PREVIEW_DIAGNOSTIC_STATES: readonly PreviewDiagnosticState[] = [
  'loading-approval', 'awaiting-choice', 'source-ready', 'render-requested', 'dom-committed', 'awaiting-visibility', 'preview-core-ready', 'preview-ready', 'unmounted',
]

export const PANE_DIAGNOSTIC_SOURCES = [
  'unspecified', 'workspace-hydrate', 'restore-pinned', 'restore-folder-session',
  'folder-switch', 'refresh-existing-tab', 'recent-file', 'remove-tabs', 'close-tab',
  'file-select', 'external-file', 'new-file', 'tab-click', 'active-tab-sync', 'bookmark',
  'next-tab', 'previous-tab', 'switch-tab', 'panel-split', 'panel-close',
  'panel-resize', 'panel-click', 'panel-context-menu', 'panel-drop', 'panel-swap',
  'keyboard-split', 'ipc-file-deleted', 'ipc-close-tabs', 'ipc-tab-split', 'ipc-file-split',
] as const

export interface PaneDiagnosticCause {
  source: typeof PANE_DIAGNOSTIC_SOURCES[number]
  inputTrusted?: boolean
  operationId?: string
}

export type DiagnosticEventPriority = 'critical' | 'normal' | 'detail'
export type DiagnosticProcessRole = 'main' | 'renderer'

export type DiagnosticMetricValue = string | number | boolean | null
export type DiagnosticMetadata = Record<string, DiagnosticMetricValue>

export interface RendererDiagnosticEventInput {
  schemaVersion: typeof DIAGNOSTIC_EVENT_SCHEMA_VERSION
  event: RendererDiagnosticEventName
  observedUnixMs: number
  monotonicMs: number
  processInstanceId: string
  processSeq: number
  operationId?: string
  spanId?: string
  parentSpanId?: string
  outcome?: DiagnosticOperationOutcome
  metadata?: DiagnosticMetadata
}

export interface PersistedDiagnosticEvent {
  schemaVersion: typeof DIAGNOSTIC_EVENT_SCHEMA_VERSION
  event: DiagnosticEventName
  observedUnixMs: number
  monotonicMs: number
  processRole: DiagnosticProcessRole
  processInstanceId: string
  processSeq: number
  writerRecordedUnixMs: number
  bootId: string
  tokenScope: DiagnosticPathCorrelation
  operationId?: string
  spanId?: string
  parentSpanId?: string
  outcome?: DiagnosticOperationOutcome
  pathToken?: string
  workspaceToken?: string
  metadata?: DiagnosticMetadata
}

export interface DiagnosticTraceContext {
  operationId: string
  source: DiagnosticSource
  rendererStartedUnixMs?: number
}

export type DiagnosticSource =
  | 'user'
  | 'restore'
  | 'recent'
  | 'tab'
  | 'watcher'
  | 'manual-refresh'
  | 'open-specific-file'
  | 'recovery'
  | 'export'
  | 'unknown'

export interface DiagnosticRetentionPolicy {
  maxTotalMiB: DiagnosticLogMaxTotalMiB
  retentionDays: DiagnosticLogRetentionDays
}

export interface DiagnosticRetentionResult {
  canceled: boolean
  applied: boolean
  status: DiagnosticLogStatus
  deletedFiles?: number
  deletedBytes?: number
  skippedActiveFiles?: number
  partial?: boolean
}

export interface DiagnosticDirectoryResult {
  canceled: boolean
  status: DiagnosticLogStatus
  message?: string
}

export interface DiagnosticClearResult {
  canceled: boolean
  deletedFiles: number
  deletedBytes: number
  skippedActiveFiles: number
  partial: boolean
  status: DiagnosticLogStatus
}

export interface DiagnosticOpenDirectoryResult {
  success: boolean
  error?: string
}

export const DIAGNOSTIC_EVENT_NAMES = new Set<DiagnosticEventName>([
  'clock.anchor',
  'session.start',
  'session.end',
  'diagnostic.destination.fallback',
  'diagnostic.writer.health',
  'diagnostic.writer.error',
  'folder.open.start',
  'folder.open.summary',
  'folder.open.terminal',
  'folder.scan.summary',
  'file.open.start',
  'file.io.summary',
  'file.io.client',
  'file.preview.summary',
  'file.preview.post-render',
  'file.preview.state',
  'file.open.terminal',
  'workspace.pane.change',
  'index.work.start',
  'index.activity.window',
  'index.query.window',
  'index.work.summary',
  'index.work.terminal',
  'main.event-loop.window',
  'watcher.work.start',
  'watcher.work.summary',
  'watcher.work.terminal',
])

export const RENDERER_DIAGNOSTIC_EVENT_NAMES = new Set<RendererDiagnosticEventName>([
  'clock.anchor',
  'folder.open.summary',
  'folder.open.terminal',
  'file.open.start',
  'file.io.client',
  'file.preview.summary',
  'file.preview.post-render',
  'file.preview.state',
  'file.open.terminal',
  'workspace.pane.change',
])

const DIAGNOSTIC_SOURCES = new Set<DiagnosticSource>([
  'user',
  'restore',
  'recent',
  'tab',
  'watcher',
  'manual-refresh',
  'open-specific-file',
  'recovery',
  'export',
  'unknown',
])

const DIAGNOSTIC_OUTCOMES = new Set<DiagnosticOperationOutcome>([
  'success',
  'error',
  'cancel',
  'superseded',
  'timeout',
  'incomplete',
  'observed',
])

const DIAGNOSTIC_METADATA_KEYS = new Set([
  'paneSource', 'paneAction', 'workspaceTraceId', 'workspaceEpoch', 'hydrationGeneration',
  'paneSequence', 'lastTabChangeSequence', 'beforeLeafPosition', 'afterLeafPosition',
  'beforeTabSlot', 'afterTabSlot', 'beforeLeafTabSlot', 'afterLeafTabSlot',
  'tabChanged', 'leafChanged', 'leafDocumentChanged', 'inputTrusted',
  'source',
  'workloadKind',
  'cacheOutcome',
  'panelKind',
  'state',
  'tokenScope',
  'errorCode',
  'joinedSingleFlight',
  'resultApplied',
  'documentVisible',
  'isActiveLeaf',
  'observerSupported',
  'ringTruncated',
  'writerWriteActive',
  'destinationSharesWorkspace',
  'degraded',
  'partial',
  'truncated',
  'authorizationMs',
  'realpathMs',
  'statMs',
  'readWallMs',
  'mainHandlerMs',
  'ipcRoundTripMs',
  'stateCommitMs',
  'activationMs',
  'globMs',
  'treeBuildMs',
  'sortMs',
  'firstTreeReadyMs',
  'queueWaitMs',
  'lockWaitMs',
  'cacheLoadMs',
  'hashDurationMs',
  'analyzeDurationMs',
  'commitDurationMs',
  'markdownRenderMs',
  'sanitizeMs',
  'debounceDelayMs',
  'domPopulateMs',
  'sourceMappingMs',
  'editableAnnotationMs',
  'coreReadyMs',
  'postRenderMs',
  'maxRafLagMs',
  'durationMs',
  'watchGeneration',
  'watchReason',
  'watchKind', 'watchStage', 'watchErrorCode', 'stageAgeMs', 'startupElapsedMs',
  'acceptedMs', 'childElapsedMs', 'lastPongAgeMs', 'watchPathChecks', 'watchDirectoryChecks',
  'processExitConfirmed', 'watchSubscriptionCount', 'failedWatchCount', 'startupRecoveryPending',
  'watchRetryStage', 'watchRetryReason', 'watchSelectedCount', 'watchRootSelected', 'watchOpenedSelectedCount',
  'watchCapacitySkippedCount', 'watchRetryEligibleCount', 'watchProcessPresent', 'watchProcessBooting', 'watchRestartScheduled',
  'recycleReason',
  'watchRetryCount',
  'processGeneration',
  'gapVersion',
  'reconciledGapVersion',
  'watchErrorCount',
  'watchDirectoryCount',
  'watchEntryCount',
  'excludedDirectoryCount',
  'activeWatchOperations',
  'count50ms',
  'totalLongTaskMs',
  'maxLongTaskMs',
  'matchedFileCount',
  'matchedDirectoryCount',
  'rootNodeCount',
  'activeIndexBuilds',
  'activeIndexReads',
  'indexBytesReadRecent',
  'filesProcessed',
  'bytesRead',
  'bytesReadForValidation',
  'readAvoidedCount',
  'contentReusedAfterFullRead',
  'analysisSkippedAfterHash',
  'statusPublishCount',
  'backlinksQueryCount',
  'queryCount',
  'operationCount',
  'successCount',
  'errorCount',
  'slowCount',
  'durationP50Ms',
  'durationP95Ms',
  'durationMaxMs',
  'windowDurationMs',
  'candidateCount',
  'cutoffDurationMs',
  'documentsPerSecond',
  'mibPerSecond',
  'domNodeCount',
  'codeBlockCount',
  'tableCount',
  'chartCount',
  'pendingChartCount',
  'renderedChartCount',
  'failedChartCount',
  'imageCount',
  'mediaCount',
  'eventsAccepted',
  'eventsWritten',
  'eventsInvalid',
  'eventsDropped',
  'bytesWritten',
  'batchCount',
  'appendP95Ms',
  'appendMaxMs',
  'queueLagP95Ms',
  'queueLagMaxMs',
  'maxQueueBytes',
  'cleanupDurationMs',
  'destinationFallbacks',
  'fileSizeBucket',
  'lineCountBucket',
  'activeWorkloadKinds',
  'requestId',
  'workId',
  'indexBuildId',
  'previewInstanceId',
  'previewState',
  'relatedOperationId',
  'selection',
  'sampleRate',
])

const DIAGNOSTIC_METADATA_ID_KEYS = new Set([
  'requestId',
  'workId',
  'indexBuildId',
  'previewInstanceId',
])

const SAFE_METADATA_STRINGS = new Set([
  'create-sent', 'accepted', 'path-check-start', 'path-checked', 'watch-create-start', 'watch-created', 'crawl-progress',
  'root', 'file', 'starting', 'recovering', 'healthy',
  'EMFILE', 'ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'OVERFLOW', 'UNKNOWN',
  'resource', 'permission', 'timeout', 'process', 'overflow', 'reconcile', 'protocol',
  'idle', 'planned-recycle', 'abnormal', 'shutdown', 'retry',
  'user',
  'restore',
  'recent',
  'tab',
  'watcher',
  'manual-refresh',
  'open-specific-file',
  'recovery',
  'export',
  'unknown',
  'build',
  'delta',
  'query',
  'backlinks',
  'commit',
  'actual-hit',
  'bypass-force-reload',
  'miss',
  'invalidated-by-watcher',
  'main',
  'split',
  'editor',
  'ready',
  'building',
  'updating',
  'degraded',
  'read-only',
  'error',
  'detached',
  'installation',
  'session-only',
  'topK',
  'DIRECTORY_UNAVAILABLE',
  'DIRECTORY_NOT_WRITABLE',
  'DIRECTORY_PROTECTED',
  'DEFAULT_DIRECTORY_UNAVAILABLE',
  'WRITE_FAILED',
  'WRITE_TIMEOUT',
  'OPEN_DIRECTORY_FAILED',
  'CLEAR_FAILED',
  'RETENTION_CLEANUP_PARTIAL',
  'TOKEN_KEY_UNAVAILABLE',
  'BUNDLE_READ_FAILED',
  'FOLDER_ACTIVATION_FAILED',
  'DIRECTORY_SCAN_FAILED',
  'FILE_AUTHORIZATION_FAILED',
  'FILE_STAT_FAILED',
  'FILE_READ_FAILED',
  'FILE_TOO_LARGE',
  'INDEX_WORK_FAILED',
  '0-4KiB',
  '4-16KiB',
  '16-64KiB',
  '64-256KiB',
  '256KiB-1MiB',
  '1-5MiB',
  '5MiB+',
  '0-100',
  '101-500',
  '501-2000',
  '2001-10000',
  '10000+',
])

const ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const MAX_METADATA_FIELDS = 80
const MAX_EVENT_AGE_MS = 5 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 60 * 1000

export function normalizeDiagnosticLogSettings(value: unknown): DiagnosticLogSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_DIAGNOSTIC_LOG_SETTINGS }
  }
  const candidate = value as Record<string, unknown>
  const maxTotalMiB = isDiagnosticLogSize(candidate.maxTotalMiB)
    ? candidate.maxTotalMiB
    : DEFAULT_DIAGNOSTIC_LOG_SETTINGS.maxTotalMiB
  const retentionDays = isDiagnosticRetentionDays(candidate.retentionDays)
    ? candidate.retentionDays
    : DEFAULT_DIAGNOSTIC_LOG_SETTINGS.retentionDays
  return {
    enabled: candidate.enabled !== false,
    ...(typeof candidate.directory === 'string' && candidate.directory.trim()
      ? { directory: candidate.directory }
      : {}),
    maxTotalMiB,
    retentionDays,
  }
}

export function isDiagnosticLogSize(value: unknown): value is DiagnosticLogMaxTotalMiB {
  return typeof value === 'number'
    && DIAGNOSTIC_LOG_SIZE_OPTIONS.includes(value as DiagnosticLogMaxTotalMiB)
}

export function isDiagnosticRetentionDays(value: unknown): value is DiagnosticLogRetentionDays {
  return typeof value === 'number'
    && DIAGNOSTIC_LOG_RETENTION_OPTIONS.includes(value as DiagnosticLogRetentionDays)
}

export function isDiagnosticRetentionPolicy(value: unknown): value is DiagnosticRetentionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  return isDiagnosticLogSize(policy.maxTotalMiB)
    && isDiagnosticRetentionDays(policy.retentionDays)
}

export function isDiagnosticOperationOutcome(value: unknown): value is DiagnosticOperationOutcome {
  return typeof value === 'string'
    && DIAGNOSTIC_OUTCOMES.has(value as DiagnosticOperationOutcome)
}

export function sanitizeDiagnosticTraceContext(value: unknown): DiagnosticTraceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!isDiagnosticId(candidate.operationId)) return null
  if (typeof candidate.source !== 'string' || !DIAGNOSTIC_SOURCES.has(candidate.source as DiagnosticSource)) return null
  if (
    candidate.rendererStartedUnixMs !== undefined
    && !isFiniteNonNegative(candidate.rendererStartedUnixMs)
  ) return null
  return {
    operationId: candidate.operationId,
    source: candidate.source as DiagnosticSource,
    ...(typeof candidate.rendererStartedUnixMs === 'number'
      ? { rendererStartedUnixMs: candidate.rendererStartedUnixMs }
      : {}),
  }
}

export function sanitizeRendererDiagnosticEvent(
  value: unknown,
  now = Date.now(),
): RendererDiagnosticEventInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (event.schemaVersion !== DIAGNOSTIC_EVENT_SCHEMA_VERSION) return null
  if (typeof event.event !== 'string' || !RENDERER_DIAGNOSTIC_EVENT_NAMES.has(event.event as RendererDiagnosticEventName)) return null
  if (!isFiniteNonNegative(event.observedUnixMs) || Math.abs((event.observedUnixMs as number) - now) > MAX_EVENT_AGE_MS + MAX_FUTURE_SKEW_MS) return null
  if (!isFiniteNonNegative(event.monotonicMs)) return null
  if (typeof event.processInstanceId !== 'string' || !ID_PATTERN.test(event.processInstanceId)) return null
  if (!Number.isSafeInteger(event.processSeq) || (event.processSeq as number) < 0) return null
  if (event.operationId !== undefined && (typeof event.operationId !== 'string' || !ID_PATTERN.test(event.operationId))) return null
  if (event.spanId !== undefined && (typeof event.spanId !== 'string' || !ID_PATTERN.test(event.spanId))) return null
  if (event.parentSpanId !== undefined && (typeof event.parentSpanId !== 'string' || !ID_PATTERN.test(event.parentSpanId))) return null
  if (event.outcome !== undefined && (typeof event.outcome !== 'string' || !DIAGNOSTIC_OUTCOMES.has(event.outcome as DiagnosticOperationOutcome))) return null
  const metadata = sanitizeDiagnosticMetadata(event.metadata)
  if (event.metadata !== undefined && metadata === null) return null
  if (event.event === 'file.preview.state' && (
    event.operationId !== undefined || !metadata
    || typeof metadata.previewState !== 'string'
    || !PREVIEW_DIAGNOSTIC_STATES.includes(metadata.previewState as PreviewDiagnosticState)
    || typeof metadata.previewInstanceId !== 'string' || !ID_PATTERN.test(metadata.previewInstanceId)
  )) return null

  return {
    schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
    event: event.event as RendererDiagnosticEventName,
    observedUnixMs: event.observedUnixMs as number,
    monotonicMs: event.monotonicMs as number,
    processInstanceId: event.processInstanceId,
    processSeq: event.processSeq as number,
    ...(event.operationId ? { operationId: event.operationId as string } : {}),
    ...(event.spanId ? { spanId: event.spanId as string } : {}),
    ...(event.parentSpanId ? { parentSpanId: event.parentSpanId as string } : {}),
    ...(event.outcome ? { outcome: event.outcome as DiagnosticOperationOutcome } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

export function sanitizeDiagnosticMetadata(value: unknown): DiagnosticMetadata | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_METADATA_FIELDS) return null
  const sanitized: DiagnosticMetadata = {}
  for (const [key, raw] of entries) {
    if (!DIAGNOSTIC_METADATA_KEYS.has(key)) return null
    if (key === 'watchRetryStage' || key === 'watchRetryReason') {
      const allowed = key === 'watchRetryStage'
        ? ['received', 'context-rejected', 'subscriptions-selected', 'host-skipped', 'restart-requested']
        : ['no-subscriptions', 'shutting-down', 'stopping', 'cooldown']
      if (typeof raw !== 'string' || !allowed.includes(raw)) return null
      sanitized[key] = raw
      continue
    }
    if (key === 'previewState' || key === 'relatedOperationId') {
      if (typeof raw !== 'string' || (key === 'previewState'
        ? !PREVIEW_DIAGNOSTIC_STATES.includes(raw as PreviewDiagnosticState)
        : !ID_PATTERN.test(raw))) return null
      sanitized[key] = raw
      continue
    }
    if (key === 'paneSource' || key === 'paneAction' || key === 'beforeLeafPosition' || key === 'afterLeafPosition' || key === 'workspaceTraceId') {
      const valid = key === 'paneSource'
        ? PANE_DIAGNOSTIC_SOURCES.includes(raw as PaneDiagnosticCause['source'])
        : key === 'paneAction'
          ? raw === 'hydrate' || raw === 'tab' || raw === 'split'
          : key === 'workspaceTraceId'
            ? raw === null || (typeof raw === 'string' && /^workspace_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw))
            : typeof raw === 'string' && /^(none|missing|root(?:\.(?:first|second)){0,3})$/.test(raw)
      if (!valid) return null
      sanitized[key] = raw as string | null
      continue
    }
    if (raw === null || typeof raw === 'boolean') {
      sanitized[key] = raw
      continue
    }
    if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= Number.MAX_SAFE_INTEGER) {
      sanitized[key] = raw
      continue
    }
    if (typeof raw === 'string' && DIAGNOSTIC_METADATA_ID_KEYS.has(key) && ID_PATTERN.test(raw)) {
      sanitized[key] = raw
      continue
    }
    if (typeof raw === 'string' && raw.length <= 96 && SAFE_METADATA_STRINGS.has(raw)) {
      sanitized[key] = raw
      continue
    }
    return null
  }
  return sanitized
}

export function isDiagnosticId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
