import { app, BrowserWindow, protocol } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as path from 'path'
import * as fs from 'fs-extra'
import Store from 'electron-store'
import { validateNotProtected } from './security'
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
import { workspaceSessionStore, type DesktopSessionV1 } from './workspaceSessionStore'

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
let isQuitting = false
app.on('before-quit', () => { isQuitting = true })

// IPC 共享上下文：目录激活、路径鉴权的唯一事实源
const ipcContext: IPCContext = {
  store,
  windowManager,
  folderHistoryManager,
  appDataManager,
  openPathInWindow
}

function sanitizeRestoredWorkspace(workspace: DesktopSessionV1['windows'][number]['workspaces'][number]) {
  const tabs = workspace.tabs.filter((tab) =>
    typeof tab?.id === 'string' &&
    typeof tab.relativePath === 'string' &&
    tab.id.length > 0 &&
    tab.id.length <= 200 &&
    tab.relativePath.length > 0 &&
    tab.relativePath.length <= 4096 &&
    !path.isAbsolute(tab.relativePath) &&
    !tab.relativePath.split(/[\\/]+/).includes('..')
  ).slice(0, 100)
  const tabIds = new Set(tabs.map((tab) => tab.id))
  const nodeIds = new Set<string>()
  const normalizeNode = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== 'object' || depth > 4) return null
    const value = node as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id || nodeIds.has(value.id)) return null
    nodeIds.add(value.id)
    if (value.type === 'leaf') {
      return typeof value.tabId === 'string' && tabIds.has(value.tabId)
        ? { type: 'leaf', id: value.id, tabId: value.tabId }
        : null
    }
    if (
      value.type !== 'split' ||
      (value.direction !== 'horizontal' && value.direction !== 'vertical') ||
      typeof value.ratio !== 'number' || value.ratio < 0.15 || value.ratio > 0.85
    ) return null
    const first = normalizeNode(value.first, depth + 1)
    const second = normalizeNode(value.second, depth + 1)
    if (!first) return second
    if (!second) return first
    return { type: 'split', id: value.id, direction: value.direction, ratio: value.ratio, first, second }
  }
  const root = normalizeNode(workspace.splitState && typeof workspace.splitState === 'object'
    ? (workspace.splitState as Record<string, unknown>).root
    : null, 1)
  return {
    ...workspace,
    tabs,
    activeTabId: workspace.activeTabId && tabIds.has(workspace.activeTabId) ? workspace.activeTabId : tabs[0]?.id ?? null,
    splitState: { root, activeLeafId: '' },
  }
}

function createWindow(restored?: DesktopSessionV1['windows'][number]): void {
  const savedBounds = restored?.bounds || store.get('windowBounds')
  const alwaysOnTop = restored?.alwaysOnTop ?? store.get('alwaysOnTop', false)

  const win = windowManager.createWindow({
    bounds: savedBounds,
    alwaysOnTop
  })

  mainWindow = win

  if (restored) {
    workspaceSessionStore.bindRestoredWindow(win.id, restored.id)
    const restoredWorkspaces = restored.workspaces.flatMap((workspace) => {
      if (!workspace.primaryRoot) return []
      try {
        const primaryRoot = fs.realpathSync(workspace.primaryRoot)
        if (!fs.statSync(primaryRoot).isDirectory()) return []
        validateNotProtected(primaryRoot)
        return [{ id: workspace.id, primaryRoot }]
      } catch {
        return []
      }
    })
    if (restoredWorkspaces.length > 0) {
      windowManager.replaceWindowWorkspaces(win.id, restoredWorkspaces, restored.activeWorkspaceId)
      workspaceSessionStore.rememberRestoredRuntime(win.id, {
        ...restored,
        workspaces: restored.workspaces
          .filter((workspace) => restoredWorkspaces.some((item) => item.id === workspace.id))
          .map(sanitizeRestoredWorkspace),
      })
    }
    if (restored.isMaximized) win.once('ready-to-show', () => win.maximize())
  }

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const bounds = win.getBounds()
      store.set('windowBounds', bounds)
    }
  })

  win.on('closed', () => {
    if (!isQuitting) workspaceSessionStore.forgetWindow(win.id)
    if (mainWindow === win) {
      const remaining = windowManager.getAllWindows()
      mainWindow = remaining[0] ?? null
    }
  })

  if (!restored && windowManager.getWindowCount() === 1 && process.env.MD_VIEWER_SKIP_RESTORE !== '1') {
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

    // 窗口关闭时清理文件监听器
    const fileWatcherState = getFileWatcherState()
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)

      const windowWebContentsId = window.webContents.id
      window.on('close', () => {
        fileWatcherState.cleanup(windowWebContentsId)
      })
    })

    // 注册所有 IPC handlers，必须早于窗口创建：renderer bootstrap 会在首次 effect 拉取工作区。
    registerAllHandlers(ipcContext)

    const migratedLegacyWindows = workspaceSessionStore.migrateLegacyWindowLifecycle()
    if (migratedLegacyWindows) {
      console.warn('[Workspace] Cleared legacy desktop window snapshot without close lifecycle metadata')
    }
    const desktopSession = process.env.MD_VIEWER_SKIP_RESTORE === '1' ? null : workspaceSessionStore.load()
    if (desktopSession?.windows.length) {
      desktopSession.windows.forEach((restored) => createWindow(restored))
    } else {
      createWindow()
    }

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
