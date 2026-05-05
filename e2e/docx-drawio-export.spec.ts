import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3179'
const SOURCE_MD = path.join(__dirname, 'fixtures/test-drawio.md')
const DOCX_PATH = process.env.MD_VIEWER_DRAWIO_DOCX_OUT || '/Users/mac/Documents/tmp/test-drawio.docx'

test.describe('DrawIO DOCX 导出', () => {
  test('长文档后部 DrawIO 图表不应因预览 DOM 缺失而降级为源码', async () => {
    test.setTimeout(900_000)
    fs.rmSync(DOCX_PATH, { force: true })
    fs.mkdirSync(path.dirname(DOCX_PATH), { recursive: true })

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../out/main/index.js'), SOURCE_MD],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MD_VIEWER_SKIP_RESTORE: '1',
        MD_VIEWER_TEST_SAVE_DOCX_PATH: DOCX_PATH,
      },
    })

    try {
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForSelector('.app', { timeout: 15_000 })
      await page.evaluate(filePath => window.api.testOpenMarkdownFile?.(filePath), SOURCE_MD)
      await expect(page.locator('.tab', { hasText: path.basename(SOURCE_MD) })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.markdown-body')).toContainText('DrawIO 全面测试文档', { timeout: 20_000 })

      await page.evaluate(serverUrl => {
        return window.api.updateAppSettings({
          docxExport: {
            remoteEnabled: true,
            serverUrl,
            style: 'preview',
            styleTouched: true,
            timeoutMs: 600_000,
            embedFont: false,
            localFallbackEnabled: false,
          },
        })
      }, SERVICE_URL)

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:export-docx')
      })

      await expect.poll(() => fs.existsSync(DOCX_PATH), {
        timeout: 600_000,
        message: `${DOCX_PATH} 应该被生成`,
      }).toBe(true)

      const exportPanel = page.locator('.export-task-panel')
      await expect(exportPanel).not.toContainText('第 70 个 drawio 图表渲染失败')
      await expect(exportPanel).not.toContainText('第 71 个 drawio 图表渲染失败')
      await expect(exportPanel).not.toContainText('第 72 个 drawio 图表渲染失败')
      await expect(exportPanel).not.toContainText('第 73 个 drawio 图表渲染失败')
    } finally {
      await electronApp.close()
    }

    const zip = new AdmZip(DOCX_PATH)
    const documentXml = zip.readAsText('word/document.xml')
    const pngCount = zip.getEntries()
      .filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png'))
      .length

    expect(pngCount, 'DOCX 应包含大量 DrawIO 渲染图片').toBeGreaterThanOrEqual(69)
    expect(documentXml, '第 69 个 DrawIO 不应以源码残留').not.toContain('mdv-electron-arch')
    expect(documentXml, '第 70 个 DrawIO 不应以源码残留').not.toContain('mdv-render-pipeline')
    expect(documentXml, '第 71 个 DrawIO 不应以源码残留').not.toContain('mdv-security-layers')
  })
})
