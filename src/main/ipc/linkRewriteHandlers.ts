import { ipcMain } from 'electron'
import * as path from 'path'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import type { LinkMoveMapping } from '../linking/types'
import { validateLinkMoveMapping } from '../linking/linkMoveMapping'
import { moveSameRootPath } from '../linking/sameRootMove'
import type { IPCContext } from './context'
import { broadcastDocumentMarksChanged } from './fileHandlers'
import { getSenderWorkspaceForOperation, validateWorkspaceOperationPath } from './senderSecurity'

export function registerLinkRewriteHandlers(ctx: IPCContext): void {
  if (!ctx.linkRewritePlanner || !ctx.workspaceIndexService) return

  ipcMain.handle('link-rewrite:getImpact', async (
    event,
    operation: WorkspaceOperationContext,
    mapping: LinkMoveMapping,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, consumerId(event.sender.id, workspace.id))
    await ctx.workspaceIndexService!.waitUntilIdle(workspace.primaryRoot)
    return ctx.linkRewritePlanner!.createImpact(
      ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      workspace.primaryRoot,
      mapping,
    )
  })

  ipcMain.handle('link-rewrite:executeOperation', async (
    event,
    operation: WorkspaceOperationContext,
    input: { impactId: string; mapping: LinkMoveMapping; reason: 'move' | 'rename'; confirm: boolean },
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    validateId(input?.impactId)
    if (input.confirm !== true) throw new Error('必须明确确认文件操作')
    if (input.reason !== 'move' && input.reason !== 'rename') throw new Error('文件操作原因无效')
    const mapping = validateLinkMoveMapping(input.mapping)
    const sourcePath = await validateWorkspaceOperationPath(
      ctx,
      event,
      operation,
      path.resolve(workspace.primaryRoot, mapping.oldRelativePath),
    )
    const destinationPath = await validateWorkspaceOperationPath(
      ctx,
      event,
      operation,
      path.resolve(workspace.primaryRoot, mapping.newRelativePath),
    )
    if (isSameOrChildPath(destinationPath, sourcePath)) {
      throw new Error('无法移动目录到自身或子目录')
    }
    const executed = await ctx.linkRewritePlanner!.executeOperation({
      ownerId: ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      rootPath: workspace.primaryRoot,
      impactId: input.impactId,
      actualMapping: mapping,
      execute: () => moveSameRootPath({ sourcePath, destinationPath }),
    })
    const changed = ctx.appDataManager?.relocateDocumentMarks(
      workspace.primaryRoot,
      sourcePath,
      destinationPath,
      executed.result.isDirectory,
    )
    if (changed) {
      await broadcastDocumentMarksChanged(ctx, event.sender.id).catch(error => {
        console.warn('[LinkRewrite] Failed to broadcast document marks:', error)
      })
    }
    await ctx.workspaceIndexService!.refreshMovedRelativePaths(workspace.primaryRoot, [mapping]).catch(error => {
      console.warn('[LinkRewrite] Failed to refresh moved index paths:', error)
    })
    return { newPath: executed.result.destinationPath, receipt: executed.receipt }
  })

  ipcMain.handle('link-rewrite:createRepairPlan', async (
    event,
    operation: WorkspaceOperationContext,
    mapping: LinkMoveMapping,
    reason: 'move' | 'rename',
    operationReceiptId: string,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    if (reason !== 'move' && reason !== 'rename') throw new Error('修复原因无效')
    validateId(operationReceiptId)
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, consumerId(event.sender.id, workspace.id))
    await ctx.workspaceIndexService!.waitUntilIdle(workspace.primaryRoot)
    return ctx.linkRewritePlanner!.createRepairPlan({
      ownerId: ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      rootPath: workspace.primaryRoot,
      mapping,
      reason,
      operationReceiptId,
    })
  })

  ipcMain.handle('link-rewrite:apply', async (
    event,
    operation: WorkspaceOperationContext,
    input: { planId: string; operationReceiptId: string; selectedChangeIds: string[]; confirm: boolean },
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    validateApplyInput(input)
    return ctx.linkRewritePlanner!.apply({
      ownerId: ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      rootPath: workspace.primaryRoot,
      planId: input.planId,
      operationReceiptId: input.operationReceiptId,
      selectedChangeIds: input.selectedChangeIds,
      confirm: input.confirm,
    })
  })

  ipcMain.handle('link-rewrite:applyBatch', async (
    event,
    operation: WorkspaceOperationContext,
    input: {
      plans: Array<{ planId: string; operationReceiptId: string; selectedChangeIds: string[] }>
      confirm: boolean
    },
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    validateBatchApplyInput(input)
    return ctx.linkRewritePlanner!.applyBatch({
      ownerId: ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      rootPath: workspace.primaryRoot,
      plans: input.plans,
      confirm: input.confirm,
    })
  })

  ipcMain.handle('link-rewrite:regeneratePlan', async (
    event,
    operation: WorkspaceOperationContext,
    planId: string,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    validateId(planId)
    await ctx.workspaceIndexService!.waitUntilIdle(workspace.primaryRoot)
    return ctx.linkRewritePlanner!.regeneratePlan({
      ownerId: ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      rootPath: workspace.primaryRoot,
      planId,
    })
  })

  ipcMain.handle('link-rewrite:discard', (
    event,
    operation: WorkspaceOperationContext,
    planId: string,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    validateId(planId)
    ctx.linkRewritePlanner!.discard(
      ownerId(event.sender.id, workspace.id, operation.lifecycleEpoch),
      planId,
    )
  })
}

function isSameOrChildPath(targetPath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    !path.isAbsolute(relativePath)
  )
}

function validateBatchApplyInput(input: {
  plans: Array<{ planId: string; operationReceiptId: string; selectedChangeIds: string[] }>
  confirm: boolean
}): void {
  if (!input || typeof input !== 'object' || !Array.isArray(input.plans) || input.plans.length === 0 || input.plans.length > 8) {
    throw new Error('链接修复计划无效')
  }
  let totalChanges = 0
  for (const plan of input.plans) {
    validateId(plan?.planId)
    validateId(plan?.operationReceiptId)
    if (!Array.isArray(plan.selectedChangeIds)) throw new Error('链接修复项无效')
    totalChanges += plan.selectedChangeIds.length
    if (totalChanges > 2000 || plan.selectedChangeIds.some(id => typeof id !== 'string' || !id || id.length > 200)) {
      throw new Error('链接修复项无效')
    }
  }
}

function validateApplyInput(input: { planId: string; operationReceiptId: string; selectedChangeIds: string[]; confirm: boolean }): void {
  if (!input || typeof input !== 'object') throw new Error('链接修复参数无效')
  validateId(input.planId)
  validateId(input.operationReceiptId)
  if (
    !Array.isArray(input.selectedChangeIds) ||
    input.selectedChangeIds.length > 2000 ||
    input.selectedChangeIds.some(id => typeof id !== 'string' || !id || id.length > 200)
  ) throw new Error('链接修复项无效')
}

function validateId(id: string): void {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('链接修复计划无效')
}

function ownerId(webContentsId: number, workspaceId: string, epoch: number): string {
  return `${webContentsId}:${workspaceId}:${epoch}`
}

function consumerId(webContentsId: number, workspaceId: string): string {
  return `workspace:${webContentsId}:${workspaceId}`
}
