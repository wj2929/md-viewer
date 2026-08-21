import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReadAloudStore } from '../../src/stores/readAloudStore'
import {
  defaultReadAloudSettings,
  DEFAULT_EDGE_VOICE,
  type ReadAloudSettings,
} from '../../../shared/ttsProviders'

// mock window.api(store 落盘/载入依赖)
const updateReadAloudSettings = vi.fn(async (settings) => settings)
const getReadAloudSettings = vi.fn()
const ttsSetKey = vi.fn().mockResolvedValue({ ok: true, hasKey: false })

beforeEach(() => {
  updateReadAloudSettings.mockClear()
  getReadAloudSettings.mockReset()
  ttsSetKey.mockClear()
  global.window = global.window || ({} as Window & typeof globalThis)
  ;(global.window as unknown as { api: unknown }).api = {
    updateReadAloudSettings,
    getReadAloudSettings,
    ttsSetKey,
  }
  // 每个用例重置为默认设置
  useReadAloudStore.setState({ settings: defaultReadAloudSettings(), loaded: false })
})

describe('readAloudStore', () => {
  it('默认含 system + edge 两个内建 provider,默认选 edge', () => {
    const s = useReadAloudStore.getState().settings
    expect(s.providers.map((p) => p.id).sort()).toEqual(['edge', 'system'])
    expect(s.activeProviderId).toBe('edge')
    expect(s.providers.find((p) => p.id === 'edge')).toMatchObject({
      name: 'Edge 免费',
      voice: DEFAULT_EDGE_VOICE,
    })
  })

  it('loadSettings:无持久化时用默认', async () => {
    getReadAloudSettings.mockResolvedValue(undefined)
    await useReadAloudStore.getState().loadSettings()
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe('edge')
    expect(useReadAloudStore.getState().loaded).toBe(true)
  })

  it('loadSettings:有持久化时用存储值', async () => {
    getReadAloudSettings.mockResolvedValue({
      ...defaultReadAloudSettings(),
      activeProviderId: 'system',
      defaultRate: 1.5,
      fallbackToSystem: false,
    })
    await useReadAloudStore.getState().loadSettings()
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe('system')
    expect(useReadAloudStore.getState().settings.defaultRate).toBe(1.5)
  })

  it('loadSettings:迁移旧 Edge 名称和缺失音色,保留其它设置', async () => {
    getReadAloudSettings.mockResolvedValue({
      activeProviderId: 'edge',
      defaultRate: 1.5,
      fallbackToSystem: false,
      providers: [
        { id: 'system', type: 'system', name: '系统声（离线）', enabled: true },
        { id: 'edge', type: 'edge', name: '晓晓（edge 免费）', enabled: true },
        { id: 'custom-tts-legacy', type: 'openai', name: '自定义', enabled: true },
      ],
    })
    await useReadAloudStore.getState().loadSettings()
    const settings = useReadAloudStore.getState().settings
    expect(settings.providers.find((p) => p.id === 'edge')).toMatchObject({
      name: 'Edge 免费', voice: DEFAULT_EDGE_VOICE,
    })
    expect(settings.providers.find((p) => p.id === 'custom-tts-legacy')).toBeDefined()
    expect(settings.defaultRate).toBe(1.5)
    expect(settings.fallbackToSystem).toBe(false)
    expect(updateReadAloudSettings).toHaveBeenCalledWith(settings)
  })

  it('loadSettings:迟到旧快照不覆盖加载期间的用户修改', async () => {
    let resolveSettings: ((value: unknown) => void) | undefined
    getReadAloudSettings.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve
    }))

    const loading = useReadAloudStore.getState().loadSettings()
    useReadAloudStore.getState().setDefaultRate(1.75)
    resolveSettings?.({
      activeProviderId: 'edge',
      defaultRate: 0.75,
      fallbackToSystem: true,
      providers: defaultReadAloudSettings().providers,
    })
    await loading

    expect(useReadAloudStore.getState().settings.defaultRate).toBe(1.75)
    expect(useReadAloudStore.getState().loaded).toBe(true)
  })

  it('setSystemVoice:只更新系统音色，支持恢复系统默认并落盘', () => {
    useReadAloudStore.getState().setSystemVoice('com.apple.voice.compact.zh-CN.Tingting')
    let settings = useReadAloudStore.getState().settings
    expect(settings.providers.find((p) => p.id === 'system')?.voice).toBe(
      'com.apple.voice.compact.zh-CN.Tingting'
    )
    expect(settings.providers.find((p) => p.id === 'edge')?.voice).toBe(DEFAULT_EDGE_VOICE)
    expect(updateReadAloudSettings).toHaveBeenCalledWith(settings)

    useReadAloudStore.getState().setSystemVoice('')
    settings = useReadAloudStore.getState().settings
    expect(settings.providers.find((p) => p.id === 'system')?.voice).toBeUndefined()
    expect(updateReadAloudSettings).toHaveBeenLastCalledWith(settings)
  })

  it('setEdgeVoice:只更新 Edge 音色并落盘', () => {
    useReadAloudStore.getState().setEdgeVoice('zh-CN-YunxiNeural')
    const settings = useReadAloudStore.getState().settings
    expect(settings.providers.find((p) => p.id === 'edge')?.voice).toBe('zh-CN-YunxiNeural')
    expect(settings.providers.find((p) => p.id === 'system')?.voice).toBeUndefined()
    expect(updateReadAloudSettings).toHaveBeenCalledWith(settings)
  })

  it('addProvider:新增付费 provider,套用类型默认端点,落盘', () => {
    const cfg = useReadAloudStore.getState().addProvider('openai')
    expect(cfg.type).toBe('openai')
    expect(cfg.id).toMatch(/^custom-tts-/)
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1')
    expect(cfg.hasApiKey).toBe(false)
    expect(useReadAloudStore.getState().settings.providers).toHaveLength(3)
    expect(updateReadAloudSettings).toHaveBeenCalledWith(expect.objectContaining({ providers: expect.any(Array) }))
  })

  it('addVoiceProfile:旧主进程回执缺少 profiles 时保留当前方案并报告失败', async () => {
    const cfg = useReadAloudStore.getState().addProvider('openai')
    await Promise.resolve()
    const originalCount = useReadAloudStore.getState().settings.providers
      .find((provider) => provider.id === cfg.id)?.profiles?.length
    updateReadAloudSettings.mockImplementationOnce(async (settings: ReadAloudSettings) => ({
      ...settings,
      providers: settings.providers.map((provider) => provider.id === cfg.id
        ? { id: provider.id, type: provider.type, name: provider.name, enabled: true, baseUrl: provider.baseUrl }
        : provider),
    }))

    const result = await useReadAloudStore.getState().addVoiceProfile(cfg.id)
    const current = useReadAloudStore.getState().settings.providers.find((provider) => provider.id === cfg.id)

    expect(result).toBeNull()
    expect(current?.profiles).toHaveLength((originalCount ?? 0) + 1)
    expect(current?.activeProfileId).toBeTruthy()
  })

  it('updateProvider:改真实 provider 生效并落盘', () => {
    const cfg = useReadAloudStore.getState().addProvider('azure')
    updateReadAloudSettings.mockClear()
    useReadAloudStore.getState().updateProvider(cfg.id, { name: '我的Azure', region: 'eastasia' })
    const p = useReadAloudStore.getState().settings.providers.find((x) => x.id === cfg.id)
    expect(p?.name).toBe('我的Azure')
    expect(p?.region).toBe('eastasia')
    expect(updateReadAloudSettings).toHaveBeenCalled()
  })

  it('updateProvider:采纳主进程规范化结果', async () => {
    const cfg = useReadAloudStore.getState().addProvider('openai')
    updateReadAloudSettings.mockImplementationOnce(async (settings: ReadAloudSettings) => ({
      ...settings,
      providers: settings.providers.map((provider) => provider.id === cfg.id
        ? { ...provider, hasApiKey: false }
        : provider),
    }))

    await useReadAloudStore.getState().updateProvider(cfg.id, {
      baseUrl: 'https://new.example/v1',
      hasApiKey: true,
    })

    expect(useReadAloudStore.getState().settings.providers.find((provider) => provider.id === cfg.id))
      .toMatchObject({ baseUrl: 'https://new.example/v1', hasApiKey: false })
  })

  it('updateProvider:原型链污染 id(如 toString/constructor)不生效', () => {
    const before = JSON.stringify(useReadAloudStore.getState().settings)
    useReadAloudStore.getState().updateProvider('toString', { name: 'hacked' })
    useReadAloudStore.getState().updateProvider('constructor', { name: 'hacked' })
    expect(JSON.stringify(useReadAloudStore.getState().settings)).toBe(before)
  })

  it('removeProvider:内建 system/edge 不可删', () => {
    useReadAloudStore.getState().removeProvider('system')
    useReadAloudStore.getState().removeProvider('edge')
    expect(useReadAloudStore.getState().settings.providers.map((p) => p.id).sort()).toEqual([
      'edge',
      'system',
    ])
  })

  it('removeProvider:删除当前选中的付费 provider → 回退 edge', () => {
    const cfg = useReadAloudStore.getState().addProvider('openai')
    useReadAloudStore.getState().setActiveProvider(cfg.id)
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe(cfg.id)
    useReadAloudStore.getState().removeProvider(cfg.id)
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe('edge')
    expect(useReadAloudStore.getState().settings.providers.find((p) => p.id === cfg.id)).toBeUndefined()
    expect(ttsSetKey).toHaveBeenCalledWith(cfg.id, '')
  })

  it('setActiveProvider / setDefaultRate / setFallbackToSystem 均落盘', () => {
    useReadAloudStore.getState().setActiveProvider('system')
    useReadAloudStore.getState().setDefaultRate(1.75)
    useReadAloudStore.getState().setFallbackToSystem(false)
    const s = useReadAloudStore.getState().settings
    expect(s.activeProviderId).toBe('system')
    expect(s.defaultRate).toBe(1.75)
    expect(s.fallbackToSystem).toBe(false)
    expect(updateReadAloudSettings).toHaveBeenCalledTimes(3)
  })
})
