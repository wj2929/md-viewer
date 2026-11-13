import { app, utilityProcess, type UtilityProcess } from 'electron'
import * as path from 'node:path'
import type { DiagnosticMetadata } from '../../shared/diagnostics'
import { WatchReconcileSupersededError, type WorkspaceWatchHealth } from '../../shared/workspaceWatch'
import { isWatchResponse, WATCH_LIMITS, type PhysicalWatchEvent, type PhysicalWatchKind, type WatchCommand, type WatchStartupStage, type WatchErrorCode } from './watchProtocol'

export interface PhysicalWatch {
  id: number
  path: string
  kind: PhysicalWatchKind
  generation: number
  processGeneration: number
  gapVersion: number
  reconciledGapVersion: number
  sequence: number
  observedAt: number
  crawlComplete: boolean
  failed: boolean
  reason?: WorkspaceWatchHealth['reason']
  excluded: string[]
  startedAt: number
  lastGapId: number
  startup?: {
    requestId: number; sentAt: number; stageAt: number; sampledAt: number
    stage: WatchStartupStage | 'create-sent' | 'accepted' | 'ready'
    acceptedMs?: number; childElapsedMs: number; pathChecks: number; directoryChecks: number
  }
  errorCode?: WatchErrorCode
  startupRecoveryPending?: boolean
  accessRecovery?: 'pending' | 'attempted'
  accessRecoveryCurrent?: () => boolean
  callbacks: { event: (event: PhysicalWatchEvent) => void; change: () => void }
}

type Barrier = { watch: PhysicalWatch; generation: number; resolve: () => void; reject: (error?: Error) => void; timer: ReturnType<typeof setTimeout> }
type StopReason = 'idle' | 'planned-recycle' | 'abnormal' | 'resource' | 'shutdown' | 'retry'
export type WatchDiagnostic = (phase: 'start' | 'summary' | 'terminal', operation: string, root: string | undefined, metadata: DiagnosticMetadata) => void
export type WatchRetryDiagnostic = (metadata: DiagnosticMetadata) => void

// Owns only the utility process and protocol. No filesystem watcher is created in the GUI process.
export class WatchProcessHost {
  private readonly watches = new Map<number, PhysicalWatch>()
  private readonly closing = new Map<number, { generation: number; requestId: number; startedAt?: number }>()
  private readonly barriers = new Map<number, Barrier>()
  private readonly pending = new Set<number>()
  private child: UtilityProcess | null = null
  private booting = false
  private stopping: Promise<boolean> | null = null
  private shuttingDown = false
  private processGeneration = 0
  private nextWatch = 0
  private nextRequest = 0
  private version = 0
  private spawned = false
  private lastPong = 0
  private lastTick = 0
  private lastStart = -Infinity
  private lastRetry = -Infinity
  private recoveries: number[] = []
  private suspended = false
  private graceUntil = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private diagnostics?: WatchDiagnostic

  get automaticRecoveryCount(): number { return this.recoveries.length }

  setDiagnostics(diagnostics: WatchDiagnostic): void { this.diagnostics = diagnostics }

  add(target: string, kind: PhysicalWatchKind, callbacks: PhysicalWatch['callbacks']): PhysicalWatch {
    const watch: PhysicalWatch = {
      id: ++this.nextWatch, path: target, kind, callbacks, generation: 0, processGeneration: 0,
      gapVersion: 1, reconciledGapVersion: 0, sequence: 0, observedAt: 0, lastGapId: 0,
      crawlComplete: false, failed: false, excluded: [], startedAt: Date.now(),
    }
    if (this.watches.size >= WATCH_LIMITS.watches) {
      watch.failed = true
      watch.reason = 'overflow'
      queueMicrotask(() => this.changed(watch))
      return watch
    }
    this.watches.set(watch.id, watch)
    if (this.child && this.spawned && !this.stopping) this.create(watch)
    else this.ensureProcess()
    return watch
  }

