import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'

test('浏览入口与过滤排序共用一行，不占额外高度', async ({ electronApp, page, testDir }, info) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  writeFileSync(join(testDir, 'toolbar.md'), '# Toolbar fixture\n\nSynthetic document for toolbar layout.')
  await openFolderViaIPC(electronApp, testDir)
  const action = page.getByRole('button', { name: '浏览工作区文件', exact: true })
  await expect(page.locator('.file-tree-filter-bar').getByRole('button', { name: '浏览工作区文件', exact: true })).toBeVisible()
  for (const width of [500, 280, 180]) {
    const handle = await page.locator('.workspace > .resize-handle').first().boundingBox()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100)
    await page.mouse.down()
    await page.mouse.move(width, handle!.y + 100, { steps: 5 })
    await page.mouse.up()
    await page.mouse.move(1000, 100)
    await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox())!.width)).toBe(width)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      const layout = await page.evaluate(() => {
        const bar = document.querySelector('.file-tree-filter-bar')!.getBoundingClientRect()
        const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect()
        const icon = document.querySelector('.sidebar .file-browser-toggle')!.getBoundingClientRect()
        const sort = document.querySelector('.file-tree-sort-button')!.getBoundingClientRect()
        const input = document.querySelector('.file-tree-filter-input')!.getBoundingClientRect()
        return { extraTop: bar.top - sidebar.top, iconCenter: icon.top + icon.height / 2,
          sortCenter: sort.top + sort.height / 2, inside: icon.right <= bar.right,
          inputWidth: input.width, height: bar.height, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      expect(layout.extraTop).toBeLessThanOrEqual(1)
      expect(Math.abs(layout.iconCenter - layout.sortCenter)).toBeLessThan(1)
      expect(layout.inside).toBe(true)
      expect(layout.inputWidth).toBeGreaterThan(30)
      expect(layout.height).toBeLessThanOrEqual(40)
      expect(layout.overflow).toBe(false)
      await page.screenshot({ path: info.outputPath(`toolbar-${width}-${theme}.png`), animations: 'disabled' })
    }
  }
  await expect(action).toHaveCount(1)
  await action.click()
  await expect(page.getByRole('complementary', { name: '工作区文件' })).toBeVisible()
})

