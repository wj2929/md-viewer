import { create } from 'zustand'
import type { QuickEditTarget } from '../utils/quickEditTarget'

interface QuickEditPlacementState {
  placements: Record<string, QuickEditTarget>
  scrollSyncEnabled: Record<string, boolean>
  openPlacement: (target: QuickEditTarget) => void
  closePlacement: (placementKey: string) => void
  getPlacementForLeaf: (placementKey: string) => QuickEditTarget | null
  setScrollSyncEnabled: (placementKey: string, enabled: boolean) => void
  isScrollSyncEnabled: (placementKey: string) => boolean
  reset: () => void
}

function getPlacementKey(target: QuickEditTarget): string {
  return target.leafId || 'single'
}

export const useQuickEditPlacementStore = create<QuickEditPlacementState>((set, get) => ({
  placements: {},
  scrollSyncEnabled: {},

  openPlacement: (target) => {
    const key = getPlacementKey(target)
    set(state => ({
      placements: {
        ...state.placements,
        [key]: target,
      },
    }))
  },

  closePlacement: (placementKey) => {
    set(state => {
      const placements = { ...state.placements }
      const scrollSyncEnabled = { ...state.scrollSyncEnabled }
      delete placements[placementKey]
      delete scrollSyncEnabled[placementKey]
      return { placements, scrollSyncEnabled }
    })
  },

  getPlacementForLeaf: (placementKey) => {
    return get().placements[placementKey] || null
  },

  setScrollSyncEnabled: (placementKey, enabled) => {
    set(state => ({
      scrollSyncEnabled: {
        ...state.scrollSyncEnabled,
        [placementKey]: enabled,
      },
    }))
  },

  isScrollSyncEnabled: (placementKey) => {
    return Boolean(get().scrollSyncEnabled[placementKey])
  },

  reset: () => set({ placements: {}, scrollSyncEnabled: {} }),
}))
