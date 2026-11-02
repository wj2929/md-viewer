import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ElectronApplication, Page } from '@playwright/test'

async function crossRootFixture(electronApp: ElectronApplication, page: Page, testDir: string) {
  const owned = join(testDir, 'owned'), external = join(testDir, 'external')
  mkdirSync(owned); mkdirSync(external)
  writeFileSync(join(owned, 'A.md'), '# Owned A\n\n[到外部B](../external/B.md)\n\n[[../external/B.md|Wiki B]]\n\n[[../external/query.sql|Wiki SQL]]')
  writeFileSync(join(external, 'B.md'), '# External B\n\n[立即到C](./C.md)\n\n[SQL](./query.sql)\n\n[无后缀](./README)\n\n[HTML](./unsafe.html)\n\n![[./C.md]]')
  writeFileSync(join(external, 'C.md'), '# External C\n\nC正文')
  writeFileSync(join(external, 'query.sql'), 'SELECT 9007199254740993123;\r\n-- 只读，不连接数据库')
  writeFileSync(join(external, 'README'), '无后缀的纯文本')
  writeFileSync(join(external, 'unsafe.html'), '<script>window.linkedTextExecuted=true</script>')
  await openFolderViaIPC(electronApp, owned)
  await page.locator('.file-tree-row.file', { hasText: 'A.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Owned A')
  return { owned, external, b: join(external, 'B.md') }
}

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('未授权目录 A→B→C 首次连续点击、关闭来源tab再返回、窄权限与不执行文本', async ({ electronApp, page, testDir }, testInfo) => {
  const { owned, external, b } = await crossRootFixture(electronApp, page, testDir)
  const before = digest(b)
  await page.getByRole('link', { name: '到外部B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  await expect(page.locator('.tab.active')).toContainText('外部只读 · 临时')
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', /重启或跨窗口转移不携带/)
  await expect(page.locator('.nav-folder-path')).toHaveAttribute('title', owned)
  await expect(page.locator('.file-tree-row', { hasText: 'B.md' })).toHaveCount(0)
  await expect(page.locator('.markdown-body')).not.toContainText('C正文')
  const rootOnly = await page.evaluate(async () => {
    const boot = await window.api.getWorkspaceBootstrap()
    const host = boot.workspaces.find(item => item.id === boot.activeWorkspaceId)!
    return window.api.prepareLinkedDocument({
      operation: { workspaceId: host.id, lifecycleEpoch: host.lifecycleEpoch },
      source: { filePath: `${host.primaryRoot}/A.md` }, href: '../external/C.md',
      leafId: 'root-only-fixture', requestId: 'root-only-fixture', rootOnly: true,
    })
  })
  expect(rootOnly).toEqual({ success: false, code: 'unavailable' })
  await page.screenshot({ path: testInfo.outputPath('external-readonly-light.png') })
  // 第一帧正文已具备提交凭据，无后台激活等待。
  await page.getByRole('link', { name: '立即到C', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External C')
  await page.getByRole('button', { name: '关闭 B.md', exact: true }).click()
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  const boundaries = await page.evaluate(async ({ b, external }) => {
    const denied = async (action: () => Promise<unknown>) => { try { await action(); return false } catch { return true } }
    const operation = (await window.api.getWorkspaceBootstrap()).workspaces.find(workspace => workspace.primaryRoot)?.id
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === operation)!
    return {
      read: await denied(() => window.api.readFile(b)),
      directory: await denied(() => window.api.readDir(external)),
      edit: await denied(() => window.api.openEditableMarkdown(b, { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch })),
    }
  }, { b, external })
  expect(boundaries).toEqual({ read: true, directory: true, edit: true })
  await page.getByRole('link', { name: 'SQL', exact: true }).click()
  const text = page.getByRole('textbox', { name: '只读附件文本' })
  await expect(text).toHaveAttribute('aria-readonly', 'true')
  await expect(text).toContainText('SELECT 9007199254740993123;')
  await expect(page.getByRole('button', { name: '用系统应用打开', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('external-sql.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('link', { name: 'HTML', exact: true }).click()
  await expect(text).toContainText('<script>window.linkedTextExecuted=true</script>')
  expect(await page.evaluate(() => (window as any).linkedTextExecuted)).toBeUndefined()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  expect(digest(b)).toBe(before)
  await page.locator('.link-origin-floating').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Owned A')
})

test('明确 Wiki SQL、未知文本须显式动作、精确 Finder 及关闭后撤销', async ({ electronApp, page, testDir }, testInfo) => {
  const { external } = await crossRootFixture(electronApp, page, testDir)
  await electronApp.evaluate(({ shell }) => {
    ;(globalThis as any).__linkedReveals = []
    shell.showItemInFolder = path => { (globalThis as any).__linkedReveals.push(path) }
  })
  await page.getByRole('link', { name: 'Wiki SQL', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toContainText('SELECT')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('link', { name: 'Wiki B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  await page.getByRole('link', { name: '无后缀', exact: true }).click()
  await expect(page.getByRole('button', { name: '按文本查看', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toHaveCount(0)
  await page.getByRole('button', { name: '按文本查看', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '只读附件文本' })).toContainText('无后缀的纯文本')
  await page.getByRole('button', { name: /在.*中显示/ }).click()
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__linkedReveals)).toEqual([join(external, 'README')])
  await page.screenshot({ path: testInfo.outputPath('explicit-text.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('link', { name: '无后缀', exact: true })).toBeFocused()
})

test('外部文档允许 atomic replace 后手动刷新；编辑、导出、书签快捷键不绕过只读', async ({ electronApp, page, testDir }, testInfo) => {
  const { b, external } = await crossRootFixture(electronApp, page, testDir)
  await page.getByRole('link', { name: '到外部B', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External B')
  writeFileSync(join(external, 'replacement.tmp'), '# Refreshed B\n\n[继续到C](./C.md)')
  renameSync(join(external, 'replacement.tmp'), b)
  await electronApp.evaluate(({ BrowserWindow }, b) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.send('markdown:quick-edit', { filePath: b, mode: 'document' })
    contents.send('shortcut:export-html')
    contents.send('shortcut:add-bookmark')
  }, b)
  await expect(page.locator('.markdown-editor-pane')).toHaveCount(0)
  await expect(page.locator('.toast-container')).toContainText(/只读|临时/)
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('shortcut:refresh'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Refreshed B')
  await page.getByRole('link', { name: '继续到C', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('External C')
  await page.screenshot({ path: testInfo.outputPath('external-refresh.png') })
})
