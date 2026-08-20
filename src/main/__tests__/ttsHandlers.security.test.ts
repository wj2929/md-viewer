import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerTtsHandlers } from '../ipc/ttsHandlers'
import { synthesize } from '../tts/ttsService'
import { deleteProviderKey, hasProviderKey, setProviderKey } from '../tts/keyStore'
import { defaultReadAloudSettings, type ReadAloudSettings } from '../../shared/ttsProviders'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../tts/ttsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tts/ttsService')>()
  return { ...actual, synthesize: vi.fn() }
})

vi.mock('../tts/keyStore', () => ({
  setProviderKey: vi.fn(),
  deleteProviderKey: vi.fn(),
  hasProviderKey: vi.fn(() => true),
  isEncryptionAvailable: vi.fn(() => true),
}))

function getHandler<T extends (...args: any[]) => any>(channel: string): T {
  const registration = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`Missing handler: ${channel}`)
  return registration[1] as T
}

function event(senderId: number) {
  return { sender: { id: senderId } } as Electron.IpcMainInvokeEvent
}

const storedProvider = {
  id: 'custom-tts-safe',
  type: 'openai' as const,
  name: 'Safe provider',
  enabled: true,
  baseUrl: 'https://trusted.example/v1',
  voice: 'alloy',
  model: 'tts-1',
}

let readAloud: ReadAloudSettings
const updateSettings = vi.fn((updates: { readAloud?: ReadAloudSettings }) => {
  if (updates.readAloud) readAloud = updates.readAloud
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasProviderKey).mockReturnValue(true)
  readAloud = {
    ...defaultReadAloudSettings(),
    activeProviderId: storedProvider.id,
    providers: [...defaultReadAloudSettings().providers, storedProvider],
  }
  registerTtsHandlers({
    appDataManager: {
      getSettings: () => ({ readAloud }),
      updateSettings,
    },
  } as any)
})

