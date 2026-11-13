import * as path from 'node:path'
import { WatchReconcileSupersededError, type WorkspaceWatchHealth } from '../../shared/workspaceWatch'
import { WatchProcessHost, type PhysicalWatch, type WatchDiagnostic, type WatchRetryDiagnostic } from './WatchProcessHost'
import { hasIgnoredPathSegment, isPathInside } from './watchPaths'
import { WATCH_LIMITS, type PhysicalWatchEvent } from './watchProtocol'
export { hasIgnoredPathSegment, isWatchPathSafe } from './watchPaths'

export interface WorkspaceWatchContext {
  workspaceId: string
  lifecycleEpoch: number
  primaryRoot: string | null
  strict: boolean
}
export interface WorkspaceWatchEvent {
  workspaceId: string
  lifecycleEpoch: number
  path?: string
  oldPath?: string
  newPath?: string
}
export type WorkspaceWatchChannel = 'file:added' | 'file:changed' | 'file:removed' | 'file:renamed' | 'folder:added' | 'folder:removed'
export type WorkspaceRootDelta =
  | { kind: 'added' | 'changed' | 'removed'; path: string }
  | { kind: 'renamed'; oldPath: string; newPath: string; inferred: true }
  | { kind: 'folder-added' | 'folder-removed'; path: string }
export interface WorkspaceWatchSubscription extends WorkspaceWatchContext {
  key: string
  isCurrent?: () => boolean
  deliver: (channel: WorkspaceWatchChannel, event: WorkspaceWatchEvent) => void
  onFolderRemoved?: (rootPath: string, removedPath: string) => void
  onHealth?: (status: WorkspaceWatchHealth) => void
  reconcile?: (phase: 'refresh' | 'drain') => Promise<void>
}
interface PendingUnlink { timestamp: number; timer: ReturnType<typeof setTimeout> }
interface RootWatcherState {
  watch: PhysicalWatch
  uiSubscribers: Map<string, WorkspaceWatchSubscription>
  indexConsumers: Map<string, (delta: WorkspaceRootDelta) => void>
  pendingUnlinks: Map<string, PendingUnlink>
  lastGap: number
  reconciling?: Promise<void>
}
interface OpenedFileState {
  watch?: PhysicalWatch
  subscribers: Map<string, WorkspaceWatchSubscription>
  pendingRemoval?: ReturnType<typeof setTimeout>
  lastGap: number
  reconciling?: Promise<void>
}
interface RecoveryEpisode {
  identity: string
  failures: number
  elapsedMs: number
}
const RENAME_THRESHOLD_MS = 500
const RECONCILE_DEADLINE_MS = 30_000

export class WorkspaceWatchService {
  private readonly roots = new Map<string, RootWatcherState>()
  private readonly rootByUiSubscriber = new Map<string, string>()
  private readonly openedFiles = new Map<string, OpenedFileState>()
  private statusVersion = 0
  private indexReconciler?: (root: string, phase: 'refresh' | 'drain') => Promise<void>
  private readonly indexReconciliations = new Map<string, Promise<void>>()
  private readonly trailingIndexReconciliations = new Map<string, Promise<void>>()
  private stopping = false
  private readonly recoveries = new Map<PhysicalWatch, RecoveryEpisode>()
  private recoveryTimer?: ReturnType<typeof setInterval>
  private recoveryTickAt = 0
  private recoveryGraceUntil = 0
  private suspended = false
  private coverageEpoch = 0
  private readonly alignmentWaiters = new Set<() => void>()

  constructor(private readonly host = new WatchProcessHost()) {}

  setDiagnostics(diagnostics: WatchDiagnostic): void { this.host.setDiagnostics(diagnostics) }
  setIndexReconciler(reconcile: (root: string, phase: 'refresh' | 'drain') => Promise<void>): void { this.indexReconciler = reconcile }
  suspend(): void { this.coverageEpoch++; this.suspended = true; this.host.suspend() }
  resume(): void {
    this.suspended = false
    this.recoveryTickAt = Date.now()
    this.recoveryGraceUntil = Date.now() + WATCH_LIMITS.unresponsiveMs
    this.host.resume()
    for (const [root, state] of this.roots) this.rootChanged(root, state)
    for (const [file, state] of this.openedFiles) this.fileChanged(file, state)
  }

