import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'

async function sourceFixture(electronApp: ElectronApplication, page: Page, testDir: string) {
  writeFileSync(join(testDir, 'A.md'), [
    '# Source A', '', '[第一次到B](./B.md)', '',
    ...Array.from({ length: 35 }, (_, n) => `前置段落 ${n + 1}\n`),
    '## 来源章节', '', '[第二次到B](./B.md)', '', '[JSON附件](./data.json)', '',
    ...Array.from({ length: 35 }, (_, n) => `后置段落 ${n + 1}\n`),
  ].join('\n'))
  writeFileSync(join(testDir, 'B.md'), '# Target B\n\n[到C](./C.md)\n\nB正文')
  writeFileSync(join(testDir, 'C.md'), '# Target C\n\nC正文')
  writeFileSync(join(testDir, 'data.json'), String.raw`{"id":9007199254740993123,"id":-0,"n":1.00e+400,"text":"<script>window.attachmentExecuted=true</script>"}`)
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
}

test.describe('本地附件及本次来源返回', () => {
  test('JSON只读/保真/查找/Escape与主进程关闭快捷键不影响MD标签', async ({ electronApp, page, testDir }, testInfo) => {
    await sourceFixture(electronApp, page, testDir)
    await electronApp.evaluate(({ BrowserWindow }) => {
      ;(globalThis as any).__attachmentKeys = []
      BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => {
        if (['f', 'w'].includes(input.key.toLowerCase())) (globalThis as any).__attachmentKeys.push({ key: input.key, type: input.type, meta: input.meta, control: input.control })
      })
    })
    const link = page.getByRole('link', { name: 'JSON附件' })
    await link.click()
    const dialog = page.getByRole('dialog', { name: 'data.json · 只读' })
    const text = dialog.getByRole('textbox', { name: '只读附件文本' })
    await expect(text).toBeVisible()
    await expect(text).toHaveAttribute('aria-readonly', 'true')
    await expect(text).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.tab')).toHaveCount(1)
    await expect(text).toContainText('9007199254740993123')
    await expect(text).toContainText('1.00e+400')
    expect(await page.evaluate(() => (window as any).attachmentExecuted)).toBeUndefined()
    await dialog.getByRole('button', { name: '原文', exact: true }).click()
    await expect(dialog.locator('.cm-line')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('attachment-light.png') })
    await dialog.getByRole('button', { name: /查找/ }).click()
    const search = dialog.locator('.cm-search input[name="search"]')
    await expect(search).toBeFocused()
    await search.pressSequentially('9007199254740993123')
    await expect(dialog.locator('.cm-searchMatch')).toHaveCount(1)
    await search.press('Escape')
    await expect(dialog.locator('.cm-search')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await text.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(link).toBeFocused()
    await link.click()
    await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
    const nativeKey = async (key: string) => {
      await electronApp.evaluate(({ BrowserWindow }, key) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.focus()
        const modifiers = process.platform === 'darwin' ? ['meta'] : ['control']
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
      }, key)
    }
    await nativeKey('F')
    await expect(page.locator('.local-attachment-dialog .cm-search input[name="search"]')).toBeFocused()
    await nativeKey('W')
    await expect(page.locator('.local-attachment-dialog')).toHaveCount(0)
    const nativeKeys = await electronApp.evaluate(() => (globalThis as any).__attachmentKeys)
    expect(nativeKeys.some((input: any) => input.key.toLowerCase() === 'w' && input.type === 'keyDown')).toBe(true)
    writeFileSync(testInfo.outputPath('native-keys.json'), JSON.stringify(nativeKeys, null, 2))
    await testInfo.attach('native-key-observation', { body: JSON.stringify(nativeKeys), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('attachment-after-mod-w.png') })
    await expect(page.locator('.local-attachment-dialog')).toHaveCount(0)
    await expect(page.locator('.tab')).toHaveCount(1)
    await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
  })

  test('重复链接精确返回、A→B→C逐级返回与全文阅读唯一入口', async ({ electronApp, page, testDir }, testInfo) => {
    await sourceFixture(electronApp, page, testDir)
    const second = page.getByRole('link', { name: '第二次到B' })
    await second.scrollIntoViewIfNeeded()
    const offset = await second.evaluate(anchor => anchor.getBoundingClientRect().top - anchor.closest('.preview')!.getBoundingClientRect().top)
    await second.click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
    await expect(page.locator('.link-origin-floating')).toHaveText('↶返回')
    await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
    await expect(page.locator('.link-origin-header')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('source-floating-normal.png') })
    await page.getByRole('link', { name: '到C' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Target C')
    await page.locator('.link-origin-floating').click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
    await page.locator('.link-origin-floating').click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
    await expect.poll(async () => Math.abs(await second.evaluate(anchor => anchor.getBoundingClientRect().top - anchor.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
    await page.waitForTimeout(600) // 检查有界校正结束后仍停在实际第二处，而非旧阅读比例。
    expect(Math.abs(await second.evaluate(anchor => anchor.getBoundingClientRect().top - anchor.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
    await expect(second).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('source-return.png') })
    await second.click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F11' : 'F11')
    await expect(page.locator('.app')).toHaveClass(/fullscreen/)
    await expect(page.locator('.link-origin-header')).toHaveCount(0)
    await expect(page.locator('.link-origin-floating')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('source-fullscreen.png') })
    await page.locator('.link-origin-floating').click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
    await expect(page.locator('.link-origin-floating')).toHaveCount(0)
  })

  test('文档卡片须显式确认，HTML/SVG不执行，缺失链接明确失败', async ({ electronApp, page, testDir }, testInfo) => {
    writeFileSync(join(testDir, 'cards.md'), '# Cards\n\n[PDF](./manual.pdf)\n\n[HTML](./unsafe.html)\n\n[SVG](./unsafe.svg)\n\n[缺失](./missing.json)')
    writeFileSync(join(testDir, 'manual.pdf'), '%PDF-1.4\n% harmless fixture')
    writeFileSync(join(testDir, 'unsafe.html'), '<script>window.attachmentExecuted=true</script>')
    writeFileSync(join(testDir, 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>window.attachmentExecuted=true</script></svg>')
    await electronApp.evaluate(({ dialog, shell }) => {
      ;(globalThis as any).__attachmentActions = { opens: [], reveals: [], confirmations: [] }
      dialog.showMessageBox = async (_parent: any, options: any) => {
        ;(globalThis as any).__attachmentActions.confirmations.push({ defaultId: options.defaultId, cancelId: options.cancelId, buttons: options.buttons })
        return { response: 0, checkboxChecked: false }
      }
      shell.openPath = async (file: string) => { (globalThis as any).__attachmentActions.opens.push(file); return '' }
      shell.showItemInFolder = (file: string) => { (globalThis as any).__attachmentActions.reveals.push(file) }
    })
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'cards.md' }).click()
    await page.getByRole('link', { name: 'PDF', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('manual.pdf')
    expect(await electronApp.evaluate(() => (globalThis as any).__attachmentActions.opens)).toEqual([])
    await page.getByRole('button', { name: '用系统应用打开', exact: true }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__attachmentActions.confirmations.length)).toBe(1)
    expect(await electronApp.evaluate(() => (globalThis as any).__attachmentActions.confirmations[0])).toEqual({ defaultId: 0, cancelId: 0, buttons: ['取消', '打开'] })
    expect(await electronApp.evaluate(() => (globalThis as any).__attachmentActions.opens)).toEqual([])
    await page.getByRole('button', { name: /在.*中显示/ }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__attachmentActions.reveals.length)).toBe(1)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    for (const name of ['HTML', 'SVG']) {
      await page.getByRole('link', { name, exact: true }).click()
      const text = page.getByRole('textbox', { name: '只读附件文本' })
      await expect(text).toBeVisible()
      await expect(text).toHaveAttribute('aria-readonly', 'true')
      await expect(text).toContainText('<script>window.attachmentExecuted=true</script>')
      await expect(page.getByRole('button', { name: '用系统应用打开', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).attachmentExecuted)).toBeUndefined()
      await page.getByRole('button', { name: '关闭', exact: true }).click()
    }
    await page.getByRole('link', { name: '缺失', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('附件不存在、不可访问或不在来源工作区内')
    await expect(page.getByRole('button', { name: '用系统应用打开', exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('attachment-failure.png') })
  })
})
