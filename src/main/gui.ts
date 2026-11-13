import { app, BrowserWindow, powerMonitor, protocol } from 'electron'
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
import { extractGuiLaunchPath } from './cli/launchArgs'
import {
  orderDesktopSessionWindows,
  workspaceSessionStore,
  type DesktopSessionV1,
} from './workspaceSessionStore'
import { WorkspaceIndexStore } from './indexing/WorkspaceIndexStore'
import { WorkspaceIndexService } from './indexing/WorkspaceIndexService'
import { LinkRewritePlanner } from './linking/LinkRewritePlanner'
import { workspaceWatchService } from './watching/WorkspaceWatchService'
import { cleanupWindowCapabilities } from './windowCleanup'
import { DiagnosticEventLogService } from './diagnostics/DiagnosticEventLogService'

// 扩大 libuv 线程池（默认 4）。文件监听 crawl 与目录扫描 glob 都走线程池，
// 连续快切多个大目录时二者抢占 4 个线程会造成偶发数百毫秒排队延迟。
// 须在任何文件 I/O 触发线程池惰性初始化之前设置。仅在未显式配置时兜底设置。
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16'
}

// 安装 EPIPE 错误处理器（防止开发模式下终端断开导致应用崩溃）
installEpipeHandler()

const startupArgv = process.argv.slice(1)

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

// 模块级窗口引用（兼容现有代码，指向最近聚焦或显式创建的前台窗口）
let mainWindow: BrowserWindow | null = null
let isQuitting = false
const delayedRestoreTimers = new Set<NodeJS.Timeout>()
const diagnosticAppendDelayMs = process.env.NODE_ENV === 'test'
  ? Math.max(0, Math.min(1500, Number(process.env.MD_VIEWER_DIAGNOSTIC_APPEND_DELAY_MS) || 0))
  : 0
const diagnosticEventLogService = new DiagnosticEventLogService(
  diagnosticAppendDelayMs > 0
    ? {
        appendFile: async (handle, content) => {
          await new Promise(resolve => setTimeout(resolve, diagnosticAppendDelayMs))
          await handle.appendFile(content, 'utf8')
        },
      }
    : {},
)
let diagnosticShutdownStarted = false
app.on('before-quit', (event) => {
  isQuitting = true
  for (const timer of delayedRestoreTimers) clearTimeout(timer)
  delayedRestoreTimers.clear()
  if (diagnosticShutdownStarted) return
  diagnosticShutdownStarted = true
  event.preventDefault()
  void workspaceWatchService.shutdown()
    .finally(() => diagnosticEventLogService.shutdown())
    .finally(() => app.quit())
})

const workspaceIndexService = new WorkspaceIndexService(
  new WorkspaceIndexStore(path.join(app.getPath('userData'), 'workspace-index')),
  workspaceWatchService,
  diagnosticEventLogService,
)

workspaceWatchService.setIndexReconciler((root, phase) => workspaceIndexService.reconcileWatch(root, phase))
workspaceWatchService.setDiagnostics((phase, operationId, rawWorkspacePath, metadata) => {
  diagnosticEventLogService.recordMainEvent({
    event: `watcher.work.${phase}`, operationId, rawWorkspacePath, metadata,
  })
})

// IPC 共享上下文：目录激活、路径鉴权的唯一事实源
const ipcContext: IPCContext = {
  store,
  windowManager,
  folderHistoryManager,
  appDataManager,
  diagnosticEventLogService,
  workspaceIndexService,
  linkRewritePlanner: new LinkRewritePlanner(workspaceIndexService),
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
  const leafTabIds = new Map<string, string>()
  const normalizeNode = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== 'object' || depth > 4) return null
    const value = node as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id || nodeIds.has(value.id)) return null
    nodeIds.add(value.id)
    if (value.type === 'leaf') {
      if (typeof value.tabId !== 'string' || !tabIds.has(value.tabId)) return null
      leafTabIds.set(value.id, value.tabId)
      return { type: 'leaf', id: value.id, tabId: value.tabId }
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
  const splitState = workspace.splitState && typeof workspace.splitState === 'object'
    ? workspace.splitState as Record<string, unknown> : {}
  const root = normalizeNode(splitState.root, 1)
  const activeLeafId = typeof splitState.activeLeafId === 'string' && leafTabIds.has(splitState.activeLeafId)
    ? splitState.activeLeafId : ''
  return {
    ...workspace,
    tabs,
    // A valid saved leaf identifies the pane, even when several panes show the same tab.
    activeTabId: leafTabIds.get(activeLeafId) ?? (workspace.activeTabId && tabIds.has(workspace.activeTabId) ? workspace.activeTabId : tabs[0]?.id ?? null),
    splitState: { root, activeLeafId },
  }
}

function createWindow(
  restored?: DesktopSessionV1['windows'][number],
  options: { backgroundRestore?: boolean } = {},
): void {
  const savedBounds = restored?.bounds || store.get('windowBounds')
  const alwaysOnTop = restored?.alwaysOnTop ?? store.get('alwaysOnTop', false)

  const win = windowManager.createWindow({
    bounds: savedBounds,
    alwaysOnTop,
    isMaximized: restored?.isMaximized,
    showInactive: options.backgroundRestore,
  })

  if (!options.backgroundRestore || !mainWindow) mainWindow = win

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
  }

  win.on('focus', () => {
    mainWindow = win
    workspaceSessionStore.markWindowActive(win.id)
  })

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
        activateFolderForWindow(ipcContext, win, lastFolder, {
          notifyRenderer: true,
          diagnosticSource: 'restore',
        }).catch((error) => {
          console.error('[Restore] Failed to restore last folder:', error)
        })
      }
    })
  }
}

