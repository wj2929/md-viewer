import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'crypto'
import chokidar from 'chokidar'
import { IPCContext } from './context'
import { validateSearchPath, validateNotProtected, validateSecurePathInBase } from '../security'
import { isClipboardSourceAuthorized } from '../clipboardState'
import { activateFolderForWindow } from '../folderActivation'
import { getSenderFolderRoot, validateSenderPath, validateSenderReadPath } from './senderSecurity'

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

async function validateClipboardSourceOrCurrentRoot(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  sourcePath: string
): Promise<string> {
  const root = getSenderFolderRoot(ctx, event)
  try {
    return await validateSecurePathInBase(sourcePath, root)
  } catch {
    if (!isClipboardSourceAuthorized(event.sender.id, sourcePath)) {
      throw new Error('安全错误：源路径不在当前文件夹且未被复制授权')
    }

    const sourceStats = await fs.lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) {
      throw new Error('安全错误：不支持通过符号链接复制或移动')
    }
    const resolvedSource = await fs.realpath(sourcePath)
    validateNotProtected(resolvedSource)
    return resolvedSource
  }
}

async function validateDestinationInCurrentRoot(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  destinationPath: string
): Promise<string> {
  return validateSecurePathInBase(destinationPath, getSenderFolderRoot(ctx, event))
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

// 多目录监听：每个目录一个 watcher + 引用计数
const dirWatchers = new Map<string, { watcher: ReturnType<typeof chokidar.watch>; refCount: number }>()
// 窗口 → 监听的目录路径（用于 cleanup 时减引用计数）
const windowWatchedDir = new Map<number, string>()

// 每个窗口独立的文件监听器
interface WindowWatcherState {
  watcher: ReturnType<typeof chokidar.watch>
  dir: string
  files: Set<string>
}
const windowFileWatchers = new Map<number, WindowWatcherState>()

// 每个窗口独立的可编辑文件授权集合。必须先通过 fs:openEditableMarkdown 授权，
// 才允许后续 fs:saveEditableMarkdown 写入。
const windowEditableFiles = new Map<number, Set<string>>()

// 重命名检测
let pendingUnlink: { path: string; timestamp: number } | null = null
const RENAME_THRESHOLD_MS = 500
const pendingFileUnlinkTimers = new Map<string, NodeJS.Timeout>()

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

async function getBestEffortCanonicalPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath)
  } catch {
    return path.resolve(filePath)
  }
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

