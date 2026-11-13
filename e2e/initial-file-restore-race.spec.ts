import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './fixtures/electron'

test('初始目录恢复迟到时不覆盖后选文档，阅读记录保存且重开恢复', async ({ page, electronApp, testDir }, info) => {
  const longPath = join(testDir, 'long-read.md')
  writeFileSync(longPath, '# Long Read\n\n' + Array.from({ length: 100 }, (_, index) => `## Section ${index}\n\nReading fixture paragraph ${index}.\n`).join('\n'))
  await electronApp.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers
    const original = handlers.get('pinned-tabs:get-for-folder')
    let first = true
    ;(globalThis as any).__initialRestoreStarted = false
    handlers.set('pinned-tabs:get-for-folder', async (...args: any[]) => {
      const result = await original(...args)
      if (first) {
        first = false
        ;(globalThis as any).__initialRestoreStarted = true
        await new Promise<void>(resolve => { (globalThis as any).__releaseInitialRestore = resolve })
      }
      return result
    })
  })
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(testDir, 'code.md'))
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__initialRestoreStarted)).toBe(true)
  await page.locator('.file-tree-row.file:has-text("long-read.md")').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Long Read')
  const preview = page.locator('.preview')
  await expect.poll(() => preview.evaluate(element => element.clientHeight > 0 && !element.closest('[data-browser-layout-paused]'))).toBe(true)
  const bounds = await preview.boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.wheel(0, 1600)
  await expect.poll(() => page.evaluate(path => window.api.getReadPosition(path), longPath).then(position => position?.scrollRatio ?? 0)).toBeGreaterThan(0.05)
  const saved = await page.evaluate(path => window.api.getReadPosition(path), longPath)
  await electronApp.evaluate(() => (globalThis as any).__releaseInitialRestore())
  await page.locator('.file-tree-row.file:has-text("test1.md")').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  await page.locator('.file-tree-row.file:has-text("long-read.md")').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Long Read')
  await expect.poll(() => preview.evaluate(element => element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight))).toBeCloseTo(saved!.scrollRatio!, 2)
  await expect(page.locator('.tab .tab-name', { hasText: 'code.md' })).toHaveCount(0)
  await info.attach('saved-position', { body: JSON.stringify(saved), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('late-initial-restore.png'), animations: 'disabled' })
})
