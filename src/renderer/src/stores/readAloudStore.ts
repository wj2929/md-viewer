/**
 * 朗读设置 store(zustand,单一状态源)
 * @module stores/readAloudStore
 * @description 桥接 AppSettings.readAloud:启动载入,增删改 provider 既更内存又落盘。
 * ReadAloudBar 与设置"朗读"Tab 共订阅此 store,自动同步。
 * 照 bookmarkStore 范式:乐观更新(先 set 再 updateAppSettings,落盘失败只记日志)。
 * apiKey 不进此 store/AppSettings —— 走主进程 safeStorage(tts:setKey),这里只留 hasApiKey 布尔。
 */

import { create } from 'zustand'
import {
  defaultReadAloudSettings,
  findProviderConfig,
  PAID_TTS_META,
  type ReadAloudSettings,
  type TtsProviderConfig,
} from '../../../shared/ttsProviders'

interface ReadAloudState {
  settings: ReadAloudSettings
  loaded: boolean
}

interface ReadAloudActions {
  loadSettings: () => Promise<void>
  setActiveProvider: (id: string) => void
  setDefaultRate: (rate: number) => void
  setFallbackToSystem: (v: boolean) => void
  addProvider: (type: 'openai' | 'azure') => TtsProviderConfig
  updateProvider: (id: string, patch: Partial<TtsProviderConfig>) => void
  removeProvider: (id: string) => void
}

type ReadAloudStore = ReadAloudState & ReadAloudActions

/** 持久化整个 readAloud(浅合并到 AppSettings),失败只记日志不回滚 */
function persist(settings: ReadAloudSettings): void {
  window.api.updateAppSettings({ readAloud: settings }).catch((err) => {
    console.error('[ReadAloudStore] 落盘失败:', err)
  })
}

/** 生成自定义 provider 的 opaque id(照 OpenMAIC 'custom-tts-<uuid>' 命名空间) */
function newCustomId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `custom-tts-${rand}`
}

export const useReadAloudStore = create<ReadAloudStore>((set, get) => ({
  settings: defaultReadAloudSettings(),
  loaded: false,

  loadSettings: async () => {
    try {
      const app = await window.api.getAppSettings()
      // 无持久化(首次)则用默认;有则用存储值
      const settings = app.readAloud ?? defaultReadAloudSettings()
      set({ settings, loaded: true })
    } catch (error) {
      console.error('[ReadAloudStore] 载入失败,用默认:', error)
      set({ settings: defaultReadAloudSettings(), loaded: true })
    }
  },

  setActiveProvider: (id) => {
    const settings = { ...get().settings, activeProviderId: id }
    set({ settings })
    persist(settings)
  },

  setDefaultRate: (rate) => {
    const settings = { ...get().settings, defaultRate: rate }
    set({ settings })
    persist(settings)
  },

  setFallbackToSystem: (v) => {
    const settings = { ...get().settings, fallbackToSystem: v }
    set({ settings })
    persist(settings)
  },

  addProvider: (type) => {
    const meta = PAID_TTS_META[type]
    const config: TtsProviderConfig = {
      id: newCustomId(),
      type,
      name: type === 'openai' ? 'OpenAI TTS' : 'Azure TTS',
      baseUrl: meta.defaultBaseUrl,
      enabled: true,
      hasApiKey: false,
    }
    const settings = { ...get().settings, providers: [...get().settings.providers, config] }
    set({ settings })
    persist(settings)
    return config
  },

  updateProvider: (id, patch) => {
    const cur = get().settings
    // guard:防原型链污染 id,只改真实存在的 provider
    if (!findProviderConfig(cur.providers, id)) return
    const providers = cur.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    const settings = { ...cur, providers }
    set({ settings })
    persist(settings)
  },

  removeProvider: (id) => {
    const cur = get().settings
    const target = findProviderConfig(cur.providers, id)
    // 内建(system/edge)不可删
    if (!target || target.id === 'system' || target.id === 'edge') return
    const providers = cur.providers.filter((p) => p.id !== id)
    // 若删的是当前选中,回退到 edge
    const activeProviderId = cur.activeProviderId === id ? 'edge' : cur.activeProviderId
    const settings = { ...cur, providers, activeProviderId }
    set({ settings })
    persist(settings)
  },
}))
