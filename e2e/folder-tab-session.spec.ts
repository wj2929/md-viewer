import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { test, expect } from './fixtures/electron'

/**
 * 文件夹级 tab 会话记忆 + tab 懒加载（v2.8.0）E2E
 *
 * 覆盖需求 1（切走再切回恢复该文件夹的完整 tab 列表 + 当时的当前文档）
 * 与需求 2（真懒加载：切回只建壳 tab，激活时才读盘渲染）。
 *
 * 关键驱动：文件夹切换必须走真实 UI 的“最近文件夹”下拉（.history-item），
 * 才会触发 App.tsx 里 handleSelectHistoryFolder 的 归档→恢复 链路；
 * testOpenMarkdownFile 走的是 activateFolderForWindow，不归档，不能用来验证本特性。
 */

function createFolders(): {
  folderA: string
  folderB: string
  a1: string
  a2: string
  b1: string
  cleanup: () => void
} {
  const baseDir = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(baseDir, { recursive: true })
  const root = mkdtempSync(join(baseDir, 'md-viewer-fts-'))
  const folderA = join(root, 'alpha')
  const folderB = join(root, 'beta')
  mkdirSync(folderA, { recursive: true })
  mkdirSync(folderB, { recursive: true })
  const a1 = join(folderA, 'a1.md')
  const a2 = join(folderA, 'a2.md')
  const b1 = join(folderB, 'b1.md')
  writeFileSync(a1, '# Alpha One\n\n第一份 alpha 文档')
  writeFileSync(a2, '# Alpha Two\n\n第二份 alpha 文档')
  writeFileSync(b1, '# Beta One\n\nbeta 文档')
  return { folderA, folderB, a1, a2, b1, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test.describe('文件夹 tab 会话记忆 + 懒加载', () => {
  test('切走再切回恢复完整 tab 与当前文档；非活动 tab 懒加载', async ({ page }) => {
    const { folderA, folderB, a1, a2, b1, cleanup } = createFolders()
    try {
      // 1) 先打开 B（进历史），再打开 A（当前根 = A）
      await page.evaluate(p => window.api.testOpenMarkdownFile?.(p), b1)
      await page.waitForSelector('.file-tree-container', { timeout: 10000 })
      await page.evaluate(p => window.api.testOpenMarkdownFile?.(p), a1)
      await page.waitForSelector('.file-tree-container', { timeout: 10000 })
      await expect(page.locator('.tab .tab-name', { hasText: 'a1.md' })).toBeVisible({ timeout: 10000 })

      // 2) 在 A 内再打开 a2.md（文件树点击，用户主动打开），并使其成为当前文档
      await page.locator('.file-tree-row .file-name', { hasText: 'a2.md' }).click()
      await expect(page.locator('.tab.active .tab-name', { hasText: 'a2.md' })).toBeVisible({ timeout: 10000 })
      // 此时 A 有两个 tab：a1、a2，当前为 a2
      await expect(page.locator('.tab .tab-name', { hasText: 'a1.md' })).toBeVisible()

      // 3) 通过“最近文件夹”下拉切到 B —— 触发归档 A {a1,a2, active=a2}
      await page.locator('.history-toggle-btn').click()
      await page.locator('.history-menu .history-item', { hasText: 'beta' }).click()
      // 切到 B 后，A 的非固定 tab 从视图移除
      await expect.poll(
        () => page.locator('.tab .tab-name', { hasText: 'a2.md' }).count(),
        { timeout: 10000 }
      ).toBe(0)

      // 4) 再切回 A —— 触发恢复 A 会话
      await page.locator('.history-toggle-btn').click()
      await page.locator('.history-menu .history-item', { hasText: 'alpha' }).click()

      // 断言：两个 tab 都恢复，且当前文档仍是 a2
      await expect(page.locator('.tab .tab-name', { hasText: 'a1.md' })).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.tab .tab-name', { hasText: 'a2.md' })).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.tab.active .tab-name', { hasText: 'a2.md' })).toBeVisible({ timeout: 10000 })

      // 懒加载：活动文档 a2 被自动预热并渲染
      await expect(page.locator('.markdown-body')).toContainText('Alpha Two', { timeout: 10000 })
      // 此刻还未点 a1，主预览不应出现 a1 的正文
      await expect(page.locator('.markdown-body')).not.toContainText('Alpha One')

      // 5) 点击非活动的 a1 壳 tab —— 激活时才读盘渲染
      await page.locator('.tab .tab-name', { hasText: 'a1.md' }).click()
      await expect(page.locator('.tab.active .tab-name', { hasText: 'a1.md' })).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.markdown-body')).toContainText('Alpha One', { timeout: 10000 })
    } finally {
      cleanup()
    }
  })

  test('切走再切回恢复同根分屏结构、活动叶子和独立阅读位置', async ({ page, electronApp }) => {
    const { a1, a2, b1, cleanup } = createFolders()
    writeFileSync(a2, [
      '# Alpha Two',
      '',
      ...Array.from({ length: 220 }, (_, index) => `## 章节 ${index + 1}\n\n这是第 ${index + 1} 节的正文，用于验证同文档双 leaf 的独立阅读位置。`),
    ].join('\n'))
    try {
      await page.evaluate(p => window.api.testOpenMarkdownFile?.(p), b1)
      await page.waitForSelector('.file-tree-container', { timeout: 10000 })
      await page.evaluate(p => window.api.testOpenMarkdownFile?.(p), a1)
      await expect(page.locator('.markdown-body')).toContainText('Alpha One', { timeout: 10000 })
      await page.locator('.file-tree-row .file-name', { hasText: 'a2.md' }).click()
      await expect(page.locator('.markdown-body')).toContainText('Alpha Two', { timeout: 10000 })

      const tabId = await page.locator('.tab.active').getAttribute('data-tab-id')
      expect(tabId).toBeTruthy()
      await electronApp.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('tab:open-in-split', payload)
      }, { tabId, direction: 'horizontal' })
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
      const previews = page.locator('.split-leaf-panel .preview')
      await expect(previews).toHaveCount(2)
      await expect(page.locator('.split-leaf-panel .markdown-body')).toHaveCount(2)
      await expect.poll(async () => previews.evaluateAll(elements =>
        elements.every(element => element.scrollHeight > element.clientHeight)
      )).toBe(true)
      await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      await previews.nth(0).evaluate(element => {
        const max = element.scrollHeight - element.clientHeight
        element.scrollTop = max * 0.12
        element.dispatchEvent(new Event('scroll'))
      })
      await previews.nth(1).evaluate(element => {
        const max = element.scrollHeight - element.clientHeight
        element.scrollTop = max * 0.78
        element.dispatchEvent(new Event('scroll'))
      })
      await expect.poll(async () => previews.evaluateAll(elements => elements.map(element => {
        const max = Math.max(1, element.scrollHeight - element.clientHeight)
        return element.scrollTop / max
      }))).toEqual([
        expect.closeTo(0.12, 1),
        expect.closeTo(0.78, 1),
      ])
      await page.waitForTimeout(700)
      await page.locator('.split-leaf-panel').nth(1).click()
      await expect(page.locator('.split-leaf-panel').nth(1)).toHaveClass(/active/)

      await page.locator('.history-toggle-btn').click()
      await page.locator('.history-menu .history-item', { hasText: 'beta' }).click()
      await expect(page.locator('.split-leaf-panel')).toHaveCount(0)

      await page.locator('.history-toggle-btn').click()
      await page.locator('.history-menu .history-item', { hasText: 'alpha' }).click()
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2, { timeout: 10000 })
      await expect(page.locator('.split-leaf-panel').nth(1)).toHaveClass(/active/)
      await expect(page.locator('.split-leaf-panel .markdown-body')).toHaveCount(2, { timeout: 10000 })
      await expect(page.locator('.split-leaf-panel .markdown-body').first()).toContainText('Alpha Two')
      await expect(page.locator('.split-leaf-panel .markdown-body').nth(1)).toContainText('Alpha Two')
      await expect(page.locator('.tab.active .tab-name')).toContainText('a2.md')
      await expect.poll(async () => previews.evaluateAll(elements => elements.map(element => {
        const max = Math.max(1, element.scrollHeight - element.clientHeight)
        return element.scrollTop / max
      })), { timeout: 10000 }).toEqual([
        expect.closeTo(0.12, 1),
        expect.closeTo(0.78, 1),
      ])
    } finally {
      cleanup()
    }
  })
})
