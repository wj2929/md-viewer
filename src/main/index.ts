import { app, BrowserWindow, shell, ipcMain, dialog, session, Menu, clipboard, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import Store from 'electron-store'
import chokidar from 'chokidar'
import { setAllowedBasePath, getAllowedBasePath, validateSecurePath, validatePath } from './security'
import { showContextMenu } from './contextMenuHandler'
import { showTabContextMenu, TabMenuContext } from './tabMenuHandler'
import { showMarkdownContextMenu, MarkdownMenuContext } from './markdownMenuHandler'
import { syncClipboardState, getClipboardState } from './clipboardState'
import { registerWindowShortcuts } from './shortcuts'
import { readFilesFromSystemClipboard, writeFilesToSystemClipboard, hasFilesInSystemClipboard } from './clipboardManager'
import { folderHistoryManager } from './folderHistoryManager'
import * as contextMenuManager from './contextMenuManager'
import { validateSecurePath as validateLaunchPath } from './security/pathValidator'
import { appDataManager } from './appDataManager'
import { exportToDocx, ChartImageData } from './docxExporter'
import { exportWithPandoc, isPandocAvailable } from './pandocExporter'
import { installEpipeHandler } from './safeLog'

// 安装 EPIPE 错误处理器（防止开发模式下终端断开导致应用崩溃）
installEpipeHandler()

// 定义存储的数据结构
interface AppState {
  lastOpenedFolder: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
  // v1.4.2: 窗口置顶状态
  alwaysOnTop: boolean
}

// 初始化 electron-store
const store = new Store<AppState>({
  defaults: {
    lastOpenedFolder: null,
    windowBounds: {
      width: 1200,
      height: 800
    },
    // v1.4.2: 默认不置顶
    alwaysOnTop: false
  }
})

// 模块级窗口引用（用于启动参数处理）
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // 从 store 恢复窗口大小和位置
  const savedBounds = store.get('windowBounds')

  mainWindow = new BrowserWindow({
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
    if (!mainWindow) return
    mainWindow.show()

    // v1.4.2: 恢复窗口置顶状态
    const alwaysOnTop = store.get('alwaysOnTop', false)
    if (alwaysOnTop) {
      mainWindow.setAlwaysOnTop(true)
    }

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
    if (!mainWindow) return
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

// 存储待处理的启动路径
let pendingLaunchPath: string | null = null

// 处理启动参数
async function handleLaunchArgs(args: string[]): Promise<void> {
  const userArgs = args.filter(arg =>
    !arg.startsWith('--') &&
    !arg.startsWith('-') &&
    arg !== '.' &&
    !arg.toLowerCase().includes('electron') &&
    !arg.endsWith('.js')
  )

  if (userArgs.length === 0) return

  const targetPath = userArgs[userArgs.length - 1]
  console.log('[Launch] Processing path:', targetPath)

  const validation = await validateLaunchPath(targetPath)
  if (!validation.valid) {
    console.error('[Launch] Invalid path:', validation.error)
    return
  }

  if (mainWindow) {
    openPathInWindow(validation.normalizedPath, validation.type as 'md-file' | 'directory')
  } else {
    pendingLaunchPath = validation.normalizedPath
  }
}

// 在窗口中打开路径
function openPathInWindow(targetPath: string, type: 'md-file' | 'directory'): void {
  if (!mainWindow) return

  if (type === 'directory') {
    setAllowedBasePath(targetPath)
    store.set('lastOpenedFolder', targetPath)
    folderHistoryManager.addFolder(targetPath)
    mainWindow.webContents.send('restore-folder', targetPath)
  } else {
    const folderPath = path.dirname(targetPath)
    setAllowedBasePath(folderPath)
    store.set('lastOpenedFolder', folderPath)
    folderHistoryManager.addFolder(folderPath)
    mainWindow.webContents.send('restore-folder', folderPath)
    setTimeout(() => {
      mainWindow?.webContents.send('open-specific-file', targetPath)
    }, 500)
  }
}

// macOS: 处理 open-file 事件（在 app ready 之前也可能触发）
app.on('open-file', async (event, filePath) => {
  event.preventDefault()
  console.log('[macOS] open-file event received:', filePath)
  console.log('[macOS] mainWindow exists:', !!mainWindow)
  console.log('[macOS] app.isReady:', app.isReady())
  await handleLaunchArgs([filePath])
})

// macOS: 处理 open-url 事件
app.on('open-url', async (event, url) => {
  event.preventDefault()
  console.log('[macOS] open-url event:', url)
})

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

    // v1.4.7: 窗口关闭时清理文件监听器，防止内存泄漏
    // 使用 'close' 事件（关闭前）而非 'closed'（关闭后），避免访问已销毁对象
    const windowWebContentsId = window.webContents.id  // 提前保存 ID
    window.on('close', () => {
      if (fileWatcher && windowWebContentsId === watchedWebContentsId) {
        console.log('[WATCHER] Window closing, cleaning up file watcher')
        fileWatcher.close()
        fileWatcher = null
        watchedDir = null
        watchedWebContentsId = null
        watchedFiles.clear()
      }
    })
  })

  createWindow()

  // v1.3.6：后台验证最近文件路径有效性（不阻塞启动）
  appDataManager.validateRecentFilesInBackground()

  // 处理待处理的启动路径
  if (pendingLaunchPath) {
    setTimeout(async () => {
      if (pendingLaunchPath) {
        const validation = await validateLaunchPath(pendingLaunchPath)
        if (validation.valid) {
          openPathInWindow(validation.normalizedPath, validation.type as 'md-file' | 'directory')
        }
        pendingLaunchPath = null
      }
    }, 1000)
  }

  // 所有平台：处理命令行参数
  // macOS 的 open -a 命令也会通过命令行参数传递路径
  handleLaunchArgs(process.argv.slice(1))

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

  // ✅ 添加到历史文件夹列表
  await folderHistoryManager.addFolder(folderPath)

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
    // 兼容 Windows 和 Unix 路径分隔符
    const parts = relativePath.split(/[\\/]/)
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
    // 兼容 Windows 和 Unix 路径分隔符
    const parts = relativePath.split(/[\\/]/)
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

// 获取导出用的完整 CSS（包含所有必需的变量和样式）
async function getExportStyles(): Promise<{ markdownCss: string; prismCss: string }> {
  let markdownCss = ''
  let prismCss = ''

  try {
    // 开发环境路径
    if (is.dev) {
      const srcPath = join(__dirname, '../../src/renderer/src/assets')
      markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
      prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
    } else {
      // 生产环境：尝试多个可能的路径
      const possiblePaths = [
        join(__dirname, '../renderer/assets'),
        join(__dirname, '../renderer'),
        join(app.getAppPath(), 'out/renderer/assets'),
        join(app.getAppPath(), 'out/renderer')
      ]

      for (const assetsPath of possiblePaths) {
        try {
          // 尝试直接读取文件
          markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
          prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
          break
        } catch {
          // 尝试读取合并后的 CSS 文件（Vite 可能会重命名）
          try {
            const files = await fs.readdir(assetsPath)
            const cssFile = files.find(f => f.endsWith('.css') && f.startsWith('index'))
            if (cssFile) {
              const combinedCss = await fs.readFile(join(assetsPath, cssFile), 'utf-8')
              // 提取 markdown-body 和 token 相关样式
              markdownCss = combinedCss
              prismCss = ''
              break
            }
          } catch {
            continue
          }
        }
      }
    }
  } catch (cssError) {
    console.error('Failed to read CSS files:', cssError)
  }

  // 如果仍然没有样式，使用内嵌的完整样式
  if (!markdownCss) {
    markdownCss = getBuiltinMarkdownCSS()
    prismCss = getBuiltinPrismCSS()
  }

  return { markdownCss, prismCss }
}

// 内置的完整 Markdown 样式
function getBuiltinMarkdownCSS(): string {
  return `
.markdown-body {
  font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  word-wrap: break-word;
}

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  line-height: 1.2;
  margin-top: 1em;
  margin-bottom: 16px;
  color: var(--text-strong);
  font-weight: 600;
}

.markdown-body h1 { font-size: 2.25em; font-weight: 300; }
.markdown-body h2 { font-size: 1.75em; font-weight: 400; }
.markdown-body h3 { font-size: 1.5em; font-weight: 500; }
.markdown-body h4 { font-size: 1.25em; }
.markdown-body h5, .markdown-body h6 { font-size: 1em; }
.markdown-body h6 { color: var(--text-secondary); }

.markdown-body strong { color: var(--text-strong); font-weight: 600; }
.markdown-body a { color: #08c; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body p, .markdown-body ul, .markdown-body ol,
.markdown-body blockquote, .markdown-body table, .markdown-body pre {
  margin-bottom: 16px;
}

.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }

.markdown-body blockquote {
  padding: 0 1em;
  color: var(--text-secondary);
  border-left: 4px solid var(--blockquote-border);
  background: var(--blockquote-bg);
}

.markdown-body code {
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 85%;
  background: var(--inline-code-bg);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

.markdown-body pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background: var(--code-block-bg);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.markdown-body pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
}

.markdown-body th, .markdown-body td {
  padding: 6px 13px;
  border: 1px solid var(--border-color);
}

.markdown-body th {
  font-weight: 600;
  background: var(--table-header-bg);
}

.markdown-body tr:nth-child(2n) {
  background: var(--bg-secondary);
}

.markdown-body hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--hr-color);
  border: 0;
}

.markdown-body img {
  max-width: 100%;
  box-sizing: content-box;
}

.markdown-body .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
}
`
}

// 内置的 Prism 代码高亮样式
function getBuiltinPrismCSS(): string {
  return `
code[class*="language-"], pre[class*="language-"] {
  color: var(--text-primary);
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  text-align: left;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  line-height: 1.4;
  tab-size: 4;
}

.token.comment, .token.blockquote { color: #969896; }
.token.cdata { color: #183691; }
.token.doctype, .token.punctuation, .token.variable { color: var(--text-primary); }
.token.operator, .token.important, .token.keyword, .token.rule, .token.builtin { color: #a71d5d; }
.token.string, .token.url, .token.regex, .token.attr-value { color: #183691; }
.token.property, .token.number, .token.boolean, .token.entity, .token.atrule,
.token.constant, .token.symbol, .token.command, .token.code { color: #0086b3; }
.token.tag, .token.selector, .token.prolog { color: #63a35c; }
.token.function, .token.namespace, .token.pseudo-element, .token.class,
.token.class-name, .token.pseudo-class, .token.id, .token.url-reference .token.variable,
.token.attr-name { color: #795da3; }
.token.entity { cursor: help; }
.token.title, .token.title .token.punctuation { font-weight: bold; color: #1d3e81; }
.token.list { color: #ed6a43; }
.token.inserted { background-color: #eaffea; color: #55a532; }
.token.deleted { background-color: #ffecec; color: #bd2c00; }
.token.bold { font-weight: bold; }
.token.italic { font-style: italic; }
`
}

// HTML 转义（用于标题等用户输入）
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, c => map[c])
}

