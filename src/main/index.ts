import { app, BrowserWindow, shell, ipcMain, dialog, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs-extra'
import * as path from 'path'
import Store from 'electron-store'
import chokidar from 'chokidar'
import { setAllowedBasePath, validateSecurePath, validatePath } from './security'
import { showContextMenu } from './contextMenuHandler'
import { showTabContextMenu, TabMenuContext } from './tabMenuHandler'
import { showMarkdownContextMenu, MarkdownMenuContext } from './markdownMenuHandler'
import { syncClipboardState, getClipboardState } from './clipboardState'
import { registerWindowShortcuts } from './shortcuts'
import { readFilesFromSystemClipboard, writeFilesToSystemClipboard, hasFilesInSystemClipboard } from './clipboardManager'

// 定义存储的数据结构
interface AppState {
  lastOpenedFolder: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
}

// 初始化 electron-store
const store = new Store<AppState>({
  defaults: {
    lastOpenedFolder: null,
    windowBounds: {
      width: 1200,
      height: 800
    }
  }
})

function createWindow(): void {
  // 从 store 恢复窗口大小和位置
  const savedBounds = store.get('windowBounds')

  const mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,  // ✅ 启用 Chromium 沙箱
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()

    // 🔧 开发模式下自动打开 DevTools
    if (is.dev) {
      mainWindow.webContents.openDevTools()
    }

    // ⌨️ 注册窗口快捷键 (v1.2.1)
    registerWindowShortcuts(mainWindow)

    // 恢复上次打开的文件夹（跳过测试环境）
    if (process.env.MD_VIEWER_SKIP_RESTORE !== '1') {
      const lastFolder = store.get('lastOpenedFolder')
      if (lastFolder) {
        // ✅ 设置安全白名单基础路径
        setAllowedBasePath(lastFolder)
        mainWindow.webContents.send('restore-folder', lastFolder)
      }
    }
  })

  // 窗口关闭前保存状态
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds()
    store.set('windowBounds', bounds)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境加载 dev server，生产环境加载打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 设置 app user model id (Windows)
  electronApp.setAppUserModelId('com.mdviewer')

  // 设置 Content Security Policy
  // 开发模式需要允许 Vite HMR 和 WebSocket
  // 生产模式使用严格的 CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = is.dev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self' ws://localhost:* http://localhost:*; worker-src 'self' blob:;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self';"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  // 开发环境下优化
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ============== IPC Handlers ==============

// 打开文件夹对话框
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  // 保存最后打开的文件夹
  const folderPath = result.filePaths[0]
  store.set('lastOpenedFolder', folderPath)

  // ✅ 设置安全白名单基础路径
  setAllowedBasePath(folderPath)
  console.log(`[SECURITY] Set allowed base path: ${folderPath}`)

  return folderPath
})

// 文件信息接口
interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  children?: FileInfo[]
}

// 使用 glob 快速扫描 .md 文件，而不是递归遍历所有目录
async function scanMarkdownFiles(rootPath: string): Promise<FileInfo[]> {
  const { glob } = await import('glob')

  // 直接用 glob 找所有 .md 文件，自动忽略 node_modules 等
  const mdFiles = await glob('**/*.md', {
    cwd: rootPath,
    ignore: ['**/node_modules/**', '**/.*/**', '**/venv/**', '**/.venv/**', '**/env/**'],
    nodir: true,
    absolute: false
  })

  // 构建文件树结构
  const root: Map<string, FileInfo> = new Map()

  for (const relativePath of mdFiles) {
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    const fullPath = path.join(rootPath, relativePath)

    // 确保父目录存在
    let currentPath = ''
    let currentMap = root

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const dirFullPath = path.join(rootPath, currentPath)

      if (!currentMap.has(part)) {
        const dirInfo: FileInfo = {
          name: part,
          path: dirFullPath,
          isDirectory: true,
          children: []
        }
        currentMap.set(part, dirInfo)
      }

      const dir = currentMap.get(part)!
      if (!dir.children) dir.children = []

      // 为下一层准备 map
      const childMap = new Map<string, FileInfo>()
      for (const child of dir.children) {
        childMap.set(child.name, child)
      }
      currentMap = childMap
    }

    // 添加文件
    const fileInfo: FileInfo = {
      name: fileName,
      path: fullPath,
      isDirectory: false
    }
    currentMap.set(fileName, fileInfo)
  }

  // 转换为数组并排序
  function mapToArray(map: Map<string, FileInfo>, _parentPath: string): FileInfo[] {
    const result: FileInfo[] = []

    for (const [_name, info] of map) {
      if (info.isDirectory && info.children) {
        // 重建子目录的 children
        const childMap = new Map<string, FileInfo>()
        for (const child of info.children) {
          childMap.set(child.name, child)
        }
        info.children = mapToArray(childMap, info.path)
      }
      result.push(info)
    }

    // 目录优先，然后按名称排序
    return result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
  }

  // 简化：直接从 glob 结果构建扁平树
  return buildFileTree(rootPath, mdFiles)
}

