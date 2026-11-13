import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test, expect, openFolderViaIPC } from './fixtures/electron'

test.afterEach(async ({ electronApp, page }, testInfo) => {
  const probe = await electronApp.evaluate(() => (globalThis as any).__accessRecoveryProbe)
  const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
  const events = readdirSync(status.effectiveDirectory!).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(status.effectiveDirectory!, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
    .filter(event => event.event.startsWith('watcher.work.') || event.event === 'file.io.summary' || event.event === 'folder.scan.summary')
  await testInfo.attach('access-final-timeline', { body: JSON.stringify({ probe, events }, null, 2), contentType: 'application/json' })
})

for (const mode of ['file-after-30s', 'scan-after-120s'] as const) {
  test(`${mode}：真实访问成功后自动重建监听，无需点击重试且后续外部变更可刷新`, async ({ electronApp, page, testDir }, testInfo) => {
    test.setTimeout(mode === 'file-after-30s' ? 65000 : 155000)
    const profile = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    expect(basename(profile)).toMatch(/^md-viewer-e2e-user-data-/)
    expect(realpathSync(profile)).not.toBe(realpathSync(join(process.env.HOME!, 'Library/Application Support/md-viewer')))
    await electronApp.evaluate(({ utilityProcess, ipcMain }, mode) => {
      const probe = { children: [] as any[], manualRetries: 0, suppressed: 0, heldReady: 0, io: [] as any[], delayedScans: 0, scanGateReleased: false }
      ;(globalThis as any).__accessRecoveryProbe = probe
      let releaseScans!: () => void
      const scansReady = new Promise<void>(resolve => { releaseScans = resolve })
      const releaseAccess = () => { probe.scanGateReleased = true; releaseScans() }
      ;(globalThis as any).__releaseAccessScans = releaseAccess
      for (const channel of ['fs:readFile', 'fs:readDir']) {
        const original = (ipcMain as any)._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (...args) => {
          const entry = { channel, start: performance.now(), end: 0, ok: false }
          probe.io.push(entry)
          const rootAt = probe.children[0]?.roots[0]?.at
          // Shared-file reconciliation also scans. Delay, never fabricate, its result until access is restored.
          if (channel === 'fs:readDir' && rootAt !== undefined && performance.now() - rootAt >= 25000 && !probe.scanGateReleased) {
            probe.delayedScans++
            await scansReady
          }
          try {
            const result = await original(...args)
            entry.ok = true
            if (mode === 'file-after-30s' && channel === 'fs:readFile' && rootAt !== undefined && performance.now() - rootAt >= 30000) releaseAccess()
            return result
          }
          finally { entry.end = performance.now() }
        })
      }
      const retry = (ipcMain as any)._invokeHandlers.get('watch:retry')
      ipcMain.removeHandler('watch:retry')
      ipcMain.handle('watch:retry', (...args) => { probe.manualRetries++; return retry(...args) })
      const fork = utilityProcess.fork.bind(utilityProcess)
      utilityProcess.fork = (...args) => {
        const child = fork(...args)
        if (args[0].endsWith('watcherProcess.js')) {
          const entry = { exited: false, roots: [] as any[], heldReady: 0 }
          probe.children.push(entry)
          const first = probe.children.length === 1
          child.once('exit', () => { entry.exited = true })
          const post = child.postMessage.bind(child)
          child.postMessage = (message, ports) => {
            if (message.type === 'create' && message.kind === 'root') {
              entry.roots.push({ id: message.watchId, generation: message.watchGeneration, processGeneration: message.processGeneration, at: performance.now() })
              // Fault injection only: no accepted/progress/ready response is fabricated.
              if (first && mode === 'file-after-30s') { probe.suppressed++; return }
            }
            return post(message, ports)
          }
          const emit = child.emit.bind(child)
          child.emit = (event, ...values) => {
            const message = values[0]
            if (first && mode === 'scan-after-120s' && event === 'message' && message?.type === 'crawl-complete' &&
              entry.roots.some(root => root.id === message.watchId)) {
              entry.heldReady++; probe.heldReady++; return true
            }
            return emit(event, ...values)
          }
        }
        return child
      }
    }, mode)
    const health = () => page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
    })
    const probe = () => electronApp.evaluate(() => (globalThis as any).__accessRecoveryProbe)
    await openFolderViaIPC(electronApp, testDir)
    await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
    await expect.poll(async () => (await health()).state, { timeout: 35000 }).toBe('degraded')
    expect((await health()).reason).toBe('timeout')
    if (mode === 'scan-after-120s') {
      expect((await probe()).heldReady).toBeGreaterThanOrEqual(1)
      expect((await probe()).children[0].exited).toBe(false)
    } else expect((await probe()).suppressed).toBe(1)
    await expect.poll(async () => (await probe()).children[0].exited, { timeout: mode === 'scan-after-120s' ? 95000 : 10000 }).toBe(true)
    expect((await health()).state).toBe('degraded')
    await page.screenshot({ path: testInfo.outputPath('access-before.png'), animations: 'disabled' })

    // Only this independent profile and self-created document are accessed or modified.
    if (mode === 'file-after-30s') {
      expect(await page.evaluate(file => window.api.readFile(file), join(testDir, 'test1.md'))).toContain('# Test 1')
    } else {
      await electronApp.evaluate(() => (globalThis as any).__releaseAccessScans())
      const scanned = await page.evaluate(root => window.api.readDir(root), testDir)
      expect(scanned.some(item => item.name === 'test1.md')).toBe(true)
    }
    await expect.poll(async () => (await health()).state, { timeout: 12000 }).toBe('healthy')
    expect((await probe()).manualRetries).toBe(0)
    const roots = (await probe()).children.flatMap((child: any) => child.roots)
    expect(roots.map((root: any) => root.generation)).toEqual([1, 2])
    writeFileSync(join(testDir, 'test1.md'), '# Automatic recovery live change')
    writeFileSync(join(testDir, 'access-added.md'), '# Automatically discovered')
    await expect(page.locator('.markdown-body h1')).toHaveText('Automatic recovery live change')
    await expect(page.locator('.file-tree-row.file', { hasText: 'access-added.md' })).toBeVisible()
    const status = await page.evaluate(() => window.api.getDiagnosticLogStatus())
    const readEvents = () => readdirSync(status.effectiveDirectory!).filter(name => name.endsWith('.jsonl'))
      .flatMap(name => readFileSync(join(status.effectiveDirectory!, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
      .filter(event => event.event.startsWith('watcher.work.'))
    await expect.poll(() => readEvents().some(event => event.metadata?.state === 'healthy' && event.metadata?.watchGeneration === 2)).toBe(true)
    const events = readEvents()
    expect(events.some(event => event.metadata?.watchKind === 'root' && event.metadata?.state === 'degraded' &&
      event.metadata?.watchGeneration === 1 && event.metadata?.watchReason === 'timeout' &&
      Number(event.metadata?.startupElapsedMs) >= (mode === 'file-after-30s' ? 30000 : 120000))).toBe(true)
    expect(events.some(event => event.metadata?.watchKind === 'root' && event.metadata?.watchRetryStage === 'restart-requested')).toBe(true)
    expect(events.filter(event => event.operationId?.startsWith('watch_retry_'))).toHaveLength(0)
    expect(JSON.stringify(events)).not.toContain(testDir)
    expect(status.invalidEvents).toBe(0)
    await testInfo.attach('access-recovery-observation', { body: JSON.stringify({ mode, probe: await probe(), health: await health(), events }, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('access-after.png'), animations: 'disabled' })
  })
}


test('首次恢复读取跨过120秒：先绑定订阅，原读取成功后自动恢复，无补发读取', async ({ electronApp, page, testDir }, testInfo) => {
  test.setTimeout(160000)
  const profile = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  expect(basename(profile)).toMatch(/^md-viewer-e2e-user-data-/)
  const target = join(testDir, 'test1.md')
  await electronApp.evaluate(({ app, ipcMain, utilityProcess, BrowserWindow }, target) => {
    if (!app.getPath('userData').split('/').at(-1)?.startsWith('md-viewer-e2e-user-data-')) throw new Error('Independent fixture profile required')
    const fs = process.getBuiltinModule('node:module')!.createRequire(app.getAppPath() + '/package.json')('fs-extra')
    const readFile = fs.readFile
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe = { children: [] as any[], manualRetries: 0, io: [] as any[], watchCompletions: 0, heldResults: 0, heldReady: 0, released: false }
    ;(globalThis as any).__accessRecoveryProbe = probe
    ;(globalThis as any).__releaseOriginalStartupRead = () => {
      probe.released = true
      fs.readFile = readFile
      release()
    }
    fs.readFile = function (file: unknown, ...args: any[]) {
      const result = readFile.call(this, file, ...args)
      if (file !== target || args.some(value => typeof value === 'function')) return result
      return Promise.resolve(result).then(async content => {
        probe.heldResults++
        await gate
        return content
      })
    }
    const watch = (ipcMain as any)._invokeHandlers.get('fs:watchFolder')
    ipcMain.removeHandler('fs:watchFolder')
    ipcMain.handle('fs:watchFolder', async (...args) => {
      const result = await watch(...args)
      probe.watchCompletions++
      return result
    })
    const read = (ipcMain as any)._invokeHandlers.get('fs:readFile')
    ipcMain.removeHandler('fs:readFile')
    ipcMain.handle('fs:readFile', async (...args) => {
      const row = { watchCompletionsAtStart: probe.watchCompletions, start: performance.now(), end: 0 }
      probe.io.push(row)
      try { return await read(...args) }
      finally { row.end = performance.now() }
    })
    const retry = (ipcMain as any)._invokeHandlers.get('watch:retry')
    ipcMain.removeHandler('watch:retry')
    ipcMain.handle('watch:retry', (...args) => { probe.manualRetries++; return retry(...args) })
    const fork = utilityProcess.fork.bind(utilityProcess)
    utilityProcess.fork = (...args) => {
      const child = fork(...args)
      if (!args[0].endsWith('watcherProcess.js')) return child
      const entry = { roots: [] as any[], exited: false }
      probe.children.push(entry)
      const first = probe.children.length === 1
      child.once('exit', () => { entry.exited = true })
      const post = child.postMessage.bind(child)
      child.postMessage = (message, ports) => {
        if (message.type === 'create' && message.kind === 'root') entry.roots.push({ id: message.watchId, generation: message.watchGeneration, at: performance.now() })
        return post(message, ports)
      }
      const emit = child.emit.bind(child)
      child.emit = (event, ...values) => {
        const message = values[0]
        if (first && event === 'message' && message?.type === 'crawl-complete' && entry.roots.some(root => root.id === message.watchId)) {
          probe.heldReady++
          return true
        }
        return emit(event, ...values)
      }
      return child
    }
    // Authorize only this self-created fixture through the normal test opener.
    // Hold its initial navigation notification, then hydrate a synthetic shell on reload.
    const win = BrowserWindow.getAllWindows()[0]
    const send = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel, ...args) => {
      if (channel === 'restore-folder' || channel === 'workspace:folder-activated') return
      return send(channel, ...args)
    }
    ;(globalThis as any).__restoreStartupNavigation = () => { win.webContents.send = send }
    const bootstrap = (ipcMain as any)._invokeHandlers.get('workspace:getBootstrap')
    ipcMain.removeHandler('workspace:getBootstrap')
    ipcMain.handle('workspace:getBootstrap', async (...args) => {
      const result = await bootstrap(...args)
      const workspace = result.workspaces.find((item: any) => item.id === result.activeWorkspaceId)
      if (!workspace?.primaryRoot || target !== workspace.primaryRoot + '/test1.md') throw new Error('Synthetic bootstrap root mismatch')
      return { ...result, restoredRuntime: { workspaces: [{ id: workspace.id, name: 'Startup fixture', primaryRoot: workspace.primaryRoot,
        tabs: [{ id: 'startup-fixture-tab', relativePath: 'test1.md', isPinned: false }], activeTabId: 'startup-fixture-tab', splitState: { root: null, activeLeafId: '' } }] } }
    })
  }, target)
  try {
    await page.evaluate(path => window.api.testOpenMarkdownFile!(path), target)
    await electronApp.evaluate(() => (globalThis as any).__restoreStartupNavigation())
    await page.reload()
    await page.waitForSelector('.app')
    const probe = () => electronApp.evaluate(() => (globalThis as any).__accessRecoveryProbe)
    const health = () => page.evaluate(async () => {
      const bootstrap = await window.api.getWorkspaceBootstrap()
      const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
      return window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)
    })
    await expect.poll(async () => (await probe()).io.length).toBe(1)
    await expect.poll(async () => (await probe()).heldResults).toBeGreaterThanOrEqual(1)
    const initial = await probe()
    expect(initial.io[0].watchCompletionsAtStart).toBeGreaterThan(0)
    expect(initial.io[0].end).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('startup-original-read-held.png') })
    await expect.poll(async () => (await health()).state, { timeout: 35000 }).toBe('degraded')
    await expect.poll(async () => (await probe()).children[0].exited, { timeout: 95000 }).toBe(true)
    const stopped = await probe()
    expect(stopped.heldReady).toBeGreaterThan(0)
    expect(stopped.io).toHaveLength(1)
    expect(stopped.io[0].end).toBe(0)
    expect(stopped.manualRetries).toBe(0)
    await electronApp.evaluate(() => (globalThis as any).__releaseOriginalStartupRead())
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
    await expect.poll(async () => (await health()).state, { timeout: 15000 }).toBe('healthy')
    const recovered = await probe()
    expect(recovered.manualRetries).toBe(0)
    expect(recovered.children.flatMap((child: any) => child.roots).map((root: any) => root.generation)).toEqual([1, 2])
    expect(recovered.io[0].end).toBeGreaterThan(recovered.io[0].start)
    writeFileSync(target, '# Restored original read live update')
    writeFileSync(join(testDir, 'startup-added.md'), '# Startup discovery')
    await expect(page.locator('.markdown-body h1')).toHaveText('Restored original read live update')
    await expect(page.locator('.file-tree-row.file', { hasText: 'startup-added.md' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('startup-original-read-recovered.png') })
    await testInfo.attach('startup-original-read-observation', { body: JSON.stringify({ stopped, recovered, health: await health() }, null, 2), contentType: 'application/json' })
  } finally {
    await electronApp.evaluate(() => (globalThis as any).__releaseOriginalStartupRead?.()).catch(() => {})
  }
})
