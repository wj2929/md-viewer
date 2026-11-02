import { ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import * as fs from 'fs-extra'
import type { IPCContext } from './context'
import { getLocalImageCapabilities } from '../localImageProtocol'
import type { LocalResourceResolutionKind } from '../../shared/localMedia'
import { resolveAuthorizedWorkspaceResource } from '../localResourceResolver'

const MAX_LOCAL_IMAGE_SIZE = 10 * 1024 * 1024
const CAPABILITY_TTL_MS = 5 * 60 * 1000
const MAX_CAPABILITIES_PER_SESSION = 500
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

export function registerLocalImageHandlers(ctx: IPCContext): void {
  ipcMain.handle('fs:issueLocalImageUrl', (
    event,
    markdownFilePath: string,
    rawResourcePath: string,
    resolutionKind: LocalResourceResolutionKind = 'markdown-relative',
  ) => issueLocalImageUrl(ctx, event, markdownFilePath, rawResourcePath, resolutionKind))
}

export async function issueLocalImageUrl(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string,
  resolutionKind: LocalResourceResolutionKind = 'markdown-relative',
): Promise<string> {
  if (typeof markdownFilePath !== 'string' || typeof rawResourcePath !== 'string') {
    throw new Error('安全错误：本地图片请求无效')
  }
  if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
    throw new Error('安全错误：本地图片请求类型无效')
  }

  const resource = await resolveAuthorizedWorkspaceResource(
    ctx,
    event,
    markdownFilePath,
    stripQueryAndHash(rawResourcePath),
    resolutionKind,
  )
  const canonicalPath = resource.canonicalPath
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
