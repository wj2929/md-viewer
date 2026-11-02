import { createHash, createHmac } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { test as base, expect, openFolderViaIPC } from './fixtures/electron'

interface ReclamationFixture { root: string; profile: string; storage: string }
const closed = new WeakSet<ElectronApplication>()
const close = async (app: ElectronApplication) => {
  if (closed.has(app)) return
  await app.close(); closed.add(app)
}
const launch = (profile: string, executable = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH) => electron.launch({
  ...(executable ? { executablePath: executable } : {}),
  args: [`--user-data-dir=${profile}`, ...(executable ? [] : [join(process.cwd(), 'out/main/index.js')])],
  env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DOCX_AUTOSTART: '0',
    MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') },
})
const test = base.extend<{ reclamation: ReclamationFixture }>({
  reclamation: async ({ testDir }, use, info) => {
    const root = realpathSync(testDir), profile = info.outputPath('isolated-profile')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(root, 'reclamation-target.md'), '# Reclamation Target\n\nreclamationneedle0')
    writeFileSync(join(root, 'reclamation-source.md'), '# Reclamation Source\n\nSee [target](./reclamation-target.md).')
    await use({ root, profile, storage: join(profile, 'workspace-index') })
  },
  electronApp: async ({ reclamation }, use) => {
    const app = await launch(reclamation.profile)
    try { await use(app) } finally { await close(app) }
  },
})
async function ready(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)
    if (!workspace) return false
    const context = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
    const status = await window.api.getWorkspaceIndexStatus(context)
    const watch = await window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
    return status.state === 'ready' && status.pendingDocuments === 0 && watch.state === 'healthy'
  }), { timeout: 20_000 }).toBe(true)
}
function cache(fixture: ReclamationFixture) {
  const key = readFileSync(join(fixture.storage, 'installation.key'))
  const rootKey = createHmac('sha256', key).update('md-viewer:index-root:v1\0').update(fixture.root).digest('hex')
  return join(fixture.storage, 'v1', rootKey)
}
const current = (fixture: ReclamationFixture) => readFileSync(join(cache(fixture), 'CURRENT'), 'utf8').trim()
const generations = (fixture: ReclamationFixture) => readdirSync(join(cache(fixture), 'generations')).sort()
function files(folder: string): Record<string, { bytes: number; hash: string }> {
  const result: Record<string, { bytes: number; hash: string }> = {}
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name)
      if (statSync(absolute).isDirectory()) walk(absolute)
      else {
        const data = readFileSync(absolute)
        result[relative(folder, absolute)] = { bytes: data.length, hash: createHash('sha256').update(data).digest('hex') }
      }
    }
  }
  walk(folder)
  return result
}
async function change(page: Page, fixture: ReclamationFixture, sequence: number) {
  const before = current(fixture)
  writeFileSync(join(fixture.root, 'reclamation-target.md'), `# Reclamation Target\n\nreclamationneedle${sequence}`)
  await expect.poll(() => current(fixture), { timeout: 20_000 }).not.toBe(before)
  await ready(page)
}
async function history(page: Page, app: ElectronApplication, fixture: ReclamationFixture) {
  await openFolderViaIPC(app, fixture.root)
  await ready(page)
  for (let sequence = 1; sequence <= 3; sequence++) await change(page, fixture, sequence)
  expect(generations(fixture).length).toBeGreaterThanOrEqual(4)
}
async function controls(page: Page) {
  await page.locator('.search-trigger').click()
  await page.getByRole('button', { name: '全文', exact: true }).click()
  const all = page.getByRole('button', { name: '搜索全部数据源', exact: true })
  if (await all.isVisible()) await all.click()
  await expect(page.getByPlaceholder('搜索当前文件夹...')).toHaveValue('')
  await expect(page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true })).toBeVisible()
}
async function dialog(app: ElectronApplication, response: number | 'hold') {
  await app.evaluate(({ dialog }, answer) => {
    const probe = globalThis as typeof globalThis & {
      reclamationDialog?: { detail?: string; defaultId?: number; cancelId?: number }
      finishReclamationDialog?: (value: { response: number; checkboxChecked: boolean }) => void
    }
    probe.reclamationDialog = undefined
    dialog.showMessageBox = ((...args: unknown[]) => {
      probe.reclamationDialog = args.at(-1) as typeof probe.reclamationDialog
      if (answer === 'hold') return new Promise(resolve => { probe.finishReclamationDialog = resolve })
      return Promise.resolve({ response: answer, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  }, response)
}
async function dialogOptions(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as typeof globalThis & {
    reclamationDialog?: { detail?: string; defaultId?: number; cancelId?: number }
  }).reclamationDialog)
}
async function query(page: Page, needle: string) {
  return page.evaluate(async text => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)!
    return window.api.queryWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, text)
  }, needle)
}

