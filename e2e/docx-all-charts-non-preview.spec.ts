import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3179'
const SOURCE_MD = process.env.MD_VIEWER_ALL_CHARTS_MD || path.join(__dirname, 'fixtures/test-all-charts.md')
const OUT_DIR = process.env.MD_VIEWER_ALL_CHARTS_DOCX_OUT || '/tmp/mdv-all-charts-docx-non-preview-check'
const SAVE_TEMPLATE = path.join(OUT_DIR, 'test-all-charts-{style}.docx')
const ALL_STYLES = ['standard', 'official', 'internal', 'report'] as const
const STYLES = selectStyles(process.env.MD_VIEWER_ALL_CHARTS_DOCX_STYLES)
const SOFFICE = process.env.SOFFICE_BIN || findExecutable([
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
])
const PDFINFO = process.env.PDFINFO_BIN || findExecutable([
  'pdfinfo',
  '/opt/homebrew/bin/pdfinfo',
])
const PDFTOPPM = process.env.PDFTOPPM_BIN || findExecutable([
  'pdftoppm',
  '/opt/homebrew/bin/pdftoppm',
])
const PYTHON = process.env.PYTHON_BIN || findPythonWithPillow([
  '/opt/anaconda3/bin/python3',
  'python3',
])

test.describe('test-all-charts 非 preview DOCX 格式检查', () => {
  test.skip(!SOFFICE, '缺少 soffice，无法将 DOCX 转 PDF')
  test.skip(!PDFINFO, '缺少 pdfinfo，无法读取 PDF 页面指标')
  test.skip(!PDFTOPPM, '缺少 pdftoppm，无法将 PDF 页面渲染为 PNG')
  test.skip(!PYTHON, '缺少 Python，无法分析页面视觉指标')

  test('standard / official / internal / report 都应正确渲染图表与公式', async () => {
    test.setTimeout(2_400_000)
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../out/main/index.js'), SOURCE_MD],
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
      await page.evaluate(filePath => window.api.testOpenMarkdownFile?.(filePath), SOURCE_MD)
      await expect(page.locator('.tab', { hasText: path.basename(SOURCE_MD) })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.markdown-body')).toContainText('全部图表类型汇总测试', { timeout: 20_000 })
      await page.waitForTimeout(8_000)

      for (const style of STYLES) {
        await page.evaluate(({ serverUrl, style }) => {
          return window.api.updateAppSettings({
            docxExport: {
              remoteEnabled: true,
              serverUrl,
              style,
              styleTouched: true,
              timeoutMs: 600_000,
              embedFont: true,
              localFallbackEnabled: false,
            },
          })
        }, { serverUrl: SERVICE_URL, style })

        await electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:export-docx')
        })

        const target = docxPathFor(style)
        await expect.poll(() => fs.existsSync(target), {
          timeout: 600_000,
          message: `${target} 应该被生成`,
        }).toBe(true)

        const closeButton = page.locator('.export-task-header-btn[title="关闭"]').first()
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click()
        }
      }
    } finally {
      await electronApp.close()
    }

    const summary: Record<string, unknown> = {}
    for (const style of STYLES) {
      const docxPath = docxPathFor(style)
      const metrics = inspectDocx(docxPath)
      const pdfPath = convertDocxToPdf(docxPath)
      const pdf = inspectPdf(pdfPath)
      const visual = inspectPdfVisualHealth(pdfPath, style, pdf.pages)
      summary[style] = { ...metrics, pdf, visual }

      expect(metrics.pngCount, `${style} 应包含全部图表/公式图片`).toBeGreaterThanOrEqual(79)
      expect(metrics.rawMarkerCount, `${style} 不应残留源码或图表占位符`).toBe(0)
      expect(metrics.notCenteredImageParagraphs, `${style} 图表/公式段落应居中`).toBe(0)
      expect(metrics.oversizedImages, `${style} 图片尺寸不应超出版心预算`).toEqual([])
      expect(metrics.katexFallbackText, `${style} 不应把 KaTeX 降级为源码图片`).toBe(false)
      expect(pdf.pages, `${style} 转 PDF 后应有页`).toBeGreaterThan(0)
      expect(pdf.pages, `${style} 页数不应异常膨胀`).toBeLessThanOrEqual(90)
      expect(visual.firstPageContentRatio, `${style} 首页不应大面积空白`).toBeGreaterThan(0.012)
      expect(visual.firstPageBottom, `${style} 首页正文应进入页面主体区域`).toBeGreaterThan(0.45)
      expect(
        visual.failures,
        `${style} PDF 全页视觉检查失败：${visual.failures.slice(0, 10).join('; ')}`,
      ).toEqual([])
    }

    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  })
})

function docxPathFor(style: string): string {
  return path.join(OUT_DIR, `test-all-charts-${style}.docx`)
}

function selectStyles(value: string | undefined): string[] {
  if (!value) return [...ALL_STYLES]
  const selected = value.split(',').map(item => item.trim()).filter(Boolean)
  return selected.filter(style => (ALL_STYLES as readonly string[]).includes(style))
}