// 安全发送函数：广播给所有窗口（多窗口支持）
function safeSendToRenderer(channel: string, data: unknown): void {
  const allWindows = BrowserWindow.getAllWindows()
  for (const win of allWindows) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

// 监听目录（多窗口支持：引用计数 + 多目录并行）
function watchDirectory(dirPath: string, sender: Electron.WebContents): void {
  // 兼容旧逻辑
  watchedDir = dirPath
  watchedWebContentsId = sender.id

  // 已有 watcher，增加引用计数
  const existing = dirWatchers.get(dirPath)
  if (existing) {
    existing.refCount++
    console.log(`[WATCHER] Reusing watcher for ${dirPath} (refCount: ${existing.refCount})`)
    return
  }

  console.log(`[WATCHER] Watching directory: ${dirPath}`)

  const watcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    depth: WATCHER_CONFIG.MAX_DEPTH,
    ignored: [
      ...WATCHER_CONFIG.IGNORED_PATTERNS,
      (filePath: string, stats?: fs.Stats) => {
        // 目录与文件都先按路径段剪枝：命中 node_modules/.git 等直接整枝忽略，
        // 避免 chokidar 递归进入铺满监听句柄、阻塞主进程（切换文件夹卡顿真因）。
        if (hasIgnoredPathSegment(filePath)) return true
        if (!stats) return false
        if (stats.isDirectory()) return false
        return !isPreviewableFilePath(filePath)
      }
    ],
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  })

  // 也赋值给旧的全局变量，保持兼容
  fileWatcher = watcher

  dirWatchers.set(dirPath, { watcher, refCount: 1 })

  watcher.on('error', (error: unknown) => {
    console.error('[WATCHER] Error:', error)
  })

  watcher.on('ready', () => {
    const watched = watcher.getWatched() || {}
    let fileCount = 0
    let dirCount = 0
    for (const dir of Object.keys(watched)) {
      dirCount++
      fileCount += watched[dir].length
    }
    console.log(`[WATCHER] Ready! Watching ${dirCount} directories, ${fileCount} files`)
  })

  watcher.on('change', (filePath: string) => {
    console.log(`[WATCHER] File changed: ${filePath}`)
    safeSendToRenderer('file:changed', filePath)
  })

  watcher.on('add', (filePath: string) => {
    if (pendingUnlink && Date.now() - pendingUnlink.timestamp < RENAME_THRESHOLD_MS) {
      if (pendingUnlink.path === filePath) {
        console.log(`[WATCHER] File changed (atomic write): ${filePath}`)
        safeSendToRenderer('file:changed', filePath)
      } else {
        console.log(`[WATCHER] File renamed: ${pendingUnlink.path} -> ${filePath}`)
        safeSendToRenderer('file:renamed', { oldPath: pendingUnlink.path, newPath: filePath })
      }
      pendingUnlink = null
    } else {
      console.log(`[WATCHER] File added: ${filePath}`)
      safeSendToRenderer('file:added', filePath)
    }
  })

  watcher.on('unlink', (filePath: string) => {
    console.log(`[WATCHER] File unlinked: ${filePath}`)
    pendingUnlink = { path: filePath, timestamp: Date.now() }

    setTimeout(() => {
      if (pendingUnlink && pendingUnlink.path === filePath) {
        console.log(`[WATCHER] File removed: ${filePath}`)
        safeSendToRenderer('file:removed', filePath)
        watchedFiles.delete(filePath)
        pendingUnlink = null
      }
    }, RENAME_THRESHOLD_MS + 50)
  })

  watcher.on('addDir', (addedDirPath: string) => {
    if (addedDirPath !== dirPath) {
      console.log(`[WATCHER] Directory added: ${addedDirPath}`)
      safeSendToRenderer('folder:added', addedDirPath)
    }
  })

  watcher.on('unlinkDir', (removedDirPath: string) => {
    console.log(`[WATCHER] Directory removed: ${removedDirPath}`)
    safeSendToRenderer('folder:removed', removedDirPath)
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

// 减少目录 watcher 引用计数，归零时关闭
function unwatchDirectoryRef(dirPath: string): void {
  const entry = dirWatchers.get(dirPath)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    console.log(`[WATCHER] Closing watcher for ${dirPath} (refCount: 0)`)
    const closingWatcher = entry.watcher
    closingWatcher.close()
    dirWatchers.delete(dirPath)
    if (fileWatcher === closingWatcher) {
      fileWatcher = null
    }
    if (watchedDir === dirPath) {
      watchedDir = null
    }
  } else {
    console.log(`[WATCHER] Decreased refCount for ${dirPath} (refCount: ${entry.refCount})`)
  }
}

function closeWindowFileWatcher(webContentsId: number): void {
  const watcher = windowFileWatchers.get(webContentsId)
  if (!watcher) return
  console.log(`[WATCHER] Window ${webContentsId} closing, cleaning up file watcher`)
  watcher.watcher.close()
  windowFileWatchers.delete(webContentsId)
}

function watchOpenedFile(filePath: string, sender: Electron.WebContents): void {
  const webContentsId = sender.id
  const existing = windowFileWatchers.get(webContentsId)
  if (existing) {
    if (!existing.files.has(filePath)) {
      existing.files.add(filePath)
      existing.watcher.add(filePath)
      console.log(`[WATCHER] Added opened file watcher: ${filePath}`)
    }
    return
  }

  console.log(`[WATCHER] Watching opened file: ${filePath}`)
  const files = new Set([filePath])
  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  })
  const state: WindowWatcherState = {
    watcher,
    dir: path.dirname(filePath),
    files
  }
  windowFileWatchers.set(webContentsId, state)

  watcher.on('error', (error: unknown) => {
    console.error('[WATCHER] Opened file watcher error:', error)
  })

  watcher.on('change', (changedPath: string) => {
    if (!state.files.has(changedPath)) return
    console.log(`[WATCHER] Opened file changed: ${changedPath}`)
    safeSendToRenderer('file:changed', changedPath)
  })

  watcher.on('add', (addedPath: string) => {
    if (!state.files.has(addedPath)) return
    const pendingTimer = pendingFileUnlinkTimers.get(addedPath)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingFileUnlinkTimers.delete(addedPath)
    }
    console.log(`[WATCHER] Opened file changed (add): ${addedPath}`)
    safeSendToRenderer('file:changed', addedPath)
  })

  watcher.on('unlink', (removedPath: string) => {
    if (!state.files.has(removedPath)) return
    const previousTimer = pendingFileUnlinkTimers.get(removedPath)
    if (previousTimer) clearTimeout(previousTimer)
    const timer = setTimeout(() => {
      pendingFileUnlinkTimers.delete(removedPath)
      console.log(`[WATCHER] Opened file removed: ${removedPath}`)
      safeSendToRenderer('file:removed', removedPath)
    }, RENAME_THRESHOLD_MS + 50)
    pendingFileUnlinkTimers.set(removedPath, timer)
  })
}

