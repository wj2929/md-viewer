import { create } from 'zustand'
import type { Tab } from '../components'
import type { SplitState } from '../utils/splitTree'
import type { PaneDiagnosticCause } from '../../../shared/diagnostics'
import { recordPaneChange } from '../utils/paneDiagnostics'

interface TabState {
  tabs: Tab[]
  activeTabId: string | null
  splitState: SplitState
  scrollToLine: number | undefined
  scrollToRatio: number | undefined
  highlightKeyword: string | undefined
}

interface TabActions {
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void
  setActiveTabId: (id: string | null, cause?: PaneDiagnosticCause) => void
  setSplitState: (updater: SplitState | ((prev: SplitState) => SplitState), cause?: PaneDiagnosticCause) => void
  setScrollToLine: (line: number | undefined) => void
  setScrollToRatio: (ratio: number | undefined) => void
  setHighlightKeyword: (keyword: string | undefined) => void
  addTab: (tab: Tab) => void
  removeTab: (tabId: string) => void
  updateTabContent: (tabId: string, content: string) => void
  updateTabFile: (tabId: string, updates: Partial<Tab['file']>) => void
  updateTabPinned: (tabId: string, isPinned: boolean) => void
}

type TabStore = TabState & TabActions

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitState: { root: null, activeLeafId: '' },
  scrollToLine: undefined,
  scrollToRatio: undefined,
  highlightKeyword: undefined,

  setTabs: (updater) => {
    if (typeof updater === 'function') {
      set({ tabs: updater(get().tabs) })
    } else {
      set({ tabs: updater })
    }
  },

  setActiveTabId: (id, cause = { source: 'unspecified' }) => {
    const before = get()
    set({ activeTabId: id })
    recordPaneChange(before, get(), 'tab', cause)
  },

  setSplitState: (updater, cause = { source: 'unspecified' }) => {
    const before = get()
    if (typeof updater === 'function') {
      set({ splitState: updater(get().splitState) })
    } else {
      set({ splitState: updater })
    }
    recordPaneChange(before, get(), 'split', cause)
  },

  setScrollToLine: (line) => set({ scrollToLine: line }),
  setScrollToRatio: (ratio) => set({ scrollToRatio: ratio }),
  setHighlightKeyword: (keyword) => set({ highlightKeyword: keyword }),

  addTab: (tab) => set({ tabs: [...get().tabs, tab] }),

  removeTab: (tabId) => set({ tabs: get().tabs.filter(t => t.id !== tabId) }),

  updateTabContent: (tabId, content) => {
    set({ tabs: get().tabs.map(t => t.id === tabId ? { ...t, content } : t) })
  },

  updateTabFile: (tabId, updates) => {
    set({
      tabs: get().tabs.map(t =>
        t.id === tabId ? { ...t, file: { ...t.file, ...updates } } : t
      )
    })
  },

  updateTabPinned: (tabId, isPinned) => {
    set({ tabs: get().tabs.map(t => t.id === tabId ? { ...t, isPinned } : t) })
  }
}))
