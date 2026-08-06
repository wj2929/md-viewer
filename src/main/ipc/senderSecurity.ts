import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import type { IPCContext } from './context'
import { validateSecurePathInBase } from '../security'

export function getSenderWindow(ctx: IPCContext, event: Electron.IpcMainInvokeEvent): Electron.BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
    throw new Error('无法识别当前窗口')
  }
  return window
}

export function getSenderFolderRoot(ctx: IPCContext, event: Electron.IpcMainInvokeEvent): string {
  const root = ctx.windowManager.getWindowFolderPath(getSenderWindow(ctx, event).id)
  if (!root) {
    throw new Error('当前窗口未绑定文件夹')
  }
  return root
}

export async function validateSenderPath(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  targetPath: string
): Promise<string> {
  return validateSecurePathInBase(targetPath, getSenderFolderRoot(ctx, event))
}

/**
 * 读类操作的放宽校验：md-viewer 是个人本机工具，用户打开的多个文件夹之间没有信任边界。
 * 因此读取（预览、分屏打开、看图等）只要目标落在「任一用户已授权过的根」内即可放行：
 *   - 任一存活窗口当前绑定的根
 *   - 文件夹历史里的根
 *   - 最近文件记录的 folderPath
 * 若目标不在上述任何根内，但它精确等于一条已登记的最近文件/书签路径，则以其父目录为根兜底放行。
 *
 * 仍然保留两层真正的防护栏（均在 validateSecurePathInBase 内）：
 *   - realpath 边界：阻止通过符号链接逃逸出根
 *   - validateNotProtected：阻止读取 .ssh / .aws / 系统敏感路径（防恶意 md 骗读私钥）
 *
 * 写类操作不得使用此函数——写仍严格限定在发起窗口根内（validateSenderPath / 剪贴板精确源例外）。
 */
export async function validateSenderReadPath(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  targetPath: string
): Promise<string> {
  // 绝大多数读取都在发起窗口根内，这条路径无额外开销
  try {
    return await validateSecurePathInBase(targetPath, getSenderFolderRoot(ctx, event))
  } catch {
    // 落到放行集判定
  }

  const candidateRoots = new Set<string>()
  for (const root of ctx.windowManager.getAllWindowFolderRoots()) {
    candidateRoots.add(root)
  }
  try {
    for (const item of await ctx.folderHistoryManager.getHistory()) {
      if (item?.path) candidateRoots.add(item.path)
    }
  } catch {
    // 历史不可用时忽略
  }
  for (const recent of ctx.appDataManager.getRecentFiles()) {
    if (recent?.folderPath) candidateRoots.add(recent.folderPath)
  }

  for (const root of candidateRoots) {
    try {
      return await validateSecurePathInBase(targetPath, root)
    } catch {
      // 尝试下一个根
    }
  }

  // 精确文件白名单兜底：目标本身是一条已登记的最近文件 / 书签
  const registeredFiles = new Set<string>()
  for (const recent of ctx.appDataManager.getRecentFiles()) {
    if (recent?.path) registeredFiles.add(recent.path)
  }
  for (const bookmark of ctx.appDataManager.getBookmarks()) {
    if (bookmark?.filePath) registeredFiles.add(bookmark.filePath)
  }
  if (registeredFiles.size > 0) {
    let canonicalTarget: string | null = null
    try {
      canonicalTarget = await fs.realpath(targetPath)
    } catch {
      canonicalTarget = null
    }
    for (const registered of registeredFiles) {
      if (registered === targetPath) {
        return validateSecurePathInBase(targetPath, path.dirname(targetPath))
      }
      if (canonicalTarget) {
        try {
          if (await fs.realpath(registered) === canonicalTarget) {
            return validateSecurePathInBase(targetPath, path.dirname(targetPath))
          }
        } catch {
          // 登记文件已失效，跳过
        }
      }
    }
  }

  throw new Error(`安全错误：路径 "${targetPath}" 不在任何已授权的文件夹内`)
}