  attachRoot(rootPath: string, subscription: WorkspaceWatchSubscription): void {
    rootPath = path.resolve(rootPath)
    const previous = this.rootByUiSubscriber.get(subscription.key)
    const oldSubscription = previous && this.roots.get(previous)?.uiSubscribers.get(subscription.key)
    if (previous && (previous !== rootPath || (oldSubscription && oldSubscription.lifecycleEpoch !== subscription.lifecycleEpoch))) this.detachUi(subscription.key)
    const state = this.getOrCreateRoot(rootPath)
    const isNew = state.uiSubscribers.get(subscription.key) !== subscription
    state.uiSubscribers.set(subscription.key, subscription)
    this.rootByUiSubscriber.set(subscription.key, rootPath)
    if (isNew && state.watch.crawlComplete) {
      this.host.markGap(state.watch)
    }
    this.notifyHealth()
  }

  detachUi(key: string, epoch?: number): void {
    const root = this.rootByUiSubscriber.get(key)
    if (root) {
      const state = this.roots.get(root)
      if (epoch !== undefined && state?.uiSubscribers.get(key)?.lifecycleEpoch !== epoch) return
      this.rootByUiSubscriber.delete(key)
      state?.uiSubscribers.delete(key)
      this.closeRootIfUnused(root)
    }
    for (const [file, state] of this.openedFiles) {
      if (epoch !== undefined && state.subscribers.get(key)?.lifecycleEpoch !== epoch) continue
      state.subscribers.delete(key)
      this.updateFileWatch(file, state)
    }
    this.notifyAlignmentWaiters()
  }

  attachIndexConsumer(root: string, consumerId: string, consumer: (delta: WorkspaceRootDelta) => void): void {
    const state = this.getOrCreateRoot(path.resolve(root))
    const needsAlignment = state.indexConsumers.size === 0
    state.indexConsumers.set(consumerId, consumer)
    // Additional query consumers share the already-aligned index. Rebuilding on
    // every history query would refresh the tree and trigger the same query again.
    if (needsAlignment && state.watch.crawlComplete) {
      this.host.markGap(state.watch)
    }
  }

  detachIndexConsumer(root: string, consumerId: string): void {
    root = path.resolve(root)
    this.roots.get(root)?.indexConsumers.delete(consumerId)
    this.closeRootIfUnused(root)
  }

  watchOpenedFile(file: string, subscription: WorkspaceWatchSubscription): void {
    file = path.resolve(file)
    let state = this.openedFiles.get(file)
    if (!state) {
      if (this.openedFiles.size >= WATCH_LIMITS.watches) throw new Error('已打开文件监听已达容量上限')
      state = { subscribers: new Map(), lastGap: 0 }
      this.openedFiles.set(file, state)
    }
    const previous = state.subscribers.get(subscription.key)
    if (previous && previous.lifecycleEpoch > subscription.lifecycleEpoch) return
    state.subscribers.set(subscription.key, subscription)
    this.updateFileWatch(file, state)
    this.notifyHealth()
  }

  async unwatchOpenedFile(key: string, file: string, lifecycleEpoch: number): Promise<void> {
    file = path.resolve(file)
    const state = this.openedFiles.get(file)
    if (!state || state.subscribers.get(key)?.lifecycleEpoch !== lifecycleEpoch) return
    state.subscribers.delete(key)
    this.updateFileWatch(file, state)
  }

  hasRootSubscription(key: string, file: string): boolean {
    const root = this.rootByUiSubscriber.get(key)
    const state = root && this.roots.get(root)
    return Boolean(root && state && state.watch.crawlComplete && !state.watch.failed &&
      isPathInside(root, file) && !hasIgnoredPathSegment(file, root) &&
      !state.watch.excluded.some(relative => isPathInside(path.join(root, relative), file)))
  }

  getOpenedFileCount(key: string): number {
    return [...this.openedFiles.values()].filter(state => state.watch && state.subscribers.has(key)).length
  }

