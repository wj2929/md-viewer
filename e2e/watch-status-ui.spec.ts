import { test, expect, openFolderViaIPC } from './fixtures/electron'
import type { WorkspaceWatchHealth } from '../src/shared/workspaceWatch'

test('自动刷新状态收进按钮，浅深色与窄窗口都不改变顶部高度', async ({ electronApp, page, testDir }, testInfo) => {
  await openFolderViaIPC(electronApp, testDir)
  await page.locator('.file-tree-row.file', { hasText: 'test1.md' }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  const context = await page.evaluate(async () => {
    const bootstrap = await window.api.getWorkspaceBootstrap()
    const workspace = bootstrap.workspaces.find(item => item.id === bootstrap.activeWorkspaceId)!
    return { workspaceId: workspace.id, lifecycleEpoch: workspace.lifecycleEpoch }
  })
  let version = 1000
  const send = async (state: WorkspaceWatchHealth['state'], partialCoverage = false) => {
    await electronApp.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send('watch:status', payload)
    }, { ...context, status: { version: ++version, state, partialCoverage, excludedDirectoryCount: partialCoverage ? 2 : 0, gapVersion: 1, reconciledGapVersion: 1 } })
  }
  const trigger = page.getByRole('button', { name: '刷新文件列表', exact: true })
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: theme === 'light' ? 1200 : 800, height: 700 })
    await send('healthy')
    const height = await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)
    for (const state of ['partial', 'recovering', 'degraded'] as const) {
      await send(state === 'partial' ? 'healthy' : state, state === 'partial')
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      expect(await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)).toBe(height)
      await expect(page.locator('.watch-status')).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.mouse.move(650, 650)
      await page.screenshot({ path: testInfo.outputPath(`watch-${state}-${theme}-collapsed.png`) })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '自动刷新状态' })
      await expect(dialog).toBeVisible()
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
      expect(await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height)).toBe(height)
      await page.screenshot({ path: testInfo.outputPath(`watch-${state}-${theme}-details.png`) })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(dialog).toHaveCount(0)
      if (state === 'recovering') {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        expect(await page.locator('.watch-refresh-icon').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' })
      }
    }
    await send('healthy')
    await expect(page.locator('.watch-refresh-mark')).toHaveCount(0)
    await expect(trigger).not.toHaveAttribute('aria-haspopup', 'dialog')
  }
})
