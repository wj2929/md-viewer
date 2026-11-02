import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

async function setup(app: ElectronApplication, page: Page, dir: string) {
  const root = join(dir, 'owned'), external = join(dir, 'external')
  mkdirSync(root); mkdirSync(external)
  writeFileSync(join(root, 'A.md'), '# Owned A\n\n[外部B](../external/B.md)')
  writeFileSync(join(external, 'B.md'), '# External B\n\n[外部C](./C.md)\n\n[SQL](./query.sql)')
  writeFileSync(join(external, 'C.md'), '# External C')
  writeFileSync(join(external, 'query.sql'), 'SELECT 9007199254740993123;')
  await openFolderViaIPC(app, root)
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Owned A')
  return { root, external }
}

async function enterExternal(page: Page) {
  await page.getByRole('link', { name: '外部B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
}

async function switchToOwned(page: Page) {
  await page.locator('.workspace-switcher-trigger').click()
  await page.locator('.workspace-switcher-menu [role="menuitemradio"]:not(.active)').filter({ hasText: 'owned' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
}

test('外部临时tab切工作区返回安全重读，原来源链与文件树不丢失', async ({ electronApp, page, testDir }, info) => {
  const { external } = await setup(electronApp, page, testDir)
  await enterExternal(page)
  const alternate = join(testDir, 'alternate')
  mkdirSync(alternate); writeFileSync(join(alternate, 'D.md'), '# Alternate D')
  await page.evaluate(() => window.api.createWorkspace())
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(alternate, 'D.md'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Alternate D')
  await page.waitForTimeout(550) // 耗尽测试入口延迟的显式打开事件。
  writeFileSync(join(external, 'B.md'), '# External B\n\n切回的新正文\n\n[外部C](./C.md)')
  await switchToOwned(page)
  await expect(page.locator('.markdown-body')).toContainText('切回的新正文')
  await expect(page.locator('.link-origin-floating')).toHaveAttribute('aria-label', '返回来源：A.md')
  await expect(page.locator('.file-tree-row', { hasText: 'B.md' })).toHaveCount(0)
  await page.getByRole('link', { name: '外部C', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External C')
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  await page.screenshot({ path: info.outputPath('external-workspace-return.png') })
})

test('暗色窄窗口、全文阅读、分屏和已有工作台状态均不能打开外部编辑器', async ({ electronApp, page, testDir }, info) => {
  const { root } = await setup(electronApp, page, testDir)
  await enterExternal(page)
  await page.locator('.tab', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Owned A')
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('markdown:quick-edit', { filePath, mode: 'document' }), join(root, 'A.md'))
  await expect(page.locator('.markdown-edit-workbench')).toBeVisible()
  await page.getByRole('tab', { name: '仅编辑', exact: true }).click()
  await expect(page.locator('.markdown-body')).toHaveCount(0)
  await page.getByRole('tab', { name: '对照预览', exact: true }).click()
  await expect(page.locator('.markdown-workbench-preview-pane')).toBeVisible()
  await page.locator('.tab', { hasText: 'B.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  await expect(page.locator('.markdown-editor-pane')).toHaveCount(0)
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 800))
  await page.getByRole('radio', { name: '暗色主题' }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F11' : 'F11')
  await expect(page.locator('.app')).toHaveClass(/fullscreen/)
  await page.getByRole('link', { name: 'SQL', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /查找/ }).click()
  await dialog.locator('input[name="search"]').fill('9007199')
  await dialog.locator('input[name="search"]').press('Escape')
  await expect(dialog.locator('.cm-search')).toHaveCount(0)
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('external-dark-fullscreen-sql.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.app')).not.toHaveClass(/fullscreen/)
  await expect.poll(() => page.evaluate(() => window.api.isFullScreen())).toBe(false)
  await electronApp.evaluate(({ BrowserWindow }, filePath) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-in-split', { filePath, direction: 'horizontal' }), join(root, 'A.md'))
  const panels = page.locator('.split-leaf-panel')
  await expect(panels).toHaveCount(2)
  await expect(panels.nth(0).locator('.markdown-body h1')).toHaveText('External B')
  await panels.nth(0).getByRole('link', { name: '外部C', exact: true }).click()
  await expect(panels.nth(0).locator('.markdown-body h1')).toHaveText('External C')
  await panels.nth(0).locator('.link-origin-floating').click()
  await expect(panels.nth(0).locator('.markdown-body h1')).toHaveText('External B')
  await page.screenshot({ path: info.outputPath('external-dark-split.png') })
})

test('整工作区转移只跳过外部tab，根内tab可转移且active/leaf引用完整', async ({ electronApp, page, testDir }, info) => {
  const { root } = await setup(electronApp, page, testDir)
  await enterExternal(page)
  const retained = join(testDir, 'retained')
  mkdirSync(retained); writeFileSync(join(retained, 'D.md'), '# Retained D')
  await page.evaluate(() => window.api.createWorkspace())
  await page.evaluate(file => window.api.testOpenMarkdownFile?.(file), join(retained, 'D.md'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Retained D')
  await page.waitForTimeout(550)
  await switchToOwned(page)
  const sourceId = await page.evaluate(() => window.api.getWindowId())
  await page.locator('.workspace-switcher-trigger').click()
  await page.getByRole('menuitem', { name: '将当前工作区拆分为新窗口' }).click()
  await expect.poll(() => electronApp.windows().length).toBe(2)
  await expect.poll(async () => {
    const ids = await Promise.all(electronApp.windows().map(window => window.evaluate(() => window.api.getWindowId())))
    return ids.some(id => id !== sourceId)
  }).toBe(true)
  const target = (await Promise.all(electronApp.windows().map(async window => ({
    page: window, id: await window.evaluate(() => window.api.getWindowId()),
  })))).find(window => window.id !== sourceId)!.page
  await expect(target.locator('.markdown-body h1')).toHaveText('Owned A')
  await expect(target.locator('.tab', { hasText: 'B.md' })).toHaveCount(0)
  await expect(target.locator('.link-origin-floating')).toHaveCount(0)
  await expect(target.locator('.nav-folder-path')).toHaveAttribute('title', root)
  await target.screenshot({ path: info.outputPath('external-skipped-transfer.png') })
  await enterExternal(target)
  await expect(target.locator('.tab.active')).toContainText('外部只读 · 临时')
})

test('独立profile真实重启不恢复外部路径正文凭据或悬空split引用', async ({ testDir }, info) => {
  const profile = join(testDir, 'restart-profile')
  mkdirSync(profile)
  let app: ElectronApplication | undefined
  const launch = async (skip: boolean) => {
    const executable = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
    app = await electron.launch({
      ...(executable ? { executablePath: executable } : {}),
      args: [`--user-data-dir=${profile}`, ...(executable ? [] : [join(process.cwd(), 'out/main/index.js')])],
      env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: skip ? '1' : '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') },
    })
    const page = await app.firstWindow()
    await page.locator('.app').waitFor()
    return page
  }
  try {
    const page = await launch(true)
    await setup(app!, page, testDir)
    await enterExternal(page)
    await expect.poll(() => {
      try { return JSON.parse(readFileSync(join(profile, 'workspace-session.json'), 'utf8')).desktopSession?.windows?.[0]?.workspaces?.[0]?.tabs?.length }
      catch { return undefined }
    }).toBe(1)
    await app!.close(); app = undefined
    const saved = JSON.parse(readFileSync(join(profile, 'workspace-session.json'), 'utf8'))
    const session = saved.desktopSession
    expect(JSON.stringify(saved)).not.toMatch(/external|External B|documentId|batchId|linkedReadOnly/)
    for (const window of session.windows) for (const workspace of window.workspaces) {
      expect(workspace.tabs.map((tab: any) => tab.relativePath)).toEqual(['A.md'])
      expect(workspace.tabs.some((tab: any) => tab.id === workspace.activeTabId)).toBe(true)
    }
    await info.attach('persisted-fixture-session', { body: JSON.stringify(saved, null, 2), contentType: 'application/json' })
    const restarted = await launch(false)
    await expect(restarted.locator('.markdown-body h1')).toHaveText('Owned A')
    await expect(restarted.locator('.tab', { hasText: 'B.md' })).toHaveCount(0)
    await expect(restarted.locator('.link-origin-floating')).toHaveCount(0)
    await restarted.screenshot({ path: info.outputPath('external-filtered-restart.png') })
    await app!.evaluate(({ ipcMain }) => {
      const calls: unknown[] = []
      ;(globalThis as any).__linkedFixtureCalls = calls
      for (const name of ['linkRead:prepareDocument', 'linkRead:commitDocument', 'linkRead:cancel']) {
        const original = (ipcMain as any)._invokeHandlers.get(name)
        if (!original) throw new Error(`Missing handler: ${name}`)
        ipcMain.removeHandler(name)
        ipcMain.handle(name, async (event, ...args) => {
          const result = await original(event, ...args)
          calls.push({ name, args, result })
          return result
        })
      }
    })
    try { await enterExternal(restarted) }
    finally {
      const data = { calls: await app!.evaluate(() => (globalThis as any).__linkedFixtureCalls),
        text: await restarted.evaluate(() => document.body.innerText) }
      await info.attach('restart-click-fixture-observation', { body: JSON.stringify(data, null, 2), contentType: 'application/json' })
      console.log('restart-click-fixture-observation', JSON.stringify(data))
    }
  } finally { await app?.close() }
})
