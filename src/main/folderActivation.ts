import { BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import type { IPCContext } from './ipc/context'
import { validateNotProtected } from './security'

import { type FolderActivation } from '../shared/workspace'

export type { FolderActivation } from '../shared/workspace'

export async function activateFolderForWorkspace(
  ctx: IPCContext,
  window: BrowserWindow,
  workspaceId: string,
  folderPath: string,
  options: { notifyRenderer?: boolean } = {}
): Promise<FolderActivation> {
  const resolvedPath = await fs.realpath(folderPath)
  const stats = await fs.stat(resolvedPath)
  if (!stats.isDirectory()) {
    throw new Error('安全错误：目标不是目录')
  }
  validateNotProtected(resolvedPath)

  const historyItem = await ctx.folderHistoryManager.addFolder(resolvedPath)
  if (!historyItem) {
    throw new Error('安全错误：无法记录已验证的目录')
  }

  const workspace = ctx.windowManager.replaceWorkspaceRoot(window.id, workspaceId, resolvedPath)
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
  options: { notifyRenderer?: boolean } = {}
): Promise<FolderActivation> {
  const activeWorkspaceId = ctx.windowManager.getActiveWorkspaceId(window.id)
  if (activeWorkspaceId) {
    const activation = await activateFolderForWorkspace(ctx, window, activeWorkspaceId, folderPath, options)
    if (options.notifyRenderer) {
      window.webContents.send('restore-folder', activation)
    }
    return activation
  }

  const resolvedPath = await fs.realpath(folderPath)
  const stats = await fs.stat(resolvedPath)
  if (!stats.isDirectory()) {
    throw new Error('安全错误：目标不是目录')
  }
  validateNotProtected(resolvedPath)

  const historyItem = await ctx.folderHistoryManager.addFolder(resolvedPath)
  if (!historyItem) {
    throw new Error('安全错误：无法记录已验证的目录')
  }

  const workspace = ctx.windowManager.getActiveWorkspace(window.id)
  if (!workspace) {
    throw new Error('工作区初始化失败')
  }
  ctx.windowManager.replaceWorkspaceRoot(window.id, workspace.id, resolvedPath)
  ctx.store.set('lastOpenedFolder', resolvedPath)

  const activation: FolderActivation = {
    id: historyItem.id,
    path: resolvedPath,
    name: historyItem.name,
    workspace: {
      id: workspace.id,
      primaryRoot: resolvedPath,
      lifecycleEpoch: workspace.lifecycleEpoch,
    },
  }

  if (options.notifyRenderer) {
    window.webContents.send('restore-folder', activation)
  }

  return activation
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

  return activateFolderForWindow(ctx, window, resolvedPath)
}
