import type { PersistedDiagnosticEvent, PreviewDiagnosticState } from '../../src/shared/diagnostics'

type ReadinessEvent = Pick<PersistedDiagnosticEvent, 'event' | 'processInstanceId' | 'processSeq' | 'operationId' | 'outcome' | 'metadata'>

/** 输入须为同一 boot 的已校验日志；读取成功不能替代明确的预览状态。 */
export function inspectPreviewReadiness(events: readonly ReadinessEvent[], expectedOperations: number) {
  const starts = new Map<string, ReadinessEvent>()
  const latest = new Map<string, ReadinessEvent>()
  const reads = new Set<string>()
  for (const event of events) {
    const operationKey = `${event.processInstanceId}:${event.operationId}`
    if (event.event === 'file.open.start' && event.metadata?.source === 'restore' && event.operationId) starts.set(operationKey, event)
    if (event.event === 'file.io.client' && event.outcome === 'success' && event.operationId) reads.add(operationKey)
    if (event.event !== 'file.preview.state' || typeof event.metadata?.previewInstanceId !== 'string') continue
    const key = `${event.processInstanceId}:${event.metadata.previewInstanceId}`
    const previous = latest.get(key)
    if (!previous || event.processSeq > previous.processSeq) latest.set(key, event)
  }
  const operations = [...starts].map(([key, start]) => {
    const previewStates = [...latest.values()]
      .filter(event => event.processInstanceId === start.processInstanceId && event.metadata?.relatedOperationId === start.operationId)
      .map(event => event.metadata!.previewState as PreviewDiagnosticState)
      .filter(state => state !== 'unmounted')
    const readSucceeded = reads.has(key)
    const ready = readSucceeded && previewStates.length > 0 && previewStates.every(state =>
      state === 'awaiting-choice' || state === 'source-ready' || state === 'preview-ready')
    return { operationId: start.operationId!, processInstanceId: start.processInstanceId, readSucceeded, previewStates, ready }
  })
  return { ready: operations.length === expectedOperations && operations.every(operation => operation.ready), operations }
}
