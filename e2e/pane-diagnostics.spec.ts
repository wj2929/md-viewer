import { test, expect, _electron, type ElectronApplication } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function fixture(twoWorkspaces = false) {
  const parent = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'pane-trace-'))
  const profile = mkdtempSync(join(tmpdir(), 'md-viewer-pane-trace-'))
  const workspaces = ['one', ...(twoWorkspaces ? ['two'] : [])].map(name => {
    const docs = join(root, `private-documents-${name}`)
    mkdirSync(docs)
    for (const n of ['a', 'b', 'c']) writeFileSync(join(docs, `private-${n}.md`), `# Fixture ${n.toUpperCase()}\n\nSelf fixture content only.`)
    const id = `private-workspace-${name}`
    return { id, name: `Fixture ${name}`, primaryRoot: docs,
      tabs: ['a', 'b'].map(n => ({ id: `${id}-tab-${n}`, relativePath: `private-${n}.md` })),
      activeTabId: `${id}-tab-b`,
      splitState: { root: { type: 'split', id: `${id}-root`, direction: 'horizontal', ratio: 0.43,
        first: { type: 'leaf', id: `${id}-leaf-a`, tabId: `${id}-tab-a` },
        second: { type: 'split', id: `${id}-right`, direction: 'vertical', ratio: 0.62,
          first: { type: 'leaf', id: `${id}-leaf-b1`, tabId: `${id}-tab-b` },
          second: { type: 'leaf', id: `${id}-leaf-b2`, tabId: `${id}-tab-b` } } }, activeLeafId: `${id}-leaf-b1` } }
  })
  writeFileSync(join(profile, 'workspace-session.json'), JSON.stringify({ windowLifecycleV1Migrated: true,
    desktopSession: { version: 1, lastActiveWindowId: 'fixture-window', windows: [{ id: 'fixture-window',
      bounds: { x: 20, y: 60, width: 1200, height: 800 }, isMaximized: false, alwaysOnTop: false,
      activeWorkspaceId: workspaces[0].id, workspaces }] } }))
  return { root, profile }
}

async function launch(profile: string) {
  const executablePath = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [`--user-data-dir=${profile}`, ...(executablePath ? [] : [join(__dirname, '../out/main/index.js')])],
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_SKIP_RESTORE: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.split-leaf-panel .markdown-body h1')).toHaveText(['Fixture A', 'Fixture B', 'Fixture B'])
  return { app, page }
}

function logs(profile: string) {
  const text = readdirSync(join(profile, 'diagnostic-logs')).filter(name => name.endsWith('.jsonl'))
    .sort().map(name => readFileSync(join(profile, 'diagnostic-logs', name), 'utf8')).join('\n')
  const all = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { text, all, panes: all.filter(event => event.event === 'workspace.pane.change') }
}

async function finish(app: ElectronApplication | null, profile: string, output: string) {
  if (app) await app.close()
  cpSync(join(profile, 'diagnostic-logs'), output, { recursive: true })
}