// 生成导出用的完整 HTML 模板（含 CSP 和 Mermaid 支持）
function generateExportHTML(content: string, title: string, markdownCss: string, prismCss: string): string {
  // v1.4.7: 导出 HTML 强制使用亮色主题，移除 dark mode 媒体查询
  // 恢复 .container 包装器以提供两侧间距
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      /* 固定亮色主题变量（不响应系统暗色模式） */
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;
      /* Markdown 样式变量 */
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;
    }

    /* 注意：移除了 @media (prefers-color-scheme: dark) 块，确保导出 HTML 始终为亮色主题 */

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      height: 100%;
      overflow: auto;
    }

    body {
      background: var(--bg-primary);
      font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
      color: var(--text-primary);
    }

    /* 恢复 .container 包装器，提供两侧间距 */
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    /* Mermaid 图表样式 - 固定亮色主题 */
    .mermaid-container {
      display: flex;
      justify-content: center;
      margin: 1.5em 0;
      overflow-x: auto;
    }

    .mermaid-container svg {
      max-width: 100%;
      height: auto;
    }

    .mermaid-error {
      color: #c53030;
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      margin: 1em 0;
      font-size: 14px;
    }

    /* 注意：移除了 .mermaid-error 的 dark mode 样式 */

    /* ECharts 图表样式 - 固定亮色主题 */
    .echarts-container {
      width: 100%;
      max-width: 100%;
      margin: 1.5em 0;
      border-radius: 6px;
      overflow: visible;
      background: transparent;
    }

    .echarts-container svg {
      display: block;
      width: 100% !important;
      height: auto;
      max-width: none;
    }

    .echarts-error {
      color: #c53030;
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      margin: 1em 0;
      font-size: 14px;
    }

    ${markdownCss}
    ${prismCss}
  </style>
