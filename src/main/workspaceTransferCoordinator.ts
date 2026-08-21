import { randomUUID } from 'node:crypto'

export interface WorkspaceTransferTab {
  id: string
  filePath: string
  isPinned?: boolean
}

export interface WorkspaceTransferSplitLeaf {
  id: string
  tabId: string
}

export interface WorkspaceTransferSplitState {
  root: WorkspaceTransferPanel | null
  activeLeafId: string
}

export type WorkspaceTransferPanel = WorkspaceTransferLeaf | WorkspaceTransferSplit

export interface WorkspaceTransferLeaf {
  type: 'leaf'
  id: string
  tabId: string
}

export interface WorkspaceTransferSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: WorkspaceTransferPanel
  second: WorkspaceTransferPanel
}

export interface WorkspaceTransferSnapshot {
  workspaceId: string
  name: string
  primaryRoot: string | null
  lifecycleEpoch: number
  tabs: WorkspaceTransferTab[]
  activeTabId: string | null
  splitState: WorkspaceTransferSplitState
}

export interface WorkspaceTransferRequest {
  nonce: string
  sourceWindowId: number
  targetWindowId: number
  workspaceId: string
  sourceLifecycleEpoch: number
  targetReservation?: {
    workspaceId: string
    lifecycleEpoch: number
  }
}

export type WorkspaceTransferPhase = 'awaiting-source' | 'awaiting-target'

interface PendingTransfer extends WorkspaceTransferRequest {
  expiresAt: number
  phase: WorkspaceTransferPhase
  sourceRequested: boolean
  targetReady: boolean
  snapshot?: WorkspaceTransferSnapshot
}

const TRANSFER_TIMEOUT_MS = 30_000

export class WorkspaceTransferCoordinator {
  private pending = new Map<string, PendingTransfer>()

  begin(request: Omit<WorkspaceTransferRequest, 'nonce'>): WorkspaceTransferRequest {
    const { sourceWindowId, targetWindowId, workspaceId, sourceLifecycleEpoch } = request
    if (
      sourceWindowId === targetWindowId ||
      typeof workspaceId !== 'string' ||
      !workspaceId ||
      !Number.isInteger(sourceLifecycleEpoch) ||
      sourceLifecycleEpoch < 1
    ) {
      throw new Error('无效的工作区转移请求')
    }

    this.pruneExpired()
    const sourceKey = this.sourceReservationKey(sourceWindowId, workspaceId)
    if (this.sourceReservations.has(sourceKey)) {
      throw new Error('工作区正在转移中')
    }
    if (this.targetReservations.has(targetWindowId)) {
      throw new Error('目标窗口正在处理其他工作区转移')
    }

    const nonce = randomUUID()
    const transfer: PendingTransfer = {
      nonce,
      ...request,
      phase: 'awaiting-source',
      sourceRequested: false,
      targetReady: false,
      expiresAt: Date.now() + TRANSFER_TIMEOUT_MS,
    }
    this.pending.set(nonce, transfer)
    this.sourceReservations.set(sourceKey, nonce)
    this.targetReservations.set(targetWindowId, nonce)
    return {
      nonce,
      sourceWindowId,
      targetWindowId,
      workspaceId,
      sourceLifecycleEpoch,
      targetReservation: request.targetReservation,
    }
  }

  consumeForSource(nonce: string, sourceWindowId: number): PendingTransfer {
    const transfer = this.get(nonce)
    if (transfer.sourceWindowId !== sourceWindowId) throw new Error('安全错误：转移来源不匹配')
    return transfer
  }

