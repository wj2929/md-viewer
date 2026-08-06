import { app, BrowserWindow, session, protocol, net } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as path from 'path'
import { pathToFileURL } from 'url'
import * as fs from 'fs-extra'
import Store from 'electron-store'
import { validateSecurePathInBase } from './security'
import { folderHistoryManager } from './folderHistoryManager'
import { activateFolderForWindow } from './folderActivation'
import { validateSecurePath as validateLaunchPath } from './security/pathValidator'
import type { IPCContext } from './ipc/context'
import { appDataManager } from './appDataManager'
import { installEpipeHandler } from './safeLog'
import { installApplicationMenu } from './applicationMenu'
import { windowManager } from './windowManager'
import { registerAllHandlers, getFileWatcherState } from './ipc'
import type { AppState } from './ipc'
import { createContentSecurityPolicy } from './securityPolicy'
import { isHeadlessCliArgv } from './cli'
import { runCliOnStartup } from './cli/bootstrap'
import { extractGuiLaunchPath } from './cli/launchArgs'

// 扩大 libuv 线程池（默认 4）。文件监听 crawl 与目录扫描 glob 都走线程池，
// 连续快切多个大目录时二者抢占 4 个线程会造成偶发数百毫秒排队延迟。
// 须在任何文件 I/O 触发线程池惰性初始化之前设置。仅在未显式配置时兜底设置。
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16'
}

// 安装 EPIPE 错误处理器（防止开发模式下终端断开导致应用崩溃）
installEpipeHandler()

const startupArgv = process.argv.slice(1)
const isCliStartup = isHeadlessCliArgv(startupArgv)

if (isCliStartup) {
  runCliOnStartup(startupArgv, { exit: code => app.exit(code) })
}

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

// IPC 共享上下文：目录激活、路径鉴权的唯一事实源
const ipcContext: IPCContext = {
  store,
  windowManager,
  folderHistoryManager,
  appDataManager,
  openPathInWindow
}

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
        activateFolderForWindow(ipcContext, win, lastFolder, { notifyRenderer: true }).catch((error) => {
          console.error('[Restore] Failed to restore last folder:', error)
        })
      }
    })
  }
}

// 存储待处理的启动路径
let pendingLaunchPath: string | null = null

// 处理启动参数
async function handleLaunchArgs(args: string[]): Promise<void> {
  const targetPath = extractGuiLaunchPath(args)
  if (!targetPath) return

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

  const folderPath = type === 'directory' ? targetPath : path.dirname(targetPath)

  activateFolderForWindow(ipcContext, win, folderPath, { notifyRenderer: true })
    .then((activation) => {
      if (type === 'md-file') {
        const filePath = activation.path === folderPath
          ? targetPath
          : path.join(activation.path, path.basename(targetPath))
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.send('open-specific-file', filePath)
          }
        }, 500)
      }
    })
    .catch((error) => {
      console.error('[openPathInWindow] Failed to activate folder:', error)
    })
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

if (!isCliStartup) {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.mdviewer')
    installApplicationMenu()

    // 注册 local-image 协议处理器
    // protocol.handle 回调拿不到发起请求的 webContents，无法按发起窗口鉴权；
    // 改用「任一存活窗口的已授权根目录内即放行」——所有根都是用户主动打开的文件夹。
    protocol.handle('local-image', async (request) => {
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

      const roots = windowManager.getAllWindowFolderRoots()
      let canonicalPath: string | null = null
      for (const root of roots) {
        try {
          canonicalPath = await validateSecurePathInBase(filePath, root)
          break
        } catch {
          // 尝试下一个窗口根
        }
      }

      if (!canonicalPath) {
        return new Response('Forbidden', { status: 403 })
      }

      if (!fs.existsSync(canonicalPath)) {
        return new Response('Not Found', { status: 404 })
      }

      return net.fetch(pathToFileURL(canonicalPath).toString())
    })

    // 设置 Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = createContentSecurityPolicy(is.dev)

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
    registerAllHandlers(ipcContext)

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

    handleLaunchArgs(startupArgv)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