</head>
<body>
  <div class="container">
    <div class="markdown-body">
      ${content}
    </div>
  </div>
</body>
</html>`
}

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

    const { markdownCss, prismCss } = await getExportStyles()
    const fullHtml = generateExportHTML(htmlContent, fileName, markdownCss, prismCss)

    await fs.writeFile(result.filePath, fullHtml, 'utf-8')
    return result.filePath
  } catch (error) {
    console.error('Failed to export HTML:', error)
    throw error
  }
})

// 生成 PDF 专用的 HTML 模板（用于打印）
function generatePDFHTML(content: string, markdownCss: string, prismCss: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    :root {
      /* ✅ PDF 使用固定的亮色主题 - 完整版本 */
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;

      /* ✅ Markdown 样式变量（完整） */
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;

      /* ✅ Prism 主题需要的变量 */
      --kbd-border-bottom: #b8b8b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      padding: 10mm;  /* ✅ 减小内边距（因为 printToPDF 已设置 15mm 边距） */
      font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
      background: white;
      color: var(--text-primary);
      line-height: 1.6;  /* ✅ 提升可读性 */
    }

    ${markdownCss}
    ${prismCss}

    /* ECharts 图表样式 - PDF 优化 */
    .echarts-container {
      width: 100%;
      max-width: 100%;
      margin: 1.5em 0;
      border-radius: 6px;
      overflow: visible;
      background: transparent;
    }

    .echarts-container svg {
      display: block;
      width: 100% !important;
      height: auto;
      margin: 0 auto;
    }

    /* ✅ 增强 PDF 打印样式 */
    @media print {
      body {
        padding: 0;  /* 打印时去除内边距（避免双重边距） */
      }

      .markdown-body {
        max-width: none;
      }

      /* 防止元素跨页断裂 */
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3,
      .markdown-body h4,
      .markdown-body h5,
      .markdown-body h6 {
        page-break-after: avoid;
      }

      .markdown-body pre,
      .markdown-body table,
      .markdown-body blockquote {
        page-break-inside: avoid;
      }

      /* 优化代码块显示 */
      .markdown-body pre {
        white-space: pre-wrap;       /* ✅ 自动换行 */
        word-wrap: break-word;
        overflow-x: visible;
      }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    ${content}
  </div>
</body>
</html>`
}

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

    // 获取样式
    const { markdownCss, prismCss } = await getExportStyles()
    const pdfHtml = generatePDFHTML(htmlContent, markdownCss, prismCss)

    // 加载 HTML 内容
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfHtml)}`)

    // ✅ 等待 KaTeX 渲染完成（智能检测，而不是硬编码时间）
    await printWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        // 检查 KaTeX 是否渲染完成
        const checkKatex = () => {
          const katexElements = document.querySelectorAll('.katex')

          // 如果没有 KaTeX 元素，直接完成
          if (katexElements.length === 0) {
            resolve(true)
            return
          }

          // 检查所有 KaTeX 元素是否都已渲染
          const allRendered = Array.from(katexElements).every(el => {
            // KaTeX 渲染完成后会包含 <math> 或 <mrow> 元素
            return el.querySelector('math') || el.querySelector('mrow') || el.querySelector('span.katex-html')
          })

          if (allRendered) {
            resolve(true)
          } else {
            // 每 100ms 检查一次
            setTimeout(checkKatex, 100)
          }
        }

        // 最多等待 5 秒，防止无限等待
        setTimeout(() => resolve(false), 5000)

        // 开始检查
        if (document.readyState === 'complete') {
          checkKatex()
        } else {
          window.addEventListener('load', checkKatex)
        }
      })
    `)

    // ✅ 额外等待 500ms 确保字体完全加载（CDN 字体可能需要额外时间）
    await new Promise(resolve => setTimeout(resolve, 500))

    // 打印为 PDF
    // ⚠️ Electron printToPDF margins 单位是英寸（inches）
    // 10mm ≈ 0.39 inches (10 / 25.4)
    const marginInInches = 10 / 25.4  // 10mm ≈ 0.39 inches
    const pdfData = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      margins: {
        top: marginInInches,     // ✅ 10mm 上边距
        bottom: marginInInches,  // ✅ 10mm 下边距
        left: marginInInches,    // ✅ 10mm 左边距
        right: marginInInches    // ✅ 10mm 右边距
      },
      printBackground: true,
      preferCSSPageSize: false  // ✅ 强制使用 PDF 边距设置
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
// 文件监听器 - v1.4.7 重构：修复内存泄漏和安全问题
// ============================================================
let fileWatcher: ReturnType<typeof chokidar.watch> | null = null
let watchedDir: string | null = null
let _baseFolderPath: string | null = null
const watchedFiles = new Set<string>()

