import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, utimesSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const rows = (page: Page) => page.locator('.file-tree > .file-tree-item > .file-tree-row .file-name')
async function fixture(app: ElectronApplication, page: Page, dir: string) {
  const root = join(dir, 'sorting')
  mkdirSync(join(root, 'folder10'), { recursive: true })
  mkdirSync(join(root, 'folder2'), { recursive: true })
  for (const folder of ['folder10', 'folder2']) {
    const child = join(root, folder, 'child.md')
    writeFileSync(child, '# child')
    utimesSync(child, 1000, 1000)
  }
  for (const [name, count, time] of [['1.md', 30, 1000], ['10.md', 20, 3000], ['2.md', 10, 2000], ['z.markdown', 5, 4000]] as const) {
    writeFileSync(join(root, name), '# ' + 'x'.repeat(count))
    utimesSync(join(root, name), time, time)
  }
  await openFolderViaIPC(app, root)
  await expect(rows(page)).toHaveCount(6)
  return root
}
async function openSort(page: Page) {
  await page.getByRole('button', { name: /^目录树排序：/ }).click()
  const dialog = page.getByRole('dialog', { name: '目录树全局排序' })
  await expect(dialog.getByRole('radio').first()).toBeEnabled()
  return dialog
}
async function mode(page: Page, name: string) {
  const dialog = await openSort(page)
  await dialog.getByRole('radio', { name, exact: true }).check()
  await expect(dialog.getByRole('radio', { name, exact: true })).toBeEnabled()
  await dialog.press('Escape')
}
async function instrument(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    ;(globalThis as any).sortCalls = []
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      ;(globalThis as any).sortCalls.push(paths)
      return original(event, paths, operation)
    })
  })
}

test('目录树排序：默认兼容、五种规则、正反向、过滤与范围选择', async ({ electronApp, page, testDir }) => {
  await instrument(electronApp)
  const root = await fixture(electronApp, page, testDir)
  expect(await rows(page).allTextContents()).toEqual(['folder10', 'folder2', '1.md', '10.md', '2.md', 'z.markdown'])
  await mode(page, '名称（自然数字）')
  expect(await rows(page).allTextContents()).toEqual(['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.markdown'])
  expect(await electronApp.evaluate(() => (globalThis as any).sortCalls.length)).toBe(0)
  const filter = page.getByRole('textbox', { name: '文件过滤' })
  await filter.fill('.md')
  const first = page.locator('.file-tree-row.file').filter({ hasText: /^📄1.md$/ })
  await first.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await page.locator('.file-tree-row.file').filter({ hasText: /^📄10.md$/ }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.file-tree-row.file.multi-selected')).toHaveCount(3)
  await filter.fill('')
  await mode(page, '文件类型')
  expect(await rows(page).allTextContents()).toEqual(['folder2', 'folder10', 'z.markdown', '1.md', '2.md', '10.md'])
  expect(await electronApp.evaluate(() => (globalThis as any).sortCalls.length)).toBe(0)
  await mode(page, '修改时间')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', 'z.markdown', '10.md', '2.md', '1.md'])
  let dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('asc')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.markdown'])
  await dialog.press('Escape')
  await mode(page, '大小')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', '10.md', '2.md', 'z.markdown'])
  dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('asc')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', 'z.markdown', '2.md', '10.md', '1.md'])
  await dialog.getByRole('button', { name: '恢复默认排序' }).click()
  await expect(rows(page)).toHaveText(['folder10', 'folder2', '1.md', '10.md', '2.md', 'z.markdown'])
  expect(readFileSync(join(root, '1.md'), 'utf8')).toBe('# ' + 'x'.repeat(30))
})

test('目录树排序：设置共用、双窗口同步、深浅色窄侧栏及键盘关闭', async ({ electronApp, page, testDir }, testInfo) => {
  const root = await fixture(electronApp, page, testDir)
  await page.locator('.nav-settings-btn').click()
  await page.getByRole('tab', { name: '浏览', exact: true }).click()
  await page.getByRole('combobox', { name: '排序依据', exact: true }).selectOption('natural')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.markdown'])
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('sort-settings-light.png') })
  await page.locator('.settings-header .close-btn').click()
  await page.evaluate(() => window.api.newWindow())
  const second = await expect.poll(() => electronApp.windows().length).toBe(2).then(() => electronApp.windows()[1])
  await second.waitForSelector('.app')
  await second.evaluate(filePath => window.api.testOpenMarkdownFile?.(filePath), join(root, '1.md'))
  const secondDialog = await openSort(second)
  await secondDialog.getByRole('radio', { name: '名称（现有规则）', exact: true }).check()
  await secondDialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc')
  await secondDialog.press('Escape')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', 'z.markdown', '2.md', '10.md', '1.md'])
  await page.emulateMedia({ colorScheme: 'light' })
  let dialog = await openSort(page)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('sort-menu-light.png') })
  await dialog.press('Escape')
  await expect(page.getByRole('button', { name: /^目录树排序：/ })).toBeFocused()
  const windowId = await page.evaluate(() => window.api.getWindowId())
  await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id!)?.setBounds({ width: 800, height: 720 }), windowId)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(800)
  const handle = await page.locator('.resize-handle').boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 30)
  await page.mouse.down()
  await page.mouse.move(140, handle!.y + 30)
  await page.mouse.up()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '180px')
  await page.emulateMedia({ colorScheme: 'dark' })
  dialog = await openSort(page)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('sort-menu-dark-narrow.png') })
})

