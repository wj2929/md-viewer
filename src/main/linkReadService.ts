import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { shell } from 'electron'
import type { IPCContext } from './ipc/context'
import type { MainWorkspaceSession } from './windowManager'
import type { WorkspaceOperationContext } from '../shared/workspace'
import type {
  LinkedReadRequest, LinkedDocumentResult, LinkedAttachmentResult, LinkedReadActionResult,
  LinkedReadErrorCode, PreparedLinkedDocument,
} from '../shared/linkRead'
import { LOCAL_ATTACHMENT_TEXT_EXTENSIONS, MARKDOWN_EXTENSIONS, MAX_LOCAL_RESOURCE_PATH_LENGTH } from '../shared/localMedia'
import { splitMarkdownTarget } from '../shared/markdown/semantics'
import { validateNotProtected, validateSecurePathInBase } from './security'
import { isBareWikiDocumentName } from '../shared/markdown/wikiDocumentNames'
import { readFrontmatterAliases, type WorkspaceWikiSnapshot } from './indexing/wikiMetadata'
import { validateSenderReadPath } from './ipc/senderSecurity'
import { findWikiDocumentFile, resolveAuthorizedWorkspaceResource } from './localResourceResolver'
import { readLocalTextSnapshot, sameTextFile } from './localTextSnapshot'
import { canOpenAttachment, canViewUnknownAttachmentAsText } from './localAttachmentPolicy'
import { getFileManagerLabels } from './platformMenuLabels'
import { findHeadingLine } from './markdownHeadingLine'

interface ReadScope {
  senderId: number
  windowId: number
  workspaceId: string
  workspace: MainWorkspaceSession
  primaryRoot: string | null
  epoch: number
  incarnation: string
  activationGeneration: number
}

interface DocumentGrant { id: string; scope: ReadScope; canonicalPath: string }
interface ResourceHandle extends DocumentGrant { info: BigIntStats; candidatePath: string }
interface ReadRequest {
  id: string
  key: string
  scope: ReadScope
  event: Electron.IpcMainInvokeEvent
  source?: { canonicalPath: string; document?: DocumentGrant }
  cancelled: boolean
  rootOnly?: boolean
  batchId?: string
  resourceHandle?: string
  alias?: { name: string; snapshot: WorkspaceWikiSnapshot }
}
interface PreparedBatch {
  id: string
  request: ReadRequest
  candidatePath: string
  canonicalPath: string
  info: BigIntStats
  document?: DocumentGrant
  newDocument: boolean
  rootAccess: boolean
}

const readErrorCodes = new Set<LinkedReadErrorCode>([
  'invalid-reference', 'unavailable', 'stale', 'too-large', 'not-utf8', 'binary', 'explicit-path-required',
  'wiki-ambiguous', 'alias-updating', 'alias-incomplete', 'wiki-resource',
])
function codeOf(error: unknown): LinkedReadErrorCode {
  const message = error instanceof Error ? error.message : ''
  return readErrorCodes.has(message as LinkedReadErrorCode) ? message as LinkedReadErrorCode : 'unavailable'
}
function newId(): string { return randomBytes(32).toString('base64url') }

export function validateClickedFilePath(value: string, platform: NodeJS.Platform = process.platform): void {
  if (!value || value.length > MAX_LOCAL_RESOURCE_PATH_LENGTH || [...value].some(char => char.charCodeAt(0) < 32)
    || /^[\\/]{2}/.test(value)) throw new Error('invalid-reference')
  const driveAbsolute = platform === 'win32' && /^[a-z]:[\\/]/i.test(value)
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !driveAbsolute) throw new Error('invalid-reference')
  if (platform !== 'win32') return
  const local = driveAbsolute ? value.slice(3) : value
  if (local.split(/[\\/]/).some(segment => segment !== '' && segment !== '.' && segment !== '..' && (
    /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)
  ))) throw new Error('invalid-reference')
}

export class LinkReadService {
  private documents = new Map<string, DocumentGrant>()
  private resources = new Map<string, ResourceHandle>()
  private batches = new Map<string, PreparedBatch>()
  private requests = new Map<string, ReadRequest>()
  private incarnations = new WeakMap<MainWorkspaceSession, string>()