// v1.4.7: 使用 WeakRef 避免 WebContents 引用泄漏
let watchedWebContentsId: number | null = null

// v1.3：重命名检测
let pendingUnlink: { path: string; timestamp: number } | null = null
const RENAME_THRESHOLD_MS = 500

// v1.4.7: 配置常量
const WATCHER_CONFIG = {
  MAX_DEPTH: 2,           // 最大监听深度（降低以提升性能）
  MIN_PATH_DEPTH: 3,      // 最小路径深度（防止监听根目录）
  IGNORED_PATTERNS: [
    '**/.*',              // 隐藏文件
    '**/node_modules/**', // Node.js 依赖
    '**/vendor/**',       // PHP/Go 依赖
    '**/target/**',       // Rust/Java 构建
    '**/build/**',        // 通用构建目录
    '**/dist/**',         // 打包输出
    '**/__pycache__/**',  // Python 缓存
    '**/venv/**',         // Python 虚拟环境
    '**/.venv/**',        // Python 虚拟环境
    '**/coverage/**',     // 测试覆盖率
    '**/*.zip',           // 压缩文件
    '**/*.tar.gz',        // 压缩文件
    '**/batch*/**',       // 批量数据目录
  ],
}

// v1.4.7: 路径安全验证
function isWatchPathSafe(targetPath: string): { safe: boolean; reason?: string } {
  const resolved = path.resolve(targetPath)
  const pathParts = resolved.split(path.sep).filter(Boolean)

  // 检查路径深度（防止监听根目录或 home 目录）
  if (pathParts.length < WATCHER_CONFIG.MIN_PATH_DEPTH) {
    return { safe: false, reason: '目录层级过高，请选择更具体的项目目录' }
  }

  // 检查是否是 home 目录本身
  const homeDir = os.homedir()
  if (resolved === homeDir) {
    return { safe: false, reason: '不能监听用户主目录，请选择子目录' }
  }

  return { safe: true }
}

