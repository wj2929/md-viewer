import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, openFolderViaIPC } from './fixtures/electron'
import type { PersistedDiagnosticEvent } from '../src/shared/diagnostics'

async function context(page: Page) {
  return page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
  })
}
async function health(page: Page) {
  const operation = await context(page)
  return page.evaluate(value => window.api.getWatchStatus(value.workspaceId, value.lifecycleEpoch), operation)
}
async function diagnostics(app: ElectronApplication, page: Page) {
  const profile = await app.evaluate(({ app }) => ({
    actual: app.getPath('userData'),
    requested: process.argv.find(value => value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length),
  }))
  expect(profile.requested).toBeTruthy()
  expect(realpathSync(profile.actual)).toBe(realpathSync(profile.requested!))
  expect(basename(profile.actual)).toMatch(/^md-viewer-e2e-user-data-/)
  const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
  expect(realpathSync(status.effectiveDirectory!)).toBe(realpathSync(join(profile.actual, 'diagnostic-logs')))
  return () => readdirSync(status.effectiveDirectory!).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(status.effectiveDirectory!, name), 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as PersistedDiagnosticEvent))
}

async function observeOwnedWatcher(app: ElectronApplication) {
  await app.evaluate(({ utilityProcess }) => {
    const children: any[] = []
    ;(globalThis as any).__retryProbe = children
    const fork = utilityProcess.fork.bind(utilityProcess)
    utilityProcess.fork = (...args) => {
      const child = fork(...args)
      if (args[0].endsWith('watcherProcess.js')) {
        const entry = { child, commands: [] as any[], exited: false }
        children.push(entry)
        const post = child.postMessage.bind(child)
        child.postMessage = (message, ports) => { entry.commands.push(message); return post(message, ports) }
        child.on('exit', () => { entry.exited = true })
      }
      return child
    }
  })
}

function retryRows(events: PersistedDiagnosticEvent[]) {
  return events.filter(event => event.event === 'watcher.work.summary' && event.operationId?.startsWith('watch_retry_'))
}

test('监听已回收后从真实重试按钮建立新代，诊断落盘且外部变更继续刷新', async ({ electronApp, page, testDir }, testInfo) => {
  await observeOwnedWatcher(electronApp)
  const readEvents = await diagnostics(electronApp, page)
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  await expect.poll(async () => (await health(page)).state).toBe('healthy')
  // Inject only a protocol error into this owned test child, not real resource exhaustion or TCC changes.
  await electronApp.evaluate(() => {
    const entry = (globalThis as any).__retryProbe[0]
    const create = entry.commands.find((message: any) => message.type === 'create' && message.kind === 'root')
    if (!create) throw new Error('owned root create missing')
    entry.child.emit('message', { ...create, type: 'error', code: 'EMFILE' })
  })
  await expect(page.locator('.watch-refresh[data-watch-state="degraded"]')).toBeVisible()
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__retryProbe[0].exited)).toBe(true)
  await page.getByRole('button', { name: '刷新文件列表', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '自动刷新状态' })).toContainText('自动刷新暂不可用')
  await page.screenshot({ path: testInfo.outputPath('retry-before.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '重试自动刷新', exact: true }).click()
  await expect.poll(async () => (await health(page)).state, { timeout: 15000 }).toBe('healthy')
  await expect.poll(() => retryRows(readEvents()).length).toBe(3)
  const rows = retryRows(readEvents())
  expect(rows.map(event => event.metadata?.watchRetryStage)).toEqual(['received', 'subscriptions-selected', 'restart-requested'])
  expect(new Set(rows.map(event => event.operationId)).size).toBe(1)
  expect(rows[1].metadata).toMatchObject({ watchRootSelected: true })
  expect(Number(rows[1].metadata?.watchSelectedCount)).toBeGreaterThanOrEqual(1)
  expect(rows[2].metadata).toMatchObject({ watchProcessPresent: false, watchCapacitySkippedCount: 0 })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__retryProbe.length)).toBe(2)
  const rootCreates = () => readEvents().filter(event => event.event === 'watcher.work.start' && event.metadata?.watchKind === 'root' && event.metadata?.watchStage === 'create-sent')
  await expect.poll(() => rootCreates().length).toBeGreaterThanOrEqual(2)
  const creates = rootCreates()
  expect(Number(creates.at(-1)?.metadata?.watchGeneration)).toBeGreaterThan(Number(creates[0].metadata?.watchGeneration))
  writeFileSync(join(testDir, 'test1.md'), '# Retry recovered live')
  writeFileSync(join(testDir, 'retry-created.md'), '# Created after retry')
  await expect(page.locator('.markdown-body h1')).toHaveText('Retry recovered live')
  await expect(page.locator('.file-tree-row.file', { hasText: 'retry-created.md' })).toBeVisible()
  expect(JSON.stringify(rows)).not.toContain(testDir)
  const operation = await context(page)
  expect(JSON.stringify(rows)).not.toContain(operation.workspaceId)
  expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('retry-after.png'), animations: 'disabled' })
  await testInfo.attach('retry-events', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})