  constructor(private ctx: IPCContext) {
    ctx.windowManager.onLinkReadLifecycle((windowId, workspaceId, revoke) => {
      const belongs = (scope: ReadScope) => scope.windowId === windowId
        && (!workspaceId || scope.workspaceId === workspaceId)
      for (const request of this.requests.values()) {
        if (belongs(request.scope)) this.cancelRequest(request)
      }
      for (const [id, resource] of this.resources) if (belongs(resource.scope)) this.resources.delete(id)
      if (revoke) for (const [id, document] of this.documents) if (belongs(document.scope)) this.documents.delete(id)
    })
  }

  private scope(event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext): ReadScope {
    if (!operation || typeof operation.workspaceId !== 'string' || !operation.workspaceId
      || !Number.isInteger(operation.lifecycleEpoch)) throw new Error('invalid-reference')
    const window = this.ctx.windowManager.getWindowByWebContentsId(event.sender.id)
    if (!window || window.isDestroyed() || event.sender.isDestroyed()) throw new Error('stale')
    const workspace = this.ctx.windowManager.getWorkspace(window.id, operation.workspaceId)
    if (!workspace || workspace.lifecycleEpoch !== operation.lifecycleEpoch
      || this.ctx.windowManager.getActiveWorkspaceId(window.id) !== workspace.id) throw new Error('stale')
    let incarnation = this.incarnations.get(workspace)
    if (!incarnation) { incarnation = newId(); this.incarnations.set(workspace, incarnation) }
    return {
      senderId: event.sender.id, windowId: window.id, workspaceId: workspace.id, workspace,
      primaryRoot: workspace.primaryRoot, epoch: workspace.lifecycleEpoch, incarnation,
      activationGeneration: this.ctx.windowManager.getLinkReadActivationGeneration(window.id),
    }
  }

  private assertScope(event: Electron.IpcMainInvokeEvent, scope: ReadScope, request = false): void {
    const window = this.ctx.windowManager.getWindowByWebContentsId(event.sender.id)
    const workspace = this.ctx.windowManager.getWorkspace(scope.windowId, scope.workspaceId)
    if (event.sender.isDestroyed() || event.sender.id !== scope.senderId || !window || window.isDestroyed()
      || window.id !== scope.windowId || workspace !== scope.workspace
      || this.incarnations.get(workspace) !== scope.incarnation
      || workspace.lifecycleEpoch !== scope.epoch || workspace.primaryRoot !== scope.primaryRoot
      || this.ctx.windowManager.getActiveWorkspaceId(window.id) !== scope.workspaceId
      || (request && this.ctx.windowManager.getLinkReadActivationGeneration(window.id) !== scope.activationGeneration)) {
      throw new Error('stale')
    }
  }

  private assertRequest(request: ReadRequest): void {
    this.assertScope(request.event, request.scope, true)
    if (request.cancelled || this.requests.get(request.key) !== request) throw new Error('stale')
    if (request.alias && (!request.alias.snapshot.ready || !request.alias.snapshot.isCurrent())) throw new Error('stale')
    const source = request.source?.document
    if (source && this.documents.get(source.id) !== source) throw new Error('stale')
  }

  private begin(event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, leafId: string, requestId: string,
    keepHandle?: string): ReadRequest {
    if (typeof leafId !== 'string' || !leafId || leafId.length > 128
      || typeof requestId !== 'string' || !requestId || requestId.length > 128) throw new Error('invalid-reference')
    const scope = this.scope(event, operation)
    const key = JSON.stringify([event.sender.id, scope.workspaceId, leafId])
    const old = this.requests.get(key)
    if (old) this.cancelRequest(old, keepHandle)
    const request: ReadRequest = { id: requestId, key, scope, event, cancelled: false }
    this.requests.set(key, request)
    return request
  }

  private cancelRequest(request: ReadRequest, keepHandle?: string): void {
    request.cancelled = true
    if (request.batchId) this.batches.delete(request.batchId)
    if (request.resourceHandle && request.resourceHandle !== keepHandle) this.resources.delete(request.resourceHandle)
    if (this.requests.get(request.key) === request) this.requests.delete(request.key)
  }

