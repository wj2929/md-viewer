import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs'

async function openSource(electronApp: any, page: any, testDir: string) {
  writeFileSync(join(testDir, 'A.md'), '# Source A\n\n[B](./B.md)')
  writeFileSync(join(testDir, 'B.md'), '# Target B\n\n[C](./C.md)')
  writeFileSync(join(testDir, 'C.md'), '# Target C')
  await openFolderViaIPC(electronApp, testDir)
  await page.waitForTimeout(550) // 等待测试专用的延迟open-specific-file事件，不让它混入被测导航。
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
}

test('源码工作台全文阅读在对照和仅编辑模式都有唯一可用来源入口', async ({ electronApp, page, testDir }, testInfo) => {
  await openSource(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' })
  }, join(testDir, 'B.md'))
  await expect(page.locator('.markdown-edit-workbench')).toBeVisible()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F11' : 'F11')
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
  await expect(page.locator('.link-origin-header')).toHaveCount(0)
  await expect(page.locator('.link-origin-workbench')).toHaveCount(0)
  await expect(page.locator('.link-origin-floating')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workbench-compare-fullscreen.png') })
  await testInfo.attach('fullscreen-layout', { body: JSON.stringify(await page.evaluate(() => ['.content-area', '.preview-container', '.markdown-edit-workbench', '.markdown-workbench-toolbar'].map(selector => { const node = document.querySelector(selector)!; const rect = node.getBoundingClientRect(); const css = getComputedStyle(node); return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: css.display, flex: css.flex, inlineSize: css.inlineSize }; }))), contentType: 'application/json' })
  await page.getByRole('tab', { name: '仅编辑', exact: true }).click()
  await expect(page.locator('.markdown-body')).toHaveCount(0)
  await expect(page.locator('.link-origin-floating')).toHaveCount(0)
  await expect(page.locator('.link-origin-workbench')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.app')).not.toHaveClass(/fullscreen/)
  await testInfo.attach('native-fullscreen-after-escape', { body: JSON.stringify(await page.evaluate(() => window.api.isFullScreen())), contentType: 'application/json' })
  await expect.poll(() => page.evaluate(() => window.api.isFullScreen())).toBe(false)
  await expect(page.locator('.link-origin-workbench')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workbench-source-normal.png') })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F11' : 'F11')
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
  await page.screenshot({ path: testInfo.outputPath('workbench-source-fullscreen.png') })
  await page.locator('.link-origin-workbench').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
  await expect(page.locator('.link-origin-workbench')).toHaveCount(0)
})

test('对照预览浮动来源入口可实际返回，且不复制工具区入口', async ({ electronApp, page, testDir }, testInfo) => {
  await openSource(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => {
    BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' })
  }, join(testDir, 'B.md'))
  await expect(page.locator('.markdown-edit-workbench')).toBeVisible()
  await expect(page.locator('.link-origin-workbench')).toHaveCount(0)
  const button = page.locator('.markdown-workbench-preview-pane .link-origin-floating')
  await expect(button).toBeVisible()
  await expect(button).toHaveText('↶返回')
  await page.screenshot({ path: testInfo.outputPath('workbench-compare-normal.png') })
  await button.click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
  await expect(page.locator('.link-origin-floating')).toHaveCount(0)
  await expect(page.locator('.tab', { hasText: 'B.md' })).toBeVisible()
})

test('来源标签关闭可重开；来源缺失失败不移动当前文档或游标', async ({ electronApp, page, testDir }) => {
  await openSource(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await page.getByRole('button', { name: '关闭 A.md', exact: true }).click()
  await expect(page.locator('.tab', { hasText: 'A.md' })).toHaveCount(0)
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Source A')
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  unlinkSync(join(testDir, 'A.md'))
  await page.evaluate(() => {
    ;(window as any).__returnFixtureToasts = []
    new MutationObserver(() => {
      const messages = [...document.querySelectorAll('.toast')].map(node => node.textContent)
      ;(window as any).__returnFixtureToasts.push(...messages)
    }).observe(document.body, { childList: true, subtree: true })
  })
  await page.locator('.link-origin-floating').click()
  try { await expect(page.getByText('无法返回来源：文件不存在、不可读取或属于受保护路径。', { exact: true })).toBeVisible() }
  finally { console.log('return-fixture-toasts', await page.evaluate(() => (window as any).__returnFixtureToasts)) }
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
})

test('同文件多窗口来源不共享，另一窗口直接打开仍无来源', async ({ electronApp, page, testDir }) => {
  await openSource(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await page.evaluate(() => window.api.newWindow())
  await expect.poll(() => electronApp.windows().length).toBe(2)
  const other = electronApp.windows()[1]
  await other.waitForSelector('.app')
  await other.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(testDir, 'B.md'))
  await other.waitForTimeout(550)
  await expect(other.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(other.locator('.link-origin-floating')).toHaveCount(0)
  await other.getByRole('link', { name: 'C', exact: true }).click()
  await expect(other.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：B.md')
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
})

test('切走工作区再切回恢复私有来源链，显式文件树进入清除旧绑定', async ({ electronApp, page, testDir }) => {
  await openSource(electronApp, page, testDir)
  await page.getByRole('link', { name: 'B', exact: true }).click()
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  const workspace = (await page.evaluate(() => window.api.getWorkspaceBootstrap())).activeWorkspaceId!
  const alternate = join(testDir, 'alternate')
  mkdirSync(alternate)
  writeFileSync(join(alternate, 'D.md'), '# Another Workspace')
  await page.evaluate(() => window.api.createWorkspace())
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(alternate, 'D.md'))
  await page.waitForTimeout(550)
  await expect(page.locator('.markdown-body h1')).toHaveText('Another Workspace')
  await expect(page.locator('.link-origin-floating')).toHaveCount(0)
  // 经实际工作区菜单切回，不能只改main registry而漏掉renderer hydration。
  await page.locator('.workspace-switcher-trigger').click()
  await page.locator('.workspace-switcher-menu [role="menuitemradio"]:not(.active)').filter({ hasText: testDir.split('/').at(-1)! }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Target B')
  expect((await page.evaluate(() => window.api.getWorkspaceBootstrap())).activeWorkspaceId).toBe(workspace)
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await page.locator('.file-tree-row.file', { hasText: 'B.md' }).click()
  await expect(page.locator('.link-origin-floating')).toHaveCount(0)
  await page.locator('.tab', { hasText: 'A.md' }).click()
  await expect(page.locator('.link-origin-floating')).toHaveCount(0)
})