function inspectDocx(docxPath: string) {
  const zip = new AdmZip(docxPath)
  const xml = zip.readAsText('word/document.xml')
  const rels = zip.readAsText('word/_rels/document.xml.rels')
  const pngCount = zip.getEntries().filter(entry =>
    entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png')
  ).length
  const rawMarkerCount = [
    '\\\\frac', '\\\\sqrt', '\\\\begin', 'mdv__chart__', '```',
    'classDiagram', 'stateDiagram', 'erDiagram', 'mindmap', '<mxGraphModel',
  ].reduce((count, marker) => count + countOccurrences(xml, marker), 0)
  const relMap = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const imageParagraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
    .map(match => match[1])
    .filter(p => /<a:blip r:embed="/.test(p))
  const notCenteredImageParagraphs = imageParagraphs.filter(p => !/<w:jc w:val="center"/.test(p)).length
  const oversizedImages = imageParagraphs.flatMap(p => {
    const rid = p.match(/<a:blip r:embed="([^"]+)"/)?.[1] || ''
    const target = relMap.get(rid) || ''
    const extent = p.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)
    if (!extent) return []
    const widthCm = Number(extent[1]) / 360000
    const heightCm = Number(extent[2]) / 360000
    if (widthCm > 19.1 || heightCm > 24.2) return [`${target}:${widthCm.toFixed(2)}x${heightCm.toFixed(2)}cm`]
    return []
  })

  return {
    pngCount,
    rawMarkerCount,
    imageParagraphCount: imageParagraphs.length,
    notCenteredImageParagraphs,
    oversizedImages,
    katexFallbackText: xml.includes('KaTeX 公式渲染失败') || xml.includes('行内公式渲染失败'),
  }
}

function convertDocxToPdf(docxPath: string): string {
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf')
  fs.rmSync(pdfPath, { force: true })
  execFileSync(SOFFICE!, ['--headless', '--convert-to', 'pdf', '--outdir', OUT_DIR, docxPath], {
    timeout: 180_000,
    stdio: 'pipe',
  })
  return pdfPath
}

function inspectPdf(pdfPath: string) {
  const info = execFileSync(PDFINFO!, [pdfPath], { encoding: 'utf-8' })
  return {
    pages: Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0),
    pageSize: info.match(/^Page size:\s+(.+)$/m)?.[1] || '',
  }
}

function inspectPdfVisualHealth(pdfPath: string, style: string, pages: number) {
  const pagePaths = renderAllPdfPages(pdfPath, style)
  const failures: string[] = []
  const metrics = pagePaths.map((pngPath, index) => {
    const metric = analyzePng(pngPath)
    const page = index + 1
    if (metric.contentRatio < 0.001) {
      failures.push(`p${page}: near_blank=${metric.contentRatio.toFixed(4)}`)
    }
    if (metric.edgeInkRatio > 0.008) {
      failures.push(`p${page}: edge_ink=${metric.edgeInkRatio.toFixed(4)}`)
    }
    if (metric.hardEdgeFlags.length > 0) {
      failures.push(`p${page}: hard_edge=${metric.hardEdgeFlags.join(',')}`)
    }
    return metric
  })
  expect(metrics.length, `${style} 渲染出的 PNG 页数应等于 PDF 页数`).toBe(pages)

  const firstPage = metrics[0]
  return {
    pages,
    firstPageContentRatio: firstPage?.contentRatio ?? 0,
    firstPageBottom: firstPage?.bbox?.[3] ?? 0,
    minContentRatio: Math.min(...metrics.map(metric => metric.contentRatio)),
    maxContentRatio: Math.max(...metrics.map(metric => metric.contentRatio)),
    failures,
  }
}

function renderAllPdfPages(pdfPath: string, style: string): string[] {
  const dir = path.join(OUT_DIR, 'visual-pages', style)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const prefix = path.join(dir, 'page')
  execFileSync(PDFTOPPM!, ['-r', '90', '-png', pdfPath, prefix], {
    timeout: 180_000,
    stdio: 'pipe',
  })
  return fs.readdirSync(dir)
    .filter(name => /^page-\d+\.png$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map(name => path.join(dir, name))
}

function analyzePng(pngPath: string): {
  contentRatio: number
  edgeInkRatio: number
  bbox: [number, number, number, number] | null
  hardEdgeFlags: string[]
} {
  const script = `
import json
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
pixels = im.load()
non_white = 0
edge_ink = 0
edge_total = 0
min_x, min_y = w, h
max_x, max_y = -1, -1
margin = max(1, int(min(w, h) * 0.03))

for y in range(h):
    for x in range(w):
        r, g, b = pixels[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        in_edge = x < margin or x >= w - margin or y < margin or y >= h - margin
        if in_edge:
            edge_total += 1
        if lum < 248:
            non_white += 1
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            if in_edge:
                edge_ink += 1

result = {
    "contentRatio": non_white / (w * h),
    "edgeInkRatio": edge_ink / max(edge_total, 1),
    "bbox": None if non_white == 0 else [min_x / w, min_y / h, max_x / w, max_y / h],
    "hardEdgeFlags": [],
}
if non_white != 0:
    left, top, right, bottom = result["bbox"]
    if left < 0.01:
        result["hardEdgeFlags"].append("LEFT")
    if right > 0.99:
        result["hardEdgeFlags"].append("RIGHT")
    if top < 0.01:
        result["hardEdgeFlags"].append("TOP")
    if bottom > 0.99:
        result["hardEdgeFlags"].append("BOTTOM")
print(json.dumps(result))
`
  return JSON.parse(execFileSync(PYTHON!, ['-c', script, pngPath], { encoding: 'utf-8' }))
}

function findExecutable(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate
      continue
    }
    try {
      execFileSync('which', [candidate], { stdio: 'ignore' })
      return candidate
    } catch {
      // continue
    }
  }
  return undefined
}

function findPythonWithPillow(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const executable = candidate.includes('/') && !fs.existsSync(candidate)
      ? undefined
      : candidate.includes('/')
        ? candidate
        : findExecutable([candidate])
    if (!executable) continue
    try {
      execFileSync(executable, ['-c', 'from PIL import Image'], { stdio: 'ignore' })
      return executable
    } catch {
      // continue
    }
  }
  return undefined
}

function countOccurrences(value: string, needle: string): number {
  let count = 0
  let index = value.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}
