import { test, expect, _electron, type ElectronApplication } from '@playwright/test'
import { basename, join } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

function fixture() {
  const base = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'mdv-reading-restore-'))
  const docs = join(root, 'docs'), profile = mkdtempSync(join(tmpdir(), 'mdv-reading-profile-'))
  mkdirSync(docs)
  for (const name of ['a', 'b']) writeFileSync(join(docs, `${name}.md`), `# Document ${name.toUpperCase()}\n\n` + Array.from({ length: 350 }, (_, i) => `## Section ${i}\n\nFixture paragraph ${i}. ` + 'Local reading position sample. '.repeat(8)).join('\n\n'))
  return { docs, profile }
}
function positions(profile: string) {
  const data = JSON.parse(readFileSync(join(profile, 'app-data.json'), 'utf8'))
  return Object.fromEntries(Object.entries(data.readPositions ?? {}).map(([path, value]) => [basename(path), value])) as Record<string, { scrollRatio: number; headingId?: string; updatedAt: number }>
}
async function launch(profile: string) {
  const executablePath = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [`--user-data-dir=${profile}`, ...(executablePath ? [] : [join(__dirname, '../out/main/index.js')])],
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_SKIP_RESTORE: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') } })
  expect(realpathSync(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(realpathSync(profile))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.app')).toBeVisible()
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    visible: window.isVisible(), focused: window.isFocused(), fullscreen: window.isFullScreen(),
  })))).toEqual([{ visible: false, focused: false, fullscreen: false }])
  return { app, page }
}
async function quit(app: ElectronApplication) {
  const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve()))
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 30); return true })
  await exited
}
function seed(f: ReturnType<typeof fixture>, split: boolean) {
  const workspace = { id: 'fixture-workspace', name: 'Fixture', primaryRoot: f.docs,
    tabs: [{ id: 'tab-a', relativePath: 'a.md', isPinned: true }, { id: 'tab-b', relativePath: 'b.md', isPinned: false }], lifecycleEpoch: 1, activeTabId: split ? 'tab-b' : 'tab-a',
    splitState: { root: split ? { type: 'split', id: 'split-root', direction: 'horizontal', ratio: 0.45,
      first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' }, second: { type: 'split', id: 'split-right', direction: 'vertical', ratio: 0.55,
        first: { type: 'leaf', id: 'leaf-b1', tabId: 'tab-b' }, second: { type: 'leaf', id: 'leaf-b2', tabId: 'tab-b' } } } : null,
      activeLeafId: split ? 'leaf-b2' : '' } }
  writeFileSync(join(f.profile, 'workspace-session.json'), JSON.stringify({ windowLifecycleV1Migrated: true,
    desktopSession: { version: 1, lastActiveWindowId: 'fixture-window', windows: [{ id: 'fixture-window', bounds: { x: 30, y: 60, width: 1200, height: 850 }, isMaximized: false, alwaysOnTop: false, activeWorkspaceId: workspace.id, workspaces: [workspace] }] } }))
  writeFileSync(join(f.profile, 'app-data.json'), JSON.stringify({ readPositions: Object.fromEntries([['a', 0.37], ['b', 0.63]].map(([name, ratio]) => [join(f.docs, `${name}.md`), { canonicalPath: join(f.docs, `${name}.md`), scrollRatio: ratio, headingId: `section-${name === 'a' ? 120 : 220}`, updatedAt: Date.now() - 60000 }])) }))
}

async function delayPositionRead(app: ElectronApplication, path: string) {
  await app.evaluate(({ ipcMain }, path) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>
    const original = handlers.get('read-position:get')!
    ;(globalThis as any).__positionReadStarted = false
    handlers.set('read-position:get', async (event, target) => {
      const value = await original(event, target)
      if (target === path) {
        ;(globalThis as any).__positionReadStarted = true
        await new Promise<void>(resolve => { (globalThis as any).__releasePosition = resolve })
      }
      return value
    })
  }, path)
}

