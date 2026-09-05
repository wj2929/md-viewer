import chokidar from 'chokidar'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'

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

export type WorkspaceWatchChannel =
  | 'file:added'
  | 'file:changed'
  | 'file:removed'
  | 'file:renamed'
  | 'folder:added'
  | 'folder:removed'

export type WorkspaceRootDelta =
  | { kind: 'added' | 'changed' | 'removed'; path: string }
  | { kind: 'renamed'; oldPath: string; newPath: string; inferred: true }
  | { kind: 'folder-added' | 'folder-removed'; path: string }

export interface WorkspaceWatchSubscription extends WorkspaceWatchContext {
  key: string
  deliver: (channel: WorkspaceWatchChannel, event: WorkspaceWatchEvent) => void
  onFolderRemoved?: (rootPath: string, removedPath: string) => void
}

interface PendingUnlink {
  timestamp: number
  timer: ReturnType<typeof setTimeout>
}

interface RootWatcherState {
  watcher: ReturnType<typeof chokidar.watch>
  uiSubscribers: Map<string, WorkspaceWatchSubscription>
  indexConsumers: Map<string, (delta: WorkspaceRootDelta) => void>
  pendingUnlinks: Map<string, PendingUnlink>
}

interface OpenedFileWatcherState {
  watcher: ReturnType<typeof chokidar.watch>
  subscription: WorkspaceWatchSubscription
  files: Set<string>
  pendingRemovals: Map<string, ReturnType<typeof setTimeout>>
}

const RENAME_THRESHOLD_MS = 500
const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])
const IGNORED_PATTERNS = [
  '**/.*',
  '**/node_modules/**',
  '**/vendor/**',
  '**/target/**',
  '**/build/**',
  '**/dist/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.venv/**',
  '**/coverage/**',
  '**/*.zip',
  '**/*.tar.gz',
  '**/batch*/**',
]
const IGNORED_DIR_NAMES = new Set([
  'node_modules', 'vendor', 'target', 'build', 'dist',
  '__pycache__', 'venv', '.venv', 'env', 'coverage',
])

export function hasIgnoredPathSegment(filePath: string, rootPath?: string): boolean {
  const candidatePath = rootPath ? path.relative(rootPath, filePath) : filePath
  if (rootPath && (
    candidatePath === '' ||
    candidatePath.startsWith(`..${path.sep}`) ||
    candidatePath === '..' ||
    path.isAbsolute(candidatePath)
  )) return false

  for (const segment of candidatePath.split(/[/\\]/)) {
    if (!segment) continue
    if (IGNORED_DIR_NAMES.has(segment)) return true
    if (segment.length > 1 && segment.startsWith('.') && segment !== '..') return true
  }
  return false
}

export function isWatchPathSafe(targetPath: string): { safe: boolean; reason?: string } {
  const resolved = path.resolve(targetPath)
  const pathParts = resolved.split(path.sep).filter(Boolean)
  if (pathParts.length < 3) {
    return { safe: false, reason: '目录层级过高，请选择更具体的项目目录' }
  }
  if (resolved === os.homedir()) {
    return { safe: false, reason: '不能监听用户主目录，请选择子目录' }
  }
  return { safe: true }
}

export class WorkspaceWatchService {
  private readonly roots = new Map<string, RootWatcherState>()
  private readonly rootByUiSubscriber = new Map<string, string>()
  private readonly openedFiles = new Map<string, OpenedFileWatcherState>()

  attachRoot(rootPath: string, subscription: WorkspaceWatchSubscription): void {
    const previousRoot = this.rootByUiSubscriber.get(subscription.key)
    if (previousRoot && previousRoot !== rootPath) this.detachUi(subscription.key)

    const state = this.getOrCreateRoot(rootPath)
    state.uiSubscribers.set(subscription.key, subscription)
    this.rootByUiSubscriber.set(subscription.key, rootPath)
  }

  detachUi(key: string): void {
    const rootPath = this.rootByUiSubscriber.get(key)
    this.rootByUiSubscriber.delete(key)
    if (rootPath) {
      const state = this.roots.get(rootPath)
      state?.uiSubscribers.delete(key)
      this.closeRootIfUnused(rootPath)
    }
    this.closeOpenedFileWatcher(key)
  }

  attachIndexConsumer(
    rootPath: string,
    consumerId: string,
    consumer: (delta: WorkspaceRootDelta) => void,
  ): void {
    this.getOrCreateRoot(rootPath).indexConsumers.set(consumerId, consumer)
  }

