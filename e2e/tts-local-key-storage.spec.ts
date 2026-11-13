import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const publicKey = 'PUBLIC_E2E_KEY_NOT_A_CREDENTIAL'
const endpoint = 'https://storage.example.invalid/v1'
const legacyBytes = Buffer.from('LEGACY_FILE_MUST_NOT_BE_READ_OR_REWRITTEN')
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')

function workspace() {
  const parent = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'tts-local-'))
  const profile = join(root, 'profile')
  mkdirSync(profile)
  writeFileSync(join(profile, 'tts-keys.json'), legacyBytes)
  const markdown = join(root, 'public.md')
  writeFileSync(markdown, '# Local key storage\n\nPublic test fixture.')
  return { root, profile, markdown }
}

async function launch(profile: string, markdown: string): Promise<{ app: ElectronApplication; page: Page }> {
  const packaged = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: [`--user-data-dir=${profile}`, ...(packaged ? [] : [join(process.cwd(), 'out/main/index.js')]), markdown],
    env: {
      ...process.env, NODE_ENV: 'test', MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_SKIP_RESTORE: '1',
      MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_DOCX_SERVICE_URL: '',
      MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs'),
    },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app')
  const installed = await app.evaluate(({ safeStorage, BrowserWindow }) => {
    const runtime = globalThis as typeof globalThis & { __forbiddenKeychainCalls?: string[] }
    runtime.__forbiddenKeychainCalls = []
    const methods = ['isEncryptionAvailable', 'encryptString', 'decryptString', 'isAsyncEncryptionAvailable', 'encryptStringAsync', 'decryptStringAsync']
    for (const name of methods) {
      const forbidden = () => {
        runtime.__forbiddenKeychainCalls!.push(name)
        throw new Error('E2E forbids native Keychain API calls')
      }
      Object.defineProperty(safeStorage, name, { configurable: true, value: forbidden })
      if ((safeStorage as unknown as Record<string, unknown>)[name] !== forbidden) throw new Error('Keychain sentinel installation failed')
    }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true)
    return BrowserWindow.getAllWindows().every(window => !window.isVisible())
  })
  expect(installed).toBe(true)
  return { app, page }
}

async function settings(page: Page) {
  await page.locator('.nav-settings-btn').click()
  await page.getByRole('tab', { name: '朗读', exact: true }).click()
  await expect(page.getByText(/不使用系统钥匙串/)).toBeVisible()
}

async function configure(page: Page): Promise<string> {
  await settings(page)
  await page.getByRole('button', { name: '+ 添加 OpenAI 服务', exact: true }).click()
  const card = page.locator('.tts-provider-card').first()
  const input = card.locator('input[placeholder="https://api.openai.com/v1"]')
  await input.fill(endpoint)
  await input.blur()
  const id = await page.evaluate(async () => (await window.api.getReadAloudSettings()).providers.find(provider => provider.type === 'openai')!.id)
  await expect.poll(() => page.evaluate(async id => (await window.api.getReadAloudSettings()).providers.find(provider => provider.id === id)?.baseUrl, id)).toBe(endpoint)
  const password = card.locator('input[type="password"]')
  await password.fill(publicKey)
  await password.blur()
  await expect.poll(() => hasKey(page, id)).toBe(true)
  await expect(password).toHaveValue('')
  return id
}

async function hasKey(page: Page, id: string) {
  return page.evaluate(async id => (await window.api.getReadAloudSettings()).providers.find(provider => provider.id === id)?.hasApiKey, id)
}

