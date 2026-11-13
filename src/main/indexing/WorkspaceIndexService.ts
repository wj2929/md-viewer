import { readFile, realpath, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import { isUtf8 } from 'node:buffer'
import { performance } from 'perf_hooks'
import { escape as escapeGlob, glob } from 'glob'
import * as path from 'path'
import { analyzeMarkdownSource, tokenizeSearchText } from '../../shared/markdown/analyze'
import { buildBacklinkPresentations } from '../../shared/markdown/backlinks'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { buildFullSha256Revision } from '../revisionToken'
import type { WorkspaceRootDelta, WorkspaceWatchService } from '../watching/WorkspaceWatchService'
import { INDEX_SCHEMA_VERSION, WorkspaceIndexStore, type WorkspaceIndexLock } from './WorkspaceIndexStore'
import { ReclamationError } from './WorkspaceIndexReclamation'
import { hasIgnoredPathSegment } from '../watching/watchPaths'
import { createWikiNameLookup } from './wikiNameLookup'
import { isBareWikiDocumentName } from '../../shared/markdown/wikiDocumentNames'
import { createWikiDocumentMetadata, WorkspaceWikiMetadata, type WorkspaceWikiSnapshot } from './wikiMetadata'
import type {
  DiagnosticEventDraft,
} from '../diagnostics/DiagnosticEventLogService'
import type {
  IndexedDocument,
  WorkspaceBacklinkResult,
  WorkspaceBacklinkResponse,
  WorkspaceIndexStatus,
  WorkspaceSearchResult,
} from './types'

const MARKDOWN_GLOB = '**/*.{md,markdown,mdown,mkd,mkdn}'
const INDEX_IGNORED_PATHS = ['**/node_modules/**', '**/.*/**', '**/vendor/**', '**/target/**', '**/build/**', '**/dist/**']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_SEARCH_RESULTS = 100
const INDEX_PROGRESS_INTERVAL_MS = 50
const INDEX_QUERY_SLOW_MS = 100
const INDEX_QUERY_WINDOW_MS = 10_000
const INDEX_QUERY_WINDOW_MAX_OPERATIONS = 100

type IndexQueryWorkloadKind = 'query' | 'backlinks'

type IndexWorkloadKind = 'build' | 'delta' | 'query' | 'backlinks' | 'commit'

export interface IndexDiagnosticsSink {
  recordMainEvent(event: DiagnosticEventDraft): void
}

interface IndexWorkMetrics {
  cacheLoadMs: number
  globMs: number
  queueWaitMs: number
  lockWaitMs: number
  candidateCount: number
  filesProcessed: number
  bytesRead: number
  bytesReadForValidation: number
  readAvoidedCount: number
  contentReusedAfterFullRead: number
  analysisSkippedAfterHash: number
  hashDurationMs: number
  analyzeDurationMs: number
  commitDurationMs: number
  queryCount: number
  backlinksQueryCount: number
}

interface ActiveIndexWork {
  id: string
  kind: IndexWorkloadKind
  rootPath: string
  started: number
  startedUnixMs: number
  statusPublishStart: number
  metrics: IndexWorkMetrics
  slowFiles: Array<{ path: string; durationMs: number }>
  activityTimer: NodeJS.Timeout | null
  slowStartTimer: NodeJS.Timeout | null
  diagnosticStarted: boolean
}

interface IndexQueryWindow {
  rootPath: string
  kind: IndexQueryWorkloadKind
  started: number
  durations: number[]
  successCount: number
  errorCount: number
  slowCount: number
  timer: NodeJS.Timeout
}

interface WorkspaceIndexRuntime {
  rootPath: string
  rootFingerprint: string
  consumerIds: Set<string>
  documents: Map<string, IndexedDocument>
  wiki: WorkspaceWikiMetadata
  status: WorkspaceIndexStatus
  indexInstanceId?: string
  queue: Promise<void>
  pendingChanges: Map<string, 'upsert' | 'remove' | 'scan'>
  flushScheduled: boolean
  queuedFlush?: Promise<void>
  queuedRebuild?: Promise<void>
  committedRevisions: Map<string, string> | null
  persistenceDirty: boolean
  commitFailed: boolean
  readErrors: Set<string>
  generation: number
  continuationEpoch: number
  lock: WorkspaceIndexLock
  closing: boolean
  diagnosticStatusPublishCount: number
  diagnosticLockWaitMs: number
}

export class WorkspaceIndexService {
  private readonly runtimes = new Map<string, WorkspaceIndexRuntime>()
  private readonly initializations = new Map<string, Promise<WorkspaceIndexRuntime>>()
  private readonly teardowns = new Map<string, Promise<void>>()
  private readonly desiredConsumerRoots = new Map<string, Set<string>>()
  private readonly aliases = new Map<string, string>()
  private readonly statusListeners = new Map<string, Map<string, (status: WorkspaceIndexStatus) => void>>()
  private readonly activeDiagnosticWorks = new Map<string, ActiveIndexWork>()
  private readonly queryDiagnosticWindows = new Map<string, IndexQueryWindow>()
  private activeIndexReads = 0
  private shutdownPromise: Promise<void> | null = null

  constructor(
    private readonly store: WorkspaceIndexStore,
    private readonly watcher: WorkspaceWatchService,
    private readonly diagnostics?: IndexDiagnosticsSink,
  ) {}

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.completeShutdown()
    return this.shutdownPromise
  }

  private async completeShutdown(): Promise<void> {
    this.desiredConsumerRoots.clear()
    await Promise.allSettled(this.initializations.values())
    await Promise.all([...this.runtimes.values()].flatMap(runtime => (
      [...runtime.consumerIds].map(consumerId => this.detach(runtime.rootPath, consumerId))
    )))
    await Promise.all(this.teardowns.values())
  }

  async attach(rootPath: string, consumerId: string): Promise<WorkspaceIndexStatus> {
    if (this.shutdownPromise) return emptyStatus('detached')
    const requestedRoot = path.resolve(rootPath)
    this.markConsumerDesired(consumerId, requestedRoot)
    const canonicalRoot = await realpath(rootPath)
    if (!this.isConsumerDesired(consumerId, requestedRoot)) return emptyStatus('detached')
    this.markConsumerDesired(consumerId, canonicalRoot)
    this.aliases.set(requestedRoot, canonicalRoot)

    const teardown = this.teardowns.get(canonicalRoot)
    if (teardown) await teardown
    if (!this.isConsumerDesired(consumerId, requestedRoot)) return emptyStatus('detached')
    this.aliases.set(requestedRoot, canonicalRoot)

    let runtime = this.runtimes.get(canonicalRoot)
    if (!runtime) {
      let initialization = this.initializations.get(canonicalRoot)
      if (!initialization) {
        initialization = this.initializeRuntime(canonicalRoot, consumerId)
        this.initializations.set(canonicalRoot, initialization)
      }
      try {
        runtime = await initialization
      } finally {
        if (this.initializations.get(canonicalRoot) === initialization) {
          this.initializations.delete(canonicalRoot)
        }
      }
    }

    if (!this.isConsumerDesired(consumerId, requestedRoot)) {
      await this.detach(canonicalRoot, consumerId)
      return emptyStatus('detached')
    }
    if (runtime.closing) {
      await this.teardowns.get(canonicalRoot)
      return this.attach(rootPath, consumerId)
    }
    if (!runtime.consumerIds.has(consumerId)) {
      runtime.consumerIds.add(consumerId)
      this.watcher.attachIndexConsumer(canonicalRoot, consumerId, delta => this.enqueueDelta(runtime!, delta))
    }
    return runtime.status
  }

  async detach(rootPath: string, consumerId: string): Promise<void> {
    const resolvedRoot = path.resolve(rootPath)
    const canonicalRoot = this.aliases.get(resolvedRoot) ?? resolvedRoot
    this.unmarkConsumerDesired(consumerId, resolvedRoot, canonicalRoot)
    const runtime = this.runtimes.get(canonicalRoot) ?? await this.initializations.get(canonicalRoot)?.catch(() => undefined)
    if (!runtime || !runtime.consumerIds.delete(consumerId)) return
    this.watcher.detachIndexConsumer(runtime.rootPath, consumerId)
    if (runtime.consumerIds.size > 0 || runtime.closing) return

    runtime.closing = true
    runtime.wiki.invalidate()
    const teardown = this.teardownRuntime(runtime)
    this.teardowns.set(runtime.rootPath, teardown)
    try {
      await teardown
    } finally {
      if (this.teardowns.get(runtime.rootPath) === teardown) this.teardowns.delete(runtime.rootPath)
    }
  }

  private async initializeRuntime(canonicalRoot: string, consumerId: string): Promise<WorkspaceIndexRuntime> {
    const rootFingerprint = await this.store.inspectRootFingerprint(canonicalRoot)
    const lockStarted = performance.now()
    const lock = await this.store.acquireLock(canonicalRoot)
    const diagnosticLockWaitMs = performance.now() - lockStarted
    const runtime: WorkspaceIndexRuntime = {
      rootPath: canonicalRoot,
      rootFingerprint,
      consumerIds: new Set([consumerId]),
      documents: new Map(),
      wiki: new WorkspaceWikiMetadata(),
      status: emptyStatus('building'),
      queue: Promise.resolve(),
      pendingChanges: new Map(),
      flushScheduled: false,
      committedRevisions: null,
      persistenceDirty: true,
      commitFailed: false,
      readErrors: new Set(),
      generation: 0,
      continuationEpoch: 0,
      lock,
      closing: false,
      diagnosticStatusPublishCount: 0,
      diagnosticLockWaitMs,
    }
    this.runtimes.set(canonicalRoot, runtime)
    this.watcher.attachIndexConsumer(canonicalRoot, consumerId, delta => this.enqueueDelta(runtime, delta))
    runtime.queue = this.build(runtime).catch(error => this.markError(runtime, error))
    return runtime
  }

  private async teardownRuntime(runtime: WorkspaceIndexRuntime): Promise<void> {
    do {
      await Promise.resolve()
      const queue = runtime.queue
      await queue
      if (queue === runtime.queue && !runtime.flushScheduled) break
    } while (true)
    this.flushQueryDiagnosticWindows(runtime.rootPath)
    await runtime.lock.release()
    if (this.runtimes.get(runtime.rootPath) === runtime) this.runtimes.delete(runtime.rootPath)
    this.statusListeners.delete(runtime.rootPath)
    for (const [alias, canonical] of this.aliases) {
      if (canonical === runtime.rootPath) this.aliases.delete(alias)
    }
  }

  private markConsumerDesired(consumerId: string, rootPath: string): void {
    const roots = this.desiredConsumerRoots.get(consumerId) ?? new Set<string>()
    roots.add(rootPath)
    this.desiredConsumerRoots.set(consumerId, roots)
  }

  private isConsumerDesired(consumerId: string, rootPath: string): boolean {
    return this.desiredConsumerRoots.get(consumerId)?.has(rootPath) ?? false
  }

  private unmarkConsumerDesired(consumerId: string, ...rootPaths: string[]): void {
    const roots = this.desiredConsumerRoots.get(consumerId)
    if (!roots) return
    rootPaths.forEach(rootPath => roots.delete(rootPath))
    if (roots.size === 0) this.desiredConsumerRoots.delete(consumerId)
  }

  getStatus(rootPath: string): WorkspaceIndexStatus {
    return this.getRuntime(rootPath)?.status ?? emptyStatus('detached')
  }

  getDiagnosticActivity(): { activeIndexBuilds: number; activeIndexReads: number } {
    const activeIndexBuilds = [...this.activeDiagnosticWorks.values()].filter(work =>
      work.kind === 'build' || work.kind === 'delta' || work.kind === 'commit'
    ).length
    return { activeIndexBuilds, activeIndexReads: this.activeIndexReads }
  }

  getWikiSnapshot(rootPath: string): WorkspaceWikiSnapshot | null {
    const runtime = this.getRuntime(rootPath)
    if (!runtime || runtime.closing) return null
    const epoch = runtime.wiki.epoch
    const continuationEpoch = runtime.continuationEpoch
    const published = runtime.wiki.published
    const coverage = this.watcher.getIndexCoverage(runtime.rootPath)
    const view = published ?? {
      documents: new Map(runtime.documents), metadata: new Map(), aliases: new Map(), complete: false,
    }
    return {
      ...view, rootPath: runtime.rootPath, epoch,
      ready: !runtime.wiki.dirty && view.complete && coverage.complete,
      isCurrent: () => {
        const currentCoverage = this.watcher.getIndexCoverage(runtime.rootPath)
        return !runtime.closing && this.getRuntime(rootPath) === runtime && runtime.wiki.epoch === epoch
          && runtime.wiki.published === published && currentCoverage.token === coverage.token
          && currentCoverage.complete === coverage.complete
      },
      isContinuous: () => {
        const currentCoverage = this.watcher.getIndexCoverage(runtime.rootPath)
        return !runtime.closing && this.getRuntime(rootPath) === runtime
          && runtime.continuationEpoch === continuationEpoch && coverage.complete
          && currentCoverage.complete && currentCoverage.token === coverage.token
      },
    }
  }

  getIndexedDocuments(rootPath: string): readonly IndexedDocument[] {
    return [...this.requireRuntime(rootPath).documents.values()]
  }

  async refreshRelativePaths(rootPath: string, relativePaths: readonly string[]): Promise<void> {
    const runtime = this.requireRuntime(rootPath)
    for (const relativePath of relativePaths) {
      const normalized = normalizeRelativePath(relativePath)
      if (!isMarkdownRelativePath(normalized)) continue
      runtime.pendingChanges.set(normalized, 'upsert')
    }
    await this.flushPendingChanges(runtime)
  }

  async refreshMovedRelativePaths(
    rootPath: string,
    mappings: readonly { oldRelativePath: string; newRelativePath: string }[],
  ): Promise<void> {
    const runtime = this.requireRuntime(rootPath)
    for (const mapping of mappings) {
      const oldPath = normalizeRelativePath(mapping.oldRelativePath)
      const newPath = normalizeRelativePath(mapping.newRelativePath)
      let movedIndexedDocument = false
      for (const relativePath of [...runtime.documents.keys()]) {
        if (relativePath === oldPath || relativePath.startsWith(`${oldPath}/`)) {
          runtime.pendingChanges.set(relativePath, 'remove')
          const suffix = relativePath.slice(oldPath.length)
          const movedPath = normalizeRelativePath(`${newPath}${suffix}`)
          if (isMarkdownRelativePath(movedPath)) {
            runtime.pendingChanges.set(movedPath, 'upsert')
            movedIndexedDocument = true
          }
        }
      }
      if (!movedIndexedDocument && isMarkdownRelativePath(newPath)) {
        runtime.pendingChanges.set(newPath, 'upsert')
      }
    }
    await this.flushPendingChanges(runtime)
  }

  private async flushPendingChanges(runtime: WorkspaceIndexRuntime): Promise<void> {
    if (runtime.closing) return
    if (runtime.pendingChanges.size === 0 && !runtime.persistenceDirty) return
    await this.scheduleDeltaFlush(runtime)
  }

  private scheduleDeltaFlush(runtime: WorkspaceIndexRuntime): Promise<void> {
    runtime.wiki.invalidate()
    if (runtime.queuedFlush) return runtime.queuedFlush
    runtime.flushScheduled = true
    runtime.status = { ...runtime.status, state: 'updating', pendingDocuments: runtime.pendingChanges.size }
    this.publishStatus(runtime)
    const enqueuedAt = performance.now()
    const work = runtime.queue.then(() => {
      runtime.flushScheduled = false
      runtime.queuedFlush = undefined
      return this.flushDeltas(runtime, enqueuedAt)
    }).catch(error => this.markError(runtime, error))
    runtime.queuedFlush = work
    runtime.queue = work
    return work
  }

  subscribeStatus(rootPath: string, listenerId: string, listener: (status: WorkspaceIndexStatus) => void): void {
    const runtime = this.requireRuntime(rootPath)
    let listeners = this.statusListeners.get(runtime.rootPath)
    if (!listeners) {
      listeners = new Map()
      this.statusListeners.set(runtime.rootPath, listeners)
    }
    listeners.set(listenerId, listener)
    listener(runtime.status)
  }

  unsubscribeStatus(rootPath: string, listenerId: string): void {
    const runtime = this.getRuntime(rootPath)
    const canonicalRoot = runtime?.rootPath ?? path.resolve(rootPath)
    const listeners = this.statusListeners.get(canonicalRoot)
    listeners?.delete(listenerId)
    if (listeners?.size === 0) this.statusListeners.delete(canonicalRoot)
  }

  async waitUntilIdle(rootPath: string, alignment?: { assertCurrent: () => void }): Promise<void> {
    const runtime = this.getRuntime(rootPath)
    if (!runtime) return
    const deadline = Date.now() + 30_000
    do {
      if (alignment && Date.now() >= deadline) throw new Error('索引对齐超时，请重新预览文件操作')
      if (alignment) await this.watcher.waitForRootAlignment(runtime.rootPath, alignment.assertCurrent, deadline - Date.now())
      const coverage = alignment ? this.watcher.getIndexCoverage(runtime.rootPath) : undefined
      await Promise.resolve()
      const queue = runtime.queue
      await queue
      alignment?.assertCurrent()
      if (queue !== runtime.queue || runtime.flushScheduled || runtime.pendingChanges.size > 0) continue
      if (coverage) {
        const current = this.watcher.getIndexCoverage(runtime.rootPath)
        if (current.token !== coverage.token || current.complete !== coverage.complete) continue
      }
      return
    } while (true)
  }

  async reconcileWatch(rootPath: string, phase: 'refresh' | 'drain'): Promise<void> {
    const runtime = this.getRuntime(rootPath)
    if (!runtime || runtime.closing) return
    if (phase === 'refresh') await this.rebuild(rootPath)
    else {
      // Capture the queue after already-received deltas have scheduled their flush.
      // Later deltas may continue; this is a barrier, not a wait for permanent idleness.
      await Promise.resolve()
      await runtime.queue
    }
    if (runtime.status.errors > 0) throw new Error('索引变更补查未完成')
  }

  async prepareReclamation(rootPath: string, authorize: () => void) {
    const runtime = this.getRuntime(rootPath)
    if (!runtime || runtime.closing) throw new ReclamationError('busy')
    const guard = async (): Promise<void> => {
      authorize()
      if (this.getRuntime(rootPath) !== runtime || runtime.closing) throw new ReclamationError('stale')
      if (!await runtime.lock.isHeld()) throw new ReclamationError('busy')
      try {
        const currentRoot = await realpath(rootPath)
        if (currentRoot !== runtime.rootPath ||
          await this.store.inspectRootFingerprint(currentRoot) !== runtime.rootFingerprint) {
          throw new ReclamationError('stale')
        }
      } catch { throw new ReclamationError('stale') }
      authorize()
      if (this.getRuntime(rootPath) !== runtime || runtime.closing) throw new ReclamationError('stale')
    }
    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
      const work = runtime.queue.then(async () => { await guard(); return task() })
      runtime.queue = work.then(() => undefined, () => undefined)
      return work
    }
    const plan = await enqueue(() => this.store.previewReclamation(runtime.rootPath, runtime.rootFingerprint, guard))
    if (!plan) return null
    return {
      summary: plan.summary,
      execute: () => enqueue(() => this.store.executeReclamation(plan, guard)),
    }
  }

  async rebuild(rootPath: string): Promise<WorkspaceIndexStatus> {
    const runtime = this.requireRuntime(rootPath)
    runtime.continuationEpoch++
    runtime.wiki.invalidate()
    if (!runtime.queuedRebuild) {
      const enqueuedAt = performance.now()
      const work = runtime.queue.then(() => {
        runtime.queuedRebuild = undefined
        return this.build(runtime, enqueuedAt)
      }).catch(error => this.markError(runtime, error))
      runtime.queuedRebuild = work
      runtime.queue = work
    }
    await runtime.queuedRebuild
    return runtime.status
  }

  async query(
    rootPath: string,
    query: string,
    limit = 50,
    relativePaths?: ReadonlySet<string>,
  ): Promise<WorkspaceSearchResult[]> {
    const runtime = this.requireRuntime(rootPath)
    const work = this.beginDiagnosticWork(runtime, 'query')
    try {
      const terms = [...new Set(tokenizeSearchText(query))]
      if (terms.length === 0) {
        this.finishDiagnosticWork(runtime, work, 'success')
        return []
      }
      const results: WorkspaceSearchResult[] = []

      for (const document of runtime.documents.values()) {
        if (relativePaths && !relativePaths.has(document.relativePath)) continue
        const score = terms.reduce((total, term) => total + (document.terms[term] ?? 0), 0)
        if (score === 0) continue
        work.metrics.candidateCount += 1
        const absolutePath = path.join(runtime.rootPath, document.relativePath)
        const content = await this.readIfCurrent(absolutePath, document.revisionToken, work)
        if (content === null) continue
        const lineStart = findMatchingLine(content, terms)
        results.push({
          relativePath: document.relativePath,
          displayName: path.basename(document.relativePath),
          score,
          lineStart,
          snippet: buildSnippet(content, lineStart),
          revisionToken: document.revisionToken,
        })
      }

      const selected = results
        .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
        .slice(0, Math.min(Math.max(1, limit), MAX_SEARCH_RESULTS))
      this.finishDiagnosticWork(runtime, work, 'success')
      return selected
    } catch (error) {
      this.finishDiagnosticWork(runtime, work, 'error')
      throw error
    }
  }

  async getBacklinks(rootPath: string, targetRelativePath: string): Promise<WorkspaceBacklinkResponse> {
    const runtime = this.requireRuntime(rootPath)
    const work = this.beginDiagnosticWork(runtime, 'backlinks')
    try {
      const normalizedTarget = normalizeRelativePath(targetRelativePath)
      const snapshot = this.getWikiSnapshot(rootPath)!
      let coverage: WorkspaceBacklinkResponse['coverage'] = snapshot.ready ? 'complete'
        : runtime.wiki.dirty ? 'building' : 'partial'
      const lookup = createWikiNameLookup(runtime.rootPath, snapshot)
      const results: WorkspaceBacklinkResult[] = []
      for (const document of snapshot.documents.values()) {
        const sourceDir = path.posix.dirname(document.relativePath)
        const metadata = snapshot.metadata.get(document.relativePath)
        const links = metadata?.revisionToken === document.revisionToken ? metadata.links : document.outboundLinks
        const matchingLinks: typeof document.outboundLinks = []
        for (const link of links) {
          if (link.kind !== 'markdown') continue
          const { decodedPath } = splitMarkdownTarget(link.rawTarget)
          if (!decodedPath || path.posix.isAbsolute(decodedPath)) continue
          let target: string | null
          if (link.syntax === 'wiki' && 'wikiEmbed' in link && link.wikiEmbed === false && isBareWikiDocumentName(decodedPath)) {
            const resolution = await lookup(document.relativePath, decodedPath)
            if (resolution.status === 'uncertain') coverage = 'partial'
            target = resolution.status === 'found' ? resolution.target : null
          } else target = link.syntax === 'wiki'
            ? resolveIndexedWikiTarget(snapshot.documents, document.relativePath, decodedPath)
            : normalizeRelativePath(path.posix.join(sourceDir, decodedPath))
          if (target === normalizedTarget) matchingLinks.push(link)
        }
        if (matchingLinks.length === 0) continue
        work.metrics.candidateCount += 1
        const source = await this.readIfCurrent(
          path.join(runtime.rootPath, document.relativePath),
          document.revisionToken,
          work,
        )
        if (source === null) { coverage = 'partial'; continue }
        const presentations = buildBacklinkPresentations(source, links)
        for (const link of matchingLinks) {
          const presentation = presentations.get(link.sourceRange.startOffset)
          results.push({
            sourceRelativePath: document.relativePath,
            sourceDisplayName: path.posix.basename(document.relativePath),
            lineStart: link.lineStart,
            rawTarget: link.rawTarget,
            context: presentation?.context ?? '',
            placement: presentation?.placement ?? 'standalone-link',
            sourceRange: link.sourceRange,
          })
        }
      }
      const selected = results.sort((left, right) =>
        left.sourceRelativePath.localeCompare(right.sourceRelativePath) || left.lineStart - right.lineStart
      )
      this.finishDiagnosticWork(runtime, work, 'success')
      return { items: selected, coverage: snapshot.isCurrent() ? coverage : 'stale' }
    } catch (error) {
      this.finishDiagnosticWork(runtime, work, 'error')
      throw error
    }
  }

  private publishStatus(runtime: WorkspaceIndexRuntime): void {
    if (runtime.status.state === 'ready' && (runtime.flushScheduled || runtime.queuedRebuild || runtime.pendingChanges.size)) {
      runtime.status = { ...runtime.status, state: 'updating', pendingDocuments: runtime.pendingChanges.size }
    }
    runtime.diagnosticStatusPublishCount += 1
    for (const listener of this.statusListeners.get(runtime.rootPath)?.values() ?? []) {
      listener(runtime.status)
    }
  }

  private beginDiagnosticWork(
    runtime: WorkspaceIndexRuntime,
    kind: IndexWorkloadKind,
    enqueuedAt?: number,
  ): ActiveIndexWork {
    const work: ActiveIndexWork = {
      id: `index_${randomUUID()}`,
      kind,
      rootPath: runtime.rootPath,
      started: performance.now(),
      startedUnixMs: Date.now(),
      statusPublishStart: runtime.diagnosticStatusPublishCount,
      metrics: emptyIndexWorkMetrics(kind),
      slowFiles: [],
      activityTimer: null,
      slowStartTimer: null,
      diagnosticStarted: false,
    }
    this.activeDiagnosticWorks.set(work.id, work)
    work.metrics.queueWaitMs = enqueuedAt === undefined ? 0 : Math.max(0, work.started - enqueuedAt)
    work.metrics.lockWaitMs = kind === 'build' ? runtime.diagnosticLockWaitMs : 0
    if (isIndexQueryWorkload(kind) && this.diagnostics) {
      work.slowStartTimer = setTimeout(() => this.startDiagnosticWork(work), INDEX_QUERY_SLOW_MS)
      work.slowStartTimer.unref?.()
    } else {
      this.startDiagnosticWork(work)
    }
    if (this.diagnostics) {
      work.activityTimer = setInterval(() => {
        this.diagnostics?.recordMainEvent({
          event: 'index.activity.window',
          operationId: work.id,
          rawWorkspacePath: runtime.rootPath,
          metadata: {
            workloadKind: kind,
            indexBuildId: work.id,
            durationMs: performance.now() - work.started,
            activeIndexBuilds: this.getDiagnosticActivity().activeIndexBuilds,
            activeIndexReads: this.activeIndexReads,
            filesProcessed: work.metrics.filesProcessed,
            bytesRead: work.metrics.bytesRead,
          },
          priority: 'detail',
        })
      }, 1500)
      work.activityTimer.unref?.()
    }
    return work
  }

  private startDiagnosticWork(work: ActiveIndexWork): void {
    if (work.diagnosticStarted) return
    work.diagnosticStarted = true
    this.diagnostics?.recordMainEvent({
      event: 'index.work.start',
      operationId: work.id,
      rawWorkspacePath: work.rootPath,
      metadata: { workloadKind: work.kind, indexBuildId: work.id },
      priority: 'critical',
      observedUnixMs: work.startedUnixMs,
      monotonicMs: work.started,
    })
  }

  private finishDiagnosticWork(
    runtime: WorkspaceIndexRuntime,
    work: ActiveIndexWork,
    outcome: 'success' | 'error',
  ): void {
    if (work.activityTimer) clearInterval(work.activityTimer)
    if (work.slowStartTimer) clearTimeout(work.slowStartTimer)
    this.activeDiagnosticWorks.delete(work.id)
    const durationMs = performance.now() - work.started
    if (isIndexQueryWorkload(work.kind)) {
      this.recordQueryDiagnosticWindow(runtime.rootPath, work.kind, durationMs, outcome)
      if (outcome === 'success' && durationMs < INDEX_QUERY_SLOW_MS) return
      this.startDiagnosticWork(work)
    }
    const statusPublishCount = runtime.diagnosticStatusPublishCount - work.statusPublishStart
    const seconds = Math.max(durationMs / 1000, 0.001)
    this.diagnostics?.recordMainEvent({
      event: 'index.work.summary',
      operationId: work.id,
      rawWorkspacePath: runtime.rootPath,
      outcome,
      metadata: {
        workloadKind: work.kind,
        indexBuildId: work.id,
        durationMs,
        ...work.metrics,
        statusPublishCount,
        documentsPerSecond: work.metrics.filesProcessed / seconds,
        mibPerSecond: (work.metrics.bytesRead / (1024 * 1024)) / seconds,
        ...(outcome === 'error' ? { errorCode: 'INDEX_WORK_FAILED' } : {}),
      },
      priority: outcome === 'error' ? 'critical' : 'normal',
    })
    const candidateCount = work.kind === 'query' || work.kind === 'backlinks'
      ? work.metrics.candidateCount
      : work.metrics.filesProcessed
    const cutoffDurationMs = work.slowFiles.at(-1)?.durationMs ?? 0
    for (const file of work.slowFiles) {
      this.diagnostics?.recordMainEvent({
        event: 'index.activity.window',
        operationId: work.id,
        rawPath: file.path,
        rawWorkspacePath: runtime.rootPath,
        metadata: {
          workloadKind: work.kind,
          indexBuildId: work.id,
          selection: 'topK',
          candidateCount,
          durationMs: file.durationMs,
          cutoffDurationMs,
        },
        priority: 'detail',
      })
    }
    this.diagnostics?.recordMainEvent({
      event: 'index.work.terminal',
      operationId: work.id,
      outcome,
      metadata: {
        workloadKind: work.kind,
        indexBuildId: work.id,
        durationMs,
        ...(outcome === 'error' ? { errorCode: 'INDEX_WORK_FAILED' } : {}),
      },
      priority: 'critical',
    })
  }

  private recordQueryDiagnosticWindow(
    rootPath: string,
    kind: IndexQueryWorkloadKind,
    durationMs: number,
    outcome: 'success' | 'error',
  ): void {
    if (!this.diagnostics) return
    const key = `${rootPath}\0${kind}`
    let window = this.queryDiagnosticWindows.get(key)
    if (!window) {
      const timer = setTimeout(() => this.flushQueryDiagnosticWindow(key), INDEX_QUERY_WINDOW_MS)
      timer.unref?.()
      window = {
        rootPath,
        kind,
        started: performance.now(),
        durations: [],
        successCount: 0,
        errorCount: 0,
        slowCount: 0,
        timer,
      }
      this.queryDiagnosticWindows.set(key, window)
    }
    window.durations.push(durationMs)
    if (outcome === 'success') window.successCount += 1
    else window.errorCount += 1
    if (durationMs >= INDEX_QUERY_SLOW_MS) window.slowCount += 1
    if (window.durations.length >= INDEX_QUERY_WINDOW_MAX_OPERATIONS) {
      this.flushQueryDiagnosticWindow(key)
    }
  }

  private flushQueryDiagnosticWindows(rootPath: string): void {
    for (const [key, window] of this.queryDiagnosticWindows) {
      if (window.rootPath === rootPath) this.flushQueryDiagnosticWindow(key)
    }
  }

  private flushQueryDiagnosticWindow(key: string): void {
    const window = this.queryDiagnosticWindows.get(key)
    if (!window) return
    this.queryDiagnosticWindows.delete(key)
    clearTimeout(window.timer)
    const durations = [...window.durations].sort((left, right) => left - right)
    this.diagnostics?.recordMainEvent({
      event: 'index.query.window',
      rawWorkspacePath: window.rootPath,
      metadata: {
        workloadKind: window.kind,
        windowDurationMs: Math.max(0, performance.now() - window.started),
        operationCount: durations.length,
        successCount: window.successCount,
        errorCount: window.errorCount,
        slowCount: window.slowCount,
        durationP50Ms: percentile(durations, 0.5),
        durationP95Ms: percentile(durations, 0.95),
        durationMaxMs: durations.at(-1) ?? 0,
        queryCount: window.kind === 'query' ? durations.length : 0,
        backlinksQueryCount: window.kind === 'backlinks' ? durations.length : 0,
      },
      priority: window.errorCount > 0 || window.slowCount > 0 ? 'critical' : 'normal',
    })
  }

  private async build(runtime: WorkspaceIndexRuntime, enqueuedAt?: number): Promise<void> {
    runtime.wiki.reset()
    const work = this.beginDiagnosticWork(runtime, 'build', enqueuedAt)
    try {
    runtime.status = emptyStatus('building')
    this.publishStatus(runtime)
    const cacheStarted = performance.now()
    const cached = await this.store.load(runtime.rootPath, runtime.rootFingerprint)
    work.metrics.cacheLoadMs = performance.now() - cacheStarted
    if (cached) {
      runtime.indexInstanceId = cached.manifest.indexInstanceId
      runtime.documents = new Map(cached.documents.map(document => [document.relativePath, document]))
      runtime.committedRevisions = new Map(cached.documents.map(document => [document.relativePath, document.revisionToken]))
      if (!runtime.commitFailed) runtime.persistenceDirty = false
    } else {
      runtime.committedRevisions = null
      runtime.persistenceDirty = true
    }
    runtime.readErrors.clear()

    const globStarted = performance.now()
    const paths = await glob(MARKDOWN_GLOB, {
      cwd: runtime.rootPath,
      absolute: true,
      nodir: true,
      dot: false,
      ignore: INDEX_IGNORED_PATHS,
    })
    work.metrics.globMs = performance.now() - globStarted
    runtime.status.totalDocuments = paths.length
    const seen = new Set<string>()
    let errors = 0
    let lastProgressPublishedAt = performance.now()
    for (const filePath of paths) {
      try {
        const document = await this.indexFile(runtime, filePath, work)
        if (document) {
          runtime.documents.set(document.relativePath, document)
          seen.add(document.relativePath)
        }
      } catch {
        errors += 1
        runtime.readErrors.add(toRelativePath(runtime.rootPath, filePath) ?? filePath)
      }
      runtime.status.indexedDocuments = seen.size
      runtime.status.pendingDocuments = Math.max(0, paths.length - seen.size - errors)
      const now = performance.now()
      if (now - lastProgressPublishedAt >= INDEX_PROGRESS_INTERVAL_MS) {
        this.publishStatus(runtime)
        lastProgressPublishedAt = now
      }
    }
    for (const relativePath of runtime.documents.keys()) {
      if (!seen.has(relativePath)) runtime.documents.delete(relativePath)
    }
    runtime.status.errors = errors
    const hasWriteLease = await runtime.lock.isHeld() && !runtime.closing
    if (hasWriteLease) {
      work.metrics.commitDurationMs += await this.commit(runtime)
    }
    runtime.status = {
      state: hasWriteLease ? (errors > 0 ? 'degraded' : 'ready') : 'read-only',
      generation: runtime.generation,
      indexedDocuments: runtime.documents.size,
      totalDocuments: paths.length,
      pendingDocuments: 0,
      errors,
    }
    this.publishWikiMetadata(runtime)
    this.publishStatus(runtime)
    this.finishDiagnosticWork(runtime, work, 'success')
    } catch (error) {
      this.finishDiagnosticWork(runtime, work, 'error')
      throw error
    }
  }

  private enqueueDelta(runtime: WorkspaceIndexRuntime, delta: WorkspaceRootDelta): void {
    if (runtime.closing) return
    if (delta.kind === 'renamed') return
    if (delta.kind === 'folder-removed') {
      const prefix = toRelativePath(runtime.rootPath, delta.path)
      if (!prefix) return
      for (const name of runtime.documents.keys()) {
        if (name.startsWith(`${prefix}/`)) runtime.pendingChanges.set(name, 'remove')
      }
      if (runtime.pendingChanges.size) void this.scheduleDeltaFlush(runtime)
      return
    }
    if (delta.kind === 'folder-added') {
      const relative = toRelativePath(runtime.rootPath, delta.path)
      if (!relative || hasIgnoredPathSegment(delta.path, runtime.rootPath)) return
      for (const [name, operation] of runtime.pendingChanges) {
        if (operation !== 'scan') continue
        if (relative === name || relative.startsWith(`${name}/`)) return
        if (name.startsWith(`${relative}/`)) runtime.pendingChanges.delete(name)
      }
      runtime.pendingChanges.set(relative, 'scan')
      void this.scheduleDeltaFlush(runtime)
      return
    }
    const relativePath = toRelativePath(runtime.rootPath, delta.path)
    if (!relativePath || !isMarkdownRelativePath(relativePath)) return
    runtime.pendingChanges.set(relativePath, delta.kind === 'removed' ? 'remove' : 'upsert')
    void this.scheduleDeltaFlush(runtime)
  }

  private async flushDeltas(runtime: WorkspaceIndexRuntime, enqueuedAt?: number): Promise<void> {
    if (runtime.pendingChanges.size === 0 && !runtime.persistenceDirty) {
      this.publishWikiMetadata(runtime)
      if (!runtime.queuedRebuild && runtime.status.state === 'updating') {
        const hasWriteLease = await runtime.lock.isHeld() && !runtime.closing
        runtime.status = { ...runtime.status, state: hasWriteLease ? (runtime.readErrors.size ? 'degraded' : 'ready') : 'read-only', pendingDocuments: 0 }
        this.publishStatus(runtime)
      }
      return
    }
    const work = this.beginDiagnosticWork(runtime, 'delta', enqueuedAt)
    try {
    const changes = [...runtime.pendingChanges.entries()]
    runtime.pendingChanges.clear()
    for (const [relativePath, operation] of changes) {
      runtime.readErrors.delete(relativePath)
      if (operation === 'scan') {
        try {
          const canonical = await realpath(path.join(runtime.rootPath, relativePath))
          if (toRelativePath(runtime.rootPath, canonical) !== relativePath) continue
          const files = await glob(`${escapeGlob(relativePath)}/${MARKDOWN_GLOB}`, {
            cwd: runtime.rootPath, nodir: true, dot: false, follow: false, ignore: INDEX_IGNORED_PATHS,
          })
          for (const file of files) {
            const relative = file.split(path.sep).join('/')
            if (runtime.pendingChanges.get(relative) !== 'remove') runtime.pendingChanges.set(relative, 'upsert')
          }
          if (runtime.pendingChanges.size) void this.scheduleDeltaFlush(runtime)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') runtime.readErrors.add(relativePath)
        }
        continue
      }
      runtime.wiki.remove(relativePath)
      if (operation === 'remove') {
        runtime.documents.delete(relativePath)
        continue
      }
      try {
        runtime.documents.delete(relativePath)
        const document = await this.indexFile(runtime, path.join(runtime.rootPath, relativePath), work)
        if (document) runtime.documents.set(relativePath, document)
      } catch {
        runtime.readErrors.add(relativePath)
      }
    }
    const errors = runtime.readErrors.size
    const hasWriteLease = await runtime.lock.isHeld() && !runtime.closing
    if (hasWriteLease) {
      work.metrics.commitDurationMs += await this.commit(runtime)
    }
    runtime.status = {
      state: hasWriteLease ? (errors > 0 ? 'degraded' : 'ready') : 'read-only',
      generation: runtime.generation,
      indexedDocuments: runtime.documents.size,
      totalDocuments: runtime.documents.size,
      pendingDocuments: 0,
      errors,
    }
    this.publishWikiMetadata(runtime)
    this.publishStatus(runtime)
    this.finishDiagnosticWork(runtime, work, 'success')
    } catch (error) {
      this.finishDiagnosticWork(runtime, work, 'error')
      throw error
    }
  }

  private publishWikiMetadata(runtime: WorkspaceIndexRuntime): void {
    if (!runtime.closing && !runtime.queuedRebuild && runtime.pendingChanges.size === 0) {
      runtime.wiki.publish(runtime.documents, runtime.readErrors.size === 0)
    }
  }

  private async indexFile(
    runtime: WorkspaceIndexRuntime,
    filePath: string,
    work: ActiveIndexWork,
  ): Promise<IndexedDocument | null> {
    const started = performance.now()
    const metrics = work.metrics
    try {
      const canonicalPath = await realpath(filePath)
    const relativePath = toRelativePath(runtime.rootPath, canonicalPath)
    if (!relativePath) return null
    const stats = await stat(canonicalPath)
    if (!stats.isFile() || stats.size > MAX_FILE_SIZE) return null
    this.activeIndexReads += 1
    let bytes: Buffer
    try {
      bytes = await readFile(canonicalPath)
    } finally {
      this.activeIndexReads = Math.max(0, this.activeIndexReads - 1)
    }
    metrics.filesProcessed += 1
    metrics.bytesRead += bytes.byteLength
    metrics.bytesReadForValidation += bytes.byteLength
    const hashStarted = performance.now()
    const revisionToken = buildFullSha256Revision(bytes)
    metrics.hashDurationMs += performance.now() - hashStarted
    const cached = runtime.documents.get(relativePath)
    const source = bytes.toString('utf8')
    const includeAliases = !hasIgnoredPathSegment(canonicalPath, runtime.rootPath)
    const updateMetadata = (links: IndexedDocument['outboundLinks']): void => {
      const metadata = createWikiDocumentMetadata(source, revisionToken, links, includeAliases)
      runtime.wiki.set(relativePath, includeAliases && !isUtf8(bytes)
        ? { ...metadata, aliases: [], complete: false, issue: 'invalid' } : metadata)
    }
    if (cached?.revisionToken === revisionToken) {
      updateMetadata(cached.outboundLinks)
      metrics.contentReusedAfterFullRead += 1
      metrics.analysisSkippedAfterHash += 1
      return cached
    }
    const analysisStarted = performance.now()
    const analysis = analyzeMarkdownSource(source)
    updateMetadata(analysis.links)
    metrics.analyzeDurationMs += performance.now() - analysisStarted
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      rootKey: '',
      indexInstanceId: runtime.indexInstanceId ?? '',
      relativePath,
      revisionToken,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      indexedAt: Date.now(),
      headings: analysis.headings,
      outboundLinks: analysis.links,
      terms: analysis.terms,
      lineCount: analysis.lineCount,
    }
    } finally {
      this.recordSlowFile(work, filePath, performance.now() - started)
    }
  }

  private async commit(runtime: WorkspaceIndexRuntime): Promise<number> {
    const revisions = new Map([...runtime.documents].map(([name, doc]) => [name, doc.revisionToken]))
    const baseline = runtime.committedRevisions
    if (!runtime.persistenceDirty && baseline?.size === revisions.size &&
      [...revisions].every(([name, revision]) => baseline.get(name) === revision)) return 0
    runtime.persistenceDirty = true
    const work = this.beginDiagnosticWork(runtime, 'commit')
    const started = performance.now()
    try {
      const manifest = await this.store.commit({
        rootPath: runtime.rootPath,
        rootFingerprint: runtime.rootFingerprint,
        previousInstanceId: runtime.indexInstanceId,
        documents: [...runtime.documents.values()],
      })
      runtime.indexInstanceId = manifest.indexInstanceId
      for (const [relativePath, document] of runtime.documents) {
        if (document.rootKey !== manifest.rootKey || document.indexInstanceId !== manifest.indexInstanceId) {
          runtime.documents.set(relativePath, {
            ...document,
            rootKey: manifest.rootKey,
            indexInstanceId: manifest.indexInstanceId,
          })
        }
      }
      runtime.committedRevisions = revisions
      runtime.persistenceDirty = false
      runtime.commitFailed = false
      runtime.generation += 1
      const duration = performance.now() - started
      work.metrics.commitDurationMs = duration
      work.metrics.filesProcessed = runtime.documents.size
      this.finishDiagnosticWork(runtime, work, 'success')
      return duration
    } catch (error) {
      runtime.commitFailed = true
      this.finishDiagnosticWork(runtime, work, 'error')
      throw error
    }
  }

  private async readIfCurrent(
    filePath: string,
    revisionToken: string,
    work: ActiveIndexWork,
  ): Promise<string | null> {
    const started = performance.now()
    const metrics = work.metrics
    this.activeIndexReads += 1
    try {
      const bytes = await readFile(filePath)
      metrics.filesProcessed += 1
      metrics.bytesRead += bytes.byteLength
      metrics.bytesReadForValidation += bytes.byteLength
      const hashStarted = performance.now()
      const currentRevision = buildFullSha256Revision(bytes)
      metrics.hashDurationMs += performance.now() - hashStarted
      if (currentRevision !== revisionToken) return null
      metrics.contentReusedAfterFullRead += 1
      metrics.analysisSkippedAfterHash += 1
      return bytes.toString('utf8')
    } catch {
      return null
    } finally {
      this.activeIndexReads = Math.max(0, this.activeIndexReads - 1)
      this.recordSlowFile(work, filePath, performance.now() - started)
    }
  }

  private recordSlowFile(work: ActiveIndexWork, filePath: string, durationMs: number): void {
    const candidate = { path: filePath, durationMs }
    const insertionIndex = work.slowFiles.findIndex(file => durationMs > file.durationMs)
    if (insertionIndex < 0) work.slowFiles.push(candidate)
    else work.slowFiles.splice(insertionIndex, 0, candidate)
    if (work.slowFiles.length > 5) work.slowFiles.length = 5
  }

  private getRuntime(rootPath: string): WorkspaceIndexRuntime | undefined {
    const resolved = path.resolve(rootPath)
    return this.runtimes.get(this.aliases.get(resolved) ?? resolved) ?? this.runtimes.get(rootPath)
  }

  private requireRuntime(rootPath: string): WorkspaceIndexRuntime {
    const runtime = this.getRuntime(rootPath)
    if (!runtime || runtime.closing) throw new Error('工作区索引未附加')
    return runtime
  }

  private markError(runtime: WorkspaceIndexRuntime, error: unknown): void {
    runtime.continuationEpoch++
    runtime.wiki.invalidate()
    console.error('[WorkspaceIndex] Failed:', error)
    runtime.status = { ...runtime.status, state: 'error', errors: runtime.status.errors + 1 }
    this.publishStatus(runtime)
  }
}

