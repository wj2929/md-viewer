import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('工作区菜单排版：最窄栏、宽栏、暗色抽屉与短窗口分组紧凑且不溢出', async ({ electronApp, page, testDir }, info) => {
  const root = join(testDir, 'menu-layout')
  mkdirSync(join(root, 'folder'), { recursive: true })
  writeFileSync(join(root, 'note.md'), '# Synthetic layout fixture')
  writeFileSync(join(root, '.hidden.md'), '# Hidden fixture')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
  await openFolderViaIPC(electronApp, root)
  await page.getByRole('button', { name: '浏览工作区文件', exact: true }).click()
  const browser = page.getByRole('complementary', { name: '工作区文件' })
  const trigger = browser.getByLabel('工作区文件操作')
  const menu = browser.locator('.browser-options')
  const resize = async (width: number) => {
    const panel = (await browser.boundingBox())!
    const handle = (await page.getByRole('separator', { name: '调整工作区文件栏宽度' }).boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 80)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + width - panel.width, handle.y + 80, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await browser.boundingBox())!.width)).toBe(width)
  }
  const checkLayout = async (name: string) => {
    await expect(menu).toBeVisible()
    const box = (await menu.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(280)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    expect(await menu.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const controls = (await menu.locator('.file-tree-sort-controls').boundingBox())!
    expect(Math.abs(box.x + box.width - 13 - controls.x - controls.width)).toBeLessThan(1)
    const heading = (await menu.locator('.browser-sort-heading strong').boundingBox())!
    const reset = (await browser.getByRole('button', { name: '恢复默认排序' }).boundingBox())!
    expect(Math.abs(heading.y + heading.height / 2 - reset.y - reset.height / 2)).toBeLessThan(2)
    const refresh = (await browser.getByRole('button', { name: '刷新工作区文件' }).boundingBox())!
    const collapse = (await browser.getByRole('button', { name: '折叠全部' }).boundingBox())!
    expect(Math.abs(refresh.y - collapse.y)).toBeLessThan(1)
    expect(Math.abs(refresh.width - collapse.width)).toBeLessThan(1)
    const field = (await menu.locator('.file-tree-sort-field').boundingBox())!
    const select = (await browser.getByRole('combobox', { name: '排序方向' }).boundingBox())!
    expect(select.x + select.width).toBeLessThanOrEqual(field.x + field.width + 1)
    await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await resize(420)
  await trigger.click()
  await checkLayout('menu-wide-light')
  await browser.press('Escape')
  await expect(menu).not.toBeVisible()
  await resize(220)
  await trigger.click()
  await checkLayout('menu-minimum-light')
  const size = browser.getByRole('radio', { name: '大小', exact: true })
  await size.check()
  await expect(size).toBeEnabled()
  await expect(browser.getByText('仅文件按大小排序，文件夹按名称排列')).toBeVisible()
  await expect(browser.getByText('属性不可读的项排在同组末尾，不递归扫描')).toBeVisible()
  await checkLayout('menu-minimum-size-light')
  await browser.press('Escape')
  await resize(280)
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(780, 600))
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await expect(browser).toHaveClass(/browser-drawer/)
  await trigger.click()
  await checkLayout('menu-drawer-size-dark')
  const lastAction = (await browser.getByRole('button', { name: '折叠全部' }).boundingBox())!
  const menuBox = (await menu.boundingBox())!
  expect(lastAction.y + lastAction.height).toBeLessThanOrEqual(menuBox.y + menuBox.height - 8)
  await browser.getByRole('checkbox', { name: '显示隐藏文件' }).check()
  await browser.press('Escape')
  await expect(browser.getByRole('button', { name: '.hidden.md', exact: true })).toBeVisible()
  await trigger.click()
  const reset = browser.getByRole('button', { name: '恢复默认排序' })
  await reset.focus()
  await reset.press('Enter')
  await expect(reset).toBeDisabled()
  await expect(browser.getByRole('radio', { name: '名称（现有规则）' })).toBeChecked()
  await checkLayout('menu-drawer-default-dark')
  await browser.getByRole('button', { name: '刷新工作区文件' }).click()
  await expect(menu).not.toBeVisible()
  await expect(browser.getByRole('button', { name: '.hidden.md', exact: true })).toBeVisible()
})