  consumeForTarget(nonce: string, targetWindowId: number): PendingTransfer {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId) throw new Error('安全错误：转移目标不匹配')
    if (transfer.phase !== 'awaiting-target' || !transfer.snapshot) {
      throw new Error('工作区转移尚未准备完成')
    }
    this.pending.delete(nonce)
    return transfer
  }

  getAwaitingSourceForTarget(targetWindowId: number): WorkspaceTransferRequest | null {
    for (const transfer of this.pending.values()) {
      if (transfer.targetWindowId === targetWindowId && transfer.phase === 'awaiting-source' && !transfer.sourceRequested) {
        return {
          nonce: transfer.nonce,
          sourceWindowId: transfer.sourceWindowId,
          targetWindowId: transfer.targetWindowId,
          workspaceId: transfer.workspaceId,
          sourceLifecycleEpoch: transfer.sourceLifecycleEpoch,
          targetReservation: transfer.targetReservation,
        }
      }
    }
    return null
  }

  requestSourceForTarget(nonce: string, targetWindowId: number): PendingTransfer {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || transfer.phase !== 'awaiting-source' || transfer.sourceRequested) {
      throw new Error('安全错误：工作区转移来源不可用')
    }
    transfer.sourceRequested = true
    return transfer
  }

  markSourceRequested(nonce: string, sourceWindowId: number): void {
    const transfer = this.consumeForSource(nonce, sourceWindowId)
    if (transfer.sourceRequested) throw new Error('工作区转移来源已通知')
    transfer.sourceRequested = true
  }

  submitSnapshot(nonce: string, sourceWindowId: number, snapshot: WorkspaceTransferSnapshot): PendingTransfer {
    this.validateSnapshot(snapshot)
    const transfer = this.consumeForSource(nonce, sourceWindowId)
    if (transfer.workspaceId !== snapshot.workspaceId) {
      throw new Error('安全错误：转移工作区不匹配')
    }
    if (!transfer.sourceRequested) {
      throw new Error('工作区转移来源尚未请求')
    }
    if (transfer.sourceLifecycleEpoch !== snapshot.lifecycleEpoch) {
      throw new Error('安全错误：工作区 epoch 与转移请求不匹配')
    }
    if (transfer.phase !== 'awaiting-source') {
      throw new Error('工作区转移快照已提交')
    }
    transfer.snapshot = snapshot
    transfer.phase = 'awaiting-target'
    return transfer
  }

  consumeSnapshotForTarget(nonce: string, targetWindowId: number): { transfer: PendingTransfer; snapshot: WorkspaceTransferSnapshot } {
    const transfer = this.consumeForTarget(nonce, targetWindowId)
    if (!transfer.snapshot) throw new Error('工作区转移快照尚未就绪')
    return { transfer, snapshot: transfer.snapshot }
  }

  getSnapshotForTarget(nonce: string, targetWindowId: number): WorkspaceTransferSnapshot {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId) throw new Error('安全错误：转移目标不匹配')
    if (transfer.phase !== 'awaiting-target' || !transfer.snapshot) {
      throw new Error('工作区转移快照尚未就绪')
    }
    return transfer.snapshot
  }

  markTargetReady(nonce: string, targetWindowId: number): void {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || transfer.phase !== 'awaiting-target' || !transfer.snapshot) {
      throw new Error('安全错误：工作区转移目标未就绪')
    }
    transfer.targetReady = true
  }

  completeForTarget(nonce: string, targetWindowId: number): PendingTransfer {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || !transfer.targetReady || transfer.phase !== 'awaiting-target') {
      throw new Error('工作区转移目标尚未确认')
    }
    return transfer
  }

  commitForTarget(nonce: string, targetWindowId: number): void {
    const transfer = this.completeForTarget(nonce, targetWindowId)
    this.release(transfer.nonce)
  }

  cancel(nonce: string): WorkspaceTransferRequest | undefined {
    return this.release(nonce)
  }

  cancelForParticipant(nonce: string, windowId: number): WorkspaceTransferRequest | undefined {
    const transfer = this.get(nonce)
    if (transfer.sourceWindowId !== windowId && transfer.targetWindowId !== windowId) {
      throw new Error('安全错误：无权取消其他窗口的工作区转移')
    }
    return this.release(nonce)
  }

  cancelForWindow(windowId: number): WorkspaceTransferRequest[] {
    const cancelled: WorkspaceTransferRequest[] = []
    for (const [nonce, transfer] of this.pending) {
      if (transfer.sourceWindowId === windowId || transfer.targetWindowId === windowId) {
        const released = this.release(nonce)
        if (released) cancelled.push(released)
      }
    }
    return cancelled
  }

  validateSnapshot(snapshot: WorkspaceTransferSnapshot): void {
    if (
      !snapshot ||
      typeof snapshot.workspaceId !== 'string' ||
      !snapshot.workspaceId ||
      typeof snapshot.name !== 'string' ||
      snapshot.name.length > 200 ||
      (snapshot.primaryRoot !== null && typeof snapshot.primaryRoot !== 'string') ||
      !Number.isInteger(snapshot.lifecycleEpoch) || snapshot.lifecycleEpoch < 1 ||
      !Array.isArray(snapshot.tabs) ||
      snapshot.tabs.length > 100
    ) {
      throw new Error('安全错误：工作区快照格式无效')
    }

    const tabIds = new Set<string>()
    for (const tab of snapshot.tabs) {
      if (
        !tab ||
        typeof tab.id !== 'string' ||
        !tab.id ||
        tab.id.length > 200 ||
        typeof tab.filePath !== 'string' ||
        !tab.filePath ||
        tab.filePath.length > 4096 ||
        tabIds.has(tab.id)
      ) {
        throw new Error('安全错误：工作区快照标签无效')
      }
      tabIds.add(tab.id)
    }

    if (snapshot.activeTabId !== null && !tabIds.has(snapshot.activeTabId)) {
      throw new Error('安全错误：工作区快照活动标签无效')
    }
    if (!snapshot.splitState || typeof snapshot.splitState !== 'object') {
      throw new Error('安全错误：工作区快照分屏无效')
    }
    this.validateSplitState(snapshot.splitState, tabIds)
  }

  private validateSplitState(state: WorkspaceTransferSplitState, tabIds: Set<string>): void {
    if (typeof state.activeLeafId !== 'string') {
      throw new Error('安全错误：工作区快照活动面板无效')
    }

    const nodeIds = new Set<string>()
    const leafIds = new Set<string>()
    const visit = (node: WorkspaceTransferPanel | null, depth: number): void => {
      if (!node) return
      if (depth > 4 || !node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) {
        throw new Error('安全错误：工作区快照分屏无效')
      }
      if (nodeIds.has(node.id)) throw new Error('安全错误：工作区快照分屏 ID 重复')
      nodeIds.add(node.id)

      if (node.type === 'leaf') {
        if (typeof node.tabId !== 'string' || !tabIds.has(node.tabId)) {
          throw new Error('安全错误：工作区快照分屏标签无效')
        }
        leafIds.add(node.id)
        return
      }
      if (
        node.type !== 'split' ||
        (node.direction !== 'horizontal' && node.direction !== 'vertical') ||
        typeof node.ratio !== 'number' ||
        node.ratio < 0.15 || node.ratio > 0.85 ||
        !node.first ||
        !node.second
      ) {
        throw new Error('安全错误：工作区快照分屏无效')
      }
      visit(node.first, depth + 1)
      visit(node.second, depth + 1)
    }

    visit(state.root, 1)
    if (state.root && state.activeLeafId && !leafIds.has(state.activeLeafId)) {
      throw new Error('安全错误：工作区快照活动面板无效')
    }
  }

  isWindowReserved(windowId: number): boolean {
    if (this.targetReservations.has(windowId)) return true
    for (const transfer of this.pending.values()) {
      if (transfer.sourceWindowId === windowId || transfer.targetWindowId === windowId) return true
    }
    return false
  }

  private get(nonce: string): PendingTransfer {
    const transfer = this.pending.get(nonce)
    if (!transfer || transfer.expiresAt < Date.now()) {
      this.release(nonce)
      throw new Error('工作区转移已超时或不存在')
    }
    return transfer
  }

  private pruneExpired(): void {
    for (const [nonce, transfer] of this.pending) {
      if (transfer.expiresAt < Date.now()) this.release(nonce)
    }
  }

  private readonly sourceReservations = new Map<string, string>()
  private readonly targetReservations = new Map<number, string>()

  private sourceReservationKey(windowId: number, workspaceId: string): string {
    return `${windowId}:${workspaceId}`
  }

  private release(nonce: string): WorkspaceTransferRequest | undefined {
    const transfer = this.pending.get(nonce)
    if (!transfer) return undefined
    this.pending.delete(nonce)
    this.sourceReservations.delete(this.sourceReservationKey(transfer.sourceWindowId, transfer.workspaceId))
    if (this.targetReservations.get(transfer.targetWindowId) === nonce) {
      this.targetReservations.delete(transfer.targetWindowId)
    }
    return {
      nonce: transfer.nonce,
      sourceWindowId: transfer.sourceWindowId,
      targetWindowId: transfer.targetWindowId,
      workspaceId: transfer.workspaceId,
      sourceLifecycleEpoch: transfer.sourceLifecycleEpoch,
      targetReservation: transfer.targetReservation,
    }
  }
}

export const workspaceTransferCoordinator = new WorkspaceTransferCoordinator()
