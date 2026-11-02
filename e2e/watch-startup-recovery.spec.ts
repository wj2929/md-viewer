import { readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

// Real 65-second delivery delay, not accelerated app time or a fabricated ready response.
test('65秒慢启动在降级后同代续接，补齐缺口并恢复自动刷新', async ({ electronApp, page, testDir }, testInfo) => {
  test.setTimeout(95000)
  await electronApp.evaluate(({ utilityProcess }) => {
    const state = { children: [] as any[] }
    ;(globalThis as any).__startupRecoveryProbe = state
    const fork = utilityProcess.fork.bind(utilityProcess)
    utilityProcess.fork = (...args) => {
      const child = fork(...args)
      if (args[0].endsWith('watcherProcess.js')) {
        const entry = { child, rootWatchId: -1, createAt: 0, readyCaptured: false, readyDelivered: false, exited: false, gapEvents: 0 }
        state.children.push(entry)
        child.once('exit', () => { entry.exited = true })
        const post = child.postMessage.bind(child)
        child.postMessage = (message, ports) => {
          if (message.type === 'create' && message.kind === 'root') {
            entry.rootWatchId = message.watchId
            entry.createAt = performance.now()
          }
          return post(message, ports)
        }
        const emit = child.emit.bind(child)
        child.emit = (event, ...values) => {
          const message = values[0]
          if (event === 'message' && message?.type === 'events' && message.watchId === entry.rootWatchId &&
            !entry.readyDelivered && performance.now() - entry.createAt > 30000) entry.gapEvents += message.events.length
          if (event === 'message' && message?.type === 'crawl-complete' && message.watchId === entry.rootWatchId) {
            entry.readyCaptured = true
            setTimeout(() => {
              if (!entry.exited) {
                entry.readyDelivered = true
                emit(event, ...values)
              }
            }, Math.max(0, 65000 - (performance.now() - entry.createAt)))
            return true
          }
          return emit(event, ...values)
        }
      }
      return child
    }
  })
  const health = () => page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
  })
  const probe = () => electronApp.evaluate(() => (globalThis as any).__startupRecoveryProbe.children.map((entry: any) => ({
    readyCaptured: entry.readyCaptured, readyDelivered: entry.readyDelivered, exited: entry.exited,
  })))
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  await expect.poll(probe).toEqual([{ readyCaptured: true, readyDelivered: false, exited: false }])
  await expect.poll(async () => (await health()).state, { timeout: 35000 }).toBe('degraded')
  expect((await health()).reason).toBe('timeout')
  expect(await probe()).toEqual([{ readyCaptured: true, readyDelivered: false, exited: false }])
  const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
  expect(status.effectiveDirectory).toBeTruthy()
  const events = () => readdirSync(status.effectiveDirectory!).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(status.effectiveDirectory!, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
    .filter(event => event.event.startsWith('watcher.work.') && event.metadata?.watchKind === 'root')
  await expect.poll(() => events().some(event => event.metadata.startupRecoveryPending === true)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('slow-start-degraded.png'), animations: 'disabled' })

  // These unopened-file deltas are intentionally dropped while degraded; recovery must scan them.
  writeFileSync(join(testDir, 'late-added.md'), '# Late added\n\ncontinuationuniqueadded')
  writeFileSync(join(testDir, 'test2.md'), '# Changed during slow startup\n\ncontinuationuniquechanged')
  renameSync(join(testDir, 'math.md'), join(testDir, 'late-renamed.md'))
  unlinkSync(join(testDir, 'mermaid.md'))
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__startupRecoveryProbe.children[0].gapEvents)).toBeGreaterThanOrEqual(4)
  expect((await health()).state).toBe('degraded')
  await expect.poll(async () => (await health()).state, { timeout: 42000 }).toBe('healthy')
  expect(await probe()).toEqual([{ readyCaptured: true, readyDelivered: true, exited: false }])
  await expect(page.locator('.file-tree-row.file', { hasText: 'late-added.md' })).toBeVisible()
  await expect(page.locator('.file-tree-row.file', { hasText: 'late-renamed.md' })).toBeVisible()
  await expect(page.locator('.file-tree-row.file', { hasText: 'mermaid.md' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return JSON.stringify(await window.api.queryWorkspaceIndex({ workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }, 'continuationuniqueadded'))
  })).toContain('late-added.md')
  await page.locator('.file-tree-row.file', { hasText: 'test2.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Changed during slow startup')
  writeFileSync(join(testDir, 'test2.md'), '# Live after continuation')
  await expect(page.locator('.markdown-body h1')).toHaveText('Live after continuation')
  await expect.poll(() => events().some(event => event.metadata.state === 'healthy')).toBe(true)
  const recorded = events()
  expect(recorded.some(event => event.metadata.watchStage === 'ready' && event.metadata.state === 'recovering')).toBe(true)
  expect(recorded.filter(event => event.metadata.state === 'healthy').every(event => event.metadata.watchGeneration === 1)).toBe(true)
  expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
  expect(JSON.stringify(recorded)).not.toContain(testDir)
  await testInfo.attach('startup-recovery-events', { body: JSON.stringify({ probe: await probe(), events: recorded }, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: testInfo.outputPath('slow-start-recovered.png'), animations: 'disabled' })
})
