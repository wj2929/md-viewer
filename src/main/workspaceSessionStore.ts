import Store from 'electron-store'

export interface DesktopSessionWindow {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  isMaximized: boolean
  alwaysOnTop: boolean
  activeWorkspaceId: string | null
  workspaces: DesktopSessionWorkspace[]
}

export interface DesktopSessionWorkspace {
  id: string
  name: string
  primaryRoot: string | null
  tabs: Array<{ id: string; relativePath: string; isPinned?: boolean }>
  activeTabId: string | null
  splitState: unknown
}

export interface DesktopSessionV1 {
  version: 1
  windows: DesktopSessionWindow[]
}

export interface DesktopSessionRuntimeTab {
  id: string
  filePath: string
  isPinned?: boolean
}

export interface DesktopSessionRuntimeWorkspace {
  id: string
  name: string
  primaryRoot: string | null
  lifecycleEpoch: number
  tabs: DesktopSessionRuntimeTab[]
  activeTabId: string | null
  splitState: unknown
}

export interface DesktopSessionRuntimeWindow {
  activeWorkspaceId: string | null
  workspaces: DesktopSessionRuntimeWorkspace[]
}

interface WorkspaceSessionStoreState {
  desktopSession: DesktopSessionV1 | null
  windowLifecycleV1Migrated: boolean
}

const MAX_WINDOWS = 12
const MAX_WORKSPACES_PER_WINDOW = 12
const MAX_TABS_PER_WORKSPACE = 100

export class WorkspaceSessionStore {
  private restoredRuntimes = new Map<number, DesktopSessionWindow>()
  private restoredWindowIds = new Map<number, string>()
  private store = new Store<WorkspaceSessionStoreState>({
    name: 'workspace-session',
    defaults: { desktopSession: null, windowLifecycleV1Migrated: false },
  })

  migrateLegacyWindowLifecycle(): boolean {
    if (this.store.get('windowLifecycleV1Migrated', false)) return false
    const hadLegacySession = this.load()?.windows.length !== undefined
    this.store.set('desktopSession', null)
    this.store.set('windowLifecycleV1Migrated', true)
    return hadLegacySession
  }

  load(): DesktopSessionV1 | null {
    const session = this.store.get('desktopSession')
    if (!session || session.version !== 1 || !Array.isArray(session.windows)) return null
    return session
  }

  save(session: DesktopSessionV1): void {
    if (session.version !== 1 || session.windows.length > MAX_WINDOWS) {
      throw new Error('工作区桌面会话格式无效')
    }
    for (const window of session.windows) {
      if (!Array.isArray(window.workspaces) || window.workspaces.length > MAX_WORKSPACES_PER_WINDOW) {
        throw new Error('工作区窗口会话格式无效')
      }
      for (const workspace of window.workspaces) {
        if (!Array.isArray(workspace.tabs) || workspace.tabs.length > MAX_TABS_PER_WORKSPACE) {
          throw new Error('工作区标签会话格式无效')
        }
      }
    }
    this.store.set('desktopSession', session)
  }

  bindRestoredWindow(windowId: number, snapshotId: string): void {
    this.restoredWindowIds.set(windowId, snapshotId)
  }

  rememberRestoredRuntime(windowId: number, runtime: DesktopSessionWindow): void {
    this.restoredRuntimes.set(windowId, runtime)
    this.bindRestoredWindow(windowId, runtime.id)
  }

  getWindowSnapshotId(windowId: number): string {
    return this.restoredWindowIds.get(windowId) ?? `window-${windowId}`
  }

  forgetWindow(windowId: number): void {
    const snapshotId = this.getWindowSnapshotId(windowId)
    this.restoredRuntimes.delete(windowId)
    this.restoredWindowIds.delete(windowId)
    const session = this.load()
    if (!session) return
    this.save({ ...session, windows: session.windows.filter((window) => window.id !== snapshotId) })
  }

  takeRestoredRuntime(windowId: number): DesktopSessionWindow | null {
    const runtime = this.restoredRuntimes.get(windowId) ?? null
    this.restoredRuntimes.delete(windowId)
    return runtime
  }

  clear(): void {
    this.store.set('desktopSession', null)
  }
}

export const workspaceSessionStore = new WorkspaceSessionStore()
