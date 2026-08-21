export interface WorkspaceDescriptor {
  id: string
  primaryRoot: string | null
  lifecycleEpoch: number
}

export interface FolderActivation {
  id: string
  path: string
  name: string
  workspace: WorkspaceDescriptor
}

export interface WorkspaceOperationContext {
  workspaceId: string
  lifecycleEpoch: number
}
