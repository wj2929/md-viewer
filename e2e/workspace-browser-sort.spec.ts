import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

const browserPanel = (page: Page) => page.getByRole('complementary', { name: '工作区文件' })
const browserRows = (page: Page) => browserPanel(page).locator('.browser-tree > [role="treeitem"] > .browser-entry > span:last-child')
const treeRows = (page: Page) => page.locator('.file-tree > .file-tree-item > .file-tree-row .file-name')

async function browserFixture(app: ElectronApplication, page: Page, dir: string, extra = 0) {
  const root = join(dir, 'browser-sorting')
  for (const name of ['folder10', 'folder2']) {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'child.md'), '# Synthetic child')
  }
  for (const [name, size, time] of [['1.md', 30, 1000], ['10.md', 20, 3000], ['2.md', 10, 2000], ['z.csv', 5, 4000]] as const) {
    writeFileSync(join(root, name), '# ' + 'x'.repeat(size))
    utimesSync(join(root, name), time, time)
  }
  for (let index = 0; index < extra; index++) writeFileSync(join(root, `file-${index}.txt`), 'synthetic')
  utimesSync(join(root, 'folder2'), 1000, 1000)
  utimesSync(join(root, 'folder10'), 3000, 3000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await openFolderViaIPC(app, root)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browserRows(page).first()).toBeVisible()
  return root
}

async function browserMode(page: Page, name: string, direction: 'asc' | 'desc') {
  const browser = browserPanel(page)
  await browser.getByLabel('工作区文件操作').click()
  const radio = browser.getByRole('radio', { name, exact: true })
  await expect(radio).toBeEnabled()
  await radio.check()
  await expect(radio).toBeEnabled()
  const order = browser.getByRole('combobox', { name: '排序方向', exact: true })
  await order.selectOption(direction)
  await expect(order).toBeEnabled()
  await browser.press('Escape')
}

test('工作区排序：五种规则双向、目录属性口径与左树独立，明暗窄窗菜单不裁切', async ({ electronApp, page, testDir }, info) => {
  await browserFixture(electronApp, page, testDir)
  const originalTree = await treeRows(page).allTextContents()
  const cases: Array<[string, string[], string[]]> = [
    ['名称（现有规则）', ['folder10', 'folder2', '1.md', '10.md', '2.md', 'z.csv'], ['folder2', 'folder10', 'z.csv', '2.md', '10.md', '1.md']],
    ['名称（自然数字）', ['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.csv'], ['folder10', 'folder2', 'z.csv', '10.md', '2.md', '1.md']],
    ['文件类型', ['folder2', 'folder10', 'z.csv', '1.md', '2.md', '10.md'], ['folder10', 'folder2', '1.md', '2.md', '10.md', 'z.csv']],
    ['修改时间', ['folder2', 'folder10', '1.md', '2.md', '10.md', 'z.csv'], ['folder10', 'folder2', 'z.csv', '10.md', '2.md', '1.md']],
    ['大小', ['folder2', 'folder10', 'z.csv', '2.md', '10.md', '1.md'], ['folder2', 'folder10', '1.md', '10.md', '2.md', 'z.csv']],
  ]
  for (const [label, ascending, descending] of cases) {
    await browserMode(page, label, 'asc')
    await expect(browserRows(page)).toHaveText(ascending)
    await browserMode(page, label, 'desc')
    await expect(browserRows(page)).toHaveText(descending)
    await expect(treeRows(page)).toHaveText(originalTree)
  }
  const browser = browserPanel(page)
  await browser.getByLabel('工作区文件操作').click()
  await expect(browser.getByText('仅文件按大小排序，文件夹按名称排列')).toBeVisible()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ path: info.outputPath('browser-sort-wide-light.png'), animations: 'disabled' })
  await browser.press('Escape')
  const before = await browser.locator('.browser-root').boundingBox()
  await browser.getByLabel('工作区文件操作').click()
  expect((await browser.locator('.browser-root').boundingBox())!.y).toBe(before!.y)
  await browser.press('Escape')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(780, 650))
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await browser.getByLabel('工作区文件操作').click()
  const menu = browser.locator('.browser-options')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: info.outputPath('browser-sort-narrow-dark.png'), animations: 'disabled' })
  await browser.getByRole('button', { name: '恢复默认排序', exact: true }).click()
  await expect(browserRows(page)).toHaveText(cases[0][1])
})