test('目录树排序：折叠目录参与汇总、修改属性更新、故障可重试', async ({ electronApp, page, testDir }) => {
  await instrument(electronApp)
  const root = await fixture(electronApp, page, testDir)
  for (const name of ['folder10', 'folder2']) await page.locator('.file-tree-row.directory').filter({ hasText: name }).click()
  await mode(page, '修改时间')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', 'z.markdown', '10.md', '2.md', '1.md'])
  const calls = await electronApp.evaluate(() => (globalThis as any).sortCalls as string[][])
  expect(calls.flat()).toHaveLength(6)
  expect(calls.flat()).toEqual(expect.arrayContaining(['folder2/child.md', 'folder10/child.md']))
  await page.locator('.file-tree-row.directory').filter({ hasText: 'folder2' }).click()
  expect(await electronApp.evaluate(() => (globalThis as any).sortCalls.length)).toBe(calls.length)
  writeFileSync(join(root, '1.md'), '# recently modified fixture')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', 'z.markdown', '10.md', '2.md'])
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    let failed = false
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', (event: unknown, paths: string[], operation: unknown) => {
      if (!failed) { failed = true; throw new Error('fixture failure') }
      return original(event, paths, operation)
    })
  })
  writeFileSync(join(root, 'folder10', 'child.md'), '# changed while collapsed')
  await expect(page.getByRole('button', { name: '重试属性读取' })).toBeVisible()
  await expect(rows(page)).toHaveCount(6)
  await page.getByRole('button', { name: '重试属性读取' }).click()
  await expect(page.getByRole('button', { name: '重试属性读取' })).toHaveCount(0)
  await expect(rows(page)).toHaveText(['folder10', 'folder2', '1.md', 'z.markdown', '10.md', '2.md'])
})

test('目录树排序：独立配置真实重启保留排序而不改其他设置', async ({ testDir }) => {
  const profile = join(testDir, 'sort-profile')
  mkdirSync(profile)
  writeFileSync(join(profile, 'app-data.json'), JSON.stringify({ settings: { maxRecentFiles: 500, folderPinyinSearchEnabled: true } }))
  const launch = async () => {
    const app = await electron.launch({ args: [`--user-data-dir=${profile}`, join(process.cwd(), 'out/main/index.js')], env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'logs') } })
    const page = await app.firstWindow()
    await page.waitForSelector('.app')
    return { app, page }
  }
  let running = await launch()
  try { await running.page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'size', direction: 'asc' } })) } finally { await running.app.close() }
  running = await launch()
  try {
    expect(await running.page.evaluate(() => window.api.getFileTreeSort())).toMatchObject({ value: { by: 'size', direction: 'asc' } })
    expect(await running.page.evaluate(() => window.api.getAppSettings())).toMatchObject({ maxRecentFiles: 500, folderPinyinSearchEnabled: true })
  } finally { await running.app.close() }
})


