export type WatchHealthState = 'starting' | 'recovering' | 'healthy' | 'degraded' | 'detached'

export interface WorkspaceWatchHealth {
  version: number
  state: WatchHealthState
  partialCoverage: boolean
  excludedDirectoryCount: number
  gapVersion: number
  reconciledGapVersion: number
  reason?: 'resource' | 'permission' | 'timeout' | 'process' | 'overflow' | 'reconcile' | 'protocol'
}

export interface WorkspaceWatchStatusEvent {
  workspaceId: string
  lifecycleEpoch: number
  status: WorkspaceWatchHealth
}

export type WatchReconcileResult = 'ok' | 'superseded' | 'failed'

export class WatchReconcileSupersededError extends Error {
  constructor() { super('监听补查已被新的缺口取代') }
}

export interface WorkspaceWatchReconcileRequest {
  workspaceId: string
  lifecycleEpoch: number
  requestId: string
  phase: 'refresh' | 'drain'
}
