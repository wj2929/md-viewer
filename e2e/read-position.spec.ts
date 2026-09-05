import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

test.describe('阅读位置恢复', () => {
  test('同一文档双分屏在外部刷新后保持各自滚动位置', async ({ page, electronApp, testDir }) => {
    const filePath = join(testDir, 'split-refresh-position.md')
    const sections = Array.from({ length: 100 }, (_, index) => [
      `## Section ${index + 1}`,
      '',
      `Paragraph ${index + 1} for split refresh position.`,
      '',
    ]).flat()
    writeFileSync(filePath, ['# Split Position', '', ...sections].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.click('.file-tree-row.file:has-text("split-refresh-position.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Split Position')

    const activeTabId = await page.locator('.tab[aria-selected="true"]').getAttribute('data-tab-id')
    if (!activeTabId) throw new Error('missing active tab id')
    await electronApp.evaluate(({ BrowserWindow }, tabId) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('tab:open-in-split', {
        tabId,
        direction: 'horizontal',
      })
    }, activeTabId)
    const leaves = page.locator('.split-leaf-panel')
    await expect(leaves).toHaveCount(2)
    const previews = leaves.locator('.preview')
    await expect(previews).toHaveCount(2)

    await previews.nth(0).evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.12
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await previews.nth(1).evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.78
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await page.waitForTimeout(400)

    writeFileSync(filePath, ['# Split Position Updated', '', ...sections, 'Tail update'].join('\n'))
    await expect(leaves.locator('.markdown-body h1')).toHaveText(['Split Position Updated', 'Split Position Updated'])
    await page.waitForTimeout(700)

    const ratios = await previews.evaluateAll(elements => elements.map(element => {
      const max = Math.max(1, element.scrollHeight - element.clientHeight)
      return element.scrollTop / max
    }))
    expect(ratios[0]).toBeGreaterThan(0.04)
    expect(ratios[0]).toBeLessThan(0.3)
    expect(ratios[1]).toBeGreaterThan(0.55)
    expect(ratios[1] - ratios[0]).toBeGreaterThan(0.35)
  })

  test('普通重新打开文档时恢复最近阅读位置', async ({ page, electronApp, testDir }) => {
    writeFileSync(join(testDir, 'long-read.md'), [
      '# Long Read',
      '',
      ...Array.from({ length: 80 }, (_, index) => [
        `## Section ${index + 1}`,
        '',
        `Paragraph ${index + 1} for read position restore.`,
        '',
      ]).flat(),
    ].join('\n'))

    await page.setViewportSize({ width: 1400, height: 900 })
    await openFolderViaIPC(electronApp, testDir)
    await page.waitForSelector('.file-tree-container', { timeout: 10000 })

    await page.click('.file-tree-row.file:has-text("long-read.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Long Read')

    const preview = page.locator('.preview')
    await preview.evaluate(element => {
      element.scrollTop = element.scrollHeight * 0.62
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await page.waitForTimeout(700)

    await page.click('.file-tree-row.file:has-text("test1.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')

    await page.click('.file-tree-row.file:has-text("long-read.md")')
    await expect(page.locator('.markdown-body h1')).toHaveText('Long Read')
    await page.waitForTimeout(700)

    const restoredTop = await preview.evaluate(element => element.scrollTop)
    const restoredMax = await preview.evaluate(element => element.scrollHeight - element.clientHeight)
    expect(restoredTop).toBeGreaterThan(restoredMax * 0.35)
  })
})
