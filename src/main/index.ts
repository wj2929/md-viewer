import { app, BrowserWindow, session, protocol, net } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as path from 'path'
import * as fs from 'fs-extra'
import Store from 'electron-store'
import { setAllowedBasePath, isPathAllowed } from './security'
import { folderHistoryManager } from './folderHistoryManager'
import { validateSecurePath as validateLaunchPath } from './security/pathValidator'
import { appDataManager } from './appDataManager'
import { installEpipeHandler } from './safeLog'
import { windowManager } from './windowManager'
import { registerAllHandlers, getFileWatcherState } from './ipc'
import type { AppState } from './ipc'

// 安装 EPIPE 错误处理器（防止开发模式下终端断开导致应用崩溃）
installEpipeHandler()

// 初始化 electron-store
const store = new Store<AppState>({
  defaults: {
    lastOpenedFolder: null,
    windowBounds: {
      width: 1200,
      height: 800
    },
    alwaysOnTop: false
  }
})

// 模块级窗口引用（兼容现有代码，指向最近创建的窗口）
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const savedBounds = store.get('windowBounds')
  const alwaysOnTop = store.get('alwaysOnTop', false)

  const win = windowManager.createWindow({
    bounds: savedBounds,
    alwaysOnTop
  })

  mainWindow = win

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const bounds = win.getBounds()
      store.set('windowBounds', bounds)
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      const remaining = windowManager.getAllWindows()
      mainWindow = remaining.length > 0 ? remaining[0] : null
    }
  })

  if (windowManager.getWindowCount() === 1 && process.env.MD_VIEWER_SKIP_RESTORE !== '1') {
    windowManager.addPendingAction(win.id, () => {
      const lastFolder = store.get('lastOpenedFolder')
      if (lastFolder) {
        setAllowedBasePath(lastFolder)
        win.webContents.send('restore-folder', lastFolder)
      }
    })
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

// 在窗口中打开路径（支持指定目标窗口）
function openPathInWindow(targetPath: string, type: 'md-file' | 'directory', targetWindow?: BrowserWindow): void {
  const win = targetWindow || windowManager.getFocusedWindow() || mainWindow
  if (!win) return

  if (type === 'directory') {
    setAllowedBasePath(targetPath)
    store.set('lastOpenedFolder', targetPath)
    folderHistoryManager.addFolder(targetPath)
    win.webContents.send('restore-folder', targetPath)
  } else {
    const folderPath = path.dirname(targetPath)
    setAllowedBasePath(folderPath)
    store.set('lastOpenedFolder', folderPath)
    folderHistoryManager.addFolder(folderPath)
    win.webContents.send('restore-folder', folderPath)
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send('open-specific-file', targetPath)
      }
    }, 500)
  }
}

// macOS: 处理 open-file 事件
if (process.platform === 'darwin') {
  app.on('open-file', async (event, filePath) => {
    event.preventDefault()
    console.log('[macOS] open-file event received:', filePath)
    console.log('[macOS] mainWindow exists:', !!mainWindow)
    console.log('[macOS] app.isReady:', app.isReady())
    await handleLaunchArgs([filePath])
  })

  app.on('open-url', async (event, url) => {
    event.preventDefault()
    console.log('[macOS] open-url event:', url)
  })
}

// 注册 local-image 自定义协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-image',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: false,
      corsEnabled: false,
      stream: true
    }
  }
])

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mdviewer')

  // 注册 local-image 协议处理器
  protocol.handle('local-image', (request) => {
    let filePath: string
    try {
      const url = new URL(request.url)
      filePath = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1)
      }
    } catch {
      return new Response('Invalid URL', { status: 400 })
    }

    if (!isPathAllowed(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }

    if (!fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404 })
    }

    return net.fetch(`file://${filePath}`)
  })

  // 设置 Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = is.dev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://viewer.diagrams.net; style-src 'self' 'unsafe-inline' https://registry.npmmirror.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https: local-image:; font-src 'self' https://registry.npmmirror.com https://cdn.jsdelivr.net https://viewer.diagrams.net; connect-src 'self' ws://localhost:* http://localhost:* https://viewer.diagrams.net https://www.plantuml.com; worker-src 'self' blob:;"
      : "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://viewer.diagrams.net; style-src 'self' 'unsafe-inline' https://registry.npmmirror.com https://cdn.jsdelivr.net; img-src 'self' data: https: local-image:; font-src 'self' https://registry.npmmirror.com https://cdn.jsdelivr.net https://viewer.diagrams.net; connect-src 'self' https://viewer.diagrams.net https://www.plantuml.com http://localhost:* http://127.0.0.1:*;"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  // 窗口关闭时清理文件监听器
  const fileWatcherState = getFileWatcherState()
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

    const windowWebContentsId = window.webContents.id
    window.on('close', () => {
      fileWatcherState.cleanup(windowWebContentsId)
    })
  })

  createWindow()

  // 注册所有 IPC handlers
  registerAllHandlers({
    store,
    windowManager,
    folderHistoryManager,
    appDataManager,
    openPathInWindow
  })

  // 后台验证最近文件路径有效性
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
