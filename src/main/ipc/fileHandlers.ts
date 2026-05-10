import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import chokidar from 'chokidar'
import { IPCContext } from './context'
import { setAllowedBasePath, validateSecurePath, validatePath, validateSearchPath } from '../security'

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

function buildRevisionToken(stats: fs.Stats): string {
  return `${stats.mtimeMs}:${stats.size}`
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
      setAllowedBasePath(folderPath)
      ctx.store.set('lastOpenedFolder', folderPath)
      await ctx.folderHistoryManager.addFolder(folderPath)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        ctx.windowManager.setWindowFolderPath(win.id, folderPath)
        win.webContents.send('restore-folder', folderPath)
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

    const folderPath = result.filePaths[0]
    ctx.store.set('lastOpenedFolder', folderPath)
    await ctx.folderHistoryManager.addFolder(folderPath)
    setAllowedBasePath(folderPath)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      ctx.windowManager.setWindowFolderPath(win.id, folderPath)
    }
    console.log(`[SECURITY] Set allowed base path: ${folderPath}`)

    return folderPath
  })

  // 读取目录
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    try {
      validatePath(dirPath)

      const startTime = Date.now()
      const result = await scanPreviewableFiles(dirPath)
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

  // 读取文件内容
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      validatePath(filePath)

      const stats = await fs.stat(filePath)
      const MAX_SIZE = 5 * 1024 * 1024

      if (stats.size > MAX_SIZE) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
        throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
      }

      const content = await fs.readFile(filePath, 'utf-8')
      return content
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      console.error('Failed to read file:', error)
      return ''
    }
  })

  ipcMain.handle('fs:readExcalidrawFile', async (_, payload: {
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

    validateSecurePath(markdownFilePath)

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
    validateSecurePath(resolvedPath)

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

  // 打开可编辑 Markdown：读取内容，返回规范路径和文件版本信息，并授权当前窗口保存
  ipcMain.handle('fs:openEditableMarkdown', async (event, filePath: string) => {
    validateSecurePath(filePath)

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
      revisionToken: buildRevisionToken(stats),
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
    validateSecurePath(canonicalPath)

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
    const diskRevisionToken = buildRevisionToken(stats)
    if (!force && diskRevisionToken !== expectedRevisionToken) {
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
      revisionToken: buildRevisionToken(nextStats),
    }
  })

  // 监听文件夹
  ipcMain.handle('fs:watchFolder', async (event, folderPath: string) => {
    try {
      validatePath(folderPath)

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
    validatePath(filePath)

    watchedFiles.add(filePath)

    if (!fileWatcher && _baseFolderPath) {
      watchDirectory(_baseFolderPath, event.sender)
    }

    const watchedDirectory = windowWatchedDir.get(event.sender.id)
    if (!watchedDirectory || !isWithinDirectoryWatcherDepth(watchedDirectory, filePath)) {
      watchOpenedFile(filePath, event.sender)
    }

    console.log(`[MAIN] File opened: ${filePath}`)
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
  ipcMain.handle('fs:rename', async (_, oldPath: string, newName: string) => {
    try {
      validateSecurePath(oldPath)

      const dirName = path.dirname(oldPath)
      const newPath = path.join(dirName, newName)

      if (await fs.pathExists(newPath)) {
        throw new Error('目标文件已存在')
      }

      await fs.move(oldPath, newPath)
      return newPath
    } catch (error) {
      console.error('Failed to rename file:', error)
      throw error
    }
  })

  // 复制文件
  ipcMain.handle('fs:copyFile', async (_, srcPath: string, destPath: string) => {
    try {
      validateSecurePath(srcPath)
      validateSecurePath(destPath)

      if (!(await fs.pathExists(srcPath))) {
        throw new Error('源文件不存在')
      }

      if (await fs.pathExists(destPath)) {
        throw new Error('目标文件已存在')
      }

      await fs.copy(srcPath, destPath, { overwrite: false })
      return destPath
    } catch (error) {
      console.error('Failed to copy file:', error)
      throw error
    }
  })

  // 复制目录
  ipcMain.handle('fs:copyDir', async (_, srcPath: string, destPath: string) => {
    try {
      validateSecurePath(srcPath)
      validateSecurePath(destPath)

      if (!(await fs.pathExists(srcPath))) {
        throw new Error('源目录不存在')
      }

      if (await fs.pathExists(destPath)) {
        throw new Error('目标目录已存在')
      }

      await fs.copy(srcPath, destPath, { overwrite: false })
      return destPath
    } catch (error) {
      console.error('Failed to copy directory:', error)
      throw error
    }
  })

  // 移动文件/文件夹
  ipcMain.handle('fs:moveFile', async (_, srcPath: string, destPath: string) => {
    try {
      validateSecurePath(srcPath)
      validateSecurePath(destPath)

      if (!(await fs.pathExists(srcPath))) {
        throw new Error('源文件不存在')
      }

      if (await fs.pathExists(destPath)) {
        throw new Error('目标文件已存在')
      }

      await fs.move(srcPath, destPath)
      return destPath
    } catch (error) {
      console.error('Failed to move file:', error)
      throw error
    }
  })

  // 检查文件是否存在
  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    try {
      validatePath(filePath)
      return await fs.pathExists(filePath)
    } catch (error) {
      console.error('Failed to check file existence:', error)
      return false
    }
  })

  // 检查是否为目录
  ipcMain.handle('fs:isDirectory', async (_, filePath: string) => {
    try {
      validatePath(filePath)
      const stats = await fs.stat(filePath)
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
