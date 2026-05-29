import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const PDFTOPPM = process.env.PDFTOPPM_BIN || '/opt/homebrew/bin/pdftoppm'
const PYTHON = process.env.PYTHON_WITH_PIL || '/opt/anaconda3/bin/python3.11'

const DRAWIO_MARKDOWN = [
  '# PDF DrawIO Centering',
  '',
  '```drawio',
  String.raw`
<mxfile host="app.diagrams.net">
  <diagram name="租户层级" id="tenant-hierarchy">
    <mxGraphModel dx="900" dy="520" grid="1" gridSize="10" guides="1">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="系统管理员" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontStyle=1;fontSize=14;" vertex="1" parent="1">
          <mxGeometry x="250" y="20" width="300" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="负责模型接入、能力管理、全局监控" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;fontSize=11;fontColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="280" y="75" width="240" height="25" as="geometry"/>
        </mxCell>
        <mxCell id="4" value="超级租户" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=13;" vertex="1" parent="1">
          <mxGeometry x="250" y="120" width="300" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="5" value="创建和管理普通租户、配置资源额度" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;fontSize=11;fontColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="280" y="175" width="240" height="25" as="geometry"/>
        </mxCell>
        <mxCell id="8" value="普通租户 A&#xa;（如：某分校）&#xa;&#xa;独立的应用空间&#xa;独立的知识库&#xa;独立的使用数据" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;align=center;" vertex="1" parent="1">
          <mxGeometry x="120" y="220" width="200" height="120" as="geometry"/>
        </mxCell>
        <mxCell id="9" value="普通租户 B&#xa;（如：某部门）&#xa;&#xa;独立的应用空间&#xa;独立的知识库&#xa;独立的使用数据" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;align=center;" vertex="1" parent="1">
          <mxGeometry x="480" y="220" width="200" height="120" as="geometry"/>
        </mxCell>
        <mxCell id="10" value="" style="endArrow=block;endFill=1;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=0;strokeColor=#666666;strokeWidth=2;" edge="1" source="2" target="4" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="12" value="" style="endArrow=block;endFill=1;html=1;exitX=0.25;exitY=1;entryX=0.5;entryY=0;strokeColor=#82b366;strokeWidth=2;" edge="1" source="4" target="8" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="13" value="" style="endArrow=block;endFill=1;html=1;exitX=0.75;exitY=1;entryX=0.5;entryY=0;strokeColor=#82b366;strokeWidth=2;" edge="1" source="4" target="9" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="14" value="数据完全隔离" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="345" y="260" width="110" height="40" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`,
  '```',
].join('\n')

async function openMarkdownFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
  await page.waitForSelector('.drawio-container[data-drawio-ready="true"] svg', { timeout: 30000 })
}

async function mockSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, filePath)
}

async function triggerMarkdownExport(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('markdown:export-pdf')
  })
}

async function waitForFile(filePath: string, timeout = 30000): Promise<void> {
  await expect.poll(() => {
    if (!existsSync(filePath)) return false
    return readFileSync(filePath).length > 0
  }, { timeout }).toBe(true)
}

function analyzePdfFirstPage(pdfPath: string, outDir: string): {
  pageWidth: number
  contentLeft: number
  contentRight: number
  chartLeft: number
  chartRight: number
  chartContentOffset: number
} {
  const prefix = join(outDir, 'page')
  execFileSync(PDFTOPPM, ['-r', '144', '-png', '-f', '1', '-l', '1', '-singlefile', pdfPath, prefix], {
    stdio: 'pipe',
  })
  const pngPath = `${prefix}.png`
  const script = `
import json, sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
w, h = img.size

def is_dark(x, y):
    r, g, b = img.getpixel((x, y))
    return r < 245 or g < 245 or b < 245

ys = []
for y in range(h):
    count = sum(1 for x in range(w) if is_dark(x, y))
    if count > 180:
        ys.append(y)

segments = []
if ys:
    start = prev = ys[0]
    for y in ys[1:]:
        if y <= prev + 2:
            prev = y
        else:
            if prev - start > 25:
                segments.append((start, prev))
            start = prev = y
    if prev - start > 25:
        segments.append((start, prev))

chart_segment = max(segments, key=lambda item: item[1] - item[0])
cy0, cy1 = chart_segment

def bbox_for(y0, y1):
    xs = []
    ys2 = []
    for y in range(y0, y1 + 1):
        for x in range(w):
            if is_dark(x, y):
                xs.append(x)
                ys2.append(y)
    return min(xs), min(ys2), max(xs), max(ys2)

content = bbox_for(0, h - 1)
chart = bbox_for(max(0, cy0 - 4), min(h - 1, cy1 + 4))
content_center = (content[0] + content[2]) / 2
chart_center = (chart[0] + chart[2]) / 2
print(json.dumps({
    'pageWidth': w,
    'contentLeft': content[0],
    'contentRight': content[2],
    'chartLeft': chart[0],
    'chartRight': chart[2],
    'chartContentOffset': chart_center - content_center,
}, ensure_ascii=False))
`
  return JSON.parse(execFileSync(PYTHON, ['-c', script, pngPath], { encoding: 'utf-8' }))
}

