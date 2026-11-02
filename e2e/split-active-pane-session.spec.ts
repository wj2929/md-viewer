import { test, expect, _electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DesktopSessionV1, DesktopSessionWorkspace } from '../src/main/workspaceSessionStore'
import type { TabSessionNode } from '../src/shared/tabSessionReferences'

function fixture() {
  const base = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'split-focus-'))
  const docs = join(root, 'documents')
  const profile = mkdtempSync(join(tmpdir(), 'md-viewer-split-focus-'))
  mkdirSync(docs)
  writeFileSync(join(docs, 'a.md'), '# Document A\n\nIndependent focus fixture A.')
  writeFileSync(join(docs, 'b.md'), '# Document B\n\nIndependent focus fixture B.')
  return { root, docs, profile }
}

async function launch(profile: string) {
  const executablePath = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [`--user-data-dir=${profile}`, ...(executablePath ? [] : [join(__dirname, '../out/main/index.js')])],
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_SKIP_RESTORE: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.app')).toBeVisible()
  return { app, page }
}

async function normalQuit(app: ElectronApplication) {
  const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve()))
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 30); return true })
  await exited
}

function stored(profile: string) {
  const desktop = JSON.parse(readFileSync(join(profile, 'workspace-session.json'), 'utf8')).desktopSession as DesktopSessionV1 | null
  const workspace = desktop?.windows[0]?.workspaces[0]
  if (!workspace) return null
  const names = new Map(workspace.tabs.map(tab => [tab.id, tab.relativePath]))
  const state = workspace.splitState as { root: TabSessionNode | null; activeLeafId: string }
  const leaves: Array<{ id: string; document: string | undefined }> = []
  const visit = (node: TabSessionNode | null) => {
    if (!node) return
    if (node.type === 'leaf') leaves.push({ id: node.id, document: names.get(node.tabId) })
    else { visit(node.first); visit(node.second) }
  }
  visit(state.root)
  return { activeDocument: names.get(workspace.activeTabId ?? ''), activeLeafId: state.activeLeafId,
    tabs: workspace.tabs.map(tab => ({ document: tab.relativePath, pinned: Boolean(tab.isPinned) })), leaves, root: state.root }
}

