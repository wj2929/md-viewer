import { ipcMain } from 'electron'
import { LinkReadService } from '../linkReadService'
import type { IPCContext } from './context'
import type { LinkedReadRequest } from '../../shared/linkRead'
import type { WorkspaceOperationContext } from '../../shared/workspace'

export function registerLinkReadHandlers(ctx: IPCContext): void {
  const service = new LinkReadService(ctx)
  ctx.linkReadService = service
  ipcMain.handle('linkRead:prepareDocument', (event, request: LinkedReadRequest) => service.prepareDocument(event, request))
  ipcMain.handle('linkRead:prepareRefresh', (event, operation: WorkspaceOperationContext,
    documentId: string, leafId: string, requestId: string) =>
    service.prepareDocumentRefresh(event, operation, documentId, leafId, requestId))
  ipcMain.handle('linkRead:commitDocument', (event, batchId: string) => service.commitDocument(event, batchId))
  ipcMain.handle('linkRead:readAttachment', (event, request: LinkedReadRequest, asText?: boolean, previousHandle?: string) =>
    service.readAttachment(event, request, asText, previousHandle))
  ipcMain.handle('linkRead:reveal', (event, id: string) => service.revealResource(event, id))
  ipcMain.handle('linkRead:cancel', (event, operation: WorkspaceOperationContext, leafId: string, requestId: string) =>
    service.cancel(event, operation, leafId, requestId))
  ipcMain.handle('linkRead:release', (event, ids: string[]) => service.release(event, ids))
}