  detachIndexConsumer(rootPath: string, consumerId: string): void {
    this.roots.get(rootPath)?.indexConsumers.delete(consumerId)
    this.closeRootIfUnused(rootPath)
  }

  watchOpenedFile(filePath: string, subscription: WorkspaceWatchSubscription): void {
    const existing = this.openedFiles.get(subscription.key)
    if (existing) {
      existing.subscription = subscription
      if (!existing.files.has(filePath)) {
        existing.files.add(filePath)
        existing.watcher.add(filePath)
      }
      return
    }

    const watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    const state: OpenedFileWatcherState = {
      watcher,
      subscription,
      files: new Set([filePath]),
      pendingRemovals: new Map(),
    }
    this.openedFiles.set(subscription.key, state)

    watcher.on('error', error => console.error('[WATCHER] Opened file watcher error:', error))
    watcher.on('change', changedPath => this.handleOpenedFilePresent(state, changedPath))
    watcher.on('add', addedPath => this.handleOpenedFilePresent(state, addedPath))
    watcher.on('unlink', removedPath => this.handleOpenedFileUnlink(state, removedPath))
  }

  async unwatchOpenedFile(key: string, filePath: string, lifecycleEpoch: number): Promise<void> {
    const state = this.openedFiles.get(key)
    if (!state || state.subscription.lifecycleEpoch !== lifecycleEpoch) return
    if (!state.files.delete(filePath)) return
    const pendingRemoval = state.pendingRemovals.get(filePath)
    if (pendingRemoval) clearTimeout(pendingRemoval)
    state.pendingRemovals.delete(filePath)
    await state.watcher.unwatch(filePath)
    if (state.files.size === 0) this.closeOpenedFileWatcher(key)
  }

  hasRootSubscription(key: string, filePath: string): boolean {
    const rootPath = this.rootByUiSubscriber.get(key)
    return Boolean(rootPath && isPathInside(rootPath, filePath) && !hasIgnoredPathSegment(filePath, rootPath))
  }

  getOpenedFileCount(key: string): number {
    return this.openedFiles.get(key)?.files.size ?? 0
  }

