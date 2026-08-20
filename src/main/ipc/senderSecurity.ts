import { BrowserWindow } from 'electron'
import type { IPCContext } from './context'
import { validateSecurePathInBase } from '../security'
import type { WorkspaceOperationContext } from '../../shared/workspace'

export function getSenderWindow(ctx: IPCContext, event: Electron.IpcMainInvokeEvent): Electron.BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
    throw new Error('无法识别当前窗口')
  }
  return window
}

export function getSenderWorkspace(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  workspaceId: string
) {
  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new Error('安全错误：工作区无效')
  }
  const window = getSenderWindow(ctx, event)
  const workspace = ctx.windowManager.getWorkspace(window.id, workspaceId)
  if (!workspace) throw new Error('安全错误：工作区不存在或不属于当前窗口')
  return workspace
}

export function getSenderWorkspaceForOperation(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  operation: WorkspaceOperationContext
) {
  if (!operation || !Number.isInteger(operation.lifecycleEpoch)) {
    throw new Error('安全错误：写入请求缺少完整工作区上下文')
  }
  const workspace = getSenderWorkspace(ctx, event, operation.workspaceId)
  if (workspace.lifecycleEpoch !== operation.lifecycleEpoch) {
    throw new Error('安全错误：工作区已失效')
  }
  return workspace
}

export async function validateWorkspaceOperationPath(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  operation: WorkspaceOperationContext,
  targetPath: string
): Promise<string> {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return validateSecurePathInBase(targetPath, workspace.primaryRoot)
}

export async function validateWorkspaceWritePath(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  workspaceId: string,
  targetPath: string
): Promise<string> {
  const workspace = getSenderWorkspace(ctx, event, workspaceId)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  return validateSecurePathInBase(targetPath, workspace.primaryRoot)
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
 *
 * recent、书签等业务记录只能作为导航候选，不能反向成为读授权凭据。
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
  for (const root of candidateRoots) {
    try {
      return await validateSecurePathInBase(targetPath, root)
    } catch {
      // 尝试下一个根
    }
  }

  throw new Error(`安全错误：路径 "${targetPath}" 不在任何已授权的文件夹内`)
}