// v1.4.7: 安全发送函数，检查 WebContents 是否有效
function safeSendToRenderer(channel: string, data: unknown): void {
  if (watchedWebContentsId === null) return

  const allWindows = BrowserWindow.getAllWindows()
  const targetWindow = allWindows.find(w => w.webContents.id === watchedWebContentsId)

  if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send(channel, data)
  }
}

/**
 * 监听目录（用户打开的根目录）
 * v1.4.7: 修复内存泄漏，使用安全发送
 */
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
  watchedWebContentsId = sender.id  // v1.4.7: 保存 ID 而非引用

  console.log(`[WATCHER] Watching directory: ${dirPath}`)

  // v1.4.7: 监听目录，通过 ignored 过滤非 .md 文件
  // 注意：chokidar glob 模式在某些情况下不可靠，改用目录监听 + 过滤
  fileWatcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    depth: WATCHER_CONFIG.MAX_DEPTH,
    ignored: [
      ...WATCHER_CONFIG.IGNORED_PATTERNS,
      // 忽略所有非 .md 文件（但保留目录以便递归）
      (filePath: string, stats?: fs.Stats) => {
        if (!stats) return false  // 未知类型，不忽略
        if (stats.isDirectory()) return false  // 目录不忽略
        return !filePath.endsWith('.md')  // 非 .md 文件忽略
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

  // v1.4.7: 监听就绪事件，统计监听的文件数量
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

  // v1.4.7: 已使用 glob 模式只监听 .md 文件，无需再检查扩展名
  fileWatcher.on('change', (filePath: string) => {
    console.log(`[WATCHER] File changed: ${filePath}`)
    safeSendToRenderer('file:changed', filePath)
  })

  fileWatcher.on('add', (filePath: string) => {
    if (pendingUnlink && Date.now() - pendingUnlink.timestamp < RENAME_THRESHOLD_MS) {
      console.log(`[WATCHER] File renamed: ${pendingUnlink.path} -> ${filePath}`)
      safeSendToRenderer('file:renamed', { oldPath: pendingUnlink.path, newPath: filePath })
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

// 初始化文件夹监听（用户打开文件夹时调用）
// v1.4.7: 监听整个根目录，确保新增/删除文件能被感知
ipcMain.handle('fs:watchFolder', async (event, folderPath: string) => {
  try {
    validatePath(folderPath)

    // v1.4.7: 路径安全验证
    const pathCheck = isWatchPathSafe(folderPath)
    if (!pathCheck.safe) {
      console.warn(`[WATCHER] Rejected unsafe path: ${folderPath} - ${pathCheck.reason}`)
      return { success: false, error: pathCheck.reason }
    }

    _baseFolderPath = folderPath
    watchedFiles.clear()

    // v1.4.7: 立即监听根目录
    watchDirectory(folderPath, event.sender)

    console.log(`[MAIN] Base folder set and watching: ${folderPath}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to set base folder:', error)
    throw error
  }
})

// 当用户打开文件时，记录已打开的文件
// v1.4.7: 不再切换监听目录，保持监听根目录
ipcMain.handle('fs:watchFile', async (event, filePath: string) => {
  validatePath(filePath)

  watchedFiles.add(filePath)

  // v1.4.7: 如果还没有监听器，使用根目录；否则保持当前监听
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

// v1.3.7：预览区域右键菜单（添加书签 + 原有功能）
// v1.4.0：新增页面内搜索和查看快捷键入口
// v1.4.2：新增打印和字体大小调节
ipcMain.handle('preview:show-context-menu', async (event, params: {
  filePath: string
  headingId: string | null
  headingText: string | null
  headingLevel: string | null
  hasSelection: boolean
}) => {
  // ⚠️ 安全校验
  validatePath(params.filePath)

  const { filePath, headingId, headingText, headingLevel, hasSelection } = params

  const menuTemplate: MenuItemConstructorOptions[] = []

  // v1.3.7: 书签功能
  // 如果右键点击的是标题，添加"添加标题书签"
  if (headingId && headingText) {
    menuTemplate.push({
      label: '🔖 添加标题书签',
      click: () => {
        event.sender.send('add-bookmark-from-preview', {
          filePath,
          headingId,
          headingText
        })
      }
    })
  }

  // 添加"添加文件书签"
  menuTemplate.push({
    label: '📄 添加文件书签',
    click: () => {
      event.sender.send('add-bookmark-from-preview', {
        filePath,
        headingId: null,
        headingText: null
      })
    }
  })

  menuTemplate.push({ type: 'separator' })

  // v1.4.0: 页面内搜索（可点击触发）
  menuTemplate.push({
    label: '🔍 页面内搜索',
    accelerator: 'CmdOrCtrl+Shift+F',
    click: () => {
      event.sender.send('shortcut:open-in-page-search')
    }
  })

  menuTemplate.push({ type: 'separator' })

  // v1.3 原有功能：导出功能
  menuTemplate.push({
    label: '📤 导出 HTML',
    accelerator: 'CmdOrCtrl+E',
    click: () => event.sender.send('markdown:export-html')
  })

  menuTemplate.push({
    label: '📑 导出 PDF',
    accelerator: 'CmdOrCtrl+Shift+E',
    click: () => event.sender.send('markdown:export-pdf')
  })

  menuTemplate.push({
    label: '📝 导出 Word',
    click: () => event.sender.send('markdown:export-docx')
  })

  // v1.4.2：打印功能
  menuTemplate.push({
    label: '🖨️ 打印',
    accelerator: 'CmdOrCtrl+P',
    click: () => event.sender.send('shortcut:print')
  })

  menuTemplate.push({ type: 'separator' })

  // v1.4.2：字体大小调节（子菜单）
  menuTemplate.push({
    label: '🔤 字体大小',
    submenu: [
      {
        label: '放大',
        accelerator: 'CmdOrCtrl+Plus',
        click: () => event.sender.send('shortcut:font-increase')
      },
      {
        label: '缩小',
        accelerator: 'CmdOrCtrl+-',
        click: () => event.sender.send('shortcut:font-decrease')
      },
      {
        label: '重置',
        accelerator: 'CmdOrCtrl+0',
        click: () => event.sender.send('shortcut:font-reset')
      }
    ]
  })

  menuTemplate.push({ type: 'separator' })

  // v1.3 原有功能：复制功能
  menuTemplate.push({
    label: '📋 复制为 Markdown',
    click: () => event.sender.send('markdown:copy-source')
  })

  menuTemplate.push({
    label: '📝 复制为纯文本',
    click: () => event.sender.send('markdown:copy-plain-text')
  })

  menuTemplate.push({
    label: '🌐 复制为 HTML',
    click: () => event.sender.send('markdown:copy-html')
  })

  // 如果有选中内容，添加复制选中内容选项
  if (hasSelection) {
    menuTemplate.push({ type: 'separator' })
    menuTemplate.push({
      label: '✂️ 复制选中内容',
      accelerator: 'CmdOrCtrl+C',
      click: () => event.sender.copy()
    })
  }

  // v1.3.7: 如果有标题，添加"复制链接"
  if (headingId) {
    menuTemplate.push({ type: 'separator' })
    menuTemplate.push({
      label: '🔗 复制链接',
      click: () => {
        clipboard.writeText(`${filePath}#${headingId}`)
      }
    })
  }

  // v1.4.0: 查看所有快捷键（打开帮助弹窗）
  menuTemplate.push({ type: 'separator' })
  menuTemplate.push({
    label: '⌨️ 查看所有快捷键',
    click: () => {
      event.sender.send('open-shortcuts-help')
    }
  })

  const menu = Menu.buildFromTemplate(menuTemplate)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    menu.popup({ window })
  }
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

// v1.4：在 Finder/Explorer 中显示文件
ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
  try {
    // 使用 shell.showItemInFolder 在文件管理器中显示并选中文件
    shell.showItemInFolder(filePath)
    return { success: true }
  } catch (error) {
    console.error('Failed to show item in folder:', error)
    throw error
  }
})

// 打开外部链接（用于 Pandoc 安装指南等）
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  // 白名单验证（安全措施）
  const allowedDomains = [
    'pandoc.org',
    'github.com',
    'chocolatey.org'
  ]

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname

    // 检查域名是否在白名单中
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    )

    if (!isAllowed) {
      console.error(`[IPC] Blocked external URL: ${url}`)
      return { success: false, error: '不允许的域名' }
    }

    // 打开外部链接
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('[IPC] Failed to open external URL:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
})

