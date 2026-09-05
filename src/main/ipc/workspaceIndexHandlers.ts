import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import type { IPCContext } from './context'
import { getSenderWorkspaceForOperation } from './senderSecurity'
import type { WorkspaceOperationContext } from '../../shared/workspace'

export function registerWorkspaceIndexHandlers(ctx: IPCContext): void {
  if (!ctx.workspaceIndexService) return
  const subscriptions = new Map<string, {
    sender: WebContents
    operation: WorkspaceOperationContext
    rootPath: string
    listenerId: string
  }>()
  const cleanupBoundSenders = new Set<number>()
  const cleanupSender = (senderId: number): void => {
    for (const [subscriptionId, subscription] of subscriptions) {
      if (subscription.sender.id !== senderId) continue
      ctx.workspaceIndexService!.unsubscribeStatus(subscription.rootPath, subscription.listenerId)
      subscriptions.delete(subscriptionId)
    }
  }
  const ensureSenderCleanup = (sender: WebContents): void => {
    if (cleanupBoundSenders.has(sender.id)) return
    const senderId = sender.id
    cleanupBoundSenders.add(senderId)
    sender.once('destroyed', () => {
      cleanupBoundSenders.delete(senderId)
      cleanupSender(senderId)
    })
  }

  ipcMain.handle('workspace-index:subscribeStatus', async (event, operation: WorkspaceOperationContext) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    const rootPath = workspace.primaryRoot
    await ctx.workspaceIndexService!.attach(rootPath, indexConsumerId(event.sender.id, workspace.id))
    const subscriptionId = randomUUID()
    const listenerId = `status:${event.sender.id}:${subscriptionId}`
    subscriptions.set(subscriptionId, { sender: event.sender, operation, rootPath, listenerId })
    ensureSenderCleanup(event.sender)
    ctx.workspaceIndexService!.subscribeStatus(rootPath, listenerId, status => {
      const subscription = subscriptions.get(subscriptionId)
      if (!subscription || subscription.sender.isDestroyed()) {
        ctx.workspaceIndexService!.unsubscribeStatus(rootPath, listenerId)
        subscriptions.delete(subscriptionId)
        return
      }
      try {
        const current = ctx.windowManager.getWorkspace(
          // sender security resolves the owning window; using it again on every delivery is the authority check.
          requireSenderWindowId(subscription.sender),
          subscription.operation.workspaceId,
        )
        if (
          !current || current.lifecycleEpoch !== subscription.operation.lifecycleEpoch ||
          current.primaryRoot !== subscription.rootPath
        ) throw new Error('工作区已失效')
        subscription.sender.send('workspace-index:statusChanged', { subscriptionId, status })
      } catch {
        ctx.workspaceIndexService!.unsubscribeStatus(rootPath, listenerId)
        subscriptions.delete(subscriptionId)
      }
    })
    return subscriptionId
  })

  ipcMain.handle('workspace-index:unsubscribeStatus', (event, subscriptionId: string) => {
    const subscription = subscriptions.get(subscriptionId)
    if (!subscription || subscription.sender.id !== event.sender.id) throw new Error('索引订阅无效')
    ctx.workspaceIndexService!.unsubscribeStatus(subscription.rootPath, subscription.listenerId)
    subscriptions.delete(subscriptionId)
  })

  ipcMain.handle('workspace-index:getStatus', async (event, operation: WorkspaceOperationContext) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, indexConsumerId(event.sender.id, workspace.id))
    return ctx.workspaceIndexService!.getStatus(workspace.primaryRoot)
  })

  ipcMain.handle('workspace-index:query', async (
    event,
    operation: WorkspaceOperationContext,
    query: string,
    limit?: number,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    if (typeof query !== 'string' || query.length > 500) throw new Error('搜索词无效')
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, indexConsumerId(event.sender.id, workspace.id))
    return ctx.workspaceIndexService!.query(workspace.primaryRoot, query, limit)
  })

  ipcMain.handle('workspace-index:queryHistory', async (
    event,
    operation: WorkspaceOperationContext,
    query: string,
    historyIds: string[],
    recentFileIds: string[],
    limit?: number,
  ) => {
    getSenderWorkspaceForOperation(ctx, event, operation)
    if (typeof query !== 'string' || query.length > 500) throw new Error('搜索词无效')
    if (
      !Array.isArray(historyIds) || historyIds.length > 10 ||
      historyIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
      !Array.isArray(recentFileIds) || recentFileIds.length > 100 ||
      recentFileIds.some(id => typeof id !== 'string' || !id || id.length > 200)
    ) {
      throw new Error('历史记录标识无效')
    }

    const boundedLimit = Math.min(Math.max(1, limit ?? 60), 100)
    const uniqueIds = [...new Set(historyIds)]
    const results: Array<Awaited<ReturnType<typeof ctx.workspaceIndexService.query>>[number] & {
      historyId?: string
      recentFileId?: string
      filePath: string
    }> = []
    for (const historyId of uniqueIds) {
      const rootPath = await ctx.folderHistoryManager.resolveHistoryFolder(historyId)
      if (!rootPath) continue
      const consumerId = `history-query:${event.sender.id}:${historyId}`
      try {
        await ctx.workspaceIndexService!.attach(rootPath, consumerId)
        await ctx.workspaceIndexService!.waitUntilIdle(rootPath)
        const indexedResults = await ctx.workspaceIndexService!.query(rootPath, query, boundedLimit)
        results.push(...indexedResults.map(result => ({
          ...result,
          historyId,
          filePath: path.join(rootPath, result.relativePath),
        })))
      } finally {
        await ctx.workspaceIndexService!.detach(rootPath, consumerId)
      }
    }
    for (const recentFileId of [...new Set(recentFileIds)]) {
      const recentFile = ctx.appDataManager.getRecentFile(recentFileId)
      if (!recentFile) continue
      const historyRoot = await ctx.folderHistoryManager.findContainingFolder(recentFile.path)
      if (!historyRoot) continue
      const relativePath = path.relative(historyRoot, recentFile.path)
      if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) continue
      const consumerId = `history-file-query:${event.sender.id}:${recentFileId}`
      try {
        await ctx.workspaceIndexService!.attach(historyRoot, consumerId)
        await ctx.workspaceIndexService!.waitUntilIdle(historyRoot)
        const indexedResults = await ctx.workspaceIndexService!.query(historyRoot, query, boundedLimit)
        const matching = indexedResults.find(result => result.relativePath === relativePath.split(path.sep).join('/'))
        if (matching) {
          results.push({
            ...matching,
            recentFileId,
            filePath: recentFile.path,
          })
        }
      } finally {
        await ctx.workspaceIndexService!.detach(historyRoot, consumerId)
      }
    }
    return results
      .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
      .slice(0, boundedLimit)
  })

  ipcMain.handle('workspace-index:getBacklinks', async (
    event,
    operation: WorkspaceOperationContext,
    targetRelativePath: string,
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    validateRelativePath(targetRelativePath)
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, indexConsumerId(event.sender.id, workspace.id))
    return ctx.workspaceIndexService!.getBacklinks(workspace.primaryRoot, targetRelativePath)
  })

  ipcMain.handle('workspace-index:rebuild', async (event, operation: WorkspaceOperationContext) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
    await ctx.workspaceIndexService!.attach(workspace.primaryRoot, indexConsumerId(event.sender.id, workspace.id))
    return ctx.workspaceIndexService!.rebuild(workspace.primaryRoot)
  })
}

function requireSenderWindowId(sender: WebContents): number {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window) throw new Error('无法识别发起窗口')
  return window.id
}

function indexConsumerId(webContentsId: number, workspaceId: string): string {
  return `workspace:${webContentsId}:${workspaceId}`
}

function validateRelativePath(value: string): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]+/).includes('..')
  ) throw new Error('相对路径无效')
}
