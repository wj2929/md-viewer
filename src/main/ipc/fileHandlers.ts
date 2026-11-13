import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import { createHash, randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import { createCrossRootMoveImpactReport } from '../linking/CrossRootLinkImpactPlanner'
import type { CrossRootMoveMapping } from '../../shared/crossRootMoveImpact'
import { hasIgnoredPathSegment, isWatchPathSafe, workspaceWatchService } from '../watching/WorkspaceWatchService'
import { IPCContext } from './context'
import { validateNotProtected, validateSecurePathInBase } from '../security'
import { isClipboardSourceAuthorized } from '../clipboardState'
import { activateFolderForWindow } from '../folderActivation'
import {
  getSenderWorkspace,
  getSenderWorkspaceForOperation,
  validateSenderReadPath,
  validateWorkspaceOperationPath,
  validateWorkspaceWritePath,
} from './senderSecurity'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import { IMAGE_MIME_TYPES, type LocalResourceResolutionKind } from '../../shared/localMedia'
import { resolveAuthorizedWorkspaceResource } from '../localResourceResolver'
import { sanitizeDiagnosticTraceContext, type DiagnosticMetadata } from '../../shared/diagnostics'
import { WatchReconcileSupersededError } from '../../shared/workspaceWatch'
import { registerFileTreeSortHandlers } from './fileTreeSortHandlers'

// 文件信息接口
interface FileInfo {
  name: string
  path: string
  treePath: string
  isDirectory: boolean
  children?: FileInfo[]
}

// ============== 文件监听器状态 ==============

const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])
const MAX_LOCAL_ASSET_SIZE = 10 * 1024 * 1024
const DUPLICATE_SUFFIX_PATTERN = / - 副本(?: [1-9]\d*)?$/

function diagnosticFileSizeBucket(bytes: number): string {
  if (bytes < 4 * 1024) return '0-4KiB'
  if (bytes < 16 * 1024) return '4-16KiB'
  if (bytes < 64 * 1024) return '16-64KiB'
  if (bytes < 256 * 1024) return '64-256KiB'
  if (bytes < 1024 * 1024) return '256KiB-1MiB'
  if (bytes <= 5 * 1024 * 1024) return '1-5MiB'
  return '5MiB+'
}

async function validateClipboardSourceOrWorkspaceRoot(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  operation: WorkspaceOperationContext
): Promise<string> {
  const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
  if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
  try {
    return await validateSecurePathInBase(sourcePath, workspace.primaryRoot)
  } catch {
    if (!isClipboardSourceAuthorized(event.sender.id, sourcePath)) {
      throw new Error('安全错误：源路径不在当前工作区且未被复制授权')
    }
    const sourceStats = await fs.lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) throw new Error('安全错误：不支持通过符号链接复制或移动')
    const resolvedSource = await fs.realpath(sourcePath)
    validateNotProtected(resolvedSource)
    return resolvedSource
  }
}

export async function broadcastDocumentMarksChanged(ctx: IPCContext, senderId?: number): Promise<void> {
  const senderWindow = senderId === undefined ? null : BrowserWindow.fromId(senderId)
  if (senderWindow) {
    ctx.windowManager.broadcastToOthers(senderWindow.id, 'document-marks:changed')
    senderWindow.webContents.send('document-marks:changed')
    return
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('document-marks:changed')
  }
}

function toStrictRelativePath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) throw new Error('安全错误：路径不在指定根目录内')
  return relativePath.split(path.sep).join('/')
}

function isSameOrChildPath(targetPath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    !path.isAbsolute(relativePath)
  )
}

async function rejectDirectorySymbolicLinks(directoryPath: string): Promise<void> {
  for (const entry of await fs.readdir(directoryPath)) {
    const entryPath = path.join(directoryPath, entry)
    const entryStats = await fs.lstat(entryPath)
    if (entryStats.isSymbolicLink()) {
      throw new Error('安全错误：不支持复制或移动包含符号链接的目录')
    }
    if (entryStats.isDirectory()) {
      await rejectDirectorySymbolicLinks(entryPath)
    }
  }
}

function getDuplicateName(sourceName: string, isDirectory: boolean, copyIndex: number): string {
  const suffix = copyIndex === 1 ? ' - 副本' : ` - 副本 ${copyIndex}`
  if (isDirectory) {
    return `${sourceName.replace(DUPLICATE_SUFFIX_PATTERN, '')}${suffix}`
  }

  const extension = path.extname(sourceName)
  const isDotfile = sourceName.startsWith('.') && sourceName.lastIndexOf('.') === 0
  const baseName = (extension && !isDotfile ? sourceName.slice(0, -extension.length) : sourceName)
    .replace(DUPLICATE_SUFFIX_PATTERN, '')
  return `${baseName}${suffix}${extension && !isDotfile ? extension : ''}`
}

async function duplicatePath(
  sourcePath: string,
  basePath: string
): Promise<{ sourcePath: string; newPath: string; isDirectory: boolean }> {
  const resolvedSource = await validateSecurePathInBase(sourcePath, basePath)
  const parentPath = path.dirname(resolvedSource)
  await validateSecurePathInBase(parentPath, basePath)

  const sourceStats = await fs.lstat(resolvedSource)
  if (sourceStats.isSymbolicLink() || (!sourceStats.isFile() && !sourceStats.isDirectory())) {
    throw new Error('仅支持复制普通文件或目录')
  }

  const sourceName = path.basename(sourcePath)
  for (let copyIndex = 1; ; copyIndex++) {
    const targetPath = path.join(parentPath, getDuplicateName(sourceName, sourceStats.isDirectory(), copyIndex))
    await validateSecurePathInBase(targetPath, basePath)

    if (await fs.pathExists(targetPath)) continue

    try {
      await fs.copy(resolvedSource, targetPath, { overwrite: false, errorOnExist: true, dereference: false })
      return { sourcePath: resolvedSource, newPath: targetPath, isDirectory: sourceStats.isDirectory() }
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code
      const errorMessage = error instanceof Error ? error.message : ''
      if (errorCode === 'EEXIST' || /already exists|已存在/i.test(errorMessage)) continue
      throw error
    }
  }
}

interface EditableFileGrant {
  workspaceId: string
  lifecycleEpoch: number
}

const windowEditableFiles = new Map<number, Map<string, EditableFileGrant>>()
let testEditableSaveDelayMs = 0

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
}

function buildRevisionToken(stats: fs.Stats, content?: string): string {
  const baseToken = `${stats.mtimeMs}:${stats.size}`
  return content === undefined ? baseToken : `${baseToken}:${hashContent(content)}`
}

function stripUrlSuffix(refPath: string): string {
  return refPath.split('#')[0].split('?')[0]
}

