import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'crypto'
import chokidar from 'chokidar'
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

// 文件信息接口
interface FileInfo {
  name: string
  path: string
  treePath: string
  isDirectory: boolean
  children?: FileInfo[]
}

// ============== 文件监听器状态 ==============

let fileWatcher: ReturnType<typeof chokidar.watch> | null = null
let watchedDir: string | null = null
let _baseFolderPath: string | null = null
const watchedFiles = new Set<string>()
const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])
const LOCAL_ASSET_MIME_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
])
const MAX_LOCAL_ASSET_SIZE = 10 * 1024 * 1024
const DUPLICATE_SUFFIX_PATTERN = / - 副本(?: [1-9]\d*)?$/

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

async function broadcastDocumentMarksChanged(ctx: IPCContext, senderId?: number): Promise<void> {
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

let watchedWebContentsId: number | null = null

/**
 * 监听器不是广播总线。一个 BrowserWindow 可以有多个工作区，迟到的 A 事件
 * 绝不能在 B 已激活后更新当前 renderer facade，因此订阅以 workspace + epoch 为单位。
 */
interface WorkspaceWatchContext {
  workspaceId: string
  lifecycleEpoch: number
  strict: boolean
}

interface WorkspaceWatchEvent {
  workspaceId: string
  lifecycleEpoch: number
  path?: string
  oldPath?: string
  newPath?: string
}

interface WatchSubscription extends WorkspaceWatchContext {
  sender: Electron.WebContents
}

interface DirectoryWatcherState {
  watcher: ReturnType<typeof chokidar.watch>
  subscriptions: Map<string, WatchSubscription>
  pendingUnlink: { path: string; timestamp: number } | null
}

interface WorkspaceFileWatcherState extends WatchSubscription {
  watcher: ReturnType<typeof chokidar.watch>
  files: Set<string>
}

// 目录 watcher 可由不同窗口/工作区共享；事件只定向投递给其订阅者。
const dirWatchers = new Map<string, DirectoryWatcherState>()
// 每个 (webContents, workspace) 只能有一个活动目录订阅。
const workspaceWatchedDirs = new Map<string, string>()
// 超过目录 watcher 深度的已打开文件，按 (webContents, workspace) 单独监听。
const workspaceFileWatchers = new Map<string, WorkspaceFileWatcherState>()

// 每个窗口独立的可编辑文件授权集合。必须先通过 fs:openEditableMarkdown 授权，
// 才允许后续 fs:saveEditableMarkdown 写入。
interface EditableFileGrant {
  workspaceId: string
  lifecycleEpoch: number
}

const windowEditableFiles = new Map<number, Map<string, EditableFileGrant>>()

const RENAME_THRESHOLD_MS = 500

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

  const markdownDir = path.dirname(markdownFilePath)
  return path.normalize(path.join(markdownDir, cleanRefPath))
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

// 配置常量
const WATCHER_CONFIG = {
  MAX_DEPTH: 2,
  MIN_PATH_DEPTH: 3,
  IGNORED_PATTERNS: [
    '**/.*',
    '**/node_modules/**',
    '**/vendor/**',
    '**/target/**',
    '**/build/**',
    '**/dist/**',
    '**/__pycache__/**',
    '**/venv/**',
    '**/.venv/**',
    '**/coverage/**',
    '**/*.zip',
    '**/*.tar.gz',
    '**/batch*/**',
  ],
  // 需从递归监听中整枝剪除的目录名（含隐藏目录）。
  // glob 的 '**/node_modules/**' 只匹配目录“内部”，不匹配目录本身，
  // chokidar 仍会进入并铺满监听句柄、阻塞主进程——故按路径段名精确剪枝。
  IGNORED_DIR_NAMES: new Set([
    'node_modules', 'vendor', 'target', 'build', 'dist',
    '__pycache__', 'venv', '.venv', 'env', 'coverage',
  ]),
}

// 路径任一段命中忽略目录名（或为隐藏目录 .xxx）即应剪枝
export function hasIgnoredPathSegment(filePath: string): boolean {
  // 同时按 / 和 \ 拆分：Windows 上 path.sep 为 \，但传入路径可能混用 /，
  // 只按 path.sep 拆会漏判（跨平台缺陷）。
  const segments = filePath.split(/[/\\]/)
  for (const seg of segments) {
    if (!seg) continue
    if (WATCHER_CONFIG.IGNORED_DIR_NAMES.has(seg)) return true
    // 隐藏目录（.git/.idea/.vscode 等），但放行 . 与 ..
    if (seg.length > 1 && seg.startsWith('.') && seg !== '..') return true
  }
  return false
}

function isPreviewableFilePath(filePath: string): boolean {
  return PREVIEWABLE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isWithinDirectoryWatcherDepth(dirPath: string, filePath: string): boolean {
  const relativePath = path.relative(dirPath, filePath)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false
  }
  const directoryDepth = relativePath.split(path.sep).length - 1
  return directoryDepth <= WATCHER_CONFIG.MAX_DEPTH
}

// 路径安全验证
function isWatchPathSafe(targetPath: string): { safe: boolean; reason?: string } {
  const resolved = path.resolve(targetPath)
  const pathParts = resolved.split(path.sep).filter(Boolean)

  if (pathParts.length < WATCHER_CONFIG.MIN_PATH_DEPTH) {
    return { safe: false, reason: '目录层级过高，请选择更具体的项目目录' }
  }

  const homeDir = os.homedir()
  if (resolved === homeDir) {
    return { safe: false, reason: '不能监听用户主目录，请选择子目录' }
  }

  return { safe: true }
}

function getWorkspaceWatcherKey(webContentsId: number, workspaceId: string): string {
  return `${webContentsId}:${workspaceId}`
}

function toWorkspaceWatchEvent(
  context: WorkspaceWatchContext,
  patch: Omit<WorkspaceWatchEvent, keyof WorkspaceWatchContext>
): WorkspaceWatchEvent {
  return {
    workspaceId: context.workspaceId,
    lifecycleEpoch: context.lifecycleEpoch,
    ...patch,
  }
}

function sendWorkspaceWatchEvent(
  subscription: WatchSubscription,
  channel: string,
  patch: Omit<WorkspaceWatchEvent, keyof WorkspaceWatchContext>
): void {
  if (subscription.sender.isDestroyed()) return
  subscription.sender.send(channel, toWorkspaceWatchEvent(subscription, patch))
}

function broadcastDirectoryEvent(
  state: DirectoryWatcherState,
  channel: string,
  patch: Omit<WorkspaceWatchEvent, keyof WorkspaceWatchContext>
): void {
  for (const subscription of state.subscriptions.values()) {
    sendWorkspaceWatchEvent(subscription, channel, patch)
  }
}

function detachDirectorySubscription(key: string): void {
  const dirPath = workspaceWatchedDirs.get(key)
  if (!dirPath) return

  workspaceWatchedDirs.delete(key)
  const state = dirWatchers.get(dirPath)
  if (!state) return
  state.subscriptions.delete(key)
  if (state.subscriptions.size > 0) return

  console.log(`[WATCHER] Closing watcher for ${dirPath}`)
  state.watcher.close()
  dirWatchers.delete(dirPath)
  if (fileWatcher === state.watcher) fileWatcher = null
  if (watchedDir === dirPath) watchedDir = null
}

function closeWorkspaceFileWatcher(key: string): void {
  const state = workspaceFileWatchers.get(key)
  if (!state) return
  console.log(`[WATCHER] Cleaning up opened-file watcher for ${key}`)
  state.watcher.close()
  workspaceFileWatchers.delete(key)
}

function cleanupWorkspaceWatchers(webContentsId: number, workspaceId?: string): void {
  const keys = new Set<string>()
  for (const key of workspaceWatchedDirs.keys()) {
    if (key.startsWith(`${webContentsId}:`) && (!workspaceId || key === getWorkspaceWatcherKey(webContentsId, workspaceId))) {
      keys.add(key)
    }
  }
  for (const key of workspaceFileWatchers.keys()) {
    if (key.startsWith(`${webContentsId}:`) && (!workspaceId || key === getWorkspaceWatcherKey(webContentsId, workspaceId))) {
      keys.add(key)
    }
  }
  for (const key of keys) {
    detachDirectorySubscription(key)
    closeWorkspaceFileWatcher(key)
  }
}

// 监听活动工作区根目录。多个订阅可以复用同一个 chokidar watcher，但绝不广播给无关工作区。
function watchDirectory(
  ctx: IPCContext,
  dirPath: string,
  sender: Electron.WebContents,
  context: WorkspaceWatchContext
): void {
  watchedDir = dirPath
  watchedWebContentsId = sender.id
  const key = getWorkspaceWatcherKey(sender.id, context.workspaceId)
  const previousDir = workspaceWatchedDirs.get(key)
  if (previousDir && previousDir !== dirPath) {
    detachDirectorySubscription(key)
    closeWorkspaceFileWatcher(key)
  }

  let state = dirWatchers.get(dirPath)
  if (!state) {
    console.log(`[WATCHER] Watching directory: ${dirPath}`)
    const watcher = chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true,
      depth: WATCHER_CONFIG.MAX_DEPTH,
      ignored: [
        ...WATCHER_CONFIG.IGNORED_PATTERNS,
        (filePath: string, stats?: fs.Stats) => {
          if (hasIgnoredPathSegment(filePath)) return true
          if (!stats) return false
          if (stats.isDirectory()) return false
          return !isPreviewableFilePath(filePath)
        }
      ],
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    state = { watcher, subscriptions: new Map(), pendingUnlink: null }
    fileWatcher = watcher
    dirWatchers.set(dirPath, state)

    watcher.on('error', (error: unknown) => console.error('[WATCHER] Error:', error))
    watcher.on('ready', () => {
      const watched = watcher.getWatched() || {}
      const fileCount = Object.values(watched).reduce((sum, entries) => sum + entries.length, 0)
      console.log(`[WATCHER] Ready! Watching ${Object.keys(watched).length} directories, ${fileCount} files`)
    })
    watcher.on('change', (filePath: string) => {
      console.log(`[WATCHER] File changed: ${filePath}`)
      broadcastDirectoryEvent(state!, 'file:changed', { path: filePath })
    })
    watcher.on('add', (filePath: string) => {
      const pending = state!.pendingUnlink
      if (pending && Date.now() - pending.timestamp < RENAME_THRESHOLD_MS) {
        if (pending.path === filePath) {
          broadcastDirectoryEvent(state!, 'file:changed', { path: filePath })
        } else {
          const changed = ctx.appDataManager?.relocateDocumentMarks(dirPath, pending.path, filePath)
          if (changed) void broadcastDocumentMarksChanged(ctx)
          broadcastDirectoryEvent(state!, 'file:renamed', { oldPath: pending.path, newPath: filePath })
        }
        state!.pendingUnlink = null
      } else {
        broadcastDirectoryEvent(state!, 'file:added', { path: filePath })
      }
    })
    watcher.on('unlink', (filePath: string) => {
      state!.pendingUnlink = { path: filePath, timestamp: Date.now() }
      setTimeout(() => {
        if (state?.pendingUnlink?.path !== filePath) return
        const changed = ctx.appDataManager?.removeDocumentMarks(dirPath, filePath)
        if (changed) void broadcastDocumentMarksChanged(ctx)
        broadcastDirectoryEvent(state, 'file:removed', { path: filePath })
        watchedFiles.delete(filePath)
        state.pendingUnlink = null
      }, RENAME_THRESHOLD_MS + 50)
    })
    watcher.on('addDir', (addedDirPath: string) => {
      if (addedDirPath !== dirPath) broadcastDirectoryEvent(state!, 'folder:added', { path: addedDirPath })
    })
    watcher.on('unlinkDir', (removedDirPath: string) => {
      const changed = ctx.appDataManager?.removeDocumentMarks(dirPath, removedDirPath, true)
      if (changed) void broadcastDocumentMarksChanged(ctx)
      broadcastDirectoryEvent(state!, 'folder:removed', { path: removedDirPath })
    })
  }

  state.subscriptions.set(key, { sender, ...context })
  workspaceWatchedDirs.set(key, dirPath)
}

function watchOpenedFile(
  filePath: string,
  sender: Electron.WebContents,
  context: WorkspaceWatchContext
): void {
  const key = getWorkspaceWatcherKey(sender.id, context.workspaceId)
  const existing = workspaceFileWatchers.get(key)
  if (existing) {
    if (!existing.files.has(filePath)) {
      existing.files.add(filePath)
      existing.watcher.add(filePath)
    }
    return
  }

  const files = new Set([filePath])
  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  const state: WorkspaceFileWatcherState = { watcher, files, sender, ...context }
  workspaceFileWatchers.set(key, state)
  watcher.on('error', (error: unknown) => console.error('[WATCHER] Opened file watcher error:', error))
  watcher.on('change', (changedPath: string) => {
    if (state.files.has(changedPath)) sendWorkspaceWatchEvent(state, 'file:changed', { path: changedPath })
  })
  watcher.on('add', (addedPath: string) => {
    if (state.files.has(addedPath)) sendWorkspaceWatchEvent(state, 'file:changed', { path: addedPath })
  })
  watcher.on('unlink', (removedPath: string) => {
    if (!state.files.has(removedPath)) return
    setTimeout(() => {
      if (state.files.has(removedPath)) sendWorkspaceWatchEvent(state, 'file:removed', { path: removedPath })
    }, RENAME_THRESHOLD_MS + 50)
  })
}

// 使用 glob 快速扫描可预览文件
async function scanPreviewableFiles(rootPath: string): Promise<FileInfo[]> {
  const { glob } = await import('glob')

  const previewFiles = await glob('**/*.{md,markdown,mdown,mkd,mkdn,excalidraw}', {
    cwd: rootPath,
    ignore: ['**/node_modules/**', '**/.*/**', '**/venv/**', '**/.venv/**', '**/env/**'],
    nodir: true,
    absolute: false,
    nocase: true
  })

  return buildFileTree(rootPath, previewFiles)
}

// 从 glob 结果构建文件树
function buildFileTree(rootPath: string, relativePaths: string[]): FileInfo[] {
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

  return sortTree(tree)
}

// 导出文件监听器状态，供 index.ts 窗口关闭清理使用
export function getFileWatcherState() {
  return {
    workspaceFileWatchers,
    fileWatcher: () => fileWatcher,
    watchedWebContentsId: () => watchedWebContentsId,
    cleanup: (webContentsId: number) => {
      cleanupWorkspaceWatchers(webContentsId)
    }
  }
}

export function registerFileHandlers(ctx: IPCContext): void {
  if (process.env.NODE_ENV === 'test') {
    ipcMain.handle('test:openMarkdownFile', async (event, filePath: string) => {
      const resolvedPath = path.resolve(filePath)
      const folderPath = path.dirname(resolvedPath)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        await activateFolderForWindow(ctx, win, folderPath, { notifyRenderer: true })
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.send('open-specific-file', resolvedPath)
          }
        }, 500)
      }
      return true
    })
  }

  // 打开文件夹对话框
  ipcMain.handle('dialog:openFolder', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法识别当前窗口')
    }

    return activateFolderForWindow(ctx, window, result.filePaths[0])
  })

  // 读取目录
  ipcMain.handle('fs:readDir', async (event, dirPath: string) => {
    try {
      const resolvedDirectory = await validateSenderReadPath(ctx, event, dirPath)

      const startTime = Date.now()
      const result = await scanPreviewableFiles(resolvedDirectory)
      console.log(`[MAIN] Scanned ${dirPath} in ${Date.now() - startTime}ms, found ${result.length} items`)
      return result
    } catch (error) {
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
        if (hasIgnoredPathSegment(path.join(resolvedDirectory, entry.name))) continue
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
  ipcMain.handle('fs:readFile', async (event, filePath: string) => {
    try {
      const resolvedFilePath = await validateSenderReadPath(ctx, event, filePath)

      const stats = await fs.stat(resolvedFilePath)
      const MAX_SIZE = 5 * 1024 * 1024

      if (stats.size > MAX_SIZE) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
        throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
      }

      const content = await fs.readFile(resolvedFilePath, 'utf-8')
      return content
    } catch (error) {
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
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少本地图片读取参数')
    }

    const canonicalMarkdownPath = await validateSenderReadPath(ctx, event, markdownFilePath)
    const resolvedPath = await validateSenderReadPath(
      ctx,
      event,
      resolveMarkdownRelativePath(canonicalMarkdownPath, decodeURIComponent(refPath))
    )

    const ext = path.extname(resolvedPath).toLowerCase()
    const mimeType = LOCAL_ASSET_MIME_TYPES.get(ext)
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
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少 Excalidraw 文件读取参数')
    }
    const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(refPath)
    const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(refPath)
    if (hasUrlScheme && !isWindowsAbsolutePath) {
      throw new Error('不支持 URL 形式的 .excalidraw 文件')
    }

    await validateSenderReadPath(ctx, event, markdownFilePath)

    const markdownDir = path.dirname(markdownFilePath)
    const candidatePath = path.isAbsolute(refPath)
      ? path.resolve(refPath)
      : path.resolve(markdownDir, refPath)

    if (path.extname(candidatePath).toLowerCase() !== '.excalidraw') {
      throw new Error('只能读取 .excalidraw 文件')
    }

    const resolvedPath = await fs.realpath(candidatePath)
    if (path.extname(resolvedPath).toLowerCase() !== '.excalidraw') {
      throw new Error('只能读取 .excalidraw 文件')
    }
    await validateSenderReadPath(ctx, event, resolvedPath)

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
  }) => {
    const markdownFilePath = payload?.markdownFilePath
    const refPath = payload?.refPath

    if (!markdownFilePath || !refPath) {
      throw new Error('缺少 BPMN 文件读取参数')
    }
    const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(refPath)
    const isWindowsAbsolutePath = /^[a-z]:[\\/]/i.test(refPath)
    if (hasUrlScheme && !isWindowsAbsolutePath) {
      throw new Error('不支持 URL 形式的 .bpmn 文件')
    }

    await validateSenderReadPath(ctx, event, markdownFilePath)

    const cleanRefPath = refPath.split(/[?#]/, 1)[0] || refPath
    const markdownDir = path.dirname(markdownFilePath)
    const candidatePath = path.isAbsolute(cleanRefPath)
      ? path.resolve(cleanRefPath)
      : path.resolve(markdownDir, cleanRefPath)

    if (path.extname(candidatePath).toLowerCase() !== '.bpmn') {
      throw new Error('只能读取 .bpmn 文件')
    }

    const resolvedPath = await fs.realpath(candidatePath)
    if (path.extname(resolvedPath).toLowerCase() !== '.bpmn') {
      throw new Error('只能读取 .bpmn 文件')
    }
    await validateSenderReadPath(ctx, event, resolvedPath)

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
      return { workspaceId: `legacy-${event.sender.id}`, lifecycleEpoch: 0, strict: false }
    }
    if (typeof workspaceId !== 'string' || !Number.isInteger(lifecycleEpoch)) {
      throw new Error('安全错误：监听请求缺少完整工作区上下文')
    }
    const verifiedLifecycleEpoch = lifecycleEpoch as number
    const workspace = getSenderWorkspace(ctx, event, workspaceId)
    if (!allowStaleEpoch && workspace.lifecycleEpoch !== verifiedLifecycleEpoch) {
      throw new Error('安全错误：工作区已失效')
    }
    return { workspaceId, lifecycleEpoch: verifiedLifecycleEpoch, strict: true }
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
        const pathCheck = isWatchPathSafe(resolvedFolderPath)
        if (!pathCheck.safe) {
          console.warn(`[WATCHER] Rejected unsafe path: ${resolvedFolderPath} - ${pathCheck.reason}`)
          return { success: false, error: pathCheck.reason }
        }

        _baseFolderPath = resolvedFolderPath
        watchedFiles.clear()
        watchDirectory(ctx, resolvedFolderPath, event.sender, context)
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
      watchedFiles.add(resolvedFilePath)
      const key = getWorkspaceWatcherKey(event.sender.id, context.workspaceId)
      const watchedDirectory = workspaceWatchedDirs.get(key)
      if (!watchedDirectory || !isWithinDirectoryWatcherDepth(watchedDirectory, resolvedFilePath)) {
        watchOpenedFile(resolvedFilePath, event.sender, context)
      }
      console.log(`[MAIN] Workspace ${context.workspaceId} opened: ${resolvedFilePath}`)
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
      cleanupWorkspaceWatchers(event.sender.id, workspaceId)
      return { success: true }
    }
  )

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