test('实际按钮无查询词可预览并取消，缓存和源文件逐字节不变', async ({ page, electronApp, reclamation }, info) => {
  test.setTimeout(60_000)
  await history(page, electronApp, reclamation)
  const before = files(reclamation.storage), sourceBefore = files(reclamation.root)
  await controls(page)
  await dialog(electronApp, 0)
  await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
  await expect(page.getByText('已取消，未清理旧索引。', { exact: true })).toBeVisible()
  expect(await dialogOptions(electronApp)).toMatchObject({ defaultId: 0, cancelId: 0 })
  expect((await dialogOptions(electronApp))?.detail).toContain('源文件不可访问时，其搜索和反链可能暂时不完整')
  expect(files(reclamation.storage)).toEqual(before)
  expect(files(reclamation.root)).toEqual(sourceBefore)
  await page.screenshot({ path: info.outputPath('reclamation-cancelled.png'), animations: 'disabled' })
})

test('实际确认只留两代，逻辑统计准确且重启搜索和反链可用', async ({ page, electronApp, reclamation }, info) => {
  test.setTimeout(90_000)
  await history(page, electronApp, reclamation)
  const before = files(reclamation.storage), sourceBefore = files(reclamation.root), pointer = current(reclamation)
  await controls(page)
  await dialog(electronApp, 1)
  await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
  const completed = page.getByText(/^清理完成：删除/)
  await expect(completed).toBeVisible()
  const after = files(reclamation.storage)
  const removed = Object.keys(before).filter(file => !after[file])
  const removedBytes = removed.reduce((sum, file) => sum + before[file].bytes, 0)
  expect(await completed.textContent()).toContain(`删除 ${removed.length} 个文件`)
  expect(await completed.textContent()).toContain(`逻辑大小 ${removedBytes.toLocaleString()} 字节`)
  expect(generations(reclamation)).toHaveLength(2)
  expect(current(reclamation)).toBe(pointer)
  expect(after['installation.key']).toEqual(before['installation.key'])
  expect(files(reclamation.root)).toEqual(sourceBefore)
  await page.screenshot({ path: info.outputPath('reclamation-completed.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
  await expect(page.getByText('当前工作区没有可安全回收的旧索引。', { exact: true })).toBeVisible()
  await close(electronApp)
  const restarted = await launch(reclamation.profile)
  try {
    const next = await restarted.firstWindow()
    await next.waitForSelector('.app')
    await openFolderViaIPC(restarted, reclamation.root)
    await ready(next)
    expect(current(reclamation)).toBe(pointer)
    expect(await query(next, 'reclamationneedle3')).toEqual([expect.objectContaining({ relativePath: 'reclamation-target.md' })])
    await next.locator('.file-tree-row.file', { hasText: 'reclamation-target.md' }).click()
    await next.getByRole('button', { name: /^链接到这里/ }).click()
    await expect(next.getByRole('complementary', { name: '链接到这里' }).getByText('reclamation-source.md')).toBeVisible()
    await next.screenshot({ path: info.outputPath('reclamation-restart-backlinks.png'), animations: 'disabled' })
  } finally { await close(restarted) }
})

test('确认等待时正文产生新代，旧预览失效而不会扩大删除集合', async ({ page, electronApp, reclamation }, info) => {
  test.setTimeout(60_000)
  await history(page, electronApp, reclamation)
  await controls(page)
  await dialog(electronApp, 'hold')
  await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
  await expect.poll(() => dialogOptions(electronApp)).toBeTruthy()
  await change(page, reclamation, 4)
  const afterCommit = files(reclamation.storage)
  await electronApp.evaluate(() => {
    (globalThis as typeof globalThis & { finishReclamationDialog?: (value: { response: number; checkboxChecked: boolean }) => void })
      .finishReclamationDialog?.({ response: 1, checkboxChecked: false })
  })
  await expect(page.getByText('索引或工作区已变化，请重新预览后再清理。', { exact: true })).toBeVisible()
  expect(files(reclamation.storage)).toEqual(afterCommit)
  expect(await query(page, 'reclamationneedle4')).toEqual([expect.objectContaining({ relativePath: 'reclamation-target.md' })])
  await page.screenshot({ path: info.outputPath('reclamation-stale.png'), animations: 'disabled' })
})

test('实际旧应用可读取回收后保留代并查询与显示反链', async ({ page, electronApp, reclamation }, info) => {
  test.setTimeout(90_000)
  const executable = process.env.MD_VIEWER_E2E_OLD_EXECUTABLE_PATH
  test.skip(!executable, '需要明确指定仅用于独立 profile 的旧应用候选')
  await history(page, electronApp, reclamation)
  await controls(page)
  await dialog(electronApp, 1)
  await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
  await expect(page.getByText(/^清理完成：删除/)).toBeVisible()
  await close(electronApp)
  const old = await launch(reclamation.profile, executable)
  try {
    const oldPage = await old.firstWindow()
    await oldPage.waitForSelector('.app')
    await openFolderViaIPC(old, reclamation.root)
    await ready(oldPage)
    expect(await query(oldPage, 'reclamationneedle3')).toEqual([expect.objectContaining({ relativePath: 'reclamation-target.md' })])
    await oldPage.locator('.file-tree-row.file', { hasText: 'reclamation-target.md' }).click()
    await oldPage.getByRole('button', { name: /^链接到这里/ }).click()
    await expect(oldPage.getByRole('complementary', { name: '链接到这里' }).getByText('reclamation-source.md')).toBeVisible()
    await oldPage.screenshot({ path: info.outputPath('reclamation-old-app-backlinks.png'), animations: 'disabled' })
  } finally { await close(old) }
})


test('真实删除失败显示部分完成，窄窗口按钮完整且当前搜索仍可用', async ({ page, electronApp, reclamation }, info) => {
  test.setTimeout(60_000)
  await history(page, electronApp, reclamation)
  const manifests = generations(reclamation).map(id => JSON.parse(readFileSync(join(cache(reclamation), 'generations', id, 'manifest.json'), 'utf8')))
    .sort((a, b) => a.createdAt - b.createdAt || a.generationId.localeCompare(b.generationId))
  const failedId: string = manifests[0].generationId
  const pointer = current(reclamation)
  await electronApp.evaluate((_, id) => {
    const filesystem = process.getBuiltinModule('fs') as typeof import('fs')
    const original = filesystem.unlinkSync
    filesystem.unlinkSync = file => {
      if (String(file).endsWith(`/${id}/manifest.json`)) throw Object.assign(new Error('synthetic failure'), { code: 'EACCES' })
      original(file)
    }
  }, failedId)
  await page.setViewportSize({ width: 800, height: 700 })
  await controls(page)
  await dialog(electronApp, 1)
  const button = page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true })
  await button.click()
  await expect(page.getByText(/^清理部分完成：删除/)).toBeVisible()
  expect(await page.getByText(/^清理部分完成：删除/).textContent()).toContain('失败 1 项')
  expect(await button.evaluate(element => ({ clipped: element.scrollWidth > element.clientWidth + 1,
    inViewport: element.getBoundingClientRect().right <= window.innerWidth, overflow: getComputedStyle(element).textOverflow })))
    .toMatchObject({ clipped: false, inViewport: true })
  expect(current(reclamation)).toBe(pointer)
  expect(await query(page, 'reclamationneedle3')).toEqual([expect.objectContaining({ relativePath: 'reclamation-target.md' })])
  expect(readFileSync(join(cache(reclamation), 'generations', failedId, 'manifest.json'), 'utf8')).toContain(failedId)
  await page.screenshot({ path: info.outputPath('reclamation-partial-narrow.png'), animations: 'disabled' })
})

for (const unavailable of [false, true]) {
  test(`旧应用实际暂停读代后并发回收：${unavailable ? '缺失源文件不会伪造完整结果' : '只读回退扫描恢复搜索和反链'}`, async ({ page, electronApp, reclamation }, info) => {
    test.setTimeout(100_000)
    const executable = process.env.MD_VIEWER_E2E_OLD_EXECUTABLE_PATH
    test.skip(!executable, '需要明确指定独立 profile 使用的旧应用')
    await history(page, electronApp, reclamation)
    const pausedGeneration = current(reclamation)
    const oldProfile = info.outputPath('old-reader-profile')
    mkdirSync(oldProfile, { recursive: true })
    // Only the OLD reader's disposable profile uses a link. The new writer/GC root
    // is the real synthetic storage directory, never a user profile or symlink.
    symlinkSync(reclamation.storage, join(oldProfile, 'workspace-index'))
    const old = await launch(oldProfile, executable)
    let moved = false
    const hiddenRoot = `${reclamation.root}-unavailable`
    try {
      const oldPage = await old.firstWindow()
      await oldPage.waitForSelector('.app')
      await old.evaluate(() => {
        const filesystem = process.getBuiltinModule('fs/promises') as typeof import('fs/promises')
        const original = filesystem.readFile
        const probe = globalThis as typeof globalThis & { pausedIndexGeneration?: string; resumeIndexRead?: () => void }
        filesystem.readFile = (async (...args: Parameters<typeof original>) => {
          const value = await original(...args)
          if (!probe.pausedIndexGeneration && String(args[0]).endsWith('/CURRENT')) {
            probe.pausedIndexGeneration = String(value).trim()
            await new Promise<void>(resolve => { probe.resumeIndexRead = resolve })
          }
          return value
        }) as typeof original
      })
      const opening = oldPage.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(reclamation.root, 'reclamation-target.md'))
        .then(() => null, error => String(error))
      await expect.poll(() => old.evaluate(() => (globalThis as typeof globalThis & { pausedIndexGeneration?: string }).pausedIndexGeneration))
        .toBe(pausedGeneration)
      await change(page, reclamation, 4)
      await change(page, reclamation, 5)
      await controls(page)
      await dialog(electronApp, 1)
      await page.getByRole('button', { name: '清理当前工作区旧索引…', exact: true }).click()
      await expect(page.getByText(/^清理完成：删除/)).toBeVisible()
      expect(generations(reclamation)).not.toContain(pausedGeneration)
      if (unavailable) { renameSync(reclamation.root, hiddenRoot); moved = true }
      await old.evaluate(() => (globalThis as typeof globalThis & { resumeIndexRead?: () => void }).resumeIndexRead?.())
      await opening
      if (unavailable) {
        const outcome = await oldPage.evaluate(async () => {
          const bootstrap = await window.api.getWorkspaceBootstrap()
          const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)!
          const context = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
          const inspect = async (operation: () => Promise<unknown>) => {
            try { return { rejected: false, value: await operation() } }
            catch (error) { return { rejected: true, missingSource: /ENOENT/.test(String(error)) } }
          }
          return {
            status: await inspect(() => window.api.getWorkspaceIndexStatus(context)),
            search: await inspect(() => window.api.queryWorkspaceIndex(context, 'reclamationneedle5')),
            backlinks: await inspect(() => window.api.getWorkspaceBacklinks(context, 'reclamation-target.md')),
          }
        })
        expect(outcome).toEqual({ status: { rejected: true, missingSource: true },
          search: { rejected: true, missingSource: true }, backlinks: { rejected: true, missingSource: true } })
        await info.attach('old-reader-missing-source', { body: JSON.stringify({ outcome,
          sourceAccessible: false, cacheGenerationRemoved: pausedGeneration,
          interpretation: 'Source root unavailable: old status/search/backlink IPC reject; no complete results are fabricated.' }), contentType: 'application/json' })
      } else {
        await expect.poll(() => oldPage.evaluate(async () => {
          const bootstrap = await window.api.getWorkspaceBootstrap()
          const workspace = bootstrap.workspaces.find(w => w.id === bootstrap.activeWorkspaceId)
          if (!workspace) return null
          const status = await window.api.getWorkspaceIndexStatus({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch })
          return status.pendingDocuments === 0 ? status.state : null
        }), { timeout: 20_000 }).toBe('read-only')
        expect(await query(oldPage, 'reclamationneedle5')).toEqual([expect.objectContaining({ relativePath: 'reclamation-target.md' })])
        await oldPage.locator('.file-tree-row.file', { hasText: 'reclamation-target.md' }).click()
        await oldPage.getByRole('button', { name: /^链接到这里/ }).click()
        await expect(oldPage.getByRole('complementary', { name: '链接到这里' }).getByText('reclamation-source.md')).toBeVisible()
      }
      // With the source root gone, the legacy window may close after its failed
      // open. The negative contract is rejected IPCs, not an available document UI.
      if (!unavailable) await oldPage.screenshot({ path: info.outputPath('old-reader-rescanned-backlinks.png'), animations: 'disabled' })
    } finally {
      if (moved) renameSync(hiddenRoot, reclamation.root)
      await close(old)
    }
  })
}
