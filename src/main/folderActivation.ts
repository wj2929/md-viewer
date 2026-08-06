import { BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import type { IPCContext } from './ipc/context'
import { validateNotProtected } from './security'

export interface FolderActivation {
  id: string
  path: string
  name: string
}

/**
 * 仅由主进程调用：校验目录后，将它关联到指定窗口。
 * renderer 不可通过此函数直接提供新的授权根；只有原生对话框、启动参数等
 * 已获用户授权的入口才传入任意路径。
 */
export async function activateFolderForWindow(
  ctx: IPCContext,
  window: BrowserWindow,
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

  ctx.windowManager.setWindowFolderPath(window.id, resolvedPath)
  ctx.store.set('lastOpenedFolder', resolvedPath)

  if (options.notifyRenderer) {
    window.webContents.send('restore-folder', resolvedPath)
  }

  return { id: historyItem.id, path: resolvedPath, name: historyItem.name }
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
