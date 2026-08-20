import { randomUUID } from 'node:crypto'
import type { WorkspaceTransferSnapshot } from './workspaceTransferCoordinator'
import { workspaceTransferCoordinator } from './workspaceTransferCoordinator'

export interface WindowTransferWorkspacePlan {
  workspaceId: string
  sourceLifecycleEpoch: number
  primaryRoot: string | null
}

export interface WindowTransferRequest {
  nonce: string
  sourceWindowId: number
  targetWindowId: number
  sourceActiveWorkspaceId: string | null
  workspaces: WindowTransferWorkspacePlan[]
}

interface PendingWindowTransfer extends WindowTransferRequest {
  phase: 'awaiting-source' | 'awaiting-target'
  expiresAt: number
  snapshots?: WorkspaceTransferSnapshot[]
  targetReady: boolean
}

const TRANSFER_TIMEOUT_MS = 30_000

export class WindowTransferCoordinator {
  private pending = new Map<string, PendingWindowTransfer>()
  private sourceReservations = new Map<number, string>()
  private targetReservations = new Map<number, string>()

  begin(request: Omit<WindowTransferRequest, 'nonce'>): WindowTransferRequest {
    if (
      request.sourceWindowId === request.targetWindowId ||
      request.workspaces.length === 0 ||
      this.sourceReservations.has(request.sourceWindowId) ||
      this.targetReservations.has(request.targetWindowId)
    ) throw new Error('窗口正在处理其他合并操作')
    const ids = new Set<string>()
    for (const workspace of request.workspaces) {
      if (!workspace.workspaceId || ids.has(workspace.workspaceId) || workspace.sourceLifecycleEpoch < 1) {
        throw new Error('无效的窗口合并计划')
      }
      ids.add(workspace.workspaceId)
    }
    const nonce = randomUUID()
    const transfer: PendingWindowTransfer = {
      nonce,
      ...request,
      phase: 'awaiting-source',
      targetReady: false,
      expiresAt: Date.now() + TRANSFER_TIMEOUT_MS,
    }
    this.pending.set(nonce, transfer)
    this.sourceReservations.set(request.sourceWindowId, nonce)
    this.targetReservations.set(request.targetWindowId, nonce)
    return requestWithNonce(transfer)
  }

  submitSnapshots(nonce: string, sourceWindowId: number, snapshots: WorkspaceTransferSnapshot[]): WindowTransferRequest {
    const transfer = this.get(nonce)
    if (transfer.sourceWindowId !== sourceWindowId || transfer.phase !== 'awaiting-source') {
      throw new Error('安全错误：窗口合并来源不匹配')
    }
    if (!Array.isArray(snapshots) || snapshots.length !== transfer.workspaces.length) {
      throw new Error('窗口合并快照不完整')
    }
    const snapshotMap = new Map<string, WorkspaceTransferSnapshot>()
    for (const snapshot of snapshots) {
      workspaceTransferCoordinator.validateSnapshot(snapshot)
      if (snapshotMap.has(snapshot.workspaceId)) throw new Error('窗口合并快照重复')
      snapshotMap.set(snapshot.workspaceId, snapshot)
    }
    for (const workspace of transfer.workspaces) {
      const snapshot = snapshotMap.get(workspace.workspaceId)
      if (
        !snapshot ||
        snapshot.lifecycleEpoch !== workspace.sourceLifecycleEpoch ||
        snapshot.primaryRoot !== workspace.primaryRoot
      ) throw new Error('窗口合并快照与计划不匹配')
    }
    transfer.snapshots = transfer.workspaces.map((workspace) => snapshotMap.get(workspace.workspaceId)!)
    transfer.phase = 'awaiting-target'
    return requestWithNonce(transfer)
  }

  getSnapshotsForTarget(nonce: string, targetWindowId: number): WorkspaceTransferSnapshot[] {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || transfer.phase !== 'awaiting-target' || !transfer.snapshots) {
      throw new Error('窗口合并快照尚未就绪')
    }
    return transfer.snapshots
  }

  markTargetReady(nonce: string, targetWindowId: number): void {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || transfer.phase !== 'awaiting-target' || !transfer.snapshots) {
      throw new Error('安全错误：窗口合并目标未就绪')
    }
    transfer.targetReady = true
  }

  completeForTarget(nonce: string, targetWindowId: number): PendingWindowTransfer {
    const transfer = this.get(nonce)
    if (transfer.targetWindowId !== targetWindowId || !transfer.targetReady || !transfer.snapshots) {
      throw new Error('窗口合并目标尚未确认')
    }
    return transfer
  }

  commit(nonce: string): void {
    this.release(nonce)
  }

  cancel(nonce: string): WindowTransferRequest | undefined {
    const transfer = this.release(nonce)
    return transfer && requestWithNonce(transfer)
  }

  cancelForParticipant(nonce: string, windowId: number): WindowTransferRequest | undefined {
    const transfer = this.get(nonce)
    if (transfer.sourceWindowId !== windowId && transfer.targetWindowId !== windowId) {
      throw new Error('安全错误：无权取消其他窗口的合并操作')
    }
    return this.cancel(nonce)
  }

  cancelForWindow(windowId: number): WindowTransferRequest[] {
    const cancelled: WindowTransferRequest[] = []
    for (const [nonce, transfer] of this.pending) {
      if (transfer.sourceWindowId === windowId || transfer.targetWindowId === windowId) {
        const released = this.cancel(nonce)
        if (released) cancelled.push(released)
      }
    }
    return cancelled
  }

  isWindowReserved(windowId: number): boolean {
    return this.sourceReservations.has(windowId) || this.targetReservations.has(windowId)
  }

  private get(nonce: string): PendingWindowTransfer {
    const transfer = this.pending.get(nonce)
    if (!transfer || transfer.expiresAt < Date.now()) {
      this.release(nonce)
      throw new Error('窗口合并已超时或不存在')
    }
    return transfer
  }

  private release(nonce: string): PendingWindowTransfer | undefined {
    const transfer = this.pending.get(nonce)
    if (!transfer) return undefined
    this.pending.delete(nonce)
    if (this.sourceReservations.get(transfer.sourceWindowId) === nonce) this.sourceReservations.delete(transfer.sourceWindowId)
    if (this.targetReservations.get(transfer.targetWindowId) === nonce) this.targetReservations.delete(transfer.targetWindowId)
    return transfer
  }
}

function requestWithNonce(transfer: PendingWindowTransfer): WindowTransferRequest {
  return {
    nonce: transfer.nonce,
    sourceWindowId: transfer.sourceWindowId,
    targetWindowId: transfer.targetWindowId,
    sourceActiveWorkspaceId: transfer.sourceActiveWorkspaceId,
    workspaces: transfer.workspaces,
  }
}

export const windowTransferCoordinator = new WindowTransferCoordinator()
