/**
 * TTS 付费 provider 的本地加密存储。
 * 密钥只在主进程处理；不访问系统钥匙串或旧 tts-keys.json。
 */
import { app } from 'electron'
import Store from 'electron-store'
import { createCipheriv, createDecipheriv, createHash, getCiphers, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import files, { type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

interface KeyStoreSchema {
  formatVersion: number
  masterId: string
  keys: Record<string, string>
  targets: Record<string, string>
}

class LocalKeyError extends Error {}

const generations = new Map<string, number>()
let store: Store<KeyStoreSchema> | undefined
let initialization: Promise<Buffer> | undefined
const emptyState = (): KeyStoreSchema => ({ formatVersion: 1, masterId: '', keys: {}, targets: {} })
const directory = () => join(app.getPath('userData'), 'tts-local')
const masterPath = () => join(directory(), 'master.key')
const storePath = () => join(directory(), 'keys.json')
const fingerprint = (key: Buffer) => createHash('sha256').update(key).digest('hex')
const hasRecords = (state: KeyStoreSchema) => Object.keys(state.keys).length > 0
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

function invalidateProvider(providerId: string): number {
  const generation = (generations.get(providerId) ?? 0) + 1
  generations.set(providerId, generation)
  return generation
}

function ensureDirectory(create: boolean): boolean {
  try {
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(directory())
    } catch (error) {
      if (!missing(error)) throw error
      if (!create) return false
      fs.mkdirSync(directory(), { recursive: true, mode: 0o700 })
      stat = fs.lstatSync(directory())
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)) {
      throw new Error('unsafe directory')
    }
    return true
  } catch {
    throw new LocalKeyError('本地密钥目录不可安全访问，未改动已有数据')
  }
}

function checkFile(path: string): fs.Stats | undefined {
  try {
    const stat = fs.lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) {
      throw new Error('unsafe file')
    }
    return stat
  } catch (error) {
    if (missing(error)) return undefined
    throw new LocalKeyError('本地密钥文件权限或类型不安全，未改动已有数据')
  }
}

function getStore(): Store<KeyStoreSchema> {
  ensureDirectory(true)
  checkFile(storePath())
  // 不传 defaults，避免加载时修补或改写损坏/不完整的存储。
  store ??= new Store<KeyStoreSchema>({ cwd: directory(), name: 'keys', configFileMode: 0o600 })
  return store
}

function readState(): KeyStoreSchema {
  if (!ensureDirectory(false) || !checkFile(storePath())) return emptyState()
  try {
    const state = getStore().store
    const record = (value: unknown): value is Record<string, string> => Boolean(
      value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every(item => typeof item === 'string'),
    )
    if (state.formatVersion !== 1 || typeof state.masterId !== 'string'
      || !record(state.keys) || !record(state.targets)
      || (state.masterId !== '' && !/^[a-f0-9]{64}$/.test(state.masterId))
      || (hasRecords(state) && !state.masterId)) throw new Error('invalid store')
    return state
  } catch (error) {
    if (error instanceof LocalKeyError) throw error
    throw new LocalKeyError('本地密钥存储损坏或不可读取，请恢复备份；原文件未清空')
  }
}

