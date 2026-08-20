import type { WorkspaceDescriptor } from '../stores/workspaceStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

export interface WorkspaceOperationContext {
  workspaceId: string
  lifecycleEpoch: number
}

export interface WorkspaceLifecycleKey extends WorkspaceOperationContext {
  primaryRoot: string | null
}

/** Returns the active workspace identity used to discard stale renderer callbacks. */
export function getActiveWorkspaceLifecycleKey(): WorkspaceLifecycleKey | undefined {
  const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState()
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId)
  if (!workspace || !Number.isInteger(workspace.lifecycleEpoch)) return undefined
  return {
    workspaceId: workspace.id,
    lifecycleEpoch: workspace.lifecycleEpoch,
    primaryRoot: workspace.primaryRoot,
  }
}

/** True only while the same main-process workspace generation is still active. */
export function isActiveWorkspaceLifecycleKey(key: WorkspaceLifecycleKey): boolean {
  const current = getActiveWorkspaceLifecycleKey()
  return current?.workspaceId === key.workspaceId
    && current.lifecycleEpoch === key.lifecycleEpoch
    && current.primaryRoot === key.primaryRoot
}

/** Returns a context only after main-process bootstrap has supplied a live epoch. */
export function getActiveWorkspaceOperationContext(): WorkspaceOperationContext | undefined {
  const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState()
  const workspace: WorkspaceDescriptor | undefined = workspaces.find(
    (item) => item.id === activeWorkspaceId
  )
  if (!workspace || !Number.isInteger(workspace.lifecycleEpoch)) return undefined
  return {
    workspaceId: workspace.id,
    lifecycleEpoch: workspace.lifecycleEpoch as number,
  }
}