// v1.3.4：历史文件夹管理
ipcMain.handle('folder-history:get', async () => {
  return folderHistoryManager.getHistory()
})

ipcMain.handle('folder-history:remove', async (_, folderPath: string) => {
  folderHistoryManager.removeFolder(folderPath)
})

ipcMain.handle('folder-history:clear', async () => {
  folderHistoryManager.clearHistory()
})

// v1.3.4：设置当前文件夹（从历史选择时调用）
ipcMain.handle('folder:setPath', async (_, folderPath: string) => {
  setAllowedBasePath(folderPath)
  store.set('lastOpenedFolder', folderPath)
  await folderHistoryManager.addFolder(folderPath)
  return true
})

// v1.3.4：右键菜单安装
ipcMain.handle('context-menu:check-status', async () => {
  return contextMenuManager.checkStatus()
})

ipcMain.handle('context-menu:install', async () => {
  return contextMenuManager.install()
})

ipcMain.handle('context-menu:uninstall', async () => {
  return contextMenuManager.uninstall()
})

// v1.3.4：打开系统设置
ipcMain.handle('system:openSettings', async (_event, section: string) => {
  try {
    if (process.platform === 'darwin') {
      // macOS 系统设置深度链接
      const urlMap: Record<string, string> = {
        'extensions': 'x-apple.systempreferences:com.apple.preferences.extensions',
        'finder-extensions': 'x-apple.systempreferences:com.apple.preferences.extensions?Finder',
        'security': 'x-apple.systempreferences:com.apple.preference.security'
      }
      const url = urlMap[section] || urlMap['extensions']
      await shell.openExternal(url)
      return { success: true }
    } else if (process.platform === 'win32') {
      // Windows 默认程序设置
      await shell.openExternal('ms-settings:defaultapps')
      return { success: true }
    }
    return { success: false, error: '不支持的平台' }
  } catch (error) {
    console.error('[System] Failed to open settings:', error)
    return { success: false, error: String(error) }
  }
})

