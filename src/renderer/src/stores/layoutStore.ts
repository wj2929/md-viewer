import { create } from 'zustand'
import type { LightboxState } from '../components'

const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 500

const clampSidebarWidth = (width: number): number =>
  Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)

interface LayoutState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  isResizing: boolean
  showSettings: boolean
  showShortcutsHelp: boolean
  isFullscreen: boolean
  isDragOver: boolean
  lightbox: LightboxState | null
}

interface LayoutActions {
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => boolean
  loadSettings: () => Promise<void>
  persistSidebarWidth: () => Promise<void>
  setIsResizing: (resizing: boolean) => void
  setShowSettings: (show: boolean) => void
  toggleSettings: () => void
  setShowShortcutsHelp: (show: boolean) => void
  toggleShortcutsHelp: () => void
  setIsFullscreen: (fullscreen: boolean) => void
  setIsDragOver: (over: boolean) => void
  setLightbox: (state: LightboxState | null) => void
}

type LayoutStore = LayoutState & LayoutActions

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  isResizing: false,
  showSettings: false,
  showShortcutsHelp: false,
  isFullscreen: false,
  isDragOver: false,
  lightbox: null,

  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed
    set({ sidebarCollapsed: collapsed, isResizing: false })
    window.api.updateAppSettings({ sidebarCollapsed: collapsed }).catch(error => {
      console.error('[LayoutStore] Failed to save sidebar state:', error)
    })
    return collapsed
  },
  loadSettings: async () => {
    try {
      const settings = await window.api.getAppSettings()
      set({
        sidebarWidth: clampSidebarWidth(
          typeof settings.sidebarWidth === 'number' ? settings.sidebarWidth : DEFAULT_SIDEBAR_WIDTH
        ),
        sidebarCollapsed: settings.sidebarCollapsed === true,
        isResizing: false
      })
    } catch (error) {
      console.error('[LayoutStore] Failed to load settings:', error)
    }
  },
  persistSidebarWidth: async () => {
    try {
      await window.api.updateAppSettings({ sidebarWidth: get().sidebarWidth })
    } catch (error) {
      console.error('[LayoutStore] Failed to save sidebar width:', error)
    }
  },
  setIsResizing: (resizing) => set({ isResizing: resizing }),
  setShowSettings: (show) => set({ showSettings: show }),
  toggleSettings: () => set({ showSettings: !get().showSettings }),
  setShowShortcutsHelp: (show) => set({ showShortcutsHelp: show }),
  toggleShortcutsHelp: () => set({ showShortcutsHelp: !get().showShortcutsHelp }),
  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setIsDragOver: (over) => set({ isDragOver: over }),
  setLightbox: (state) => set({ lightbox: state })
}))