test('迟到文件级位置不拉回已切换并滚动的当前文档', async ({}, info) => {
  const f = fixture()
  seed(f, false)
  const { app, page } = await launch(f.profile)
  try {
    await expect(page.locator('.markdown-body h1')).toHaveText('Document A')
    await expect.poll(() => page.locator('.preview').evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeCloseTo(0.37, 2)
    const previousUpdatedAt = positions(f.profile)['a.md'].updatedAt
    await delayPositionRead(app, join(f.docs, 'b.md'))
    await page.locator('.tab .tab-name', { hasText: 'b.md' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__positionReadStarted)).toBe(true)
    await page.locator('.tab .tab-name', { hasText: 'a.md' }).click()
    const preview = page.locator('.preview'), bounds = await preview.boundingBox()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.wheel(0, 450)
    await expect.poll(() => positions(f.profile)['a.md'].updatedAt).toBeGreaterThan(previousUpdatedAt)
    const ratio = await preview.evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))
    await app.evaluate(() => (globalThis as any).__releasePosition())
    await page.waitForTimeout(1000)
    expect(await preview.evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeCloseTo(ratio, 3)
    await page.locator('.tab .tab-name', { hasText: 'b.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Document B')
    await expect.poll(() => page.locator('.preview').evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeCloseTo(0.63, 2)
    await page.screenshot({ path: info.outputPath('late-position-target.png'), animations: 'disabled' })
  } finally { await app.close() }
})

for (const mode of ['seed-single', 'seed-duplicate-split', 'real-quit-restart']) {
  test(`reading position: ${mode}`, async ({}, info) => {
    const f = fixture()
    let running: Awaited<ReturnType<typeof launch>> | null = null
    try {
      if (mode.startsWith('seed-')) seed(f, mode.endsWith('split'))
      else {
        running = await launch(f.profile)
        await running.page.evaluate(path => window.api.testOpenMarkdownFile?.(path), join(f.docs, 'a.md'))
        await expect(running.page.locator('.markdown-body h1')).toHaveText('Document A')
        await running.page.locator('.preview').evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.57 })
        await expect.poll(() => positions(f.profile)['a.md']?.scrollRatio).toBeGreaterThan(0.55)
        await expect.poll(() => {
          try { return JSON.parse(readFileSync(join(f.profile, 'workspace-session.json'), 'utf8')).desktopSession?.windows[0]?.workspaces[0]?.tabs.length ?? 0 }
          catch { return 0 }
        }).toBeGreaterThan(0)
        await running.page.screenshot({ path: info.outputPath('warm-before-quit.png'), animations: 'disabled' })
        await quit(running.app); running = null
      }
      const before = positions(f.profile)
      const sessionBefore = JSON.parse(readFileSync(join(f.profile, 'workspace-session.json'), 'utf8')).desktopSession
      running = await launch(f.profile)
      await expect(running.page.locator('.markdown-body h1')).toHaveText(mode.endsWith('split') ? ['Document A', 'Document B', 'Document B'] : ['Document A'])
      const viewportSamples = []
      for (let i = 0; i < 30; i++) {
        viewportSamples.push(await running.page.locator('.preview').evaluateAll(elements => elements.map(element => ({
          top: element.scrollTop, max: element.scrollHeight - element.clientHeight,
          ratio: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
        }))))
        await running.page.waitForTimeout(100)
      }
      const coldPositions = positions(f.profile)
      await running.page.screenshot({ path: info.outputPath('cold-before-input.png'), animations: 'disabled' })
      writeFileSync(info.outputPath('observation.json'), JSON.stringify({ mode, before, coldPositions, viewportSamples }, null, 2))
      const expected = mode.endsWith('split') ? [before['a.md'].scrollRatio, before['b.md'].scrollRatio, before['b.md'].scrollRatio] : [before['a.md'].scrollRatio]
      for (const sample of viewportSamples.slice(-10)) for (const [index, viewport] of sample.entries()) {
        expect(viewport.max).toBeGreaterThan(1000)
        expect(viewport.ratio, 'cold restored viewport must match the position saved before normal quit').toBeCloseTo(expected[index], 2)
      }
      expect(coldPositions, 'restore must preserve complete records including headingId and updatedAt').toEqual(before)
      const sessionAfter = JSON.parse(readFileSync(join(f.profile, 'workspace-session.json'), 'utf8')).desktopSession
      // lifecycleEpoch是每次启动重新分配的授权代次，不是持久会话语义。
      const stableSession = (session: any) => ({ ...session, windows: session.windows.map((window: any) => ({
        ...window, workspaces: window.workspaces.map((workspace: any) => ({ ...workspace, lifecycleEpoch: undefined })),
      })) })
      expect(stableSession(sessionAfter)).toEqual(stableSession(sessionBefore))
      expect(JSON.stringify(sessionAfter)).not.toContain('initialScrollRatio')
      const preview = running.page.locator('.preview').last(), bounds = await preview.boundingBox()
      await running.page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
      await running.page.mouse.wheel(0, 450)
      const name = mode.endsWith('split') ? 'b.md' : 'a.md'
      await expect.poll(() => positions(f.profile)[name].scrollRatio).toBeGreaterThan(before[name].scrollRatio + 0.003)
      const userRatio = await preview.evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))
      await running.page.waitForTimeout(700)
      expect(await preview.evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeCloseTo(userRatio, 3)
      await running.page.screenshot({ path: info.outputPath('after-wheel.png'), animations: 'disabled' })
    } finally { if (running) await running.app.close() }
  })
}
