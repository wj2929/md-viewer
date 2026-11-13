import { isActiveWorkspaceLifecycleKey, type WorkspaceLifecycleKey } from './workspaceOperationContext'

const preparations = new Map<string, Promise<void>>()

/** Attach the logical root subscription before a read captures its recovery evidence. */
export function prepareWorkspaceWatch(lifecycle: WorkspaceLifecycleKey): Promise<void> {
  if (!lifecycle.primaryRoot || !isActiveWorkspaceLifecycleKey(lifecycle)) return Promise.resolve()
  const key = JSON.stringify([lifecycle.workspaceId, lifecycle.lifecycleEpoch, lifecycle.primaryRoot])
  const existing = preparations.get(key)
  if (existing) return existing
  const pending = Promise.resolve().then(async () => {
    if (!isActiveWorkspaceLifecycleKey(lifecycle)) return
    await window.api.watchFolder(lifecycle.primaryRoot!, lifecycle.workspaceId, lifecycle.lifecycleEpoch)
  }).catch(error => {
    // Watching must not prevent an otherwise authorized document read.
    console.error('Failed to watch folder:', error)
  }).finally(() => {
    if (preparations.get(key) === pending) preparations.delete(key)
  })
  preparations.set(key, pending)
  return pending
}