  cleanupWebContents(webContentsId: number, workspaceId?: string): void {
    const prefix = `${webContentsId}:`
    const keys = new Set([
      ...this.rootByUiSubscriber.keys(),
      ...this.openedFiles.keys(),
    ])
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      if (workspaceId && key !== `${webContentsId}:${workspaceId}`) continue
      this.detachUi(key)
    }
  }

  private getOrCreateRoot(rootPath: string): RootWatcherState {
    const existing = this.roots.get(rootPath)
    if (existing) return existing

    console.log(`[WATCHER] Watching directory: ${rootPath}`)
    const watcher = chokidar.watch(rootPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: [
        ...IGNORED_PATTERNS,
        (filePath: string, stats?: fs.Stats) => {
          if (hasIgnoredPathSegment(filePath, rootPath)) return true
          if (!stats || stats.isDirectory()) return false
          return !PREVIEWABLE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
        },
      ],
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    const state: RootWatcherState = {
      watcher,
      uiSubscribers: new Map(),
      indexConsumers: new Map(),
      pendingUnlinks: new Map(),
    }
    this.roots.set(rootPath, state)

    watcher.on('error', error => console.error('[WATCHER] Error:', error))
    watcher.on('ready', () => {
      const watched = watcher.getWatched() || {}
      const count = Object.values(watched).reduce((sum, entries) => sum + entries.length, 0)
      console.log(`[WATCHER] Ready! Watching ${Object.keys(watched).length} directories, ${count} files`)
    })
    watcher.on('change', filePath => this.publish(rootPath, state, 'file:changed', { kind: 'changed', path: filePath }))
    watcher.on('add', filePath => this.handleRootAdd(rootPath, state, filePath))
    watcher.on('unlink', filePath => this.handleRootUnlink(rootPath, state, filePath))
    watcher.on('addDir', addedPath => {
      if (addedPath !== rootPath) this.publish(rootPath, state, 'folder:added', { kind: 'folder-added', path: addedPath })
    })
    watcher.on('unlinkDir', removedPath => {
      for (const subscriber of state.uiSubscribers.values()) subscriber.onFolderRemoved?.(rootPath, removedPath)
      this.publish(rootPath, state, 'folder:removed', { kind: 'folder-removed', path: removedPath })
    })
    return state
  }

  private handleRootAdd(rootPath: string, state: RootWatcherState, filePath: string): void {
    const samePath = state.pendingUnlinks.get(filePath)
    if (samePath) {
      clearTimeout(samePath.timer)
      state.pendingUnlinks.delete(filePath)
      this.publish(rootPath, state, 'file:changed', { kind: 'changed', path: filePath })
      return
    }

    const now = Date.now()
    const extension = path.extname(filePath).toLowerCase()
    const candidates = [...state.pendingUnlinks.entries()].filter(([oldPath, pending]) =>
      now - pending.timestamp < RENAME_THRESHOLD_MS && path.extname(oldPath).toLowerCase() === extension
    )
    const sameDirectory = candidates.filter(([oldPath]) => path.dirname(oldPath) === path.dirname(filePath))
    const candidate = sameDirectory.length === 1
      ? sameDirectory[0]
      : candidates.length === 1 ? candidates[0] : null
    if (!candidate) {
      this.publish(rootPath, state, 'file:added', { kind: 'added', path: filePath })
      return
    }

    const [oldPath, pending] = candidate
    clearTimeout(pending.timer)
    state.pendingUnlinks.delete(oldPath)
    this.publishIndex(state, { kind: 'removed', path: oldPath })
    this.publishIndex(state, { kind: 'added', path: filePath })
    this.publish(rootPath, state, 'file:renamed', {
      kind: 'renamed', oldPath, newPath: filePath, inferred: true,
    }, false)
  }

  private handleRootUnlink(rootPath: string, state: RootWatcherState, filePath: string): void {
    const existing = state.pendingUnlinks.get(filePath)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      const pending = state.pendingUnlinks.get(filePath)
      if (!pending || pending.timer !== timer) return
      this.publish(rootPath, state, 'file:removed', { kind: 'removed', path: filePath })
      state.pendingUnlinks.delete(filePath)
    }, RENAME_THRESHOLD_MS + 50)
    state.pendingUnlinks.set(filePath, { timestamp: Date.now(), timer })
  }

  private handleOpenedFilePresent(state: OpenedFileWatcherState, filePath: string): void {
    const pending = state.pendingRemovals.get(filePath)
    if (pending) clearTimeout(pending)
    state.pendingRemovals.delete(filePath)
    if (state.files.has(filePath)) this.deliver(state.subscription, 'file:changed', { path: filePath })
  }

  private handleOpenedFileUnlink(state: OpenedFileWatcherState, filePath: string): void {
    if (!state.files.has(filePath)) return
    const existing = state.pendingRemovals.get(filePath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      state.pendingRemovals.delete(filePath)
      if (state.files.has(filePath)) this.deliver(state.subscription, 'file:removed', { path: filePath })
    }, RENAME_THRESHOLD_MS + 50)
    state.pendingRemovals.set(filePath, timer)
  }

  private publish(
    _rootPath: string,
    state: RootWatcherState,
    channel: WorkspaceWatchChannel,
    delta: WorkspaceRootDelta,
    notifyIndex = true,
  ): void {
    const event = delta.kind === 'renamed'
      ? { oldPath: delta.oldPath, newPath: delta.newPath }
      : { path: delta.path }
    for (const subscriber of state.uiSubscribers.values()) this.deliver(subscriber, channel, event)
    if (notifyIndex) this.publishIndex(state, delta)
  }

  private publishIndex(state: RootWatcherState, delta: WorkspaceRootDelta): void {
    for (const consumer of state.indexConsumers.values()) consumer(delta)
  }

  private deliver(
    subscription: WorkspaceWatchSubscription,
    channel: WorkspaceWatchChannel,
    patch: Omit<WorkspaceWatchEvent, keyof WorkspaceWatchContext>,
  ): void {
    subscription.deliver(channel, {
      workspaceId: subscription.workspaceId,
      lifecycleEpoch: subscription.lifecycleEpoch,
      ...patch,
    })
  }

  private closeOpenedFileWatcher(key: string): void {
    const state = this.openedFiles.get(key)
    if (!state) return
    console.log(`[WATCHER] Cleaning up opened-file watcher for ${key}`)
    for (const timer of state.pendingRemovals.values()) clearTimeout(timer)
    state.pendingRemovals.clear()
    void state.watcher.close()
    this.openedFiles.delete(key)
  }

  private closeRootIfUnused(rootPath: string): void {
    const state = this.roots.get(rootPath)
    if (!state || state.uiSubscribers.size > 0 || state.indexConsumers.size > 0) return
    console.log(`[WATCHER] Closing watcher for ${rootPath}`)
    for (const pending of state.pendingUnlinks.values()) clearTimeout(pending.timer)
    state.pendingUnlinks.clear()
    void state.watcher.close()
    this.roots.delete(rootPath)
  }
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const relative = path.relative(rootPath, filePath)
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export const workspaceWatchService = new WorkspaceWatchService()
