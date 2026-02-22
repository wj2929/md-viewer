import { create } from 'zustand'

const MAX_HISTORY = 20

interface SearchHistoryState {
  searchBarHistory: string[]
  inPageSearchHistory: string[]
  isLoaded: boolean
}

interface SearchHistoryActions {
  loadFromMain: () => Promise<void>
  addSearchBarHistory: (keyword: string) => void
  removeSearchBarHistory: (keyword: string) => void
  clearSearchBarHistory: () => void
  addInPageSearchHistory: (keyword: string) => void
  removeInPageSearchHistory: (keyword: string) => void
  clearInPageSearchHistory: () => void
}

type SearchHistoryStore = SearchHistoryState & SearchHistoryActions

const getApi = (): any => (window as any).api

function addToHistory(history: string[], keyword: string): string[] {
  const trimmed = keyword.trim()
  if (!trimmed) return history
  const filtered = history.filter(item => item !== trimmed)
  return [trimmed, ...filtered].slice(0, MAX_HISTORY)
}

export const useSearchHistoryStore = create<SearchHistoryStore>()((set, get) => ({
  searchBarHistory: [],
  inPageSearchHistory: [],
  isLoaded: false,

  loadFromMain: async () => {
    const api = getApi()
    if (!api?.loadSearchHistory) { set({ isLoaded: true }); return }
    try {
      const data = await api.loadSearchHistory()
      set({
        searchBarHistory: data.searchBarHistory || [],
        inPageSearchHistory: data.inPageSearchHistory || [],
        isLoaded: true
      })
    } catch {
      set({ isLoaded: true })
    }
  },

  addSearchBarHistory: (keyword) => {
    const trimmed = keyword.trim()
    if (!trimmed) return
    // 乐观更新：立即更新本地 state
    set({ searchBarHistory: addToHistory(get().searchBarHistory, trimmed) })
    // 异步同步到主进程
    getApi()?.addSearchHistory?.('searchBar', trimmed)?.catch?.(() => {})
  },

  removeSearchBarHistory: (keyword) => {
    set({ searchBarHistory: get().searchBarHistory.filter(item => item !== keyword) })
    getApi()?.removeSearchHistory?.('searchBar', keyword)?.catch?.(() => {})
  },

  clearSearchBarHistory: () => {
    set({ searchBarHistory: [] })
    getApi()?.clearSearchHistory?.('searchBar')?.catch?.(() => {})
  },

  addInPageSearchHistory: (keyword) => {
    const trimmed = keyword.trim()
    if (!trimmed) return
    set({ inPageSearchHistory: addToHistory(get().inPageSearchHistory, trimmed) })
    getApi()?.addSearchHistory?.('inPage', trimmed)?.catch?.(() => {})
  },

  removeInPageSearchHistory: (keyword) => {
    set({ inPageSearchHistory: get().inPageSearchHistory.filter(item => item !== keyword) })
    getApi()?.removeSearchHistory?.('inPage', keyword)?.catch?.(() => {})
  },

  clearInPageSearchHistory: () => {
    set({ inPageSearchHistory: [] })
    getApi()?.clearSearchHistory?.('inPage')?.catch?.(() => {})
  }
}))

// 应用启动时加载
useSearchHistoryStore.getState().loadFromMain()
