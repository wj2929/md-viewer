import {
  DIAGNOSTIC_EVENT_SCHEMA_VERSION,
  type DiagnosticMetadata,
  type DiagnosticOperationOutcome,
  type DiagnosticSource,
  type DiagnosticTraceContext,
  type PreviewDiagnosticState,
  type RendererDiagnosticEventName,
  type RendererDiagnosticEventInput,
} from '../../../shared/diagnostics'

export interface RendererFileDiagnosticOperation {
  context: DiagnosticTraceContext
  startedMonotonicMs: number
  startedUnixMs: number
}

interface LongTaskSample {
  startTime: number
  duration: number
}

const processInstanceId = `renderer_${crypto.randomUUID()}`
let processSequence = 0
const MAX_TRACKED_OPERATIONS = 2048
const terminalOperations = new Set<string>()
const previewSummaries = new Set<string>()
const postRenderSnapshots = new Set<string>()
const folderTreeReadyOperations = new Set<string>()
const longTasks: LongTaskSample[] = []
let longTaskRingTruncated = false
let observerSupported = false

if (typeof PerformanceObserver !== 'undefined') {
  try {
    const supported = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false
    if (supported) {
      const observer = new PerformanceObserver(list => {
        observerSupported = true
        for (const entry of list.getEntries()) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration })
          if (longTasks.length > 200) {
            longTasks.shift()
            longTaskRingTruncated = true
          }
        }
      })
      observer.observe({ type: 'longtask', buffered: true })
      observerSupported = true
    }
  } catch {
    observerSupported = false
  }
}

export function recordFolderTreeReady(input: {
  operationId: string
  startedMonotonicMs: number
  source?: DiagnosticSource
  resultApplied: boolean
  rootNodeCount: number
  outcome: 'success' | 'error' | 'superseded'
}): void {
  if (!rememberOperation(folderTreeReadyOperations, input.operationId)) return
  const durationMs = performance.now() - input.startedMonotonicMs
  recordRendererDiagnosticEvent({
    event: 'folder.open.summary',
    operationId: input.operationId,
    outcome: input.outcome,
    metadata: {
      source: input.source ?? 'unknown',
      firstTreeReadyMs: durationMs,
      resultApplied: input.resultApplied,
      rootNodeCount: input.rootNodeCount,
    },
  })
  recordRendererDiagnosticEvent({
    event: 'folder.open.terminal',
    operationId: input.operationId,
    outcome: input.outcome,
    metadata: {
      source: input.source ?? 'unknown',
      durationMs,
      resultApplied: input.resultApplied,
    },
  })
}

export function startFileDiagnostic(source: DiagnosticSource): RendererFileDiagnosticOperation {
  const startedMonotonicMs = performance.now()
  const startedUnixMs = Date.now()
  const operation: RendererFileDiagnosticOperation = {
    context: {
      operationId: `file_${crypto.randomUUID()}`,
      source,
      rendererStartedUnixMs: startedUnixMs,
    },
    startedMonotonicMs,
    startedUnixMs,
  }
  recordRendererDiagnosticEvent({
    event: 'file.open.start',
    operationId: operation.context.operationId,
    metadata: { source },
  })
  return operation
}

export function recordFileIoClient(
  operation: RendererFileDiagnosticOperation,
  ipcRoundTripMs: number,
  cacheOutcome: 'actual-hit' | 'bypass-force-reload' | 'miss' | 'invalidated-by-watcher',
  outcome: 'success' | 'error',
): void {
  recordRendererDiagnosticEvent({
    event: 'file.io.client',
    operationId: operation.context.operationId,
    outcome,
    metadata: {
      source: operation.context.source,
      ipcRoundTripMs,
      cacheOutcome,
    },
  })
}

export function recordFileTerminal(
  operation: RendererFileDiagnosticOperation,
  outcome: DiagnosticOperationOutcome,
  metadata: DiagnosticMetadata = {},
): void {
  if (!rememberOperation(terminalOperations, operation.context.operationId)) return
  recordRendererDiagnosticEvent({
    event: 'file.open.terminal',
    operationId: operation.context.operationId,
    outcome,
    metadata: {
      source: operation.context.source,
      durationMs: performance.now() - operation.startedMonotonicMs,
      ...metadata,
    },
  })
}

export function recordPreviewSummary(
  operationId: string,
  metadata: DiagnosticMetadata,
  outcome: DiagnosticOperationOutcome = 'observed',
): void {
  if (!rememberOperation(previewSummaries, operationId)) return
  recordRendererDiagnosticEvent({
    event: 'file.preview.summary',
    operationId,
    outcome,
    metadata,
  })
}

export function recordPreviewState(
  previewInstanceId: string,
  previewState: PreviewDiagnosticState,
  operation: DiagnosticTraceContext | undefined,
  panelKind: 'main' | 'split' | 'editor',
): void {
  // 关联 ID 仅用于日志，不延长文件读取授权或在等待用户时重发 open.start。
  recordRendererDiagnosticEvent({
    event: 'file.preview.state',
    metadata: {
      previewInstanceId,
      previewState,
      panelKind,
      source: operation?.source ?? 'unknown',
      ...(operation ? { relatedOperationId: operation.operationId } : {}),
    },
  })
}

export function recordPostRenderSnapshot(
  operationId: string,
  metadata: DiagnosticMetadata,
  outcome: 'observed' | 'superseded' | 'timeout',
): void {
  if (!rememberOperation(postRenderSnapshots, operationId)) return
  recordRendererDiagnosticEvent({
    event: 'file.preview.post-render',
    operationId,
    outcome,
    metadata,
  })
}

export function longTaskSummary(startMonotonicMs: number, endMonotonicMs = performance.now()): DiagnosticMetadata {
  const selected = longTasks.filter(entry =>
    entry.startTime >= startMonotonicMs && entry.startTime <= endMonotonicMs
  )
  return {
    observerSupported,
    count50ms: selected.length,
    totalLongTaskMs: selected.reduce((sum, entry) => sum + entry.duration, 0),
    maxLongTaskMs: selected.reduce((maximum, entry) => Math.max(maximum, entry.duration), 0),
    ringTruncated: longTaskRingTruncated,
    documentVisible: document.visibilityState === 'visible',
  }
}

export function recordClockAnchor(): void {
  recordRendererDiagnosticEvent({ event: 'clock.anchor' })
}

function rememberOperation(operations: Set<string>, operationId: string): boolean {
  if (operations.has(operationId)) return false
  operations.add(operationId)
  if (operations.size > MAX_TRACKED_OPERATIONS) {
    const oldest = operations.values().next().value
    if (oldest) operations.delete(oldest)
  }
  return true
}

export function recordRendererDiagnosticEvent(input: {
  event: RendererDiagnosticEventName
  operationId?: string
  outcome?: DiagnosticOperationOutcome
  metadata?: DiagnosticMetadata
}): void {
  const event: RendererDiagnosticEventInput = {
    schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
    event: input.event,
    observedUnixMs: Date.now(),
    monotonicMs: performance.now(),
    processInstanceId,
    processSeq: processSequence++,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
  try {
    window.api.recordDiagnosticRendererEvent(event)
  } catch {
    // 诊断记录不得影响文件浏览。
  }
}