function resolveMarkdownRelativePath(markdownFilePath: string, refPath: string): string {
  const cleanRefPath = stripUrlSuffix(refPath)
  const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(cleanRefPath)
  const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(cleanRefPath)
  if (hasUrlScheme && !isWindowsAbsolutePath) {
    throw new Error('不支持读取 URL 资源')
  }
  if (/^(?:[a-z]:[\\/]|[/\\])/i.test(cleanRefPath)) {
    return path.normalize(cleanRefPath)
  }
  return path.normalize(path.join(path.dirname(markdownFilePath), cleanRefPath))
}

function parseRevisionToken(token: string): { mtimeMs: string; size: string; hash?: string } {
  const [mtimeMs = '', size = '', hash] = token.split(':')
  return { mtimeMs, size, hash }
}

function revisionTokenMatches(expectedRevisionToken: string, diskRevisionToken: string): boolean {
  if (expectedRevisionToken === diskRevisionToken) return true
  const expected = parseRevisionToken(expectedRevisionToken)
  const disk = parseRevisionToken(diskRevisionToken)
  if (!expected.hash && expected.mtimeMs === disk.mtimeMs && expected.size === disk.size) return true
  return Boolean(expected.hash && disk.hash && expected.hash === disk.hash)
}

type WorkspaceWatchContext = import('../watching/WorkspaceWatchService').WorkspaceWatchContext

const watcherSubscriptions = new Map<string, import('../watching/WorkspaceWatchService').WorkspaceWatchSubscription>()

function getWorkspaceWatcherKey(webContentsId: number, workspaceId: string): string {
  return `${webContentsId}:${workspaceId}`
}

const watchReconciliations = new Map<string, {
  key: string
  epoch: number
  senderId: number
  isCurrent: () => boolean
  resolve: () => void
  reject: (result?: 'superseded' | 'failed') => void
  timer: ReturnType<typeof setTimeout>
}>()

function cancelWatchReconciliations(key: string, epoch?: number): void {
  for (const [id, pending] of watchReconciliations) {
    if (pending.key !== key || (epoch !== undefined && pending.epoch !== epoch)) continue
    clearTimeout(pending.timer)
    watchReconciliations.delete(id)
    pending.reject('superseded')
  }
}

function createWatcherSubscription(
  ctx: IPCContext,
  sender: Electron.WebContents,
  context: WorkspaceWatchContext,
): import('../watching/WorkspaceWatchService').WorkspaceWatchSubscription {
  const key = getWorkspaceWatcherKey(sender.id, context.workspaceId)
  const previous = watcherSubscriptions.get(key)
  if (previous && previous.lifecycleEpoch === context.lifecycleEpoch && previous.primaryRoot === context.primaryRoot) return previous
  cancelWatchReconciliations(key)
  const isCurrent = (): boolean => {
    if (sender.isDestroyed()) return false
    if (!context.strict) return watcherSubscriptions.get(key) === subscription
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return false
    const workspace = ctx.windowManager.getWorkspace(window.id, context.workspaceId)
    return Boolean(workspace && workspace.lifecycleEpoch === context.lifecycleEpoch && workspace.primaryRoot === context.primaryRoot &&
      watcherSubscriptions.get(key) === subscription)
  }
  const inFlight = new Map<string, Promise<void>>()
  const followUp = new Map<string, Promise<void>>()
  const subscription: import('../watching/WorkspaceWatchService').WorkspaceWatchSubscription = {
    key,
    ...context,
    isCurrent,
    deliver: (channel, event) => { if (isCurrent()) sender.send(channel, event) },
    onHealth: status => {
      if (isCurrent()) sender.send('watch:status', { workspaceId: context.workspaceId, lifecycleEpoch: context.lifecycleEpoch, status })
    },
    reconcile: phase => {
      if (!isCurrent()) return Promise.reject(new WatchReconcileSupersededError())
      const existing = inFlight.get(phase)
      if (existing) {
        let trailing = followUp.get(phase)
        if (!trailing) {
          trailing = existing.catch(() => {}).then(() => {
            followUp.delete(phase)
            return subscription.reconcile!(phase)
          })
          followUp.set(phase, trailing)
        }
        return trailing
      }
      if (watchReconciliations.size >= 256) return Promise.reject(new Error('监听补查请求已达上限'))
      const requestId = randomUUID()
      const promise = new Promise<void>((resolve, reject) => {
        const fail = (result: 'superseded' | 'failed' = 'failed'): void => {
          watchReconciliations.delete(requestId)
          reject(result === 'superseded' ? new WatchReconcileSupersededError() : new Error('文档变更补查未完成'))
        }
        const timer = setTimeout(fail, 30000)
        watchReconciliations.set(requestId, { key, epoch: context.lifecycleEpoch, senderId: sender.id, isCurrent, resolve, reject: fail, timer })
        sender.send('watch:reconcile', { workspaceId: context.workspaceId, lifecycleEpoch: context.lifecycleEpoch, requestId, phase })
      }).finally(() => { if (inFlight.get(phase) === promise) inFlight.delete(phase) })
      inFlight.set(phase, promise)
      return promise
    },
    onFolderRemoved: (rootPath, removedPath) => {
      const changed = ctx.appDataManager?.removeDocumentMarks(rootPath, removedPath, true)
      if (changed) void broadcastDocumentMarksChanged(ctx)
    },
  }
  watcherSubscriptions.set(key, subscription)
  return subscription
}

function captureWatchAccess(senderId: number): ((canonicalPath: string) => void) | undefined {
  const accesses = [...watcherSubscriptions.values()]
    .filter(subscription => subscription.key.startsWith(`${senderId}:`))
    .map(subscription => workspaceWatchService.captureAccess(subscription))
  return accesses.length ? canonicalPath => { for (const accessed of accesses) accessed(canonicalPath) } : undefined
}

function cleanupWorkspaceWatchers(webContentsId: number, workspaceId?: string, epoch?: number): void {
  const key = workspaceId ? getWorkspaceWatcherKey(webContentsId, workspaceId) : null
  workspaceWatchService.cleanupWebContents(webContentsId, workspaceId, epoch)
  for (const [candidate, subscription] of watcherSubscriptions) {
    if (!candidate.startsWith(`${webContentsId}:`) || (key && candidate !== key) ||
      (epoch !== undefined && subscription.lifecycleEpoch !== epoch)) continue
    cancelWatchReconciliations(candidate, epoch)
    watcherSubscriptions.delete(candidate)
  }
}

interface PreviewScanResult {
  tree: FileInfo[]
  globMs: number
  treeBuildMs: number
  sortMs: number
  matchedFileCount: number
  matchedDirectoryCount: number
}

interface PreviewScanWork {
  promise: Promise<PreviewScanResult>
  workId: string
}

const previewScanInFlight = new Map<string, PreviewScanWork>()