for (const direction of ['向右分屏', '向下分屏']) {
  test(`非活动面板${direction}同时更新活动标签，真实重启保留新叶子`, async ({}, info) => {
    const f = fixture()
    let app: ElectronApplication | null = null
    try {
      let running = await launch(f.profile)
      app = running.app
      const page = running.page
      await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(f.docs, 'a.md'))
      await expect(page.locator('.markdown-body h1')).toHaveText('Document A')
      await page.locator('.file-tree-row.file', { hasText: 'b.md' }).click()
      await expect(page.locator('.markdown-body h1')).toHaveText('Document B')
      await page.locator('.tab .tab-name', { hasText: 'a.md' }).click()
      await page.keyboard.press('Control+\\')
      await expect(page.locator('.split-leaf-panel .markdown-body h1')).toHaveText(['Document A', 'Document B'])
      await page.locator('.split-leaf-panel').nth(1).getByTitle(direction, { exact: true }).click()
      await expect(page.locator('.split-leaf-panel')).toHaveCount(3)
      await expect(page.locator('.split-leaf-panel').nth(2)).toHaveClass(/active/)
      await expect(page.locator('.tab.active .tab-name'), 'New pane and active tab must refer to the same document').toHaveText('b.md')
      const leafId = await page.locator('.split-leaf-panel.active').getAttribute('data-leaf-id')
      await expect.poll(() => stored(f.profile)?.activeLeafId).toBe(leafId)
      await expect.poll(() => stored(f.profile)?.activeDocument).toBe('b.md')
      const before = stored(f.profile)!
      await page.screenshot({ path: info.outputPath('before-quit.png'), animations: 'disabled' })
      await normalQuit(app)
      app = null
      expect(stored(f.profile)).toEqual(before)
      running = await launch(f.profile)
      app = running.app
      await expect(running.page.locator('.split-leaf-panel .markdown-body h1')).toHaveText(['Document A', 'Document B', 'Document B'])
      await expect(running.page.locator('.split-leaf-panel').nth(2)).toHaveClass(/active/)
      await expect(running.page.locator('.split-leaf-panel.active')).toHaveAttribute('data-leaf-id', leafId!)
      await expect.poll(() => stored(f.profile)).toEqual(before)
      await info.attach('before-and-after-restart', { body: JSON.stringify({ before, after: stored(f.profile) }), contentType: 'application/json' })
      await running.page.screenshot({ path: info.outputPath('after-restart.png'), animations: 'disabled' })
    } finally {
      if (app) await app.close()
      rmSync(f.root, { recursive: true, force: true })
      rmSync(f.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  })
}

const cases = ['valid-last-leaf', 'legacy-conflicting-tab', 'first-leaf', 'missing-leaf', 'split-node-id', 'pruned-tab', 'duplicate-id'] as const
for (const mode of cases) {
  test(`桌面恢复保留有效活动叶子并安全回退：${mode}`, async ({}, info) => {
    const f = fixture()
    let app: ElectronApplication | null = null
    try {
      const tabs = [{ id: 'tab-a', relativePath: 'a.md', isPinned: true }, { id: 'tab-b', relativePath: 'b.md' }]
      const root: TabSessionNode = { type: 'split', id: 'split-root', direction: 'horizontal', ratio: 0.43,
        first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
        second: { type: 'split', id: 'split-right', direction: 'vertical', ratio: 0.62,
          first: { type: 'leaf', id: 'leaf-b1', tabId: 'tab-b' }, second: { type: 'leaf', id: 'leaf-b2', tabId: 'tab-b' } } }
      let activeLeafId = 'leaf-b2'
      const fallback = !['valid-last-leaf', 'legacy-conflicting-tab'].includes(mode)
      const expectedLeafId = fallback ? 'leaf-a' : 'leaf-b2'
      if (mode === 'first-leaf') activeLeafId = 'leaf-a'
      if (mode === 'missing-leaf') activeLeafId = 'nonexistent'
      if (mode === 'split-node-id') activeLeafId = 'split-right'
      if (mode === 'pruned-tab' && root.second.type === 'split') {
        tabs.push({ id: 'unsafe-tab', relativePath: '../outside.md' })
        root.second.second = { type: 'leaf', id: 'leaf-b2', tabId: 'unsafe-tab' }
        writeFileSync(join(f.root, 'outside.md'), '# Outside authorized root')
      }
      if (mode === 'duplicate-id' && root.second.type === 'split') {
        root.second.second = { type: 'leaf', id: 'leaf-a', tabId: 'tab-b' }
        activeLeafId = 'leaf-a'
      }
      const workspace: DesktopSessionWorkspace = { id: 'fixture-workspace', name: 'Fixture', primaryRoot: f.docs, tabs,
        activeTabId: mode === 'valid-last-leaf' ? 'tab-b' : 'tab-a', splitState: { root, activeLeafId } }
      const desktopSession: DesktopSessionV1 = { version: 1, lastActiveWindowId: 'fixture-window', windows: [{ id: 'fixture-window',
        bounds: { x: 20, y: 60, width: 1400, height: 900 }, isMaximized: false, alwaysOnTop: false, activeWorkspaceId: workspace.id, workspaces: [workspace] }] }
      writeFileSync(join(f.profile, 'workspace-session.json'), JSON.stringify({ desktopSession, windowLifecycleV1Migrated: true }))
      const running = await launch(f.profile)
      app = running.app
      const expectedDocuments = mode === 'pruned-tab' || mode === 'duplicate-id' ? ['Document A', 'Document B'] : ['Document A', 'Document B', 'Document B']
      await expect(running.page.locator('.split-leaf-panel .markdown-body h1')).toHaveText(expectedDocuments)
      await expect(running.page.locator('.split-leaf-panel.active')).toHaveAttribute('data-leaf-id', expectedLeafId)
      const expectedDocument = fallback ? 'a.md' : 'b.md'
      await expect(running.page.locator('.tab.active .tab-name')).toHaveText(expectedDocument)
      await expect.poll(() => stored(f.profile)?.activeLeafId).toBe(expectedLeafId)
      await expect.poll(() => stored(f.profile)?.activeDocument).toBe(expectedDocument)
      await expect.poll(() => stored(f.profile)?.tabs).toEqual([{ document: 'a.md', pinned: true }, { document: 'b.md', pinned: false }])
      await expect.poll(() => stored(f.profile)?.leaves.map(leaf => leaf.document)).toEqual(expectedDocuments.map(name => name === 'Document A' ? 'a.md' : 'b.md'))
      const after = stored(f.profile)!
      if (mode !== 'pruned-tab' && mode !== 'duplicate-id') expect(after.root).toEqual(root)
      expect(after.leaves.map(leaf => leaf.document)).toEqual(expectedDocuments.map(name => name === 'Document A' ? 'a.md' : 'b.md'))
      await info.attach('restored-reference-check', { body: JSON.stringify({ mode, inputActiveTabId: workspace.activeTabId, inputActiveLeafId: activeLeafId, after }), contentType: 'application/json' })
      await running.page.screenshot({ path: info.outputPath('restored-pane.png'), animations: 'disabled' })
    } finally {
      if (app) await app.close()
      rmSync(f.root, { recursive: true, force: true })
      rmSync(f.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  })
}
