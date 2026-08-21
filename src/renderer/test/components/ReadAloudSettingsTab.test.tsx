import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReadAloudSettingsTab from '../../src/components/ReadAloudSettingsTab'
import { useReadAloudStore } from '../../src/stores/readAloudStore'
import { defaultReadAloudSettings, type TtsProviderConfig } from '../../../shared/ttsProviders'

vi.mock('../../src/tts/engines/SystemSpeechEngine', () => ({
  loadSystemVoices: vi.fn().mockResolvedValue([]),
  toSystemVoiceOptions: vi.fn(() => []),
}))

const provider: TtsProviderConfig = {
  id: 'custom-tts-test',
  type: 'openai',
  name: '测试 OpenAI',
  enabled: true,
  baseUrl: 'https://old.example/v1',
  voice: 'alloy',
  hasApiKey: true,
}

const updateReadAloudSettings = vi.fn()
const ttsTestProvider = vi.fn()
const ttsSetKey = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  updateReadAloudSettings.mockImplementation(async (settings) => settings)
  ttsTestProvider.mockResolvedValue({ ok: true })
  ttsSetKey.mockResolvedValue({ ok: true, hasKey: true })
  Object.assign(window, {
    api: {
      updateReadAloudSettings,
      ttsTestProvider,
      ttsListVoices: vi.fn().mockResolvedValue([]),
      ttsSetKey,
    },
  })
  const settings = defaultReadAloudSettings()
  useReadAloudStore.setState({
    settings: {
      ...settings,
      activeProviderId: provider.id,
      providers: [...settings.providers, provider],
    },
    loaded: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReadAloudSettingsTab 连接测试', () => {
  it('为声音方案字段显示明确标题', () => {
    const profile = {
      id: 'voice-profile-test',
      name: '课程女声',
      model: 'volcengine-tts',
      voice: 'BV700_streaming',
    }
    useReadAloudStore.setState((state) => ({
      settings: {
        ...state.settings,
        providers: state.settings.providers.map((item) => item.id === provider.id
          ? { ...item, profiles: [profile], activeProfileId: profile.id }
          : item),
      },
    }))

    render(<ReadAloudSettingsTab />)

    expect(screen.getByText('默认方案')).toBeTruthy()
    expect(screen.getByRole('group', { name: '声音方案 1' })).toBeTruthy()
    expect(screen.getByText('方案名称')).toBeTruthy()
    expect(screen.getByText('模型')).toBeTruthy()
    expect(screen.getByText('音色')).toBeTruthy()
    expect(screen.getByText('当前默认')).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ 添加声音方案' })).toBeTruthy()
  })

  it('先保存当前配置，再由主进程按 providerId 测试', async () => {
    render(<ReadAloudSettingsTab />)
    fireEvent.change(screen.getByDisplayValue(provider.baseUrl!), {
      target: { value: 'https://new.example/v1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    await waitFor(() => expect(ttsTestProvider).toHaveBeenCalledTimes(1))
    expect(updateReadAloudSettings).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.arrayContaining([
        expect.objectContaining({ id: provider.id, baseUrl: 'https://new.example/v1' }),
      ]),
    }))
    expect(ttsTestProvider).toHaveBeenCalledWith({
      providerId: provider.id,
      type: provider.type,
    })
  })

  it('新 Key 按新端点保存后再测试', async () => {
    const order: string[] = []
    updateReadAloudSettings.mockImplementation(async (settings) => {
      order.push('settings')
      return settings
    })
    ttsSetKey.mockImplementation(async () => {
      order.push('key')
      return { ok: true, hasKey: true }
    })
    ttsTestProvider.mockImplementation(async () => {
      order.push('test')
      return { ok: true }
    })

    render(<ReadAloudSettingsTab />)
    fireEvent.change(screen.getByDisplayValue(provider.baseUrl!), {
      target: { value: 'https://new.example/v1' },
    })
    fireEvent.change(screen.getByPlaceholderText('已设置（重输可替换）'), {
      target: { value: 'new-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    await waitFor(() => expect(ttsTestProvider).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['settings', 'key', 'settings', 'test'])
    expect(ttsSetKey).toHaveBeenCalledWith(provider.id, 'new-secret')
  })

  it('配置保存失败时停止测试连接', async () => {
    updateReadAloudSettings.mockRejectedValue(new Error('disk full'))
    render(<ReadAloudSettingsTab />)
    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    expect(await screen.findByText(/朗读配置保存失败/)).toBeTruthy()
    expect(ttsTestProvider).not.toHaveBeenCalled()
  })
})
