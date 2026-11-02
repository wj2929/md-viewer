import { create } from 'zustand'

type HydrationState = 'idle' | 'loading' | 'ready' | 'failed'

interface FolderSearchSettingsState {
  hydration: HydrationState
  enabled: boolean
  pending: boolean | null
  saving: boolean
  hasLoaded: boolean
  error: string | null
  revision: number
  load: () => () => void
  setEnabled: (enabled: boolean) => Promise<boolean>
}

let readRequest = 0
let writeRevision = 0

export const useFolderSearchSettingsStore = create<FolderSearchSettingsState>((set, get) => ({
  hydration: 'idle',
  enabled: false,
  pending: null,
  saving: false,
  hasLoaded: false,
  error: null,
  revision: 0,

  load: () => {
    const request = ++readRequest
    const write = writeRevision
    let active = true
    set(state => ({ hydration: 'loading', error: null, revision: state.revision + 1 }))
    const current = (): boolean => active && request === readRequest && write === writeRevision && !get().saving
    void (async () => {
      try {
        const settings = await window.api.getAppSettings()
        if (current()) {
          set(state => ({
            hydration: 'ready',
            enabled: settings.folderPinyinSearchEnabled === true,
            hasLoaded: true,
            revision: state.revision + 1,
          }))
        }
      } catch {
        if (current()) set({ hydration: 'failed', error: '读取失败，请重新打开' })
      }
    })()
    return () => {
      active = false
      if (request === readRequest && get().hydration === 'loading' && !get().saving) {
        set(state => ({ hydration: state.hasLoaded ? 'ready' : 'idle', revision: state.revision + 1 }))
      }
    }
  },

  setEnabled: async (enabled) => {
    const previous = get()
    if (previous.hydration !== 'ready' || previous.saving) return false
    if (previous.enabled === enabled) return true
    ++readRequest
    ++writeRevision
    set({ saving: true, pending: enabled, error: null, revision: previous.revision + 1 })
    try {
      await window.api.updateAppSettings({ folderPinyinSearchEnabled: enabled })
      ++readRequest
      set(state => ({
        enabled, pending: null, saving: false, hydration: 'ready', hasLoaded: true,
        revision: state.revision + 1,
      }))
      return true
    } catch {
      ++readRequest
      set(state => ({
        enabled: previous.enabled, pending: null, saving: false, hydration: 'ready',
        error: '设置未保存，请重试', revision: state.revision + 1,
      }))
      return false
    }
  },
}))
