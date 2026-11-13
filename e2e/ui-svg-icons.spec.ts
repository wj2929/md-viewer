import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures/electron'

test('核心图标使用 SVG，浅暗色及窄窗口下保留交互和正文 Emoji', async ({ electronApp, page, testDir }, info) => {
  const emojiText = '正文 Emoji 保持原样：📝 📂 📄 ⚙️ 🌙 🔊'
  writeFileSync(join(testDir, 'test1.md'), `# Icon compatibility\n\n${emojiText}\n\n## Section\n\nHello World\n`)
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(testDir, 'test1.md'))
  await expect(page.locator('.markdown-body')).toContainText(emojiText)

  const folder = page.locator('.file-tree-row.directory').filter({ hasText: 'subfolder' })
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  await expect(folder.locator('.file-icon svg')).toHaveAttribute('data-icon', 'folder-open')
  await folder.click()
  await expect(folder.locator('.file-icon svg')).toHaveAttribute('data-icon', 'folder')
  await folder.click()
  await expect(folder.locator('.file-icon svg')).toHaveAttribute('data-icon', 'folder-open')

  await page.getByRole('button', { name: '最近打开的文件夹', exact: true }).click()
  await expect(page.locator('.history-icon svg').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '最近打开的文件', exact: true }).click()
  await expect(page.locator('.recent-file-icon svg').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.settings-panel')).toBeVisible()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.getByRole('button', { name: '窗口置顶', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消窗口置顶', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '取消窗口置顶', exact: true }).click()

  const speech = page.getByRole('button', { name: '朗读', exact: true })
  await speech.click()
  await expect(page.getByRole('group', { name: '朗读控制' })).toBeVisible()
  await speech.click()
  await expect(page.getByRole('group', { name: '朗读控制' })).toBeHidden()

  const icons = ['.nav-logo-icon', '.nav-folder-path', '.folder-btn', '.recent-files-btn', '.watch-refresh-icon', '.nav-always-on-top-btn', '.nav-settings-btn', '.theme-icon', '.file-icon', '.tab-icon', '.tab-bar-bookmark-icon', '.read-aloud-toggle']
  const client = await page.context().newCDPSession(page)
  await client.send('DOM.enable')
  await client.send('CSS.enable')
  const observations = []
  for (const theme of ['light', 'dark']) {
    for (const width of [1600, 900]) {
      await electronApp.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0]?.setSize(width, 900)
      }, width)
      await page.getByRole('radio', { name: theme === 'light' ? '亮色主题' : '暗色主题', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.mouse.move(0, 200)
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
      for (const selector of icons) {
        const elements = page.locator(selector)
        expect(await elements.count()).toBeGreaterThan(0)
        for (const element of await elements.all()) {
          if (!await element.isVisible()) continue
          const svg = element.locator('svg')
          await expect(svg).toBeVisible()
          await expect(svg).toHaveAttribute('aria-hidden', 'true')
          expect(await svg.locator('text, image, use, foreignObject').count()).toBe(0)
        }
      }
      const { root } = await client.send('DOM.getDocument')
      const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'svg.ui-icon' })
      for (const nodeId of nodeIds) {
        const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId })
        expect(fonts).toEqual([])
      }
      await expect.poll(() => page.locator('.theme-toggle-btn.active').evaluate(button => getComputedStyle(button).color)).toBe('rgb(255, 255, 255)')
      const colors = await page.locator('.theme-toggle-btn').evaluateAll(buttons => buttons.map(button => ({ active: button.classList.contains('active'), color: getComputedStyle(button).color })))
      await expect(page.locator('.markdown-body')).toContainText(emojiText)
      await page.locator('.navigation-bar').screenshot({ path: info.outputPath(`toolbar-${theme}-${width}.png`) })
      await page.screenshot({ path: info.outputPath(`window-${theme}-${width}.png`) })
      observations.push({ theme, width, iconsWithNoFontDependency: nodeIds.length, colors })
    }
  }
  await client.detach()
  writeFileSync(info.outputPath('svg-icon-observations.json'), JSON.stringify(observations, null, 2))
})
