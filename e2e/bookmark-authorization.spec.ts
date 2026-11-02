import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openFolderViaIPC } from './fixtures/electron'

type Fixture = { app: ElectronApplication; page: Page; root: string }

// Only synthetic documents and a fresh profile. Native confirmations must never be requested.
const test = base.extend<Fixture>({
  root: async ({}, use, info) => {
    const root = mkdtempSync('/Users/Shared/md-viewer-bookmark-')
    for (const dir of ['current', 'bookmarked', '.ssh', 'profile']) mkdirSync(join(root, dir))
    writeFileSync(join(root, 'current/current.md'), '# Current document\n\nKeep this tab.\n')
    writeFileSync(join(root, 'bookmarked/target.md'), '# Bookmark target\n\n## Saved heading\n\nRestored bookmark.\n')
    writeFileSync(join(root, '.ssh/secret.md'), '# Synthetic protected fixture\n')
    const target = info.title.includes('protected') ? join(root, '.ssh/secret.md') : join(root, 'bookmarked/target.md')
    writeFileSync(join(root, 'profile/app-data.json'), JSON.stringify({
      bookmarks: [{ id: 'synthetic-bookmark', filePath: target, fileName: 'target.md', title: 'Saved bookmark', headingId: 'saved-heading', createdAt: 1, order: 0 }],
      settings: { bookmarkBarCollapsed: false, bookmarkPanelCollapsed: true, sidebarCollapsed: false }
    }))
    await use(root)
    await info.attach('synthetic-fixture', { body: JSON.stringify({ root }), contentType: 'application/json' })
  },
  app: async ({ root }, use) => {
    const executablePath = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
    const app = await _electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [`--user-data-dir=${join(root, 'profile')}`, ...(executablePath ? [] : [join(__dirname, '../out/main/index.js')])],
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(root, 'logs') }
    })
    try { await use(app) } finally { await app.close() }
  },
  page: async ({ app, root }, use, info) => {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900))
    await page.waitForSelector('.app')
    await openFolderViaIPC(app, join(root, 'current'))
    await expect(page.locator('.markdown-body h1')).toHaveText('Current document')
    if (await page.locator('.tab-bar-bookmark-trigger').isVisible()) await page.locator('.tab-bar-bookmark-trigger').click()
    await expect(page.locator('.bookmark-bar-item')).toHaveCount(1)
    await app.evaluate(({ dialog }) => {
      ;(globalThis as any).bookmarkDialogCalls = 0
      dialog.showOpenDialog = (async () => {
        ;(globalThis as any).bookmarkDialogCalls++
        throw new Error('Unexpected directory confirmation')
      }) as typeof dialog.showOpenDialog
    })
    await use(page)
    await info.attach('bookmark-state', { body: JSON.stringify({
      headings: await page.locator('.markdown-body h1').allTextContents(),
      errors: await page.getByText(/无法打开书签/).allTextContents(),
      dialogCalls: await dialogCount(app),
      bookmarks: JSON.parse(readFileSync(join(root, 'profile/app-data.json'), 'utf8')).bookmarks
    }), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('bookmark-result.png') })
    await info.attach('bookmark-result', { path: info.outputPath('bookmark-result.png'), contentType: 'image/png' })
  }
})

async function dialogCount(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as any).bookmarkDialogCalls)
}

test('an existing bookmark opens directly without confirmation when its history root is missing', async ({ app, page, root }) => {
  const rawReadAllowed = await page.evaluate(async file => {
    try { await window.api.readFile(file); return true } catch { return false }
  }, join(root, 'bookmarked/target.md'))
  expect(rawReadAllowed).toBe(false)
  await page.locator('.bookmark-bar-item').click()
  await expect.poll(async () => await page.locator('.markdown-body h1').textContent() === 'Bookmark target' || await page.getByText(/无法打开书签/).count() > 0).toBe(true)
  expect(await dialogCount(app)).toBe(0)
  await expect(page.locator('.markdown-body h1')).toHaveText('Bookmark target')
  await expect(page.getByText(/无法打开书签/)).toHaveCount(0)
  const data = JSON.parse(readFileSync(join(root, 'profile/app-data.json'), 'utf8'))
  expect(data.bookmarks).toHaveLength(1)
  expect(data.bookmarks[0].headingId).toBe('saved-heading')
  expect(JSON.stringify(data.folderTabSessions)).toContain('current.md')
  await openFolderViaIPC(app, join(root, 'current'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Current document')
  await page.locator('.bookmark-bar-item').click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Bookmark target')
  expect(await dialogCount(app)).toBe(0)
})

test('a missing bookmark file reports the missing file without a confirmation dialog', async ({ app, page, root }) => {
  // Only this test's synthetic file is moved; no saved bookmark or history is deleted.
  const { renameSync } = await import('node:fs')
  renameSync(join(root, 'bookmarked/target.md'), join(root, 'bookmarked/moved.md'))
  await page.locator('.bookmark-bar-item').click()
  await expect(page.getByText(/书签文件不存在或已移动/)).toBeVisible()
  await expect(page.locator('.markdown-body h1')).toHaveText('Current document')
  await expect(page.locator('.bookmark-bar-item')).toHaveCount(1)
  expect(await dialogCount(app)).toBe(0)
})

test('a protected bookmark remains blocked without a confirmation dialog', async ({ app, page }) => {
  await page.locator('.bookmark-bar-item').click()
  await expect(page.getByText(/受保护的系统路径/)).toBeVisible()
  await expect(page.locator('.markdown-body h1')).toHaveText('Current document')
  await expect(page.locator('.bookmark-bar-item')).toHaveCount(1)
  expect(await dialogCount(app)).toBe(0)
})