  private async source(request: ReadRequest, input: LinkedReadRequest['source']): Promise<string> {
    if (!input || typeof input.filePath !== 'string' || input.filePath.length > MAX_LOCAL_RESOURCE_PATH_LENGTH) {
      throw new Error('invalid-reference')
    }
    let canonicalPath: string
    let document: DocumentGrant | undefined
    if (input.documentId !== undefined) {
      document = this.documents.get(input.documentId)
      if (!document || document.scope.senderId !== request.scope.senderId
        || document.scope.workspaceId !== request.scope.workspaceId) throw new Error('stale')
      this.assertScope(request.event, document.scope)
      canonicalPath = document.canonicalPath
      if (path.resolve(input.filePath) !== canonicalPath) throw new Error('invalid-reference')
    } else canonicalPath = await validateSenderReadPath(this.ctx, request.event, input.filePath)
    this.assertRequest(request)
    validateNotProtected(input.filePath)
    validateNotProtected(canonicalPath)
    if (await realpath(canonicalPath) !== canonicalPath || !(await stat(canonicalPath, { bigint: true })).isFile()) {
      throw new Error('stale')
    }
    request.source = { canonicalPath, document }
    this.assertRequest(request)
    return canonicalPath
  }

  private parseTarget(href: string, attachment: boolean) {
    if (typeof href !== 'string' || !href || href.length > MAX_LOCAL_RESOURCE_PATH_LENGTH * 3) {
      throw new Error('invalid-reference')
    }
    const wiki = href.startsWith('wiki:')
    let raw: string
    try { raw = wiki ? decodeURIComponent(href.slice(5)) : href }
    catch { throw new Error('invalid-reference') }
    const target = splitMarkdownTarget(raw)
    try {
      if (decodeURIComponent(target.rawPath) !== target.decodedPath) throw new Error('invalid-reference')
    } catch { throw new Error('invalid-reference') }
    if (attachment && (target.rawQuery !== undefined || target.rawAnchor !== undefined)) throw new Error('invalid-reference')
    if (target.decodedPath) validateClickedFilePath(target.decodedPath)
    else if (!wiki || !target.anchor) throw new Error('invalid-reference')
    if (target.anchor?.startsWith('^') && !/^[A-Za-z0-9-]+$/.test(target.anchor.slice(1))) throw new Error('invalid-reference')
    return { ...target, wiki }
  }

