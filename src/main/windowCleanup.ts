import type { IPCContext } from './ipc/context'

interface WindowCleanupTarget {
  id: number
  webContents: { id: number }
}

interface FileWatcherCleanup {
  cleanup: (webContentsId: number) => void
}

export function cleanupWindowCapabilities(
  ctx: IPCContext,
  window: WindowCleanupTarget,
  fileWatcherState: FileWatcherCleanup,
): void {
  const webContentsId = window.webContents.id
  fileWatcherState.cleanup(webContentsId)

  for (const workspace of ctx.windowManager.listWorkspaces(window.id)) {
    if (workspace.primaryRoot) {
      void Promise.resolve(ctx.workspaceIndexService?.detach(
        workspace.primaryRoot,
        `workspace:${webContentsId}:${workspace.id}`,
      )).catch(error => console.error('[WorkspaceIndex] Failed to detach closed window:', error))
    }
    ctx.linkRewritePlanner?.cleanupOwner(
      `${webContentsId}:${workspace.id}:${workspace.lifecycleEpoch}`,
    )
  }
}
