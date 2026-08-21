/**
 * 朗读设置 store(zustand,单一状态源)
 * @module stores/readAloudStore
 * @description 通过 TTS 专用 IPC 启动载入并持久化 provider 设置。
 * ReadAloudBar 与设置"朗读"Tab 共订阅此 store,自动同步。
 * 设置采用乐观更新；主进程负责校验、规范化和 hasApiKey 重算。
 * apiKey 不进此 store/AppSettings —— 走主进程 safeStorage(tts:setKey),这里只留 hasApiKey 布尔。
 */

import { create } from 'zustand'
import {
  defaultReadAloudSettings,
  DEFAULT_EDGE_VOICE,
  findProviderConfig,
  isSupportedEdgeVoice,
  PAID_TTS_META,
  type ReadAloudSettings,
  type TtsProviderConfig,
  type TtsVoiceProfile,
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
  setSystemVoice: (voice?: string) => void
  setEdgeVoice: (voice: string) => void
  addProvider: (type: 'openai' | 'azure') => TtsProviderConfig
  updateProvider: (id: string, patch: Partial<TtsProviderConfig>) => Promise<boolean>
  addVoiceProfile: (providerId: string) => Promise<TtsVoiceProfile | null>
  updateVoiceProfile: (providerId: string, profileId: string, patch: Partial<TtsVoiceProfile>) => Promise<boolean>
  removeVoiceProfile: (providerId: string, profileId: string) => Promise<boolean>
  setActiveVoiceProfile: (providerId: string, profileId: string) => Promise<boolean>
  removeProvider: (id: string) => void
}

type ReadAloudStore = ReadAloudState & ReadAloudActions

let settingsRevision = 0

function preservesVoiceProfiles(
  submitted: ReadAloudSettings,
  persisted: ReadAloudSettings
): boolean {
  for (const provider of submitted.providers) {
    if (provider.type !== 'openai' || !provider.profiles) continue
    const returned = findProviderConfig(persisted.providers, provider.id)
    if (
      !returned
      || returned.type !== 'openai'
      || !Array.isArray(returned.profiles)
      || !returned.activeProfileId
    ) {
      return false
    }
  }
  return true
}

/** 持久化整个 readAloud(主进程会校验并规范化),失败返回 null */
async function persist(settings: ReadAloudSettings): Promise<ReadAloudSettings | null> {
  try {
    const persisted = await window.api.updateReadAloudSettings(settings)
    if (!preservesVoiceProfiles(settings, persisted)) {
      console.error('[ReadAloudStore] 主进程未返回声音方案，拒绝覆盖当前配置；请重启应用')
      return null
    }
    return persisted
  } catch (err) {
    console.error('[ReadAloudStore] 落盘失败:', err)
    return null
  }
}

/** 生成自定义 provider 的 opaque id(照 OpenMAIC 'custom-tts-<uuid>' 命名空间) */
function newVoiceProfileId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `voice-profile-${rand}`
}

function newCustomId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `custom-tts-${rand}`
}

function normalizeSettings(stored: ReadAloudSettings | undefined): { settings: ReadAloudSettings; changed: boolean } {
  const defaults = defaultReadAloudSettings()
  if (!stored || !Array.isArray(stored.providers)) return { settings: defaults, changed: !stored }

  let changed = false
  const providers = [...stored.providers]
  const system = findProviderConfig(providers, 'system')
  if (!system) {
    providers.unshift(defaults.providers[0])
    changed = true
  }
  const edge = findProviderConfig(providers, 'edge')
  if (!edge) {
    providers.push(defaults.providers[1])
    changed = true
  } else {
    const normalizedVoice = isSupportedEdgeVoice(edge.voice) ? edge.voice : DEFAULT_EDGE_VOICE
    const normalizedName = edge.name === '晓晓（edge 免费）' || !edge.name ? 'Edge 免费' : edge.name
    if (normalizedVoice !== edge.voice || normalizedName !== edge.name) changed = true
    const index = providers.findIndex((provider) => provider.id === 'edge')
    providers[index] = { ...edge, name: normalizedName, voice: normalizedVoice }
  }

  const activeExists = providers.some(
    (provider) => provider.id === stored.activeProviderId && provider.enabled
  )
  if (!activeExists) changed = true
  return {
    settings: {
      activeProviderId: activeExists ? stored.activeProviderId : 'edge',
      defaultRate: typeof stored.defaultRate === 'number' ? stored.defaultRate : defaults.defaultRate,
      fallbackToSystem: typeof stored.fallbackToSystem === 'boolean'
        ? stored.fallbackToSystem
        : defaults.fallbackToSystem,
      providers,
    },
    changed,
  }
}