test.describe('PDF DrawIO 导出视觉回归', () => {
  test.skip(!existsSync(PDFTOPPM), '缺少 pdftoppm，无法将 PDF 渲染为 PNG')
  test.skip(!existsSync(PYTHON), '缺少带 PIL 的 Python，无法分析 PNG')

  test('DrawIO 图表在 PDF 内容区域内应视觉居中', async ({ page, electronApp }) => {
    const testDir = join(tmpdir(), `md-viewer-pdf-drawio-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    try {
      const markdownPath = join(testDir, 'drawio-centering.md')
      const pdfPath = join(testDir, 'drawio-centering.pdf')
      writeFileSync(markdownPath, DRAWIO_MARKDOWN, 'utf-8')

      await openMarkdownFile(page, markdownPath)
      await mockSaveDialog(electronApp, pdfPath)
      await triggerMarkdownExport(electronApp)
      await waitForFile(pdfPath)

      const metrics = analyzePdfFirstPage(pdfPath, testDir)
      expect(Math.abs(metrics.chartContentOffset), JSON.stringify(metrics)).toBeLessThanOrEqual(28)
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})

function analyzePdfPageDarkBounds(pdfPath: string, outDir: string, pageNumber: number): {
  pageWidth: number
  pageHeight: number
  chartLeft: number
  chartRight: number
  chartTop: number
  chartBottom: number
  chartWidth: number
  chartHeight: number
  centerOffset: number
} {
  const prefix = join(outDir, `page-${pageNumber}`)
  execFileSync(PDFTOPPM, ['-r', '144', '-png', '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', pdfPath, prefix], {
    stdio: 'pipe',
  })
  const pngPath = `${prefix}.png`
  const script = `
import json, sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
w, h = img.size

def is_dark(x, y):
    r, g, b = img.getpixel((x, y))
    return r < 245 or g < 245 or b < 245

rows = []
for y in range(h):
    count = sum(1 for x in range(w) if is_dark(x, y))
    if count > 20:
        rows.append(y)

segments = []
if rows:
    start = prev = rows[0]
    for y in rows[1:]:
        if y <= prev + 2:
            prev = y
        else:
            if prev - start > 30:
                segments.append((start, prev))
            start = prev = y
    if prev - start > 30:
        segments.append((start, prev))

chart_segment = max(segments, key=lambda item: item[1] - item[0])
y0, y1 = chart_segment
xs = []
ys = []
for y in range(y0, y1 + 1):
    for x in range(w):
        if is_dark(x, y):
            xs.append(x)
            ys.append(y)

left, right = min(xs), max(xs)
top, bottom = min(ys), max(ys)
print(json.dumps({
    'pageWidth': w,
    'pageHeight': h,
    'chartLeft': left,
    'chartRight': right,
    'chartTop': top,
    'chartBottom': bottom,
    'chartWidth': right - left + 1,
    'chartHeight': bottom - top + 1,
    'centerOffset': ((left + right) / 2) - (w / 2),
}, ensure_ascii=False))
`
  return JSON.parse(execFileSync(PYTHON, ['-c', script, pngPath], { encoding: 'utf-8' }))
}

test.describe('PDF Graphviz 导出视觉回归', () => {
  test.skip(!existsSync(PDFTOPPM), '缺少 pdftoppm，无法将 PDF 渲染为 PNG')
  test.skip(!existsSync(PYTHON), '缺少带 PIL 的 Python，无法分析 PNG')

  test('Graphviz 小图在 PDF 中不应被放大到整页宽度', async ({ page, electronApp }) => {
    const outputDir = join(tmpdir(), `md-viewer-pdf-graphviz-${Date.now()}`)
    mkdirSync(outputDir, { recursive: true })
    try {
      const fixturePath = join(__dirname, 'fixtures/test-graphviz.md')
      const pdfPath = join(outputDir, 'test-graphviz.pdf')

      await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fixturePath)
      await page.waitForSelector('.graphviz-container svg', { timeout: 30000 })
      await mockSaveDialog(electronApp, pdfPath)
      await triggerMarkdownExport(electronApp)
      await waitForFile(pdfPath, 30000)

      const metrics = analyzePdfPageDarkBounds(pdfPath, outputDir, 1)
      expect(metrics.chartWidth, JSON.stringify(metrics)).toBeLessThan(420)
      expect(Math.abs(metrics.centerOffset), JSON.stringify(metrics)).toBeLessThan(60)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