// 导出文件监听器状态，供 index.ts 窗口关闭清理使用
export function getFileWatcherState() {
  return {
    windowFileWatchers,
    fileWatcher: () => fileWatcher,
    watchedWebContentsId: () => watchedWebContentsId,
    cleanup: (webContentsId: number) => {
      // 清理窗口级 watcher
      closeWindowFileWatcher(webContentsId)
      // 减少目录 watcher 引用计数
      const dir = windowWatchedDir.get(webContentsId)
      if (dir) {
        unwatchDirectoryRef(dir)
        windowWatchedDir.delete(webContentsId)
      }
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

    return (await activateFolderForWindow(ctx, window, result.filePaths[0])).path
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
  ipcMain.handle('fs:openEditableMarkdown', async (event, filePath: string) => {
    await validateSenderReadPath(ctx, event, filePath)

    const canonicalPath = await getBestEffortCanonicalPath(filePath)
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
    const editableFiles = windowEditableFiles.get(senderId) || new Set<string>()
    editableFiles.add(canonicalPath)
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
    force?: boolean
  }) => {
    const { canonicalPath, content, expectedRevisionToken, force = false } = payload
    await validateSenderPath(ctx, event, canonicalPath)

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
    if (!editableFiles?.has(canonicalPath)) {
      throw new Error('未授权编辑此文件')
    }

    const stats = await fs.stat(canonicalPath)
    if (!stats.isFile()) {
      throw new Error('目标不是文件')
    }
    const diskContent = !force && stats.size <= MAX_SIZE ? await fs.readFile(canonicalPath, 'utf-8') : undefined
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

    await fs.writeFile(canonicalPath, content, 'utf-8')
    const nextStats = await fs.stat(canonicalPath)
    return {
      success: true,
      mtimeMs: nextStats.mtimeMs,
      size: nextStats.size,
      revisionToken: buildRevisionToken(nextStats, content),
    }
  })

  // 监听文件夹
  ipcMain.handle('fs:watchFolder', async (event, folderPath: string) => {
    try {
      await validateSenderReadPath(ctx, event, folderPath)

      const pathCheck = isWatchPathSafe(folderPath)
      if (!pathCheck.safe) {
        console.warn(`[WATCHER] Rejected unsafe path: ${folderPath} - ${pathCheck.reason}`)
        return { success: false, error: pathCheck.reason }
      }

      _baseFolderPath = folderPath
      watchedFiles.clear()

      // 如果该窗口之前监听了另一个目录，先减引用计数
      const webContentsId = event.sender.id
      const prevDir = windowWatchedDir.get(webContentsId)
      if (prevDir === folderPath && dirWatchers.has(folderPath)) {
        console.log(`[WATCHER] Window ${webContentsId} already watching ${folderPath}`)
        return { success: true }
      }
      if (prevDir && prevDir !== folderPath) {
        unwatchDirectoryRef(prevDir)
        closeWindowFileWatcher(webContentsId)
      }
      windowWatchedDir.set(webContentsId, folderPath)

      watchDirectory(folderPath, event.sender)

      console.log(`[MAIN] Base folder set and watching: ${folderPath}`)
      return { success: true }
    } catch (error) {
      console.error('Failed to set base folder:', error)
      throw error
    }
  })

  // 监听单个文件
  ipcMain.handle('fs:watchFile', async (event, filePath: string) => {
    const resolvedFilePath = await validateSenderReadPath(ctx, event, filePath)

    watchedFiles.add(resolvedFilePath)

    if (!fileWatcher && _baseFolderPath) {
      watchDirectory(_baseFolderPath, event.sender)
    }

    const watchedDirectory = windowWatchedDir.get(event.sender.id)
    if (!watchedDirectory || !isWithinDirectoryWatcherDepth(watchedDirectory, resolvedFilePath)) {
      watchOpenedFile(resolvedFilePath, event.sender)
    }

    console.log(`[MAIN] File opened: ${resolvedFilePath}`)
    return { success: true }
  })

  // 停止监听
  ipcMain.handle('fs:unwatchFolder', async (event) => {
    const webContentsId = event.sender.id
    const watchedDirectory = windowWatchedDir.get(webContentsId)
    if (watchedDirectory) {
      unwatchDirectoryRef(watchedDirectory)
      windowWatchedDir.delete(webContentsId)
      closeWindowFileWatcher(webContentsId)
      return { success: true }
    }

    // 兼容旧状态：没有窗口目录记录时，清理全局 watcher 和对应 map 项。
    if (fileWatcher) {
      const closingWatcher = fileWatcher
      await closingWatcher.close()
      for (const [dirPath, entry] of dirWatchers.entries()) {
        if (entry.watcher === closingWatcher) {
          dirWatchers.delete(dirPath)
        }
      }
      fileWatcher = null
      watchedDir = null
    }
    return { success: true }
  })

  // 重命名文件/文件夹
  ipcMain.handle('fs:rename', async (event, oldPath: string, newName: string) => {
    try {
      const resolvedOldPath = await validateSenderPath(ctx, event, oldPath)
      if (!newName || path.basename(newName) !== newName) {
        throw new Error('安全错误：新名称必须是单个文件或目录名称')
      }

      const dirName = path.dirname(resolvedOldPath)
      const newPath = path.join(dirName, newName)
      const resolvedNewPath = await validateSenderPath(ctx, event, newPath)

      if (await fs.pathExists(resolvedNewPath)) {
        throw new Error('目标文件已存在')
      }

      await fs.move(resolvedOldPath, resolvedNewPath)
      return resolvedNewPath
    } catch (error) {
      console.error('Failed to rename file:', error)
      throw error
    }
  })

  // 同目录创建不覆盖的副本
  ipcMain.handle('fs:duplicate', async (event, sourcePath: string) => {
    try {
      return await duplicatePath(sourcePath, getSenderFolderRoot(ctx, event))
    } catch (error) {
      console.error('Failed to duplicate path:', error)
      throw error
    }
  })

  // 复制文件
  ipcMain.handle('fs:copyFile', async (event, srcPath: string, destPath: string) => {
    try {
      const resolvedSource = await validateClipboardSourceOrCurrentRoot(ctx, event, srcPath)
      const resolvedDestination = await validateDestinationInCurrentRoot(ctx, event, destPath)

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
  ipcMain.handle('fs:copyDir', async (event, srcPath: string, destPath: string) => {
    try {
      const resolvedSource = await validateClipboardSourceOrCurrentRoot(ctx, event, srcPath)
      const resolvedDestination = await validateDestinationInCurrentRoot(ctx, event, destPath)

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
  ipcMain.handle('fs:moveFile', async (event, srcPath: string, destPath: string) => {
    try {
      const resolvedSource = await validateClipboardSourceOrCurrentRoot(ctx, event, srcPath)
      const resolvedDestination = await validateDestinationInCurrentRoot(ctx, event, destPath)

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

      await fs.move(resolvedSource, resolvedDestination, { overwrite: false })
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
    async (event, srcPath: string, targetHistoryId: string, subRelPath?: string) => {
      try {
        const resolvedSource = await validateClipboardSourceOrCurrentRoot(ctx, event, srcPath)

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

        await fs.move(resolvedSource, resolvedDestination, { overwrite: false })
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
      await validateSenderReadPath(ctx, event, filePath)
      return await fs.pathExists(filePath)
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

  // 文件预览：只读前 1024 字节（用于 tooltip 预览）
  // 使用 validateSearchPath 而非 validatePath，允许跨文件夹预览（最近文件可能不在当前 basePath 内）
  ipcMain.handle('fs:readFilePreview', async (_, filePath: string) => {
    try {
      validateSearchPath(filePath)
      const { open } = await import('node:fs/promises')
      const fh = await open(filePath, 'r')
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await fh.read(buf, 0, 4096, 0)
      await fh.close()
      return buf.toString('utf-8', 0, bytesRead)
    } catch {
      return ''
    }
  })

  // 搜索专用：读取任意文件夹的 md 文件列表（仅检查 PROTECTED_PATTERNS）
  ipcMain.handle('search:readDir', async (_, dirPath: string) => {
    try {
      validateSearchPath(dirPath)
      return await scanPreviewableFiles(dirPath)
    } catch (error) {
      console.error('Failed to search readDir:', error)
      if (error instanceof Error && error.message.includes('安全错误')) throw error
      return []
    }
  })

  // 搜索专用：读取任意文件内容（仅检查 PROTECTED_PATTERNS）
  ipcMain.handle('search:readFile', async (_, filePath: string) => {
    try {
      validateSearchPath(filePath)
      const stats = await fs.stat(filePath)
      if (stats.size > 5 * 1024 * 1024) throw new Error('文件过大')
      return await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      if (error instanceof Error) throw error
      console.error('Failed to search readFile:', error)
      return ''
    }
  })
}
