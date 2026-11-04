import { BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import type { IPCContext } from './ipc/context'
import { validateNotProtected } from './security'
import { type FolderActivation } from '../shared/workspace'
import type { DiagnosticSource } from '../shared/diagnostics'

interface FolderActivationTiming {
  realpathMs: number
  statMs: number
}

interface FolderActivationOptions {
  notifyRenderer?: boolean
  diagnosticSource?: DiagnosticSource
  beforeActivate?: () => void | Promise<void>
}

export type { FolderActivation } from '../shared/workspace'

export async function activateFolderForWorkspace(
  ctx: IPCContext,
  window: BrowserWindow,
  workspaceId: string,
  folderPath: string,
  options: FolderActivationOptions = {},
  diagnosticTiming?: FolderActivationTiming
): Promise<FolderActivation> {
  const realpathStarted = performance.now()
  const resolvedPath = await fs.realpath(folderPath)
  if (diagnosticTiming) diagnosticTiming.realpathMs += performance.now() - realpathStarted
  const statStarted = performance.now()
  const stats = await fs.stat(resolvedPath)
  if (diagnosticTiming) diagnosticTiming.statMs += performance.now() - statStarted
  if (!stats.isDirectory()) {
    throw new Error('安全错误：目标不是目录')
  }
  validateNotProtected(resolvedPath)
  await options.beforeActivate?.()

  const historyItem = await ctx.folderHistoryManager.addFolder(resolvedPath)
  if (!historyItem) {
    throw new Error('安全错误：无法记录已验证的目录')
  }

  await options.beforeActivate?.()
  const previousWorkspace = ctx.windowManager.getWorkspace(window.id, workspaceId)
  const previousRoot = previousWorkspace?.primaryRoot ?? null
  const previousEpoch = previousWorkspace?.lifecycleEpoch
  const workspace = ctx.windowManager.replaceWorkspaceRoot(window.id, workspaceId, resolvedPath)
  if (previousEpoch !== undefined) {
    ctx.linkRewritePlanner?.cleanupOwner(`${window.webContents.id}:${workspaceId}:${previousEpoch}`)
  }
  const indexConsumerId = `workspace:${window.webContents.id}:${workspaceId}`
  if (previousRoot && previousRoot !== resolvedPath) {
    void Promise.resolve(ctx.workspaceIndexService?.detach(previousRoot, indexConsumerId))
      .catch(error => console.error('[WorkspaceIndex] Failed to detach previous folder:', error))
  }
  void ctx.workspaceIndexService?.attach(resolvedPath, indexConsumerId)
    .catch(error => console.error('[WorkspaceIndex] Failed to attach activated folder:', error))
  ctx.store.set('lastOpenedFolder', resolvedPath)

  if (options.notifyRenderer) {
    window.webContents.send('workspace:folder-activated', {
      workspaceId: workspace.id,
      path: resolvedPath,
      lifecycleEpoch: workspace.lifecycleEpoch,
    })
  }

  return {
    id: historyItem.id,
    path: resolvedPath,
    name: historyItem.name,
    workspace: {
      id: workspace.id,
      primaryRoot: workspace.primaryRoot,
      lifecycleEpoch: workspace.lifecycleEpoch,
    },
  }
}

/**
 * 仅由主进程调用：校验目录后，将它关联到指定窗口的活动工作区。
 * renderer 不可通过此函数直接提供新的授权根；只有原生对话框、启动参数等
 * 已获用户授权的入口才传入任意路径。
 */
export async function activateFolderForWindow(
  ctx: IPCContext,
  window: BrowserWindow,
  folderPath: string,
  options: FolderActivationOptions = {}
): Promise<FolderActivation> {
  const source = options.diagnosticSource ?? 'unknown'
  const operationId = `folder_${randomUUID()}`
  const started = performance.now()
  const timing = { realpathMs: 0, statMs: 0 }
  ctx.diagnosticEventLogService?.registerOperation(window.webContents.id, operationId, 'folder', source)
  ctx.diagnosticEventLogService?.bindRegisteredOperationPath(window.webContents.id, operationId, folderPath)
  ctx.diagnosticEventLogService?.recordMainEvent({
    event: 'folder.open.start',
    operationId,
    rawWorkspacePath: folderPath,
    metadata: { source },
    priority: 'critical',
  })

  const complete = (activation: FolderActivation): FolderActivation => {
    const durationMs = performance.now() - started
    ctx.diagnosticEventLogService?.bindRegisteredOperationPath(
      window.webContents.id,
      operationId,
      activation.path,
    )
    ctx.diagnosticEventLogService?.recordMainEvent({
      event: 'folder.open.summary',
      operationId,
      rawWorkspacePath: activation.path,
      outcome: 'success',
      metadata: {
        source,
        activationMs: durationMs,
        realpathMs: timing.realpathMs,
        statMs: timing.statMs,
      },
    })
    ctx.diagnosticEventLogService?.recordMainEvent({
      event: 'folder.open.terminal',
      operationId,
      outcome: 'success',
      metadata: { source, durationMs },
      priority: 'critical',
    })
    return { ...activation, diagnosticOperationId: operationId, diagnosticSource: source }
  }

  try {
    const activeWorkspaceId = ctx.windowManager.getActiveWorkspaceId(window.id)
    if (activeWorkspaceId) {
      const activation = await activateFolderForWorkspace(
        ctx,
        window,
        activeWorkspaceId,
        folderPath,
        options,
        timing,
      )
      const completedActivation = complete(activation)
      if (options.notifyRenderer) {
        window.webContents.send('restore-folder', completedActivation)
      }
      return completedActivation
    }

    const realpathStarted = performance.now()
    const resolvedPath = await fs.realpath(folderPath)
    timing.realpathMs += performance.now() - realpathStarted
    const statStarted = performance.now()
    const stats = await fs.stat(resolvedPath)
    timing.statMs += performance.now() - statStarted
    if (!stats.isDirectory()) {
      throw new Error('安全错误：目标不是目录')
    }
    validateNotProtected(resolvedPath)
    await options.beforeActivate?.()

    const historyItem = await ctx.folderHistoryManager.addFolder(resolvedPath)
    if (!historyItem) {
      throw new Error('安全错误：无法记录已验证的目录')
    }

    await options.beforeActivate?.()
    const workspace = ctx.windowManager.getActiveWorkspace(window.id)
    if (!workspace) {
      throw new Error('工作区初始化失败')
    }
    const previousRoot = workspace.primaryRoot
    const previousEpoch = workspace.lifecycleEpoch
    const replacedWorkspace = ctx.windowManager.replaceWorkspaceRoot(window.id, workspace.id, resolvedPath)
    ctx.linkRewritePlanner?.cleanupOwner(`${window.webContents.id}:${workspace.id}:${previousEpoch}`)
    const indexConsumerId = `workspace:${window.webContents.id}:${workspace.id}`
    if (previousRoot && previousRoot !== resolvedPath) {
      void Promise.resolve(ctx.workspaceIndexService?.detach(previousRoot, indexConsumerId))
        .catch(error => console.error('[WorkspaceIndex] Failed to detach previous folder:', error))
    }
    void ctx.workspaceIndexService?.attach(resolvedPath, indexConsumerId)
      .catch(error => console.error('[WorkspaceIndex] Failed to attach activated folder:', error))
    ctx.store.set('lastOpenedFolder', resolvedPath)

    const activation: FolderActivation = {
      id: historyItem.id,
      path: resolvedPath,
      name: historyItem.name,
      workspace: {
        id: replacedWorkspace.id,
        primaryRoot: resolvedPath,
        lifecycleEpoch: replacedWorkspace.lifecycleEpoch,
      },
    }

    const completedActivation = complete(activation)
    if (options.notifyRenderer) {
      window.webContents.send('restore-folder', completedActivation)
    }

    return completedActivation
  } catch (error) {
    ctx.diagnosticEventLogService?.recordMainEvent({
      event: 'folder.open.terminal',
      operationId,
      outcome: 'error',
      metadata: {
        source,
        durationMs: performance.now() - started,
        errorCode: 'FOLDER_ACTIVATION_FAILED',
      },
      priority: 'critical',
    })
    ctx.diagnosticEventLogService?.completeRegisteredOperation(window.webContents.id, operationId)
    throw error
  }
}

export async function activateHistoryFolderForWindow(
  ctx: IPCContext,
  window: BrowserWindow,
  historyId: string
): Promise<FolderActivation> {
  const resolvedPath = await ctx.folderHistoryManager.resolveHistoryFolder(historyId)
  if (!resolvedPath) {
    throw new Error('安全错误：历史目录不存在、不可访问或未经授权')
  }

  return activateFolderForWindow(ctx, window, resolvedPath, {
    diagnosticSource: 'recent',
  })
}

/**
 * 在新窗口中打开一个已由主进程解析出的授权文件夹。
 * folderPath 必须来自主进程可信来源（原生对话框、resolveHistoryFolder 等），
 * 不接受 renderer 直接提供的任意路径。返回新窗口 id。
 */
export function openFolderInNewWindow(ctx: IPCContext, folderPath: string, beforeActivate?: () => void | Promise<void>): number {
  const win = ctx.windowManager.createWindow()
  ctx.windowManager.addPendingAction(win.id, () => {
    activateFolderForWindow(ctx, win, folderPath, { notifyRenderer: true, beforeActivate }).catch((error) => {
      console.error('[openFolderInNewWindow] Failed to activate folder:', error)
    })
  })
  return win.id
}
