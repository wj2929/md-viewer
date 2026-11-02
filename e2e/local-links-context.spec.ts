import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

async function setup(electronApp: any, page: any, testDir: string, source = '# Root A\n\n[B](./B.md)\n\n[JSON](./data.json)') {
  writeFileSync(join(testDir, 'A.md'), source)
  writeFileSync(join(testDir, 'B.md'), '# Target B\n\n[C](./C.md)')
  writeFileSync(join(testDir, 'C.md'), '# Target C')
  writeFileSync(join(testDir, 'data.json'), '{"value":"只读内容"}')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550) // test:openMarkdownFile在500ms后发送显式打开事件，先耗尽fixture事件。
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
}

test('初次分屏迁移原leaf来源，双方独立返回且退出分屏保留实际链', async ({ electronApp, page, testDir }, testInfo) => {
  await setup(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.send('file:open-in-split', { filePath, direction: 'horizontal' })
  }, join(testDir, 'A.md'))
  const panels = page.locator('.split-leaf-panel')
  await expect(panels).toHaveCount(2)
  const left = panels.nth(0), right = panels.nth(1)
  await expect(left.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(left.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await expect(right.locator('.link-origin-floating')).toHaveCount(0)
  await right.getByRole('link', { name: 'B', exact: true }).click()
  await expect(right.locator('.markdown-body h1')).toHaveText('Target B')
  await left.getByRole('link', { name: 'C', exact: true }).click()
  await expect(left.locator('.markdown-body h1')).toHaveText('Target C')
  await expect(left.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：B.md')
  await expect(right.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(right.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await page.screenshot({ path: testInfo.outputPath('split-independent.png') })
  await left.locator('.link-origin-floating').click()
  await expect(left.locator('.markdown-body h1')).toHaveText('Target B')
  await right.locator('.link-origin-floating').click()
  await expect(right.locator('.markdown-body h1')).toHaveText('Root A')
  await expect(left.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await right.locator('button[title="关闭面板"]').click()
  await expect(panels).toHaveCount(1)
  await expect(panels.locator('.markdown-body h1')).toHaveText('Target B')
  await panels.locator('button[title="关闭面板"]').click()
  await expect(panels).toHaveCount(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
})

test('引用式及Wiki重复链接定位正文使用处，用户主动滚动停止后续校正', async ({ electronApp, page, testDir }) => {
  await setup(electronApp, page, testDir, [
    '# Root A', '[第一引用][b]', '', ...Array.from({ length: 45 }, (_, n) => `前段 ${n}\n`),
    '## 中段', '[第二引用][b]', '', '[[B|第一Wiki]]', '', ...Array.from({ length: 35 }, (_, n) => `中段 ${n}\n`),
    '## 后段', '[[B|第二Wiki]]', '', ...Array.from({ length: 35 }, (_, n) => `尾段 ${n}\n`), '[b]: ./B.md',
  ].join('\n'))
  for (const name of ['第二引用', '第二Wiki']) {
    const link = page.getByRole('link', { name, exact: true })
    await link.scrollIntoViewIfNeeded()
    const offset = await link.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top)
    await link.click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
    await page.locator('.link-origin-floating').click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
    await expect.poll(async () => Math.abs(await link.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
    await page.locator('.preview').evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
      node.scrollTop = 0
    })
    await page.waitForTimeout(600)
    expect(await page.locator('.preview').evaluate(node => node.scrollTop)).toBe(0)
  }
})

test('大文档返回不自动放行，显式完整渲染后恢复原链接', async ({ electronApp, page, testDir }) => {
  const source = ['# Root A', '', '<!--', ...Array.from({ length: 20_001 }, () => 'fixture comment'), '-->', '',
    ...Array.from({ length: 30 }, (_, n) => `段落 ${n}\n`), '## 链接章节', '[B](./B.md)', '',
    ...Array.from({ length: 30 }, (_, n) => `末段 ${n}\n`)].join('\n')
  await setupLarge()
  async function setupLarge() {
    writeFileSync(join(testDir, 'A.md'), source)
    writeFileSync(join(testDir, 'B.md'), '# Target B')
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  }
  await expect(page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
  await expect(page.locator('.markdown-body')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /记住此文档/ })).not.toBeChecked()
  await page.getByRole('button', { name: '完整渲染', exact: true }).click()
  const link = page.getByRole('link', { name: 'B', exact: true })
  await link.scrollIntoViewIfNeeded()
  const offset = await link.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top)
  await link.click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await page.locator('.link-origin-floating').click()
  await expect(page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
  await expect(page.locator('.markdown-body')).toHaveCount(0)
  await page.getByRole('button', { name: '完整渲染', exact: true }).click()
  await expect.poll(async () => Math.abs(await link.evaluate(node => node.getBoundingClientRect().top - node.closest('.preview')!.getBoundingClientRect().top) - offset)).toBeLessThan(3)
})

test('历史根MD及明确附件可点击读取，名称Wiki缺owner仍拒绝且不切工作区', async ({ electronApp, page, testDir }) => {
  const host = join(testDir, 'host'), foreign = join(testDir, 'foreign')
  mkdirSync(host); mkdirSync(foreign)
  const external = join(foreign, 'B.md'), local = join(host, 'A.md')
  writeFileSync(local, '# Root A\n\n[外根MD](../foreign/B.md)')
  writeFileSync(external, '# Target B\n\n[附件](./data.json)\n\n[[C|Wiki目标]]')
  writeFileSync(join(foreign, 'data.json'), '{"private":"fixture"}')
  writeFileSync(join(foreign, 'C.md'), '# Foreign C')
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), external)
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await page.waitForTimeout(550)
  const boot = await page.evaluate(() => window.api.getWorkspaceBootstrap())
  const foreignWorkspace = boot.activeWorkspaceId!
  await page.evaluate(() => window.api.createWorkspace())
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), local)
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
  await page.waitForTimeout(550)
  const hostWorkspace = (await page.evaluate(() => window.api.getWorkspaceBootstrap())).activeWorkspaceId
  await page.evaluate(id => window.api.closeWorkspace(id), foreignWorkspace)
  await page.getByRole('link', { name: '外根MD', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await page.getByRole('link', { name: '附件', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toContainText('fixture')
  await expect(page.getByRole('button', { name: '用系统应用打开', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭附件' }).click()
  await page.getByRole('link', { name: 'Wiki目标', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  expect((await page.evaluate(() => window.api.getWorkspaceBootstrap())).activeWorkspaceId).toBe(hostWorkspace)
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Root A')
})

test('深色800px原生窗口附件无横溢出，关闭查找不退出全文阅读', async ({ electronApp, page, testDir }, testInfo) => {
  await setup(electronApp, page, testDir)
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 800) })
  await page.getByRole('radio', { name: '暗色主题' }).click()
  expect(await page.evaluate(() => innerWidth)).toBe(800)
  await page.getByRole('link', { name: 'JSON', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('attachment-dark-native-800.png') })
  await page.getByRole('button', { name: '关闭附件' }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F11' : 'F11')
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
  await page.getByRole('link', { name: 'JSON', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox', { name: '只读附件文本' })).toBeVisible()
  await dialog.getByRole('button', { name: /查找/ }).click()
  await dialog.locator('input[name="search"]').press('Escape')
  await expect(dialog.locator('.cm-search')).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('attachment-dark-fullscreen.png') })
  await dialog.getByRole('button', { name: '关闭附件' }).click()
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
})
