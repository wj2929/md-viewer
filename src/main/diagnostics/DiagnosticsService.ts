import AdmZip from 'adm-zip'
import { createHmac, randomBytes } from 'crypto'
import { mkdir, rename, writeFile } from 'fs/promises'
import * as path from 'path'
import type { WorkspaceIndexStatus } from '../indexing/types'
import {
  DIAGNOSTIC_EVENT_NAMES,
  DIAGNOSTIC_EVENT_SCHEMA_VERSION,
  isDiagnosticId,
  isDiagnosticOperationOutcome,
  sanitizeDiagnosticMetadata,
  type PersistedDiagnosticEvent,
} from '../../shared/diagnostics'
import type {
  DiagnosticEventSnapshot,
  DiagnosticWriterHealth,
} from './DiagnosticEventLogService'

export const DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = '1.0' as const

export interface DiagnosticsBundleInput {
  app: {
    version: string
    electron: string
    node: string
    chrome: string
    platform: string
    arch: string
  }
  packaging?: {
    packaged: boolean
    runtimeDependencyCheck?: 'passed' | 'failed' | 'unknown'
    resourceCheck?: 'passed' | 'failed' | 'unknown'
    localeCheck?: 'passed' | 'failed' | 'unknown'
    fontCheck?: 'passed' | 'failed' | 'unknown'
  }
  index?: WorkspaceIndexStatus
  session?: {
    schemaVersion: number
    windows: number
    workspaces: number
    tabs: number
    splitLeaves: number
  }
  docx?: {
    configured: boolean
    reachable?: boolean
    status?: 'ok' | 'unavailable' | 'not-configured' | 'unknown'
    version?: string
  }
  tts?: {
    providers: Array<{
      type: 'system' | 'edge' | 'openai' | 'azure'
      enabled: boolean
      hasApiKey: boolean
    }>
  }
  errors?: Array<{
    category: string
    code?: string
    path?: string
  }>
}

export interface DiagnosticsBundleResult {
  outputPath: string
  bytes: number
  entries: string[]
}

export interface DiagnosticsEventBundleInput {
  snapshot: DiagnosticEventSnapshot
  health: DiagnosticWriterHealth
}

