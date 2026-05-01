import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3183'
const CCE_MD = process.env.MD_VIEWER_CCE_MD || '/Users/mac/Documents/SynologyDrive/国开在线/研发中心/专项工作/一网/cce/华为云/CCE集群外挂存储详情.md'
const OUT_DIR = process.env.MD_VIEWER_CCE_DOCX_OUT || '/tmp/mdv-cce-mode-b-docx-quality'
const SAVE_TEMPLATE = path.join(OUT_DIR, 'cce-{style}.docx')

type DocxImageInfo = {
  name: string
  width: number
  height: number
  bytes: number
}

const STYLES = ['preview', 'standard', 'official', 'internal', 'report'] as const

test.describe('CCE 真实文档 DOCX 图表导出', () => {
  test.skip(!fs.existsSync(CCE_MD), `真实 CCE Markdown 不存在：${CCE_MD}`)

  test('Electron 真实导出路径应生成已渲染图表的五种 DOCX', async () => {
    test.setTimeout(420_000)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    for (const style of STYLES) {
      fs.rmSync(path.join(OUT_DIR, `cce-${style}.docx`), { force: true })
    }

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../out/main/index.js'), CCE_MD],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MD_VIEWER_SKIP_RESTORE: '1',
        MD_VIEWER_TEST_SAVE_DOCX_PATH: SAVE_TEMPLATE,
      },
    })

    try {
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForSelector('.app', { timeout: 15_000 })

      await page.evaluate(filePath => window.api.testOpenMarkdownFile?.(filePath), CCE_MD)
      const fileName = path.basename(CCE_MD)
      await expect(page.locator('.tab', { hasText: fileName })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.markdown-body')).toContainText('CCE', { timeout: 20_000 })

      await page.waitForTimeout(6_000)

      for (const style of STYLES) {
        await page.evaluate(({ serverUrl, style }) => {
          return window.api.updateAppSettings({
            docxExport: {
              remoteEnabled: true,
              serverUrl,
              style,
              styleTouched: true,
              timeoutMs: 180_000,
              embedFont: true,
              localFallbackEnabled: false,
            },
          })
        }, { serverUrl: SERVICE_URL, style })

        await electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          win.webContents.send('markdown:export-docx')
        })

        const target = path.join(OUT_DIR, `cce-${style}.docx`)
        await expect.poll(() => fs.existsSync(target), {
          timeout: 180_000,
          message: `${target} 应该被生成`,
        }).toBe(true)

        const info = inspectDocxImages(target)
        if (style === 'preview') {
          expect(info.length, 'preview 应包含全部图表图片').toBe(25)
        } else {
          expect(info.length, `${style} 应包含图表图片`).toBeGreaterThanOrEqual(23)
        }

        const realRendered = info.filter(img => img.width !== 1400 && img.bytes > 2_000)
        if (style === 'preview') {
          expect(realRendered.length, 'preview 不应有源码 fallback 图').toBe(25)
        } else {
          expect(realRendered.length, `${style} 不应主要是服务端源码降级图`).toBeGreaterThanOrEqual(20)
        }

        const closeButton = page.locator('.export-task-header-btn[title="关闭"]').first()
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click()
        }
      }
    } finally {
      await electronApp.close()
    }
  })
})

function inspectDocxImages(docxPath: string): DocxImageInfo[] {
  const zip = new AdmZip(docxPath)
  return zip.getEntries()
    .filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png'))
    .map(entry => {
      const data = entry.getData()
      const png = readPngSize(data)
      return {
        name: entry.entryName,
        width: png.width,
        height: png.height,
        bytes: data.length,
      }
    })
}

function readPngSize(data: Buffer): { width: number; height: number } {
  const signature = data.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('不是 PNG 图片')
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  }
}