test('目录浏览：按需三栏、懒展开、过滤与收起左树入口', async ({ electronApp, page, testDir }, info) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  const root = join(testDir, 'browser-fixture')
  for (const name of ['assets', 'empty', 'node_modules', '.hidden']) mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# Browser fixture\n\nKeep the document visible.')
  writeFileSync(join(root, 'data.json'), '{"synthetic":true}')
  writeFileSync(join(root, 'assets', 'example.txt'), 'Synthetic resource')
  await openFolderViaIPC(electronApp, root)
  await expect(page.locator('.markdown-body h1')).toHaveText('Browser fixture')
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  await expect(browser).toBeHidden()
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browser.getByRole('button', { name: /data.json/ })).toBeVisible()
  await expect(page.locator('.sidebar .file-tree')).toBeVisible()
  await expect(page.locator('.markdown-body h1')).toHaveText('Browser fixture')
  const bounds = await page.evaluate(() => {
    const left = document.querySelector('.sidebar')!.getBoundingClientRect()
    const middle = document.querySelector('.file-browser-panel')!.getBoundingClientRect()
    const right = document.querySelector('.content-area')!.getBoundingClientRect()
    return { leftRight: left.right, middleLeft: middle.left, middleRight: middle.right, rightLeft: right.left, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  expect(bounds.middleLeft).toBeGreaterThanOrEqual(bounds.leftRight)
  expect(bounds.rightLeft).toBeGreaterThanOrEqual(bounds.middleRight)
  expect(bounds.overflow).toBe(false)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.screenshot({ path: info.outputPath(`directory-slice-${theme}.png`) })
  }
  await browser.getByRole('button', { name: /empty/ }).click()
  await expect(browser.getByText('空文件夹', { exact: true })).toBeVisible()
  await browser.getByRole('button', { name: /assets/ }).click()
  await expect(browser.getByRole('button', { name: /example.txt/ })).toBeVisible()
  await browser.getByRole('textbox', { name: '过滤已加载项' }).fill('data')
  await expect(browser.getByRole('button', { name: /data.json/ })).toBeVisible()
  await expect(browser.getByRole('button', { name: /README.md/ })).toHaveCount(0)
  await browser.getByRole('textbox', { name: '过滤已加载项' }).fill('')
  await page.getByRole('button', { name: '隐藏文件树', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(browser).toBeVisible()
  await expect(page.getByRole('button', { name: '浏览工作区文件', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browser).toBeHidden()
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browser.getByRole('button', { name: /example.txt/ })).toBeVisible()
  await browser.getByRole('button', { name: '关闭工作区文件', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Browser fixture')
})

test('目录浏览：没有 Markdown 的工作区也可进入完整目录', async ({ electronApp, page, testDir }) => {
  const root = join(testDir, 'resources-only')
  mkdirSync(join(root, 'empty'), { recursive: true })
  writeFileSync(join(root, 'data.json'), '{"synthetic":true}')
  await electronApp.evaluate(({ dialog }, fixtureRoot) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fixtureRoot] })) as typeof dialog.showOpenDialog
  }, root)
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click()
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  await expect(browser.getByRole('button', { name: /data.json/ })).toBeVisible()
  await expect(browser.getByRole('button', { name: /empty/ })).toBeVisible()
  await expect(page.locator('.tab')).toHaveCount(0)
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  await expect(page.locator('.tab')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(page.getByText('选择一个 Markdown 文件开始预览')).toBeVisible()
  await expect(browser).toBeVisible()
})

async function resourceWorkspace(app: ElectronApplication, page: Page, testDir: string) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  const root = join(testDir, 'resource-workspace')
  mkdirSync(root)
  writeFileSync(join(root, '00-original.md'), '# Resource fixture\n\n' + Array.from({ length: 100 }, (_, i) => `## Section ${i}\n\n${'Synthetic reading content with a stable source position. '.repeat(9)}\n\n`).join(''))
  writeFileSync(join(root, 'other.md'), '# Other document\n\nSynthetic target.')
  writeFileSync(join(root, 'data.json'), '{"name":"synthetic","count":9007199254740993123,"enabled":true}')
  writeFileSync(join(root, 'document.pdf'), 'synthetic PDF placeholder')
  writeFileSync(join(root, 'unsafe.html'), '<script>globalThis.__browserUnsafe = 1</script>')
  writeFileSync(join(root, 'query.sql'), 'SELECT id, name FROM synthetic WHERE active = true;')
  const media = join(__dirname, 'fixtures/local-media')
  copyFileSync(join(media, 'images/poster.png'), join(root, 'picture.png'))
  copyFileSync(join(media, 'videos/demo.mp4'), join(root, 'clip.mp4'))
  copyFileSync(join(media, 'audio/tone.mp3'), join(root, 'tone.mp3'))
  await openFolderViaIPC(app, root)
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  return { root, browser: page.getByRole('complementary', { name: '工作区文件' }),
    toggle: page.getByRole('button', { name: '浏览工作区文件', exact: true }) }
}

test('临时资源：连续浏览、不进入会话、两种关闭独立、HTML只读和受控系统打开', async ({ electronApp, page, testDir }, info) => {
  const { root, browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  const tabCount = await page.locator('.tab').count()
  await toggle.click()
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toHaveAttribute('aria-readonly', 'true')
  await expect(page.locator('.document-workbench')).toBeHidden()
  await expect(page.locator('.document-workbench')).toHaveAttribute('inert', '')
  await expect(page.locator('.tab')).toHaveCount(tabCount)
  expect(await page.evaluate(async () => (await window.api.getRecentFiles()).some(file => file.path.endsWith('data.json')))).toBe(false)
  await browser.getByRole('button', { name: '关闭工作区文件', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  await toggle.click()
  await browser.getByRole('button', { name: 'picture.png', exact: true }).click()
  const image = page.locator('.workspace-resource-preview img')
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const imageBox = await image.evaluate((node: HTMLImageElement) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, natural: node.naturalWidth / node.naturalHeight }))
  expect(Math.abs(imageBox.width / imageBox.height - imageBox.natural)).toBeLessThan(0.02)
  await page.screenshot({ path: info.outputPath('resource-image-wide.png') })
  await browser.getByRole('button', { name: 'unsafe.html', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toContainText('<script>')
  expect(await page.evaluate(() => (globalThis as any).__browserUnsafe)).toBeUndefined()
  await expect(page.getByRole('button', { name: '用系统应用打开', exact: true })).toHaveCount(0)
  await electronApp.evaluate(({ dialog, shell }) => {
    ;(globalThis as any).__browserExternalCalls = []
    shell.openPath = async target => { (globalThis as any).__browserExternalCalls.push(target); return '' }
    dialog.showMessageBox = (async (_parent, options) => {
      ;(globalThis as any).__browserConfirmation = options
      return { response: 0 }
    }) as typeof dialog.showMessageBox
  })
  await browser.getByRole('button', { name: 'document.pdf', exact: true }).click()
  await expect(page.getByText('此格式暂不支持应用内预览。')).toBeVisible()
  await page.getByRole('button', { name: '用系统应用打开', exact: true }).click()
  expect(await electronApp.evaluate(() => (globalThis as any).__browserExternalCalls.length)).toBe(0)
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__browserConfirmation?.defaultId)).toBe(0)
  await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1 })) as typeof dialog.showMessageBox })
  await page.getByRole('button', { name: '用系统应用打开', exact: true }).click()
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__browserExternalCalls.length)).toBe(1)
  expect(await electronApp.evaluate(() => (globalThis as any).__browserExternalCalls[0])).toBe(join(root, 'document.pdf'))
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
  await expect(browser).toBeVisible()
})

