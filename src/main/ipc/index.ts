import { IPCContext } from './context'
import { registerWindowHandlers } from './windowHandlers'
import { registerFileHandlers } from './fileHandlers'
import { registerExportHandlers } from './exportHandlers'
import { registerMenuHandlers } from './menuHandlers'
import { registerDataHandlers } from './dataHandlers'
import { registerTtsHandlers } from './ttsHandlers'
import { registerLocalImageHandlers } from './localImageHandlers'
import { registerWorkspaceIndexHandlers } from './workspaceIndexHandlers'
import { registerLinkRewriteHandlers } from './linkRewriteHandlers'
import { registerDiagnosticsHandlers } from './diagnosticsHandlers'
import { registerExampleHandlers } from './exampleHandlers'

export type { IPCContext, AppState } from './context'
export { getFileWatcherState } from './fileHandlers'

/**
 * 注册所有 IPC handlers
 */
export function registerAllHandlers(ctx: IPCContext): void {
  registerWindowHandlers(ctx)
  registerFileHandlers(ctx)
  registerExportHandlers(ctx)
  registerMenuHandlers(ctx)
  registerDataHandlers(ctx)
  registerTtsHandlers(ctx)
  registerLocalImageHandlers(ctx)
  registerWorkspaceIndexHandlers(ctx)
  registerLinkRewriteHandlers(ctx)
  registerDiagnosticsHandlers(ctx)
  registerExampleHandlers(ctx)
}
