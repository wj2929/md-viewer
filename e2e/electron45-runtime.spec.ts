import { test, expect, openFolderViaIPC } from './fixtures/electron'

test('Electron45候选运行时、沙箱preload与根监听实际就绪', async ({ electronApp, page, testDir }, info) => {
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  await expect.poll(() => page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return (await window.api.getWatchStatus(workspace.id, workspace.lifecycleEpoch)).state
  })).toBe('healthy')
  const runtime = await electronApp.evaluate(({ app, BrowserWindow }) => ({
    versions: process.versions,
    arch: process.arch,
    appVersion: app.getVersion(),
    windows: BrowserWindow.getAllWindows().map(window => ({
      sandbox: window.webContents.getLastWebPreferences().sandbox,
      contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
      nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration,
      visible: window.isVisible(),
    })),
    processes: app.getAppMetrics().map(metric => ({ type: metric.type, serviceName: metric.serviceName })),
  }))
  expect(runtime.versions.electron).toBe('45.2.2')
  expect(runtime.arch).toBe(process.arch)
  expect(runtime.windows).toEqual([{ sandbox: true, contextIsolation: true, nodeIntegration: false, visible: false }])
  await info.attach('actual-runtime', { body: JSON.stringify(runtime, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('runtime-bridge.png'), animations: 'disabled' })
})