test('目录树排序：属性迟到不串根，读取中可切名称，单选键盘连续切换', async ({ electronApp, page, testDir }) => {
  await fixture(electronApp, page, testDir)
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    let first = true
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      const result = await original(event, paths, operation)
      if (first) {
        first = false
        await new Promise<void>(resolve => { (globalThis as any).releaseSortMetadata = resolve })
      }
      return result
    })
  })
  await mode(page, '修改时间')
  await expect(page.locator('.file-tree-sort-status')).toContainText('正在读取文档属性')
  await mode(page, '名称（自然数字）')
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  const next = join(testDir, 'next-root')
  mkdirSync(next)
  writeFileSync(join(next, 'new.md'), '# New root')
  await openFolderViaIPC(electronApp, next)
  await electronApp.evaluate(() => (globalThis as any).releaseSortMetadata())
  await expect(rows(page)).toHaveText(['new.md'])
  await mode(page, '大小')
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  await expect(rows(page)).toHaveText(['new.md'])
  const dialog = await openSort(page)
  await dialog.getByRole('button', { name: '恢复默认排序' }).click()
  const current = dialog.getByRole('radio', { name: '名称（现有规则）', exact: true })
  await current.focus()
  await current.press('ArrowDown')
  const natural = dialog.getByRole('radio', { name: '名称（自然数字）', exact: true })
  await expect(natural).toBeChecked()
  await expect(natural).toBeFocused()
  await natural.press('ArrowDown')
  await expect(dialog.getByRole('radio', { name: '文件类型', exact: true })).toBeChecked()
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
})


test('目录树排序：重命名、拖放及Shift选择期间延迟重排，结束可靠恢复', async ({ electronApp, page, testDir }) => {
  const root = await fixture(electronApp, page, testDir)
  const rootPaths = () => page.locator('.file-tree > .file-tree-item > .file-tree-row').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-file-path')))
  const before = await rootPaths()
  const windowId = await page.evaluate(() => window.api.getWindowId())
  await electronApp.evaluate(({ BrowserWindow }, args) => BrowserWindow.fromId(args.id!)?.webContents.send('file:start-rename', args.path), { id: windowId, path: join(root, '1.md') })
  const input = page.locator('.file-name-input')
  await expect(input).toBeFocused()
  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'natural', direction: 'asc' } }))
  await expect(page.getByRole('button', { name: /目录树排序：名称（自然数字）/ })).toBeVisible()
  expect(await rootPaths()).toEqual(before)
  await input.press('Escape')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.markdown'])
  const source = page.locator('.file-tree-row.file').filter({ hasText: /^📄1.md$/ })
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer: transfer })
  await expect(page.locator('.file-tree-root-drop')).toBeVisible()
  const dragging = await rootPaths()
  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'natural', direction: 'desc' } }))
  await expect(page.getByRole('button', { name: /目录树排序：名称（自然数字），名称降序/ })).toBeVisible()
  expect(await rootPaths()).toEqual(dragging)
  await source.dispatchEvent('dragend', { dataTransfer: transfer })
  await expect(rows(page)).toHaveText(['folder10', 'folder2', 'z.markdown', '10.md', '2.md', '1.md'])
  await source.focus()
  await page.keyboard.down('Shift')
  const selecting = await rootPaths()
  await page.evaluate(() => window.api.updateAppSettings({ fileTreeSort: { by: 'natural', direction: 'asc' } }))
  await expect(page.getByRole('button', { name: /目录树排序：名称（自然数字），名称升序/ })).toBeVisible()
  expect(await rootPaths()).toEqual(selecting)
  await page.keyboard.up('Shift')
  await expect(rows(page)).toHaveText(['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.markdown'])
  expect(readFileSync(join(root, '1.md'), 'utf8')).toBe('# ' + 'x'.repeat(30))
})