test('临时音视频：手动无声播放、Range读取、切换与关闭停止原播放器', async ({ electronApp, page, testDir }, info) => {
  const { browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  const mediaResponses: number[] = []
  page.on('response', response => { if (/127\.0\.0\.1.*\/mdv-/.test(response.url())) mediaResponses.push(response.status()) })
  await toggle.click()
  await browser.getByRole('button', { name: 'clip.mp4', exact: true }).click()
  const video = page.locator('.workspace-resource-preview video')
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1)
  expect(await video.evaluate((node: HTMLVideoElement) => node.paused && !node.autoplay)).toBe(true)
  await video.evaluate(async (node: HTMLVideoElement) => { (globalThis as any).__browserVideo = node; node.muted = true; await node.play() })
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath('resource-video-wide.png') })
  await browser.getByRole('button', { name: 'tone.mp3', exact: true }).click()
  const audio = page.locator('.workspace-resource-preview audio')
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(1)
  expect(await page.evaluate(() => { const video = (globalThis as any).__browserVideo as HTMLVideoElement; return video.paused && !video.hasAttribute('src') })).toBe(true)
  await audio.evaluate(async (node: HTMLAudioElement) => { (globalThis as any).__browserAudio = node; node.muted = true; await node.play() })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('shortcut:close-tab'))
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  expect(await page.evaluate(() => { const audio = (globalThis as any).__browserAudio as HTMLAudioElement; return audio.paused && !audio.hasAttribute('src') })).toBe(true)
  expect(mediaResponses).toContain(206)
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
})

