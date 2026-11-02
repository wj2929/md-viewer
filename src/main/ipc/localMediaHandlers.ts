import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { readLocalTextSnapshot, sameTextFile as sameAttachmentFile } from '../localTextSnapshot'
import { randomBytes } from 'node:crypto'
import * as fs from 'fs-extra'
import type { IPCContext } from './context'
import {
  MAX_LOCAL_MEDIA_SIZE,
  MAX_LOCAL_WEBVTT_SIZE,
  LOCAL_ATTACHMENT_TEXT_EXTENSIONS,
  isSafeLocalResourceReference,
  type LocalAttachment,
  type LocalAttachmentResult,
  type LocalAttachmentOpenResult,
  extensionOfResourcePath,
  localMediaMimeType,
  type LocalMediaKind,
  type LocalResourceResolutionKind,
} from '../../shared/localMedia'
import {
  LOCAL_MEDIA_CAPABILITY_TTL_MS,
  MAX_LOCAL_MEDIA_CAPABILITIES_PER_SESSION,
  getLocalMediaCapabilities,
  getLocalMediaCapabilityUrl,
} from '../localMediaProtocol'
import { resolveAuthorizedWorkspaceResource, type AuthorizedWorkspaceResource } from '../localResourceResolver'
import { getFileManagerLabels } from '../platformMenuLabels'
import { canOpenAttachment } from '../localAttachmentPolicy'

export function registerLocalMediaHandlers(ctx: IPCContext): void {
  ipcMain.handle('fs:readLocalAttachment', (event, source: string, ref: string) =>
    readLocalAttachment(ctx, event, source, ref),
  )
  ipcMain.handle('fs:openLocalAttachment', (event, source: string, ref: string) =>
    openLocalAttachment(ctx, event, source, ref),
  )
  ipcMain.handle(
    'fs:issueLocalMediaUrl',
    (
      event,
      markdownFilePath: string,
      rawResourcePath: string,
      kind: LocalMediaKind,
      resolutionKind: LocalResourceResolutionKind,
    ) => issueLocalMediaUrl(ctx, event, markdownFilePath, rawResourcePath, kind, resolutionKind),
  )
  ipcMain.handle(
    'fs:readLocalWebVtt',
    (
      event,
      markdownFilePath: string,
      rawResourcePath: string,
      resolutionKind: LocalResourceResolutionKind,
    ) => readLocalWebVtt(ctx, event, markdownFilePath, rawResourcePath, resolutionKind),
  )
  ipcMain.handle(
    'fs:revealLocalResource',
    (
      event,
      markdownFilePath: string,
      rawResourcePath: string,
      resolutionKind: LocalResourceResolutionKind,
    ) => revealLocalResource(ctx, event, markdownFilePath, rawResourcePath, resolutionKind),
  )
}

export async function issueLocalMediaUrl(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string,
  kind: LocalMediaKind,
  resolutionKind: LocalResourceResolutionKind,
): Promise<string> {
  if (
    (kind !== 'audio' && kind !== 'video')
    || (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki')
  ) throw new Error('安全错误：本地媒体请求类型无效')

  const resource = await resolveAuthorizedWorkspaceResource(
    ctx,
    event,
    markdownFilePath,
    rawResourcePath,
    resolutionKind,
  )
  const mimeType = localMediaMimeType(resource.canonicalPath, kind)
  if (!mimeType) throw new Error('安全错误：不支持的本地媒体类型')

  const stats = await fs.stat(resource.canonicalPath)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_LOCAL_MEDIA_SIZE) {
    throw new Error('安全错误：本地媒体不存在或超过大小限制')
  }

  const capabilities = getLocalMediaCapabilities(event.sender.session)
  const now = Date.now()
  for (const [token, capability] of capabilities) {
    if (capability.expiresAt <= now) capabilities.delete(token)
    else if (
      capability.canonicalPath === resource.canonicalPath
      && capability.workspaceId === resource.workspaceId
      && capability.lifecycleEpoch === resource.lifecycleEpoch
      && capability.kind === kind
    ) {
      capability.expiresAt = now + LOCAL_MEDIA_CAPABILITY_TTL_MS
      return getLocalMediaCapabilityUrl(event.sender.session, token)
    }
  }
  if (capabilities.size >= MAX_LOCAL_MEDIA_CAPABILITIES_PER_SESSION) {
    throw new Error('本地媒体数量超过当前窗口限制')
  }

  const token = randomBytes(32).toString('base64url')
  capabilities.set(token, {
    canonicalPath: resource.canonicalPath,
    canonicalRoot: resource.canonicalRoot,
    workspaceId: resource.workspaceId,
    lifecycleEpoch: resource.lifecycleEpoch,
    kind,
    mimeType,
    expiresAt: now + LOCAL_MEDIA_CAPABILITY_TTL_MS,
  })
  return getLocalMediaCapabilityUrl(event.sender.session, token)
}

