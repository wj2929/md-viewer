import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

const OUT_DIR = join(process.cwd(), 'test-results', 'move-to-visual')

test.describe('跨目录移动视觉', () => {
  test('展示最近目录搜索和目标确认', async ({ page, electronApp, testDir }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const sourceRoot = join(testDir, '当前项目')
    const targetRoot = join(testDir, '知识库归档')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(join(sourceRoot, '待归档方案.md'), '# 待归档方案')
    writeFileSync(join(targetRoot, 'index.md'), '# 知识库归档')

    await openFolderViaIPC(electronApp, targetRoot)
    await openFolderViaIPC(electronApp, sourceRoot)
    await page.locator('.file-tree-row', { hasText: '待归档方案.md' }).click()
    await electronApp.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('file:move-to-request', {
        path: filePath,
        isDirectory: false,
      })
    }, join(sourceRoot, '待归档方案.md'))

    const dialog = page.locator('.move-to-dialog')
    await expect(dialog).toBeVisible()
    await page.getByRole('textbox', { name: '搜索移动目标目录' }).fill('知识库')
    await dialog.locator('.move-to-root-row', { hasText: '知识库归档' }).click()
    await expect(dialog.locator('.move-to-target')).toContainText('知识库归档')
    await dialog.screenshot({ path: join(OUT_DIR, 'move-to-folder-dialog.png') })
  })
})
