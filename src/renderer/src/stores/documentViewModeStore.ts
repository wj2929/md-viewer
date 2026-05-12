import { create } from 'zustand'
import type { QuickEditTarget } from '../utils/quickEditTarget'

export type DocumentViewMode = 'preview' | 'edit' | 'compare'

export interface DocumentViewState {
  mode: DocumentViewMode
  compareRatio: number
  target: QuickEditTarget | null
}

interface DocumentViewModeState {
  views: Record<string, DocumentViewState>
  getViewState: (leafId: string, tabId: string) => DocumentViewState
  setMode: (leafId: string, tabId: string, mode: DocumentViewMode) => void
  setCompareRatio: (leafId: string, tabId: string, ratio: number) => void
  setTarget: (leafId: string, tabId: string, target: QuickEditTarget | null) => void
  resetView: (leafId: string, tabId: string) => void
  reset: () => void
}

const DEFAULT_VIEW: DocumentViewState = {
  mode: 'preview',
  compareRatio: 0.5,
  target: null,
}

function keyFor(leafId: string, tabId: string): string {
  return `${leafId}:${tabId}`
}

function clampRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio))
}

export const useDocumentViewModeStore = create<DocumentViewModeState>((set, get) => ({
  views: {},

  getViewState: (leafId, tabId) => {
    return get().views[keyFor(leafId, tabId)] ?? DEFAULT_VIEW
  },

  setMode: (leafId, tabId, mode) => {
    const key = keyFor(leafId, tabId)
    set(state => ({
      views: {
        ...state.views,
        [key]: { ...(state.views[key] ?? DEFAULT_VIEW), mode },
      },
    }))
  },

  setCompareRatio: (leafId, tabId, ratio) => {
    const key = keyFor(leafId, tabId)
    set(state => ({
      views: {
        ...state.views,
        [key]: { ...(state.views[key] ?? DEFAULT_VIEW), compareRatio: clampRatio(ratio) },
      },
    }))
  },

  setTarget: (leafId, tabId, target) => {
    const key = keyFor(leafId, tabId)
    set(state => ({
      views: {
        ...state.views,
        [key]: { ...(state.views[key] ?? DEFAULT_VIEW), target },
      },
    }))
  },

  resetView: (leafId, tabId) => {
    const key = keyFor(leafId, tabId)
    set(state => {
      const views = { ...state.views }
      delete views[key]
      return { views }
    })
  },

  reset: () => set({ views: {} }),
}))
