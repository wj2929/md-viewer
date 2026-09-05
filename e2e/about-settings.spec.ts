import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const projectRoot = process.cwd()

test.describe('设置关于页', () => {
  test('不显示本地诊断包入口', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'md-viewer-about-e2e-'))
    let electronApp: ElectronApplication | undefined

    try {
      electronApp = await electron.launch({
        args: [`--user-data-dir=${userDataDir}`, join(projectRoot, 'out', 'main', 'index.js')],
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MD_VIEWER_SKIP_RESTORE: '1',
        },
      })
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '设置' }).click()
      await page.getByRole('tab', { name: '关于' }).click()

      await expect(page.getByRole('heading', { name: '本地诊断包' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '选择保存位置…' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '系统信息' })).toBeVisible()
    } finally {
      await electronApp?.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