test('阅读位置：开关中栏、拖宽和正文隐藏恢复保留同一内容位置', async ({ electronApp, page, testDir }, info) => {
  const { browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  const before = await page.locator('.document-workbench .preview').evaluate(node => {
    const scroller = node as HTMLElement
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.45
    scroller.dispatchEvent(new Event('scroll'))
    const top = scroller.getBoundingClientRect().top
    const anchor = [...scroller.querySelectorAll<HTMLElement>('[data-source-line]')].find(item => item.getBoundingClientRect().bottom > top)!
    anchor.dataset.browserTestAnchor = '1'
    return anchor.getBoundingClientRect().top - top
  })
  const offset = () => page.evaluate(() => {
    const root = document.querySelector('.document-workbench .preview')!
    return document.querySelector('[data-browser-test-anchor="1"]')!.getBoundingClientRect().top - root.getBoundingClientRect().top
  })
  await toggle.click()
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  expect(Math.abs(await offset() - before)).toBeLessThan(3)
  const widthBefore = await browser.evaluate(node => node.getBoundingClientRect().width)
  const handle = await page.getByRole('separator', { name: '调整工作区文件栏宽度' }).boundingBox()
  await page.mouse.move(handle!.x + 2, handle!.y + 80); await page.mouse.down()
  await page.mouse.move(handle!.x + 62, handle!.y + 80, { steps: 6 }); await page.mouse.up()
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  expect(await browser.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 40)
  expect(Math.abs(await offset() - before)).toBeLessThan(3)
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await expect(page.locator('.document-workbench')).toBeHidden()
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  expect(Math.abs(await offset() - before)).toBeLessThan(3)
  await page.screenshot({ path: info.outputPath('reading-restored-after-resource.png') })
  await browser.getByRole('button', { name: '关闭工作区文件', exact: true }).click()
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  expect(Math.abs(await offset() - before)).toBeLessThan(3)
})

test('真实宽窄布局与明暗主题：中栏按剩余空间降级抽屉、不横向溢出', async ({ electronApp, page, testDir }, info) => {
  const { browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  await toggle.click()
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  for (const [width, height] of [[1800, 1000], [1400, 900], [1000, 600], [800, 720]]) {
    await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    if (width === 800) {
      await expect(browser).toHaveClass(/browser-drawer/)
      expect(await browser.locator('header > strong').evaluate(node => node.getBoundingClientRect().height < parseFloat(getComputedStyle(node).fontSize) * 1.8)).toBe(true)
    } else await expect(browser).not.toHaveClass(/browser-drawer/)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: info.outputPath(`resource-layout-${width}x${height}-${theme}.png`) })
    }
  }
  await browser.getByRole('button', { name: '查看内容', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  await toggle.click()
  await expect(browser.getByRole('button', { name: 'data.json', exact: true })).toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await expect(browser).not.toHaveClass(/browser-drawer/)
  await browser.getByRole('button', { name: 'other.md', exact: true }).click()
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Other document')
})

test('临时预览返回保留编辑模式、未保存草稿和编辑器滚动，保存快捷键不写后台文稿', async ({ electronApp, page, testDir }, info) => {
  const { root, browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  const file = join(root, '00-original.md'), original = readFileSync(file, 'utf8')
  await toggle.click()
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' }), file)
  const editorWorkbench = page.getByLabel('00-original.md 编辑工作区')
  await expect(editorWorkbench).toBeVisible()
  await editorWorkbench.getByRole('tab', { name: '仅编辑', exact: true }).click()
  const source = editorWorkbench.getByRole('textbox', { name: 'Markdown 源码编辑区' })
  await source.click(); await source.press('ControlOrMeta+End'); await source.press('Enter'); await source.pressSequentially('BROWSER_DRAFT_KEEP')
  await expect(editorWorkbench.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  const before = await editorWorkbench.locator('.cm-scroller').evaluate(node => node.scrollTop)
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await expect(editorWorkbench).toBeHidden()
  await page.getByRole('textbox', { name: '只读附件文本' }).press('ControlOrMeta+s')
  expect(readFileSync(file, 'utf8')).toBe(original)
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(editorWorkbench).toBeVisible()
  await expect(editorWorkbench.getByRole('tab', { name: '仅编辑*', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(editorWorkbench.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  await expect(source).toContainText('BROWSER_DRAFT_KEEP')
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  expect(Math.abs(await editorWorkbench.locator('.cm-scroller').evaluate(node => node.scrollTop) - before)).toBeLessThan(4)
  expect(readFileSync(file, 'utf8')).toBe(original)
  await page.screenshot({ path: info.outputPath('draft-restored-after-preview.png') })
})

test('分屏与其他侧栏：按剩余正文空间降级，保持面板身份和比例', async ({ electronApp, page, testDir }, info) => {
  const { root, browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  await toggle.click()
  await browser.getByRole('button', { name: 'other.md', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Other document')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-in-split', { filePath, direction: 'horizontal' }), join(root, '00-original.md'))
  const leaves = page.locator('.split-leaf-panel')
  await expect(leaves).toHaveCount(2)
  const before = await leaves.evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.leafId, width: node.getBoundingClientRect().width })))
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await expect(page.locator('.document-workbench')).toBeHidden()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 720))
  await expect(browser).toHaveClass(/browser-drawer/)
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(leaves.nth(0)).toBeVisible(); await expect(leaves.nth(1)).toBeVisible()
  await page.screenshot({ path: info.outputPath('split-with-browser-drawer.png') })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await expect(browser).not.toHaveClass(/browser-drawer/)
  await expect(page.locator('.document-workbench[data-browser-layout-paused]')).toHaveCount(0)
  const after = await leaves.evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.leafId, width: node.getBoundingClientRect().width })))
  expect(after.map(item => item.id)).toEqual(before.map(item => item.id))
  for (let i = 0; i < before.length; i++) expect(Math.abs(before[i].width - after[i].width)).toBeLessThan(3)
  await page.getByRole('button', { name: '显示书签面板', exact: true }).click()
  await expect(browser).toHaveClass(/browser-drawer/)
  await page.getByRole('button', { name: '隐藏书签面板', exact: true }).click()
  await expect(browser).not.toHaveClass(/browser-drawer/)
})