  private async resolveTarget(request: ReadRequest, input: LinkedReadRequest, attachment: boolean) {
    const sourcePath = await this.source(request, input.source)
    const target = this.parseTarget(input.href, attachment)
    let candidatePath = target.decodedPath ? path.resolve(path.dirname(sourcePath), target.decodedPath) : sourcePath
    const explicitWiki = /[\\/]/.test(target.decodedPath) || !!path.extname(target.decodedPath)
    if (target.wiki && !request.rootOnly && isBareWikiDocumentName(target.decodedPath)
      && (!attachment || !!path.extname(target.decodedPath))) {
      if (request.source?.document || !request.scope.primaryRoot) throw new Error('explicit-path-required')
      const root = await realpath(request.scope.primaryRoot)
      try { await validateSecurePathInBase(sourcePath, root) }
      catch { throw new Error('explicit-path-required') }
      this.assertRequest(request)
      const file = await findWikiDocumentFile(root, sourcePath, target.decodedPath)
      this.assertRequest(request)
      if (file.status === 'found') {
        candidatePath = file.candidatePath ?? file.canonicalPath
        const markdown = MARKDOWN_EXTENSIONS.has(path.extname(candidatePath).toLowerCase())
          && MARKDOWN_EXTENSIONS.has(path.extname(file.canonicalPath).toLowerCase())
        if (!attachment && !markdown) throw new Error(MARKDOWN_EXTENSIONS.has(path.extname(candidatePath).toLowerCase()) ? 'invalid-reference' : 'wiki-resource')
        if (attachment && markdown) throw new Error('stale')
      } else if (file.status === 'missing') {
        if (attachment) throw new Error('unavailable')
        const snapshot = this.ctx.workspaceIndexService?.getWikiSnapshot(root)
        if (!snapshot || !snapshot.ready) {
          throw new Error(!snapshot || snapshot.complete ? 'alias-updating' : 'alias-incomplete')
        }
        if (!snapshot.isCurrent()) throw new Error('stale')
        const matches = snapshot.aliases.get(target.decodedPath)
        if (!matches?.size) throw new Error('unavailable')
        if (matches.size > 1) throw new Error('wiki-ambiguous')
        candidatePath = await validateSecurePathInBase(path.join(root, [...matches][0]), root)
        request.alias = { name: target.decodedPath, snapshot }
        this.assertRequest(request)
      } else throw new Error(file.status === 'ambiguous' ? 'wiki-ambiguous' : 'unavailable')
    } else if (target.wiki && target.decodedPath && !explicitWiki) {
      if (request.source?.document) throw new Error('explicit-path-required')
      const resolved = await resolveAuthorizedWorkspaceResource(this.ctx, request.event, sourcePath,
        encodeURI(target.decodedPath).replace(/[?#]/g, character => encodeURIComponent(character)), 'workspace-wiki', { allowExtensionlessMarkdown: true })
      this.assertRequest(request)
      candidatePath = resolved.canonicalPath
    } else if (target.wiki && !attachment && target.decodedPath && !path.extname(candidatePath)) {
      let found: string | undefined
      for (const extension of MARKDOWN_EXTENSIONS) {
        const candidate = `${candidatePath}${extension}`
        validateNotProtected(candidate)
        try { if ((await stat(candidate)).isFile()) { found = candidate; break } } catch { /* Try the named suffix only. */ }
        this.assertRequest(request)
      }
      if (!found) throw new Error('unavailable')
      candidatePath = found
    }
    validateNotProtected(candidatePath)
    const canonicalPath = await realpath(candidatePath)
    validateNotProtected(canonicalPath)
    const info = await stat(canonicalPath, { bigint: true })
    this.assertRequest(request)
    if (!info.isFile() || info.ino === 0n) throw new Error('unavailable')
    if (!attachment && (!MARKDOWN_EXTENSIONS.has(path.extname(candidatePath).toLowerCase())
      || !MARKDOWN_EXTENSIONS.has(path.extname(canonicalPath).toLowerCase()))) throw new Error('invalid-reference')
    return { candidatePath, canonicalPath, info, headingId: target.anchor }
  }

  private async validateSnapshot(request: ReadRequest, candidatePath: string, canonicalPath: string, info: BigIntStats,
    requireRoot = request.rootOnly): Promise<void> {
    this.assertRequest(request)
    validateNotProtected(candidatePath)
    validateNotProtected(canonicalPath)
    if (request.source && !request.source.document
      && await validateSenderReadPath(this.ctx, request.event, request.source.canonicalPath) !== request.source.canonicalPath) {
      throw new Error('stale')
    }
    if (requireRoot && !(await this.hasRootAccess(request, canonicalPath))) throw new Error('unavailable')
    if (await realpath(candidatePath) !== canonicalPath || await realpath(canonicalPath) !== canonicalPath) throw new Error('stale')
    if (!sameTextFile(info, await stat(canonicalPath, { bigint: true }))) throw new Error('stale')
    this.assertRequest(request)
  }

  private async hasRootAccess(request: ReadRequest, canonicalPath: string): Promise<boolean> {
    try {
      const resolved = await validateSenderReadPath(this.ctx, request.event, canonicalPath)
      this.assertRequest(request)
      return resolved === canonicalPath
    } catch {
      this.assertRequest(request)
      return false
    }
  }

  private async prepareSnapshot(request: ReadRequest, candidatePath: string, canonicalPath: string, info: BigIntStats,
    document?: DocumentGrant, headingId?: string): Promise<PreparedLinkedDocument> {
    if (request.rootOnly && !(await this.hasRootAccess(request, canonicalPath))) throw new Error('unavailable')
    const snapshot = await readLocalTextSnapshot(canonicalPath, info, () =>
      this.validateSnapshot(request, candidatePath, canonicalPath, info))
    this.assertRequest(request)
    if ('notice' in snapshot) throw new Error(snapshot.notice)
    if (request.alias) {
      const aliases = readFrontmatterAliases(snapshot.content)
      if (!aliases.complete || !aliases.aliases.includes(request.alias.name)) throw new Error('stale')
    }
    const rootAccess = document ? false : await this.hasRootAccess(request, canonicalPath)
    this.assertRequest(request)
    if (request.rootOnly && !rootAccess) throw new Error('unavailable')
    await this.validateSnapshot(request, candidatePath, canonicalPath, info, request.rootOnly || rootAccess)
    const newDocument = !document && !rootAccess
    const grant = document ?? (newDocument ? { id: newId(), scope: request.scope, canonicalPath } : undefined)
    const batch: PreparedBatch = {
      id: newId(), request, candidatePath, canonicalPath, info, document: grant, newDocument, rootAccess,
    }
    this.batches.set(batch.id, batch)
    request.batchId = batch.id
    return {
      success: true, targetPath: canonicalPath, content: snapshot.content, batchId: batch.id,
      access: rootAccess ? 'root' : 'linked-readonly', ...(grant ? { documentId: grant.id } : {}),
      ...(headingId?.startsWith('^') ? { blockId: headingId.slice(1) }
        : headingId ? { headingId, targetLine: findHeadingLine(snapshot.content, headingId) } : {}),
    }
  }

  async prepareDocument(event: Electron.IpcMainInvokeEvent, input: LinkedReadRequest): Promise<LinkedDocumentResult> {
    let request: ReadRequest | undefined
    try {
      request = this.begin(event, input.operation, input.leafId, input.requestId)
      request.rootOnly = input.rootOnly === true
      const target = await this.resolveTarget(request, input, false)
      return await this.prepareSnapshot(request, target.candidatePath, target.canonicalPath, target.info, undefined, target.headingId)
    } catch (error) {
      if (request) this.cancelRequest(request)
      return { success: false, code: codeOf(error) }
    }
  }

  async prepareDocumentRefresh(event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext,
    documentId: string, leafId: string, requestId: string): Promise<LinkedDocumentResult> {
    let request: ReadRequest | undefined
    try {
      request = this.begin(event, operation, leafId, requestId)
      const document = this.documents.get(documentId)
      if (!document || document.scope.senderId !== event.sender.id || document.scope.workspaceId !== operation.workspaceId) {
        throw new Error('stale')
      }
      this.assertScope(event, document.scope)
      request.source = { canonicalPath: document.canonicalPath, document }
      validateNotProtected(document.canonicalPath)
      if (await realpath(document.canonicalPath) !== document.canonicalPath) throw new Error('stale')
      const info = await stat(document.canonicalPath, { bigint: true })
      this.assertRequest(request)
      return await this.prepareSnapshot(request, document.canonicalPath, document.canonicalPath, info, document)
    } catch (error) {
      if (request) this.cancelRequest(request)
      return { success: false, code: codeOf(error) }
    }
  }

  async commitDocument(event: Electron.IpcMainInvokeEvent, batchId: string): Promise<LinkedReadActionResult> {
    const batch = this.batches.get(batchId)
    try {
      if (!batch || batch.request.scope.senderId !== event.sender.id) throw new Error('stale')
      await this.validateSnapshot(batch.request, batch.candidatePath, batch.canonicalPath, batch.info,
        batch.request.rootOnly || batch.rootAccess)
      this.assertRequest(batch.request)
      if (batch.document) this.documents.set(batch.document.id, batch.document)
      this.batches.delete(batchId)
      if (this.requests.get(batch.request.key) === batch.request) this.requests.delete(batch.request.key)
      return { success: true }
    } catch (error) {
      if (batch && batch.request.scope.senderId === event.sender.id) this.cancelRequest(batch.request)
      return { success: false, code: codeOf(error) }
    }
  }

  async readAttachment(event: Electron.IpcMainInvokeEvent, input: LinkedReadRequest, asText = false,
    previousHandle?: string): Promise<LinkedAttachmentResult> {
    let request: ReadRequest | undefined
    try {
      const previous = previousHandle ? this.resources.get(previousHandle) : undefined
      if (asText && (!previous || previous.scope.senderId !== event.sender.id
        || previous.scope.workspaceId !== input.operation.workspaceId)) throw new Error('stale')
      if (previous) this.assertScope(event, previous.scope)
      request = this.begin(event, input.operation, input.leafId, input.requestId, previousHandle)
      const target = await this.resolveTarget(request, input, true)
      if (previous && (previous.canonicalPath !== target.canonicalPath || previous.candidatePath !== target.candidatePath)) {
        throw new Error('stale')
      }
      const extension = path.extname(target.canonicalPath).toLowerCase()
      const requestedExtension = path.extname(target.candidatePath).toLowerCase()
      const automatic = LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(extension) && LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(requestedExtension)
      const canViewAsText = !automatic
        && (LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(extension) || canViewUnknownAttachmentAsText(extension))
        && (LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(requestedExtension) || canViewUnknownAttachmentAsText(requestedExtension))
      if (asText && !canViewAsText) throw new Error('invalid-reference')
      let canOpenExternally = false
      const systemOpenRef = encodeURI(this.parseTarget(input.href, true).decodedPath).replace(/[?#]/g, character => encodeURIComponent(character))
      if (canOpenAttachment(extension) && canOpenAttachment(requestedExtension) && !input.source.documentId) {
        try {
          const resolved = await resolveAuthorizedWorkspaceResource(this.ctx, event, request.source!.canonicalPath,
            systemOpenRef, 'markdown-relative')
          canOpenExternally = resolved.canonicalPath === target.canonicalPath
        } catch { /* Reading a file does not grant the old system-open capability. */ }
      }
      this.assertRequest(request)
      const snapshot = automatic || asText ? await readLocalTextSnapshot(target.canonicalPath, target.info,
        () => this.validateSnapshot(request!, target.candidatePath, target.canonicalPath, target.info)) : undefined
      await this.validateSnapshot(request, target.candidatePath, target.canonicalPath, target.info)
      this.assertRequest(request)
      if (previous && this.resources.get(previous.id) !== previous) throw new Error('stale')
      const handle: ResourceHandle = {
        id: newId(), scope: request.scope, canonicalPath: target.canonicalPath, info: target.info, candidatePath: target.candidatePath,
      }
      this.resources.set(handle.id, handle)
      request.resourceHandle = handle.id
      if (previous) this.resources.delete(previous.id)
      const metadata = {
        name: path.basename(target.canonicalPath), relativePath: path.relative(path.dirname(request.source!.canonicalPath), target.canonicalPath),
        extension, size: Number(target.info.size), revealLabel: getFileManagerLabels().showInFolder,
        canOpenExternally, ...(canOpenExternally ? { systemOpenRef } : {}),
        canViewAsText: !automatic && !asText && canViewAsText, resourceHandle: handle.id,
      }
      if (snapshot && 'content' in snapshot) return { ...metadata, kind: 'text', content: snapshot.content }
      return { ...metadata, kind: 'file', notice: snapshot && 'notice' in snapshot ? snapshot.notice : 'unsupported' }
    } catch (error) {
      if (request) this.cancelRequest(request)
      return { kind: 'error', code: codeOf(error) === 'invalid-reference' ? 'invalid-reference'
        : codeOf(error) === 'stale' ? 'stale' : 'unavailable' }
    }
  }

  async revealResource(event: Electron.IpcMainInvokeEvent, id: string): Promise<LinkedReadActionResult> {
    try {
      const resource = this.resources.get(id)
      const document = this.documents.get(id)
      const entry = resource ?? document
      if (!entry) throw new Error('stale')
      const scope = this.scope(event, { workspaceId: entry.scope.workspaceId, lifecycleEpoch: entry.scope.epoch })
      this.assertScope(event, entry.scope)
      validateNotProtected(entry.canonicalPath)
      if (await realpath(resource?.candidatePath ?? entry.canonicalPath) !== entry.canonicalPath
        || await realpath(entry.canonicalPath) !== entry.canonicalPath) throw new Error('stale')
      const info = await stat(entry.canonicalPath, { bigint: true })
      if (!info.isFile() || info.ino === 0n || (resource && !sameTextFile(resource.info, info))) throw new Error('stale')
      this.assertScope(event, scope, true)
      this.assertScope(event, entry.scope)
      if ((resource && this.resources.get(id) !== resource) || (document && this.documents.get(id) !== document)) {
        throw new Error('stale')
      }
      shell.showItemInFolder(entry.canonicalPath)
      return { success: true }
    } catch (error) { return { success: false, code: codeOf(error) } }
  }

  cancel(event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, leafId: string, requestId: string): void {
    const key = JSON.stringify([event.sender.id, operation?.workspaceId, leafId])
    const request = this.requests.get(key)
    if (request?.id === requestId) this.cancelRequest(request)
  }

  release(event: Electron.IpcMainInvokeEvent, ids: string[]): void {
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      const document = this.documents.get(id)
      if (document?.scope.senderId === event.sender.id) {
        for (const request of this.requests.values()) if (request.source?.document === document) this.cancelRequest(request)
        this.documents.delete(id)
      }
      const resource = this.resources.get(id)
      if (resource?.scope.senderId === event.sender.id) this.resources.delete(id)
      const batch = this.batches.get(id)
      if (batch?.request.scope.senderId === event.sender.id) this.cancelRequest(batch.request)
    }
  }
}
