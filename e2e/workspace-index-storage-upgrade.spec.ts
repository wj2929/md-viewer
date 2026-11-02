import { createHash, createHmac, randomBytes, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { test as base, expect, openFolderViaIPC } from './fixtures/electron'
import { analyzeMarkdownSource } from '../src/shared/markdown/analyze'
import { buildFullSha256Revision } from '../src/main/revisionToken'

interface IndexSeed { profile: string; root: string; cache: string; generation: string }
const launch = (profile: string, executable = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH) => electron.launch({
  ...(executable ? { executablePath: executable } : {}),
  args: [`--user-data-dir=${profile}`, ...(executable ? [] : [join(process.cwd(), 'out/main/index.js')])],
  env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DOCX_AUTOSTART: '0' },
})
const closedApps = new WeakSet<ElectronApplication>()
const close = async (app: ElectronApplication) => {
  if (closedApps.has(app)) return
  await app.close()
  closedApps.add(app)
}
const manifest = (seed: IndexSeed): { schemaVersion: number; generationId: string } => {
  const current = readFileSync(join(seed.cache, 'CURRENT'), 'utf8').trim()
  return JSON.parse(readFileSync(join(seed.cache, 'generations', current, 'manifest.json'), 'utf8'))
}
const ready = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)
    if (!workspace) return false
    const context = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
    const status = await window.api.getWorkspaceIndexStatus(context)
    const watch = await window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
    return status.state === 'ready' && status.pendingDocuments === 0 && watch.state === 'healthy'
  }), { timeout: 15000 }).toBe(true)
}
const query = async (page: Page, text: string) => page.evaluate(async text => {
  const bootstrap = await window.api.getWorkspaceBootstrap()
  const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)!
  return window.api.queryWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, text)
}, text)

const test = base.extend<{ indexSeed: IndexSeed }>({
  indexSeed: async ({ testDir }, use, testInfo) => {
    const root = realpathSync(testDir), profile = testInfo.outputPath('isolated-profile')
    const storage = join(profile, 'workspace-index'), key = randomBytes(32)
    mkdirSync(storage, { recursive: true })
    writeFileSync(join(storage, 'installation.key'), key)
    writeFileSync(join(root, 'packed-target.md'), '# Packed Target\n\nlegacyindexneedle')
    writeFileSync(join(root, 'packed-source.md'), '# Source\n\n参见 [Target](./packed-target.md)。')
    const rootKey = createHmac('sha256', key).update('md-viewer:index-root:v1\0').update(root).digest('hex')
    const generation = randomUUID(), instance = randomUUID(), cache = join(storage, 'v1', rootKey)
    mkdirSync(join(cache, 'shards'), { recursive: true })
    mkdirSync(join(cache, 'generations', generation), { recursive: true })
    const documents: Array<{ relativePath: string; revisionToken: string; shardFile: string }> = []
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = join(folder, entry.name)
        if (entry.isDirectory()) { walk(file); continue }
        if (!entry.name.endsWith('.md')) continue
        const text = readFileSync(file, 'utf8'), stats = statSync(file), rel = relative(root, file).replaceAll('\\', '/')
        const revisionToken = buildFullSha256Revision(text), analysis = analyzeMarkdownSource(text)
        const docKey = createHmac('sha256', key).update('md-viewer:index-document:v1\0').update(rootKey).update('\0').update(rel).digest('hex')
        const shardFile = `${docKey}-${instance}-${revisionToken.slice(-64)}.json`
        writeFileSync(join(cache, 'shards', shardFile), JSON.stringify({
          schemaVersion: 2, rootKey, indexInstanceId: instance, relativePath: rel, revisionToken,
          mtimeMs: stats.mtimeMs, indexedAt: Date.now(), size: stats.size,
          headings: analysis.headings, outboundLinks: analysis.links, terms: analysis.terms, lineCount: analysis.lineCount,
        }))
        documents.push({ relativePath: rel, revisionToken, shardFile })
      }
    }
    walk(root)
    const stats = statSync(root)
    writeFileSync(join(cache, 'generations', generation, 'manifest.json'), JSON.stringify({
      schemaVersion: 2, rootKey, rootFingerprint: `${process.platform}:${stats.dev}:${stats.ino}`,
      indexInstanceId: instance, generationId: generation, createdAt: Date.now(), documents,
    }))
    writeFileSync(join(cache, 'CURRENT'), generation + '\n')
    await use({ profile, root, cache, generation })
  },
  electronApp: async ({ indexSeed }, use) => {
    const app = await launch(indexSeed.profile)
    try { await use(app) } finally { await close(app) }
  },
})

