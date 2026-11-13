import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import files from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Conf from 'conf'

const mocks = vi.hoisted(() => ({ root: '', options: [] as Array<Record<string, unknown>>, forbidden: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.root },
  get safeStorage() {
    mocks.forbidden()
    throw new Error('safeStorage must not be accessed')
  },
}))
vi.mock('electron-store', async () => {
  const { default: RealConf } = await import('conf')
  return { default: class extends RealConf {
    constructor(options: Record<string, unknown>) {
      mocks.options.push(options)
      if (options.name !== 'keys') throw new Error('legacy Store access is forbidden')
      super({ cwd: options.cwd as string, configName: 'keys', configFileMode: options.configFileMode as number })
    }
  } }
})

type KeyStore = typeof import('../tts/keyStore')
let keys: KeyStore
const target = 'openai:https://example.test/v1'
const publicKey = 'PUBLIC_TEST_KEY_NOT_A_CREDENTIAL'
const local = () => join(mocks.root, 'tts-local')
const master = () => join(local(), 'master.key')
const dataFile = () => join(local(), 'keys.json')
const state = () => JSON.parse(fs.readFileSync(dataFile(), 'utf8'))
const putState = (value: unknown) => fs.writeFileSync(dataFile(), JSON.stringify(value), { mode: 0o600 })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  mocks.root = fs.mkdtempSync(join(tmpdir(), 'mdv-local-key-test-'))
  mocks.options = []
  mocks.forbidden.mockClear()
  keys = await import('../tts/keyStore')
})
afterEach(() => {
  expect(mocks.forbidden).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  fs.rmSync(mocks.root, { recursive: true, force: true })
})