test('所有显式文档入口：最近文件、书签、活动标签和系统打开成功后退出资源', async ({ electronApp, page, testDir }) => {
  const { root, browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  await page.evaluate(async root => {
    await window.api.addRecentFile({ path: `${root}/00-original.md`, name: '00-original.md', folderPath: root })
    await window.api.addBookmark({ filePath: `${root}/other.md`, fileName: 'other.md', title: 'Browser saved target' })
  }, root)
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('bookmarks:changed'))
  if (await page.locator('.tab-bar-bookmark-trigger').isVisible()) await page.locator('.tab-bar-bookmark-trigger').click()
  await expect(page.locator('.bookmark-bar-item')).toHaveCount(1)
  const preview = async () => {
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await browser.getByRole('button', { name: 'data.json', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  }
  await preview()
  await page.getByRole('button', { name: '最近打开的文件', exact: true }).click()
  await page.getByRole('button', { name: /打开文件 00-original.md，/ }).click()
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
  await preview()
  await page.locator('.bookmark-bar-item').click()
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Other document')
  await preview()
  await page.locator('.tab', { hasText: 'other.md' }).click()
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  await preview()
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('open-specific-file', filePath), join(root, '00-original.md'))
  await expect(page.locator('.workspace-resource-preview')).toHaveCount(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
})

async function installBrowserMenuFixture(app: ElectronApplication) {
  await app.evaluate(({ Menu, clipboard }) => {
    const state = globalThis as unknown as { browserMenuFixture: { next: string; labels: string[]; copiedText: string } }
    state.browserMenuFixture = { next: '', labels: [], copiedText: '' }
    clipboard.writeText = text => { state.browserMenuFixture.copiedText = text }
    const build = Menu.buildFromTemplate.bind(Menu)
    Menu.buildFromTemplate = template => {
      const menu = build(template)
      if (template.some(item => item.label === '复制相对路径')) {
        menu.popup = options => {
          state.browserMenuFixture.labels = menu.items.map(item => item.label).filter(Boolean)
          const item = menu.items.find(item => item.label === state.browserMenuFixture.next)
          if (item) (item.click as unknown as () => void)()
          options?.callback?.()
        }
      }
      return menu
    }
  })
}

async function chooseBrowserMenu(app: ElectronApplication, locator: import('@playwright/test').Locator, label: string) {
  await app.evaluate((_electron, label) => {
    const state = (globalThis as unknown as { browserMenuFixture: { next: string; labels: string[] } }).browserMenuFixture
    state.next = label; state.labels = []
  }, label)
  await locator.click({ button: 'right' })
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { browserMenuFixture: { labels: string[] } }).browserMenuFixture.labels)).not.toEqual([])
  const labels = await app.evaluate(() => (globalThis as unknown as { browserMenuFixture: { labels: string[] } }).browserMenuFixture.labels)
  if (label) expect(labels).toContain(label)
  return labels
}

