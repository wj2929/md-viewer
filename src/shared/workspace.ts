export interface WorkspaceDescriptor {
  id: string
  primaryRoot: string | null
  lifecycleEpoch: number
}

import type { DiagnosticSource } from './diagnostics'

export interface FolderActivation {
  id: string
  path: string
  name: string
  workspace: WorkspaceDescriptor
  diagnosticOperationId?: string
  diagnosticSource?: DiagnosticSource
}

export interface WorkspaceOperationContext {
  workspaceId: string
  lifecycleEpoch: number
}
