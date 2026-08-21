import { ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import * as fs from 'fs-extra'
import type { IPCContext } from './context'
import { validateSecurePathInBase } from '../security'
import { validateSenderReadPath } from './senderSecurity'
import { getLocalImageCapabilities } from '../localImageProtocol'

const MAX_LOCAL_IMAGE_SIZE = 10 * 1024 * 1024
const CAPABILITY_TTL_MS = 5 * 60 * 1000
const MAX_CAPABILITIES_PER_SESSION = 500
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

function isSafeRelativeResource(value: string): boolean {
  return Boolean(value)
    && value.length <= 4096
    && !path.isAbsolute(value)
    && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

export function registerLocalImageHandlers(ctx: IPCContext): void {
  ipcMain.handle('fs:issueLocalImageUrl', (event, markdownFilePath: string, rawResourcePath: string) =>
    issueLocalImageUrl(ctx, event, markdownFilePath, rawResourcePath)
  )
}

export async function issueLocalImageUrl(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string
): Promise<string> {
  if (typeof markdownFilePath !== 'string' || typeof rawResourcePath !== 'string') {
    throw new Error('安全错误：本地图片请求无效')
  }

  const markdownPath = await validateSenderReadPath(ctx, event, markdownFilePath)
  let resourcePath: string
  try {
    resourcePath = decodeURIComponent(stripQueryAndHash(rawResourcePath))
  } catch {
    throw new Error('安全错误：本地图片路径编码无效')
  }
  if (!isSafeRelativeResource(resourcePath)) {
    throw new Error('安全错误：本地图片必须使用相对路径')
  }

  const win = ctx.windowManager.getWindowByWebContentsId(event.sender.id)
  if (!win) throw new Error('安全错误：当前窗口无效')

  let root: string | null = null
  for (const workspace of ctx.windowManager.listWorkspaces(win.id)) {
    if (!workspace.primaryRoot) continue
    try {
      await validateSecurePathInBase(markdownPath, workspace.primaryRoot)
      root = workspace.primaryRoot
      break
    } catch {
      // 继续尝试该窗口的其他工作区根。
    }
  }
  if (!root) throw new Error('安全错误：文档不属于当前窗口的工作区')

  const canonicalPath = await validateSecurePathInBase(path.resolve(path.dirname(markdownPath), resourcePath), root)
  if (!IMAGE_EXTENSIONS.has(path.extname(canonicalPath).toLowerCase())) {
    throw new Error('安全错误：不支持的本地图片类型')
  }
  const stats = await fs.stat(canonicalPath)
  if (!stats.isFile() || stats.size > MAX_LOCAL_IMAGE_SIZE) {
    throw new Error('安全错误：本地图片不存在或超过大小限制')
  }

  const capabilities = getLocalImageCapabilities(event.sender.session)
  if (capabilities.size >= MAX_CAPABILITIES_PER_SESSION) {
    const oldestToken = capabilities.keys().next().value
    if (oldestToken) capabilities.delete(oldestToken)
  }
  const token = randomBytes(32).toString('base64url')
  capabilities.set(token, { canonicalPath, expiresAt: Date.now() + CAPABILITY_TTL_MS })
  return `local-image://asset/${token}`
}