test('工作区右键：创建、命名视觉、路径复制与目录重命名链接修复', async ({ electronApp, page, testDir }, info) => {
  test.setTimeout(60000)
  const root = join(testDir, 'browser-actions')
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# Browser actions\n\n[Child](docs/child.md)')
  writeFileSync(join(root, 'docs', 'child.md'), '# Child fixture\n\nSynthetic document.')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await openFolderViaIPC(electronApp, root)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await installBrowserMenuFixture(electronApp)
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  const rootLabels = await chooseBrowserMenu(electronApp, browser.locator('.browser-root'), '新建文件…')
  expect(rootLabels).not.toContain('重命名…')
  expect(rootLabels).not.toContain('移到废纸篓…')
  await info.attach('native-root-menu-template', { body: JSON.stringify(rootLabels), contentType: 'application/json' })
  const name = page.getByRole('textbox', { name: '名称', exact: true })
  await expect(name).toHaveValue('未命名.md')
  await page.screenshot({ path: info.outputPath('browser-create-wide-light.png'), animations: 'disabled' })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 720))
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
  await expect(name).toBeVisible()
  await page.screenshot({ path: info.outputPath('browser-create-narrow-dark.png'), animations: 'disabled' })
  await name.fill('created.txt'); await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  expect(readFileSync(join(root, 'created.txt'), 'utf8')).toBe('')
  await expect(page.locator('.tab')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: 'created.txt', exact: true }), '复制相对路径')
  await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { browserMenuFixture: { copiedText: string } }).browserMenuFixture.copiedText)).toBe('created.txt')
  await chooseBrowserMenu(electronApp, browser.locator('.browser-root'), '新建文件夹…')
  await name.fill('empty-created'); await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(browser.getByRole('button', { name: /empty-created/ })).toBeVisible()
  await browser.getByRole('button', { name: /docs/ }).click()
  await browser.getByRole('button', { name: 'child.md', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Child fixture')
  const tabIds = await page.locator('.tab').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')))
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: /docs/ }), '重命名…')
  await name.fill('renamed'); await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '重命名文件夹', exact: true }).click()
  await expect(page.getByRole('heading', { name: /重命名结果/ })).toBeVisible()
  expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('(docs/child.md)')
  await expect(browser.getByRole('button', { name: /renamed/ })).toBeVisible()
  expect(await page.locator('.tab').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')))).toEqual(tabIds)
  await page.screenshot({ path: info.outputPath('browser-rename-directory-dark.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '查看可更新的链接', exact: true }).click()
  await page.getByRole('button', { name: /更新 \d+ 个文件中的 \d+ 处链接/ }).click()
  await expect.poll(() => readFileSync(join(root, 'README.md'), 'utf8')).toContain('(./renamed/child.md)')
})

test('工作区右键：废纸篓取消、目录后代标签清理与草稿阻断', async ({ electronApp, page, testDir }, info) => {
  const { root, browser, toggle } = await resourceWorkspace(electronApp, page, testDir)
  await toggle.click()
  await installBrowserMenuFixture(electronApp)
  await electronApp.evaluate(({ dialog, shell }, root) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    shell.trashItem = async target => {
      if (!target.startsWith(root + '/')) throw new Error('fixture-only trash guard')
      await process.getBuiltinModule('fs/promises').rename(target, target + '.fixture-trashed')
    }
  }, root)
  await browser.getByRole('button', { name: 'data.json', exact: true }).click()
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: 'data.json', exact: true }), '移到废纸篓…')
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox })
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: 'data.json', exact: true }), '移到废纸篓…')
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toHaveCount(0)
  expect(readFileSync(join(root, 'data.json.fixture-trashed'), 'utf8')).toContain('synthetic')
  await expect(page.locator('.tab')).toHaveCount(1)
  mkdirSync(join(root, 'remove-dir'))
  writeFileSync(join(root, 'remove-dir', 'removed-child.md'), '# Removed child')
  await browser.getByLabel('工作区文件操作', { exact: true }).click()
  await browser.getByRole('button', { name: '刷新工作区文件', exact: true }).click()
  await browser.getByRole('button', { name: /remove-dir/ }).click()
  await browser.getByRole('button', { name: 'removed-child.md', exact: true }).click()
  await expect(page.locator('.tab')).toHaveCount(2)
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: /remove-dir/ }), '移到废纸篓…')
  await expect(page.locator('.tab')).toHaveCount(1)
  await expect(page.locator('.markdown-body h1')).toHaveText('Resource fixture')
  expect(readFileSync(join(root, 'remove-dir.fixture-trashed', 'removed-child.md'), 'utf8')).toBe('# Removed child')
  const sourcePath = join(root, '00-original.md'), original = readFileSync(sourcePath, 'utf8')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' }), sourcePath)
  const editor = page.getByLabel('00-original.md 编辑工作区')
  await expect(editor).toBeVisible()
  await editor.getByRole('tab', { name: '仅编辑', exact: true }).click()
  const source = editor.getByRole('textbox', { name: 'Markdown 源码编辑区' })
  await source.click(); await source.press('ControlOrMeta+End'); await source.press('Enter'); await source.pressSequentially('KEEP_BROWSER_MUTATION_DRAFT')
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: '00-original.md', exact: true }), '移到废纸篓…')
  await expect(browser.getByRole('alert')).toContainText('草稿')
  expect(readFileSync(sourcePath, 'utf8')).toBe(original)
  await expect(source).toContainText('KEEP_BROWSER_MUTATION_DRAFT')
  await page.screenshot({ path: info.outputPath('browser-dirty-mutation-blocked.png'), animations: 'disabled' })
})

