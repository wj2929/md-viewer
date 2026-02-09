import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerWindowShortcuts } from './shortcuts'

/**
 * 窗口管理器 (v1.6.0)
 * 管理多窗口的创建、销毁、广播等
 */

export interface WindowCreateOptions {
  folderPath?: string
  filePath?: string
  bounds?: {
    width: number
    height: number
    x?: number
    y?: number
  }
  alwaysOnTop?: boolean
}

class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map()
  // 每个窗口关联的 folderPath（用于文件监听隔离）
  private windowFolderPaths: Map<number, string> = new Map()
  // 窗口创建后需要执行的延迟操作
  private pendingActions: Map<number, Array<() => void>> = new Map()

  /**
   * 创建新窗口
   */
  createWindow(options?: WindowCreateOptions): BrowserWindow {
    const bounds = options?.bounds || { width: 1200, height: 800 }

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 800,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 15, y: 10 }
          }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })

    const winId = win.id
    this.windows.set(winId, win)

    win.on('ready-to-show', () => {
      win.show()

      if (options?.alwaysOnTop) {
        win.setAlwaysOnTop(true)
      }

      if (is.dev) {
        win.webContents.openDevTools()
      }

      registerWindowShortcuts(win)

      // 执行延迟操作（如恢复文件夹、打开文件）
      const actions = this.pendingActions.get(winId)
      if (actions) {
        actions.forEach(action => action())
        this.pendingActions.delete(winId)
      }
    })

    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 拦截页面内导航
    win.webContents.on('will-navigate', (event, url) => {
      if (is.dev && url.startsWith(process.env['ELECTRON_RENDERER_URL'] || '')) {
        return
      }
      event.preventDefault()
      console.log('[MAIN] Blocked navigation to:', url)
    })

    // 窗口关闭时清理
    win.on('closed', () => {
      this.windows.delete(winId)
      this.windowFolderPaths.delete(winId)
      this.pendingActions.delete(winId)
      console.log(`[WindowManager] Window ${winId} closed, remaining: ${this.windows.size}`)
    })

    // 加载页面
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    console.log(`[WindowManager] Window ${winId} created, total: ${this.windows.size}`)
    return win
  }

  /**
   * 添加窗口就绪后的延迟操作
   */
  addPendingAction(winId: number, action: () => void): void {
    if (!this.pendingActions.has(winId)) {
      this.pendingActions.set(winId, [])
    }
    this.pendingActions.get(winId)!.push(action)
  }

  /**
   * 关闭指定窗口
   */
  closeWindow(id: number): void {
    const win = this.windows.get(id)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }

  /**
   * 获取所有窗口
   */
  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).filter(w => !w.isDestroyed())
  }

  /**
   * 获取当前聚焦的窗口
   */
  getFocusedWindow(): BrowserWindow | undefined {
    return this.getAllWindows().find(w => w.isFocused())
  }

  /**
   * 根据 ID 获取窗口
   */
  getWindow(id: number): BrowserWindow | undefined {
    const win = this.windows.get(id)
    return win && !win.isDestroyed() ? win : undefined
  }

  /**
   * 根据 webContents ID 获取窗口
   */
  getWindowByWebContentsId(webContentsId: number): BrowserWindow | undefined {
    return this.getAllWindows().find(w => w.webContents.id === webContentsId)
  }

  /**
   * 获取窗口数量
   */
  getWindowCount(): number {
    return this.getAllWindows().length
  }

  /**
   * 广播消息到所有窗口
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    this.getAllWindows().forEach(win => {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    })
  }

  /**
   * 广播消息到除指定窗口外的所有窗口
   */
  broadcastToOthers(excludeId: number, channel: string, ...args: unknown[]): void {
    this.getAllWindows().forEach(win => {
      if (win.id !== excludeId && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    })
  }

  /**
   * 发送消息到指定窗口
   */
  sendToWindow(id: number, channel: string, ...args: unknown[]): void {
    const win = this.getWindow(id)
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }

  /**
   * 设置窗口关联的文件夹路径
   */
  setWindowFolderPath(winId: number, folderPath: string): void {
    this.windowFolderPaths.set(winId, folderPath)
  }

  /**
   * 获取窗口关联的文件夹路径
   */
  getWindowFolderPath(winId: number): string | undefined {
    return this.windowFolderPaths.get(winId)
  }
}

// 单例导出
export const windowManager = new WindowManager()
