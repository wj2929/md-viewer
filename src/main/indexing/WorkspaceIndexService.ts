import { readFile, realpath, stat } from 'fs/promises'
import { glob } from 'glob'
import * as path from 'path'
import { analyzeMarkdownSource, tokenizeSearchText } from '../../shared/markdown/analyze'
import { buildBacklinkPresentations } from '../../shared/markdown/backlinks'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { buildFullSha256Revision } from '../revisionToken'
import type { WorkspaceRootDelta, WorkspaceWatchService } from '../watching/WorkspaceWatchService'
import { WorkspaceIndexStore, type WorkspaceIndexLock } from './WorkspaceIndexStore'
import type {
  IndexedDocument,
  WorkspaceBacklinkResult,
  WorkspaceIndexStatus,
  WorkspaceSearchResult,
} from './types'

const MARKDOWN_GLOB = '**/*.{md,markdown,mdown,mkd,mkdn}'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_SEARCH_RESULTS = 100

interface WorkspaceIndexRuntime {
  rootPath: string
  rootFingerprint: string
  consumerIds: Set<string>
  documents: Map<string, IndexedDocument>
  status: WorkspaceIndexStatus
  indexInstanceId?: string
  queue: Promise<void>
  pendingChanges: Map<string, 'upsert' | 'remove'>
  flushScheduled: boolean
  generation: number
  lock: WorkspaceIndexLock
  closing: boolean
}

export class WorkspaceIndexService {
  private readonly runtimes = new Map<string, WorkspaceIndexRuntime>()
  private readonly initializations = new Map<string, Promise<WorkspaceIndexRuntime>>()
  private readonly teardowns = new Map<string, Promise<void>>()
  private readonly desiredConsumerRoots = new Map<string, Set<string>>()
  private readonly aliases = new Map<string, string>()
  private readonly statusListeners = new Map<string, Map<string, (status: WorkspaceIndexStatus) => void>>()

  constructor(
    private readonly store: WorkspaceIndexStore,
    private readonly watcher: WorkspaceWatchService,
  ) {}

  async attach(rootPath: string, consumerId: string): Promise<WorkspaceIndexStatus> {
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
    const lock = await this.store.acquireLock(canonicalRoot)
    const runtime: WorkspaceIndexRuntime = {
      rootPath: canonicalRoot,
      rootFingerprint,
      consumerIds: new Set([consumerId]),
      documents: new Map(),
      status: emptyStatus('building'),
      queue: Promise.resolve(),
      pendingChanges: new Map(),
      flushScheduled: false,
      generation: 0,
      lock,
      closing: false,
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
      for (const relativePath of [...runtime.documents.keys()]) {
        if (relativePath === oldPath || relativePath.startsWith(`${oldPath}/`)) {
          runtime.pendingChanges.set(relativePath, 'remove')
        }
      }
      if (isMarkdownRelativePath(newPath)) runtime.pendingChanges.set(newPath, 'upsert')
    }
    await this.flushPendingChanges(runtime)
  }

