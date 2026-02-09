import { create } from 'zustand'
import type { Bookmark } from '../components'

interface BookmarkState {
  bookmarks: Bookmark[]
  bookmarksLoading: boolean
  bookmarkPanelCollapsed: boolean
  bookmarkPanelWidth: number
  bookmarkBarCollapsed: boolean
}

interface BookmarkActions {
  setBookmarks: (bookmarks: Bookmark[]) => void
  setBookmarksLoading: (loading: boolean) => void
  setBookmarkPanelCollapsed: (collapsed: boolean) => void
  setBookmarkPanelWidth: (width: number) => void
  setBookmarkBarCollapsed: (collapsed: boolean) => void
  loadBookmarks: () => Promise<void>
  loadSettings: () => Promise<void>
  togglePanel: () => boolean
  toggleBar: () => boolean
}

type BookmarkStore = BookmarkState & BookmarkActions

export const useBookmarkStore = create<BookmarkStore>((set, get) => ({
  bookmarks: [],
  bookmarksLoading: true,
  bookmarkPanelCollapsed: true,
  bookmarkPanelWidth: 240,
  bookmarkBarCollapsed: true,

  setBookmarks: (bookmarks) => set({ bookmarks }),
  setBookmarksLoading: (loading) => set({ bookmarksLoading: loading }),
  setBookmarkPanelCollapsed: (collapsed) => set({ bookmarkPanelCollapsed: collapsed }),
  setBookmarkPanelWidth: (width) => set({ bookmarkPanelWidth: width }),
  setBookmarkBarCollapsed: (collapsed) => set({ bookmarkBarCollapsed: collapsed }),

  loadBookmarks: async () => {
    set({ bookmarksLoading: true })
    try {
      const items = await window.api.getBookmarks()
      set({ bookmarks: items.sort((a: Bookmark, b: Bookmark) => a.order - b.order) })
    } catch (error) {
      console.error('[BookmarkStore] Failed to load bookmarks:', error)
    } finally {
      set({ bookmarksLoading: false })
    }
  },

  loadSettings: async () => {
    try {
      const settings = await window.api.getAppSettings()
      set({
        bookmarkPanelCollapsed: settings.bookmarkPanelCollapsed,
        bookmarkPanelWidth: settings.bookmarkPanelWidth,
        bookmarkBarCollapsed: settings.bookmarkBarCollapsed !== undefined
          ? settings.bookmarkBarCollapsed
          : true
      })
    } catch (error) {
      console.error('[BookmarkStore] Failed to load settings:', error)
    }
  },

  togglePanel: () => {
    const newState = !get().bookmarkPanelCollapsed
    set({ bookmarkPanelCollapsed: newState })
    window.api.updateAppSettings({ bookmarkPanelCollapsed: newState }).catch(err => {
      console.error('[BookmarkStore] Failed to save panel collapsed state:', err)
    })
    return newState
  },

  toggleBar: () => {
    const newState = !get().bookmarkBarCollapsed
    set({ bookmarkBarCollapsed: newState })
    window.api.updateAppSettings({ bookmarkBarCollapsed: newState }).catch(err => {
      console.error('[BookmarkStore] Failed to save bar collapsed state:', err)
    })
    return newState
  }
}))
