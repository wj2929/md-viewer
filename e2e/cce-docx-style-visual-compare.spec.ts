import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3187'
const CCE_MD = process.env.MD_VIEWER_CCE_MD || '/Users/mac/Documents/SynologyDrive/国开在线/研发中心/专项工作/一网/cce/华为云/CCE集群外挂存储详情.md'
const BASELINE_PDF = process.env.MD_VIEWER_CCE_BASELINE_PDF
const OUT_DIR = process.env.MD_VIEWER_CCE_DOCX_VISUAL_OUT || '/tmp/mdv-cce-docx-style-visual-compare'
const SAVE_TEMPLATE = path.join(OUT_DIR, 'cce-{style}.docx')

const SOFFICE = process.env.SOFFICE_BIN || findExecutable([
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
])
const PDFINFO = process.env.PDFINFO_BIN || findExecutable(['pdfinfo'])
const PDFTOPPM = process.env.PDFTOPPM_BIN || findExecutable(['pdftoppm'])
const PYTHON = process.env.PYTHON_BIN || findPythonWithPillow([
  'python',
  'python3',
  '/opt/anaconda3/bin/python',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
])

const STYLES = ['preview', 'standard', 'official', 'internal', 'report'] as const
type DocxStyle = typeof STYLES[number]
const NON_PREVIEW_STYLES = ['standard', 'official', 'internal', 'report'] as const
const NON_PREVIEW_BASELINE_CONTENT_TOLERANCE: Record<Exclude<DocxStyle, 'preview'>, number> = {
  standard: 0.11,
  official: 0.12,
  internal: 0.12,
  report: 0.11,
}

type DocxImageInfo = {
  name: string
  width: number
  height: number
  bytes: number
  edgeFlags?: string[]
}

type DocxMetrics = {
  imageCount: number
  realRenderedCount: number
  hasFallbackText: boolean
  unsafeEdgeImageCount?: number
  unsafeEdgeImages?: string[]
}

type PdfMetrics = {
  pages: number
  isA4: boolean
  pageSize: string
}

type VisualMetrics = {
  width: number
  height: number
  contentRatio: number
  darkRatio: number
  edgeInkRatio: number
  bbox: [number, number, number, number] | null
  hardEdgeFlags: string[]
}

type PdfPageHealthSummary = {
  pages: number
  failureCount: number
  failures: string[]
  warnings: string[]
  minContentRatio: number
  maxContentRatio: number
  maxEdgeInkRatio: number
  hardEdgePages: number[]
}

