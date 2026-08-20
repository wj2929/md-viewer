import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { is } from '@electron-toolkit/utils'
import { registerWindowShortcuts } from './shortcuts'
import { clearClipboardState } from './clipboardState'
import { workspaceTransferCoordinator } from './workspaceTransferCoordinator'
import { windowTransferCoordinator } from './windowTransferCoordinator'
import { registerLocalImageProtocol, revokeLocalImageCapabilities } from './localImageProtocol'
import { createContentSecurityPolicy } from './securityPolicy'

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

export interface MainWorkspaceSession {
  id: string
  primaryRoot: string | null
  lifecycleEpoch: number
}

export interface WorkspaceTransferResult {
  sourceWorkspaceId: string
  targetWorkspaceId: string
  primaryRoot: string | null
  lifecycleEpoch: number
}

export interface WorkspacePresentation {
  workspaceId: string
  label: string
  isEmptyPlaceholder: boolean
  hasMeaningfulState: boolean
  tabCount: number
  activeTabName: string | null
  tabNames: string[]
  hasSplit: boolean
  hasDraft: boolean
}

interface WindowWorkspaceRegistry {
  activeWorkspaceId: string | null
  workspaces: Map<string, MainWorkspaceSession>
}

export class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map()
  // 兼容旧 IPC：始终映射到活动工作区的主根。
  private windowFolderPaths: Map<number, string> = new Map()
  private workspaceRegistries: Map<number, WindowWorkspaceRegistry> = new Map()
  private workspacePresentations: Map<number, Map<string, WorkspacePresentation>> = new Map()
  // 窗口创建后需要执行的延迟操作
  private pendingActions: Map<number, Array<() => void | Promise<void>>> = new Map()

  /**
   * 创建新窗口
   */
  createWindow(options?: WindowCreateOptions): BrowserWindow {
    const bounds = options?.bounds || { width: 1200, height: 800 }
    const sessionPartition = `md-viewer-window-${randomUUID()}`

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
        partition: sessionPartition,
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })

    const winId = win.id
    const webContentsId = win.webContents.id
    const windowSession = win.webContents.session
    registerLocalImageProtocol(windowSession)
    windowSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [createContentSecurityPolicy(is.dev)],
        },
      })
    })
    this.windows.set(winId, win)
    this.createWorkspace(winId)
    this.broadcastToOthers(winId, 'workspace:merge-sources-changed')

    win.on('ready-to-show', () => {
      win.show()

      if (options?.alwaysOnTop) {
        win.setAlwaysOnTop(true)
      }

      if (is.dev && process.env.NODE_ENV !== 'test') {
        win.webContents.openDevTools()
      }

      registerWindowShortcuts(win)

      // 执行延迟操作（如恢复文件夹、打开文件）
      const actions = this.pendingActions.get(winId)
      if (actions) {
        actions.forEach(action => {
          void Promise.resolve(action()).catch(error => {
            console.error(`[WindowManager] Pending action failed for window ${winId}:`, error)
          })
        })
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
      const cancelledTransfers = workspaceTransferCoordinator.cancelForWindow(winId)
      const cancelledWindowTransfers = windowTransferCoordinator.cancelForWindow(winId)
      this.windows.delete(winId)
      this.windowFolderPaths.delete(winId)
      this.workspaceRegistries.delete(winId)
      this.workspacePresentations.delete(winId)
      this.broadcastToAll('workspace:merge-sources-changed')
      for (const transfer of [...cancelledTransfers, ...cancelledWindowTransfers]) {
        if (transfer.sourceWindowId !== winId) continue
        this.sendToWindow(transfer.targetWindowId, 'workspace:transfer-cancelled', {
          nonce: transfer.nonce,
          reason: '来源窗口已关闭',
        })
      }
      revokeLocalImageCapabilities(windowSession)
      this.pendingActions.delete(winId)
      clearClipboardState(webContentsId)
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
  addPendingAction(winId: number, action: () => void | Promise<void>): void {
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

  private getOrCreateWorkspaceRegistry(winId: number): WindowWorkspaceRegistry {
    let registry = this.workspaceRegistries.get(winId)
    if (!registry) {
      registry = { activeWorkspaceId: null, workspaces: new Map() }
      this.workspaceRegistries.set(winId, registry)
    }
    return registry
  }

  replaceWindowWorkspaces(
    winId: number,
    workspaces: Array<{ id: string; primaryRoot: string | null }>,
    activeWorkspaceId: string | null
  ): void {
    const registry = this.getOrCreateWorkspaceRegistry(winId)
    const next = new Map<string, MainWorkspaceSession>()
    for (const workspace of workspaces) {
      if (!workspace.id || next.has(workspace.id)) throw new Error('工作区恢复数据无效')
      next.set(workspace.id, { id: workspace.id, primaryRoot: workspace.primaryRoot, lifecycleEpoch: 1 })
    }
    registry.workspaces = next
    this.workspacePresentations.delete(winId)
    registry.activeWorkspaceId = activeWorkspaceId && next.has(activeWorkspaceId)
      ? activeWorkspaceId
      : next.keys().next().value ?? null
    const active = registry.activeWorkspaceId ? next.get(registry.activeWorkspaceId) : undefined
    if (active?.primaryRoot) this.windowFolderPaths.set(winId, active.primaryRoot)
    else this.windowFolderPaths.delete(winId)
  }

  createWorkspace(winId: number, workspaceId = randomUUID(), primaryRoot: string | null = null, activate = true): MainWorkspaceSession {
    const registry = this.getOrCreateWorkspaceRegistry(winId)
    if (registry.workspaces.has(workspaceId)) {
      throw new Error('工作区 ID 已存在')
    }

    const workspace: MainWorkspaceSession = { id: workspaceId, primaryRoot, lifecycleEpoch: 1 }
    registry.workspaces.set(workspaceId, workspace)
    if (!registry.activeWorkspaceId && activate) {
      this.activateWorkspace(winId, workspaceId)
    }
    return workspace
  }

  listWorkspaces(winId: number): MainWorkspaceSession[] {
    const registry = this.workspaceRegistries.get(winId)
    return registry ? Array.from(registry.workspaces.values()) : []
  }

  setWorkspacePresentations(winId: number, presentations: WorkspacePresentation[]): void {
    const registry = this.workspaceRegistries.get(winId)
    if (!registry) throw new Error('窗口工作区不存在')
    if (presentations.some((presentation) => !registry.workspaces.has(presentation.workspaceId))) {
      throw new Error('工作区展示信息与窗口不匹配')
    }
    this.workspacePresentations.set(winId, new Map(
      presentations.map((presentation) => [presentation.workspaceId, presentation])
    ))
    this.broadcastToAll('workspace:merge-sources-changed')
  }

  getWorkspacePresentation(winId: number, workspaceId: string): WorkspacePresentation | undefined {
    return this.workspacePresentations.get(winId)?.get(workspaceId)
  }

  getWorkspace(winId: number, workspaceId: string): MainWorkspaceSession | undefined {
    return this.workspaceRegistries.get(winId)?.workspaces.get(workspaceId)
  }

  getActiveWorkspaceId(winId: number): string | null {
    return this.workspaceRegistries.get(winId)?.activeWorkspaceId ?? null
  }

  getActiveWorkspace(winId: number): MainWorkspaceSession | undefined {
    const registry = this.workspaceRegistries.get(winId)
    return registry?.activeWorkspaceId ? registry.workspaces.get(registry.activeWorkspaceId) : undefined
  }

  activateWorkspace(winId: number, workspaceId: string): MainWorkspaceSession {
    const registry = this.getOrCreateWorkspaceRegistry(winId)
    const workspace = registry.workspaces.get(workspaceId)
    if (!workspace) throw new Error('工作区不存在或不属于当前窗口')

    registry.activeWorkspaceId = workspaceId
    if (workspace.primaryRoot) {
      this.windowFolderPaths.set(winId, workspace.primaryRoot)
    } else {
      this.windowFolderPaths.delete(winId)
    }
    return workspace
  }

  replaceWorkspaceRoot(winId: number, workspaceId: string, primaryRoot: string): MainWorkspaceSession {
    const workspace = this.getWorkspace(winId, workspaceId)
    if (!workspace) throw new Error('工作区不存在或不属于当前窗口')

    workspace.primaryRoot = primaryRoot
    workspace.lifecycleEpoch += 1
    if (this.workspaceRegistries.get(winId)?.activeWorkspaceId === workspaceId) {
      this.windowFolderPaths.set(winId, primaryRoot)
    }
    return workspace
  }

  closeWorkspace(winId: number, workspaceId: string): MainWorkspaceSession | undefined {
    const registry = this.workspaceRegistries.get(winId)
    const workspace = registry?.workspaces.get(workspaceId)
    if (!registry || !workspace) return undefined

    registry.workspaces.delete(workspaceId)
    this.workspacePresentations.get(winId)?.delete(workspaceId)
    this.notifyMergeSourcesChanged()
    if (registry.activeWorkspaceId === workspaceId) {
      const next = registry.workspaces.values().next().value as MainWorkspaceSession | undefined
      registry.activeWorkspaceId = next?.id ?? null
      if (next?.primaryRoot) this.windowFolderPaths.set(winId, next.primaryRoot)
      else this.windowFolderPaths.delete(winId)
    }
    return workspace
  }

  pruneInactiveWorkspaces(
    winId: number,
    expectedActiveWorkspaceId: string,
    candidates: Array<{ workspaceId: string; lifecycleEpoch: number; primaryRoot: string | null }>
  ): string[] {
    const registry = this.workspaceRegistries.get(winId)
    if (!registry || registry.activeWorkspaceId !== expectedActiveWorkspaceId) {
      throw new Error('工作区活动会话已变化')
    }
    if (!registry.workspaces.has(expectedActiveWorkspaceId)) {
      throw new Error('工作区活动会话不存在')
    }

    const candidateIds = new Set<string>()
    for (const candidate of candidates) {
      if (!candidate.workspaceId || candidateIds.has(candidate.workspaceId)) {
        throw new Error('工作区清理请求无效')
      }
      if (candidate.workspaceId === expectedActiveWorkspaceId) {
        throw new Error('不能自动清理当前工作区')
      }
      const workspace = registry.workspaces.get(candidate.workspaceId)
      const presentation = this.getWorkspacePresentation(winId, candidate.workspaceId)
      if (
        !workspace ||
        workspace.lifecycleEpoch !== candidate.lifecycleEpoch ||
        workspace.primaryRoot !== candidate.primaryRoot ||
        !presentation ||
        presentation.hasMeaningfulState
      ) {
        throw new Error('工作区清理条件已变化')
      }
      candidateIds.add(candidate.workspaceId)
    }

    for (const workspaceId of candidateIds) {
      registry.workspaces.delete(workspaceId)
      this.workspacePresentations.get(winId)?.delete(workspaceId)
    }
    return [...candidateIds]
  }

  transferWorkspaces(
    sourceWinId: number,
    targetWinId: number,
    plans: Array<{ workspaceId: string; lifecycleEpoch: number; primaryRoot: string | null }>,
    sourceActiveWorkspaceId: string | null
  ): { workspaces: WorkspaceTransferResult[]; activeWorkspaceId: string } {
    if (sourceWinId === targetWinId || plans.length === 0) throw new Error('无效的窗口合并请求')
    const source = this.workspaceRegistries.get(sourceWinId)
    const target = this.workspaceRegistries.get(targetWinId)
    if (!source || !target) throw new Error('窗口合并参与者不存在')

    const planned = plans.map((plan) => {
      const workspace = source.workspaces.get(plan.workspaceId)
      if (
        !workspace ||
        workspace.lifecycleEpoch !== plan.lifecycleEpoch ||
        workspace.primaryRoot !== plan.primaryRoot
      ) throw new Error('来源窗口工作区已变化')
      return { plan, workspace }
    })
    const reservedIds = new Set(target.workspaces.keys())
    const targetIds = new Map<string, string>()
    for (const { workspace } of planned) {
      let targetId = workspace.id
      while (reservedIds.has(targetId)) targetId = randomUUID()
      reservedIds.add(targetId)
      targetIds.set(workspace.id, targetId)
    }

    const sourceActiveTargetId = sourceActiveWorkspaceId ? targetIds.get(sourceActiveWorkspaceId) : undefined
    const results: WorkspaceTransferResult[] = []
    for (const { workspace } of planned) {
      const sourceWorkspaceId = workspace.id
      const targetWorkspaceId = targetIds.get(sourceWorkspaceId)!
      source.workspaces.delete(sourceWorkspaceId)
      workspace.id = targetWorkspaceId
      workspace.lifecycleEpoch += 1
      target.workspaces.set(targetWorkspaceId, workspace)
      results.push({
        sourceWorkspaceId,
        targetWorkspaceId,
        primaryRoot: workspace.primaryRoot,
        lifecycleEpoch: workspace.lifecycleEpoch,
      })
    }
    const activeWorkspaceId = sourceActiveTargetId ?? results[0].targetWorkspaceId
    target.activeWorkspaceId = activeWorkspaceId
    const active = target.workspaces.get(activeWorkspaceId)
    if (active?.primaryRoot) this.windowFolderPaths.set(targetWinId, active.primaryRoot)
    else this.windowFolderPaths.delete(targetWinId)
    return { workspaces: results, activeWorkspaceId }
  }

  transferWorkspace(
    sourceWinId: number,
    targetWinId: number,
    workspaceId: string,
    targetReservation?: { workspaceId: string; lifecycleEpoch: number }
  ): MainWorkspaceSession {
    if (sourceWinId === targetWinId) throw new Error('不能将工作区转移到同一窗口')
    const source = this.workspaceRegistries.get(sourceWinId)
    const workspace = source?.workspaces.get(workspaceId)
    if (!source || !workspace) throw new Error('工作区不存在或不属于来源窗口')

    const target = this.getOrCreateWorkspaceRegistry(targetWinId)
    const placeholder = targetReservation && target.workspaces.get(targetReservation.workspaceId)
    if (
      targetReservation &&
      (!placeholder ||
        placeholder.lifecycleEpoch !== targetReservation.lifecycleEpoch ||
        placeholder.primaryRoot !== null)
    ) {
      throw new Error('工作区转移目标已变化')
    }
    const targetWorkspaceId = target.workspaces.has(workspaceId) && targetReservation?.workspaceId !== workspaceId
      ? randomUUID()
      : workspaceId
    const sourcePresentation = this.workspacePresentations.get(sourceWinId)?.get(workspaceId)

    if (targetReservation) {
      target.workspaces.delete(targetReservation.workspaceId)
      this.workspacePresentations.get(targetWinId)?.delete(targetReservation.workspaceId)
    }
    source.workspaces.delete(workspaceId)
    this.workspacePresentations.get(sourceWinId)?.delete(workspaceId)
    if (source.activeWorkspaceId === workspaceId) {
      const next = source.workspaces.values().next().value as MainWorkspaceSession | undefined
      source.activeWorkspaceId = next?.id ?? null
      if (next?.primaryRoot) this.windowFolderPaths.set(sourceWinId, next.primaryRoot)
      else this.windowFolderPaths.delete(sourceWinId)
    }

    workspace.lifecycleEpoch += 1
    workspace.id = targetWorkspaceId
    target.workspaces.set(targetWorkspaceId, workspace)
    target.activeWorkspaceId = targetWorkspaceId
    if (sourcePresentation) {
      const presentations = this.workspacePresentations.get(targetWinId) ?? new Map<string, WorkspacePresentation>()
      presentations.set(targetWorkspaceId, { ...sourcePresentation, workspaceId: targetWorkspaceId })
      this.workspacePresentations.set(targetWinId, presentations)
    }
    this.notifyMergeSourcesChanged()
    if (workspace.primaryRoot) this.windowFolderPaths.set(targetWinId, workspace.primaryRoot)
    else this.windowFolderPaths.delete(targetWinId)
    return workspace
  }

  notifyMergeSourcesChanged(): void {
    this.broadcastToAll('workspace:merge-sources-changed')
  }

  /**
   * 设置窗口关联的文件夹路径。
   * 兼容旧调用，并同步活动工作区的根；新代码应调用 replaceWorkspaceRoot。
   */
  setWindowFolderPath(winId: number, folderPath: string): void {
    this.windowFolderPaths.set(winId, folderPath)
    const activeWorkspace = this.getActiveWorkspace(winId)
    if (activeWorkspace) {
      activeWorkspace.primaryRoot = folderPath
      activeWorkspace.lifecycleEpoch += 1
    }
  }

  /**
   * 获取活动工作区的文件夹根。
   */
  getWindowFolderPath(winId: number): string | undefined {
    return this.getActiveWorkspace(winId)?.primaryRoot ?? this.windowFolderPaths.get(winId)
  }

  /**
   * 获取所有存活窗口已注册工作区的根目录（去重）。
   */
  getAllWindowFolderRoots(): string[] {
    const roots = new Set<string>()
    for (const win of this.getAllWindows()) {
      const registry = this.workspaceRegistries.get(win.id)
      if (registry) {
        for (const workspace of registry.workspaces.values()) {
          if (workspace.primaryRoot) roots.add(workspace.primaryRoot)
        }
      }
      const legacyRoot = this.windowFolderPaths.get(win.id)
      if (legacyRoot) roots.add(legacyRoot)
    }
    return Array.from(roots)
  }
}

// 单例导出
export const windowManager = new WindowManager()
