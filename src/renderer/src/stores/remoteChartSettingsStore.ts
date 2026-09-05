import { create } from 'zustand'

type HydrationState = 'loading' | 'ready' | 'failed'

interface RemoteChartSettingsState {
  hydration: HydrationState
  autoRenderRemoteCharts: boolean
  approvedDocuments: Record<string, true>
  hydrate: () => Promise<void>
  setAutoRenderRemoteCharts: (enabled: boolean) => Promise<boolean>
  approveDocument: (documentKey: string) => void
}

let hydrationPromise: Promise<void> | null = null

export function remoteChartDocumentKey(filePath?: string, tabId?: string): string | null {
  if (filePath) return `file:${filePath.replaceAll('\\', '/')}`
  if (tabId) return `tab:${tabId}`
  return null
}

export const useRemoteChartSettingsStore = create<RemoteChartSettingsState>((set, get) => ({
  hydration: 'loading',
  autoRenderRemoteCharts: true,
  approvedDocuments: {},

  hydrate: async () => {
    if (get().hydration !== 'loading') return
    if (hydrationPromise) return hydrationPromise

    hydrationPromise = (async () => {
      try {
        const settings = await window.api.getAppSettings()
        set({
          hydration: 'ready',
          autoRenderRemoteCharts: settings.autoRenderRemoteCharts !== false,
        })
      } catch (error) {
        console.error('[RemoteCharts] 无法载入自动渲染设置:', error)
        set({ hydration: 'failed', autoRenderRemoteCharts: false })
      } finally {
        hydrationPromise = null
      }
    })()
    return hydrationPromise
  },

  setAutoRenderRemoteCharts: async (enabled) => {
    const previous = get()
    set({
      autoRenderRemoteCharts: enabled,
      ...(enabled ? {} : { approvedDocuments: {} }),
    })
    try {
      await window.api.updateAppSettings({ autoRenderRemoteCharts: enabled })
      set({ hydration: 'ready' })
      return true
    } catch (error) {
      console.error('[RemoteCharts] 无法保存自动渲染设置:', error)
      set({
        autoRenderRemoteCharts: previous.autoRenderRemoteCharts,
        approvedDocuments: previous.approvedDocuments,
      })
      return false
    }
  },

  approveDocument: (documentKey) => {
    if (!documentKey) return
    set(state => ({
      approvedDocuments: { ...state.approvedDocuments, [documentKey]: true },
    }))
  },
}))