async function verifyMainRead(app: ElectronApplication, page: Page, id: string, expectedKey: string) {
  await app.evaluate((_electron, expected) => {
    const runtime = globalThis as typeof globalThis & { __localKeyAuth?: boolean[] }
    runtime.__localKeyAuth = []
    globalThis.fetch = async (_input, init) => {
      runtime.__localKeyAuth!.push(new Headers(init?.headers).get('authorization') === `Bearer ${expected}`)
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
  }, expectedKey)
  const result = await page.evaluate(id => window.api.ttsTestProvider({ providerId: id, type: 'openai' }), id)
  const authorizations = await app.evaluate(() => (globalThis as typeof globalThis & { __localKeyAuth?: boolean[] }).__localKeyAuth)
  expect({ result, authorizations }).toEqual({ result: { ok: true }, authorizations: [true] })
  // Only the public fixture is used; fetch is replaced in the main process and no audio is played.
}

async function noKeychain(app: ElectronApplication) {
  expect(await app.evaluate(() => (globalThis as typeof globalThis & { __forbiddenKeychainCalls?: string[] }).__forbiddenKeychainCalls)).toEqual([])
}

test('本地加密Key真实保存与重启读取，不访问旧存储或钥匙串', async ({}, info) => {
  test.setTimeout(60_000)
  const fixture = workspace()
  let running: ElectronApplication | undefined
  try {
    let current = await launch(fixture.profile, fixture.markdown)
    running = current.app
    const id = await configure(current.page)
    const folder = join(fixture.profile, 'tts-local')
    const master = readFileSync(join(folder, 'master.key'))
    const data = readFileSync(join(folder, 'keys.json'))
    expect(master.length).toBe(32)
    expect(data.toString()).not.toContain(publicKey)
    expect(readFileSync(join(fixture.profile, 'tts-keys.json'))).toEqual(legacyBytes)
    if (process.platform !== 'win32') {
      expect(statSync(folder).mode & 0o777).toBe(0o700)
      for (const name of ['master.key', 'keys.json']) expect(statSync(join(folder, name)).mode & 0o777).toBe(0o600)
    }
    await noKeychain(running)
    await running.close()
    running = undefined
    current = await launch(fixture.profile, fixture.markdown)
    running = current.app
    expect(await hasKey(current.page, id)).toBe(true)
    expect(hash(readFileSync(join(folder, 'master.key')))).toBe(hash(master))
    expect(readFileSync(join(folder, 'keys.json'))).toEqual(data)
    await verifyMainRead(running, current.page, id, publicKey)
    await noKeychain(running)
    await settings(current.page)
    await current.page.locator('.tts-provider-card input[type="password"]').scrollIntoViewIfNeeded()
    await current.page.screenshot({ path: info.outputPath('local-key-after-restart.png'), animations: 'disabled' })
    await info.attach('local-key-proof', { body: JSON.stringify({ persistedAcrossRestart: true, masterBytes: master.length, cipherBytes: data.length, legacyUnchanged: true, nativeKeychainCalls: 0, networkMocked: true, playedAudio: false }), contentType: 'application/json' })
  } finally {
    await running?.close()
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('主密钥错配时真实UI报错并保留输入，恢复备份后可保存', async ({}, info) => {
  test.setTimeout(60_000)
  const fixture = workspace()
  let running: ElectronApplication | undefined
  try {
    const { app, page } = await launch(fixture.profile, fixture.markdown)
    running = app
    const id = await configure(page)
    const folder = join(fixture.profile, 'tts-local')
    const masterFile = join(folder, 'master.key')
    const original = readFileSync(masterFile)
    const ciphertext = readFileSync(join(folder, 'keys.json'))
    const bad = Buffer.from(original)
    bad[0] ^= 1
    writeFileSync(masterFile, bad)
    expect(await hasKey(page, id)).toBe(false)
    const input = page.locator('.tts-provider-card input[type="password"]')
    await input.fill(`${publicKey}-retry`)
    await input.blur()
    await expect(page.getByText(/本地主密钥损坏、错配或不可读取/)).toBeVisible()
    await expect(input).toHaveValue(`${publicKey}-retry`)
    expect(readFileSync(join(folder, 'keys.json'))).toEqual(ciphertext)
    expect(readFileSync(masterFile)).toEqual(bad)
    await page.getByText(/本地主密钥损坏、错配或不可读取/).scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('local-key-failure-input-retained.png'), animations: 'disabled' })
    writeFileSync(masterFile, original)
    await input.focus()
    await input.blur()
    await expect(input).toHaveValue('')
    expect(await hasKey(page, id)).toBe(true)
    await verifyMainRead(app, page, id, `${publicKey}-retry`)
    await noKeychain(app)
    expect(readFileSync(join(fixture.profile, 'tts-keys.json'))).toEqual(legacyBytes)
    expect(existsSync(join(folder, 'master.key'))).toBe(true)
  } finally {
    await running?.close()
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
