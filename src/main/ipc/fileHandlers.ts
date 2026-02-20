import { BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import chokidar from 'chokidar'
import { IPCContext } from './context'
import { setAllowedBasePath, validateSecurePath, validatePath } from '../security'

// 文件信息接口
interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  children?: FileInfo[]
}

// ============== 文件监听器状态 ==============

let fileWatcher: ReturnType<typeof chokidar.watch> | null = null
let watchedDir: string | null = null
let _baseFolderPath: string | null = null
const watchedFiles = new Set<string>()

let watchedWebContentsId: number | null = null

// 每个窗口独立的文件监听器
interface WindowWatcherState {
  watcher: ReturnType<typeof chokidar.watch>
  dir: string
  files: Set<string>
}
const windowFileWatchers = new Map<number, WindowWatcherState>()

// 重命名检测
let pendingUnlink: { path: string; timestamp: number } | null = null
const RENAME_THRESHOLD_MS = 500

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

// 安全发送函数
function safeSendToRenderer(channel: string, data: unknown): void {
  if (watchedWebContentsId === null) return

  const allWindows = BrowserWindow.getAllWindows()
  const targetWindow = allWindows.find(w => w.webContents.id === watchedWebContentsId)

  if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send(channel, data)
  }
}

// 监听目录
function watchDirectory(dirPath: string, sender: Electron.WebContents): void {
  if (watchedDir === dirPath && fileWatcher) {
    return
  }

  if (fileWatcher) {
    fileWatcher.close()
    fileWatcher = null
  }
  watchedDir = dirPath
  pendingUnlink = null
  watchedWebContentsId = sender.id

  console.log(`[WATCHER] Watching directory: ${dirPath}`)

  fileWatcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    depth: WATCHER_CONFIG.MAX_DEPTH,
    ignored: [
      ...WATCHER_CONFIG.IGNORED_PATTERNS,
      (filePath: string, stats?: fs.Stats) => {
        if (!stats) return false
        if (stats.isDirectory()) return false
        return !filePath.endsWith('.md')
      }
    ],
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  })

  fileWatcher.on('error', (error: unknown) => {
    console.error('[WATCHER] Error:', error)
  })

  fileWatcher.on('ready', () => {
    const watched = fileWatcher?.getWatched() || {}
    let fileCount = 0
    let dirCount = 0
    for (const dir of Object.keys(watched)) {
      dirCount++
      fileCount += watched[dir].length
    }
    console.log(`[WATCHER] Ready! Watching ${dirCount} directories, ${fileCount} files`)
  })

  fileWatcher.on('change', (filePath: string) => {
    console.log(`[WATCHER] File changed: ${filePath}`)
    safeSendToRenderer('file:changed', filePath)
  })

  fileWatcher.on('add', (filePath: string) => {
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

  fileWatcher.on('unlink', (filePath: string) => {
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

  fileWatcher.on('addDir', (addedDirPath: string) => {
    if (addedDirPath !== dirPath) {
      console.log(`[WATCHER] Directory added: ${addedDirPath}`)
      safeSendToRenderer('folder:added', addedDirPath)
    }
  })

  fileWatcher.on('unlinkDir', (removedDirPath: string) => {
    console.log(`[WATCHER] Directory removed: ${removedDirPath}`)
    safeSendToRenderer('folder:removed', removedDirPath)
  })
}

// 使用 glob 快速扫描 .md 文件
async function scanMarkdownFiles(rootPath: string): Promise<FileInfo[]> {
  const { glob } = await import('glob')

  const mdFiles = await glob('**/*.md', {
    cwd: rootPath,
    ignore: ['**/node_modules/**', '**/.*/**', '**/venv/**', '**/.venv/**', '**/env/**'],
    nodir: true,
    absolute: false
  })

  return buildFileTree(rootPath, mdFiles)
}

// 从 glob 结果构建文件树
function buildFileTree(rootPath: string, relativePaths: string[]): FileInfo[] {
  const tree: FileInfo[] = []
  const dirMap = new Map<string, FileInfo>()

  for (const relativePath of relativePaths) {
    const parts = relativePath.split(/[\\/]/)
    const fileName = parts.pop()!
    const fullPath = path.join(rootPath, relativePath)

    if (parts.length === 0) {
      tree.push({
        name: fileName,
        path: fullPath,
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
    windowFileWatchers,
    fileWatcher: () => fileWatcher,
    watchedWebContentsId: () => watchedWebContentsId,
    cleanup: (webContentsId: number) => {
      const watcher = windowFileWatchers.get(webContentsId)
      if (watcher) {
        console.log(`[WATCHER] Window ${webContentsId} closing, cleaning up file watcher`)
        watcher.watcher.close()
        windowFileWatchers.delete(webContentsId)
      }
      if (fileWatcher && webContentsId === watchedWebContentsId) {
        console.log('[WATCHER] Window closing, cleaning up global file watcher')
        fileWatcher.close()
        fileWatcher = null
        watchedDir = null
        watchedWebContentsId = null
        watchedFiles.clear()
      }
    }
  }
}

export function registerFileHandlers(ctx: IPCContext): void {
  // 打开文件夹对话框
  ipcMain.handle('dialog:openFolder', async () => {
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
    console.log(`[SECURITY] Set allowed base path: ${folderPath}`)

    return folderPath
  })

  // 读取目录
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    try {
      validatePath(dirPath)

      const startTime = Date.now()
      const result = await scanMarkdownFiles(dirPath)
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
    const logFile = '/tmp/md-viewer-main-debug.log'
    const log = (msg: string) => {
      const timestamp = new Date().toISOString()
      const logLine = `[${timestamp}] ${msg}\n`
      require('fs').appendFileSync(logFile, logLine)
      console.log(msg)
    }

    try {
      validatePath(filePath)

      log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      log(`[MAIN] 📖 fs:readFile called for: ${filePath}`)

      const statsStart = Date.now()
      const stats = await fs.stat(filePath)
      log(`[MAIN] ✅ fs.stat() completed in ${Date.now() - statsStart}ms`)
      log(`[MAIN] File size: ${stats.size} bytes`)

      const MAX_SIZE = 5 * 1024 * 1024

      if (stats.size > MAX_SIZE) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
        log(`[MAIN] ❌ File too large: ${sizeMB}MB`)
        throw new Error(`文件过大 (${sizeMB}MB)，请选择小于 5MB 的文件`)
      }

      const readStart = Date.now()
      const content = await fs.readFile(filePath, 'utf-8')
      log(`[MAIN] ✅ fs.readFile() completed in ${Date.now() - readStart}ms`)
      log(`[MAIN] Content length: ${content.length} chars`)
      log(`[MAIN] 🎉 Returning content to renderer`)
      log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

      return content
    } catch (error) {
      log(`[MAIN] ❌ Error reading file: ${error}`)
      if (error instanceof Error) {
        throw error
      }
      console.error('Failed to read file:', error)
      return ''
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

    console.log(`[MAIN] File opened: ${filePath}`)
    return { success: true }
  })

  // 停止监听
  ipcMain.handle('fs:unwatchFolder', async () => {
    if (fileWatcher) {
      await fileWatcher.close()
      fileWatcher = null
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
}