// v1.3.4：用户确认右键菜单已启用
ipcMain.handle('context-menu:confirm-enabled', async () => {
  return contextMenuManager.confirmEnabled()
})

// ============== v1.3.6：最近文件管理 ==============

ipcMain.handle('recent-files:get', async () => {
  return appDataManager.getRecentFiles()
})

ipcMain.handle('recent-files:add', async (_, file: { path: string; name: string; folderPath: string }) => {
  await appDataManager.addRecentFile(file)
})

ipcMain.handle('recent-files:remove', async (_, filePath: string) => {
  appDataManager.removeRecentFile(filePath)
})

ipcMain.handle('recent-files:clear', async () => {
  appDataManager.clearRecentFiles()
})

// ============== v1.3.6：固定标签管理（按文件夹分组） ==============

ipcMain.handle('pinned-tabs:get-for-folder', async (_, folderPath: string) => {
  return appDataManager.getPinnedTabsForFolder(folderPath)
})

ipcMain.handle('pinned-tabs:add', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return false
  return appDataManager.addPinnedTabForFolder(filePath, basePath)
})

ipcMain.handle('pinned-tabs:remove', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return
  appDataManager.removePinnedTabForFolder(filePath, basePath)
})

ipcMain.handle('pinned-tabs:is-pinned', async (_, filePath: string) => {
  const basePath = getAllowedBasePath()
  if (!basePath) return false
  return appDataManager.isTabPinnedInFolder(filePath, basePath)
})

// ============== v1.3.6：应用设置管理 ==============

ipcMain.handle('settings:get', async () => {
  return appDataManager.getSettings()
})

ipcMain.handle('settings:update', async (_, updates: Record<string, unknown>) => {
  appDataManager.updateSettings(updates)
})

// ============== v1.3.6：书签管理 ==============

ipcMain.handle('bookmarks:get', async () => {
  return appDataManager.getBookmarks()
})

ipcMain.handle('bookmarks:add', async (_, bookmark: {
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
}) => {
  // 安全校验
  validatePath(bookmark.filePath)
  return appDataManager.addBookmark(bookmark)
})

ipcMain.handle('bookmarks:update', async (_, id: string, updates: {
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  order?: number
}) => {
  appDataManager.updateBookmark(id, updates)
})

ipcMain.handle('bookmarks:remove', async (_, id: string) => {
  appDataManager.removeBookmark(id)
})

ipcMain.handle('bookmarks:update-all', async (_, bookmarks: Array<{
  id: string
  filePath: string
  fileName: string
  title?: string
  headingId?: string
  headingText?: string
  scrollPosition?: number
  createdAt: number
  order: number
}>) => {
  appDataManager.updateBookmarks(bookmarks)
})

ipcMain.handle('bookmarks:clear', async () => {
  appDataManager.clearBookmarks()
})

// ============== v1.4.2：窗口置顶 ==============

ipcMain.handle('window:setAlwaysOnTop', async (_, flag: boolean) => {
  if (!mainWindow) return false
  mainWindow.setAlwaysOnTop(flag)
  store.set('alwaysOnTop', flag)
  return flag
})

ipcMain.handle('window:getAlwaysOnTop', async () => {
  return mainWindow?.isAlwaysOnTop() ?? false
})

ipcMain.handle('window:toggleAlwaysOnTop', async () => {
  if (!mainWindow) return false
  const newState = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(newState)
  store.set('alwaysOnTop', newState)
  // 通知渲染进程状态变化
  mainWindow.webContents.send('alwaysOnTop:changed', newState)
  return newState
})

// ============== v1.4.3：全屏查看 ==============

