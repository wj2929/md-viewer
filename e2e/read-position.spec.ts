import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

test.describe('阅读位置恢复', () => {
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
