import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect, openFolderViaIPC } from './fixtures/electron'
import { _electron, type ElectronApplication } from '@playwright/test'

const test = base.extend<{ recentCount: number }>({
  recentCount: [100, { option: true }],
  electronApp: async ({ recentCount }, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const workspace = testInfo.outputPath('workspace')
    mkdirSync(profile, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    const recentFiles = Array.from({ length: 500 }, (_, i) => {
      const name = `recent-${String(i).padStart(4, '0')}.md`
      const filePath = join(workspace, name)
      writeFileSync(filePath, i === 0 ? '# 技术验证\n\n技术验证唯一标记。\n' : `# Fixture ${i}\n\n自建对照文档。\n`)
      return { id: `fixture-recent-${i}`, name, path: filePath, folderPath: workspace, lastOpened: Date.now() - i * 1000 }
    }).slice(0, recentCount)
    writeFileSync(join(profile, 'app-data.json'), JSON.stringify({
      recentFiles, settings: { maxRecentFiles: 500, autoRenderRemoteCharts: false },
    }))
    const executable = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
    const env = {
      ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1',
      MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: testInfo.outputPath('logs'),
    }
    delete env.ELECTRON_RUN_AS_NODE
    const app = await _electron.launch({
      ...(executable ? { executablePath: executable } : {}),
      args: [`--user-data-dir=${profile}`, ...(executable ? [] : [join(process.cwd(), 'out/main/index.js')])],
      env,
    })
    let stderr = ''
    app.process().stderr?.on('data', data => { stderr += data.toString() })
    try {
      const page = await app.firstWindow()
      await page.waitForSelector('.app')
      await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(workspace, 'recent-0000.md'))
      await expect(page.locator('.tab.active')).toContainText('recent-0000.md')
      await expect.poll(() => page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
        return (await window.api.getWorkspaceIndexStatus({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch })).state
      })).toBe('ready')
      await use(app)
    } finally {
      await app.close()
      writeFileSync(testInfo.outputPath('stderr.log'), stderr)
    }
  },
})

async function observeSearch(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const probe = { traces: [] as any[], failure: '' }
    ;(globalThis as any).__recentSearchProbe = probe
    for (const channel of ['workspace-index:query', 'workspace-index:queryHistory', 'workspace-index:getStatus']) {
      const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>
      const original = handlers.get(channel)!
      handlers.set(channel, async function(event, ...args) {
        const record: any = { channel, recentCount: args[3]?.length }
        probe.traces.push(record)
        try {
          // 只在本例独立profile内显式注入部分来源失败；健康对照调用真实handler。
          if (probe.failure === channel) throw new Error('fixture injected source failure')
          const result = await original.call(this, event, ...args)
          record.ok = true
          record.count = Array.isArray(result) ? result.length : undefined
          record.state = result?.state
          return result
        } catch (error) {
          record.ok = false
          record.error = String(error)
          throw error
        } finally { record.finished = true }
      })
    }
  })
}

base('最近文件限定检索在截断前筛选，并用recentFileId跨根打开', async ({ page, electronApp, testDir }, testInfo) => {
  const olderRoot = join(testDir, 'older-root')
  const targetDir = join(olderRoot, 'docs')
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(olderRoot, '000-root.md'), '# Old Root')
  writeFileSync(join(targetDir, 'recent-target.md'), '# Recent Target\n\n最近文件过滤唯一标记。')
  for (let i = 0; i < 61; i++) {
    writeFileSync(join(olderRoot, `unlisted-${i}.md`), '最近文件过滤唯一标记。\n'.repeat(3))
  }
  await openFolderViaIPC(electronApp, olderRoot)
  const docs = page.locator('.file-tree-row.directory', { hasText: 'docs' })
  if (await docs.getAttribute('aria-expanded') === 'false') await docs.click()
  await page.locator('.file-tree-row.file', { hasText: 'recent-target.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Recent Target')
  await docs.click()
  for (let i = 0; i < 6; i++) {
    const folder = join(testDir, `newer-root-${i}`)
    mkdirSync(folder)
    writeFileSync(join(folder, `current-${i}.md`), '# Current Root')
    await openFolderViaIPC(electronApp, folder)
    await expect(page.locator('.nav-folder-path')).toHaveAttribute('title', folder)
  }
  const scope = await page.evaluate(async () => {
    const history = await window.api.getFolderHistory()
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const current = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return history.filter(item => item.path !== current.primaryRoot).slice(0, 5).map(item => item.path)
  })
  expect(scope).not.toContain(olderRoot)
  await observeSearch(electronApp)
  await page.locator('.search-trigger').click()
  await page.getByRole('button', { name: '全文', exact: true }).click()
  await page.locator('.search-input').fill('最近文件过滤唯一标记')
  await expect(page.locator('.search-result-item')).toHaveCount(1)
  await expect(page.locator('.search-result-item')).toContainText('recent-target.md')
  const historyResults = await page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const current = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    const recent = await window.api.getRecentFiles()
    return window.api.queryWorkspaceHistoryIndexes(
      { workspaceId: current.id, lifecycleEpoch: current.lifecycleEpoch },
      '最近文件过滤唯一标记', [], recent.map(item => item.id), 60,
    )
  })
  expect(historyResults).toHaveLength(1)
  expect(historyResults[0].recentFileId).toEqual(expect.any(String))
  expect(historyResults[0]).not.toHaveProperty('historyId')
  await page.screenshot({ path: testInfo.outputPath('recent-only-result.png') })
  await page.locator('.search-match-line', { hasText: '最近文件过滤唯一标记' }).click()
  await expect(page.locator('.nav-folder-path')).toHaveAttribute('title', olderRoot)
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.file-tree-row.file', { hasText: 'recent-target.md' })).toHaveClass(/selected/)
  await expect(page.locator('.markdown-body h1')).toHaveText('Recent Target')
  await page.screenshot({ path: testInfo.outputPath('recent-only-opened.png') })
})