// 使用 glob 快速扫描可预览文件
async function scanPreviewableFiles(rootPath: string): Promise<PreviewScanResult> {
  const { glob } = await import('glob')
  const globStarted = performance.now()
  const previewFiles = await glob('**/*.{md,markdown,mdown,mkd,mkdn,excalidraw}', {
    cwd: rootPath,
    ignore: ['**/node_modules/**', '**/.*/**', '**/venv/**', '**/.venv/**', '**/env/**'],
    nodir: true,
    absolute: false,
    nocase: true
  })
  const globMs = performance.now() - globStarted
  const built = buildFileTree(rootPath, previewFiles)
  return {
    ...built,
    globMs,
    matchedFileCount: previewFiles.length,
  }
}

function scanPreviewableFilesSingleFlight(rootPath: string): {
  promise: Promise<PreviewScanResult>
  workId: string
  joinedSingleFlight: boolean
} {
  const existing = previewScanInFlight.get(rootPath)
  if (existing) return { ...existing, joinedSingleFlight: true }

  const workId = `scan_${randomUUID()}`
  let promise: Promise<PreviewScanResult>
  promise = scanPreviewableFiles(rootPath).finally(() => {
    if (previewScanInFlight.get(rootPath)?.promise === promise) previewScanInFlight.delete(rootPath)
  })
  previewScanInFlight.set(rootPath, { promise, workId })
  return { promise, workId, joinedSingleFlight: false }
}

// 从 glob 结果构建文件树
function buildFileTree(rootPath: string, relativePaths: string[]): {
  tree: FileInfo[]
  treeBuildMs: number
  sortMs: number
  matchedDirectoryCount: number
} {
  const started = performance.now()
  const tree: FileInfo[] = []
  const dirMap = new Map<string, FileInfo>()

  for (const relativePath of relativePaths) {
    const parts = relativePath.split(/[\\/]/)
    const fileName = parts.pop()!
    const fullPath = path.join(rootPath, relativePath)
    const fileTreePath = relativePath.split(/[\\/]/).join('/')

    if (parts.length === 0) {
      tree.push({
        name: fileName,
        path: fullPath,
        treePath: fileTreePath,
        isDirectory: false
      })
    } else {
      let currentPath = ''
      let parent: FileInfo[] = tree

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        currentPath = currentPath ? `${currentPath}/${part}` : part
        const dirFullPath = path.join(rootPath, currentPath)

        let dir = dirMap.get(currentPath)
        if (!dir) {
          dir = {
            name: part,
            path: dirFullPath,
            treePath: currentPath,
            isDirectory: true,
            children: []
          }
          dirMap.set(currentPath, dir)
          parent.push(dir)
        }
        parent = dir.children!
      }

      parent.push({
        name: fileName,
        path: fullPath,
        treePath: fileTreePath,
        isDirectory: false
      })
    }
  }

  function sortTree(items: FileInfo[]): FileInfo[] {
    return items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    }).map(item => {
      if (item.isDirectory && item.children) {
        item.children = sortTree(item.children)
      }
      return item
    })
  }

  const treeBuildMs = performance.now() - started
  const sortStarted = performance.now()
  const sortedTree = sortTree(tree)
  return {
    tree: sortedTree,
    treeBuildMs,
    sortMs: performance.now() - sortStarted,
    matchedDirectoryCount: dirMap.size,
  }
}

export { hasIgnoredPathSegment } from '../watching/WorkspaceWatchService'

// 导出文件监听器状态，供 index.ts 窗口关闭清理使用
export function getFileWatcherState() {
  return {
    cleanup: (webContentsId: number) => {
      cleanupWorkspaceWatchers(webContentsId)
    }
  }
}

