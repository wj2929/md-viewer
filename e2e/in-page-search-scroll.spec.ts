import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

for (const mode of ['single-small', 'split-small', 'split-large', 'compare-large'] as const) {
  test(`页内搜索相邻可见结果不滚动，远处结果只滚所属预览：${mode}`, async ({ page, electronApp, testDir }, testInfo) => {
    const split = mode !== 'single-small'
    const large = mode.endsWith('large')
    await page.setViewportSize({ width: 1400, height: 850 })
    const padding = Array.from({ length: 16 }, (_, i) => `Paragraph ${i}: ` + 'stable layout filler '.repeat(large ? 20 : 1)).join('\n\n')
    const rows = Array.from({ length: 24 }, (_, i) => `| ${i + 1} | probehit region ${i + 1} | ${i * 123} |`).join('\n')
    writeFileSync(join(testDir, 'test1.md'), '# Left\n\nSeparate document.\n\n' + padding)
    writeFileSync(join(testDir, 'code.md'), '# Right\n\n' + padding + '\n\n| Index | Region | Amount |\n| --- | --- | --- |\n' + rows + '\n\n' + padding)
    await openFolderViaIPC(electronApp, testDir)
    if (split) {
      await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('Left')
      await page.keyboard.press('Control+\\')
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
      await page.locator('.split-leaf-panel').last().locator('.markdown-body').click()
    }
    await page.locator('.file-tree-row.file', { hasText: 'code.md' }).click()
    const pane = split ? page.locator('.split-leaf-panel').last() : page.locator('.preview').first()
    await expect(pane.locator('.markdown-body h1')).toHaveText('Right')
    if (mode === 'compare-large') {
      await electronApp.evaluate(({ Menu, BrowserWindow }) => {
        ;(Menu.prototype as unknown as { popup: () => void }).popup = function (this: Electron.Menu) {
          const item = this.items.find(item => item.label.includes('快速编辑'))
          item?.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
        }
      })
      await pane.locator('.markdown-body h1').click({ button: 'right' })
      await expect(pane.locator('.markdown-edit-workbench')).toBeVisible()
    }
    await pane.locator('.markdown-body h1').click()
    await page.keyboard.press('Meta+Shift+f')
    const input = pane.getByRole('textbox', { name: '搜索词', exact: true })
    await input.fill('probehit')
    await expect(pane.locator('.in-page-search-count')).toHaveText('1 / 24')
    // Allow initial navigation, reading-position reporting and the search entrance animation to settle.
    await page.waitForTimeout(850)
    await pane.locator('.markdown-body').evaluate(root => {
      const preview = root.closest('.preview') as HTMLElement
      const next = root.querySelectorAll('mark.search-highlight')[1].getBoundingClientRect()
      const viewport = preview.getBoundingClientRect()
      if (next.top < viewport.top || next.bottom > viewport.bottom) throw new Error('Adjacent hit is not initially visible')
      const state = { running: true, frames: [] as any[] }
      ;(window as any).__findScrollSamples = state
      const sample = () => {
        if (!state.running) return
        const box = preview.querySelector('.in-page-search-box')!.getBoundingClientRect()
        state.frames.push({ at: performance.now(), top: preview.scrollTop, left: preview.scrollLeft,
          boxX: box.x, boxY: box.y, pageX: window.scrollX, pageY: window.scrollY,
          otherScroll: [...document.querySelectorAll('.preview')].filter(element => element !== preview).map(element => ({ top: element.scrollTop, left: element.scrollLeft })) })
        requestAnimationFrame(sample)
      }
      sample()
    })
    const clickNative = async (name: string) => {
      const bounds = await pane.getByRole('button', { name, exact: true }).boundingBox()
      expect(bounds).toBeTruthy()
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    }
    await clickNative('下一个匹配')
    await expect(pane.locator('.in-page-search-count')).toHaveText('2 / 24')
    await page.waitForTimeout(700)
    await clickNative('上一个匹配')
    await expect(pane.locator('.in-page-search-count')).toHaveText('1 / 24')
    await page.waitForTimeout(700)
    const samples = await page.evaluate(() => {
      const state = (window as any).__findScrollSamples
      state.running = false
      return state.frames
    })
    await testInfo.attach('visible-match-scroll-samples', { body: JSON.stringify(samples), contentType: 'application/json' })
    const range = (key: string) => Math.max(...samples.map((sample: any) => sample[key])) - Math.min(...samples.map((sample: any) => sample[key]))
    expect(range('top'), 'Already-visible adjacent matches must not recenter or rebound').toBeLessThanOrEqual(1)
    for (const key of ['left', 'boxX', 'boxY', 'pageX', 'pageY']) expect(range(key), key).toBeLessThanOrEqual(1)
    expect(samples.every((sample: any) => JSON.stringify(sample.otherScroll) === JSON.stringify(samples[0].otherScroll))).toBe(true)

    await input.focus()
    for (let index = 0; index < 18; index++) await input.press('Enter')
    await expect(pane.locator('.in-page-search-count')).toHaveText('19 / 24')
    await page.waitForTimeout(700)
    const currentHitVisible = () => pane.locator('.search-highlight-current').evaluate(mark => {
      const preview = mark.closest('.preview')!
      const viewport = preview.getBoundingClientRect()
      const box = preview.querySelector('.in-page-search-box')!.getBoundingClientRect()
      const rect = mark.getBoundingClientRect()
      return rect.top >= Math.max(viewport.top, box.bottom) && rect.bottom <= viewport.bottom
    })
    expect(await currentHitVisible(), 'Offscreen hit must be revealed below the search box').toBe(true)
    // Clicking a navigation button rerenders the owning split panel. Its last read report
    // must not become a new 300ms restoration request and pull this next hit back out of view.
    await clickNative('下一个匹配')
    await expect(pane.locator('.in-page-search-count')).toHaveText('20 / 24')
    await page.waitForTimeout(700)
    expect(await currentHitVisible(), 'A live reading-position report must not undo the new match').toBe(true)
    await input.press('Shift+Enter')
    await expect(pane.locator('.in-page-search-count')).toHaveText('19 / 24')
    await page.screenshot({ path: testInfo.outputPath('stable-navigation.png'), animations: 'disabled' })
    await input.press('Escape')
    await expect(pane.locator('.in-page-search-box')).toHaveCount(0)
    await expect(pane.locator('mark.search-highlight')).toHaveCount(0)
  })
}