test.describe('CCE DOCX 样式 E2E 与视觉比对', () => {
  test.skip(!fs.existsSync(CCE_MD), `真实 CCE Markdown 不存在：${CCE_MD}`)
  test.skip(!SOFFICE, '缺少 soffice，无法将 DOCX 转 PDF')
  test.skip(!PDFINFO, '缺少 pdfinfo，无法读取 PDF 页面指标')
  test.skip(!PDFTOPPM, '缺少 pdftoppm，无法将 PDF 渲染为 PNG')
  test.skip(!PYTHON, '缺少带 Pillow 的 Python，无法分析 PNG 视觉指标')

  test('真实导出的五种 DOCX 应能生成 PDF 视觉对照并满足版面健康指标', async ({}, testInfo) => {
    test.setTimeout(540_000)
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
    fs.mkdirSync(OUT_DIR, { recursive: true })

    let currentPdfBaseline = ''
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
      await expect(page.locator('.tab', { hasText: path.basename(CCE_MD) })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.markdown-body')).toContainText('CCE', { timeout: 20_000 })
      await page.waitForTimeout(6_000)

      if (!BASELINE_PDF) {
        currentPdfBaseline = path.join(OUT_DIR, 'cce-current-pdf-baseline.pdf')
        fs.rmSync(currentPdfBaseline, { force: true })
        await electronApp.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
        }, currentPdfBaseline)

        await electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          win.webContents.send('markdown:export-pdf')
        })

        await expect.poll(() => fs.existsSync(currentPdfBaseline), {
          timeout: 180_000,
          message: `${currentPdfBaseline} 应该被生成`,
        }).toBe(true)
      }

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

        const target = docxPathFor(style)
        await expect.poll(() => fs.existsSync(target), {
          timeout: 180_000,
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

    const docxMetrics: Record<DocxStyle, DocxMetrics> = {} as Record<DocxStyle, DocxMetrics>
    const pdfMetrics: Record<DocxStyle, PdfMetrics> = {} as Record<DocxStyle, PdfMetrics>
    const visualMetrics: Record<DocxStyle, VisualMetrics> = {} as Record<DocxStyle, VisualMetrics>
    const allPageHealth: Record<DocxStyle, PdfPageHealthSummary> = {} as Record<DocxStyle, PdfPageHealthSummary>

    for (const style of STYLES) {
      const target = docxPathFor(style)
      docxMetrics[style] = inspectDocx(target, true)
      expect(docxMetrics[style].hasFallbackText, `${style} 不应保留 DrawIO fallback 文案`).toBe(false)
      expect(docxMetrics[style].unsafeEdgeImageCount, `${style} 图表图片不应贴边：${docxMetrics[style].unsafeEdgeImages?.join('; ') || 'none'}`).toBe(0)
      if (style === 'preview') {
        expect(docxMetrics[style].imageCount, 'preview 应包含全部图表图片').toBe(25)
        expect(docxMetrics[style].realRenderedCount, 'preview 不应有源码 fallback 图').toBe(25)
      } else {
        expect(docxMetrics[style].imageCount, `${style} 应包含全部图表图片`).toBe(25)
        expect(docxMetrics[style].realRenderedCount, `${style} 不应主要是服务端源码降级图`).toBe(25)
      }

      const pdfPath = convertDocxToPdf(target)
      pdfMetrics[style] = inspectPdf(pdfPath)
      expect(pdfMetrics[style].pages, `${style} PDF 页数应大于 0`).toBeGreaterThan(0)
      expect(pdfMetrics[style].isA4, `${style} PDF 页面应为 A4`).toBe(true)
      allPageHealth[style] = inspectAllPdfPages(pdfPath, style, pdfMetrics[style].pages)
      expect(
        allPageHealth[style].failureCount,
        `${style} PDF 全页视觉健康检查失败：${allPageHealth[style].failures.slice(0, 8).join('; ')}`,
      ).toBe(0)

      const firstPagePng = renderPdfPage(pdfPath, `${style}-page1`, 1)
      visualMetrics[style] = analyzePng(firstPagePng)
      assertHealthyFirstPage(style, visualMetrics[style])

      renderPdfPage(pdfPath, `${style}-page2`, 2)
    }

    const baselinePdf = BASELINE_PDF && fs.existsSync(BASELINE_PDF)
      ? BASELINE_PDF
      : currentPdfBaseline || undefined
    const baselineMetrics = baselinePdf ? inspectPdf(baselinePdf) : undefined
    const baselineFirstPage = baselinePdf ? renderPdfPage(baselinePdf, 'baseline-page1', 1) : undefined
    const baselineVisual = baselineFirstPage ? analyzePng(baselineFirstPage) : undefined
    if (baselinePdf) {
      renderPdfPage(baselinePdf, 'baseline-page2', 2)
    }

    const previewPages = pdfMetrics.preview.pages
    const previewMaxPages = baselineMetrics ? baselineMetrics.pages + 6 : 36
    expect(previewPages, 'preview DOCX 转 PDF 页数应接近 PDF 基准').toBeLessThanOrEqual(previewMaxPages)

    const nonPreviewMaxPages = Math.max(Math.ceil(previewPages * 1.5), 47)
    for (const style of NON_PREVIEW_STYLES) {
      expect(pdfMetrics[style].pages, `${style} PDF 页数不应相对 preview 异常膨胀`).toBeLessThanOrEqual(nonPreviewMaxPages)
    }

    if (baselineVisual) {
      expect(
        Math.abs(visualMetrics.preview.contentRatio - baselineVisual.contentRatio),
        'preview 首屏内容密度应接近 PDF 基准',
      ).toBeLessThan(0.06)

      for (const style of NON_PREVIEW_STYLES) {
        const tolerance = NON_PREVIEW_BASELINE_CONTENT_TOLERANCE[style]
        expect(
          Math.abs(visualMetrics[style].contentRatio - baselineVisual.contentRatio),
          `${style} 首屏内容密度不应退化为空白或过度拥挤`,
        ).toBeLessThan(tolerance)
      }
    }

    const firstPageSheet = createContactSheet(
      [
        ...(baselinePdf ? [{ label: 'baseline', path: path.join(OUT_DIR, 'baseline-page1.png') }] : []),
        ...STYLES.map(style => ({ label: style, path: path.join(OUT_DIR, `${style}-page1.png`) })),
      ],
      path.join(OUT_DIR, 'cce-docx-style-page1-contact-sheet.png'),
    )
    const secondPageSheet = createContactSheet(
      [
        ...(baselinePdf ? [{ label: 'baseline', path: path.join(OUT_DIR, 'baseline-page2.png') }] : []),
        ...STYLES.map(style => ({ label: style, path: path.join(OUT_DIR, `${style}-page2.png`) })),
      ],
      path.join(OUT_DIR, 'cce-docx-style-page2-contact-sheet.png'),
    )
    const allPageSheet = createFullPageContactSheet(allPageHealth, path.join(OUT_DIR, 'cce-docx-style-full-page-contact-sheet.png'))

    const summaryPath = path.join(OUT_DIR, 'visual-summary.json')
    fs.writeFileSync(summaryPath, JSON.stringify({
      source: CCE_MD,
      baselinePdf: baselinePdf || null,
      docxMetrics,
      pdfMetrics,
      baselineMetrics: baselineMetrics || null,
      visualMetrics,
      baselineVisual: baselineVisual || null,
      allPageHealth,
      artifacts: {
        firstPageSheet,
        secondPageSheet,
        allPageSheet,
      },
    }, null, 2))

    await testInfo.attach('docx-style-page1-contact-sheet', { path: firstPageSheet, contentType: 'image/png' })
    await testInfo.attach('docx-style-page2-contact-sheet', { path: secondPageSheet, contentType: 'image/png' })
    await testInfo.attach('docx-style-full-page-contact-sheet', { path: allPageSheet, contentType: 'image/png' })
    await testInfo.attach('docx-style-visual-summary', { path: summaryPath, contentType: 'application/json' })
  })
})