export async function revealLocalResource(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string,
  resolutionKind: LocalResourceResolutionKind,
): Promise<{ success: true }> {
  if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
    throw new Error('安全错误：本地资源请求类型无效')
  }
  const resource = await resolveAuthorizedWorkspaceResource(
    ctx,
    event,
    markdownFilePath,
    rawResourcePath,
    resolutionKind,
  )
  shell.showItemInFolder(resource.canonicalPath)
  return { success: true }
}

export async function readLocalWebVtt(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string,
  resolutionKind: LocalResourceResolutionKind,
): Promise<string> {
  if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
    throw new Error('安全错误：字幕请求类型无效')
  }
  const resource = await resolveAuthorizedWorkspaceResource(
    ctx,
    event,
    markdownFilePath,
    rawResourcePath,
    resolutionKind,
  )
  if (extensionOfResourcePath(resource.canonicalPath) !== '.vtt') {
    throw new Error('安全错误：字幕仅支持 WebVTT')
  }
  const stats = await fs.stat(resource.canonicalPath)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_LOCAL_WEBVTT_SIZE) {
    throw new Error('安全错误：字幕不存在或超过大小限制')
  }

  const bytes = await fs.readFile(resource.canonicalPath)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('安全错误：字幕必须使用 UTF-8 编码')
  }
  if (!content.replace(/^﻿/, '').startsWith('WEBVTT')) {
    throw new Error('安全错误：字幕不是有效的 WebVTT 文件')
  }
  return content
}

const attachmentOpenFlights = new Set<number>()