function emptyIndexWorkMetrics(kind: IndexWorkloadKind): IndexWorkMetrics {
  return {
    cacheLoadMs: 0,
    globMs: 0,
    queueWaitMs: 0,
    lockWaitMs: 0,
    candidateCount: 0,
    filesProcessed: 0,
    bytesRead: 0,
    bytesReadForValidation: 0,
    readAvoidedCount: 0,
    contentReusedAfterFullRead: 0,
    analysisSkippedAfterHash: 0,
    hashDurationMs: 0,
    analyzeDurationMs: 0,
    commitDurationMs: 0,
    queryCount: kind === 'query' ? 1 : 0,
    backlinksQueryCount: kind === 'backlinks' ? 1 : 0,
  }
}

function isIndexQueryWorkload(kind: IndexWorkloadKind): kind is IndexQueryWorkloadKind {
  return kind === 'query' || kind === 'backlinks'
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))]
}

function emptyStatus(state: WorkspaceIndexStatus['state']): WorkspaceIndexStatus {
  return { state, generation: 0, indexedDocuments: 0, totalDocuments: 0, pendingDocuments: 0, errors: 0 }
}

function toRelativePath(rootPath: string, filePath: string): string | null {
  const relative = path.relative(rootPath, filePath)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return normalizeRelativePath(relative.split(path.sep).join('/'))
}