describe('TTS IPC 安全边界', () => {
  it('非空 API Key 只允许写入当前启用的付费 provider，删除保持幂等', () => {
    const handler = getHandler('tts:setKey')

    expect(handler(event(7), storedProvider.id, 'secret')).toMatchObject({ ok: true })
    expect(setProviderKey).toHaveBeenCalledWith(
      storedProvider.id,
      'secret',
      'openai:https://trusted.example/v1'
    )

    expect(handler(event(7), 'edge', 'secret')).toMatchObject({ ok: false })
    expect(setProviderKey).toHaveBeenCalledTimes(1)

    expect(handler(event(7), 'custom-tts-removed', '')).toMatchObject({ ok: true })
    expect(deleteProviderKey).toHaveBeenCalledWith('custom-tts-removed')
  })

  it('专用读取按当前目标重算 hasApiKey', () => {
    vi.mocked(hasProviderKey).mockReturnValue(false)
    const handler = getHandler('tts:getSettings')

    const result = handler(event(7))

    expect(hasProviderKey).toHaveBeenCalledWith(
      storedProvider.id,
      'openai:https://trusted.example/v1'
    )
    expect(result.providers.find((provider: { id: string }) => provider.id === storedProvider.id))
      .toMatchObject({ hasApiKey: false })
  })

  it('专用设置更新拒绝不安全端点', () => {
    const handler = getHandler('tts:updateSettings')
    const providers = readAloud.providers.map((provider) => provider.id === storedProvider.id
      ? { ...provider, baseUrl: 'http://attacker.example/v1' }
      : provider)

    expect(() => handler(event(7), { ...readAloud, providers })).toThrow('必须使用 HTTPS')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('端点变化会清除旧 Key 并按真实状态重算 hasApiKey', () => {
    vi.mocked(hasProviderKey).mockReturnValue(false)
    const handler = getHandler('tts:updateSettings')
    const providers = readAloud.providers.map((provider) => provider.id === storedProvider.id
      ? { ...provider, baseUrl: 'https://new.example/v1', hasApiKey: true }
      : provider)

    const result = handler(event(7), { ...readAloud, providers })

    expect(deleteProviderKey).toHaveBeenCalledWith(storedProvider.id)
    expect(result.providers.find((provider: { id: string }) => provider.id === storedProvider.id))
      .toMatchObject({ baseUrl: 'https://new.example/v1', hasApiKey: false })
    expect(updateSettings).toHaveBeenCalledWith({ readAloud: result })
  })

  it('设置更新保留同服务的多个声音方案', () => {
    const handler = getHandler('tts:updateSettings')
    const profiles = [
      { id: 'voice-profile-a', name: '课程女声', model: 'model-a', voice: 'voice-a' },
      { id: 'voice-profile-b', name: '教学女声', model: 'model-a', voice: 'voice-b' },
    ]
    const providers = readAloud.providers.map((provider) => provider.id === storedProvider.id
      ? { ...provider, profiles, activeProfileId: profiles[1].id }
      : provider)

    const result = handler(event(7), { ...readAloud, providers })
    const saved = result.providers.find((provider: { id: string }) => provider.id === storedProvider.id)

    expect(saved).toMatchObject({ profiles, activeProfileId: 'voice-profile-b' })
    expect(updateSettings).toHaveBeenCalledWith({ readAloud: result })
  })

  it('按 providerId 使用主进程持久化配置，忽略 renderer 伪造端点', async () => {
    vi.mocked(synthesize).mockResolvedValue({ audioBase64: 'AA', format: 'mp3' })
    const handler = getHandler('tts:synthesize')

    await handler(event(7), {
      requestId: 'req-1',
      providerId: storedProvider.id,
      type: 'openai',
      text: '正文',
      baseUrl: 'https://attacker.example/v1',
      voice: 'attacker',
      model: 'attacker-model',
    })

    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      providerId: storedProvider.id,
      baseUrl: storedProvider.baseUrl,
      voice: storedProvider.voice,
      model: storedProvider.model,
      text: '正文',
    }), expect.any(AbortSignal))
  })

  it('拒绝同一 providerId 的类型篡改', async () => {
    const handler = getHandler('tts:synthesize')
    const result = await handler(event(7), {
      requestId: 'req-2',
      providerId: storedProvider.id,
      type: 'azure',
      text: '正文',
      region: 'attacker',
    })

    expect(result).toMatchObject({ ok: false, kind: 'config' })
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('同窗口重复 requestId 会取消旧请求，旧请求结束后仍可取消新请求', async () => {
    const signals: AbortSignal[] = []
    const resolvers: Array<() => void> = []
    vi.mocked(synthesize).mockImplementation((_req, signal) => {
      signals.push(signal!)
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ audioBase64: 'AA', format: 'mp3' }))
      })
    })
    const synthesizeHandler = getHandler('tts:synthesize')
    const cancelHandler = getHandler('tts:cancel')
    const request = {
      requestId: 'reused-id',
      providerId: storedProvider.id,
      type: 'openai' as const,
      text: '正文',
    }

    const first = synthesizeHandler(event(7), request)
    await Promise.resolve()
    const second = synthesizeHandler(event(7), request)
    await Promise.resolve()
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    resolvers[0]()
    await first
    cancelHandler(event(7), 'reused-id')
    expect(signals[1].aborted).toBe(true)

    resolvers[1]()
    await second
  })

  it('正式合成超时返回 network，用户取消仍返回 aborted', async () => {
    vi.useFakeTimers()
    vi.mocked(synthesize).mockImplementation((_req, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const synthesizeHandler = getHandler('tts:synthesize')
    const cancelHandler = getHandler('tts:cancel')
    const baseRequest = {
      providerId: storedProvider.id,
      type: 'openai' as const,
      text: '正文',
    }

    const timedOut = synthesizeHandler(event(7), { ...baseRequest, requestId: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(timedOut).resolves.toMatchObject({ ok: false, kind: 'network', message: '语音合成超时' })

    const canceled = synthesizeHandler(event(7), { ...baseRequest, requestId: 'cancel' })
    await Promise.resolve()
    cancelHandler(event(7), 'cancel')
    await expect(canceled).resolves.toMatchObject({ ok: false, kind: 'aborted' })
    vi.useRealTimers()
  })

  it('相同 requestId 只能由发起窗口取消', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.mocked(synthesize).mockImplementation((_req, signal) => {
      capturedSignal = signal
      return new Promise(() => {})
    })
    const synthesizeHandler = getHandler('tts:synthesize')
    const cancelHandler = getHandler('tts:cancel')
    void synthesizeHandler(event(7), {
      requestId: 'shared-id',
      providerId: storedProvider.id,
      type: 'openai',
      text: '正文',
    })
    await Promise.resolve()

    cancelHandler(event(8), 'shared-id')
    expect(capturedSignal?.aborted).toBe(false)
    cancelHandler(event(7), 'shared-id')
    expect(capturedSignal?.aborted).toBe(true)
  })
})