// 从 glob 结果构建文件树
function buildFileTree(rootPath: string, relativePaths: string[]): FileInfo[] {
  const tree: FileInfo[] = []
  const dirMap = new Map<string, FileInfo>()

  for (const relativePath of relativePaths) {
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    const fullPath = path.join(rootPath, relativePath)

    if (parts.length === 0) {
      // 根目录下的文件
      tree.push({
        name: fileName,
        path: fullPath,
        isDirectory: false
      })
    } else {
      // 确保目录链存在
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

      // 添加文件到最深目录
      parent.push({
        name: fileName,
        path: fullPath,
        isDirectory: false
      })
    }
  }

  // 递归排序
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

// 读取目录 - 使用 glob 快速扫描
ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
  try {
    // ✅ 安全校验：检查路径是否在允许范围内
    validatePath(dirPath)

    const startTime = Date.now()
    const result = await scanMarkdownFiles(dirPath)
    console.log(`[MAIN] Scanned ${dirPath} in ${Date.now() - startTime}ms, found ${result.length} items`)
    return result
  } catch (error) {
    console.error('Failed to read directory:', error)
    // 安全错误需要抛出，而不是返回空数组
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
    // ✅ 安全校验：检查路径是否在允许范围内
    validatePath(filePath)

    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    log(`[MAIN] 📖 fs:readFile called for: ${filePath}`)

    const statsStart = Date.now()
    const stats = await fs.stat(filePath)
    log(`[MAIN] ✅ fs.stat() completed in ${Date.now() - statsStart}ms`)
    log(`[MAIN] File size: ${stats.size} bytes`)

    const MAX_SIZE = 5 * 1024 * 1024 // 5MB 限制

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

// 导出 HTML
ipcMain.handle('export:html', async (_, htmlContent: string, fileName: string) => {
  try {
    const result = await dialog.showSaveDialog({
      title: '导出 HTML',
      defaultPath: fileName.replace(/\.md$/, '.html'),
      filters: [
        { name: 'HTML Files', extensions: ['html'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 读取 CSS 文件 - 使用正确的路径
    let markdownCss = ''
    let prismCss = ''

    try {
      // 开发环境路径
      if (is.dev) {
        const srcPath = join(__dirname, '../../src/renderer/src/assets')
        markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
      } else {
        // 生产环境路径
        const assetsPath = join(__dirname, '../renderer/assets')
        markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
      }
    } catch (cssError) {
      console.error('Failed to read CSS files:', cssError)
      // 如果CSS文件读取失败，使用内联的基础样式
      markdownCss = `
        .markdown-body { font-size: 16px; line-height: 1.6; }
        .markdown-body h1 { font-size: 2em; margin: 0.67em 0; }
        .markdown-body h2 { font-size: 1.5em; margin: 0.75em 0; }
        .markdown-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; }
        .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
      `
      prismCss = ''
    }

    // KaTeX CSS (使用 CDN)
    const katexCss = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'

    // 生成完整 HTML
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  ${katexCss}
  <style>
    :root {
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --border-color: #d0d7de;
      --accent-color: #0969da;
    }

    body {
      margin: 0;
      padding: 20px;
      background: var(--bg-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-radius: 6px;
    }

    ${markdownCss}
    ${prismCss}
  </style>
</head>
<body>
  <div class="container">
    <div class="markdown-body">
      ${htmlContent}
    </div>
  </div>
</body>
</html>`

    await fs.writeFile(result.filePath, fullHtml, 'utf-8')
    return result.filePath
  } catch (error) {
    console.error('Failed to export HTML:', error)
    throw error
  }
})

// 导出 PDF
ipcMain.handle('export:pdf', async (event, htmlContent: string, fileName: string) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出 PDF',
      defaultPath: fileName.replace(/\.md$/, '.pdf'),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 创建一个隐藏的窗口用于打印
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 读取 CSS 文件
    let markdownCss = ''
    let prismCss = ''

    try {
      if (is.dev) {
        const srcPath = join(__dirname, '../../src/renderer/src/assets')
        markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
      } else {
        const assetsPath = join(__dirname, '../renderer/assets')
        markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
        prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
      }
    } catch (cssError) {
      console.error('Failed to read CSS files:', cssError)
      markdownCss = `
        .markdown-body { font-size: 16px; line-height: 1.6; }
        .markdown-body h1 { font-size: 2em; margin: 0.67em 0; }
        .markdown-body h2 { font-size: 1.5em; margin: 0.75em 0; }
        .markdown-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; }
        .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
      `
      prismCss = ''
    }

    // 生成 PDF 专用的 HTML
    const pdfHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      margin: 20mm;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: white;
    }

    :root {
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --border-color: #d0d7de;
      --accent-color: #0969da;
    }

    ${markdownCss}
    ${prismCss}

    /* PDF 专用样式 */
    @media print {
      body { margin: 0; }
      .markdown-body { max-width: none; }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    ${htmlContent}
  </div>
</body>
</html>`

    // 加载 HTML 内容
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfHtml)}`)

    // 等待页面加载完成
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 打印为 PDF
    const pdfData = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true
    })

    // 关闭打印窗口
    printWindow.close()

    await fs.writeFile(result.filePath, pdfData)
    return result.filePath
  } catch (error) {
    console.error('Failed to export PDF:', error)
    throw error
  }
})

// ============================================================
// 文件监听器 - 简化版：只监听当前打开文件所在的单个目录
// ============================================================
let fileWatcher: ReturnType<typeof chokidar.watch> | null = null
let watchedDir: string | null = null           // 当前监听的目录
let _baseFolderPath: string | null = null      // 用户打开的根目录（保留备用）
const watchedFiles = new Set<string>()         // 已打开的文件列表

// v1.3：重命名检测
let pendingUnlink: { path: string; timestamp: number } | null = null
const RENAME_THRESHOLD_MS = 500

/**
 * 监听单个目录（当前打开文件所在目录）
 * 不递归，只监听该目录下的直接子文件
 */
function watchDirectory(dirPath: string, sender: Electron.WebContents): void {
  // 如果已经在监听这个目录，跳过
  if (watchedDir === dirPath && fileWatcher) {
    return
  }

  // 关闭之前的监听
  if (fileWatcher) {
    fileWatcher.close()
    fileWatcher = null
  }
  watchedDir = dirPath
  pendingUnlink = null

  console.log(`[WATCHER] Watching directory: ${dirPath}`)

  // 只监听这一个目录，depth: 0 表示不递归
  fileWatcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,              // ✅ 关键：不递归，只监听当前目录
    ignored: ['**/.*'],    // 忽略隐藏文件
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  })

  fileWatcher.on('error', (error: unknown) => {
    console.error('[WATCHER] Error:', error)
  })

  // 文件内容变化
  fileWatcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md')) {
      console.log(`[WATCHER] File changed: ${filePath}`)
      sender.send('file:changed', filePath)
    }
  })

  // 文件添加（可能是重命名的第二步）
  fileWatcher.on('add', (filePath: string) => {
    if (!filePath.endsWith('.md')) return

    if (pendingUnlink && Date.now() - pendingUnlink.timestamp < RENAME_THRESHOLD_MS) {
      // 重命名操作
      console.log(`[WATCHER] File renamed: ${pendingUnlink.path} -> ${filePath}`)
      sender.send('file:renamed', { oldPath: pendingUnlink.path, newPath: filePath })
      pendingUnlink = null
    } else {
      console.log(`[WATCHER] File added: ${filePath}`)
      sender.send('file:added', filePath)
    }
  })

  // 文件删除（可能是重命名的第一步）
  fileWatcher.on('unlink', (filePath: string) => {
    if (!filePath.endsWith('.md')) return

    console.log(`[WATCHER] File unlinked: ${filePath}`)
    pendingUnlink = { path: filePath, timestamp: Date.now() }

    setTimeout(() => {
      if (pendingUnlink && pendingUnlink.path === filePath) {
        console.log(`[WATCHER] File removed: ${filePath}`)
        sender.send('file:removed', filePath)
        watchedFiles.delete(filePath)
        pendingUnlink = null
      }
    }, RENAME_THRESHOLD_MS + 50)
  })

  // 子目录添加
  fileWatcher.on('addDir', (addedDirPath: string) => {
    if (addedDirPath !== dirPath) {
      console.log(`[WATCHER] Directory added: ${addedDirPath}`)
      sender.send('folder:added', addedDirPath)
    }
  })

  // 子目录删除
  fileWatcher.on('unlinkDir', (removedDirPath: string) => {
    console.log(`[WATCHER] Directory removed: ${removedDirPath}`)
    sender.send('folder:removed', removedDirPath)
  })
}

// 初始化文件夹监听（用户打开文件夹时调用）
// 注意：这里不再监听整个目录树，只记录根路径
ipcMain.handle('fs:watchFolder', async (_event, folderPath: string) => {
  try {
    validatePath(folderPath)
    _baseFolderPath = folderPath
    watchedFiles.clear()

    // 不立即监听任何目录，等用户点击文件时再监听该文件所在目录
    console.log(`[MAIN] Base folder set: ${folderPath}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to set base folder:', error)
    throw error
  }
})

// 当用户打开文件时，监听该文件所在目录
ipcMain.handle('fs:watchFile', async (event, filePath: string) => {
  validatePath(filePath)

  watchedFiles.add(filePath)

  // 获取文件所在目录，开始监听
  const dirPath = path.dirname(filePath)
  watchDirectory(dirPath, event.sender)

  console.log(`[MAIN] File opened: ${filePath}, watching dir: ${dirPath}`)
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

// ============== 右键菜单 Handlers ==============

// 显示文件树右键菜单
ipcMain.handle('context-menu:show', async (event, file: FileInfo, basePath: string) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showContextMenu(window, file, basePath)
  return { success: true }
})

// v1.3 新增：显示 Tab 右键菜单
ipcMain.handle('tab:show-context-menu', async (event, ctx: TabMenuContext) => {
  // ⚠️ 安全校验（安全审计师要求）
  validatePath(ctx.filePath)
  validatePath(ctx.basePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showTabContextMenu(window, ctx)
  return { success: true }
})

// v1.3 阶段 2：显示 Markdown 右键菜单
ipcMain.handle('markdown:show-context-menu', async (event, ctx: MarkdownMenuContext) => {
  // ⚠️ 安全校验
  validatePath(ctx.filePath)

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('无法获取窗口实例')
  }

  showMarkdownContextMenu(window, ctx)
  return { success: true }
})

// 重命名文件/文件夹 (v1.2 阶段 1)
ipcMain.handle('fs:rename', async (_, oldPath: string, newName: string) => {
  try {
    // 安全校验
    validateSecurePath(oldPath)

    const dirName = path.dirname(oldPath)
    const newPath = path.join(dirName, newName)

    // 检查新路径是否已存在
    if (await fs.pathExists(newPath)) {
      throw new Error('目标文件已存在')
    }

    // 使用 fs-extra 的 move 方法（支持跨分区移动）
    await fs.move(oldPath, newPath)

    return newPath
  } catch (error) {
    console.error('Failed to rename file:', error)
    throw error
  }
})

// 复制文件 (v1.2 阶段 2)
ipcMain.handle('fs:copyFile', async (_, srcPath: string, destPath: string) => {
  try {
    // 安全校验
    validateSecurePath(srcPath)
    validateSecurePath(destPath)

    // 检查源文件是否存在
    if (!(await fs.pathExists(srcPath))) {
      throw new Error('源文件不存在')
    }

    // 检查目标文件是否已存在
    if (await fs.pathExists(destPath)) {
      throw new Error('目标文件已存在')
    }

    // 复制文件
    await fs.copy(srcPath, destPath, { overwrite: false })

    return destPath
  } catch (error) {
    console.error('Failed to copy file:', error)
    throw error
  }
})

// 复制目录（递归） (v1.2 阶段 2)
ipcMain.handle('fs:copyDir', async (_, srcPath: string, destPath: string) => {
  try {
    // 安全校验
    validateSecurePath(srcPath)
    validateSecurePath(destPath)

    // 检查源目录是否存在
    if (!(await fs.pathExists(srcPath))) {
      throw new Error('源目录不存在')
    }

    // 检查目标目录是否已存在
    if (await fs.pathExists(destPath)) {
      throw new Error('目标目录已存在')
    }

    // 递归复制目录
    await fs.copy(srcPath, destPath, { overwrite: false })

    return destPath
  } catch (error) {
    console.error('Failed to copy directory:', error)
    throw error
  }
})

// 移动文件/文件夹 (v1.2 阶段 2)
ipcMain.handle('fs:moveFile', async (_, srcPath: string, destPath: string) => {
  try {
    // 安全校验
    validateSecurePath(srcPath)
    validateSecurePath(destPath)

    // 检查源是否存在
    if (!(await fs.pathExists(srcPath))) {
      throw new Error('源文件不存在')
    }

    // 检查目标是否已存在
    if (await fs.pathExists(destPath)) {
      throw new Error('目标文件已存在')
    }

    // 移动文件/文件夹（支持跨分区）
    await fs.move(srcPath, destPath)

    return destPath
  } catch (error) {
    console.error('Failed to move file:', error)
    throw error
  }
})

// 检查文件/目录是否存在 (v1.2 阶段 2)
ipcMain.handle('fs:exists', async (_, filePath: string) => {
  try {
    validatePath(filePath)
    return await fs.pathExists(filePath)
  } catch (error) {
    console.error('Failed to check file existence:', error)
    return false
  }
})

// 检查是否为目录 (v1.2 阶段 2)
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

// ============== v1.3 阶段 3：剪贴板状态同步 ==============

// 同步剪贴板状态
ipcMain.handle('clipboard:sync-state', async (_, files: string[], isCut: boolean) => {
  syncClipboardState(files, isCut)
})

// 查询剪贴板状态
ipcMain.handle('clipboard:query-state', async () => {
  return getClipboardState()
})

// v1.3 阶段 6：从系统剪贴板读取文件
ipcMain.handle('clipboard:read-system', async () => {
  const files = readFilesFromSystemClipboard()
  console.log('[CLIPBOARD] Read from system:', files.length, 'files')
  return files
})

// v1.3 阶段 6：写入文件到系统剪贴板
ipcMain.handle('clipboard:write-system', async (_, paths: string[], isCut: boolean) => {
  const result = writeFilesToSystemClipboard(paths, isCut)
  console.log('[CLIPBOARD] Write to system:', paths.length, 'files, success:', result)
  return result
})

// v1.3 阶段 6：检查系统剪贴板是否有文件
ipcMain.handle('clipboard:has-system-files', async () => {
  return hasFilesInSystemClipboard()
})