test('目录树排序：属性请求中收起再展开侧栏，不叠加批次或永久失败', async ({ electronApp, page, testDir }) => {
  await fixture(electronApp, page, testDir)
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    ;(globalThis as any).pendingSortCalls = 0
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      const call = ++(globalThis as any).pendingSortCalls
      const result = await original(event, paths, operation)
      if (call === 1) await new Promise<void>(resolve => { (globalThis as any).releaseSidebarSort = resolve })
      return result
    })
  })
  await mode(page, '修改时间')
  await expect.poll(() => electronApp.evaluate(() => typeof (globalThis as any).releaseSidebarSort)).toBe('function')
  await page.getByRole('button', { name: '隐藏文件树', exact: true }).click()
  await page.getByRole('button', { name: '显示文件树', exact: true }).click()
  await expect(page.locator('.file-tree-sort-status')).toContainText('正在读取文档属性')
  expect(await electronApp.evaluate(() => (globalThis as any).pendingSortCalls)).toBe(1)
  await electronApp.evaluate(() => (globalThis as any).releaseSidebarSort())
  await expect(rows(page)).toHaveText(['folder2', 'folder10', 'z.markdown', '10.md', '2.md', '1.md'])
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  expect(await electronApp.evaluate(() => (globalThis as any).pendingSortCalls)).toBe(2)
})


test('目录树排序：显式属性排序完成后保留原本可见的活动文档', async ({ electronApp, page, testDir }) => {
  const root = join(testDir, 'scroll-anchor')
  mkdirSync(root)
  for (let index = 0; index < 120; index++) {
    const name = `${String(index).padStart(3, '0')}.md`
    writeFileSync(join(root, name), '# fixture')
    utimesSync(join(root, name), 1000 + index, 1000 + index)
  }
  await openFolderViaIPC(electronApp, root)
  const selected = page.locator('.file-tree-row.file.selected')
  await expect(selected).toContainText('000.md')
  await expect(selected).toBeInViewport()
  await mode(page, '修改时间')
  await expect(rows(page).first()).toHaveText('119.md')
  await expect(selected).toContainText('000.md')
  await expect(selected).toBeInViewport()
})

test('目录树排序：快捷浮层十种视觉状态紧凑，焦点与详细说明分层', async ({ electronApp, page, testDir }, testInfo) => {
  await fixture(electronApp, page, testDir)
  const windowId = await page.evaluate(() => window.api.getWindowId())
  await electronApp.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.fromId(id!)?.setBounds({ width: 800, height: 720 })
    return true
  }, windowId)
  const handle = await page.locator('.resize-handle').boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 30)
  await page.mouse.down()
  await page.mouse.move(140, handle!.y + 30)
  await page.mouse.up()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '180px')
  const measurements: unknown[] = []
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    for (const [key, label] of [['name', '名称（现有规则）'], ['natural', '名称（自然数字）'], ['type', '文件类型'], ['modified', '修改时间'], ['size', '大小']]) {
      const dialog = await openSort(page)
      const radio = dialog.getByRole('radio', { name: label, exact: true })
      await radio.check()
      await expect(radio).toBeEnabled()
      await dialog.locator('strong').click()
      const measurement = await dialog.evaluate(node => {
        const rect = node.getBoundingClientRect()
        return { height: rect.height, width: rect.width, x: rect.x, bottom: rect.bottom,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
          outlineStyle: getComputedStyle(node).outlineStyle, outlineWidth: getComputedStyle(node).outlineWidth }
      })
      measurements.push({ theme, key, ...measurement })
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`compact-${theme}-${key}.png`) })
      expect.soft(measurement.height).toBeLessThanOrEqual(360)
      expect.soft(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth)
      expect.soft(measurement.x).toBeGreaterThanOrEqual(12)
      expect.soft(measurement.x + measurement.width).toBeLessThanOrEqual(measurement.viewportWidth - 12)
      expect.soft(measurement.bottom).toBeLessThanOrEqual(measurement.viewportHeight - 12)
      expect.soft(measurement.outlineStyle).toBe('none')
      await expect.soft(dialog).not.toContainText('同步盘可能稍慢')
      expect.soft(await dialog.getAttribute('tabindex')).toBeNull()
      await expect(dialog.getByRole('group', { name: '排序依据', exact: true })).toBeVisible()
      await page.keyboard.press('Tab')
      await radio.focus()
      await expect(radio).toBeFocused()
      await expect(radio).toHaveCSS('outline-style', 'solid')
      await dialog.press('Escape')
      await expect(page.getByRole('button', { name: /^目录树排序：/ })).toBeFocused()
    }
  }
  writeFileSync(testInfo.outputPath('compact-measurements.json'), JSON.stringify(measurements, null, 2))
  await page.locator('.nav-settings-btn').click()
  await page.getByRole('tab', { name: '浏览', exact: true }).click()
  await expect(page.locator('.settings-panel')).toContainText('同步盘可能稍慢')
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact-settings-details.png') })
})