function readMaster(state: KeyStoreSchema): Buffer {
  if (!ensureDirectory(false) || !checkFile(masterPath())) {
    throw new LocalKeyError('本地主密钥缺失，请恢复配套备份；不会自动替换已有密钥')
  }
  let fd: number | undefined
  try {
    fd = fs.openSync(masterPath(), fs.constants.O_RDONLY
      | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW))
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size !== 32
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) throw new Error('invalid master')
    const key = fs.readFileSync(fd)
    if (key.length !== 32 || (state.masterId && fingerprint(key) !== state.masterId)) throw new Error('master mismatch')
    return key
  } catch {
    throw new LocalKeyError('本地主密钥损坏、错配或不可读取，请恢复配套备份；原数据未修改')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function ensureMaster(): Promise<Buffer> {
  initialization ??= (async () => {
    const state = readState()
    if (ensureDirectory(false) && checkFile(masterPath())) return readMaster(state)
    if (hasRecords(state)) throw new LocalKeyError('本地主密钥缺失，请恢复配套备份；不会自动替换已有密钥')
    ensureDirectory(true)
    const temporary = join(directory(), `.master-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
    const key = randomBytes(32)
    let handle: FileHandle | undefined
    try {
      handle = await files.open(temporary, 'wx', 0o600)
      await handle.writeFile(key)
      await handle.sync()
      await handle.close()
      handle = undefined
      try {
        await files.link(temporary, masterPath())
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
      }
      // 只读完整发布后的胜者，不覆盖别的初始化请求创建的主密钥。
      return readMaster(readState())
    } finally {
      await handle?.close().catch(() => undefined)
      await files.unlink(temporary).catch(() => undefined)
    }
  })().finally(() => { initialization = undefined })
  return initialization
}

function aad(providerId: string, target: string): Buffer {
  return Buffer.from(JSON.stringify([1, providerId, target]))
}

function decryptRecord(encoded: string, key: Buffer, providerId: string, target: string): string {
  const [version, ivText, tagText, dataText, extra] = encoded.split(':')
  if (version !== 'v1' || !ivText || !tagText || !dataText || extra !== undefined) throw new Error('invalid record')
  const decode = (text: string) => {
    const bytes = Buffer.from(text, 'base64')
    if (bytes.toString('base64') !== text) throw new Error('invalid base64')
    return bytes
  }
  const iv = decode(ivText)
  const tag = decode(tagText)
  if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid record')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad(providerId, target))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(decode(dataText)), decipher.final()]).toString('utf8')
}

function boundRecord(state: KeyStoreSchema, providerId: string, target?: string): string | undefined {
  return target && own(state.keys, providerId) && own(state.targets, providerId)
    && state.targets[providerId] === target ? state.keys[providerId] : undefined
}

export async function isEncryptionAvailable(): Promise<boolean> {
  try {
    const state = readState()
    if (hasRecords(state) || (ensureDirectory(false) && checkFile(masterPath()))) readMaster(state)
    return getCiphers().includes('aes-256-gcm')
  } catch {
    return false
  }
}

/** 后发保存、删除或目标变化使旧的异步保存失效。 */
export async function setProviderKey(providerId: string, apiKey: string, target?: string): Promise<void> {
  if (!apiKey) {
    deleteProviderKey(providerId)
    return
  }
  if (!target) throw new LocalKeyError('缺少 API Key 目标绑定')
  const generation = invalidateProvider(providerId)
  try {
    const initialized = await ensureMaster()
    if (generations.get(providerId) !== generation) throw new LocalKeyError('密钥保存请求已失效，请重试')
    const state = readState()
    const key = readMaster(state)
    if (!key.equals(initialized)) throw new LocalKeyError('本地主密钥已变化，请恢复配套备份后重试')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(aad(providerId, target))
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
    const encoded = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':')
    getStore().set({
      formatVersion: 1,
      masterId: fingerprint(key),
      keys: { ...state.keys, [providerId]: encoded },
      targets: { ...state.targets, [providerId]: target },
    })
  } catch (error) {
    if (error instanceof LocalKeyError) throw error
    throw new LocalKeyError('API Key 本地加密保存失败，请重试；未报告保存成功')
  }
}

export async function getProviderKey(providerId: string, target?: string): Promise<string | undefined> {
  try {
    const state = readState()
    const encoded = boundRecord(state, providerId, target)
    if (!encoded || !target) return undefined
    const generation = generations.get(providerId) ?? 0
    const key = await Promise.resolve(readMaster(state))
    const result = decryptRecord(encoded, key, providerId, target)
    const current = readState()
    if ((generations.get(providerId) ?? 0) !== generation
      || boundRecord(current, providerId, target) !== encoded
      || current.masterId !== state.masterId
      || !readMaster(current).equals(key)) return undefined
    return result
  } catch {
    return undefined
  }
}

export function hasProviderKey(providerId: string, target?: string): boolean {
  try {
    const state = readState()
    const encoded = boundRecord(state, providerId, target)
    return Boolean(encoded && target && decryptRecord(encoded, readMaster(state), providerId, target))
  } catch {
    return false
  }
}

export function deleteProviderKey(providerId: string): void {
  invalidateProvider(providerId)
  const state = readState()
  if (!own(state.keys, providerId) && !own(state.targets, providerId)) return
  const keys = { ...state.keys }
  const targets = { ...state.targets }
  delete keys[providerId]
  delete targets[providerId]
  getStore().set({ ...state, masterId: Object.keys(keys).length ? state.masterId : '', keys, targets })
}
