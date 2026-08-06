import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { test, expect } from './fixtures/electron'

/**
 * 跨文件夹分屏打开回归测试
 *
 * 读授权放宽后，书签/最近/历史里登记过的、位于其他文件夹的文件，
 * 应能通过 file:open-in-split 在当前窗口分屏打开，而不再被 fs:readFile 拒绝。
 *
 * 覆盖分屏热路径上的读放宽校验：fs:readFile / fs:watchFile / pinned-tabs:is-pinned。
 */

function createTwoFolders(): { fileA: string; fileB: string; cleanup: () => void } {
  const baseDir = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(baseDir, { recursive: true })
  const root = mkdtempSync(join(baseDir, 'md-viewer-split-'))
  const folderA = join(root, 'folder-a')
  const folderB = join(root, 'folder-b')
  mkdirSync(folderA, { recursive: true })
  mkdirSync(folderB, { recursive: true })
  const fileA = join(folderA, 'a.md')
  const fileB = join(folderB, 'cross.md')
  writeFileSync(fileA, '# A\n\n当前窗口文件夹')
  writeFileSync(fileB, '# Cross\n\n跨文件夹分屏目标')
  return { fileA, fileB, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test.describe('跨文件夹分屏打开', () => {
  test('已登记的其他文件夹文件可在当前窗口分屏渲染，不被拒绝', async ({ page, electronApp }) => {
    const { fileA, fileB, cleanup } = createTwoFolders()
    try {
      // 先打开 B（进入历史/最近），再打开 A（窗口当前根 = A 所在文件夹）
      await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fileB)
      await page.waitForSelector('.file-tree-container', { timeout: 10000 })
      await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fileA)
      await page.waitForSelector('.file-tree-container', { timeout: 10000 })

      // main 侧向当前窗口 push 分屏打开事件，目标是另一个文件夹里已登记的 cross.md
      await electronApp.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('file:open-in-split', {
          filePath,
          direction: 'horizontal'
        })
      }, fileB)

      // 断言：跨文件夹文件成功打开为标签页（读放宽放行），且未出现"无法在分屏中打开"的错误提示
      await expect(page.locator('.tab', { hasText: 'cross.md' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('无法在分屏中打开')).toHaveCount(0)
    } finally {
      cleanup()
    }
  })
})