test('目录树排序：多层文件夹与文件按汇总属性排序，过滤和磁盘变更不歪曲统计', async ({ electronApp, page, testDir }, testInfo) => {
  const root = join(testDir, 'folder-totals')
  const put = (name: string, size: number, mtime: number) => {
    const target = join(root, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, '#' + 'x'.repeat(size))
    utimesSync(target, mtime, mtime)
  }
  put('A/keep.md', 80, 100)
  put('A/anchor.md', 1, 90)
  put('B/keep.md', 1, 200)
  put('B/extra.md', 9, 250)
  put('B/inner-a/child.md', 1, 300)
  put('B/inner-z/first.md', 120, 400)
  put('B/inner-z/second.md', 3, 450)
  put('root-one.md', 3, 150)
  put('root-two.md', 6, 250)
  put('B/not-in-tree.csv', 5000, 9000)
  await instrument(electronApp)
  await openFolderViaIPC(electronApp, root)
  const row = (name: string) => page.locator(`.file-tree-row[data-file-path=${JSON.stringify(join(root, name))}]`)
  const children = (name: string) => row(name).locator('..').locator(':scope > .file-tree-children > .file-tree-item > .file-tree-row .file-name')
  for (const name of ['A', 'B']) if (await row(name).getAttribute('aria-expanded') === 'true') await row(name).click()
  await expect(rows(page)).toHaveText(['A', 'B', 'root-one.md', 'root-two.md'])
  await mode(page, '大小')
  await expect(rows(page)).toHaveText(['B', 'A', 'root-two.md', 'root-one.md'])
  const requested = await electronApp.evaluate(() => (globalThis as any).sortCalls.flat() as string[])
  expect(requested).toHaveLength(9)
  expect(new Set(requested).size).toBe(9)
  expect(requested.some(name => name.endsWith('.csv'))).toBe(false)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('folder-size-collapsed.png') })
  await row('B').click()
  await expect(children('B')).toHaveText(['inner-z', 'inner-a', 'extra.md', 'keep.md'])
  if (await row('B/inner-z').getAttribute('aria-expanded') !== 'true') await row('B/inner-z').click()
  await expect(children('B/inner-z')).toHaveText(['first.md', 'second.md'])
  let dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('asc')
  await dialog.press('Escape')
  await expect(rows(page)).toHaveText(['A', 'B', 'root-one.md', 'root-two.md'])
  await expect(children('B')).toHaveText(['inner-a', 'inner-z', 'keep.md', 'extra.md'])
  await expect(children('B/inner-z')).toHaveText(['second.md', 'first.md'])
  dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc')
  await dialog.press('Escape')
  const filter = page.getByRole('textbox', { name: '文件过滤' })
  await filter.fill('keep')
  await expect(rows(page)).toHaveText(['B', 'A'])
  expect(await electronApp.evaluate(() => (globalThis as any).sortCalls.flat().length)).toBe(9)
  await filter.fill('')
  await mode(page, '修改时间')
  await expect(rows(page)).toHaveText(['B', 'A', 'root-two.md', 'root-one.md'])
  dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('asc')
  await dialog.press('Escape')
  await expect(rows(page)).toHaveText(['A', 'B', 'root-one.md', 'root-two.md'])
  dialog = await openSort(page)
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc')
  await dialog.press('Escape')
  utimesSync(join(root, 'A/keep.md'), 500, 500)
  await expect(rows(page)).toHaveText(['A', 'B', 'root-two.md', 'root-one.md'])
  put('A/keep.md', 200, 500)
  await mode(page, '大小')
  await expect(rows(page)).toHaveText(['A', 'B', 'root-two.md', 'root-one.md'])
  put('B/added.md', 300, 600)
  await expect(rows(page)).toHaveText(['B', 'A', 'root-two.md', 'root-one.md'])
  unlinkSync(join(root, 'B/added.md'))
  await expect(rows(page)).toHaveText(['A', 'B', 'root-two.md', 'root-one.md'])
  renameSync(join(root, 'A/keep.md'), join(root, 'B/moved.md'))
  await expect(rows(page)).toHaveText(['B', 'A', 'root-two.md', 'root-one.md'])
  await expect(row('A/keep.md')).toHaveCount(0)
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('folder-totals-updated.png') })
  await mode(page, '名称（自然数字）')
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    let fail = true
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      const result = await original(event, paths, operation)
      if (!fail || !paths.includes('B/moved.md')) return result
      fail = false
      return result.map((entry: { relativePath: string }) => entry.relativePath === 'B/moved.md' ? { ...entry, value: null } : entry)
    })
  })
  await mode(page, '大小')
  await expect(page.locator('.file-tree-sort-status')).toContainText('相关文件夹无法完整统计')
  await expect(rows(page)).toHaveText(['A', 'B', 'root-two.md', 'root-one.md'])
  await page.getByRole('button', { name: '重试属性读取' }).click()
  await expect(rows(page)).toHaveText(['B', 'A', 'root-two.md', 'root-one.md'])
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
})