test('旧索引只读保留、正文变更自然升级，重启后查询与反链仍完整', async ({ page, electronApp, indexSeed }, testInfo) => {
  await openFolderViaIPC(electronApp, indexSeed.root)
  await ready(page)
  expect(manifest(indexSeed)).toMatchObject({ schemaVersion: 2, generationId: indexSeed.generation })
  await page.getByRole('button', { name: '刷新文件列表' }).click()
  await ready(page)
  expect(manifest(indexSeed).generationId).toBe(indexSeed.generation)
  expect(await query(page, 'legacyindexneedle')).toEqual([expect.objectContaining({ relativePath: 'packed-target.md' })])
  await page.locator('.file-tree-row.file', { hasText: 'packed-target.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Packed Target')
  writeFileSync(join(indexSeed.root, 'packed-target.md'), '# Packed Changed\n\npackedindexneedle')
  await expect(page.locator('.markdown-body h1')).toHaveText('Packed Changed')
  await expect.poll(() => manifest(indexSeed).schemaVersion).toBe(3)
  await ready(page)
  const changed = manifest(indexSeed).generationId
  await page.getByRole('button', { name: /^链接到这里/ }).click()
  await expect(page.getByRole('complementary', { name: '链接到这里' }).getByText('packed-source.md')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('packed-backlinks.png'), animations: 'disabled' })
  await close(electronApp)
  const restarted = await launch(indexSeed.profile)
  try {
    const nextPage = await restarted.firstWindow()
    await nextPage.waitForSelector('.app')
    await openFolderViaIPC(restarted, indexSeed.root)
    await ready(nextPage)
    expect(manifest(indexSeed).generationId).toBe(changed)
    expect(await query(nextPage, 'packedindexneedle')).toEqual([expect.objectContaining({ relativePath: 'packed-target.md' })])
    await nextPage.locator('.file-tree-row.file', { hasText: 'packed-target.md' }).click()
    await expect(nextPage.locator('.markdown-body h1')).toHaveText('Packed Changed')
    await nextPage.screenshot({ path: testInfo.outputPath('packed-restart.png'), animations: 'disabled' })
  } finally { await close(restarted) }
})

test('旧安装版拒绝新格式并安全重建，升级后读取旧格式不强制改代', async ({ page, electronApp, indexSeed }, testInfo) => {
  const oldExecutable = process.env.MD_VIEWER_E2E_OLD_EXECUTABLE_PATH
  test.skip(!oldExecutable, '需要可运行的旧格式应用作为真实回退对照')
  await openFolderViaIPC(electronApp, indexSeed.root)
  await ready(page)
  writeFileSync(join(indexSeed.root, 'packed-target.md'), '# Downgrade\n\nrollbackneedle')
  await expect.poll(() => manifest(indexSeed).schemaVersion).toBe(3)
  await ready(page)
  await close(electronApp)
  const oldApp = await launch(indexSeed.profile, oldExecutable)
  let oldGeneration: string
  try {
    const oldPage = await oldApp.firstWindow()
    await oldPage.waitForSelector('.app')
    await openFolderViaIPC(oldApp, indexSeed.root)
    await ready(oldPage)
    expect(manifest(indexSeed).schemaVersion).toBe(2)
    oldGeneration = manifest(indexSeed).generationId
    expect(await query(oldPage, 'rollbackneedle')).toEqual([expect.objectContaining({ relativePath: 'packed-target.md' })])
  } finally { await close(oldApp) }
  const newer = await launch(indexSeed.profile)
  try {
    const nextPage = await newer.firstWindow()
    await nextPage.waitForSelector('.app')
    await openFolderViaIPC(newer, indexSeed.root)
    await ready(nextPage)
    expect(manifest(indexSeed)).toMatchObject({ schemaVersion: 2, generationId: oldGeneration })
    expect(await query(nextPage, 'rollbackneedle')).toEqual([expect.objectContaining({ relativePath: 'packed-target.md' })])
    await nextPage.locator('.file-tree-row.file', { hasText: 'packed-target.md' }).click()
    await expect(nextPage.locator('.markdown-body h1')).toHaveText('Downgrade')
    await nextPage.screenshot({ path: testInfo.outputPath('downgrade-reupgrade.png'), animations: 'disabled' })
    const files = readdirSync(join(indexSeed.cache, 'generations'))
    expect(files.length).toBeGreaterThanOrEqual(3)
    await testInfo.attach('retained-generations', { body: JSON.stringify({ count: files.length, current: manifest(indexSeed), checksum: createHash('sha256').update(files.sort().join('\n')).digest('hex') }), contentType: 'application/json' })
  } finally { await close(newer) }
})
