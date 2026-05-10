import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3184'
const MD_ROOT = process.env.MD_VIEWER_HUAWEI_MD_ROOT || ''
const OUT_DIR = process.env.MD_VIEWER_HUAWEI_DOCX_OUT || '/tmp/mdv-huawei-cloud-docx-batch'
const SAVE_TEMPLATE = path.join(OUT_DIR, '{name}-{style}.docx')

const SOFFICE = process.env.SOFFICE_BIN || findExecutable([
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
])
const PDFINFO = process.env.PDFINFO_BIN || findExecutable(['pdfinfo'])

const CASES = [
  { file: '华为云资源架构与服务链路.md', minImages: 10 },
  { file: 'K8s架构图与云资源配置.md', minImages: 4 },
  { file: '学习网CCE域名梳理.md', minImages: 5 },
  { file: 'CCE集群全面分析与迁移方案.md', minImages: 6 },
  { file: '迁移配置实际状态清单（阿里云ACK）.md', minImages: 0 },
  { file: '阿里云ACK集群当前情况全面分析.md', minImages: 0 },
] as const

test.describe('华为云 Markdown 批量 DOCX 导出', () => {
  test.skip(!MD_ROOT, '未设置 MD_VIEWER_HUAWEI_MD_ROOT，跳过真实 Markdown 批量导出检查')
  test.skip(!fs.existsSync(MD_ROOT), `Markdown 目录不存在：${MD_ROOT}`)
  test.skip(!SOFFICE, '缺少 soffice，无法将 DOCX 转 PDF')
  test.skip(!PDFINFO, '缺少 pdfinfo，无法读取 PDF 页面指标')

  for (const item of CASES) {
    const mdPath = path.join(MD_ROOT, item.file)
    test.skip(!fs.existsSync(mdPath), `Markdown 文件不存在：${mdPath}`)
  }

  test('应能批量导出多类真实文档并转换为 A4 PDF', async () => {
    test.setTimeout(900_000)
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const firstDoc = path.join(MD_ROOT, CASES[0].file)
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../out/main/index.js'), firstDoc],
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

      await page.evaluate(({ serverUrl }) => {
        return window.api.updateAppSettings({
          docxExport: {
            remoteEnabled: true,
            serverUrl,
            style: 'preview',
            styleTouched: true,
            timeoutMs: 240_000,
            embedFont: true,
            localFallbackEnabled: false,
          },
        })
      }, { serverUrl: SERVICE_URL })

      for (const item of CASES) {
        const mdPath = path.join(MD_ROOT, item.file)
        const expectedDocx = path.join(OUT_DIR, `${path.basename(item.file, '.md')}-preview.docx`)
        fs.rmSync(expectedDocx, { force: true })

        await page.evaluate(filePath => window.api.testOpenMarkdownFile?.(filePath), mdPath)
        await expect(page.locator('.tab', { hasText: item.file })).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('.markdown-body')).toBeVisible({ timeout: 20_000 })
        await page.waitForTimeout(6_000)

        await electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          win.webContents.send('markdown:export-docx')
        })

        await expect.poll(() => fs.existsSync(expectedDocx), {
          timeout: 240_000,
          message: `${expectedDocx} 应该被生成`,
        }).toBe(true)

        const metrics = inspectDocx(expectedDocx)
        expect(metrics.hasDocumentXml, `${item.file} 应包含 word/document.xml`).toBe(true)
        expect(metrics.size, `${item.file} DOCX 文件不应为空`).toBeGreaterThan(20_000)
        expect(metrics.imageCount, `${item.file} 图表图片数量`).toBeGreaterThanOrEqual(item.minImages)

        const closeButton = page.locator('.export-task-header-btn[title="关闭"]').first()
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click()
        }
      }
    } finally {
      await electronApp.close()
    }

    for (const item of CASES) {
      const docxPath = path.join(OUT_DIR, `${path.basename(item.file, '.md')}-preview.docx`)
      execFileSync(SOFFICE!, ['--headless', '--convert-to', 'pdf', '--outdir', OUT_DIR, docxPath], {
        timeout: 180_000,
        stdio: 'pipe',
      })
      const pdfPath = docxPath.replace(/\.docx$/i, '.pdf')
      expect(fs.existsSync(pdfPath), `${item.file} 应能转换为 PDF`).toBe(true)

      const pdfInfo = execFileSync(PDFINFO!, [pdfPath], { encoding: 'utf-8' })
      const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1] || '0')
      expect(pages, `${item.file} PDF 页数应大于 0`).toBeGreaterThan(0)
      expect(isA4Pdf(pdfInfo), `${item.file} PDF 页面应为 A4`).toBe(true)
    }
  })
})

function inspectDocx(docxPath: string): {
  hasDocumentXml: boolean
  imageCount: number
  size: number
} {
  const zip = new AdmZip(docxPath)
  const entries = zip.getEntries()
  return {
    hasDocumentXml: entries.some(entry => entry.entryName === 'word/document.xml'),
    imageCount: entries.filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png')).length,
    size: fs.statSync(docxPath).size,
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
