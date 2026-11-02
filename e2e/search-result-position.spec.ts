import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

function documentWithUnevenBlocks(): { content: string; earlyLine: number; lateLine: number } {
  const lines = ['# Search Target', '', 'Introductory text with substantial wrapping. '.repeat(450), '']
  while (lines.length < 23) lines.push('')
  const earlyLine = lines.length + 1
  lines.push('splitlocneedle early target.', '')
  for (let index = 0; index < 160; index++) lines.push(`Paragraph ${index} with ordinary text.`, '')
  const lateLine = lines.length + 1
  lines.push('splitlocneedlelater late target.', '')
  for (let index = 160; index < 320; index++) lines.push(`Paragraph ${index} with ordinary text.`, '')
  return { content: lines.join('\n'), earlyLine, lateLine }
}

async function chooseMatch(page: Page, line: number, keyword = 'splitlocneedle'): Promise<void> {
  await page.locator('.search-trigger').click()
  await page.getByText('全文', { exact: true }).click()
  await page.locator('.search-input').fill(keyword)
  const match = page.locator('.search-match-line').filter({ has: page.locator('.match-line-number', { hasText: new RegExp(`^L${line}$`) }) })
  await expect(match).toBeVisible()
  await match.click()
  await expect(page.locator('.search-input')).toBeHidden()
}

test('分屏打开未加载的搜索目标时，异步标签查询不能让旧面板提前消费定位', async ({ page, electronApp, testDir }) => {
  const source = documentWithUnevenBlocks()
  writeFileSync(join(testDir, 'slow-open.md'), source.content)
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  await page.keyboard.press('Control+\\')
  await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
  await electronApp.evaluate(({ ipcMain }) => {
    const channel = 'pinned-tabs:is-pinned'
    const original = (ipcMain as any)._invokeHandlers.get(channel)
    ;(globalThis as any).__locationDelays = 0
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args: any[]) => {
      if (args[1].endsWith('slow-open.md')) {
        ;(globalThis as any).__locationDelays++
        await new Promise(resolve => setTimeout(resolve, 750))
      }
      return original(...args)
    })
    return true
  })
  await chooseMatch(page, source.earlyLine)
  const target = page.locator('.split-leaf-panel.active')
  await expect(target.locator('.markdown-body h1')).toHaveText('Search Target')
  expect(await electronApp.evaluate(() => (globalThis as any).__locationDelays)).toBe(1)
  await expect(target.locator('.markdown-body p', { hasText: 'splitlocneedle early target.' })).toBeInViewport()
})

for (const mode of ['compare', 'edit'] as const) {
  test(`分屏${mode === 'compare' ? '对照预览' : '仅编辑'}中的全文结果也能定位到目标行`, async ({ page, electronApp, testDir }, testInfo) => {
    const source = documentWithUnevenBlocks()
    const filePath = join(testDir, 'test1.md')
    writeFileSync(filePath, source.content)
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Search Target')
    await page.keyboard.press('Control+\\')
    await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
    const target = page.locator('.split-leaf-panel').first()
    await target.locator('.markdown-body h1').click()
    const leafId = await target.getAttribute('data-leaf-id')
    await electronApp.evaluate(({ BrowserWindow }, params) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:quick-edit', { ...params, mode: 'document' })
    }, { filePath, leafId })
    const workbench = target.getByLabel('test1.md 编辑工作区')
    await expect(workbench).toBeVisible()
    if (mode === 'edit') await workbench.getByRole('tab', { name: '仅编辑', exact: true }).click()
    await chooseMatch(page, source.lateLine, 'splitlocneedlelater')
    const line = mode === 'edit' ? workbench.locator('.cm-line', { hasText: 'splitlocneedlelater late target.' })
      : workbench.locator('.markdown-body p', { hasText: 'splitlocneedlelater late target.' })
    await expect(line).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`search-position-${mode}.png`) })
  })
}

for (const split of [false, true]) {
  test(`${split ? '分屏' : '单屏'}全文结果按实际源码块定位，切换命中行不影响其他面板`, async ({ page, electronApp, testDir }, testInfo) => {
    const source = documentWithUnevenBlocks()
    writeFileSync(join(testDir, 'test1.md'), source.content)
    writeFileSync(join(testDir, 'code.md'), '# Other Panel\n\nsplitlocneedlelater other panel.\n\n' + 'Other panel paragraph.\n\n'.repeat(80))
    await page.setViewportSize({ width: 1200, height: 750 })
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Search Target')
    if (split) {
      await page.keyboard.press('Control+\\')
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
      await page.locator('.split-leaf-panel').last().locator('.markdown-body h1').click()
    }
    const target = split ? page.locator('.split-leaf-panel').first() : page.locator('.preview-pane')
    const other = split ? page.locator('.split-leaf-panel').last() : null
    const beforeOtherScroll = other ? await other.locator('.preview').evaluate(element => element.scrollTop) : 0
    try {
      await chooseMatch(page, source.earlyLine)
      if (split) await expect(target).toHaveClass(/active/)
      const early = target.locator('.markdown-body p').filter({ hasText: 'splitlocneedle early target.' })
      await expect(early).toBeInViewport()
      await expect(early.locator('.search-temp-highlight')).toHaveCount(1)
      await chooseMatch(page, source.lateLine, 'splitlocneedlelater')
      const late = target.locator('.markdown-body p').filter({ hasText: 'splitlocneedlelater late target.' })
      await expect(late).toBeInViewport()
      await expect(late.locator('.search-temp-highlight')).toHaveCount(1)
      await page.waitForTimeout(650)
      await expect(late).toBeInViewport()
      if (other) {
        expect(await other.locator('.preview').evaluate(element => element.scrollTop)).toBe(beforeOtherScroll)
        await expect(other.locator('.search-temp-highlight')).toHaveCount(0)
        await other.locator('.markdown-body h1').click()
        await page.waitForTimeout(650)
        await expect(other.locator('.search-temp-highlight')).toHaveCount(0)
        await expect(late).toBeInViewport()
      }
      await expect(target.locator('.search-temp-highlight')).toHaveCount(0)
      await expect(late).toBeInViewport()
    } finally {
      await page.screenshot({ path: testInfo.outputPath('search-position.png') })
      const positions = await target.locator('.markdown-body p').filter({ hasText: 'splitlocneedle' }).evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        const preview = element.closest('.preview')!.getBoundingClientRect()
        return { sourceLine: element.getAttribute('data-source-line'), top: rect.top, bottom: rect.bottom, previewTop: preview.top, previewBottom: preview.bottom }
      }))
      await testInfo.attach('positions', { body: JSON.stringify(positions), contentType: 'application/json' })
    }
  })
}
