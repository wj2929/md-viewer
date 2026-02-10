import { create } from 'zustand'
import type { LightboxState } from '../components'

interface LayoutState {
  sidebarWidth: number
  isResizing: boolean
  showSettings: boolean
  showShortcutsHelp: boolean
  isFullscreen: boolean
  isDragOver: boolean
  lightbox: LightboxState | null
}

interface LayoutActions {
  setSidebarWidth: (width: number) => void
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
  sidebarWidth: 280,
  isResizing: false,
  showSettings: false,
  showShortcutsHelp: false,
  isFullscreen: false,
  isDragOver: false,
  lightbox: null,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setIsResizing: (resizing) => set({ isResizing: resizing }),
  setShowSettings: (show) => set({ showSettings: show }),
  toggleSettings: () => set({ showSettings: !get().showSettings }),
  setShowShortcutsHelp: (show) => set({ showShortcutsHelp: show }),
  toggleShortcutsHelp: () => set({ showShortcutsHelp: !get().showShortcutsHelp }),
  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setIsDragOver: (over) => set({ isDragOver: over }),
  setLightbox: (state) => set({ lightbox: state })
}))
