import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

// 六次独立冷profile启动＋5001节点全量DOM；不是普通小目录交互场景。
test('目录树排序5001文件：默认零属性IO与可选旧版配对，属性分批不阻塞首树', async ({ testDir }, testInfo) => {
  test.setTimeout(180_000)
  const root = join(testDir, 'large-sort-tree')
  mkdirSync(root)
  for (let i = 0; i < 5001; i++) writeFileSync(join(root, `document-${i}.md`), `# Fixture ${i}\n${'x'.repeat(i % 100)}`)
  const baseline = process.env.MD_VIEWER_SORT_BASELINE_EXECUTABLE
  const runs: object[] = []
  for (let round = 0; round < (baseline ? 3 : 1); round++) {
    const variants = baseline ? (round % 2 ? ['source', 'baseline'] : ['baseline', 'source']) : ['source']
    for (const variant of variants) {
      const profile = join(testDir, `profile-${round}-${variant}`)
      const app = await electron.launch({
        ...(variant === 'baseline' ? { executablePath: baseline } : {}),
        args: [`--user-data-dir=${profile}`, ...(variant === 'baseline' ? [] : [join(process.cwd(), 'out/main/index.js')])],
        env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'logs') },
      })
      try {
        const page = await app.firstWindow()
        await page.waitForSelector('.app')
        if (variant === 'source') await app.evaluate(({ ipcMain }) => {
          const ipc = ipcMain as any
          const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
          ;(globalThis as any).sortBatchSizes = []
          ipc.removeHandler('fs:fileTreeMetadata')
          ipc.handle('fs:fileTreeMetadata', (event: unknown, paths: string[], operation: unknown) => {
            ;(globalThis as any).sortBatchSizes.push(paths.length)
            return original(event, paths, operation)
          })
        })
        await page.evaluate(() => {
          ;(window as any).sortLongTasks = []
          new PerformanceObserver(list => (window as any).sortLongTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
        })
        const start = await page.evaluate(() => performance.now())
        await openFolderViaIPC(app, root)
        await expect(page.locator('.file-tree-row.file')).toHaveCount(5001)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const readableMs = await page.evaluate(start => performance.now() - start, start)
        const defaultLongTasks = await page.evaluate(() => (window as any).sortLongTasks)
        if (variant === 'source') expect(await app.evaluate(() => (globalThis as any).sortBatchSizes)).toEqual([])
        let metadata: object | undefined
        if (variant === 'source' && round === (baseline ? 2 : 0)) {
          await page.evaluate(() => { (window as any).sortLongTasks = [] })
          const attributeStart = await page.evaluate(() => performance.now())
          await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'size', direction: 'desc' } }))
          await expect(page.getByRole('button', { name: /目录树排序：大小/ })).toBeVisible()
          await expect.poll(() => app.evaluate(() => ((globalThis as any).sortBatchSizes as number[]).reduce((sum, count) => sum + count, 0)), { timeout: 30000 }).toBe(5001)
          await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
          await expect(page.locator('.file-tree > .file-tree-item > .file-tree-row .file-name').first()).toHaveText('document-1099.md')
          const completedMs = await page.evaluate(start => performance.now() - start, attributeStart)
          const batches = await app.evaluate(() => (globalThis as any).sortBatchSizes as number[])
          expect(Math.max(...batches)).toBeLessThanOrEqual(256)
          metadata = { completedMs, batches, longTasks: await page.evaluate(() => (window as any).sortLongTasks) }
        }
        runs.push({ variant, round, readableMs, defaultLongTasks, ...(metadata ? { metadata } : {}) })
      } finally { await app.close() }
    }
  }
  writeFileSync(testInfo.outputPath('sort-performance.json'), JSON.stringify({ files: 5001, method: '独立profile，打开到5001行节点及两次rAF；包含自动化往返，不是物理绘制时间。旧/新顺序交替。', runs }, null, 2))
})


test('目录树排序5001文档：折叠多层目录汇总分批、无重复读取且可操作', async ({ electronApp, page, testDir }, testInfo) => {
  const root = join(testDir, 'nested-sort-tree')
  mkdirSync(root)
  writeFileSync(join(root, 'README.md'), '# Root')
  for (let group = 0; group < 10; group++) {
    const directory = join(root, `project-${String(group).padStart(2, '0')}`, 'nested')
    mkdirSync(directory, { recursive: true })
    for (let index = 0; index < 500; index++) {
      const file = join(directory, `${index}.md`)
      writeFileSync(file, '#' + 'x'.repeat(group * 10 + index % 5))
      utimesSync(file, 1000 + group, 1000 + group)
    }
  }
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    ;(globalThis as any).nestedSortCalls = []
    ;(globalThis as any).nestedSortMaxInFlight = 0
    let inFlight = 0
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      ;(globalThis as any).nestedSortCalls.push(paths)
      ;(globalThis as any).nestedSortMaxInFlight = Math.max((globalThis as any).nestedSortMaxInFlight, ++inFlight)
      try { return await original(event, paths, operation) } finally { inFlight-- }
    })
  })
  const started = await page.evaluate(() => performance.now())
  await openFolderViaIPC(electronApp, root)
  const topNames = page.locator('.file-tree > .file-tree-item > .file-tree-row .file-name')
  await expect(topNames).toHaveCount(11)
  const readableMs = await page.evaluate(start => performance.now() - start, started)
  expect(await electronApp.evaluate(() => (globalThis as any).nestedSortCalls.length)).toBe(0)
  for (let group = 0; group < 10; group++) {
    const target = join(root, `project-${String(group).padStart(2, '0')}`)
    const row = page.locator(`.file-tree-row[data-file-path=${JSON.stringify(target)}]`)
    if (await row.getAttribute('aria-expanded') === 'true') await row.click()
  }
  await expect(page.locator('.file-tree-row.file')).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as any).nestedLongTasks = []
    new PerformanceObserver(list => (window as any).nestedLongTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
  })
  const attributeStart = await page.evaluate(() => performance.now())
  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'size', direction: 'desc' } }))
  const interactionStart = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: /^目录树排序：/ }).click()
  const dialog = page.getByRole('dialog', { name: '目录树全局排序' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  const interactionMs = await page.evaluate(start => performance.now() - start, interactionStart)
  await expect(topNames.first()).toHaveText('project-09')
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  const completedMs = await page.evaluate(start => performance.now() - start, attributeStart)
  const stats = await electronApp.evaluate(() => ({ calls: (globalThis as any).nestedSortCalls as string[][], maxInFlight: (globalThis as any).nestedSortMaxInFlight as number }))
  expect(stats.calls.flat()).toHaveLength(5001)
  expect(new Set(stats.calls.flat()).size).toBe(5001)
  expect(Math.max(...stats.calls.map(paths => paths.length))).toBeLessThanOrEqual(256)
  expect(stats.maxInFlight).toBe(1)
  const project = page.locator(`.file-tree-row[data-file-path=${JSON.stringify(join(root, 'project-09'))}]`)
  await project.click()
  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'modified', direction: 'asc' } }))
  await expect(topNames.first()).toHaveText('project-00')
  expect(await electronApp.evaluate(() => (globalThis as any).nestedSortCalls.length)).toBe(stats.calls.length)
  writeFileSync(testInfo.outputPath('nested-sort-performance.json'), JSON.stringify({ files: 5001, readableMs, completedMs, interactionMs, batches: stats.calls.map(paths => paths.length), maxInFlight: stats.maxInFlight, longTasks: await page.evaluate(() => (window as any).nestedLongTasks) }, null, 2))
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('nested-folders-sorted.png') })
})