function normalizeRelativePath(relativePath: string): string {
  return path.posix.normalize(relativePath.replace(/\\/g, '/')).replace(/^\.\//, '')
}

function isMarkdownRelativePath(relativePath: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mkdn)$/i.test(relativePath)
}

export function resolveIndexedWikiTarget(
  documents: Pick<ReadonlyMap<string, IndexedDocument>, 'has' | 'keys'>,
  sourceRelativePath: string,
  rawPath: string,
): string | null {
  return resolveIndexedWikiTargetStatus(documents, sourceRelativePath, rawPath).target
}

export function resolveIndexedWikiTargetStatus(
  documents: Pick<ReadonlyMap<string, IndexedDocument>, 'has' | 'keys'>,
  sourceRelativePath: string,
  rawPath: string,
): { target: string | null, ambiguous: boolean } {
  const normalized = normalizeRelativePath(rawPath)
  const names = path.posix.extname(normalized)
    ? [normalized]
    : ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'].map(extension => `${normalized}${extension}`)

  const availablePaths = [...documents.keys()]
  const findExisting = (candidate: string): string | null => {
    const normalizedCandidate = normalizeRelativePath(candidate)
    if (process.platform === 'win32') {
      const lower = normalizedCandidate.toLocaleLowerCase()
      return availablePaths.find(value => value.toLocaleLowerCase() === lower) ?? null
    }
    return documents.has(normalizedCandidate) ? normalizedCandidate : null
  }

  if (normalized.includes('/')) {
    return { target: names.map(findExisting).find(Boolean) ?? null, ambiguous: false }
  }

  const sourceDir = path.posix.dirname(sourceRelativePath)
  const nearby = names
    .map(name => normalizeRelativePath(path.posix.join(sourceDir, name)))
    .map(findExisting)
    .find(Boolean)
  if (nearby) return { target: nearby, ambiguous: false }

  const atRoot = names.map(findExisting).find(Boolean)
  if (atRoot) return { target: atRoot, ambiguous: false }

  const basenames = new Set(names.map(name => path.posix.basename(name).toLocaleLowerCase()))
  const matches = availablePaths.filter(candidate => basenames.has(path.posix.basename(candidate).toLocaleLowerCase()))
  return { target: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 }
}

function findMatchingLine(content: string, terms: readonly string[]): number {
  const lines = content.split(/\r\n|\r|\n/)
  const normalizedTerms = terms.map(term => term.toLocaleLowerCase())
  const index = lines.findIndex(line => normalizedTerms.some(term => line.toLocaleLowerCase().includes(term)))
  return index < 0 ? 1 : index + 1
}

function buildSnippet(content: string, lineStart: number): string {
  const line = content.split(/\r\n|\r|\n/)[Math.max(0, lineStart - 1)] ?? ''
  return line.trim().replace(/\s+/g, ' ').slice(0, 240)
}