  remove(watch: PhysicalWatch): void {
    if (!this.watches.delete(watch.id)) return
    this.cancelBarriers(watch)
    this.diagnostic('terminal', watch)
    if (this.watches.size === 0) { void this.stop('idle'); return }
    if (this.child && this.spawned && !this.stopping && watch.processGeneration === this.processGeneration) {
      const requestId = ++this.nextRequest
      this.closing.set(watch.id, { generation: watch.generation, requestId })
      this.diagnostic('start', watch, 'close')
      this.send({ ...this.identity(watch), type: 'close', requestId })
    }
  }

  health(watch: PhysicalWatch): WorkspaceWatchHealth {
    return {
      version: this.version,
      state: watch.failed ? 'degraded' : !watch.crawlComplete ? (watch.generation > 1 ? 'recovering' : 'starting')
        : watch.reconciledGapVersion < watch.gapVersion ? 'recovering' : 'healthy',
      partialCoverage: watch.excluded.length > 0, excludedDirectoryCount: watch.excluded.length,
      gapVersion: watch.gapVersion, reconciledGapVersion: watch.reconciledGapVersion, reason: watch.reason,
    }
  }

  reconciled(watch: PhysicalWatch, gapVersion: number, generation: number): void {
    if (!this.watches.has(watch.id) || watch.failed || !watch.crawlComplete ||
      watch.generation !== generation || watch.gapVersion !== gapVersion) return
    watch.reconciledGapVersion = gapVersion
    watch.accessRecovery = undefined
    watch.accessRecoveryCurrent = undefined
    this.diagnostic('terminal', watch)
    this.changed(watch)
  }

  fail(watch: PhysicalWatch, reason: WorkspaceWatchHealth['reason']): void {
    if (reason !== 'timeout' && reason !== 'permission') {
      watch.accessRecovery = 'attempted'
      watch.accessRecoveryCurrent = undefined
    }
    if (!this.watches.has(watch.id) || (watch.failed && (!watch.startupRecoveryPending || reason === 'timeout'))) return
    if (reason !== 'timeout') watch.startupRecoveryPending = false
    watch.failed = true
    watch.reason = reason
    watch.gapVersion++
    this.cancelBarriers(watch)
    this.diagnostic('terminal', watch)
    this.changed(watch)
  }

  markGap(watch: PhysicalWatch): void {
    if (!this.watches.has(watch.id)) return
    watch.gapVersion++
    if (!watch.failed) this.diagnostic('start', watch, 'reconcile')
    this.changed(watch)
  }

  barrier(watch: PhysicalWatch): Promise<void> {
    if (this.watches.get(watch.id) !== watch || watch.failed || !watch.crawlComplete || this.stopping || !this.child || this.barriers.size >= WATCH_LIMITS.requests) {
      return Promise.reject(new Error('监听屏障不可用'))
    }
    const requestId = ++this.nextRequest
    return new Promise((resolve, reject) => {
      const fail = (error: Error = new Error('监听屏障失效')): void => { this.barriers.delete(requestId); reject(error) }
      const timer = setTimeout(fail, WATCH_LIMITS.barrierMs)
      this.barriers.set(requestId, { watch, generation: watch.generation, resolve, reject: fail, timer })
      this.send({ ...this.identity(watch), type: 'barrier', requestId })
    })
  }

  recoverAfterAccess(watch: PhysicalWatch, isCurrent: () => boolean): void {
    if (this.shuttingDown || !isCurrent() || this.watches.get(watch.id) !== watch ||
      !watch.failed || watch.accessRecovery === 'attempted' ||
      (watch.reason !== 'timeout' && watch.reason !== 'permission')) return
    watch.accessRecovery = 'pending'
    watch.accessRecoveryCurrent = isCurrent
    this.recoverAccessibleWatches()
  }