for (const recentCount of [100, 101, 500]) {
  test.describe(`${recentCount}条最近记录全文搜索`, () => {
    test.use({ recentCount })
    test('全部来源、仅当前、IPC边界及部分来源失败隔离', async ({ page, electronApp }, testInfo) => {
      expect(await page.evaluate(async () => (await window.api.getRecentFiles()).length)).toBe(recentCount)
      await observeSearch(electronApp)
      const result = page.locator('.search-result-item', { hasText: 'recent-0000.md' })
      await page.locator('.search-trigger').click()
      await page.getByRole('button', { name: '全文', exact: true }).click()
      await page.locator('.search-input').fill('技术验证')
      await expect(result).toBeVisible()
      await expect(page.locator('.search-degraded')).toHaveCount(0)
      await expect(page.locator('.search-result-item')).toHaveCount(1)
      await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__recentSearchProbe.traces.some(
        (item: any) => item.channel === 'workspace-index:queryHistory' && item.recentCount === 500 && item.ok,
      ))).toBe(recentCount === 500)
      await page.screenshot({ path: testInfo.outputPath('all-sources.png') })
      await page.getByRole('button', { name: '搜索全部数据源', exact: true }).click()
      await expect(result).toBeVisible()
      await expect(page.locator('.search-degraded')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('current-folder.png') })
      await page.getByRole('button', { name: '仅搜索当前文件夹', exact: true }).click()
      await expect(result).toBeVisible()

      if (recentCount === 500) {
        for (const [channel, warning] of [
          ['workspace-index:queryHistory', '历史来源查询失败'],
          ['workspace-index:query', '当前工作区查询失败'],
          ['workspace-index:getStatus', '索引状态读取失败'],
        ]) {
          await electronApp.evaluate((_electron, failure) => { (globalThis as any).__recentSearchProbe.failure = failure }, channel)
          const query = `技术验证${' '.repeat(channel.length)}`
          await page.locator('.search-input').fill(query)
          await expect(page.locator('.search-degraded')).toContainText(warning)
          await expect(result).toBeVisible()
          await expect(page.getByRole('button', { name: '重建索引', exact: true })).toHaveCount(0)
          await page.screenshot({ path: testInfo.outputPath(`${channel.split(':')[1]}-injected-failure.png`) })
        }
        await electronApp.evaluate(() => { (globalThis as any).__recentSearchProbe.failure = '' })
        await page.locator('.search-input').fill('技术验证')
        await expect(page.locator('.search-degraded')).toHaveCount(0)
        await expect(result).toBeVisible()
        for (let repeat = 0; repeat < 2; repeat++) {
          await page.keyboard.press('Escape')
          await expect(page.locator('.search-modal')).toHaveCount(0)
          await page.locator('.search-trigger').click()
          await page.locator('.search-input').fill('技术验证')
          await expect(result).toBeVisible()
          await expect(page.locator('.search-degraded')).toHaveCount(0)
        }
        await page.screenshot({ path: testInfo.outputPath('repeat-success.png') })
      }
      const boundary = await page.evaluate(async () => {
        const bootstrap = await window.api.getWorkspaceBootstrap()
        const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
        const operation = { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
        const recent = await window.api.getRecentFiles()
        const ids = recent.map(item => item.id)
        const settled = await Promise.allSettled([
          window.api.queryWorkspaceHistoryIndexes(operation, '技术验证', [], ids, 60),
          window.api.queryWorkspaceHistoryIndexes(operation, '技术验证', [], Array.from({ length: 501 }, () => ids[0]), 60),
          window.api.queryWorkspaceHistoryIndexes({ ...operation, lifecycleEpoch: operation.lifecycleEpoch + 1 }, '技术验证', [], ids, 60),
        ])
        return settled.map(item => item.status === 'fulfilled'
          ? { status: item.status, count: item.value.length }
          : { status: item.status, error: String(item.reason) })
      })
      expect(boundary[0]).toEqual({ status: 'fulfilled', count: 1 })
      expect(boundary[1]).toMatchObject({ status: 'rejected', error: expect.stringContaining('历史记录标识无效') })
      expect(boundary[2]).toMatchObject({ status: 'rejected', error: expect.stringContaining('工作区已失效') })
      const traces = await electronApp.evaluate(() => (globalThis as any).__recentSearchProbe.traces)
      writeFileSync(testInfo.outputPath('observations.json'), JSON.stringify({ recentCount, boundary, traces }, null, 2))
    })
  })
}