  cleanupWebContents(webContentsId: number, workspaceId?: string, epoch?: number): void {
    const keys = new Set([...this.rootByUiSubscriber.keys(), ...[...this.openedFiles.values()].flatMap(state => [...state.subscribers.keys()])])
    for (const key of keys) {
      if (key.startsWith(`${webContentsId}:`) && (!workspaceId || key === `${webContentsId}:${workspaceId}`)) this.detachUi(key, epoch)
    }
  }

  async waitForRootAlignment(rootPath: string, assertCurrent: () => void, timeoutMs = RECONCILE_DEADLINE_MS): Promise<void> {
    const root = path.resolve(rootPath)
    const state = this.roots.get(root)
    if (!state) throw new Error('监听目录已变化')
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown): void => {
        clearTimeout(timer)
        this.alignmentWaiters.delete(check)
        if (error) reject(error)
        else resolve()
      }
      const check = (): void => {
        try {
          assertCurrent()
          if (this.stopping || this.roots.get(root) !== state) throw new Error('监听目录已变化')
          const watch = state.watch
          if (watch.failed || (!this.suspended && watch.crawlComplete &&
            watch.gapVersion === watch.reconciledGapVersion && !state.reconciling)) finish()
        } catch (error) { finish(error) }
      }
      const timer = setTimeout(() => finish(new Error('监听对齐超时，请重新预览文件操作')), Math.max(0, timeoutMs))
      timer.unref?.()
      this.alignmentWaiters.add(check)
      check()
    })
  }

  getIndexCoverage(root: string): { token: string; complete: boolean } {
    const watch = this.roots.get(root)?.watch
    if (!watch) return { token: 'detached', complete: false }
    const health = this.host.health(watch)
    return {
      token: [watch.id, watch.generation, watch.gapVersion, watch.reconciledGapVersion, this.coverageEpoch].join(':'),
      complete: !this.suspended && health.state === 'healthy' && !health.partialCoverage,
    }
  }

  getHealth(key: string): WorkspaceWatchHealth {
    const root = this.rootByUiSubscriber.get(key)
    const rootWatch = root && this.roots.get(root)?.watch
    const watches = [...(rootWatch ? [rootWatch] : []), ...[...this.openedFiles.values()]
      .filter(state => state.watch && state.subscribers.has(key)).map(state => state.watch!)]
    const statuses = watches.map(watch => this.host.health(watch))
    const state = statuses.some(status => status.state === 'degraded') ? 'degraded'
      : statuses.some(status => status.state === 'recovering') ? 'recovering'
      : statuses.some(status => status.state === 'starting') ? 'starting' : statuses.length ? 'healthy' : 'detached'
    return {
      version: this.statusVersion, state,
      partialCoverage: statuses.some(status => status.partialCoverage),
      excludedDirectoryCount: statuses.reduce((sum, status) => sum + status.excludedDirectoryCount, 0),
      gapVersion: Math.max(0, ...statuses.map(status => status.gapVersion)),
      reconciledGapVersion: Math.min(...statuses.map(status => status.reconciledGapVersion), ...(statuses.length ? [] : [0])),
      reason: statuses.find(status => status.reason)?.reason,
    }
  }

  reportGap(key: string): void {
    const root = this.rootByUiSubscriber.get(key)
    const state = root && this.roots.get(root)
    if (state) this.host.markGap(state.watch)
    for (const file of this.openedFiles.values()) {
      if (file.watch && file.subscribers.has(key)) this.host.markGap(file.watch)
    }
  }

  captureAccess(subscription: WorkspaceWatchSubscription): (canonicalPath: string) => void {
    const candidates = [...this.roots.values(), ...this.openedFiles.values()].flatMap(state => {
      const subscribers = 'uiSubscribers' in state ? state.uiSubscribers : state.subscribers
      const watch = state.watch
      if (!watch || subscribers.get(subscription.key) !== subscription) return []
      // A read can start before this subscription's first child has spawned.
      const generation = watch.generation || 1
      const isCurrent = () => !this.stopping && subscribers.get(subscription.key) === subscription &&
        subscription.isCurrent?.() !== false && watch.generation === generation
      return [{ watch, isCurrent }]
    })
    return canonicalPath => {
      for (const { watch, isCurrent } of candidates) {
        const matches = watch.kind === 'file' ? canonicalPath === watch.path
          : isPathInside(watch.path, canonicalPath) && !hasIgnoredPathSegment(canonicalPath, watch.path)
        if (matches) this.host.recoverAfterAccess(watch, isCurrent)
      }
    }
  }

  retry(key: string, observe?: WatchRetryDiagnostic): void {
    const root = this.rootByUiSubscriber.get(key)
    const rootState = root && this.roots.get(root)
    if (rootState) this.endRecovery(rootState.watch)
    const files = [...this.openedFiles.values()].filter(state => state.subscribers.has(key))
    for (const file of files) if (file.watch) this.endRecovery(file.watch)
    const fileWatches = files.flatMap(state => state.watch ? [state.watch] : [])
    const watches = [...(rootState ? [rootState.watch] : []), ...fileWatches]
    observe?.({ watchRetryStage: 'subscriptions-selected', watchSelectedCount: watches.length,
      watchRootSelected: Boolean(rootState), watchOpenedSelectedCount: fileWatches.length })
    this.host.retry(watches, observe)
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    this.notifyAlignmentWaiters()
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = undefined
    this.recoveries.clear()
    for (const state of this.roots.values()) this.clearRenames(state)
    for (const state of this.openedFiles.values()) if (state.pendingRemoval) clearTimeout(state.pendingRemoval)
    this.roots.clear()
    this.openedFiles.clear()
    this.rootByUiSubscriber.clear()
    await this.host.shutdown()
  }

  private getOrCreateRoot(root: string): RootWatcherState {
    const existing = this.roots.get(root)
    if (existing) return existing
    if (this.roots.size >= WATCH_LIMITS.watches) throw new Error('目录监听已达容量上限')
    const state: RootWatcherState = {
      watch: undefined as unknown as PhysicalWatch, uiSubscribers: new Map(), indexConsumers: new Map(),
      pendingUnlinks: new Map(), lastGap: 0,
    }
    this.roots.set(root, state)
    state.watch = this.host.add(root, 'root', {
      event: event => this.handleRootEvent(root, state, event),
      change: () => queueMicrotask(() => this.rootChanged(root, state)),
    })
    return state
  }

  private rootChanged(root: string, state: RootWatcherState): void {
    if (this.stopping || this.roots.get(root) !== state) return
    if (state.lastGap !== state.watch.gapVersion) {
      this.clearRenames(state)
      state.lastGap = state.watch.gapVersion
    }
    for (const [file, opened] of this.openedFiles) this.updateFileWatch(file, opened)
    this.notifyHealth()
    if (state.watch.failed || !state.watch.crawlComplete || state.watch.reconciledGapVersion === state.watch.gapVersion) {
      this.endRecovery(state.watch)
      return
    }
    if (state.reconciling || this.suspended) return
    state.reconciling = this.reconcile(state.watch, async phase => {
      const subscribers = [...state.uiSubscribers.values()]
      await Promise.all([
        ...(state.indexConsumers.size && this.indexReconciler ? [this.reconcileIndex(root, phase)] : []),
        ...subscribers.map(subscriber => subscriber.reconcile?.(phase)),
      ])
    }).finally(() => {
      state.reconciling = undefined
      if (this.roots.get(root) === state && !this.recoveries.has(state.watch)) this.rootChanged(root, state)
    })
  }

  private updateFileWatch(file: string, state: OpenedFileState): void {
    const needed = [...state.subscribers.keys()].some(key => !this.hasRootSubscription(key, file))
    if (state.subscribers.size === 0 || !needed) {
      const watch = state.watch
      state.watch = undefined
      if (state.pendingRemoval) clearTimeout(state.pendingRemoval)
      state.pendingRemoval = undefined
      if (state.subscribers.size === 0) this.openedFiles.delete(file)
      if (watch) { this.endRecovery(watch); this.host.remove(watch) }
    } else if (!state.watch) {
      // Keep the logical subscription while its root starts; the root's initial
      // refresh/barrier/drain aligns changes before coverage becomes healthy.
      if ([...state.subscribers.keys()].every(key => {
        if (this.hasRootSubscription(key, file)) return true
        const root = this.rootByUiSubscriber.get(key)
        const watch = root && this.roots.get(root)?.watch
        return Boolean(root && watch && !watch.crawlComplete && !watch.failed &&
          isPathInside(root, file) && !hasIgnoredPathSegment(file, root))
      })) return
      // A failed shared backend must not be replayed indirectly through every loaded tab.
      if ([...state.subscribers.keys()].some(key => {
        const root = this.rootByUiSubscriber.get(key)
        return root && this.roots.get(root)?.watch.failed
      })) return
      state.watch = this.host.add(file, 'file', {
        event: event => {
          if (state.pendingRemoval) clearTimeout(state.pendingRemoval)
          state.pendingRemoval = undefined
          if (event.kind === 'unlink') {
            this.publishSupplementalIndex(file, 'removed')
            state.pendingRemoval = setTimeout(() => {
              state.pendingRemoval = undefined
              for (const subscriber of state.subscribers.values()) this.deliver(subscriber, 'file:removed', { path: file })
            }, RENAME_THRESHOLD_MS + 50)
          } else if (event.kind === 'add' || event.kind === 'change') {
            for (const subscriber of state.subscribers.values()) this.deliver(subscriber, 'file:changed', { path: file })
            this.publishSupplementalIndex(file, 'changed')
          }
        },
        change: () => queueMicrotask(() => this.fileChanged(file, state)),
      })
    }
  }

  private publishSupplementalIndex(file: string, kind: 'changed' | 'removed'): void {
    for (const [root, state] of this.roots) {
      if (isPathInside(root, file) && !hasIgnoredPathSegment(file, root)) this.publishIndex(state, { kind, path: file })
    }
  }

  private fileChanged(file: string, state: OpenedFileState): void {
    const watch = state.watch
    if (this.stopping || !watch || this.openedFiles.get(file) !== state) return
    if (state.lastGap !== watch.gapVersion) {
      if (state.pendingRemoval) clearTimeout(state.pendingRemoval)
      state.pendingRemoval = undefined
      state.lastGap = watch.gapVersion
    }
    this.notifyHealth()
    if (watch.failed || !watch.crawlComplete || watch.reconciledGapVersion === watch.gapVersion) {
      this.endRecovery(watch)
      return
    }
    if (state.reconciling || this.suspended) return
    state.reconciling = this.reconcile(watch, async phase => {
      await Promise.all([
        ...[...this.roots].filter(([root, state]) => state.indexConsumers.size && isPathInside(root, file) && !hasIgnoredPathSegment(file, root))
          .map(([root]) => this.reconcileIndex(root, phase)),
        ...[...state.subscribers.values()].map(subscriber => subscriber.reconcile?.(phase)),
      ])
    }).finally(() => { state.reconciling = undefined; if (!state.watch || !this.recoveries.has(state.watch)) this.fileChanged(file, state) })
  }

  private reconcileIndex(root: string, phase: 'refresh' | 'drain'): Promise<void> {
    if (!this.indexReconciler) return Promise.resolve()
    if (phase === 'drain') return this.indexReconciler(root, phase)
    const key = `${phase}:${root}`
    const existing = this.indexReconciliations.get(key)
    if (existing) {
      let trailing = this.trailingIndexReconciliations.get(key)
      if (!trailing) {
        trailing = existing.catch(() => {}).then(() => {
          this.trailingIndexReconciliations.delete(key)
          return this.reconcileIndex(root, phase)
        })
        this.trailingIndexReconciliations.set(key, trailing)
      }
      return trailing
    }
    const work = this.indexReconciler(root, phase).finally(() => {
      if (this.indexReconciliations.get(key) === work) this.indexReconciliations.delete(key)
    })
    this.indexReconciliations.set(key, work)
    return work
  }

  private beginRecovery(watch: PhysicalWatch): RecoveryEpisode {
    const identity = `${watch.processGeneration}:${watch.id}:${watch.generation}`
    let episode = this.recoveries.get(watch)
    if (!episode || episode.identity !== identity) {
      episode = { identity, failures: 0, elapsedMs: 0 }
      this.recoveries.set(watch, episode)
    }
    if (!this.recoveryTimer) {
      this.recoveryTickAt = Date.now()
      this.recoveryTimer = setInterval(() => {
        const now = Date.now()
        const delta = Math.max(0, now - this.recoveryTickAt)
        this.recoveryTickAt = now
        if (this.suspended) return
        if (delta > WATCH_LIMITS.unresponsiveMs) this.recoveryGraceUntil = now + WATCH_LIMITS.unresponsiveMs
        if (now < this.recoveryGraceUntil) return
        for (const [current, recovery] of this.recoveries) {
          recovery.elapsedMs += delta
          if (recovery.elapsedMs >= RECONCILE_DEADLINE_MS) {
            this.endRecovery(current)
            this.host.fail(current, 'reconcile')
          }
        }
        // One bounded wake-up for superseded/failed work; never spin in microtasks.
        for (const [root, state] of this.roots) {
          if (!state.reconciling && this.recoveries.has(state.watch)) this.rootChanged(root, state)
        }
        for (const [file, state] of this.openedFiles) {
          if (!state.reconciling && state.watch && this.recoveries.has(state.watch)) this.fileChanged(file, state)
        }
      }, 1000)
      this.recoveryTimer.unref?.()
    }
    return episode
  }

  private endRecovery(watch: PhysicalWatch): void {
    this.recoveries.delete(watch)
    if (this.recoveries.size === 0 && this.recoveryTimer) {
      clearInterval(this.recoveryTimer)
      this.recoveryTimer = undefined
    }
  }

  private async reconcile(watch: PhysicalWatch, apply: (phase: 'refresh' | 'drain') => Promise<void>): Promise<void> {
    const episode = this.beginRecovery(watch)
    const gap = watch.gapVersion
    const generation = watch.generation
    const processGeneration = watch.processGeneration
    const isCurrent = () => !this.stopping && !watch.failed && watch.generation === generation &&
      watch.processGeneration === processGeneration && this.recoveries.get(watch) === episode
    try {
      await apply('refresh')
      if (!isCurrent() || watch.gapVersion !== gap) return
      await this.host.barrier(watch)
      for (const root of this.roots.values()) if (root.watch === watch) this.flushRenames(root)
      for (const [file, state] of this.openedFiles) {
        if (state.watch !== watch || !state.pendingRemoval) continue
        clearTimeout(state.pendingRemoval)
        state.pendingRemoval = undefined
        for (const subscriber of state.subscribers.values()) this.deliver(subscriber, 'file:removed', { path: file })
      }
      await apply('drain')
      if (!isCurrent() || watch.gapVersion !== gap) return
      this.host.reconciled(watch, gap, generation)
      this.endRecovery(watch)
    } catch (error) {
      if (!isCurrent()) return
      if (!(error instanceof WatchReconcileSupersededError) && !this.suspended && Date.now() >= this.recoveryGraceUntil) episode.failures++
      if (episode.failures >= 3) {
        this.endRecovery(watch)
        this.host.fail(watch, 'reconcile')
      } else if (watch.gapVersion === gap) this.host.markGap(watch)
    }
  }

  private handleRootEvent(root: string, state: RootWatcherState, event: PhysicalWatchEvent): void {
    if (this.roots.get(root) !== state) return
    if (state.lastGap !== state.watch.gapVersion) { this.clearRenames(state); state.lastGap = state.watch.gapVersion }
    const file = path.resolve(root, event.path)
    if (!isPathInside(root, file)) { this.host.fail(state.watch, 'protocol'); return }
    if (event.kind === 'change') this.publish(state, 'file:changed', { kind: 'changed', path: file })
    else if (event.kind === 'add') this.handleRootAdd(state, file, event.observedAt)
    else if (event.kind === 'unlink') this.handleRootUnlink(state, file, event.observedAt)
    else if (event.kind === 'addDir' && file !== root) this.publish(state, 'folder:added', { kind: 'folder-added', path: file })
    else if (event.kind === 'unlinkDir') {
      for (const subscriber of state.uiSubscribers.values()) subscriber.onFolderRemoved?.(root, file)
      this.publish(state, 'folder:removed', { kind: 'folder-removed', path: file })
    }
  }

  private handleRootAdd(state: RootWatcherState, file: string, observedAt: number): void {
    const samePath = state.pendingUnlinks.get(file)
    if (samePath) {
      clearTimeout(samePath.timer)
      state.pendingUnlinks.delete(file)
      this.publish(state, 'file:changed', { kind: 'changed', path: file })
      return
    }
    const candidates = [...state.pendingUnlinks.entries()].filter(([oldPath, pending]) =>
      observedAt >= pending.timestamp && observedAt - pending.timestamp < RENAME_THRESHOLD_MS && path.extname(oldPath).toLowerCase() === path.extname(file).toLowerCase())
    const sameDirectory = candidates.filter(([oldPath]) => path.dirname(oldPath) === path.dirname(file))
    const candidate = sameDirectory.length === 1 ? sameDirectory[0] : candidates.length === 1 ? candidates[0] : null
    if (!candidate) { this.publish(state, 'file:added', { kind: 'added', path: file }); return }
    const [oldPath, pending] = candidate
    clearTimeout(pending.timer)
    state.pendingUnlinks.delete(oldPath)
    this.publishIndex(state, { kind: 'added', path: file })
    this.publish(state, 'file:renamed', { kind: 'renamed', oldPath, newPath: file, inferred: true }, false)
  }

  private handleRootUnlink(state: RootWatcherState, file: string, observedAt: number): void {
    // Rename inference delays only UI delivery, never the index's deletion fact.
    this.publishIndex(state, { kind: 'removed', path: file })
    const old = state.pendingUnlinks.get(file)
    if (old) clearTimeout(old.timer)
    const timer = setTimeout(() => {
      if (state.pendingUnlinks.get(file)?.timer !== timer) return
      state.pendingUnlinks.delete(file)
      this.publish(state, 'file:removed', { kind: 'removed', path: file }, false)
    }, RENAME_THRESHOLD_MS + 50)
    state.pendingUnlinks.set(file, { timestamp: observedAt, timer })
  }

  private flushRenames(state: RootWatcherState): void {
    for (const [file, pending] of state.pendingUnlinks) {
      clearTimeout(pending.timer)
      this.publish(state, 'file:removed', { kind: 'removed', path: file }, false)
    }
    state.pendingUnlinks.clear()
  }

  private clearRenames(state: RootWatcherState): void {
    for (const pending of state.pendingUnlinks.values()) clearTimeout(pending.timer)
    state.pendingUnlinks.clear()
  }

  private publish(state: RootWatcherState, channel: WorkspaceWatchChannel, delta: WorkspaceRootDelta, notifyIndex = true): void {
    const event = delta.kind === 'renamed' ? { oldPath: delta.oldPath, newPath: delta.newPath } : { path: delta.path }
    for (const subscriber of state.uiSubscribers.values()) this.deliver(subscriber, channel, event)
    if (notifyIndex) this.publishIndex(state, delta)
  }
  private publishIndex(state: RootWatcherState, delta: WorkspaceRootDelta): void {
    for (const consumer of state.indexConsumers.values()) consumer(delta)
  }
  private deliver(subscription: WorkspaceWatchSubscription, channel: WorkspaceWatchChannel, patch: Omit<WorkspaceWatchEvent, keyof WorkspaceWatchContext>): void {
    subscription.deliver(channel, { workspaceId: subscription.workspaceId, lifecycleEpoch: subscription.lifecycleEpoch, ...patch })
  }
  private notifyAlignmentWaiters(): void {
    for (const check of [...this.alignmentWaiters]) check()
  }

  private notifyHealth(): void {
    this.statusVersion++
    const subscriptions = new Map<string, WorkspaceWatchSubscription>()
    for (const root of this.roots.values()) for (const [key, sub] of root.uiSubscribers) subscriptions.set(key, sub)
    for (const file of this.openedFiles.values()) for (const [key, sub] of file.subscribers) subscriptions.set(key, sub)
    for (const [key, sub] of subscriptions) sub.onHealth?.(this.getHealth(key))
    this.notifyAlignmentWaiters()
  }
  private closeRootIfUnused(root: string): void {
    const state = this.roots.get(root)
    if (!state || state.uiSubscribers.size || state.indexConsumers.size) return
    this.clearRenames(state)
    this.roots.delete(root)
    this.endRecovery(state.watch)
    this.host.remove(state.watch)
    this.notifyAlignmentWaiters()
  }
}

export const workspaceWatchService = new WorkspaceWatchService()