export function validateAttachmentReference(ref: unknown, platform: NodeJS.Platform = process.platform): asserts ref is string {
  if (typeof ref !== 'string') throw new Error('invalid-reference')
  let decoded: string
  try { decoded = decodeURIComponent(ref) } catch { throw new Error('invalid-reference') }
  if (!isSafeLocalResourceReference(decoded)) throw new Error('invalid-reference')
  if (platform === 'win32' && decoded.split(/[\\/]/).some(segment =>
    segment !== '.' && segment !== '..' && (
      /[<>:"|?*]/.test(segment) || [...segment].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(segment)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)
    ),
  )) throw new Error('invalid-reference')
}

function attachmentError(error: unknown): Extract<LocalAttachmentResult, { kind: 'error' }> {
  const message = error instanceof Error ? error.message : ''
  const code = message === 'invalid-reference' ? 'invalid-reference'
    : message === 'stale' ? 'stale'
    : message.includes('文档不属于当前窗口的工作区') ? 'owner-missing' : 'unavailable'
  return { kind: 'error', code }
}

interface AttachmentResource extends AuthorizedWorkspaceResource { ownerPrimaryRoot: string }

function assertAttachmentOwner(ctx: IPCContext, event: Electron.IpcMainInvokeEvent, resource: AuthorizedWorkspaceResource, ownerPrimaryRoot?: string): string {
  const window = ctx.windowManager.getWindowByWebContentsId(event.sender.id)
  if (event.sender.isDestroyed() || !window || window.isDestroyed()) throw new Error('stale')
  const owner = ctx.windowManager.listWorkspaces(window.id).find(workspace => workspace.id === resource.workspaceId)
  if (!owner?.primaryRoot || owner.lifecycleEpoch !== resource.lifecycleEpoch ||
    (ownerPrimaryRoot !== undefined && owner.primaryRoot !== ownerPrimaryRoot)) throw new Error('stale')
  return owner.primaryRoot
}

async function inspectAttachment(ctx: IPCContext, event: Electron.IpcMainInvokeEvent, source: string, ref: string) {
  validateAttachmentReference(ref)
  const resolved = await resolveAuthorizedWorkspaceResource(ctx, event, source, ref, 'markdown-relative')
  const resource: AttachmentResource = { ...resolved, ownerPrimaryRoot: assertAttachmentOwner(ctx, event, resolved) }
  const info = await stat(resource.canonicalPath, { bigint: true })
  assertAttachmentOwner(ctx, event, resource, resource.ownerPrimaryRoot)
  if (!info.isFile() || info.ino === 0n) throw new Error('unavailable')
  const extension = path.extname(resource.canonicalPath).toLowerCase()
  const metadata: LocalAttachment = {
    kind: 'file', name: path.basename(resource.canonicalPath),
    relativePath: path.relative(resource.canonicalRoot, resource.canonicalPath),
    extension, size: Number(info.size), revealLabel: getFileManagerLabels().showInFolder,
    canOpenExternally: canOpenAttachment(extension) && canOpenAttachment(path.extname(decodeURIComponent(ref)).toLowerCase()),
  }
  return { resource, info, metadata }
}

async function validateAttachmentSnapshot(
  ctx: IPCContext, event: Electron.IpcMainInvokeEvent, source: string, ref: string,
  original: AttachmentResource, info: BigIntStats,
): Promise<void> {
  const current = await resolveAuthorizedWorkspaceResource(ctx, event, source, ref, 'markdown-relative')
  if (current.canonicalPath !== original.canonicalPath || current.canonicalRoot !== original.canonicalRoot
    || current.workspaceId !== original.workspaceId || current.lifecycleEpoch !== original.lifecycleEpoch
    || !sameAttachmentFile(info, await stat(current.canonicalPath, { bigint: true }))) throw new Error('stale')
  assertAttachmentOwner(ctx, event, original, original.ownerPrimaryRoot)
}

export async function readLocalAttachment(
  ctx: IPCContext, event: Electron.IpcMainInvokeEvent, source: string, ref: string,
): Promise<LocalAttachmentResult> {
  try {
    const { resource, info, metadata } = await inspectAttachment(ctx, event, source, ref)
    if (!LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(metadata.extension)
      || !LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(path.extname(decodeURIComponent(ref)).toLowerCase())) {
      await validateAttachmentSnapshot(ctx, event, source, ref, resource, info)
      assertAttachmentOwner(ctx, event, resource, resource.ownerPrimaryRoot)
      return { ...metadata, notice: metadata.canOpenExternally ? undefined : 'unsupported' }
    }
    const snapshot = await readLocalTextSnapshot(resource.canonicalPath, info, () =>
      validateAttachmentSnapshot(ctx, event, source, ref, resource, info),
    )
    assertAttachmentOwner(ctx, event, resource, resource.ownerPrimaryRoot)
    return 'content' in snapshot ? { ...metadata, kind: 'text', content: snapshot.content }
      : { ...metadata, notice: snapshot.notice }
  } catch (error) { return attachmentError(error) }
}

export async function openLocalAttachment(
  ctx: IPCContext, event: Electron.IpcMainInvokeEvent, source: string, ref: string,
): Promise<LocalAttachmentOpenResult> {
  const senderId = event.sender.id
  if (attachmentOpenFlights.has(senderId)) return { success: false, code: 'busy' }
  attachmentOpenFlights.add(senderId)
  try {
    const { resource, info, metadata } = await inspectAttachment(ctx, event, source, ref)
    if (!metadata.canOpenExternally) return { success: false, code: 'unavailable' }
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent || parent.isDestroyed()) return { success: false, code: 'stale' }
    const answer = await dialog.showMessageBox(parent, {
      type: 'question', buttons: ['取消', '打开'], defaultId: 0, cancelId: 0,
      noLink: true, message: '使用系统默认应用打开此附件？',
      detail: `${metadata.name}\n将交给外部应用处理，请仅打开可信附件。`,
    })
    if (answer.response !== 1) return { success: false, cancelled: true }
    if (parent.isDestroyed()) return { success: false, code: 'stale' }
    await validateAttachmentSnapshot(ctx, event, source, ref, resource, info)
    assertAttachmentOwner(ctx, event, resource, resource.ownerPrimaryRoot)
    if (parent.isDestroyed()) return { success: false, code: 'stale' }
    const error = await shell.openPath(resource.canonicalPath)
    return error ? { success: false, code: 'unavailable' } : { success: true }
  } catch (error) { return { success: false, code: attachmentError(error).code } }
  finally { attachmentOpenFlights.delete(senderId) }
}