  private recoverAccessibleWatches(): void {
    if (this.shuttingDown || this.stopping || this.suspended) return
    const watches = [...this.watches.values()].filter(watch =>
      watch.accessRecovery === 'pending' && watch.failed && !watch.startupRecoveryPending && watch.accessRecoveryCurrent?.())
    if (!watches.length) return
    for (const watch of watches) {
      watch.accessRecovery = 'attempted'
      watch.failed = false
      this.diagnostic('summary', watch, 'create', { watchRetryStage: 'restart-requested' })
    }
    // A live child may still own the failed native watch. Never create a duplicate ID.
    if (this.child && this.spawned && watches.some(watch => watch.processGeneration === this.processGeneration)) {
      void this.stop('retry')
    } else {
      for (const watch of watches) if (this.child && this.spawned) this.create(watch)
      this.ensureProcess()
    }
  }

  retry(watches: PhysicalWatch[], observe?: WatchRetryDiagnostic): void {
    const reason = watches.length === 0 ? 'no-subscriptions' : this.shuttingDown ? 'shutting-down'
      : this.stopping ? 'stopping' : Date.now() - this.lastRetry < WATCH_LIMITS.minimumRestartMs ? 'cooldown' : undefined
    const metadata = {
      watchSelectedCount: watches.length, watchSubscriptionCount: this.watches.size,
      processGeneration: this.processGeneration, watchProcessPresent: Boolean(this.child),
      watchProcessBooting: this.booting, watchRestartScheduled: Boolean(this.restartTimer),
    }
    if (reason) {
      observe?.({ ...metadata, watchRetryStage: 'host-skipped', watchRetryReason: reason })
      return
    }
    this.lastRetry = Date.now()
    let capacitySkipped = 0
    for (const watch of watches) {
      if (!this.watches.has(watch.id)) {
        if (this.watches.size >= WATCH_LIMITS.watches) { capacitySkipped++; continue }
        this.watches.set(watch.id, watch)
      }
      watch.failed = false
      watch.reason = undefined
      watch.accessRecovery = undefined
      watch.accessRecoveryCurrent = undefined
    }
    observe?.({ ...metadata, watchRetryStage: 'restart-requested', watchSubscriptionCount: this.watches.size,
      watchCapacitySkippedCount: capacitySkipped,
      watchRetryEligibleCount: [...this.watches.values()].filter(watch => !watch.failed).length })
    void this.stop('retry')
  }

