import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC, installLayoutFullscreen } from './fixtures/electron'

for (const mode of ['normal-single', 'fullscreen-single', 'fullscreen-split', 'fullscreen-short', 'fullscreen-compare']) {
  test(`目录必须真正可点击且导航居中：${mode}`, async ({ page, electronApp, testDir }, info) => {
    await installLayoutFullscreen(electronApp)
    await electronApp.evaluate(({ BrowserWindow }, mode) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1200, height: mode.endsWith('short') ? 640 : 800 }), mode)
    writeFileSync(join(testDir, 'test1.md'), '# First\n\n左侧正文。')
    writeFileSync(join(testDir, 'code.md'), '# Navigation fixture\n\n' + Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\n${'自建目录测试。'.repeat(35)}`).join('\n\n'))
    await openFolderViaIPC(electronApp, testDir)
    await expect(page.locator('.markdown-body h1')).toHaveText('Navigation fixture')
    const split = !mode.endsWith('single')
    if (split) {
      await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('First')
      await page.keyboard.press('Control+\\')
      await expect(page.locator('.split-leaf-panel')).toHaveCount(2)
      await page.locator('.split-leaf-panel').last().locator('.markdown-body h1').click()
      if (mode.endsWith('short')) await page.locator('.split-leaf-panel').last().getByTitle('向下分屏', { exact: true }).click()
    }
    const pane = split ? page.locator('.split-leaf-panel').last() : page.locator('.preview-pane')
    if (mode.endsWith('compare')) {
      await electronApp.evaluate(({ Menu, BrowserWindow }) => {
        ;(Menu.prototype as any).popup = function () { const item = this.items.find((item: any) => item.label.includes('快速编辑')); item?.click(item, BrowserWindow.getAllWindows()[0], {}) }
      })
      await pane.locator('.markdown-body h1').click({ button: 'right' })
      await expect(pane.locator('.markdown-edit-workbench')).toBeVisible()
    }
    if (mode.startsWith('fullscreen')) { await page.keyboard.press('Meta+F11'); await expect(page.locator('.app')).toHaveClass(/fullscreen/) }
    const nav = pane.getByRole('navigation', { name: '文档导航', exact: true })
    await nav.getByRole('button', { name: '目录', exact: true }).click()
    const panel = nav.getByRole('navigation', { name: '文档目录', exact: true })
    await expect(panel).toBeVisible()
    const geometry = await nav.evaluate(nav => {
      const pane = nav.closest('.markdown-workbench-preview-pane,.preview-pane,.split-preview-pane')!
      const host = pane.getBoundingClientRect(), box = nav.getBoundingClientRect()
      const panel = nav.querySelector('.toc-panel')!, rect = panel.getBoundingClientRect()
      const item = panel.querySelector('.toc-item')!, itemRect = item.getBoundingClientRect()
      const hit = document.elementFromPoint(itemRect.left + Math.min(40, itemRect.width / 2), itemRect.top + itemRect.height / 2)
      return { centerOffset: Math.abs((box.top + box.bottom - host.top - host.bottom) / 2),
        panelInside: rect.top >= host.top - 1 && rect.bottom <= host.bottom + 1 && rect.left >= host.left - 1 && rect.right <= host.right + 1,
        itemHittable: item.contains(hit), overflowX: getComputedStyle(nav).overflowX, panel: rect.toJSON(), host: host.toJSON() }
    })
    await info.attach('directory-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('directory-open.png'), animations: 'disabled' })
    expect(geometry.itemHittable, 'directory must not be clipped by the toolbar').toBe(true)
    expect(geometry.panelInside, 'directory must fit its own preview pane').toBe(true)
    expect(geometry.centerOffset, 'desktop navigation must stay vertically centered').toBeLessThan(2)
    await panel.getByRole('link', { name: 'Section 39', exact: true }).click()
    await expect.poll(() => pane.locator('.markdown-body h2').last().evaluate(element => {
      const rect = element.getBoundingClientRect(), preview = element.closest('.preview')!.getBoundingClientRect()
      return rect.top >= preview.top && rect.bottom <= preview.bottom
    })).toBe(true)
    await panel.getByRole('button', { name: '关闭目录', exact: true }).click()
    await expect(panel).toHaveCount(0)
  })
}
