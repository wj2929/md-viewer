import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_HISTORY = 20

interface SearchHistoryState {
  searchBarHistory: string[]
  inPageSearchHistory: string[]
}

interface SearchHistoryActions {
  addSearchBarHistory: (keyword: string) => void
  removeSearchBarHistory: (keyword: string) => void
  clearSearchBarHistory: () => void
  addInPageSearchHistory: (keyword: string) => void
  removeInPageSearchHistory: (keyword: string) => void
  clearInPageSearchHistory: () => void
}

type SearchHistoryStore = SearchHistoryState & SearchHistoryActions

function addToHistory(history: string[], keyword: string): string[] {
  const trimmed = keyword.trim()
  if (!trimmed) return history
  const filtered = history.filter(item => item !== trimmed)
  return [trimmed, ...filtered].slice(0, MAX_HISTORY)
}

export const useSearchHistoryStore = create<SearchHistoryStore>()(
  persist(
    (set) => ({
      searchBarHistory: [],
      inPageSearchHistory: [],

      addSearchBarHistory: (keyword) =>
        set((state) => ({
          searchBarHistory: addToHistory(state.searchBarHistory, keyword)
        })),

      removeSearchBarHistory: (keyword) =>
        set((state) => ({
          searchBarHistory: state.searchBarHistory.filter(item => item !== keyword)
        })),

      clearSearchBarHistory: () => set({ searchBarHistory: [] }),

      addInPageSearchHistory: (keyword) =>
        set((state) => ({
          inPageSearchHistory: addToHistory(state.inPageSearchHistory, keyword)
        })),

      removeInPageSearchHistory: (keyword) =>
        set((state) => ({
          inPageSearchHistory: state.inPageSearchHistory.filter(item => item !== keyword)
        })),

      clearInPageSearchHistory: () => set({ inPageSearchHistory: [] })
    }),
    {
      name: 'md-viewer-search-history'
    }
  )
)