test('工作区右键：新窗口目录与当前窗口切根归档', async ({ electronApp, page, testDir }) => {
  test.setTimeout(60000)
  const root = join(testDir, 'browser-folder-open')
  mkdirSync(join(root, 'child'), { recursive: true })
  writeFileSync(join(root, 'parent.md'), '# Parent root')
  writeFileSync(join(root, 'child', 'child.md'), '# Child root')
  await openFolderViaIPC(electronApp, root)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await installBrowserMenuFixture(electronApp)
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: /child/ }), '在新窗口打开')
  await expect.poll(() => electronApp.windows().length).toBe(2)
  const other = electronApp.windows().find(window => window !== page)!
  await other.locator('.file-tree').getByText('child.md', { exact: true }).click()
  await expect(other.locator('.markdown-body h1')).toHaveText('Child root')
  await expect(page.locator('.markdown-body h1')).toHaveText('Parent root')
  await chooseBrowserMenu(electronApp, browser.getByRole('button', { name: /child/ }), '在当前窗口打开')
  await expect(page.locator('.file-tree-container')).toBeVisible()
  await expect.poll(() => page.evaluate(async root => (await window.api.getFolderTabSession(root)).tabs.map(tab => tab.path), root)).toContain(join(root, 'parent.md'))
  await expect(page.getByRole('button', { name: '浏览工作区文件', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browser.locator('.browser-root')).toHaveAttribute('title', 'child')
  await expect(browser.getByRole('button', { name: 'child.md', exact: true })).toBeVisible()
})

test('工作区文件图标：文件夹和文件形状明确，宽窄明暗对齐', async ({ electronApp, page, testDir }, info) => {
  const root = join(testDir, 'browser-icon-fixture')
  for (const folder of ['assets', 'empty', '__generated__', '示例文件夹与较长名称']) mkdirSync(join(root, folder), { recursive: true })
  for (const [file, content] of [['README.md', '# Icon fixture'], ['report.xlsx', 'synthetic'], ['photo.png', 'synthetic'], ['sound.mp3', 'synthetic'], ['clip.mp4', 'synthetic'], ['data.json', '{}'], ['unknown.bin', 'synthetic'], ['assets/child.txt', 'Synthetic child']]) writeFileSync(join(root, file), content)
  await openFolderViaIPC(electronApp, root)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  const folder = browser.getByRole('button', { name: 'assets', exact: true })
  await expect(folder.locator('.browser-entry-icon')).toHaveAttribute('data-kind', 'folder')
  await folder.click()
  await expect(folder.locator('.browser-entry-chevron svg')).toHaveClass('expanded')
  await expect(browser.getByRole('button', { name: 'child.txt', exact: true })).toBeVisible()
  for (const width of [1400, 800]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      const measurements = await browser.locator('.browser-entry').evaluateAll(nodes => nodes.map(button => {
        const icon = button.querySelector('.browser-entry-icon')!
        const label = button.querySelector('span:last-child')!
        const bounds = icon.getBoundingClientRect(), text = label.getBoundingClientRect(), row = button.getBoundingClientRect()
        return { kind: icon.getAttribute('data-kind'), iconWidth: bounds.width, iconHeight: bounds.height, labelLeft: text.left,
          visible: bounds.left >= row.left && bounds.right <= row.right, centered: Math.abs(bounds.top + bounds.height / 2 - (row.top + row.height / 2)) }
      }))
      expect(measurements.every(item => item.iconWidth === 17 && item.iconHeight === 17 && item.visible && item.centered < 1)).toBe(true)
      const kinds = measurements.map(item => item.kind)
      expect(kinds).toEqual(expect.arrayContaining(['folder', 'markdown', 'table', 'image', 'audio', 'video', 'attachment']))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.mouse.move(width - 30, 100)
      await page.screenshot({ path: info.outputPath(`browser-icons-${width}-${theme}.png`), animations: 'disabled' })
    }
  }
})