test('工作区排序：全量排序后分页，刷新、过滤、切工作区保留偏好', async ({ electronApp, page, testDir }) => {
  const root = await browserFixture(electronApp, page, testDir, 230)
  await browserMode(page, '名称（自然数字）', 'desc')
  const browser = browserPanel(page)
  await expect(browser.getByRole('button', { name: 'file-229.txt', exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'file-0.txt', exact: true })).toHaveCount(0)
  await browser.getByRole('button', { name: /显示更多/ }).click()
  await expect(browser.getByRole('button', { name: 'file-0.txt', exact: true })).toBeVisible()
  await browser.getByRole('textbox', { name: '过滤已加载项' }).fill('file-2')
  const filtered = await browserRows(page).allTextContents()
  expect(filtered[0]).toBe('file-229.txt')
  await browser.getByLabel('工作区文件操作').click()
  await browser.getByRole('button', { name: '刷新工作区文件', exact: true }).click()
  await expect(browserRows(page)).toHaveText(filtered)
  await browser.getByRole('textbox', { name: '过滤已加载项' }).fill('')
  await expect(browser.getByRole('button', { name: 'file-0.txt', exact: true })).toBeVisible()
  const second = join(testDir, 'second-workspace')
  mkdirSync(second)
  writeFileSync(join(second, '2.md'), '# Two')
  writeFileSync(join(second, '10.md'), '# Ten')
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(second, '2.md'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Two')
  if (!(await browser.isVisible())) await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  await expect(browserRows(page)).toHaveText(['10.md', '2.md'])
  expect(await page.evaluate(() => window.api.getBrowserSort())).toMatchObject({ value: { by: 'natural', direction: 'desc' } })
  expect(await page.evaluate(() => window.api.getFileTreeSort())).toMatchObject({ value: { by: 'name', direction: 'asc' } })
  expect(root).not.toBe(second)
})

test('工作区排序：独立临时应用双窗口同步及真实重启保留两份独立偏好', async ({ testDir }) => {
  const profile = join(testDir, 'browser-sort-profile')
  mkdirSync(profile)
  writeFileSync(join(profile, 'app-data.json'), JSON.stringify({ settings: { maxRecentFiles: 500, fileTreeSort: { by: 'type', direction: 'asc' } } }))
  const launch = async () => {
    const app = await electron.launch({ args: [`--user-data-dir=${profile}`, join(process.cwd(), 'out/main/index.js')], env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'logs') } })
    const page = await app.firstWindow()
    await page.waitForSelector('.app')
    return { app, page }
  }
  let running = await launch()
  try {
    const root = await browserFixture(running.app, running.page, testDir)
    await running.page.evaluate(() => window.api.newWindow())
    await expect.poll(() => running.app.windows().length).toBe(2)
    const second = running.app.windows()[1]
    await second.waitForSelector('.app')
    await second.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(root, '1.md'))
    await second.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
    await running.page.evaluate(() => window.api.updateAppSettings({ browserSort: { by: 'size', direction: 'asc' } }))
    for (const page of [running.page, second]) await expect(browserRows(page)).toHaveText(['folder2', 'folder10', 'z.csv', '2.md', '10.md', '1.md'])
    await expect.poll(() => second.evaluate(() => window.api.getBrowserSort())).toMatchObject({ value: { by: 'size', direction: 'asc' } })
    await second.evaluate(() => window.api.updateAppSettings({ browserSort: { by: 'modified', direction: 'desc' } }))
    for (const page of [running.page, second]) await expect(browserRows(page)).toHaveText(['folder10', 'folder2', 'z.csv', '10.md', '2.md', '1.md'])
    await expect.poll(() => running.page.evaluate(() => window.api.getBrowserSort())).toMatchObject({ value: { by: 'modified', direction: 'desc' } })
    expect(await running.page.evaluate(() => window.api.getFileTreeSort())).toMatchObject({ value: { by: 'type', direction: 'asc' } })
  } finally { await running.app.close() }
  running = await launch()
  try {
    expect(await running.page.evaluate(() => window.api.getBrowserSort())).toMatchObject({ value: { by: 'modified', direction: 'desc' } })
    expect(await running.page.evaluate(() => window.api.getAppSettings())).toMatchObject({ maxRecentFiles: 500, fileTreeSort: { by: 'type', direction: 'asc' } })
  } finally { await running.app.close() }
})
