import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC, installLayoutFullscreen } from './fixtures/electron'

for (const mode of ['single', 'split', 'compare', 'short-pane', 'normal-compare', 'dark-narrow-compare']) {
  test(`隐藏布局验证：${mode} 的正文、导航、搜索和朗读属于本面板`, async ({ page, electronApp, testDir }, info) => {
    const fullscreen = !mode.startsWith('normal')
    const compare = mode.includes('compare')
    await installLayoutFullscreen(electronApp)
    await electronApp.evaluate(({ BrowserWindow }, mode) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: mode === 'dark-narrow-compare' ? 860 : 1200, height: mode === 'short-pane' ? 640 : 800 })
    }, mode)
    writeFileSync(join(testDir, 'test1.md'), '# Left document\n\n只应在左侧朗读。')
    writeFileSync(join(testDir, 'code.md'), '# Right document\n\n只应在右侧朗读。\n\n' +
      Array.from({ length: 30 }, (_, i) => `## Section ${i}\n\n独立阅读示例。${'正文内容。'.repeat(20)}`).join('\n\n'))
    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.markdown-body h1')).toHaveText('Right document')
    if (mode !== 'single') {
      await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('Left document')
      await page.keyboard.press('Control+\\')
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
      await page.locator('.split-leaf-panel').last().locator('.markdown-body h1').click()
      if (mode === 'short-pane') {
        await page.locator('.split-leaf-panel').last().getByTitle('向下分屏', { exact: true }).click()
        await expect(page.locator('.split-leaf-panel')).toHaveCount(3)
      }
    }
    const pane = mode === 'single' ? page.locator('.preview-pane') : page.locator('.split-leaf-panel').last()
    if (mode === 'dark-narrow-compare') await page.getByRole('radio', { name: '暗色主题' }).click()
    if (compare) {
      await electronApp.evaluate(({ Menu, BrowserWindow }) => {
        ;(Menu.prototype as unknown as { popup: () => void }).popup = function (this: Electron.Menu) {
          const item = this.items.find(item => item.label.includes('快速编辑'))
          item?.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
        }
      })
      await pane.locator('.markdown-body h1').click({ button: 'right' })
      await expect(pane.locator('.markdown-edit-workbench')).toBeVisible()
    }
    await page.evaluate(() => {
      const spoken: string[] = []
      Object.assign(window, { __layoutSpoken: spoken })
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [], cancel: () => {}, pause: () => {}, resume: () => {},
        speak: (u: SpeechSynthesisUtterance) => { spoken.push(u.text); setTimeout(() => u.onstart?.(new Event('start') as SpeechSynthesisEvent), 0) },
        addEventListener: () => {}, removeEventListener: () => {},
      } })
    })
    if (fullscreen) {
      await page.keyboard.press('Meta+F11')
      await expect(page.locator('.app')).toHaveClass(/fullscreen/)
    }
    await expect(pane.getByRole('button', { name: '朗读', exact: true })).toBeVisible()
    const geometry = () => pane.evaluate(el => {
      const preview = el.querySelector('.preview')!.getBoundingClientRect()
      const nav = el.querySelector('.floating-nav')!.getBoundingClientRect()
      const toggle = el.querySelector('.read-aloud-toggle')!.getBoundingClientRect()
      const body = el.querySelector('.markdown-body')!.getBoundingClientRect()
      const within = (box: DOMRect, parent: DOMRect) => box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1 && box.left >= parent.left - 1 && box.right <= parent.right + 1
      const host = el.getBoundingClientRect()
      return { preview: preview.toJSON(), host: host.toJSON(), nav: nav.toJSON(), toggle: toggle.toJSON(),
        inWindow: preview.top >= 0 && preview.bottom <= innerHeight && preview.right <= innerWidth,
        controlsInside: within(nav, host) && within(toggle, host),
        controlsSeparate: nav.bottom <= toggle.top, gutter: body.left - preview.left,
        navInPreview: within(nav, preview) }
    })
    const initial = await geometry()
    await info.attach('geometry', { body: JSON.stringify(initial), contentType: 'application/json' })
    expect(initial.inWindow).toBe(true)
    expect(initial.controlsInside).toBe(true)
    expect(initial.controlsSeparate).toBe(true)
    expect(initial.navInPreview).toBe(true)
    expect(initial.gutter).toBeGreaterThanOrEqual(fullscreen ? 20 : 16)
    await pane.getByRole('button', { name: '朗读', exact: true }).click()
    const controls = pane.getByRole('group', { name: '朗读控制' })
    await controls.getByRole('combobox', { name: '朗读服务' }).selectOption('system')
    await controls.getByRole('button', { name: '开始朗读', exact: true }).click()
    await expect(controls.getByRole('button', { name: '暂停朗读' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __layoutSpoken: string[] }).__layoutSpoken[0])).toBe('Right document')
    const controlBounds = await controls.evaluate(el => {
      const box = el.getBoundingClientRect()
      const parent = el.closest('.markdown-workbench-preview-pane,.preview-pane,.split-preview-pane')!.getBoundingClientRect()
      return { inside: box.top >= parent.top && box.bottom <= parent.bottom && box.left >= parent.left && box.right <= parent.right }
    })
    expect(controlBounds.inside).toBe(true)
    await expect(pane.locator('.floating-nav')).toBeHidden()
    await page.screenshot({ path: info.outputPath('playing.png'), animations: 'disabled' })
    await controls.getByRole('button', { name: '暂停朗读' }).click()
    await expect(controls.getByRole('button', { name: '继续朗读' })).toBeVisible()
    await controls.getByRole('button', { name: '继续朗读' }).click()
    await expect(controls.getByRole('button', { name: '暂停朗读' })).toBeVisible()
    await controls.getByRole('button', { name: '停止朗读' }).click()
    await pane.getByRole('button', { name: '朗读', exact: true }).click()
    await expect(pane.locator('.floating-nav')).toBeVisible()
    if (mode !== 'single') {
      const left = page.locator('.split-leaf-panel').first()
      await left.locator('.split-panel-header').click()
      await expect(left).toHaveClass(/active/)
      await left.getByRole('button', { name: '朗读', exact: true }).click()
      await left.getByRole('button', { name: '开始朗读', exact: true }).click()
      await expect(left.getByRole('button', { name: '暂停朗读' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __layoutSpoken: string[] }).__layoutSpoken.at(-1))).toBe('Left document')
      await pane.locator('.split-panel-header').click()
      await expect(pane).toHaveClass(/active/)
      await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
    }
    await page.keyboard.press('Meta+Shift+f')
    await pane.getByRole('textbox', { name: '搜索词', exact: true }).fill('独立阅读示例')
    await expect(pane.locator('.in-page-search-count')).toHaveText('1 / 30')
    await expect.poll(() => pane.locator('.search-highlight-current').evaluate(el => {
      const rect = el.getBoundingClientRect()
      const box = el.closest('.preview')!.querySelector('.in-page-search-box')!.getBoundingClientRect()
      return rect.top >= box.bottom && rect.bottom <= innerHeight
    })).toBe(true)
    await page.screenshot({ path: info.outputPath('search.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('.app')).not.toHaveClass(/fullscreen/)
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocused() && !w.isFullScreen()))).toBe(true)
  })
}