  private async flushPendingChanges(runtime: WorkspaceIndexRuntime): Promise<void> {
    if (runtime.closing || runtime.pendingChanges.size === 0) return
    runtime.status = { ...runtime.status, state: 'updating', pendingDocuments: runtime.pendingChanges.size }
    this.publishStatus(runtime)
    runtime.queue = runtime.queue.then(() => this.flushDeltas(runtime)).catch(error => this.markError(runtime, error))
    await runtime.queue
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

  async waitUntilIdle(rootPath: string): Promise<void> {
    const runtime = this.getRuntime(rootPath)
    if (!runtime) return
    do {
      await Promise.resolve()
      const queue = runtime.queue
      await queue
      if (queue === runtime.queue && !runtime.flushScheduled && runtime.pendingChanges.size === 0) return
    } while (true)
  }

  async rebuild(rootPath: string): Promise<WorkspaceIndexStatus> {
    const runtime = this.requireRuntime(rootPath)
    runtime.queue = runtime.queue.then(() => this.build(runtime)).catch(error => this.markError(runtime, error))
    await runtime.queue
    return runtime.status
  }

  async query(rootPath: string, query: string, limit = 50): Promise<WorkspaceSearchResult[]> {
    const runtime = this.requireRuntime(rootPath)
    const terms = [...new Set(tokenizeSearchText(query))]
    if (terms.length === 0) return []
    const results: WorkspaceSearchResult[] = []

    for (const document of runtime.documents.values()) {
      const score = terms.reduce((total, term) => total + (document.terms[term] ?? 0), 0)
      if (score === 0) continue
      const absolutePath = path.join(runtime.rootPath, document.relativePath)
      const content = await this.readIfCurrent(absolutePath, document.revisionToken)
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

    return results
      .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
      .slice(0, Math.min(Math.max(1, limit), MAX_SEARCH_RESULTS))
  }

  async getBacklinks(rootPath: string, targetRelativePath: string): Promise<WorkspaceBacklinkResult[]> {
    const runtime = this.requireRuntime(rootPath)
    const normalizedTarget = normalizeRelativePath(targetRelativePath)
    const results: WorkspaceBacklinkResult[] = []
    for (const document of runtime.documents.values()) {
      const sourceDir = path.posix.dirname(document.relativePath)
      const matchingLinks = document.outboundLinks.filter(link => {
        if (link.kind !== 'markdown') return false
        const { decodedPath } = splitMarkdownTarget(link.rawTarget)
        if (!decodedPath || path.posix.isAbsolute(decodedPath)) return false
        const target = normalizeRelativePath(path.posix.join(sourceDir, decodedPath))
        return target === normalizedTarget
      })
      if (matchingLinks.length === 0) continue
      const source = await this.readIfCurrent(path.join(runtime.rootPath, document.relativePath), document.revisionToken)
      if (source === null) continue
      const presentations = buildBacklinkPresentations(source, document.outboundLinks)
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
    return results.sort((left, right) =>
      left.sourceRelativePath.localeCompare(right.sourceRelativePath) || left.lineStart - right.lineStart
    )
  }

  private publishStatus(runtime: WorkspaceIndexRuntime): void {
    for (const listener of this.statusListeners.get(runtime.rootPath)?.values() ?? []) {
      listener(runtime.status)
    }
  }

  private async build(runtime: WorkspaceIndexRuntime): Promise<void> {
    runtime.status = emptyStatus('building')
    this.publishStatus(runtime)
    const cached = await this.store.load(runtime.rootPath, runtime.rootFingerprint)
    if (cached) {
      runtime.indexInstanceId = cached.manifest.indexInstanceId
      runtime.documents = new Map(cached.documents.map(document => [document.relativePath, document]))
    }

    const paths = await glob(MARKDOWN_GLOB, {
      cwd: runtime.rootPath,
      absolute: true,
      nodir: true,
      dot: false,
      ignore: ['**/node_modules/**', '**/.*/**', '**/vendor/**', '**/target/**', '**/build/**', '**/dist/**'],
    })
    runtime.status.totalDocuments = paths.length
    const seen = new Set<string>()
    let errors = 0
    for (const filePath of paths) {
      try {
        const document = await this.indexFile(runtime, filePath)
        if (document) {
          runtime.documents.set(document.relativePath, document)
          seen.add(document.relativePath)
        }
      } catch {
        errors += 1
      }
      runtime.status.indexedDocuments = seen.size
      runtime.status.pendingDocuments = Math.max(0, paths.length - seen.size - errors)
      this.publishStatus(runtime)
    }
    for (const relativePath of runtime.documents.keys()) {
      if (!seen.has(relativePath)) runtime.documents.delete(relativePath)
    }
    runtime.status.errors = errors
    const hasWriteLease = await runtime.lock.isHeld() && !runtime.closing
    if (hasWriteLease) {
      await this.commit(runtime)
    }
    runtime.status = {
      state: hasWriteLease ? (errors > 0 ? 'degraded' : 'ready') : 'read-only',
      generation: runtime.generation,
      indexedDocuments: runtime.documents.size,
      totalDocuments: paths.length,
      pendingDocuments: 0,
      errors,
    }
    this.publishStatus(runtime)
  }

  private enqueueDelta(runtime: WorkspaceIndexRuntime, delta: WorkspaceRootDelta): void {
    if (runtime.closing) return
    if (delta.kind === 'folder-added' || delta.kind === 'folder-removed' || delta.kind === 'renamed') return
    const relativePath = toRelativePath(runtime.rootPath, delta.path)
    if (!relativePath || !isMarkdownRelativePath(relativePath)) return
    runtime.pendingChanges.set(relativePath, delta.kind === 'removed' ? 'remove' : 'upsert')
    runtime.status = { ...runtime.status, state: 'updating', pendingDocuments: runtime.pendingChanges.size }
    this.publishStatus(runtime)
    if (runtime.flushScheduled) return
    runtime.flushScheduled = true
    queueMicrotask(() => {
      runtime.flushScheduled = false
      if (runtime.closing) return
      runtime.queue = runtime.queue.then(() => this.flushDeltas(runtime)).catch(error => this.markError(runtime, error))
    })
  }

  private async flushDeltas(runtime: WorkspaceIndexRuntime): Promise<void> {
    const changes = [...runtime.pendingChanges.entries()]
    runtime.pendingChanges.clear()
    let errors = runtime.status.errors
    for (const [relativePath, operation] of changes) {
      if (operation === 'remove') {
        runtime.documents.delete(relativePath)
        continue
      }
      try {
        runtime.documents.delete(relativePath)
        const document = await this.indexFile(runtime, path.join(runtime.rootPath, relativePath))
        if (document) runtime.documents.set(relativePath, document)
      } catch {
        errors += 1
      }
    }
    const hasWriteLease = await runtime.lock.isHeld() && !runtime.closing
    if (hasWriteLease) {
      await this.commit(runtime)
    }
    runtime.status = {
      state: hasWriteLease ? (errors > 0 ? 'degraded' : 'ready') : 'read-only',
      generation: runtime.generation,
      indexedDocuments: runtime.documents.size,
      totalDocuments: runtime.documents.size,
      pendingDocuments: 0,
      errors,
    }
    this.publishStatus(runtime)
  }

  private async indexFile(runtime: WorkspaceIndexRuntime, filePath: string): Promise<IndexedDocument | null> {
    const canonicalPath = await realpath(filePath)
    const relativePath = toRelativePath(runtime.rootPath, canonicalPath)
    if (!relativePath) return null
    const stats = await stat(canonicalPath)
    if (!stats.isFile() || stats.size > MAX_FILE_SIZE) return null
    const bytes = await readFile(canonicalPath)
    const revisionToken = buildFullSha256Revision(bytes)
    const cached = runtime.documents.get(relativePath)
    if (cached?.revisionToken === revisionToken) return cached
    const source = bytes.toString('utf8')
    const analysis = analyzeMarkdownSource(source)
    return {
      schemaVersion: 1,
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
  }

  private async commit(runtime: WorkspaceIndexRuntime): Promise<void> {
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
    runtime.generation += 1
  }

  private async readIfCurrent(filePath: string, revisionToken: string): Promise<string | null> {
    try {
      const bytes = await readFile(filePath)
      if (buildFullSha256Revision(bytes) !== revisionToken) return null
      return bytes.toString('utf8')
    } catch {
      return null
    }
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
    console.error('[WorkspaceIndex] Failed:', error)
    runtime.status = { ...runtime.status, state: 'error', errors: runtime.status.errors + 1 }
    this.publishStatus(runtime)
  }
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
