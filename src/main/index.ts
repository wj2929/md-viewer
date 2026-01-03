import { app, BrowserWindow, shell, ipcMain, dialog, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs/promises'
import * as path from 'path'
import Store from 'electron-store'
import chokidar from 'chokidar'
import { setAllowedBasePath, validateSecurePath, validatePath } from './security'

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

    // 恢复上次打开的文件夹
    const lastFolder = store.get('lastOpenedFolder')
    if (lastFolder) {
      mainWindow.webContents.send('restore-folder', lastFolder)
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
  function mapToArray(map: Map<string, FileInfo>, parentPath: string): FileInfo[] {
    const result: FileInfo[] = []

    for (const [name, info] of map) {
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
      marginsType: 0,  // 使用默认边距
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

// 文件监听器 - 只监听已打开的文件，而不是整个目录
let fileWatcher: chokidar.FSWatcher | null = null
let watchedFolder: string | null = null
const watchedFiles = new Set<string>()

// 开始监听文件夹（轻量级：只记录路径，不实际监听整个目录）
ipcMain.handle('fs:watchFolder', async (event, folderPath: string) => {
  try {
    // ✅ 安全校验：检查路径是否在允许范围内
    validatePath(folderPath)

    // 停止之前的监听
    if (fileWatcher) {
      await fileWatcher.close()
      fileWatcher = null
    }
    watchedFiles.clear()
    watchedFolder = folderPath

    // 创建空的 watcher，后续通过 watchFile 添加具体文件
    fileWatcher = chokidar.watch([], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    // 错误处理
    fileWatcher.on('error', (error) => {
      console.error('File watcher error:', error)
      event.sender.send('file:watch-error', error.message)
    })

    // 文件变化事件
    fileWatcher.on('change', (filePath) => {
      event.sender.send('file:changed', filePath)
    })

    // 文件删除事件
    fileWatcher.on('unlink', (filePath) => {
      event.sender.send('file:removed', filePath)
      watchedFiles.delete(filePath)
    })

    console.log(`[MAIN] Folder watch initialized for: ${folderPath}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to init folder watch:', error)
    throw error
  }
})

// 添加单个文件到监听列表
ipcMain.handle('fs:watchFile', async (_, filePath: string) => {
  // ✅ 安全校验：检查路径是否在允许范围内
  validatePath(filePath)

  if (fileWatcher && !watchedFiles.has(filePath)) {
    fileWatcher.add(filePath)
    watchedFiles.add(filePath)
    console.log(`[MAIN] Now watching file: ${filePath}`)
  }
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
