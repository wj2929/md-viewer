import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3184'
const CCE_MD = process.env.MD_VIEWER_CCE_MD || ''
const OUT_DIR = process.env.MD_VIEWER_CCE_DOCX_OUT || '/tmp/mdv-cce-preview-docx-quality'
const DOCX_PATH = path.join(OUT_DIR, 'cce-preview.docx')
const SAVE_TEMPLATE = path.join(OUT_DIR, 'cce-{style}.docx')

const SOFFICE = process.env.SOFFICE_BIN || findExecutable([
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
])
const PDFINFO = process.env.PDFINFO_BIN || findExecutable(['pdfinfo'])

test.describe('CCE preview DOCX 视觉指标', () => {
  test.skip(!CCE_MD, '未设置 MD_VIEWER_CCE_MD，跳过真实 CCE Markdown 视觉检查')
  test.skip(!fs.existsSync(CCE_MD), `真实 CCE Markdown 不存在：${CCE_MD}`)
  test.skip(!SOFFICE, '缺少 soffice，无法将 DOCX 转 PDF')
  test.skip(!PDFINFO, '缺少 pdfinfo，无法读取 PDF 页面指标')

  test('preview DOCX 转 PDF 后应接近 A4 预览密度', async () => {
    test.setTimeout(300_000)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.rmSync(DOCX_PATH, { force: true })
    fs.rmSync(path.join(OUT_DIR, 'cce-preview.pdf'), { force: true })

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
      await expect(page.locator('.markdown-body')).toContainText('CCE', { timeout: 20_000 })
      await page.waitForTimeout(6_000)

      await page.evaluate(({ serverUrl }) => {
        return window.api.updateAppSettings({
          docxExport: {
            remoteEnabled: true,
            serverUrl,
            style: 'preview',
            styleTouched: true,
            timeoutMs: 180_000,
            embedFont: true,
            localFallbackEnabled: false,
          },
        })
      }, { serverUrl: SERVICE_URL })

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('markdown:export-docx')
      })

      await expect.poll(() => fs.existsSync(DOCX_PATH), {
        timeout: 180_000,
        message: `${DOCX_PATH} 应该被生成`,
      }).toBe(true)
    } finally {
      await electronApp.close()
    }

    const docxMetrics = inspectPreviewDocx(DOCX_PATH)
    expect(docxMetrics.imageCount, 'preview 应包含全部 25 张图表').toBe(25)
    expect(docxMetrics.hasPreviewTableHeader, 'preview 表头应使用浅灰底色').toBe(true)
    expect(docxMetrics.isA4, 'preview DOCX 页面应为 A4').toBe(true)

    execFileSync(SOFFICE!, ['--headless', '--convert-to', 'pdf', '--outdir', OUT_DIR, DOCX_PATH], {
      timeout: 120_000,
      stdio: 'pipe',
    })

    const pdfPath = path.join(OUT_DIR, 'cce-preview.pdf')
    await expect.poll(() => fs.existsSync(pdfPath), {
      timeout: 30_000,
      message: `${pdfPath} 应该被生成`,
    }).toBe(true)

    const pdfInfo = execFileSync(PDFINFO!, [pdfPath], { encoding: 'utf-8' })
    const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1] || '0')
    expect(pages, 'preview DOCX 转 PDF 页数应接近 28 页 PDF 基准').toBeGreaterThan(0)
    expect(pages, 'preview DOCX 转 PDF 页数不应明显膨胀').toBeLessThanOrEqual(32)
    expect(isA4Pdf(pdfInfo), 'preview DOCX 转 PDF 页面应为 A4').toBe(true)
  })
})

function inspectPreviewDocx(docxPath: string): {
  imageCount: number
  hasPreviewTableHeader: boolean
  isA4: boolean
} {
  const zip = new AdmZip(docxPath)
  const xml = zip.readAsText('word/document.xml')
  const imageCount = zip.getEntries()
    .filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png'))
    .length

  return {
    imageCount,
    hasPreviewTableHeader: xml.includes('w:fill="F6F8FA"'),
    isA4: xml.includes('w:w="11906"') && xml.includes('w:h="16838"'),
  }
}

function isA4Pdf(pdfInfo: string): boolean {
  if (/Page size:.*\bA4\b/i.test(pdfInfo)) return true
  const match = pdfInfo.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m)
  if (!match) return false
  const width = Number(match[1])
  const height = Number(match[2])
  return width >= 590 && width <= 600 && height >= 835 && height <= 850
}

function findExecutable(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate
      continue
    }
    try {
      const found = execFileSync('bash', ['-lc', `command -v ${candidate}`], { encoding: 'utf-8' }).trim()
      if (found) return found
    } catch {
      // 继续尝试下一个候选
    }
  }
  return undefined
}
