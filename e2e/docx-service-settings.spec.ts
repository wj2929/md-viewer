import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

const APP_MAIN = path.join(__dirname, '..', 'out/main/index.js')
const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3184'

test.describe('DOCX 服务设置联调', () => {
  test('真实 Electron 进程可以连接本地 DOCX 服务并显示服务能力', async () => {
    const electronApp = await electron.launch({
      args: [APP_MAIN],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MD_VIEWER_SKIP_RESTORE: '1',
      },
    })

    const page = await electronApp.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    try {
      await page.waitForLoadState('domcontentloaded')
      await page.waitForSelector('.app', { timeout: 10000 })

      const connection = await page.evaluate(async (serverUrl) => {
        return window.api.testDocxConnection(serverUrl)
      }, SERVICE_URL)

      expect(connection.ok).toBe(true)
      expect(connection.version).toBe('0.1.0')
      expect(connection.mode).toBe('full')
      expect(connection.chartRenderersAvailable).toContain('mermaid')

      await page.evaluate(async (serverUrl) => {
        await window.api.updateAppSettings({
          docxExport: {
            remoteEnabled: true,
            serverUrl,
            style: 'standard',
            timeoutMs: 60000,
            embedFont: true,
            localFallbackEnabled: false,
          },
        })
      }, SERVICE_URL)

      await page.locator('.nav-settings-btn').click()
      const docxSection = page.locator('.settings-section').filter({ hasText: 'DOCX 导出服务' })
      await expect(docxSection).toBeVisible()
      await expect(docxSection.locator('input.settings-input').first()).toHaveValue(SERVICE_URL)

      await docxSection.getByRole('button', { name: '测试' }).click()
      await expect(docxSection.locator('.docx-test-result-summary')).toContainText('v0.1.0')
      await expect(docxSection.locator('.docx-test-result-summary')).toContainText('full')

      await docxSection.locator('.docx-test-detail-toggle').click()
      await expect(docxSection.locator('.docx-test-result-detail')).toContainText('服务端渲染')
      await expect(docxSection.locator('.docx-test-result-detail')).toContainText('mermaid')

      expect(pageErrors).toEqual([])
    } finally {
      await electronApp.close()
    }
  })
})