test('面板日志区分合成点击、可信输入和标签同步，关联文件打开但不含文档信息', async ({}, info) => {
  const f = fixture()
  let app: ElectronApplication | null = null
  try {
    const running = await launch(f.profile); app = running.app
    const page = running.page
    const panels = page.locator('.split-leaf-panel')
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneAction === 'hydrate')).toBe(true)
    await panels.nth(0).evaluate(element => (element as HTMLElement).click())
    await expect(panels.nth(0)).toHaveClass(/active/)
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneAction === 'split'
      && e.metadata.paneSource === 'panel-click' && e.metadata.inputTrusted === false
      && e.metadata.beforeLeafPosition === 'root.second.first' && e.metadata.afterLeafPosition === 'root.first')).toBe(true)
    await panels.nth(2).locator('h1').click()
    await expect(panels.nth(2)).toHaveClass(/active/)
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneAction === 'split'
      && e.metadata.paneSource === 'panel-click' && e.metadata.inputTrusted === true
      && e.metadata.afterLeafPosition === 'root.second.second')).toBe(true)
    await page.locator('.tab .tab-name', { hasText: 'private-a.md' }).click()
    await expect(panels.nth(0)).toHaveClass(/active/)
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneSource === 'active-tab-sync'
      && e.metadata.beforeLeafPosition === 'root.second.second' && e.metadata.afterLeafPosition === 'root.first')).toBe(true)
    const chain = logs(f.profile).panes
    const sync = chain.findLast(e => e.metadata.paneSource === 'active-tab-sync')!
    const tab = chain.find(e => e.metadata.paneSequence === sync.metadata.lastTabChangeSequence)!
    expect(tab.metadata.paneSource).toBe('tab-click')
    expect(tab.metadata.workspaceTraceId).toBe(sync.metadata.workspaceTraceId)
    await page.locator('.file-tree-row.file', { hasText: 'private-c.md' }).click()
    await expect(panels.nth(0).locator('h1')).toHaveText('Fixture C')
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneSource === 'file-select' && e.operationId)).toBe(true)
    const opened = logs(f.profile).panes.findLast(e => e.metadata.paneSource === 'file-select')!
    await expect.poll(() => logs(f.profile).panes.some(e => e.metadata.paneSource === 'active-tab-sync'
      && e.operationId === opened.operationId && e.metadata.leafDocumentChanged)).toBe(true)
    expect(logs(f.profile).all.some(e => e.event === 'file.open.start' && e.operationId === opened.operationId)).toBe(true)
    const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
    expect(status.invalidEvents).toBe(0)
    for (const secret of [f.root, 'private-', 'Fixture A', 'Self fixture content only.']) expect(logs(f.profile).text).not.toContain(secret)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused(), fullscreen: w.isFullScreen() })))).toEqual([{ visible: false, focused: false, fullscreen: false }])
    await page.screenshot({ path: info.outputPath('pane-chain.png'), animations: 'disabled' })
    await info.attach('pane-events', { body: JSON.stringify(logs(f.profile).panes), contentType: 'application/json' })
  } finally {
    await finish(app, f.profile, info.outputPath('diagnostic-logs'))
    rmSync(f.root, { recursive: true, force: true })
    rmSync(f.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('工作区切换日志保持匿名关联并推进 hydration 代次，不串用上个工作区的标签序号', async ({}, info) => {
  const f = fixture(true)
  let app: ElectronApplication | null = null
  try {
    const running = await launch(f.profile); app = running.app
    const page = running.page
    await expect.poll(() => logs(f.profile).panes.filter(e => e.metadata.paneAction === 'hydrate').length).toBe(1)
    await page.locator('.workspace-switcher-trigger').click()
    await page.locator('[role="menuitemradio"][aria-checked="false"]').click()
    await expect(page.locator('.split-leaf-panel.active')).toHaveAttribute('data-leaf-id', 'private-workspace-two-leaf-b1')
    await expect.poll(() => logs(f.profile).panes.filter(e => e.metadata.paneAction === 'hydrate').length).toBe(2)
    await page.locator('.workspace-switcher-trigger').click()
    await page.locator('[role="menuitemradio"][aria-checked="false"]').click()
    await expect(page.locator('.split-leaf-panel.active')).toHaveAttribute('data-leaf-id', 'private-workspace-one-leaf-b1')
    await expect.poll(() => logs(f.profile).panes.filter(e => e.metadata.paneAction === 'hydrate').length).toBe(3)
    const events = logs(f.profile).panes
    const [first, second, third] = events.filter(e => e.metadata.paneAction === 'hydrate')
    expect(third.metadata.workspaceTraceId).toBe(first.metadata.workspaceTraceId)
    expect(second.metadata.workspaceTraceId).not.toBe(first.metadata.workspaceTraceId)
    expect(third.metadata.hydrationGeneration).toBe(first.metadata.hydrationGeneration + 2)
    for (const hydrate of [first, second, third]) expect(Number.isInteger(hydrate.metadata.workspaceEpoch)).toBe(true)
    const firstRestoreSplit = events.find(e => e.metadata.hydrationGeneration === third.metadata.hydrationGeneration
      && e.metadata.paneAction === 'split')!
    expect(firstRestoreSplit.metadata.paneSource).toBe('workspace-hydrate')
    for (const secret of [f.root, 'private-', 'Fixture one', 'Fixture two']) expect(logs(f.profile).text).not.toContain(secret)
    expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    await page.screenshot({ path: info.outputPath('workspace-return.png'), animations: 'disabled' })
    await info.attach('pane-events', { body: JSON.stringify(events), contentType: 'application/json' })
  } finally {
    await finish(app, f.profile, info.outputPath('diagnostic-logs'))
    rmSync(f.root, { recursive: true, force: true })
    rmSync(f.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