function docxPathFor(style: DocxStyle): string {
  return path.join(OUT_DIR, `cce-${style}.docx`)
}

function inspectDocx(docxPath: string, analyzeImageEdges = false): DocxMetrics {
  const zip = new AdmZip(docxPath)
  const xml = zip.readAsText('word/document.xml')
  const images = inspectDocxImages(zip, analyzeImageEdges)
  const unsafeEdgeImages = images
    .filter(img => img.edgeFlags && img.edgeFlags.length > 0)
    .map(img => `${img.name}:${img.edgeFlags!.join(',')}`)
  return {
    imageCount: images.length,
    realRenderedCount: images.filter(img => img.width !== 1400 && img.bytes > 2_000).length,
    hasFallbackText: xml.includes('DrawIO 图表') || xml.includes('需在应用内查看'),
    ...(analyzeImageEdges ? {
      unsafeEdgeImageCount: unsafeEdgeImages.length,
      unsafeEdgeImages,
    } : {}),
  }
}

function inspectDocxImages(zip: AdmZip, analyzeEdges = false): DocxImageInfo[] {
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
        ...(analyzeEdges ? { edgeFlags: inspectPngEdgeFlags(data) } : {}),
      }
    })
}

function inspectPngEdgeFlags(data: Buffer): string[] {
  const script = `
import json
import sys
from PIL import Image

im = Image.open(sys.stdin.buffer).convert("RGB")
w, h = im.size
pixels = im.load()
min_x = w
min_y = h
max_x = -1
max_y = -1

for y in range(h):
    for x in range(w):
        r, g, b = pixels[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum < 248:
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

flags = []
if max_x >= 0:
    left = min_x / w
    top = min_y / h
    right = max_x / w
    bottom = max_y / h
    if left < 0.01:
        flags.append("LEFT")
    if right > 0.99:
        flags.append("RIGHT")
    if top < 0.01:
        flags.append("TOP")
    if bottom > 0.99:
        flags.append("BOTTOM")

print(json.dumps(flags))
`
  return JSON.parse(execFileSync(PYTHON!, ['-c', script], {
    input: data,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  }))
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

function convertDocxToPdf(docxPath: string): string {
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf')
  fs.rmSync(pdfPath, { force: true })
  execFileSync(SOFFICE!, ['--headless', '--convert-to', 'pdf', '--outdir', OUT_DIR, docxPath], {
    timeout: 180_000,
    stdio: 'pipe',
  })
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 未生成：${pdfPath}`)
  }
  return pdfPath
}

function inspectPdf(pdfPath: string): PdfMetrics {
  const pdfInfo = execFileSync(PDFINFO!, [pdfPath], { encoding: 'utf-8' })
  const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1] || '0')
  const pageSize = pdfInfo.match(/^Page size:\s+(.+)$/m)?.[1] || ''
  return {
    pages,
    pageSize,
    isA4: isA4Pdf(pdfInfo),
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

function renderPdfPage(pdfPath: string, name: string, page: number): string {
  const prefix = path.join(OUT_DIR, name)
  const pngPath = `${prefix}.png`
  fs.rmSync(pngPath, { force: true })
  execFileSync(PDFTOPPM!, ['-r', '120', '-png', '-f', String(page), '-l', String(page), '-singlefile', pdfPath, prefix], {
    timeout: 60_000,
    stdio: 'pipe',
  })
  if (!fs.existsSync(pngPath)) {
    throw new Error(`PDF 页面未渲染：${pngPath}`)
  }
  return pngPath
}

function inspectAllPdfPages(pdfPath: string, style: DocxStyle, pages: number): PdfPageHealthSummary {
  const pagePaths = renderAllPdfPages(pdfPath, style, pages)
  const failures: string[] = []
  const warnings: string[] = []
  const metrics = pagePaths.map((pngPath, index) => {
    const page = index + 1
    const metric = analyzePng(pngPath)
    if (metric.contentRatio < 0.006) {
      failures.push(`p${page}: blank_or_near_blank=${metric.contentRatio.toFixed(4)}`)
    }
    if (metric.edgeInkRatio > 0.006) {
      failures.push(`p${page}: edge_ink=${metric.edgeInkRatio.toFixed(5)}`)
    }
    if (metric.hardEdgeFlags.length > 0) {
      failures.push(`p${page}: hard_edge=${metric.hardEdgeFlags.join(',')}`)
    }
    // 高密度页通常是宽表、代码块或大图表，不直接判失败；记录到 summary/contact sheet 供人工复核。
    if (metric.contentRatio > 0.24) {
      warnings.push(`p${page}: high_density=${metric.contentRatio.toFixed(4)}`)
    }
    return metric
  })

  return {
    pages,
    failureCount: failures.length,
    failures,
    warnings,
    minContentRatio: Math.min(...metrics.map(metric => metric.contentRatio)),
    maxContentRatio: Math.max(...metrics.map(metric => metric.contentRatio)),
    maxEdgeInkRatio: Math.max(...metrics.map(metric => metric.edgeInkRatio)),
    hardEdgePages: metrics
      .map((metric, index) => metric.hardEdgeFlags.length > 0 ? index + 1 : 0)
      .filter(page => page > 0),
  }
}

function renderAllPdfPages(pdfPath: string, style: DocxStyle, pages: number): string[] {
  const dir = path.join(OUT_DIR, 'all-pages', style)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const prefix = path.join(dir, 'page')
  execFileSync(PDFTOPPM!, ['-r', '90', '-png', pdfPath, prefix], {
    timeout: 180_000,
    stdio: 'pipe',
  })
  return Array.from({ length: pages }, (_, index) => {
    const page = index + 1
    const padded = path.join(dir, `page-${String(page).padStart(2, '0')}.png`)
    if (fs.existsSync(padded)) return padded
    return path.join(dir, `page-${page}.png`)
  })
}

function analyzePng(pngPath: string): VisualMetrics {
  const script = `
import json
import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert("RGB")
w, h = im.size
pixels = im.load()
non_white = 0
dark = 0
min_x = w
min_y = h
max_x = -1
max_y = -1
edge_ink = 0
edge_total = 0
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
        if lum < 180:
            dark += 1

result = {
    "width": w,
    "height": h,
    "contentRatio": non_white / (w * h),
    "darkRatio": dark / (w * h),
    "edgeInkRatio": edge_ink / max(edge_total, 1),
    "bbox": None if non_white == 0 else [min_x / w, min_y / h, max_x / w, max_y / h],
    "hardEdgeFlags": [],
}
if non_white != 0:
    left = min_x / w
    top = min_y / h
    right = max_x / w
    bottom = max_y / h
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

function assertHealthyFirstPage(style: DocxStyle, metrics: VisualMetrics): void {
  expect(metrics.contentRatio, `${style} 首屏不应为空白`).toBeGreaterThan(style === 'preview' ? 0.08 : 0.04)
  expect(metrics.contentRatio, `${style} 首屏不应过度拥挤`).toBeLessThan(0.18)
  expect(metrics.darkRatio, `${style} 首屏应包含可见正文`).toBeGreaterThan(0.015)
  expect(metrics.edgeInkRatio, `${style} 首屏内容不应贴边裁切`).toBeLessThan(0.003)
  expect(metrics.bbox, `${style} 首屏应有内容边界`).not.toBeNull()
  const [left, top, right, bottom] = metrics.bbox!
  expect(left, `${style} 首屏左侧不应贴边`).toBeGreaterThan(0.02)
  expect(top, `${style} 首屏顶部不应贴边`).toBeGreaterThan(0.02)
  expect(right, `${style} 首屏右侧不应贴边`).toBeLessThan(0.98)
  expect(bottom, `${style} 首屏底部不应贴边`).toBeLessThan(0.98)
}

function createContactSheet(items: Array<{ label: string; path: string }>, outputPath: string): string {
  const existingItems = items.filter(item => fs.existsSync(item.path))
  const script = `
import json
import sys
from PIL import Image, ImageDraw, ImageFont

items = json.loads(sys.argv[1])
output = sys.argv[2]
thumb_width = 260
label_height = 28
padding = 10
font = ImageFont.load_default()
tiles = []

for item in items:
    img = Image.open(item["path"]).convert("RGB")
    ratio = thumb_width / img.width
    thumb_height = int(img.height * ratio)
    img = img.resize((thumb_width, thumb_height))
    tile = Image.new("RGB", (thumb_width, thumb_height + label_height), "white")
    tile.paste(img, (0, label_height))
    draw = ImageDraw.Draw(tile)
    text_width = draw.textlength(item["label"], font=font)
    draw.text(((thumb_width - text_width) / 2, 7), item["label"], fill="black", font=font)
    tiles.append(tile)

if not tiles:
    raise SystemExit("no images")

height = max(tile.height for tile in tiles)
sheet = Image.new("RGB", (len(tiles) * thumb_width + (len(tiles) - 1) * padding, height), "white")
x = 0
for tile in tiles:
    sheet.paste(tile, (x, 0))
    x += thumb_width + padding
sheet.save(output)
`
  execFileSync(PYTHON!, ['-c', script, JSON.stringify(existingItems), outputPath], {
    timeout: 60_000,
    stdio: 'pipe',
  })
  return outputPath
}

function createFullPageContactSheet(allPageHealth: Record<DocxStyle, PdfPageHealthSummary>, outputPath: string): string {
  const items: Array<{ label: string; path: string }> = []
  for (const style of STYLES) {
    const selectedPages = new Set<number>()
    for (let page = 1; page <= Math.min(8, allPageHealth[style].pages); page += 1) {
      selectedPages.add(page)
    }
    for (const entry of [...allPageHealth[style].failures, ...allPageHealth[style].warnings]) {
      const match = entry.match(/^p(\d+):/)
      if (match) selectedPages.add(Number(match[1]))
    }
    for (const page of [...selectedPages].sort((a, b) => a - b).slice(0, 12)) {
      items.push({
        label: `${style} p${page}`,
        path: path.join(OUT_DIR, 'all-pages', style, `page-${String(page).padStart(2, '0')}.png`),
      })
    }
  }

  const existingItems = items.map(item => {
    if (fs.existsSync(item.path)) return item
    return { ...item, path: item.path.replace(/page-0?(\d+)\.png$/, 'page-$1.png') }
  }).filter(item => fs.existsSync(item.path))

  const script = `
import json
import math
import sys
from PIL import Image, ImageDraw, ImageFont

items = json.loads(sys.argv[1])
output = sys.argv[2]
thumb_width = 170
label_height = 24
padding = 8
columns = 5
font = ImageFont.load_default()
tiles = []

for item in items:
    img = Image.open(item["path"]).convert("RGB")
    ratio = thumb_width / img.width
    thumb_height = int(img.height * ratio)
    img = img.resize((thumb_width, thumb_height))
    tile = Image.new("RGB", (thumb_width, thumb_height + label_height), "white")
    tile.paste(img, (0, label_height))
    draw = ImageDraw.Draw(tile)
    draw.text((4, 5), item["label"], fill="black", font=font)
    tiles.append(tile)

if not tiles:
    raise SystemExit("no images")

rows = math.ceil(len(tiles) / columns)
row_heights = [
    max(tile.height for tile in tiles[row * columns:min((row + 1) * columns, len(tiles))])
    for row in range(rows)
]
sheet = Image.new("RGB", (
    columns * thumb_width + (columns - 1) * padding,
    sum(row_heights) + (rows - 1) * padding,
), "white")
y = 0
for row, row_height in enumerate(row_heights):
    x = 0
    for tile in tiles[row * columns:min((row + 1) * columns, len(tiles))]:
        sheet.paste(tile, (x, y))
        x += thumb_width + padding
    y += row_height + padding
sheet.save(output)
`
  execFileSync(PYTHON!, ['-c', script, JSON.stringify(existingItems), outputPath], {
    timeout: 60_000,
    stdio: 'pipe',
  })
  return outputPath
}

function hasPillow(python: string): boolean {
  try {
    execFileSync(python, ['-c', 'import PIL'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function findPythonWithPillow(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const python = findExecutable([candidate])
    if (python && hasPillow(python)) {
      return python
    }
  }
  return undefined
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