export function registerFileHandlers(ctx: IPCContext): void {
  registerFileTreeSortHandlers(ctx)
  if (process.env.NODE_ENV === 'test') {
    ipcMain.handle('test:openMarkdownFile', async (event, filePath: string) => {
      const resolvedPath = path.resolve(filePath)
      const folderPath = path.dirname(resolvedPath)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        await activateFolderForWindow(ctx, win, folderPath, {
          notifyRenderer: true,
          initialFilePath: resolvedPath,
          diagnosticSource: 'open-specific-file',
        })
      }
      return true
    })
    ipcMain.handle('test:setEditableSaveDelay', (_event, delayMs: number) => {
      testEditableSaveDelayMs = Number.isFinite(delayMs)
        ? Math.max(0, Math.min(5000, Math.floor(delayMs)))
        : 0
      return true
    })
    ipcMain.handle('test:getOpenedFileWatcherCount', (event, workspaceId: string) => {
      const key = getWorkspaceWatcherKey(event.sender.id, workspaceId)
      return workspaceWatchService.getOpenedFileCount(key)
    })
  }

  // 打开文件夹对话框
  ipcMain.handle('dialog:openFolder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法识别当前窗口')
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return activateFolderForWindow(ctx, window, result.filePaths[0], {
      diagnosticSource: 'user',
    })
  })

  // 读取目录
  ipcMain.handle('fs:readDir', async (event, dirPath: string, rawTrace?: unknown) => {
    const started = performance.now()
    const requestId = `scan_request_${randomUUID()}`
    const trace = sanitizeDiagnosticTraceContext(rawTrace)
    let operationId: string | undefined
    let source = 'unknown'
    let resolvedDirectory: string | null = null
    let workId: string | undefined
    const accessed = captureWatchAccess(event.sender.id)
    try {
      resolvedDirectory = await validateSenderReadPath(ctx, event, dirPath)
      const registeredOperation = trace && ctx.diagnosticEventLogService?.isRegisteredOperation(
        event.sender.id,
        trace.operationId,
        'folder',
        resolvedDirectory,
      )
        ? { operationId: trace.operationId, source: trace.source }
        : ctx.diagnosticEventLogService?.findRegisteredOperation(
            event.sender.id,
            'folder',
            resolvedDirectory,
          )
      operationId = registeredOperation?.operationId
      source = registeredOperation?.source ?? 'unknown'
      const scan = scanPreviewableFilesSingleFlight(resolvedDirectory)
      workId = scan.workId
      const result = await scan.promise
      // glob can silently return [] for an unreadable root; an empty result is not access proof.
      if (accessed && result.matchedFileCount === 0) await fs.readdir(resolvedDirectory)
      accessed?.(resolvedDirectory)
      const durationMs = performance.now() - started
      ctx.diagnosticEventLogService?.recordMainEvent({
        event: 'folder.scan.summary',
        ...(operationId ? { operationId } : {}),
        rawWorkspacePath: resolvedDirectory,
        outcome: 'success',
        metadata: {
          source,
          requestId,
          workId,
          joinedSingleFlight: scan.joinedSingleFlight,
          durationMs,
          globMs: result.globMs,
          treeBuildMs: result.treeBuildMs,
          sortMs: result.sortMs,
          matchedFileCount: result.matchedFileCount,
          matchedDirectoryCount: result.matchedDirectoryCount,
          rootNodeCount: result.tree.length,
        },
      })
      if (operationId) {
        ctx.diagnosticEventLogService?.completeRegisteredOperation(event.sender.id, operationId)
      }
      console.log(`[MAIN] Scanned ${dirPath} in ${Math.round(durationMs)}ms, found ${result.matchedFileCount} previewable files`)
      return result.tree
    } catch (error) {
      ctx.diagnosticEventLogService?.recordMainEvent({
        event: 'folder.scan.summary',
        ...(operationId ? { operationId } : {}),
        rawWorkspacePath: resolvedDirectory ?? dirPath,
        outcome: 'error',
        metadata: {
          source,
          requestId,
          ...(workId ? { workId } : {}),
          durationMs: performance.now() - started,
          errorCode: 'DIRECTORY_SCAN_FAILED',
        },
        priority: 'critical',
      })
      if (operationId) {
        ctx.diagnosticEventLogService?.completeRegisteredOperation(event.sender.id, operationId)
      }
      console.error('Failed to read directory:', error)
      if (error instanceof Error && error.message.includes('安全错误')) {
        throw error
      }
      return []
    }
  })

  // 只列出某目录的「直接子目录」（懒加载，供跨根移动的目标子目录树逐层下钻）。
  // 读类操作走读放宽校验；返回全部子目录（含无 md 的目录），与 fs:readDir 的
  // 「只反推含 md 的目录」不同——移动目标可能是任意目录。跳过符号链接目录。
  ipcMain.handle('fs:listChildDirs', async (event, dirPath: string) => {
    try {
      const resolvedDirectory = await validateSenderReadPath(ctx, event, dirPath)
      const entries = await fs.readdir(resolvedDirectory, { withFileTypes: true })
      const dirs: Array<{ name: string; path: string }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        if (hasIgnoredPathSegment(path.join(resolvedDirectory, entry.name), resolvedDirectory)) continue
        dirs.push({ name: entry.name, path: path.join(resolvedDirectory, entry.name) })
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name))
      return dirs
    } catch (error) {
      console.error('Failed to list child directories:', error)
      if (error instanceof Error && error.message.includes('安全错误')) {
        throw error
      }
      return []
    }
  })

  // 读取文件内容
  ipcMain.handle('fs:readFile', async (event, filePath: string, rawTrace?: unknown) => {
    const handlerStarted = performance.now()
    const trace = sanitizeDiagnosticTraceContext(rawTrace)
    const operationId = trace?.operationId ?? `file_${randomUUID()}`
    const source = trace?.source ?? 'unknown'
    let resolvedFilePath: string | null = null
    let authorizationMs = 0
    let statMs = 0
    let readWallMs = 0
    let fileSize = 0
    let phase: 'authorization' | 'stat' | 'read' | 'size' = 'authorization'
    const accessed = captureWatchAccess(event.sender.id)
    if (trace) ctx.diagnosticEventLogService?.registerOperation(event.sender.id, operationId)

    try {
      const authorizationStarted = performance.now()
      resolvedFilePath = await validateSenderReadPath(ctx, event, filePath)
      authorizationMs = performance.now() - authorizationStarted

      phase = 'stat'
      const statStarted = performance.now()
      const stats = await fs.stat(resolvedFilePath)
      statMs = performance.now() - statStarted
      fileSize = stats.size
      const MAX_SIZE = 5 * 1024 * 1024

      if (stats.size > MAX_SIZE) {
        phase = 'size'
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
        throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
      }

      phase = 'read'
      const readStarted = performance.now()
      const content = await fs.readFile(resolvedFilePath, 'utf-8')
      accessed?.(resolvedFilePath)
      readWallMs = performance.now() - readStarted
      const indexActivity = ctx.workspaceIndexService?.getDiagnosticActivity() ?? {
        activeIndexBuilds: 0,
        activeIndexReads: 0,
      }
      ctx.diagnosticEventLogService?.recordMainEvent({
        event: 'file.io.summary',
        operationId,
        rawPath: resolvedFilePath,
        outcome: 'success',
        metadata: {
          source,
          authorizationMs,
          statMs,
          readWallMs,
          mainHandlerMs: performance.now() - handlerStarted,
          fileSizeBucket: diagnosticFileSizeBucket(fileSize),
          activeIndexBuilds: indexActivity.activeIndexBuilds,
          activeIndexReads: indexActivity.activeIndexReads,
          writerWriteActive: ctx.diagnosticEventLogService?.getHealth().writerWriteActive ?? false,
        },
      })
      return content
    } catch (error) {
      const errorCode = phase === 'authorization'
        ? 'FILE_AUTHORIZATION_FAILED'
        : phase === 'stat'
          ? 'FILE_STAT_FAILED'
          : phase === 'size'
            ? 'FILE_TOO_LARGE'
            : 'FILE_READ_FAILED'
      ctx.diagnosticEventLogService?.recordMainEvent({
        event: 'file.io.summary',
        operationId,
        rawPath: resolvedFilePath ?? filePath,
        outcome: 'error',
        metadata: {
          source,
          authorizationMs,
          statMs,
          readWallMs,
          mainHandlerMs: performance.now() - handlerStarted,
          fileSizeBucket: diagnosticFileSizeBucket(fileSize),
          errorCode,
          writerWriteActive: ctx.diagnosticEventLogService?.getHealth().writerWriteActive ?? false,
        },
        priority: 'critical',
      })
      if (error instanceof Error) {
        throw error
      }
      console.error('Failed to read file:', error)
      return ''
    }
  })

  ipcMain.handle('fs:readLocalAssetBase64', async (event, payload: {
    markdownFilePath: string
    refPath: string
    resolutionKind?: LocalResourceResolutionKind
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少本地图片读取参数')
    }

    const resolutionKind = payload.resolutionKind ?? 'markdown-relative'
    if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
      throw new Error('本地图片解析类型无效')
    }
    const resolvedPath = (
      await resolveAuthorizedWorkspaceResource(
        ctx,
        event,
        markdownFilePath,
        refPath,
        resolutionKind,
      )
    ).canonicalPath

    const ext = path.extname(resolvedPath).toLowerCase()
    const mimeType = IMAGE_MIME_TYPES[ext]
    if (!mimeType) {
      throw new Error(`不支持的本地图片格式：${ext || '未知'}`)
    }

    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error('本地图片引用不是文件')
    }
    if (stats.size > MAX_LOCAL_ASSET_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      throw new Error(`本地图片过大 (${sizeMB}MB)，已跳过导出内嵌`)
    }

    const buffer = await fs.readFile(resolvedPath)
    return {
      base64: buffer.toString('base64'),
      mimeType,
      resolvedPath,
    }
  })

  ipcMain.handle('fs:readExcalidrawFile', async (event, payload: {
    markdownFilePath: string
    refPath: string
    resolutionKind?: LocalResourceResolutionKind
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath
    const resolutionKind = payload?.resolutionKind ?? 'markdown-relative'

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少 Excalidraw 文件读取参数')
    }
    if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
      throw new Error('Excalidraw 文件解析类型无效')
    }
    const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(refPath)
    const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(refPath)
    if (hasUrlScheme && !isWindowsAbsolutePath) {
      throw new Error('不支持 URL 形式的 .excalidraw 文件')
    }
    if (path.extname(refPath).toLowerCase() !== '.excalidraw') {
      throw new Error('只能读取 .excalidraw 文件')
    }

    let resolvedPath: string
    if (resolutionKind === 'workspace-wiki') {
      resolvedPath = (await resolveAuthorizedWorkspaceResource(
        ctx,
        event,
        markdownFilePath,
        refPath,
        resolutionKind,
      )).canonicalPath
    } else {
      await validateSenderReadPath(ctx, event, markdownFilePath)
      const markdownDir = path.dirname(markdownFilePath)
      const candidatePath = path.isAbsolute(refPath)
        ? path.resolve(refPath)
        : path.resolve(markdownDir, refPath)
      resolvedPath = await fs.realpath(candidatePath)
      await validateSenderReadPath(ctx, event, resolvedPath)
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.excalidraw') {
      throw new Error('只能读取 .excalidraw 文件')
    }
    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error('目标不是普通文件')
    }
    if (stats.size > 1024 * 1024) {
      throw new Error('Excalidraw 文件超过 1MB，未读取')
    }

    return {
      content: await fs.readFile(resolvedPath, 'utf-8'),
      resolvedPath,
    }
  })

  ipcMain.handle('fs:readBpmnFile', async (event, payload: {
    markdownFilePath: string
    refPath: string
    resolutionKind?: LocalResourceResolutionKind
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath
    const resolutionKind = payload?.resolutionKind ?? 'markdown-relative'

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少 BPMN 文件读取参数')
    }
    if (resolutionKind !== 'markdown-relative' && resolutionKind !== 'workspace-wiki') {
      throw new Error('BPMN 文件解析类型无效')
    }
    const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(refPath)
    const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(refPath)
    if (hasUrlScheme && !isWindowsAbsolutePath) {
      throw new Error('不支持 URL 形式的 .bpmn 文件')
    }

    const cleanRefPath = refPath.split(/[?#]/, 1)[0] || refPath
    if (path.extname(cleanRefPath).toLowerCase() !== '.bpmn') {
      throw new Error('只能读取 .bpmn 文件')
    }
    let resolvedPath: string
    if (resolutionKind === 'workspace-wiki') {
      resolvedPath = (await resolveAuthorizedWorkspaceResource(
        ctx,
        event,
        markdownFilePath,
        cleanRefPath,
        resolutionKind,
      )).canonicalPath
    } else {
      await validateSenderReadPath(ctx, event, markdownFilePath)
      const markdownDir = path.dirname(markdownFilePath)
      const candidatePath = path.isAbsolute(cleanRefPath)
        ? path.resolve(cleanRefPath)
        : path.resolve(markdownDir, cleanRefPath)
      resolvedPath = await fs.realpath(candidatePath)
      await validateSenderReadPath(ctx, event, resolvedPath)
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.bpmn') {
      throw new Error('只能读取 .bpmn 文件')
    }
    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error('目标不是普通文件')
    }
    if (stats.size > 2 * 1024 * 1024) {
      throw new Error('BPMN 文件超过 2MB，未读取')
    }

    return {
      content: await fs.readFile(resolvedPath, 'utf-8'),
      resolvedPath,
    }
  })

  // 打开可编辑 Markdown：读取内容，返回规范路径和文件版本信息，并授权当前窗口保存
  ipcMain.handle('fs:openEditableMarkdown', async (
    event,
    filePath: string,
    operation: WorkspaceOperationContext
  ) => {
    const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
    const canonicalPath = await validateWorkspaceOperationPath(ctx, event, operation, filePath)
    if (!canonicalPath.toLowerCase().endsWith('.md')) {
      throw new Error('只能编辑 Markdown 文件')
    }

    const stats = await fs.stat(canonicalPath)
    const MAX_SIZE = 5 * 1024 * 1024
    if (!stats.isFile()) {
      throw new Error('目标不是文件')
    }
    if (stats.size > MAX_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
    }

    const content = await fs.readFile(canonicalPath, 'utf-8')
    const senderId = event.sender.id
    const editableFiles = windowEditableFiles.get(senderId) || new Map<string, EditableFileGrant>()
    editableFiles.set(canonicalPath, {
      workspaceId: operation.workspaceId,
      lifecycleEpoch: operation.lifecycleEpoch,
    })
    windowEditableFiles.set(senderId, editableFiles)

    return {
      canonicalPath,
      displayPath: filePath,
      fileName: path.basename(canonicalPath),
      content,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      revisionToken: buildRevisionToken(stats, content),
    }
  })

  // 保存可编辑 Markdown：仅允许当前窗口已授权文件，保存前校验版本标识，避免静默覆盖外部修改
  ipcMain.handle('fs:saveEditableMarkdown', async (event, payload: {
    canonicalPath: string
    content: string
    expectedRevisionToken: string
    workspace: WorkspaceOperationContext
    force?: boolean
  }) => {
    const { canonicalPath, content, expectedRevisionToken, workspace: operation, force = false } = payload
    const resolvedPath = await validateWorkspaceOperationPath(ctx, event, operation, canonicalPath)

    if (!canonicalPath.toLowerCase().endsWith('.md')) {
      throw new Error('只能保存 Markdown 文件')
    }
    if (typeof content !== 'string') {
      throw new Error('保存内容必须是字符串')
    }
    const contentBytes = Buffer.byteLength(content, 'utf-8')
    const MAX_SIZE = 5 * 1024 * 1024
    if (contentBytes > MAX_SIZE) {
      throw new Error('文件内容超过 5MB，无法保存')
    }

    const senderId = event.sender.id
    const editableFiles = windowEditableFiles.get(senderId)
    const grant = editableFiles?.get(resolvedPath)
    if (!grant || grant.workspaceId !== operation.workspaceId || grant.lifecycleEpoch !== operation.lifecycleEpoch) {
      throw new Error('未授权编辑此文件')
    }
    getSenderWorkspaceForOperation(ctx, event, operation)
    if (process.env.NODE_ENV === 'test' && testEditableSaveDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, testEditableSaveDelayMs))
    }

    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error('目标不是文件')
    }
    const diskContent = !force && stats.size <= MAX_SIZE ? await fs.readFile(resolvedPath, 'utf-8') : undefined
    const diskRevisionToken = buildRevisionToken(stats, diskContent)
    if (!force && !revisionTokenMatches(expectedRevisionToken, diskRevisionToken)) {
      return {
        success: false,
        conflict: {
          reason: 'revision_changed',
          diskRevisionToken,
        },
      }
    }

    await fs.writeFile(resolvedPath, content, 'utf-8')
    const nextStats = await fs.stat(resolvedPath)
    return {
      success: true,
      mtimeMs: nextStats.mtimeMs,
      size: nextStats.size,
      revisionToken: buildRevisionToken(nextStats, content),
    }
  })

  const resolveWatchContext = (
    event: Electron.IpcMainInvokeEvent,
    workspaceId?: string,
    lifecycleEpoch?: number,
    allowStaleEpoch = false
  ): WorkspaceWatchContext => {
    if (workspaceId === undefined && lifecycleEpoch === undefined) {
      // 旧 renderer/test bridge 的兼容路径；新工作区 UI 必须传完整上下文。
      return { workspaceId: `legacy-${event.sender.id}`, lifecycleEpoch: 0, primaryRoot: null, strict: false }
    }
    if (typeof workspaceId !== 'string' || !Number.isInteger(lifecycleEpoch)) {
      throw new Error('安全错误：监听请求缺少完整工作区上下文')
    }
    const verifiedLifecycleEpoch = lifecycleEpoch as number
    const workspace = getSenderWorkspace(ctx, event, workspaceId)
    if (!allowStaleEpoch && workspace.lifecycleEpoch !== verifiedLifecycleEpoch) {
      throw new Error('安全错误：工作区已失效')
    }
    return { workspaceId, lifecycleEpoch: verifiedLifecycleEpoch, primaryRoot: workspace.primaryRoot, strict: true }
  }

  // 只监听活动工作区主文件树；切回其他工作区时由 renderer 主动刷新。
  ipcMain.handle(
    'fs:watchFolder',
    async (event, folderPath: string, workspaceId?: string, lifecycleEpoch?: number) => {
      try {
        const context = resolveWatchContext(event, workspaceId, lifecycleEpoch)
        const resolvedFolderPath = context.strict
          ? await validateWorkspaceWritePath(ctx, event, context.workspaceId, folderPath)
          : await validateSenderReadPath(ctx, event, folderPath)
        resolveWatchContext(event, workspaceId, lifecycleEpoch)
        const pathCheck = isWatchPathSafe(resolvedFolderPath)
        if (!pathCheck.safe) {
          console.warn(`[WATCHER] Rejected unsafe path: ${resolvedFolderPath} - ${pathCheck.reason}`)
          return { success: false, error: pathCheck.reason }
        }

        const subscription = createWatcherSubscription(ctx, event.sender, context)
        workspaceWatchService.attachRoot(resolvedFolderPath, subscription)
        console.log(`[MAIN] Workspace ${context.workspaceId} watching: ${resolvedFolderPath}`)
        return { success: true }
      } catch (error) {
        console.error('Failed to set workspace watcher:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    'fs:watchFile',
    async (event, filePath: string, workspaceId?: string, lifecycleEpoch?: number) => {
      const context = resolveWatchContext(event, workspaceId, lifecycleEpoch)
      const resolvedFilePath = await validateSenderReadPath(ctx, event, filePath)
      resolveWatchContext(event, workspaceId, lifecycleEpoch)
      const subscription = createWatcherSubscription(ctx, event.sender, context)
      workspaceWatchService.watchOpenedFile(resolvedFilePath, subscription)
      console.log(`[MAIN] Workspace ${context.workspaceId} opened: ${resolvedFilePath}`)
      return { success: true }
    }
  )

  ipcMain.handle(
    'fs:unwatchFile',
    async (event, filePath: string, workspaceId?: string, lifecycleEpoch?: number) => {
      const context = resolveWatchContext(event, workspaceId, lifecycleEpoch, true)
      const key = getWorkspaceWatcherKey(event.sender.id, context.workspaceId)
      const resolvedFilePath = path.resolve(filePath)
      await workspaceWatchService.unwatchOpenedFile(key, resolvedFilePath, context.lifecycleEpoch)
      return { success: true }
    }
  )

  ipcMain.handle(
    'fs:unwatchFolder',
    async (event, workspaceId?: string, lifecycleEpoch?: number) => {
      if (workspaceId === undefined && lifecycleEpoch === undefined) {
        cleanupWorkspaceWatchers(event.sender.id, `legacy-${event.sender.id}`)
        return { success: true }
      }
      // cleanup 必须幂等：工作区迁出/关闭后 renderer 的 effect cleanup 仍会到达。
      // key 含 sender id，调用方只能撤销自己的遗留订阅，不能影响其他窗口。
      if (typeof workspaceId !== 'string' || !Number.isInteger(lifecycleEpoch)) {
        throw new Error('安全错误：监听请求缺少完整工作区上下文')
      }
      cleanupWorkspaceWatchers(event.sender.id, workspaceId, lifecycleEpoch)
      return { success: true }
    }
  )

  ipcMain.handle('watch:getStatus', (event, workspaceId?: string, lifecycleEpoch?: number) => {
    const context = resolveWatchContext(event, workspaceId, lifecycleEpoch)
    return workspaceWatchService.getHealth(getWorkspaceWatcherKey(event.sender.id, context.workspaceId))
  })
  ipcMain.handle('watch:gap', (event, workspaceId?: string, lifecycleEpoch?: number) => {
    const context = resolveWatchContext(event, workspaceId, lifecycleEpoch)
    workspaceWatchService.reportGap(getWorkspaceWatcherKey(event.sender.id, context.workspaceId))
    return true
  })
  ipcMain.handle('watch:retry', (event, workspaceId?: string, lifecycleEpoch?: number) => {
    const operationId = `watch_retry_${randomUUID()}`
    let context: WorkspaceWatchContext | undefined
    const observe = (metadata: DiagnosticMetadata): void => {
      try {
        ctx.diagnosticEventLogService?.recordMainEvent({
          event: 'watcher.work.summary', operationId, metadata,
          rawWorkspacePath: context?.primaryRoot ?? undefined,
        })
      } catch { /* 诊断写入失败不能改变重试或安全校验结果。 */ }
    }
    observe({ watchRetryStage: 'received' })
    try {
      context = resolveWatchContext(event, workspaceId, lifecycleEpoch)
    } catch (error) {
      observe({ watchRetryStage: 'context-rejected' })
      throw error
    }
    workspaceWatchService.retry(getWorkspaceWatcherKey(event.sender.id, context.workspaceId), observe)
    return { accepted: true }
  })
  ipcMain.handle('watch:reconciled', (event, requestId: unknown, result: unknown) => {
    if (typeof requestId !== 'string' || (result !== 'ok' && result !== 'superseded' && result !== 'failed')) return false
    const pending = watchReconciliations.get(requestId)
    if (!pending || pending.senderId !== event.sender.id) return false
    clearTimeout(pending.timer)
    watchReconciliations.delete(requestId)
    if (!pending.isCurrent()) {
      pending.reject('superseded')
      return false
    }
    if (result === 'ok') pending.resolve()
    else pending.reject(result)
    return true
  })

  // 重命名文件/文件夹
  ipcMain.handle('fs:rename', async (
    event,
    oldPath: string,
    newName: string,
    operation: WorkspaceOperationContext
  ) => {
    try {
      const resolvedOldPath = await validateWorkspaceOperationPath(ctx, event, operation, oldPath)
      if (!newName || path.basename(newName) !== newName) {
        throw new Error('安全错误：新名称必须是单个文件或目录名称')
      }

      const dirName = path.dirname(resolvedOldPath)
      const newPath = path.join(dirName, newName)
      const resolvedNewPath = await validateWorkspaceOperationPath(ctx, event, operation, newPath)

      if (await fs.pathExists(resolvedNewPath)) {
        throw new Error('目标文件已存在')
      }

      const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
      if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
      const sourceStats = await fs.lstat(resolvedOldPath)
      await fs.move(resolvedOldPath, resolvedNewPath)
      const changed = ctx.appDataManager?.relocateDocumentMarks(
        workspace.primaryRoot,
        resolvedOldPath,
        resolvedNewPath,
        sourceStats.isDirectory()
      )
      if (changed) await broadcastDocumentMarksChanged(ctx, event.sender.id)
      return resolvedNewPath
    } catch (error) {
      console.error('Failed to rename file:', error)
      throw error
    }
  })

  // 同目录创建不覆盖的副本
  ipcMain.handle('fs:duplicate', async (
    event,
    sourcePath: string,
    operation: WorkspaceOperationContext
  ) => {
    try {
      const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
      if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
      await validateWorkspaceOperationPath(ctx, event, operation, sourcePath)
      return await duplicatePath(sourcePath, workspace.primaryRoot)
    } catch (error) {
      console.error('Failed to duplicate path:', error)
      throw error
    }
  })

  // 复制文件
  ipcMain.handle('fs:copyFile', async (
    event,
    srcPath: string,
    destPath: string,
    operation: WorkspaceOperationContext
  ) => {
    try {
      const resolvedSource = await validateClipboardSourceOrWorkspaceRoot(ctx, event, srcPath, operation)
      const resolvedDestination = await validateWorkspaceOperationPath(ctx, event, operation, destPath)

      if (!(await fs.pathExists(resolvedSource))) {
        throw new Error('源文件不存在')
      }

      await fs.copy(resolvedSource, resolvedDestination, {
        overwrite: false,
        errorOnExist: true,
        dereference: false
      })
      return resolvedDestination
    } catch (error) {
      console.error('Failed to copy file:', error)
      throw error
    }
  })

  // 复制目录
  ipcMain.handle('fs:copyDir', async (
    event,
    srcPath: string,
    destPath: string,
    operation: WorkspaceOperationContext
  ) => {
    try {
      const resolvedSource = await validateClipboardSourceOrWorkspaceRoot(ctx, event, srcPath, operation)
      const resolvedDestination = await validateWorkspaceOperationPath(ctx, event, operation, destPath)

      if (isSameOrChildPath(resolvedDestination, resolvedSource)) {
        throw new Error('无法复制目录到自身或子目录')
      }

      if (!(await fs.pathExists(resolvedSource))) {
        throw new Error('源目录不存在')
      }

      const sourceStats = await fs.lstat(resolvedSource)
      if (!sourceStats.isDirectory()) {
        throw new Error('源路径不是目录')
      }
      await rejectDirectorySymbolicLinks(resolvedSource)

      await fs.copy(resolvedSource, resolvedDestination, {
        overwrite: false,
        errorOnExist: true,
        dereference: false
      })
      return resolvedDestination
    } catch (error) {
      console.error('Failed to copy directory:', error)
      throw error
    }
  })

  // 移动文件/文件夹
  ipcMain.handle('fs:moveFile', async (
    event,
    srcPath: string,
    destPath: string,
    operation: WorkspaceOperationContext
  ) => {
    try {
      const resolvedSource = await validateClipboardSourceOrWorkspaceRoot(ctx, event, srcPath, operation)
      const resolvedDestination = await validateWorkspaceOperationPath(ctx, event, operation, destPath)

      if (isSameOrChildPath(resolvedDestination, resolvedSource)) {
        throw new Error('无法移动目录到自身或子目录')
      }

      if (!(await fs.pathExists(resolvedSource))) {
        throw new Error('源文件不存在')
      }

      const sourceStats = await fs.lstat(resolvedSource)
      if (sourceStats.isDirectory()) {
        await rejectDirectorySymbolicLinks(resolvedSource)
      }

      if (await fs.pathExists(resolvedDestination)) {
        throw new Error('目标文件已存在')
      }

      const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
      if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
      await fs.move(resolvedSource, resolvedDestination, { overwrite: false })
      if (isSameOrChildPath(resolvedSource, workspace.primaryRoot)) {
        const changed = ctx.appDataManager?.relocateDocumentMarks(
          workspace.primaryRoot,
          resolvedSource,
          resolvedDestination,
          sourceStats.isDirectory()
        )
        if (changed) await broadcastDocumentMarksChanged(ctx, event.sender.id)
      }
      return resolvedDestination
    } catch (error) {
      console.error('Failed to move file:', error)
      throw error
    }
  })

  ipcMain.handle(
    'fs:previewCrossRootMoveImpact',
    async (
      event,
      sources: string[],
      targetHistoryId: string,
      subRelPath: string | undefined,
      operation: WorkspaceOperationContext,
    ) => {
      if (!Array.isArray(sources) || sources.length === 0 || sources.length > 100) {
        throw new Error('跨根移动来源无效')
      }
      const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
      if (!workspace.primaryRoot || !ctx.workspaceIndexService) throw new Error('当前工作区未绑定文件夹')
      const originRoot = await fs.realpath(workspace.primaryRoot)
      const targetRoot = await ctx.folderHistoryManager.resolveHistoryFolder(targetHistoryId)
      if (!targetRoot) throw new Error('安全错误：目标目录无效或已失效')
      if (originRoot === targetRoot) throw new Error('同根移动不使用跨根影响预览')

      const normalizedSubRel = subRelPath ? path.normalize(subRelPath) : ''
      const destinationDir = await validateSecurePathInBase(path.join(targetRoot, normalizedSubRel), targetRoot)
      const canonicalSources = await Promise.all(sources.map(source =>
        validateWorkspaceOperationPath(ctx, event, operation, source)
      ))
      if (new Set(canonicalSources).size !== canonicalSources.length) throw new Error('跨根移动来源重复')
      for (const source of canonicalSources) {
        if (canonicalSources.some(other => other !== source && isSameOrChildPath(source, other))) {
          throw new Error('不能同时移动目录及其内部项目')
        }
      }

      const mappings: CrossRootMoveMapping[] = []
      const destinationPaths = new Set<string>()
      for (const source of canonicalSources) {
        const sourceStats = await fs.lstat(source)
        if (sourceStats.isSymbolicLink()) throw new Error('安全错误：不支持通过符号链接移动')
        if (sourceStats.isDirectory()) await rejectDirectorySymbolicLinks(source)
        const destination = path.join(destinationDir, path.basename(source))
        if (destinationPaths.has(destination)) throw new Error('跨根移动目标重复')
        destinationPaths.add(destination)
        if (await fs.pathExists(destination)) throw new Error(`目标文件已存在：${path.basename(destination)}`)
        mappings.push({
          sourceRelativePath: toStrictRelativePath(originRoot, source),
          destinationRelativePath: toStrictRelativePath(targetRoot, destination),
          isDirectory: sourceStats.isDirectory(),
        })
      }

      const previewId = `cross-root-preview:${event.sender.id}:${randomUUID()}`
      const originConsumer = `${previewId}:origin`
      const targetConsumer = `${previewId}:target`
      try {
        await Promise.all([
          ctx.workspaceIndexService.attach(originRoot, originConsumer),
          ctx.workspaceIndexService.attach(targetRoot, targetConsumer),
        ])
        await Promise.all([
          ctx.workspaceIndexService.waitUntilIdle(originRoot),
          ctx.workspaceIndexService.waitUntilIdle(targetRoot),
        ])
        const originWiki = ctx.workspaceIndexService.getWikiSnapshot(originRoot)
        const targetWiki = ctx.workspaceIndexService.getWikiSnapshot(targetRoot)
        return await createCrossRootMoveImpactReport({
          originDocuments: originWiki ? [...originWiki.documents.values()] : ctx.workspaceIndexService.getIndexedDocuments(originRoot),
          targetDocuments: targetWiki ? [...targetWiki.documents.values()] : ctx.workspaceIndexService.getIndexedDocuments(targetRoot),
          originRoot, targetRoot, originWiki, targetWiki,
          mappings,
        })
      } finally {
        await Promise.all([
          ctx.workspaceIndexService.detach(originRoot, originConsumer),
          ctx.workspaceIndexService.detach(targetRoot, targetConsumer),
        ])
      }
    },
  )

  // 跨根移动：把文件/文件夹移动到「文件夹历史」里的某个目录（及其子目录）。
  // 安全形态（继剪贴板源例外后的第二个刻意跨根写例外）：
  //   - 渲染进程只传 opaque targetHistoryId + 相对子路径 subRelPath，绝不传目标绝对路径。
  //   - 目标根由主进程 resolveHistoryFolder(id) 自解析（realpath+stat，失效目录返回 null）。
  //   - subRelPath 经 validateSecurePathInBase(dest, targetRoot) 锁死在该根内，防 ../ 逃逸。
  //   - 源、受保护路径、自身/子目录、目录内 symlink、overwrite:false 等不变式与 fs:moveFile 一致。
  ipcMain.handle(
    'fs:moveFileToFolder',
    async (
      event,
      srcPath: string,
      targetHistoryId: string,
      subRelPath: string | undefined,
      operation: WorkspaceOperationContext
    ) => {
      try {
        const resolvedSource = await validateClipboardSourceOrWorkspaceRoot(ctx, event, srcPath, operation)

        const targetRoot = await ctx.folderHistoryManager.resolveHistoryFolder(targetHistoryId)
        if (!targetRoot) {
          throw new Error('安全错误：目标目录无效或已失效')
        }

        // 目标绝对路径由主进程用「已解析的历史根 + 相对子路径 + 源文件名」构造，
        // 再经 realpath 边界校验确保没越出该根（validateSecurePathInBase 内含 validateNotProtected）。
        const normalizedSubRel = subRelPath ? path.normalize(subRelPath) : ''
        const destinationDir = path.join(targetRoot, normalizedSubRel)
        const destinationPath = path.join(destinationDir, path.basename(resolvedSource))
        const resolvedDestination = await validateSecurePathInBase(destinationPath, targetRoot)

        if (isSameOrChildPath(resolvedDestination, resolvedSource)) {
          throw new Error('无法移动目录到自身或子目录')
        }

        if (!(await fs.pathExists(resolvedSource))) {
          throw new Error('源文件不存在')
        }

        const sourceStats = await fs.lstat(resolvedSource)
        if (sourceStats.isDirectory()) {
          await rejectDirectorySymbolicLinks(resolvedSource)
        }

        if (await fs.pathExists(resolvedDestination)) {
          throw new Error('目标文件已存在')
        }

        const workspace = getSenderWorkspaceForOperation(ctx, event, operation)
        if (!workspace.primaryRoot) throw new Error('当前工作区未绑定文件夹')
        await fs.move(resolvedSource, resolvedDestination, { overwrite: false })
        const changed = ctx.appDataManager?.removeDocumentMarks(
          workspace.primaryRoot,
          resolvedSource,
          sourceStats.isDirectory()
        )
        if (changed) await broadcastDocumentMarksChanged(ctx, event.sender.id)
        return resolvedDestination
      } catch (error) {
        console.error('Failed to move file to folder:', error)
        throw error
      }
    }
  )

  // 检查文件是否存在
  ipcMain.handle('fs:exists', async (event, filePath: string) => {
    try {
      const resolvedPath = await validateSenderReadPath(ctx, event, filePath)
      return await fs.pathExists(resolvedPath)
    } catch (error) {
      console.error('Failed to check file existence:', error)
      return false
    }
  })

  // 检查是否为目录
  ipcMain.handle('fs:isDirectory', async (event, filePath: string) => {
    try {
      const resolvedPath = await validateSenderReadPath(ctx, event, filePath)
      const stats = await fs.stat(resolvedPath)
      return stats.isDirectory()
    } catch (error) {
      console.error('Failed to check if directory:', error)
      return false
    }
  })

  // 文件预览：只读前 4096 字节；允许已授权历史目录和其他打开窗口的文件。
  ipcMain.handle('fs:readFilePreview', async (event, filePath: string) => {
    try {
      const resolvedPath = await validateSenderReadPath(ctx, event, filePath)
      const { open } = await import('node:fs/promises')
      const fh = await open(resolvedPath, 'r')
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await fh.read(buf, 0, 4096, 0)
      await fh.close()
      return buf.toString('utf-8', 0, bytesRead)
    } catch {
      return ''
    }
  })

  // 搜索专用：只允许扫描主进程已授权的目录。
  ipcMain.handle('search:readDir', async (event, dirPath: string) => {
    try {
      const resolvedPath = await validateSenderReadPath(ctx, event, dirPath)
      return await scanPreviewableFiles(resolvedPath)
    } catch (error) {
      console.error('Failed to search readDir:', error)
      if (error instanceof Error && error.message.includes('安全错误')) throw error
      return []
    }
  })

  // 搜索专用：只允许读取主进程已授权的文件内容。
  ipcMain.handle('search:readFile', async (event, filePath: string) => {
    try {
      const resolvedPath = await validateSenderReadPath(ctx, event, filePath)
      const stats = await fs.stat(resolvedPath)
      if (stats.size > 5 * 1024 * 1024) throw new Error('文件过大')
      return await fs.readFile(resolvedPath, 'utf-8')
    } catch (error) {
      if (error instanceof Error) throw error
      console.error('Failed to search readFile:', error)
      return ''
    }
  })
}
