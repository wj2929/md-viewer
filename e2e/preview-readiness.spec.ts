import { test, expect, _electron, type ElectronApplication, type TestInfo } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectPreviewReadiness } from './fixtures/previewReadiness'

function fixture(split = false) {
  const parent = join(process.cwd(), '.tmp', 'e2e')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'preview-state-'))
  const profile = mkdtempSync(join(tmpdir(), 'mdv-preview-state-'))
  const header = '# Self fixture\n\n'
  writeFileSync(join(root, 'oversized.md'), header + 'x'.repeat(1_500_001 - header.length))
  const workspace = { id: 'self-private-workspace', name: 'Self fixture', primaryRoot: root,
    tabs: [{ id: 'self-private-tab', relativePath: 'oversized.md' }], activeTabId: 'self-private-tab',
    splitState: split ? { root: { type: 'split', id: 'self-private-split', direction: 'horizontal', ratio: 0.5,
      first: { type: 'leaf', id: 'self-private-left', tabId: 'self-private-tab' },
      second: { type: 'leaf', id: 'self-private-right', tabId: 'self-private-tab' } }, activeLeafId: 'self-private-left' }
      : { root: null, activeLeafId: '' } }
  writeFileSync(join(profile, 'workspace-session.json'), JSON.stringify({ windowLifecycleV1Migrated: true,
    desktopSession: { version: 1, lastActiveWindowId: 'self-window', windows: [{ id: 'self-window',
      bounds: { x: 20, y: 60, width: 1200, height: 800 }, isMaximized: false, alwaysOnTop: false,
      activeWorkspaceId: workspace.id, workspaces: [workspace] }] } }))
  return { root, profile }
}
function events(profile: string) {
  const directory = join(profile, 'diagnostic-logs')
  if (!existsSync(directory)) return []
  const rows = readdirSync(directory).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(directory, name), 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)] } catch { return [] }
    }))
  const boot = rows.filter(row => row.event === 'session.start').sort((a, b) => b.observedUnixMs - a.observedUnixMs)[0]?.bootId
  return rows.filter(row => row.bootId === boot)
}
const readiness = (profile: string) => inspectPreviewReadiness(events(profile), 1)
function approvals(profile: string) {
  const file = join(profile, 'app-data.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).largeDocumentApprovals ?? [] : []
}
async function launch(profile: string) {
  const executablePath = process.env.MD_VIEWER_E2E_EXECUTABLE_PATH
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [`--user-data-dir=${profile}`, ...(executablePath ? [] : [join(__dirname, '../out/main/index.js')])],
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_E2E_VISIBLE: '0', MD_VIEWER_SKIP_RESTORE: '0', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_DIAGNOSTIC_LOG_DIR: join(profile, 'diagnostic-logs') } })
  expect(realpathSync(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(realpathSync(profile))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.app')).toBeVisible()
  return { app, page }
}
async function finish(app: ElectronApplication | null, f: ReturnType<typeof fixture>, info: TestInfo) {
  if (app) await app.close()
  cpSync(join(f.profile, 'diagnostic-logs'), info.outputPath('diagnostic-logs'), { recursive: true })
  rmSync(f.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  rmSync(f.root, { recursive: true, force: true })
}

test('等待选择与源码就绪不超时冒充失败；完整预览仍须等 post-render 状态，关闭后旧 ready 失效', async ({}, info) => {
  const f = fixture()
  let app: ElectronApplication | null = null
  try {
    const running = await launch(f.profile); app = running.app
    const page = running.page
    await expect(page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
    await expect.poll(() => readiness(f.profile).ready).toBe(true)
    expect(readiness(f.profile).operations[0].previewStates).toEqual(['awaiting-choice'])
    expect(events(f.profile).filter(row => row.event === 'file.preview.summary')).toHaveLength(0)
    await page.getByRole('button', { name: '查看源码', exact: true }).click()
    await expect.poll(() => readiness(f.profile).operations[0].previewStates).toEqual(['source-ready'])
    expect(readiness(f.profile).ready).toBe(true)
    await page.screenshot({ path: info.outputPath('source-ready.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '完整渲染', exact: true }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Self fixture')
    await expect.poll(() => readiness(f.profile).operations[0].previewStates).toEqual(['preview-core-ready'])
    expect(readiness(f.profile).ready).toBe(false)
    await expect.poll(() => readiness(f.profile).operations[0].previewStates, { timeout: 10000 }).toEqual(['preview-ready'])
    expect(readiness(f.profile).ready).toBe(true)
    const rows = events(f.profile)
    const state = rows.find(row => row.event === 'file.preview.state' && row.metadata.previewState === 'preview-ready')
    expect(rows.some(row => row.event === 'file.preview.post-render' && row.operationId === state.metadata.relatedOperationId
      && row.metadata.previewInstanceId === state.metadata.previewInstanceId)).toBe(true)
    await page.getByRole('button', { name: '恢复大文档提示' }).click()
    await expect.poll(() => readiness(f.profile).operations[0].previewStates).toEqual(['awaiting-choice'])
    await page.locator('.tab-close').click()
    await expect.poll(() => readiness(f.profile).ready).toBe(false)
    expect(readiness(f.profile).operations[0].previewStates).toEqual([])
    const text = JSON.stringify(events(f.profile))
    for (const secret of [f.root, 'oversized.md', 'Self fixture', 'self-private-']) expect(text).not.toContain(secret)
    expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused(), fullscreen: w.isFullScreen() })))).toEqual([{ visible: false, focused: false, fullscreen: false }])
  } finally { await finish(app, f, info) }
})

