import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { ReclamationError } from '../indexing/WorkspaceIndexReclamation'
import type { WorkspaceIndexReclamationResponse } from '../indexing/types'
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
      !Array.isArray(recentFileIds) || recentFileIds.length > 500 ||
      recentFileIds.some(id => typeof id !== 'string' || !id || id.length > 200)
    ) {
      throw new Error('历史记录标识无效')
    }

    const boundedLimit = Math.min(Math.max(1, limit ?? 60), 100)
    type HistoryResult = Awaited<ReturnType<typeof ctx.workspaceIndexService.query>>[number] & {
      historyId?: string
      recentFileId?: string
      filePath: string
    }
    const groups = new Map<string, {
      historyId?: string
      recentFiles: Map<string, { id: string; path: string }>
    }>()
    for (const historyId of new Set(historyIds)) {
      const rootPath = await ctx.folderHistoryManager.resolveHistoryFolder(historyId)
      if (rootPath && !groups.has(rootPath)) groups.set(rootPath, { historyId, recentFiles: new Map() })
    }
    for (const recentFileId of new Set(recentFileIds)) {
      const recentFile = ctx.appDataManager.getRecentFile(recentFileId)
      if (!recentFile) continue
      const rootPath = await ctx.folderHistoryManager.findContainingFolder(recentFile.path)
      if (!rootPath) continue
      const relativePath = path.relative(rootPath, recentFile.path)
      if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) continue
      const group = groups.get(rootPath) ?? { recentFiles: new Map() }
      group.recentFiles.set(relativePath.split(path.sep).join('/'), { id: recentFileId, path: recentFile.path })
      groups.set(rootPath, group)
    }
    const results = new Map<string, HistoryResult>()
    for (const [rootPath, group] of groups) {
      const consumerId = `history-query:${event.sender.id}:${group.historyId ?? 'recent'}:${randomUUID()}`
      try {
        await ctx.workspaceIndexService!.attach(rootPath, consumerId)
        await ctx.workspaceIndexService!.waitUntilIdle(rootPath)
        const indexedResults = await ctx.workspaceIndexService!.query(
          rootPath, query, boundedLimit, group.historyId ? undefined : new Set(group.recentFiles.keys()),
        )
        for (const result of indexedResults) {
          const recentFile = group.recentFiles.get(result.relativePath)
          if (!group.historyId && !recentFile) continue
          const filePath = group.historyId ? path.join(rootPath, result.relativePath) : recentFile!.path
          if (results.has(filePath)) continue
          results.set(filePath, {
            ...result,
            ...(group.historyId ? { historyId: group.historyId } : { recentFileId: recentFile!.id }),
            filePath,
          })
        }
      } finally {
        await ctx.workspaceIndexService!.detach(rootPath, consumerId)
      }
    }
    return [...results.values()]
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

  const reclamationFlights = new Set<number>()
  ipcMain.handle('workspace-index:reclaim', async (event, operation: WorkspaceOperationContext): Promise<WorkspaceIndexReclamationResponse> => {
    const senderId = event.sender.id
    if (reclamationFlights.has(senderId)) return { status: 'busy', message: '旧索引维护正在进行，请稍后重试。' }
    reclamationFlights.add(senderId)
    try {
      const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
      if (!workspace.primaryRoot) throw new ReclamationError('busy')
      const rootPath = workspace.primaryRoot
      const parent = BrowserWindow.fromWebContents(event.sender)
      const authorize = (): void => {
        if (!parent || parent.isDestroyed() || event.sender.isDestroyed()) throw new ReclamationError('stale')
        try {
          const current = getSenderWorkspaceForOperation(ctx, event, operation)
          if (current.primaryRoot !== rootPath) throw new ReclamationError('stale')
        } catch { throw new ReclamationError('stale') }
      }
      authorize()
      const prepared = await ctx.workspaceIndexService!.prepareReclamation(rootPath, authorize)
      authorize()
      if (!prepared || prepared.summary.files + prepared.summary.directories === 0) {
        return { status: 'empty', message: '当前工作区没有可安全回收的旧索引。' }
      }
      const { summary } = prepared
      const answer = await dialog.showMessageBox(parent!, {
        type: 'warning', title: '清理当前工作区旧索引？', message: '清理当前工作区旧索引？',
        detail: `将回收 ${summary.generations} 个旧代中的文件及无引用分片，共 ${summary.files} 个文件、${summary.directories} 个目录，逻辑大小 ${summary.bytes.toLocaleString()} 字节。保留当前代及最近一个其他完整代（如有）。不删除源文档，不重建当前索引。删除后不可恢复，实际磁盘释放量可能不同。\n其他实例可能重新扫描；源文件不可访问时，其搜索和反链可能暂时不完整。`,
        buttons: ['取消', '清理旧索引'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (answer.response !== 1) return { status: 'cancelled', message: '已取消，未清理旧索引。' }
      authorize()
      const result = await prepared.execute()
      return {
        ...result,
        message: `${result.status === 'partial' ? '清理部分完成' : '清理完成'}：删除 ${result.deletedFiles} 个文件、${result.deletedDirectories} 个目录，逻辑大小 ${result.deletedBytes.toLocaleString()} 字节；跳过 ${result.skippedFiles} 项，失败 ${result.failedFiles} 项。`,
      }
    } catch (error) {
      const status = error instanceof ReclamationError ? error.code : 'invalid'
      const messages = {
        stale: '索引或工作区已变化，请重新预览后再清理。',
        busy: '当前索引尚未就绪或由其他实例维护，暂不可清理。',
        budget: '本次无法在安全预算内完成回收，请勿直接删除索引文件。',
        invalid: '无法确认索引完整性或清理范围，已停止；请勿直接删除索引文件。',
      }
      return { status, message: messages[status] }
    } finally { reclamationFlights.delete(senderId) }
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