export const useReadAloudStore = create<ReadAloudStore>((set, get) => ({
  settings: defaultReadAloudSettings(),
  loaded: false,

  loadSettings: async () => {
    const revisionAtStart = settingsRevision
    try {
      const stored = await window.api.getReadAloudSettings()
      if (settingsRevision !== revisionAtStart) {
        set({ loaded: true })
        return
      }
      const normalized = normalizeSettings(stored)
      set({ settings: normalized.settings, loaded: true })
      if (normalized.changed) persist(normalized.settings)
    } catch (error) {
      console.error('[ReadAloudStore] 载入失败,用默认:', error)
      if (settingsRevision === revisionAtStart) {
        set({ settings: defaultReadAloudSettings(), loaded: true })
      } else {
        set({ loaded: true })
      }
    }
  },

  setActiveProvider: (id) => {
    settingsRevision += 1
    const settings = { ...get().settings, activeProviderId: id }
    set({ settings })
    persist(settings)
  },

  setDefaultRate: (rate) => {
    settingsRevision += 1
    const settings = { ...get().settings, defaultRate: rate }
    set({ settings })
    persist(settings)
  },

  setFallbackToSystem: (v) => {
    settingsRevision += 1
    const settings = { ...get().settings, fallbackToSystem: v }
    set({ settings })
    persist(settings)
  },

  setSystemVoice: (voice) => {
    settingsRevision += 1
    const cur = get().settings
    const selectedVoice = voice || undefined
    const providers = cur.providers.map((provider) =>
      provider.id === 'system' ? { ...provider, voice: selectedVoice } : provider
    )
    const settings = { ...cur, providers }
    set({ settings })
    persist(settings)
  },

  setEdgeVoice: (voice) => {
    if (!isSupportedEdgeVoice(voice)) return
    settingsRevision += 1
    const cur = get().settings
    const providers = cur.providers.map((provider) =>
      provider.id === 'edge' ? { ...provider, voice } : provider
    )
    const settings = { ...cur, providers }
    set({ settings })
    persist(settings)
  },

  addProvider: (type) => {
    settingsRevision += 1
    const meta = PAID_TTS_META[type]
    const defaultProfile = type === 'openai'
      ? { id: newVoiceProfileId(), name: 'OpenAI 默认', model: 'tts-1', voice: 'alloy' }
      : undefined
    const config: TtsProviderConfig = {
      id: newCustomId(),
      type,
      name: type === 'openai' ? 'OpenAI TTS' : 'Azure TTS',
      baseUrl: meta.defaultBaseUrl,
      enabled: true,
      hasApiKey: false,
      ...(defaultProfile ? { profiles: [defaultProfile], activeProfileId: defaultProfile.id } : {}),
    }
    const settings = { ...get().settings, providers: [...get().settings.providers, config] }
    set({ settings })
    persist(settings)
    return config
  },

  updateProvider: async (id, patch) => {
    const cur = get().settings
    // guard:防原型链污染 id,只改真实存在的 provider
    if (!findProviderConfig(cur.providers, id)) return false
    settingsRevision += 1
    const revision = settingsRevision
    const providers = cur.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    const settings = { ...cur, providers }
    set({ settings })
    const persisted = await persist(settings)
    if (!persisted) return false
    if (settingsRevision === revision) set({ settings: persisted })
    return true
  },

  addVoiceProfile: async (providerId) => {
    const cur = get().settings
    const provider = findProviderConfig(cur.providers, providerId)
    if (!provider || provider.type !== 'openai' || (provider.profiles?.length ?? 0) >= 50) return null
    const profile = { id: newVoiceProfileId(), name: '新声音', model: 'tts-1', voice: 'alloy' }
    const profiles = [...(provider.profiles ?? []), profile]
    const updated = await get().updateProvider(providerId, {
      profiles,
      activeProfileId: provider.activeProfileId ?? profile.id,
    })
    return updated ? profile : null
  },

  updateVoiceProfile: async (providerId, profileId, patch) => {
    const provider = findProviderConfig(get().settings.providers, providerId)
    if (!provider || provider.type !== 'openai' || !provider.profiles?.some((p) => p.id === profileId)) return false
    return get().updateProvider(providerId, {
      profiles: provider.profiles.map((profile) => profile.id === profileId ? { ...profile, ...patch, id: profile.id } : profile),
    })
  },

  removeVoiceProfile: async (providerId, profileId) => {
    const provider = findProviderConfig(get().settings.providers, providerId)
    if (!provider || provider.type !== 'openai' || !provider.profiles || provider.profiles.length <= 1) return false
    const profiles = provider.profiles.filter((profile) => profile.id !== profileId)
    if (profiles.length === provider.profiles.length) return false
    return get().updateProvider(providerId, {
      profiles,
      activeProfileId: provider.activeProfileId === profileId ? profiles[0].id : provider.activeProfileId,
    })
  },

  setActiveVoiceProfile: async (providerId, profileId) => {
    const provider = findProviderConfig(get().settings.providers, providerId)
    if (!provider || provider.type !== 'openai' || !provider.profiles?.some((p) => p.id === profileId)) return false
    return get().updateProvider(providerId, { activeProfileId: profileId })
  },

  removeProvider: (id) => {
    const cur = get().settings
    const target = findProviderConfig(cur.providers, id)
    // 内建(system/edge)不可删
    if (!target || target.id === 'system' || target.id === 'edge') return
    settingsRevision += 1
    const providers = cur.providers.filter((p) => p.id !== id)
    // 若删的是当前选中,回退到 edge
    const activeProviderId = cur.activeProviderId === id ? 'edge' : cur.activeProviderId
    const settings = { ...cur, providers, activeProviderId }
    set({ settings })
    persist(settings)
    window.api.ttsSetKey(id, '').catch((err) => {
      console.error('[ReadAloudStore] 删除 API Key 失败:', err)
    })
  },
}))