ipcMain.handle('window:setFullScreen', async (_, flag: boolean) => {
  if (!mainWindow) return false
  mainWindow.setFullScreen(flag)
  return flag
})

ipcMain.handle('window:isFullScreen', async () => {
  return mainWindow?.isFullScreen() ?? false
})

ipcMain.handle('window:toggleFullScreen', async () => {
  if (!mainWindow) return false
  const newState = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(newState)
  return newState
})

// ============== v1.4.2：打印功能 ==============

ipcMain.handle('window:print', async () => {
  if (!mainWindow) return { success: false }

  mainWindow.webContents.print({
    silent: false,           // 显示打印对话框
    printBackground: true,   // 打印背景色
    margins: {
      marginType: 'default'
    }
  })
  return { success: true }
})

// ============== v1.5.1：代码块截图（用于 DOCX 导出） ==============
// 将代码块渲染为 PNG 图片，确保 ASCII 艺术在 Word 中正确显示

ipcMain.handle('render:codeBlockToPng', async (_, code: string) => {
  try {
    // 获取样式
    const { markdownCss, prismCss } = await getExportStyles()

    // 创建隐藏窗口
    const renderWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true
      }
    })

    // 转义 HTML 特殊字符
    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    // 生成 HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${markdownCss}
    ${prismCss}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: transparent;
      width: fit-content;
      height: fit-content;
    }
    .code-container {
      display: inline-block;
      background: #f5f5f5;
      border-radius: 6px;
      padding: 16px;
      border: 1px solid #e0e0e0;
    }
    pre {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      font-family: Menlo, Monaco, Consolas, 'Courier New', monospace !important;
      font-size: 13px !important;
      line-height: 1.5 !important;
      white-space: pre !important;
      overflow: visible !important;
    }
    code {
      font-family: inherit !important;
      font-size: inherit !important;
      background: transparent !important;
      padding: 0 !important;
    }
  </style>
</head>
<body>
  <div class="code-container">
    <pre><code>${escapeHtml(code)}</code></pre>
  </div>
</body>
</html>`

    // 加载 HTML
    await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    // 等待渲染完成
    await new Promise(resolve => setTimeout(resolve, 200))

    // 获取内容尺寸
    const bounds = await renderWindow.webContents.executeJavaScript(`
      (() => {
        const container = document.querySelector('.code-container');
        if (!container) return { width: 800, height: 400 };
        const rect = container.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width) + 4,
          height: Math.ceil(rect.height) + 4
        };
      })()
    `)

    // 调整窗口大小以匹配内容
    renderWindow.setSize(bounds.width, bounds.height)
    await new Promise(resolve => setTimeout(resolve, 100))

    // 截图
    const image = await renderWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })

    // 关闭窗口
    renderWindow.close()

    // 返回 base64 PNG
    const pngBuffer = image.toPNG()
    const base64 = pngBuffer.toString('base64')

    console.log(`[CodeBlock] 截图成功: ${bounds.width}x${bounds.height}, ${Math.round(pngBuffer.length / 1024)}KB`)

    return {
      success: true,
      data: base64,
      width: bounds.width,
      height: bounds.height
    }
  } catch (error) {
    console.error('[CodeBlock] 截图失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})

// ============== v1.5.0：导出 DOCX ==============
// 优先使用 Pandoc（高质量，从 HTML 转换），如果不可用则回退到 docx 库

ipcMain.handle('export:docx', async (event, htmlContent: string, fileName: string, basePath: string, markdown?: string, chartImages?: ChartImageData[]) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出 Word 文档',
      defaultPath: fileName.replace(/\.md$/, '.docx'),
      filters: [
        { name: 'Word Documents', extensions: ['docx'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 检查 Pandoc 是否可用
    const pandocAvailable = await isPandocAvailable()

    let filePath: string
    let warnings: string[]
    let usedPandoc = false

    if (pandocAvailable) {
      // 使用 Pandoc 导出（高质量，从 HTML 转换）
      console.log('[DOCX Export] 使用 Pandoc 从 HTML 导出')
      const pandocResult = await exportWithPandoc(htmlContent, result.filePath, basePath)
      filePath = pandocResult.filePath
      warnings = pandocResult.warnings
      usedPandoc = true
    } else if (markdown) {
      // 回退到 docx 库（需要 markdown 和 chartImages）
      console.log('[DOCX Export] Pandoc 不可用，使用 docx 库导出')
      const docxResult = await exportToDocx(markdown, result.filePath, basePath, chartImages || [])
      filePath = docxResult.filePath
      warnings = docxResult.warnings
    } else {
      throw new Error('Pandoc 不可用，且未提供 Markdown 内容作为回退')
    }

    return { filePath, warnings, usedPandoc }
  } catch (error) {
    console.error('Failed to export DOCX:', error)
    throw error
  }
})