export async function createDiagnosticsBundle(
  outputPath: string,
  input: DiagnosticsBundleInput,
  eventLog?: DiagnosticsEventBundleInput,
): Promise<DiagnosticsBundleResult> {
  const absoluteOutput = path.resolve(outputPath)
  if (path.extname(absoluteOutput).toLowerCase() !== '.zip') {
    throw new Error('诊断包输出路径必须以 .zip 结尾')
  }
  await mkdir(path.dirname(absoluteOutput), { recursive: true })
  const bundleKey = randomBytes(32)
  const sanitized = sanitizeBundleInput(input, bundleKey)
  if (eventLog) {
    sanitized.performanceEvents = sanitizeEventSummary(eventLog)
  }
  const eventLines = eventLog
    ? eventLog.snapshot.events
      .map(event => sanitizeBundleEvent(event, bundleKey))
      .filter((event): event is Record<string, unknown> => event !== null)
      .map(event => JSON.stringify(event))
      .join('\n')
    : ''
  const zip = new AdmZip()
  const entries = ['diagnostics.json', 'performance-events.jsonl', 'README.txt']
  zip.addFile('diagnostics.json', Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`, 'utf8'))
  zip.addFile('performance-events.jsonl', Buffer.from(eventLines ? `${eventLines}\n` : '', 'utf8'))
  zip.addFile('README.txt', Buffer.from([
    'MD Viewer 本地诊断包',
    '',
    '此诊断包由字段白名单生成，不包含 Markdown 正文、文件名、绝对路径、搜索词、语音文本或 API Key。',
    'performance-events.jsonl 最多包含最近 10 MiB 的有效诊断事件；更早记录可能未包含。',
    '路径仅在本诊断包内使用随机 token 关联；不同诊断包之间无法关联。',
    '正常高频索引查询按时间窗口聚合；慢查询和失败查询仍保留 operation 级事件。',
    'diagnostics.json 的 abnormalities 和 maximaMs 提供异常计数与关键最大耗时。',
    '诊断包不会自动上传，也不发送遥测。',
    '',
  ].join('\n'), 'utf8'))
  const temporaryPath = `${absoluteOutput}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const buffer = zip.toBuffer()
  try {
    await writeFile(temporaryPath, buffer, { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, absoluteOutput)
  } catch (error) {
    const { unlink } = await import('fs/promises')
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  return { outputPath: absoluteOutput, bytes: buffer.byteLength, entries }
}

export function sanitizeBundleInput(input: DiagnosticsBundleInput, bundleKey: Buffer): Record<string, unknown> {
  return {
    schemaVersion: DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
    app: {
      version: scalar(input.app.version),
      electron: scalar(input.app.electron),
      node: scalar(input.app.node),
      chrome: scalar(input.app.chrome),
      platform: scalar(input.app.platform),
      arch: scalar(input.app.arch),
    },
    ...(input.packaging ? { packaging: { ...input.packaging } } : {}),
    ...(input.index ? {
      index: {
        state: input.index.state,
        generation: input.index.generation,
        indexedDocuments: input.index.indexedDocuments,
        totalDocuments: input.index.totalDocuments,
        pendingDocuments: input.index.pendingDocuments,
        errors: input.index.errors,
      },
    } : {}),
    ...(input.session ? { session: { ...input.session } } : {}),
    ...(input.docx ? {
      docx: {
        configured: input.docx.configured,
        ...(input.docx.reachable !== undefined ? { reachable: input.docx.reachable } : {}),
        ...(input.docx.status ? { status: input.docx.status } : {}),
        ...(input.docx.version ? { version: scalar(input.docx.version) } : {}),
      },
    } : {}),
    ...(input.tts ? {
      tts: {
        providerCounts: countTtsProviders(input.tts.providers),
        enabled: input.tts.providers.filter(provider => provider.enabled).length,
        paidProvidersWithApiKey: input.tts.providers.filter(provider =>
          (provider.type === 'openai' || provider.type === 'azure') && provider.hasApiKey
        ).length,
      },
    } : {}),
    errors: (input.errors ?? []).slice(0, 100).map(error => ({
      category: scalar(error.category),
      ...(error.code ? { code: scalar(error.code) } : {}),
      ...(error.path ? { pathToken: pathToken(bundleKey, error.path) } : {}),
    })),
  }
}

function sanitizeEventSummary(eventLog: DiagnosticsEventBundleInput): Record<string, unknown> {
  const { snapshot, health } = eventLog
  const events = snapshot.events
  const starts = new Set(events
    .filter(event => event.event.endsWith('.start') && event.operationId)
    .map(event => event.operationId!))
  const terminals = new Set(events
    .filter(event => event.event.endsWith('.terminal') && event.operationId)
    .map(event => event.operationId!))
  const rendererLongTasks = maximumByOperation(events, event =>
    event.event === 'file.preview.summary' || event.event === 'file.preview.post-render'
      ? metric(event, 'maxLongTaskMs')
      : 0
  )
  const queryWindows = events.filter(event => event.event === 'index.query.window')
  const fileIoEvents = events.filter(event => event.event === 'file.io.summary')
  const overlappingFileIo = fileIoEvents.filter(event =>
    metric(event, 'activeIndexBuilds') > 0 || metric(event, 'activeIndexReads') > 0
  ).length
  const eventCounts = Object.fromEntries(
    [...DIAGNOSTIC_EVENT_NAMES]
      .map(name => [name, events.filter(event => event.event === name).length] as const)
      .filter(([, count]) => count > 0)
  )
  const slowFileOpens = uniqueOperationCount(events, event =>
    event.event === 'file.open.terminal' && metric(event, 'durationMs') >= 1000
  )
  const slowFolderOpens = uniqueOperationCount(events, event =>
    event.event === 'folder.open.terminal' && metric(event, 'durationMs') >= 1000
  )
  const slowIndexWork = uniqueOperationCount(events, event =>
    event.event === 'index.work.summary' && metric(event, 'durationMs') >= indexSlowThreshold(event)
  )
  const rendererStalls = [...rendererLongTasks.values()].filter(duration => duration >= 200).length
  const errorEvents = events.filter(event => event.outcome === 'error').length
  const timeoutEvents = events.filter(event => event.outcome === 'timeout').length
  return {
    count: events.length,
    totalBytes: finiteMetric(snapshot.totalBytes),
    invalidLines: finiteMetric(snapshot.invalidLines),
    truncated: Boolean(snapshot.truncated),
    omittedFiles: finiteMetric(snapshot.omittedFiles),
    oldestEventUnixMs: nullableFiniteMetric(snapshot.oldestEventUnixMs),
    newestEventUnixMs: nullableFiniteMetric(snapshot.newestEventUnixMs),
    eventCounts,
    abnormalities: {
      errorEvents,
      timeoutEvents,
      unmatchedStarts: [...starts].filter(operationId => !terminals.has(operationId)).length,
      slowFileOpens,
      slowFolderOpens,
      slowIndexWork,
      rendererStalls,
    },
    maximaMs: {
      fileOpen: maximumMetric(events, 'file.open.terminal', 'durationMs'),
      folderOpen: maximumMetric(events, 'folder.open.terminal', 'durationMs'),
      indexWork: maximumMetric(events, 'index.work.summary', 'durationMs'),
      rendererLongTask: Math.max(0, ...rendererLongTasks.values()),
      mainEventLoop: maximumMetric(events, 'main.event-loop.window', 'durationMs'),
    },
    indexOverlap: {
      fileIoEvents: fileIoEvents.length,
      overlappingFileIo,
      ratio: fileIoEvents.length > 0 ? overlappingFileIo / fileIoEvents.length : 0,
    },
    queryAggregation: {
      windows: queryWindows.length,
      operations: sumMetric(queryWindows, 'operationCount'),
      errors: sumMetric(queryWindows, 'errorCount'),
      slow: sumMetric(queryWindows, 'slowCount'),
    },
    writer: {
      scope: 'currentBoot',
      eventsAccepted: finiteMetric(health.eventsAccepted),
      eventsWritten: finiteMetric(health.eventsWritten),
      invalidEvents: finiteMetric(health.invalidEvents),
      droppedEvents: finiteMetric(health.droppedEvents),
      bytesWritten: finiteMetric(health.bytesWritten),
      batchCount: finiteMetric(health.batchCount),
      appendP95Ms: finiteMetric(health.appendP95Ms),
      appendMaxMs: finiteMetric(health.appendMaxMs),
      queueLagP95Ms: finiteMetric(health.queueLagP95Ms),
      queueLagMaxMs: finiteMetric(health.queueLagMaxMs),
      maxQueueBytes: finiteMetric(health.maxQueueBytes),
      cleanupDurationMs: finiteMetric(health.cleanupDurationMs),
      destinationFallbacks: finiteMetric(health.destinationFallbacks),
    },
  }
}

export function sanitizeBundleEvent(
  event: PersistedDiagnosticEvent,
  bundleKey: Buffer,
): Record<string, unknown> | null {
  if (event.schemaVersion !== DIAGNOSTIC_EVENT_SCHEMA_VERSION) return null
  if (!DIAGNOSTIC_EVENT_NAMES.has(event.event)) return null
  if (!Number.isFinite(event.observedUnixMs) || !Number.isFinite(event.monotonicMs)) return null
  if (event.processRole !== 'main' && event.processRole !== 'renderer') return null
  if (!isDiagnosticId(event.processInstanceId)) return null
  if (!Number.isSafeInteger(event.processSeq) || event.processSeq < 0) return null
  if (!Number.isFinite(event.writerRecordedUnixMs)) return null
  if (!/^boot_[a-f0-9]{12}$/.test(event.bootId)) return null
  if (event.tokenScope !== 'installation' && event.tokenScope !== 'session-only') return null
  if (event.operationId !== undefined && !isDiagnosticId(event.operationId)) return null
  if (event.spanId !== undefined && !isDiagnosticId(event.spanId)) return null
  if (event.parentSpanId !== undefined && !isDiagnosticId(event.parentSpanId)) return null
  if (event.outcome !== undefined && !isDiagnosticOperationOutcome(event.outcome)) return null
  const metadata = sanitizeDiagnosticMetadata(event.metadata)
  if (event.metadata !== undefined && metadata === null) return null

  return {
    schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
    event: event.event,
    observedUnixMs: event.observedUnixMs,
    monotonicMs: event.monotonicMs,
    processRole: event.processRole,
    processInstanceId: event.processInstanceId,
    processSeq: event.processSeq,
    writerRecordedUnixMs: event.writerRecordedUnixMs,
    bootId: event.bootId,
    tokenScope: 'bundle',
    ...(event.operationId ? { operationId: event.operationId } : {}),
    ...(event.spanId ? { spanId: event.spanId } : {}),
    ...(event.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(event.pathToken && /^path_[a-f0-9]{24}$/.test(event.pathToken)
      ? { pathToken: bundleEventToken(bundleKey, event.tokenScope, event.bootId, event.pathToken) }
      : {}),
    ...(event.workspaceToken && /^path_[a-f0-9]{24}$/.test(event.workspaceToken)
      ? { workspaceToken: bundleEventToken(bundleKey, event.tokenScope, event.bootId, event.workspaceToken) }
      : {}),
  }
}

function bundleEventToken(
  key: Buffer,
  tokenScope: PersistedDiagnosticEvent['tokenScope'],
  bootId: string,
  localToken: string,
): string {
  const correlationValue = tokenScope === 'installation'
    ? localToken
    : `${bootId}:${localToken}`
  return `path_${createHmac('sha256', key).update(correlationValue).digest('hex').slice(0, 24)}`
}

function metric(event: PersistedDiagnosticEvent, key: string): number {
  const value = event.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function sumMetric(events: PersistedDiagnosticEvent[], key: string): number {
  return events.reduce((sum, event) => sum + metric(event, key), 0)
}

function maximumMetric(
  events: PersistedDiagnosticEvent[],
  eventName: PersistedDiagnosticEvent['event'],
  key: string,
): number {
  return Math.max(0, ...events
    .filter(event => event.event === eventName)
    .map(event => metric(event, key)))
}

function maximumByOperation(
  events: PersistedDiagnosticEvent[],
  select: (event: PersistedDiagnosticEvent) => number,
): Map<string, number> {
  const maxima = new Map<string, number>()
  for (const event of events) {
    if (!event.operationId) continue
    const value = select(event)
    if (value > (maxima.get(event.operationId) ?? 0)) maxima.set(event.operationId, value)
  }
  return maxima
}

function uniqueOperationCount(
  events: PersistedDiagnosticEvent[],
  predicate: (event: PersistedDiagnosticEvent) => boolean,
): number {
  return new Set(events
    .filter(event => event.operationId && predicate(event))
    .map(event => event.operationId!)).size
}

function indexSlowThreshold(event: PersistedDiagnosticEvent): number {
  const kind = event.metadata?.workloadKind
  if (kind === 'query' || kind === 'backlinks') return 100
  if (kind === 'build') return 3000
  return 1000
}

function finiteMetric(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function nullableFiniteMetric(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null
}

function countTtsProviders(
  providers: NonNullable<DiagnosticsBundleInput['tts']>['providers'],
): Record<string, number> {
  const counts: Record<string, number> = { system: 0, edge: 0, openai: 0, azure: 0 }
  for (const provider of providers) {
    counts[provider.type] += 1
  }
  return counts
}

function pathToken(key: Buffer, value: string): string {
  return `path_${createHmac('sha256', key).update(path.resolve(value)).digest('hex').slice(0, 24)}`
}

function scalar(value: string): string {
  return value.replace(/[\r\n\0]/g, ' ').slice(0, 160)
}
