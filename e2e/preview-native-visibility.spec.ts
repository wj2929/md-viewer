import { test, expect, openFolderViaIPC } from './fixtures/electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('原生最小化后的DOM与帧观测：只操作隔离窗口，不替换rAF', async ({ electronApp, page, testDir }, info) => {
  await openFolderViaIPC(electronApp, testDir)
  const target = join(testDir, 'native-visibility.md')
  writeFileSync(target, '# Native visibility fixture\n\nPublic fixture only.\n')
  await page.evaluate(() => {
    const probe = { frames: 0, visibility: [] as object[] }
    ;(window as any).__nativeVisibilityProbe = probe
    const tick = () => { probe.frames++; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    document.addEventListener('visibilitychange', () => probe.visibility.push({ state: document.visibilityState, at: performance.now() }))
  })
  const state = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused() })))
  const records = () => electronApp.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('fs')!, path = process.getBuiltinModule('path')!
    const dir = path.join(app.getPath('userData'), 'diagnostic-logs')
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.jsonl')).flatMap(name => fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))) : []
  })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.showInactive()
      win.minimize()
    })
    await expect.poll(async () => (await state())[0]?.minimized).toBe(true)
    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), target)
    await expect(page.locator('.markdown-body h1')).toHaveText('Native visibility fixture')
    const initial = await page.evaluate(() => ({ ...(window as any).__nativeVisibilityProbe, state: document.visibilityState }))
    await page.waitForTimeout(6500)
    const minimized = { window: await state(), page: await page.evaluate(() => ({ ...(window as any).__nativeVisibilityProbe, state: document.visibilityState })), events: await records() }
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await expect.poll(async () => (await state())[0]?.minimized).toBe(false)
    await expect.poll(async () => (await records()).some(event => event.metadata?.previewState === 'preview-ready'), { timeout: 15_000 }).toBe(true)
    writeFileSync(info.outputPath('native-visibility.json'), JSON.stringify({ method: '自有窗口showInactive后原生minimize，观测6500ms，再showInactive；无rAF替身、无后台节流开关。原生最小化不是全遮挡复现。', initial, minimized, restored: { window: await state(), page: await page.evaluate(() => ({ ...(window as any).__nativeVisibilityProbe, state: document.visibilityState })), events: await records() } }, null, 2))
    await page.screenshot({ path: info.outputPath('native-restored.png') })
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide()).catch(() => {})
  }
})