test('无UI订阅时accepted不冒充启动成功，日志明确记录空选择', async ({ electronApp, page, testDir }, testInfo) => {
  const readEvents = await diagnostics(electronApp, page)
  await openFolderViaIPC(electronApp, testDir)
  await expect.poll(async () => (await health(page)).state).toBe('healthy')
  const operation = await context(page)
  await page.evaluate(value => window.api.unwatchFolder(value.workspaceId, value.lifecycleEpoch), operation)
  expect((await health(page)).state).toBe('detached')
  expect(await page.evaluate(value => window.api.retryWatch(value.workspaceId, value.lifecycleEpoch), operation)).toEqual({ accepted: true })
  await expect.poll(() => retryRows(readEvents()).length).toBe(3)
  const rows = retryRows(readEvents())
  expect(rows.map(event => event.metadata?.watchRetryStage)).toEqual(['received', 'subscriptions-selected', 'host-skipped'])
  expect(rows[1].metadata).toMatchObject({ watchSelectedCount: 0, watchRootSelected: false, watchOpenedSelectedCount: 0 })
  expect(rows[2].metadata?.watchRetryReason).toBe('no-subscriptions')
  expect(new Set(rows.map(event => event.operationId)).size).toBe(1)
  expect((await health(page)).state).toBe('detached')
  expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
  await testInfo.attach('empty-retry-events', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})

test('过期或外来工作区重试被原权限边界拒绝，入口日志不泄漏输入', async ({ electronApp, page, testDir }, testInfo) => {
  await observeOwnedWatcher(electronApp)
  const readEvents = await diagnostics(electronApp, page)
  await openFolderViaIPC(electronApp, testDir)
  await expect.poll(async () => (await health(page)).state).toBe('healthy')
  const operation = await context(page)
  for (const value of [
    { workspaceId: operation.workspaceId, lifecycleEpoch: operation.lifecycleEpoch + 1 },
    { workspaceId: 'untrusted-private-workspace', lifecycleEpoch: operation.lifecycleEpoch },
    { workspaceId: operation.workspaceId, lifecycleEpoch: undefined },
  ]) {
    expect(await page.evaluate(async input => {
      try { await window.api.retryWatch(input.workspaceId, input.lifecycleEpoch); return 'accepted' }
      catch { return 'rejected' }
    }, value)).toBe('rejected')
  }
  await expect.poll(() => retryRows(readEvents()).length).toBe(6)
  const rows = retryRows(readEvents())
  expect(new Set(rows.map(event => event.operationId)).size).toBe(3)
  for (let i = 0; i < rows.length; i += 2) {
    expect(rows.slice(i, i + 2).map(event => event.metadata?.watchRetryStage)).toEqual(['received', 'context-rejected'])
    expect(rows[i].operationId).toBe(rows[i + 1].operationId)
    expect(rows[i].workspaceToken).toBeUndefined()
    expect(rows[i + 1].workspaceToken).toBeUndefined()
  }
  expect(JSON.stringify(rows)).not.toContain(testDir)
  expect(JSON.stringify(rows)).not.toContain(operation.workspaceId)
  expect(JSON.stringify(rows)).not.toContain('untrusted-private-workspace')
  expect(await electronApp.evaluate(() => (globalThis as any).__retryProbe.length)).toBe(1)
  expect((await health(page)).state).toBe('healthy')
  expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
  await testInfo.attach('rejected-retry-events', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})
