import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

test('800px长来源名称及窄分屏leaf保留可点击入口和完整提示', async ({ electronApp, page, testDir }, testInfo) => {
  const name = '记录很长的来源专题文档'.repeat(5) + '.md'
  writeFileSync(join(testDir, name), '# Long Source\n\n[B](./B.md)')
  writeFileSync(join(testDir, 'B.md'), '# Target B')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550)
  await page.locator('.file-tree-row.file', { hasText: name }).click()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 800))
  expect(await page.evaluate(() => innerWidth)).toBe(800)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  const button = page.locator('.link-origin-floating')
  await expect(button).toHaveAttribute('title', new RegExp(name.replace(/\./g, '\\.')))
  expect((await button.boundingBox())!.width).toBe(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('long-source-native-800.png') })
  await page.getByRole('radio', { name: '暗色主题' }).click()
  await expect(button).toBeVisible()
  await expect(button).toHaveText('↶返回')
  await page.screenshot({ path: testInfo.outputPath('long-source-dark-native-800.png') })
  await electronApp.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.send('file:open-in-split', { filePath, direction: 'horizontal' })
  }, join(testDir, name))
  await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
  const left = page.locator('.split-leaf-panel').first()
  await expect(left.locator('.link-origin-floating')).toBeVisible()
  await expect(page.locator('.link-origin-header')).toHaveCount(0)
  const box = (await left.locator('.link-origin-floating').boundingBox())!
  const pane = (await left.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(pane.x)
  expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width)
  const header = await left.locator('.split-panel-header').evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }))
  expect(header.scrollWidth).toBeLessThanOrEqual(header.width)
  await page.screenshot({ path: testInfo.outputPath('long-source-split-native-800.png') })
  await left.locator('.link-origin-floating').click()
  await expect(left.locator('.markdown-body h1')).toHaveText('Long Source')
})