describe('无钥匙串的本地 TTS keyStore', () => {
  it('普通查询不创建目录或主密钥，也不实例化旧 Store', async () => {
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.getProviderKey('one', target)).resolves.toBeUndefined()
    await expect(keys.isEncryptionAvailable()).resolves.toBe(true)
    keys.deleteProviderKey('one')
    expect(fs.existsSync(local())).toBe(false)
    expect(mocks.options).toEqual([])
  })

  it('真实AES-GCM加密落盘，主密钥标识一致，重载后可读取', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const saved = state()
    const key = fs.readFileSync(master())
    expect(key.length).toBe(32)
    expect(saved.masterId).toBe(createHash('sha256').update(key).digest('hex'))
    expect(saved.keys.one).toMatch(/^v1:/)
    expect(fs.readFileSync(dataFile(), 'utf8')).not.toContain(publicKey)
    expect(keys.hasProviderKey('one', target)).toBe(true)
    expect(keys.hasProviderKey('one', 'other')).toBe(false)
    await expect(keys.getProviderKey('one', target)).resolves.toBe(publicKey)
    vi.resetModules()
    keys = await import('../tts/keyStore')
    await expect(keys.getProviderKey('one', target)).resolves.toBe(publicKey)
    expect(mocks.options.every(option => option.name === 'keys' && option.cwd === local() && option.configFileMode === 0o600)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('私有目录0700，主密钥与密文文件0600', async () => {
    await keys.setProviderKey('one', publicKey, target)
    expect(fs.statSync(local()).mode & 0o777).toBe(0o700)
    expect(fs.statSync(master()).mode & 0o777).toBe(0o600)
    expect(fs.statSync(dataFile()).mode & 0o777).toBe(0o600)
  })

  it('旧密钥文件零访问且原字节不变，不自动解密迁移', async () => {
    const old = join(mocks.root, 'tts-keys.json')
    const bytes = Buffer.from('{"keys":{"old":"legacy-cipher"},"targets":{"old":"old-target"}}')
    fs.writeFileSync(old, bytes)
    const read = vi.spyOn(fs, 'readFileSync')
    const stat = vi.spyOn(fs, 'lstatSync')
    const open = vi.spyOn(fs, 'openSync')
    vi.resetModules()
    keys = await import('../tts/keyStore')
    await keys.setProviderKey('one', publicKey, target)
    expect(keys.hasProviderKey('old', 'old-target')).toBe(false)
    for (const spy of [read, stat, open]) expect(spy.mock.calls.some(call => String(call[0]) === old)).toBe(false)
    expect(read.mock.calls.some(call => String(call[0]) === dataFile())).toBe(true)
    expect(stat.mock.calls.some(call => String(call[0]) === master())).toBe(true)
    expect(open.mock.calls.some(call => String(call[0]) === master())).toBe(true)
    read.mockRestore()
    expect(fs.readFileSync(old)).toEqual(bytes)
  })

  it('重复保存相同Key仍使用不同nonce和密文', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const first = state().keys.one
    await keys.setProviderKey('one', publicKey, target)
    expect(state().keys.one).not.toBe(first)
    await expect(keys.getProviderKey('one', target)).resolves.toBe(publicKey)
  })

  it('目标外部字段篡改及跨provider调换密文都不能解密', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const saved = state()
    putState({ ...saved, targets: { one: 'openai:https://other.test/v1' } })
    expect(keys.hasProviderKey('one', 'openai:https://other.test/v1')).toBe(false)
    await expect(keys.getProviderKey('one', 'openai:https://other.test/v1')).resolves.toBeUndefined()
    putState({ ...saved, keys: { two: saved.keys.one }, targets: { two: target } })
    expect(keys.hasProviderKey('two', target)).toBe(false)
    await expect(keys.getProviderKey('two', target)).resolves.toBeUndefined()
    await expect(keys.getProviderKey('toString', target)).resolves.toBeUndefined()
  })

  it.each(['v2', 'nonce', 'tag', 'cipher', 'base64'])('损坏%s时不误报已配置', async kind => {
    await keys.setProviderKey('one', publicKey, target)
    const saved = state()
    const parts = saved.keys.one.split(':')
    if (kind === 'v2') parts[0] = 'v2'
    if (kind === 'nonce') parts[1] = Buffer.alloc(3).toString('base64')
    if (kind === 'tag') parts[2] = Buffer.alloc(16, 9).toString('base64')
    if (kind === 'cipher') parts[3] = Buffer.alloc(4, 7).toString('base64')
    if (kind === 'base64') parts[3] = 'not-base64!'
    saved.keys.one = parts.join(':')
    putState(saved)
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.getProviderKey('one', target)).resolves.toBeUndefined()
  })

  it.each(['missing', 'length', 'bitflip', 'another-profile'])('主密钥%s时拒绝重建或覆盖任何密文', async kind => {
    await keys.setProviderKey('one', publicKey, target)
    const originalMaster = fs.readFileSync(master())
    const originalData = fs.readFileSync(dataFile())
    if (kind === 'missing') fs.unlinkSync(master())
    else if (kind === 'length') fs.writeFileSync(master(), Buffer.alloc(3))
    else {
      const bad = kind === 'bitflip' ? Buffer.from(originalMaster) : randomBytes(32)
      if (kind === 'bitflip') bad[0] ^= 1
      fs.writeFileSync(master(), bad)
    }
    const badMaster = fs.existsSync(master()) ? fs.readFileSync(master()) : undefined
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.isEncryptionAvailable()).resolves.toBe(false)
    await expect(keys.getProviderKey('one', target)).resolves.toBeUndefined()
    await expect(keys.setProviderKey('two', 'replacement', target)).rejects.toThrow(/主密钥/)
    expect(fs.readFileSync(dataFile())).toEqual(originalData)
    expect(fs.existsSync(master()) ? fs.readFileSync(master()) : undefined).toEqual(badMaster)
    fs.writeFileSync(master(), originalMaster, { mode: 0o600 })
    expect(keys.hasProviderKey('one', target)).toBe(true)
  })

  it('主密钥读取EACCES受控失败，不泄漏原异常内容或替换文件', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const originalData = fs.readFileSync(dataFile())
    const originalMaster = fs.readFileSync(master())
    const realOpen = fs.openSync.bind(fs)
    const denied = vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
      if (String(path) === master()) throw Object.assign(new Error(publicKey), { code: 'EACCES' })
      return realOpen(path, flags, mode)
    })
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.setProviderKey('two', publicKey, target)).rejects.toThrow('主密钥损坏、错配或不可读取')
    denied.mockRestore()
    expect(fs.readFileSync(dataFile())).toEqual(originalData)
    expect(fs.readFileSync(master())).toEqual(originalMaster)
  })

  it('拒绝缺失masterId的非空存储，不静默补齐', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const saved = state()
    delete saved.masterId
    putState(saved)
    const original = fs.readFileSync(dataFile())
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.setProviderKey('two', publicKey, target)).rejects.toThrow(/存储损坏/)
    expect(fs.readFileSync(dataFile())).toEqual(original)
  })

  it('损坏JSON受控失败，导入模块与免费服务初始化不被拖垮', async () => {
    fs.mkdirSync(local(), { mode: 0o700 })
    fs.writeFileSync(dataFile(), '{broken', { mode: 0o600 })
    vi.resetModules()
    keys = await import('../tts/keyStore')
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.isEncryptionAvailable()).resolves.toBe(false)
    await expect(keys.setProviderKey('one', publicKey, target)).rejects.toThrow(/存储损坏/)
    expect(fs.readFileSync(dataFile(), 'utf8')).toBe('{broken')
    expect(fs.existsSync(master())).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('拒绝主密钥符号链接及开放权限，不跟随或修复', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const original = fs.readFileSync(master())
    fs.chmodSync(master(), 0o644)
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.setProviderKey('two', publicKey, target)).rejects.toThrow(/权限/)
    fs.chmodSync(master(), 0o600)
    const other = join(mocks.root, 'other-owned-fixture')
    fs.renameSync(master(), other)
    fs.symlinkSync(other, master())
    expect(keys.hasProviderKey('one', target)).toBe(false)
    await expect(keys.setProviderKey('two', publicKey, target)).rejects.toThrow(/类型不安全/)
    expect(fs.readFileSync(other)).toEqual(original)
  })

  it('初始化共用一次完整发布，不同provider不丢更新，临时文件清理', async () => {
    const realLink = files.link.bind(files)
    const gate = deferred()
    const link = vi.spyOn(files, 'link').mockImplementationOnce(async (source, destination) => {
      await gate.promise
      return realLink(source, destination)
    })
    const a = keys.setProviderKey('a', 'public-a', 'target-a')
    const b = keys.setProviderKey('b', 'public-b', 'target-b')
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(1))
    expect(fs.existsSync(master())).toBe(false)
    expect(keys.hasProviderKey('a', 'target-a')).toBe(false)
    gate.resolve()
    await Promise.all([a, b])
    expect(Object.keys(state().keys).sort()).toEqual(['a', 'b'])
    await expect(keys.getProviderKey('a', 'target-a')).resolves.toBe('public-a')
    await expect(keys.getProviderKey('b', 'target-b')).resolves.toBe('public-b')
    expect(fs.readdirSync(local()).sort()).toEqual(['keys.json', 'master.key'])
  })

  it('发布遇到其他创建者时使用已完整落盘的胜者，不覆盖它', async () => {
    const realLink = files.link.bind(files)
    const winner = randomBytes(32)
    vi.spyOn(files, 'link').mockImplementationOnce(async (source, destination) => {
      fs.writeFileSync(String(destination), winner, { mode: 0o600, flag: 'wx' })
      return realLink(source, destination)
    })
    await keys.setProviderKey('one', publicKey, target)
    expect(fs.readFileSync(master())).toEqual(winner)
    await expect(keys.getProviderKey('one', target)).resolves.toBe(publicKey)
  })

  it('同provider后发优先，空存储删除也使pending保存失效', async () => {
    const old = keys.setProviderKey('same', 'old', target)
    const rejected = expect(old).rejects.toThrow('已失效')
    const latest = keys.setProviderKey('same', 'latest', target)
    await Promise.all([rejected, latest])
    await expect(keys.getProviderKey('same', target)).resolves.toBe('latest')
    const pending = keys.setProviderKey('deleted', 'pending', target)
    const removed = expect(pending).rejects.toThrow('已失效')
    keys.deleteProviderKey('deleted')
    await removed
    expect(keys.hasProviderKey('deleted', target)).toBe(false)
  })

  it('删除重建及目标A→B→A不返回迟到读取，空Key清除记录', async () => {
    await keys.setProviderKey('one', 'old', target)
    const reading = keys.getProviderKey('one', target)
    keys.deleteProviderKey('one')
    await keys.setProviderKey('one', 'other', 'other-target')
    keys.deleteProviderKey('one')
    await keys.setProviderKey('one', 'latest', target)
    await expect(reading).resolves.toBeUndefined()
    await expect(keys.getProviderKey('one', target)).resolves.toBe('latest')
    await keys.setProviderKey('one', '', target)
    expect(state().keys).toEqual({})
    expect(state().targets).toEqual({})
    expect(keys.hasProviderKey('one', target)).toBe(false)
  })

  it('主密钥发布失败不提交密文、不泄漏原异常内容，之后可重试', async () => {
    vi.spyOn(files, 'link').mockRejectedValueOnce(new Error(publicKey))
    await expect(keys.setProviderKey('one', publicKey, target)).rejects.toThrow('本地加密保存失败')
    expect(fs.existsSync(dataFile())).toBe(false)
    expect(fs.existsSync(master())).toBe(false)
    expect(fs.readdirSync(local())).toEqual([])
    await keys.setProviderKey('one', publicKey, target)
    expect(keys.hasProviderKey('one', target)).toBe(true)
  })

  it('密文提交失败不报成功，不覆盖已提交数据，之后可恢复', async () => {
    await keys.setProviderKey('one', publicKey, target)
    const original = fs.readFileSync(dataFile())
    const failure = vi.spyOn(Conf.prototype as any, '_write').mockImplementationOnce(() => { throw new Error(publicKey) })
    await expect(keys.setProviderKey('two', 'public-two', target)).rejects.toThrow('本地加密保存失败')
    expect(fs.readFileSync(dataFile())).toEqual(original)
    expect(keys.hasProviderKey('two', target)).toBe(false)
    failure.mockRestore()
    await keys.setProviderKey('two', 'public-two', target)
    expect(keys.hasProviderKey('two', target)).toBe(true)
  })
})
