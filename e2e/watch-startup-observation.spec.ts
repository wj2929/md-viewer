import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

for (const delayed of [false, true]) {
  test(`监听启动阶段落盘：${delayed ? '请求交付延迟、心跳继续' : '正常启动'}`, async ({ electronApp, page, testDir }, testInfo) => {
    if (delayed) {
      // Delay only the owned test process's create delivery; real ping/pong and responses remain intact.
      await electronApp.evaluate(({ utilityProcess }) => {
        const fork = utilityProcess.fork.bind(utilityProcess)
        utilityProcess.fork = (...args) => {
          const child = fork(...args)
          if (args[0].endsWith('watcherProcess.js')) {
            const post = child.postMessage.bind(child)
            child.postMessage = (message, ports) => {
              if (message.type === 'create') setTimeout(() => post(message, ports), 6500)
              else post(message, ports)
            }
          }
          return child
        }
      })
    }
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
    const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
    expect(status.effectiveDirectory).toBeTruthy()
    const readEvents = () => readdirSync(status.effectiveDirectory!).filter(name => name.endsWith('.jsonl'))
      .flatMap(name => readFileSync(join(status.effectiveDirectory!, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
      .filter(event => event.event.startsWith('watcher.work.') && event.operationId?.startsWith('watch_create_') && event.metadata?.watchKind === 'root')
    await expect.poll(async () => page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return (await window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)).state
    }), { timeout: 15000 }).toBe('healthy')
    await expect.poll(() => readEvents().some(event => event.metadata.state === 'healthy')).toBe(true)
    const events = readEvents()
    const stages = events.map(event => event.metadata.watchStage)
    for (const stage of ['create-sent', 'accepted', 'path-check-start', 'path-checked', 'watch-create-start', 'watch-created', 'crawl-progress', 'ready']) {
      expect(stages).toContain(stage)
    }
    const ordered = ['create-sent', 'accepted', 'path-check-start', 'path-checked', 'watch-create-start', 'watch-created', 'ready']
    expect(ordered.map(stage => stages.indexOf(stage))).toEqual(ordered.map(stage => stages.indexOf(stage)).sort((a, b) => a - b))
    if (delayed) {
      expect(events.some(event => event.metadata.watchStage === 'create-sent' && event.metadata.startupElapsedMs >= 5000 && event.metadata.lastPongAgeMs < 2000)).toBe(true)
      expect(events.find(event => event.metadata.watchStage === 'accepted').metadata.acceptedMs).toBeGreaterThanOrEqual(6400)
    }
    expect(JSON.stringify(events)).not.toContain(testDir)
    expect((await page.evaluate(() => window.api.getDiagnosticLogStatus())).invalidEvents).toBe(0)
    writeFileSync(join(testDir, 'test1.md'), '# Observed external change')
    await expect(page.locator('.markdown-body h1')).toHaveText('Observed external change')
    await testInfo.attach('watch-startup-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('watch-startup.png'), animations: 'disabled' })
  })
}