test('同一读取的两个面板有独立状态，另一个等待选择不能遮住正在渲染的面板', async ({}, info) => {
  const f = fixture(true)
  let app: ElectronApplication | null = null
  try {
    const running = await launch(f.profile); app = running.app
    const page = running.page
    await expect(page.getByRole('button', { name: '完整渲染', exact: true })).toHaveCount(2)
    await expect.poll(() => readiness(f.profile).operations[0]?.previewStates.length).toBe(2)
    expect(readiness(f.profile).ready).toBe(true)
    await page.locator('.split-leaf-panel').first().getByRole('button', { name: '完整渲染', exact: true }).click()
    await expect.poll(() => readiness(f.profile).operations[0].previewStates.includes('preview-core-ready')).toBe(true)
    expect(readiness(f.profile).ready).toBe(false)
    const states = events(f.profile).filter(row => row.event === 'file.preview.state')
    expect(new Set(states.map(row => row.metadata.previewInstanceId)).size).toBe(2)
    expect(new Set(states.map(row => row.metadata.relatedOperationId)).size).toBe(1)
    await page.locator('.split-leaf-panel').first().getByTitle('关闭面板', { exact: true }).click()
    await expect.poll(() => readiness(f.profile).ready).toBe(true)
    expect(readiness(f.profile).operations[0].previewStates).toEqual(['awaiting-choice'])
    await page.screenshot({ path: info.outputPath('remaining-choice-ready.png'), animations: 'disabled' })
  } finally { await finish(app, f, info) }
})

for (const remember of [false, true]) test(`重新打开使用新观测实例并保留用户选择规则：remember=${remember}`, async ({}, info) => {
  const f = fixture()
  let app: ElectronApplication | null = null
  try {
    let running = await launch(f.profile); app = running.app
    await expect(running.page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
    await expect.poll(() => readiness(f.profile).ready).toBe(true)
    const firstId = events(f.profile).find(row => row.event === 'file.preview.state').metadata.previewInstanceId
    if (remember) await running.page.getByRole('checkbox').check()
    await running.page.getByRole('button', { name: '完整渲染', exact: true }).click()
    await expect.poll(() => readiness(f.profile).operations[0]?.previewStates, { timeout: 10000 }).toEqual(['preview-ready'])
    await expect.poll(() => approvals(f.profile).length).toBe(remember ? 1 : 0)
    if (remember) expect(approvals(f.profile)[0]).toEqual({ path: join(f.root, 'oversized.md'), characters: 1500001, lines: 3 })
    await info.attach('approval-before-quit', { body: JSON.stringify(await running.page.evaluate(path => window.api.getLargeDocumentApproval(path), join(f.root, 'oversized.md'))), contentType: 'application/json' })
    await app.close(); app = null
    running = await launch(f.profile); app = running.app
    await info.attach('approval-after-reopen', { body: JSON.stringify(await running.page.evaluate(path => window.api.getLargeDocumentApproval(path), join(f.root, 'oversized.md'))), contentType: 'application/json' })
    await expect.poll(() => readiness(f.profile).ready, { timeout: 10000 }).toBe(true)
    expect(readiness(f.profile).operations[0].previewStates).toEqual([remember ? 'preview-ready' : 'awaiting-choice'])
    const secondId = events(f.profile).find(row => row.event === 'file.preview.state').metadata.previewInstanceId
    expect(secondId).not.toBe(firstId)
    expect((await running.page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    await running.page.screenshot({ path: info.outputPath('reopened.png'), animations: 'disabled' })
  } finally { await finish(app, f, info) }
})

for (const mode of ['revoke', 'within-growth', 'exceeds-growth'] as const) test(`持久批准在真实重启后仍尊重撤销与增长限制：${mode}`, async ({}, info) => {
  const f = fixture()
  let app: ElectronApplication | null = null
  try {
    let running = await launch(f.profile); app = running.app
    await expect(running.page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
    await running.page.getByRole('checkbox').check()
    await running.page.getByRole('button', { name: '完整渲染', exact: true }).click()
    await expect.poll(() => approvals(f.profile).length).toBe(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.webContents.session.isPersistent()))).toEqual([false])
    if (mode === 'revoke') {
      await running.page.getByRole('button', { name: '恢复大文档提示' }).click()
      await expect.poll(() => approvals(f.profile).length).toBe(0)
    }
    await app.close(); app = null
    if (mode !== 'revoke') {
      const header = '# Self fixture\n\n'
      const characters = mode === 'within-growth' ? 1800000 : 2000000
      writeFileSync(join(f.root, 'oversized.md'), header + 'x'.repeat(characters - header.length))
    }
    running = await launch(f.profile); app = running.app
    await expect.poll(() => readiness(f.profile).ready, { timeout: 10000 }).toBe(true)
    expect(readiness(f.profile).operations[0].previewStates).toEqual([mode === 'within-growth' ? 'preview-ready' : 'awaiting-choice'])
    if (mode === 'within-growth') expect(approvals(f.profile)[0].characters).toBe(1500001)
    if (mode !== 'within-growth') await expect(running.page.getByRole('button', { name: '完整渲染', exact: true })).toBeVisible()
    expect((await running.page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    await running.page.screenshot({ path: info.outputPath('reopened-limits.png'), animations: 'disabled' })
  } finally { await finish(app, f, info) }
})