test('目录树排序：汇总等待只保留顺序，新增和删除节点立即可见', async ({ electronApp, page, testDir }) => {
  const root = join(testDir, 'pending-tree')
  mkdirSync(root)
  writeFileSync(join(root, 'a.md'), '# small')
  writeFileSync(join(root, 'z.md'), '#' + 'z'.repeat(100))
  await openFolderViaIPC(electronApp, root)
  await mode(page, '大小')
  await expect(rows(page)).toHaveText(['z.md', 'a.md'])
  await electronApp.evaluate(({ ipcMain }) => {
    const ipc = ipcMain as any
    const original = ipc._invokeHandlers.get('fs:fileTreeMetadata')
    let first = true
    ipc.removeHandler('fs:fileTreeMetadata')
    ipc.handle('fs:fileTreeMetadata', async (event: unknown, paths: string[], operation: unknown) => {
      const result = await original(event, paths, operation)
      if (first) {
        first = false
        await new Promise<void>(resolve => { (globalThis as any).releaseTotals = resolve })
      }
      return result
    })
  })
  writeFileSync(join(root, 'z.md'), '# changed')
  await expect.poll(() => electronApp.evaluate(() => typeof (globalThis as any).releaseTotals)).toBe('function')
  unlinkSync(join(root, 'a.md'))
  writeFileSync(join(root, 'b.md'), '#' + 'b'.repeat(200))
  await expect(rows(page)).toHaveText(['z.md', 'b.md'])
  await expect(page.locator('.file-tree-sort-status')).toContainText('正在读取文档属性')
  await electronApp.evaluate(() => (globalThis as any).releaseTotals())
  await expect(rows(page)).toHaveText(['b.md', 'z.md'])
  await expect(page.locator('.file-tree-sort-status')).toHaveCount(0)
})
