import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  data: {
    keys: {} as Record<string, string>,
    targets: {} as Record<string, string>,
  },
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, '')),
  },
}))

vi.mock('electron-store', () => ({
  default: function MockStore() {
    return {
      get: vi.fn((key: 'keys' | 'targets') => state.data[key]),
      set: vi.fn((value: typeof state.data) => {
        state.data = {
          keys: { ...value.keys },
          targets: { ...value.targets },
        }
      }),
    }
  },
}))

const {
  deleteProviderKey,
  getProviderKey,
  hasProviderKey,
  setProviderKey,
} = await import('../tts/keyStore')

beforeEach(() => {
  state.data = { keys: {}, targets: {} }
})

describe('TTS KeyStore 目标绑定', () => {
  it('只允许相同目标读取和识别 Key', () => {
    setProviderKey('custom-tts-test', 'secret', 'openai:https://trusted.example/v1')

    expect(getProviderKey('custom-tts-test', 'openai:https://trusted.example/v1')).toBe('secret')
    expect(hasProviderKey('custom-tts-test', 'openai:https://trusted.example/v1')).toBe(true)
    expect(getProviderKey('custom-tts-test', 'openai:https://attacker.example/v1')).toBeUndefined()
    expect(hasProviderKey('custom-tts-test', 'openai:https://attacker.example/v1')).toBe(false)
  })

  it('没有目标指纹的旧 Key 安全失效', () => {
    state.data.keys['custom-tts-legacy'] = Buffer.from('encrypted:legacy').toString('base64')

    expect(getProviderKey('custom-tts-legacy', 'openai:https://trusted.example/v1')).toBeUndefined()
    expect(hasProviderKey('custom-tts-legacy', 'openai:https://trusted.example/v1')).toBe(false)
  })

  it('删除时同时清理密文和目标指纹', () => {
    setProviderKey('custom-tts-test', 'secret', 'azure:eastasia')
    deleteProviderKey('custom-tts-test')

    expect(state.data.keys).not.toHaveProperty('custom-tts-test')
    expect(state.data.targets).not.toHaveProperty('custom-tts-test')
  })
})
