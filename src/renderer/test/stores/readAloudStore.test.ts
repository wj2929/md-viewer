import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReadAloudStore } from '../../src/stores/readAloudStore'
import { defaultReadAloudSettings } from '../../../shared/ttsProviders'

// mock window.api(store 落盘/载入依赖)
const updateAppSettings = vi.fn().mockResolvedValue(undefined)
const getAppSettings = vi.fn()

beforeEach(() => {
  updateAppSettings.mockClear()
  getAppSettings.mockReset()
  global.window = global.window || ({} as Window & typeof globalThis)
  ;(global.window as unknown as { api: unknown }).api = { updateAppSettings, getAppSettings }
  // 每个用例重置为默认设置
  useReadAloudStore.setState({ settings: defaultReadAloudSettings(), loaded: false })
})

describe('readAloudStore', () => {
  it('默认含 system + edge 两个内建 provider,默认选 edge', () => {
    const s = useReadAloudStore.getState().settings
    expect(s.providers.map((p) => p.id).sort()).toEqual(['edge', 'system'])
    expect(s.activeProviderId).toBe('edge')
  })

  it('loadSettings:无持久化时用默认', async () => {
    getAppSettings.mockResolvedValue({}) // 无 readAloud
    await useReadAloudStore.getState().loadSettings()
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe('edge')
    expect(useReadAloudStore.getState().loaded).toBe(true)
  })

  it('loadSettings:有持久化时用存储值', async () => {
    getAppSettings.mockResolvedValue({
      readAloud: { activeProviderId: 'system', defaultRate: 1.5, fallbackToSystem: false, providers: [] },
    })
    await useReadAloudStore.getState().loadSettings()
    expect(useReadAloudStore.getState().settings.activeProviderId).toBe('system')
    expect(useReadAloudStore.getState().settings.defaultRate).toBe(1.5)
  })

  it('addProvider:新增付费 provider,套用类型默认端点,落盘', () => {
    const cfg = useReadAloudStore.getState().addProvider('openai')
    expect(cfg.type).toBe('openai')
    expect(cfg.id).toMatch(/^custom-tts-/)
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1')
    expect(cfg.hasApiKey).toBe(false)
    expect(useReadAloudStore.getState().settings.providers).toHaveLength(3)
    expect(updateAppSettings).toHaveBeenCalledWith({ readAloud: expect.any(Object) })
  })

  it('updateProvider:改真实 provider 生效并落盘', () => {
    const cfg = useReadAloudStore.getState().addProvider('azure')
    updateAppSettings.mockClear()
    useReadAloudStore.getState().updateProvider(cfg.id, { name: '我的Azure', region: 'eastasia' })
    const p = useReadAloudStore.getState().settings.providers.find((x) => x.id === cfg.id)
    expect(p?.name).toBe('我的Azure')
    expect(p?.region).toBe('eastasia')
    expect(updateAppSettings).toHaveBeenCalled()
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
  })

  it('setActiveProvider / setDefaultRate / setFallbackToSystem 均落盘', () => {
    useReadAloudStore.getState().setActiveProvider('system')
    useReadAloudStore.getState().setDefaultRate(1.75)
    useReadAloudStore.getState().setFallbackToSystem(false)
    const s = useReadAloudStore.getState().settings
    expect(s.activeProviderId).toBe('system')
    expect(s.defaultRate).toBe(1.75)
    expect(s.fallbackToSystem).toBe(false)
    expect(updateAppSettings).toHaveBeenCalledTimes(3)
  })
})