  suspend(): void { this.suspended = true }
  resume(): void {
    this.suspended = false
    this.graceUntil = Date.now() + WATCH_LIMITS.unresponsiveMs
    this.lastTick = this.lastPong = Date.now()
    for (const watch of this.watches.values()) watch.startedAt = Date.now()
    for (const close of this.closing.values()) if (close.startedAt !== undefined) close.startedAt = Date.now()
    this.ping()
    this.recoverAccessibleWatches()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const watch of this.watches.values()) { this.cancelBarriers(watch); this.diagnostic('terminal', watch) }
    this.watches.clear()
    await this.stop('shutdown')
  }

  private ensureProcess(): void {
    if (this.shuttingDown || this.child || this.booting || this.stopping || this.restartTimer ||
      ![...this.watches.values()].some(watch => !watch.failed)) return
    const delay = WATCH_LIMITS.minimumRestartMs - (Date.now() - this.lastStart)
    if (delay > 0) {
      this.restartTimer = setTimeout(() => { this.restartTimer = null; this.ensureProcess() }, delay)
      return
    }
    this.booting = true
    void app.whenReady().then(() => {
      this.booting = false
      if (this.shuttingDown || this.child || this.stopping || !this.watches.size) return
      this.lastStart = Date.now()
      this.processGeneration++
      this.lastPong = this.lastTick = Date.now()
      const env: NodeJS.ProcessEnv = {}
      for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'USERPROFILE']) {
        if (process.env[key]) env[key] = process.env[key]
      }
      try {
        // GUI code is emitted into out/main/chunks; the utility entry is a fixed sibling entry.
        const child = utilityProcess.fork(path.join(__dirname, '../watcherProcess.js'), [], {
          serviceName: 'MD Viewer file watching', stdio: 'ignore', env,
        })
        this.child = child
        child.on('spawn', () => {
          if (this.child !== child || this.stopping) return
          this.spawned = true
          for (const watch of this.watches.values()) if (!watch.failed) this.create(watch)
        })
        child.on('message', message => { if (this.child === child && !this.stopping) this.receive(message) })
        child.on('exit', () => {
          if (this.child !== child) return
          this.child = null
          this.spawned = false
          if (!this.stopping && !this.shuttingDown) this.unexpectedExit()
        })
        if (!this.heartbeat) {
          this.heartbeat = setInterval(() => this.tick(), WATCH_LIMITS.heartbeatMs)
          this.heartbeat.unref()
        }
      } catch {
        this.child = null
        this.unexpectedExit()
      }
    }).catch(() => { this.booting = false; this.unexpectedExit() })
  }

  private create(watch: PhysicalWatch): void {
    if (watch.accessRecoveryCurrent && !watch.accessRecoveryCurrent()) {
      watch.accessRecoveryCurrent = undefined
      this.fail(watch, watch.reason)
      if ([...this.watches.values()].every(current => current.failed)) void this.stop('resource')
      return
    }
    watch.accessRecoveryCurrent = undefined
    watch.reason = undefined
    this.diagnostic('terminal', watch)
    watch.generation++
    watch.processGeneration = this.processGeneration
    watch.sequence = watch.observedAt = watch.lastGapId = 0
    watch.crawlComplete = false
    watch.excluded = []
    watch.startedAt = Date.now()
    watch.errorCode = undefined
    watch.startupRecoveryPending = false
    watch.startup = {
      requestId: ++this.nextRequest, sentAt: watch.startedAt, stageAt: watch.startedAt, sampledAt: watch.startedAt,
      stage: 'create-sent', childElapsedMs: 0, pathChecks: 0, directoryChecks: 0,
    }
    this.diagnostic('start', watch)
    this.send({ ...this.identity(watch), type: 'create', requestId: watch.startup.requestId, path: watch.path, kind: watch.kind })
    this.changed(watch)
  }

  private identity(watch: PhysicalWatch): { processGeneration: number; watchId: number; watchGeneration: number } {
    return { processGeneration: watch.processGeneration, watchId: watch.id, watchGeneration: watch.generation }
  }

  private send(command: WatchCommand): void {
    if (!this.child || !this.spawned || this.stopping) return
    if (command.type === 'create' || command.type === 'close') {
      if (this.pending.size >= WATCH_LIMITS.requests) {
        for (const watch of this.watches.values()) this.fail(watch, 'overflow')
        void this.stop('resource')
        return
      }
      this.pending.add(command.requestId)
    }
    try { this.child.postMessage(command) } catch { void this.stop('abnormal') }
  }

  private receive(input: unknown): void {
    if (!isWatchResponse(input)) {
      for (const watch of this.watches.values()) this.fail(watch, 'protocol')
      void this.stop('resource')
      return
    }
    const message = input
    if (message.processGeneration !== this.processGeneration) return
    if (message.type === 'pong') { this.lastPong = Date.now(); return }
    const closing = this.closing.get(message.watchId)
    if (message.type === 'error' && ['EMFILE', 'ENOSPC', 'OVERFLOW'].includes(message.code) &&
      (closing?.generation === message.watchGeneration || this.watches.get(message.watchId)?.generation === message.watchGeneration)) {
      const source = this.watches.get(message.watchId)
      if (source?.generation === message.watchGeneration) source.errorCode = message.code
      for (const affected of this.watches.values()) this.fail(affected, 'resource')
      void this.stop('resource')
      return
    }
    if (closing?.generation === message.watchGeneration) {
      if ((message.type === 'close-start' || message.type === 'closed') && message.requestId === closing.requestId) {
        this.pending.delete(message.requestId)
        if (message.type === 'close-start') closing.startedAt = Date.now()
        else {
          this.closing.delete(message.watchId)
          this.diagnostics?.('terminal', `watch_close_${message.watchId}_${message.watchGeneration}`, undefined, {})
        }
      }
      return
    }
    const watch = this.watches.get(message.watchId)
    if (!watch || watch.generation !== message.watchGeneration || watch.processGeneration !== message.processGeneration) return
    if (message.type === 'accepted') {
      this.pending.delete(message.requestId)
      if (!watch.failed && !watch.crawlComplete && watch.startup?.requestId === message.requestId && watch.startup.acceptedMs === undefined) {
        watch.startup.acceptedMs = Math.max(0, Date.now() - watch.startup.sentAt)
        watch.startup.stage = 'accepted'
        watch.startup.stageAt = Date.now()
        this.diagnostic('summary', watch)
      }
      return
    }
    // Only a responsive, already-created slow startup can resume in this same generation.
    // Native errors and process invalidation revoke this one bounded continuation.
    if (watch.startupRecoveryPending && message.type === 'crawl-complete' &&
      Date.now() - watch.startedAt < WATCH_LIMITS.slowStartupMs) {
      watch.startupRecoveryPending = false
      watch.failed = false
      watch.reason = undefined
      this.diagnostic('start', watch, 'reconcile')
    }
    if (watch.failed && !(watch.startupRecoveryPending && message.type === 'startup-progress')) {
      if (message.type === 'error' && watch.startupRecoveryPending) {
        watch.errorCode = message.code
        this.fail(watch, message.code === 'EACCES' || message.code === 'EPERM' ? 'permission' : 'process')
      }
      if (message.type === 'events') this.send({ ...this.identity(watch), type: 'ack', sequence: message.events.at(-1)!.sequence })
      return
    }
    switch (message.type) {
      case 'startup-progress': {
        const startup = watch.startup
        if (!startup || watch.crawlComplete || message.elapsedMs < startup.childElapsedMs ||
          message.pathChecks < startup.pathChecks || message.directoryChecks < startup.directoryChecks) break
        if (startup.stage !== message.stage) startup.stageAt = Date.now()
        startup.stage = message.stage
        startup.childElapsedMs = message.elapsedMs
        startup.pathChecks = message.pathChecks
        startup.directoryChecks = message.directoryChecks
        startup.sampledAt = Date.now()
        this.diagnostic('summary', watch)
        break
      }
      case 'error':
        watch.errorCode = message.code
        if (message.code === 'EMFILE' || message.code === 'ENOSPC' || message.code === 'OVERFLOW') {
          for (const affected of this.watches.values()) this.fail(affected, 'resource')
          void this.stop('resource')
        } else this.fail(watch, message.code === 'EACCES' || message.code === 'EPERM' ? 'permission' : 'process')
        break
      case 'crawl-complete':
        if (watch.startup) { watch.startup.stage = 'ready'; watch.startup.stageAt = Date.now() }
        watch.crawlComplete = true
        watch.excluded = message.excluded
        this.diagnostic('summary', watch, 'create', { watchDirectoryCount: message.directories, watchEntryCount: message.entries })
        this.changed(watch)
        break
      case 'gap':
        if (message.gapId > watch.lastGapId) { watch.lastGapId = message.gapId; this.markGap(watch) }
        break
      case 'events':
        for (const event of message.events) {
          if (event.sequence <= watch.sequence || event.observedAt < watch.observedAt) { this.fail(watch, 'protocol'); break }
          if (event.sequence !== watch.sequence + 1) this.markGap(watch)
          watch.sequence = event.sequence
          watch.observedAt = event.observedAt
          if (watch.kind === 'file' && event.path !== '') { this.fail(watch, 'protocol'); break }
          watch.callbacks.event(event)
        }
        this.send({ ...this.identity(watch), type: 'ack', sequence: message.events.at(-1)!.sequence })
        break
      case 'barrier': {
        const barrier = this.barriers.get(message.requestId)
        if (!barrier || barrier.watch !== watch || barrier.generation !== watch.generation) break
        clearTimeout(barrier.timer)
        this.barriers.delete(message.requestId)
        if (message.sequence !== watch.sequence) {
          // A final dropped event has no later delta to expose its sequence hole.
          // Move the receive cursor at the ordered barrier, then require a NEW scan.
          if (message.sequence > watch.sequence) {
            watch.sequence = message.sequence
            this.markGap(watch)
          } else this.fail(watch, 'protocol')
          barrier.reject(new WatchReconcileSupersededError())
        } else barrier.resolve()
        break
      }
    }
  }

  private tick(): void {
    const now = Date.now()
    const mainPaused = now - this.lastTick > WATCH_LIMITS.unresponsiveMs
    this.lastTick = now
    if (!this.child || this.stopping || this.suspended) return
    if (mainPaused) { this.resume(); return }
    this.ping()
    for (const watch of this.watches.values()) {
      if ((!watch.failed || watch.startupRecoveryPending) && !watch.crawlComplete && watch.startup && now - watch.startup.sampledAt >= 5000) {
        watch.startup.sampledAt = now
        this.diagnostic('summary', watch)
      }
    }
    if (now < this.graceUntil) return
    if ([...this.closing.values()].some(close => close.startedAt !== undefined && now - close.startedAt >= WATCH_LIMITS.unresponsiveMs)) {
      void this.stop('planned-recycle')
      return
    }
    if (now - this.lastPong >= WATCH_LIMITS.unresponsiveMs) {
      void this.stop([...this.closing.values()].some(close => close.startedAt !== undefined) ? 'planned-recycle' : 'abnormal')
      return
    }
    for (const watch of this.watches.values()) {
      if (watch.startupRecoveryPending && now - watch.startedAt >= WATCH_LIMITS.slowStartupMs) {
        void this.stop('resource')
      } else if (!watch.failed && !watch.crawlComplete && now - watch.startedAt >= WATCH_LIMITS.startupMs) {
        watch.startupRecoveryPending = watch.startup?.acceptedMs !== undefined &&
          (watch.startup.stage === 'watch-created' || watch.startup.stage === 'crawl-progress')
        this.fail(watch, 'timeout')
        if (!watch.startupRecoveryPending) void this.stop('resource')
      }
    }
  }

  private ping(): void { this.send({ type: 'ping', processGeneration: this.processGeneration, requestId: ++this.nextRequest }) }

  private unexpectedExit(): void {
    this.invalidate()
    if (this.allowAutomaticRecovery()) this.ensureProcess()
    else for (const watch of this.watches.values()) this.fail(watch, 'process')
  }

  private allowAutomaticRecovery(): boolean {
    const now = Date.now()
    this.recoveries = this.recoveries.filter(time => now - time < WATCH_LIMITS.retryWindowMs)
    if (this.recoveries.length >= 1) return false
    this.recoveries.push(now)
    return true
  }

  private invalidate(): void {
    this.pending.clear()
    for (const [id, close] of this.closing) {
      this.diagnostics?.('terminal', `watch_close_${id}_${close.generation}`, undefined, {})
    }
    this.closing.clear()
    for (const watch of this.watches.values()) {
      const revokedContinuation = watch.failed && watch.startupRecoveryPending
      watch.startupRecoveryPending = false
      this.cancelBarriers(watch)
      watch.crawlComplete = false
      watch.gapVersion++
      if (!watch.failed) this.diagnostic('start', watch, 'reconcile')
      else if (revokedContinuation) this.diagnostic('terminal', watch)
      this.changed(watch)
    }
  }

  private stop(reason: StopReason): Promise<boolean> {
    if (this.stopping) return this.stopping
    const child = this.child
    this.invalidate()
    let restart = reason === 'planned-recycle' || reason === 'retry'
    if (reason === 'abnormal') restart = this.allowAutomaticRecovery()
    if (reason === 'abnormal' && !restart) for (const watch of this.watches.values()) this.fail(watch, 'process')
    // Resource failures are sticky; only still-proven subscriptions may be replayed.
    if (reason === 'resource') restart = [...this.watches.values()].some(watch => !watch.failed)
    if (!child) { if (restart) this.ensureProcess(); return Promise.resolve(true) }
    let pid = child.pid
    const operationId = `watch_process_${this.processGeneration}`
    this.diagnostics?.('start', operationId, undefined, { recycleReason: reason, watchRetryCount: this.recoveries.length })
    this.stopping = new Promise<boolean>(resolve => {
      let settled = false
      const finish = (exited: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(escalate)
        clearTimeout(deadline)
        if (exited && this.child === child) { this.child = null; this.spawned = false }
        if (!exited) for (const watch of this.watches.values()) this.fail(watch, 'process')
        resolve(exited)
      }
      const escalate = setTimeout(() => {
        if (settled || this.child !== child || !pid || child.pid !== pid) return
        try { process.kill(pid, 'SIGKILL') } catch { /* Still require exit confirmation. */ }
      }, 1500)
      const deadline = setTimeout(() => finish(false), 3000)
      child.once('exit', () => finish(true))
      const terminate = (): void => {
        if (settled || this.child !== child) return
        pid = child.pid
        try {
          // Electron kill() synchronously waits ~2s for a stopped POSIX child.
          // Send the signal directly, retaining the UtilityProcess exit/identity checks.
          if (process.platform !== 'win32' && pid) process.kill(pid, 'SIGTERM')
          else child.kill()
        } catch { /* The bounded exit deadline remains authoritative. */ }
      }
      if (!pid) child.once('spawn', terminate)
      terminate()
    }).then(exited => {
      this.diagnostics?.('terminal', operationId, undefined, {
        recycleReason: reason, degraded: !exited, processExitConfirmed: exited,
        watchSubscriptionCount: this.watches.size,
        failedWatchCount: [...this.watches.values()].filter(watch => watch.failed).length,
      })
      this.stopping = null
      if (exited && this.watches.size === 0 && this.heartbeat) {
        clearInterval(this.heartbeat)
        this.heartbeat = null
      }
      if (exited) this.recoverAccessibleWatches()
      if (exited && (restart || reason === 'idle') && !this.shuttingDown) this.ensureProcess()
      return exited
    })
    return this.stopping
  }

  private cancelBarriers(watch: PhysicalWatch): void {
    for (const [id, barrier] of this.barriers) {
      if (barrier.watch !== watch) continue
      clearTimeout(barrier.timer)
      this.barriers.delete(id)
      barrier.reject()
    }
  }

  private changed(watch: PhysicalWatch): void { this.version++; watch.callbacks.change() }

  private diagnostic(phase: 'start' | 'summary' | 'terminal', watch: PhysicalWatch, operation = 'create', metadata: DiagnosticMetadata = {}): void {
    this.diagnostics?.(phase, `watch_${operation === 'close' ? 'close' : 'create'}_${watch.id}_${watch.generation}`, watch.kind === 'root' ? watch.path : undefined, {
      ...metadata, durationMs: Math.max(0, Date.now() - watch.startedAt),
      watchKind: watch.kind, state: this.health(watch).state,
      startupRecoveryPending: watch.startupRecoveryPending ?? false,
      lastPongAgeMs: Math.max(0, Date.now() - this.lastPong),
      ...(watch.errorCode ? { watchErrorCode: watch.errorCode } : {}),
      ...(watch.startup ? {
        watchStage: watch.startup.stage,
        stageAgeMs: Math.max(0, Date.now() - watch.startup.stageAt),
        startupElapsedMs: Math.max(0, Date.now() - watch.startup.sentAt),
        acceptedMs: watch.startup.acceptedMs ?? null,
        childElapsedMs: watch.startup.childElapsedMs,
        watchPathChecks: watch.startup.pathChecks, watchDirectoryChecks: watch.startup.directoryChecks,
      } : {}),
      watchGeneration: watch.generation, processGeneration: watch.processGeneration,
      gapVersion: watch.gapVersion, reconciledGapVersion: watch.reconciledGapVersion,
      excludedDirectoryCount: watch.excluded.length, watchErrorCount: watch.failed ? 1 : 0,
      ...(watch.reason ? { watchReason: watch.reason } : {}),
    })
  }
}