function restoreDesktopWindows(session: DesktopSessionV1): void {
  const [foreground, ...background] = orderDesktopSessionWindows(session)
  if (!foreground) {
    createWindow()
    return
  }

  createWindow(foreground)
  // 从上一窗口创建完成后计时，避免主进程阻塞让预设定时器接连到期。
  const restoreNextBackground = (index: number): void => {
    if (index >= background.length || isQuitting) return
    const timer = setTimeout(() => {
      delayedRestoreTimers.delete(timer)
      if (isQuitting) return
      createWindow(background[index], { backgroundRestore: true })
      restoreNextBackground(index + 1)
    }, 600)
    delayedRestoreTimers.add(timer)
  }
  restoreNextBackground(0)
}

// 存储待处理的启动路径
let pendingLaunchPath: string | null = null

function openPathWhenWindowReady(targetPath: string, type: 'md-file' | 'directory', win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const currentUrl = win.webContents.getURL()
  if (!currentUrl || currentUrl === 'about:blank' || win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) openPathInWindow(targetPath, type, win)
    })
    return
  }
  openPathInWindow(targetPath, type, win)
}

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
    openPathWhenWindowReady(validation.normalizedPath, validation.type as 'md-file' | 'directory', mainWindow)
  } else {
    pendingLaunchPath = validation.normalizedPath
  }
}

// 在窗口中打开路径（支持指定目标窗口）
function openPathInWindow(targetPath: string, type: 'md-file' | 'directory', targetWindow?: BrowserWindow): void {
  const win = targetWindow || windowManager.getFocusedWindow() || mainWindow
  if (!win) return

  const folderPath = type === 'directory' ? targetPath : path.dirname(targetPath)

  activateFolderForWindow(ipcContext, win, folderPath, {
    notifyRenderer: true,
    diagnosticSource: type === 'md-file' ? 'open-specific-file' : 'user',
    initialFilePath: type === 'md-file' ? targetPath : undefined,
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

// 注册受控本地图片和流媒体协议
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
  },
  {
    scheme: 'local-media',
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
    app.setAppLogsPath()
    const diagnosticDefaultDirectory = process.env.NODE_ENV === 'test'
      && process.env.MD_VIEWER_DIAGNOSTIC_LOG_DIR
      ? path.resolve(process.env.MD_VIEWER_DIAGNOSTIC_LOG_DIR)
      : app.getPath('logs')
    diagnosticEventLogService.initialize({
      defaultDirectory: diagnosticDefaultDirectory,
      userDataDirectory: app.getPath('userData'),
      settings: appDataManager.getDiagnosticLogSettings(),
    })
    diagnosticEventLogService.recordMainEvent({
      event: 'session.start',
      priority: 'critical',
    })
    diagnosticEventLogService.recordMainEvent({
      event: 'clock.anchor',
      priority: 'critical',
    })
    powerMonitor.on('suspend', () => {
      diagnosticEventLogService.markSystemSuspend()
      workspaceWatchService.suspend()
    })
    powerMonitor.on('resume', () => {
      diagnosticEventLogService.markSystemResume()
      workspaceWatchService.resume()
    })
    installApplicationMenu()

    // 窗口关闭时清理文件监听器
    const fileWatcherState = getFileWatcherState()
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)

      let cleanedUp = false
      const cleanup = (): void => {
        if (cleanedUp) return
        cleanedUp = true
        cleanupWindowCapabilities(ipcContext, window, fileWatcherState)
      }
      window.once('closed', cleanup)
      window.webContents.once('destroyed', cleanup)
    })

    // 注册所有 IPC handlers，必须早于窗口创建：renderer bootstrap 会在首次 effect 拉取工作区。
    registerAllHandlers(ipcContext)

    const migratedLegacyWindows = workspaceSessionStore.migrateLegacyWindowLifecycle()
    if (migratedLegacyWindows) {
      console.warn('[Workspace] Cleared legacy desktop window snapshot without close lifecycle metadata')
    }
    const desktopSession = process.env.MD_VIEWER_SKIP_RESTORE === '1' ? null : workspaceSessionStore.load()
    if (desktopSession?.windows.length) {
      restoreDesktopWindows(desktopSession)
    } else {
      createWindow()
    }

    // 后台验证最近文件路径有效性
    appDataManager.validateRecentFilesInBackground()

    // 处理待处理的启动路径
    if (pendingLaunchPath && mainWindow) {
      const launchPath = pendingLaunchPath
      const launchWindow = mainWindow
      pendingLaunchPath = null
      void validateLaunchPath(launchPath).then(validation => {
        if (validation.valid) {
          openPathWhenWindowReady(
            validation.normalizedPath,
            validation.type as 'md-file' | 'directory',
            launchWindow,
          )
        }
      })
    }

    handleLaunchArgs(startupArgv)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
