import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

for (const mode of ['normal-split', 'fullscreen-single', 'fullscreen-split', 'fullscreen-compare']) {
  test(`分散命中逐项进入实际可视区域：${mode}`, async ({ page, electronApp, testDir }, info) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width: 1400, height: 900 })
    const split = mode !== 'fullscreen-single'
    const sections = Array.from({ length: 17 }, (_, i) => {
      const padding = Array.from({ length: 3 + i % 4 }, (_, j) => `Context ${i}-${j}: ` + 'independent example text '.repeat(10)).join('\n\n')
      const rows = Array.from({ length: 7 }, (_, j) => `| ${j} | ${j === i % 7 ? '示例项' : 'Other'} | ${'Details '.repeat(4 + i % 5)} |`).join('\n')
      return `## Section ${i + 1}\n\n${padding}\n\n| Index | Region | Description |\n| --- | --- | --- |\n${rows}\n\n${padding}`
    }).join('\n\n')
    writeFileSync(join(testDir, 'test1.md'), '# Left\n\nSeparate panel.')
    writeFileSync(join(testDir, 'code.md'), '# Right\n\n' + sections)
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
    if (mode === 'fullscreen-compare') {
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
    if (mode.startsWith('fullscreen')) {
      await page.keyboard.press('Meta+F11')
      await expect(page.locator('.app')).toHaveClass(/fullscreen/)
      await page.waitForTimeout(500)
    }
    await page.keyboard.press('Meta+Shift+f')
    await pane.getByRole('textbox', { name: '搜索词', exact: true }).fill('示例项')
    await expect(pane.locator('.in-page-search-count')).toHaveText('1 / 17')
    await page.waitForTimeout(850)
    const capture = () => pane.locator('.search-highlight-current').evaluate(mark => {
      const rect = mark.getBoundingClientRect()
      const preview = mark.closest('.preview')!
      const box = preview.querySelector('.in-page-search-box')!.getBoundingClientRect()
      let top = 0, bottom = innerHeight, left = 0, right = innerWidth
      for (let parent = mark.parentElement; parent; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent)
        if (/hidden|auto|scroll|clip/.test(style.overflowY)) {
          top = Math.max(top, bounds.top + parent.clientTop)
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight)
        }
        if (/hidden|auto|scroll|clip/.test(style.overflowX)) {
          left = Math.max(left, bounds.left + parent.clientLeft)
          right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth)
        }
      }
      const actualTop = Math.max(top, box.bottom)
      const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
      return { index: [...preview.querySelectorAll('mark.search-highlight')].indexOf(mark),
        top: rect.top, bottom: rect.bottom, clipTop: actualTop, clipBottom: bottom,
        visible: rect.top >= actualTop && rect.bottom <= bottom && rect.left >= left && rect.right <= right && !!hit && mark.contains(hit),
        otherPanes: [...document.querySelectorAll('.preview')].filter(element => element !== preview).map(element => ({ top: element.scrollTop, left: element.scrollLeft })), pageX: scrollX, pageY: scrollY }
    })
    const observations: Awaited<ReturnType<typeof capture>>[] = []
    const initial = await capture()
    observations.push(initial)
    try {
      expect(initial.visible, JSON.stringify(initial)).toBe(true)
      let index = 0
      for (const direction of ['下一个匹配', '上一个匹配']) {
        for (let i = 0; i < 17; i++) {
          const bounds = await pane.getByRole('button', { name: direction, exact: true }).boundingBox()
          expect(bounds).toBeTruthy()
          await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
          index = (index + (direction === '下一个匹配' ? 1 : 16)) % 17
          await expect(pane.locator('.in-page-search-count')).toHaveText(`${index + 1} / 17`)
          const immediate = await capture()
          observations.push(immediate)
          expect(immediate.visible, JSON.stringify(immediate)).toBe(true)
          await page.waitForTimeout(700)
          const settled = await capture()
          observations.push(settled)
          expect(settled.index).toBe(index)
          expect(settled.visible, JSON.stringify(settled)).toBe(true)
          expect(settled.otherPanes).toEqual(initial.otherPanes)
          expect([settled.pageX, settled.pageY]).toEqual([initial.pageX, initial.pageY])
        }
      }
    } finally {
      await info.attach('actual-viewport-observations', { body: JSON.stringify(observations), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('current-navigation.png'), animations: 'disabled' })
    }
  })
}
