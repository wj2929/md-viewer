/**
 * TTS 付费 provider 的 API key 加密存储
 * @module main/tts/keyStore
 * @description 用 Electron safeStorage(系统钥匙串)加密存 key,只在主进程解密使用。
 * 渲染进程只传 opaque providerId,拿不到明文 key。
 * 加密后的密文以 base64 存 electron-store(单独命名空间,与明文配置分离)。
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'

interface KeyStoreSchema {
  /** providerId → base64(加密后的 key) */
  keys: Record<string, string>
  /** providerId → 保存 Key 时绑定的 provider 目标指纹 */
  targets: Record<string, string>
}

const store = new Store<KeyStoreSchema>({
  name: 'tts-keys',
  defaults: { keys: {}, targets: {} },
})

/** 加密是否可用(某些 Linux 环境可能不可用) */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 存 key(加密)。空串视为删除。 */
export function setProviderKey(providerId: string, apiKey: string, target?: string): void {
  const keys = { ...store.get('keys') }
  const targets = { ...store.get('targets') }
  if (!apiKey) {
    delete keys[providerId]
    delete targets[providerId]
    store.set({ keys, targets })
    return
  }
  if (!target) throw new Error('缺少 API Key 目标绑定')
  if (!isEncryptionAvailable()) {
    throw new Error('系统加密不可用,无法安全保存 API Key')
  }
  const encrypted = safeStorage.encryptString(apiKey)
  keys[providerId] = encrypted.toString('base64')
  targets[providerId] = target
  store.set({ keys, targets })
}

/** 取 key(解密)。无则返回 undefined。 */
export function getProviderKey(providerId: string, target?: string): string | undefined {
  const keys = store.get('keys')
  const targets = store.get('targets')
  const b64 = Object.prototype.hasOwnProperty.call(keys, providerId) ? keys[providerId] : undefined
  const savedTarget = Object.prototype.hasOwnProperty.call(targets, providerId) ? targets[providerId] : undefined
  if (!b64 || !target || savedTarget !== target) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return undefined
  }
}

/** 是否已存 key */
export function hasProviderKey(providerId: string, target?: string): boolean {
  const keys = store.get('keys')
  const targets = store.get('targets')
  return Boolean(
    Object.prototype.hasOwnProperty.call(keys, providerId)
    && keys[providerId]
    && target
    && targets[providerId] === target
  )
}

/** 删除 key(provider 被删时调用) */
export function deleteProviderKey(providerId: string): void {
  const keys = { ...store.get('keys') }
  const targets = { ...store.get('targets') }
  if (
    Object.prototype.hasOwnProperty.call(keys, providerId)
    || Object.prototype.hasOwnProperty.call(targets, providerId)
  ) {
    delete keys[providerId]
    delete targets[providerId]
    store.set({ keys, targets })
  }
}
