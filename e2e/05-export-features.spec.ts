import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import AdmZip from 'adm-zip'

/**
 * E2E 测试 5: 导出功能
 * 验证 HTML 和 PDF 导出功能
 */

let testDir: string
const DOCX_SERVICE_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || 'http://127.0.0.1:3179'
const DIRECT_EXCALIDRAW_SOURCE = `{
  "type": "excalidraw",
  "version": 2,
  "source": "md-viewer-direct-export-test",
  "elements": [
    {
      "id": "rect-1",
      "type": "rectangle",
      "x": 10,
      "y": 10,
      "width": 220,
      "height": 100,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": { "type": 3 },
      "seed": 10,
      "version": 1,
      "versionNonce": 10,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-1",
      "type": "text",
      "x": 52,
      "y": 45,
      "width": 136,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 11,
      "version": 1,
      "versionNonce": 11,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "Export Diagram",
      "fontSize": 20,
      "fontFamily": 5,
      "textAlign": "center",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "Export Diagram",
      "lineHeight": 1.25
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}`
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP8z4AATAxEcQAz0QEHOoQ+uAAAAABJRU5ErkJggg=='
const MOCK_REMOTE_DIAGRAM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140"><rect x="8" y="8" width="304" height="124" rx="12" fill="#f8fbff" stroke="#2f5597"/><text x="160" y="76" text-anchor="middle" font-size="20">remote diagram mock</text></svg>'

async function openMarkdownFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
  await page.waitForSelector('.markdown-body', { timeout: 10000 })
}

async function mockSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePath) => {
    ;(globalThis as any).__mdViewerSaveDialogCalls = []
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args.length === 1 ? args[0] : args[1]
      ;(globalThis as any).__mdViewerSaveDialogCalls.push(options)
      return { canceled: false, filePath }
    }
  }, filePath)
}

async function getSaveDialogCalls(electronApp: ElectronApplication): Promise<Array<{ defaultPath?: string }>> {
  return electronApp.evaluate(() => (globalThis as any).__mdViewerSaveDialogCalls ?? [])
}

async function triggerMarkdownExport(
  electronApp: ElectronApplication,
  channel: 'markdown:export-html' | 'markdown:export-pdf' | 'markdown:export-docx'
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, channel) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.webContents.send(channel)
  }, channel)
}

async function waitForFile(filePath: string, timeout = 10000): Promise<void> {
  await expect.poll(() => {
    if (!existsSync(filePath)) return false
    return readFileSync(filePath).length > 0
  }, { timeout }).toBe(true)
}

async function mockRemoteDiagramFetch(page: Page, electronApp: ElectronApplication): Promise<void> {
  await page.route('https://www.plantuml.com/plantuml/svg/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: MOCK_REMOTE_DIAGRAM_SVG,
  }))
  await page.route('https://kroki.io/**/svg', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: MOCK_REMOTE_DIAGRAM_SVG,
  }))

  await page.evaluate((svg) => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.includes('/plantuml/svg') || url.includes('kroki.io')) {
        return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      }
      return originalFetch(input, init)
    }
  }, MOCK_REMOTE_DIAGRAM_SVG)

  await electronApp.evaluate(({ ipcMain }, svg) => {
    ipcMain.removeHandler('render:krokiSvg')
    ipcMain.handle('render:krokiSvg', async () => ({ ok: true, svg }))
  }, MOCK_REMOTE_DIAGRAM_SVG)
}

function expectNoRendererSourceResidue(htmlContent: string): void {
  const forbiddenFragments = [
    'data-renderer-language=',
    'excalidraw-file-placeholder',
    'bpmn-file-placeholder',
    'data-excalidraw-src',
    'data-bpmn-src',
    '<pre class="language-mermaid"',
    '<pre class="language-echarts"',
    '<pre class="language-markmap"',
    '<pre class="language-graphviz"',
    '<pre class="language-infographic"',
    '<pre class="language-drawio"',
    '<pre class="language-excalidraw"',
    '<pre class="language-plantuml"',
    '<pre class="language-c4"',
    '<pre class="language-c4plantuml"',
    '<pre class="language-vega-lite"',
    '<pre class="language-d2"',
    '<pre class="language-bpmn"',
    '<pre class="language-wavedrom"',
    '<pre class="language-structurizr"',
    '<pre class="language-plotly"',
    '<pre class="language-dbml"',
    '<pre class="language-antv-g6"',
    '<pre class="language-kroki"',
    '<pre class="language-nomnoml"',
    '<pre class="language-pikchr"',
    '<pre class="language-svgbob"',
    '<pre class="language-bytefield"',
    '<pre class="language-tikz"',
  ]

  for (const fragment of forbiddenFragments) {
    expect(htmlContent, `导出 HTML 不应残留 ${fragment}`).not.toContain(fragment)
  }
}

test.beforeEach(() => {
  const rootDir = join(process.cwd(), '.tmp', 'e2e-export')
  mkdirSync(rootDir, { recursive: true })
  testDir = mkdtempSync(join(rootDir, 'md-viewer-test-'))

  // 创建包含各种 Markdown 特性的测试文件
  const markdown = `# Export Test

## Code Block
\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`

## Math Formula
$E = mc^2$

## Table
| Name | Age |
|------|-----|
| Alice | 25 |
| Bob | 30 |
`
  writeFileSync(join(testDir, 'export-test.md'), markdown)
})

test.afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.describe('导出功能测试', () => {
  test('应该能导出 HTML 文件', async ({ page, electronApp }) => {
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'exported.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(htmlContent).toContain('<!DOCTYPE html>')
    expect(htmlContent).toContain('Export Test')
    expect(htmlContent).toContain('<span class="token keyword">function</span>')
    expect(htmlContent).toContain('<span class="token function">hello</span>')

    // 验证包含 KaTeX CSS
    expect(htmlContent).toContain('katex')

    // 验证包含 Prism 高亮
    expect(htmlContent).toContain('language-javascript')
  })

  test('应该能导出 PDF 文件', async ({ page, electronApp }) => {
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'exported.pdf')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')

    await waitForFile(exportPath, 20000)
    const buffer = readFileSync(exportPath)

    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.toString('utf-8', 0, 4)).toBe('%PDF')
  })

  test('HTML/PDF 导出应保留 Markdown 相对路径本地图片', async ({ page, electronApp }) => {
    const imageDir = join(testDir, 'images')
    mkdirSync(imageDir, { recursive: true })
    writeFileSync(join(imageDir, 'welcome.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const markdownPath = join(testDir, 'local-image-export.md')
    writeFileSync(markdownPath, [
      '# Local Image Export',
      '',
      '![欢迎图](./images/welcome.png)',
      '',
      '图片应出现在 HTML 和 PDF 导出中。',
    ].join('\n'))

    await openMarkdownFile(page, markdownPath)
    await expect(page.getByRole('img', { name: '欢迎图' })).toBeVisible()

    const htmlPath = join(testDir, 'local-image-export.html')
    await mockSaveDialog(electronApp, htmlPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await waitForFile(htmlPath)
    const htmlContent = readFileSync(htmlPath, 'utf-8')
    expect(htmlContent).toContain(`src="data:image/png;base64,${TINY_PNG_BASE64}"`)
    expect(htmlContent).not.toContain('src="./images/welcome.png"')

    const pdfPath = join(testDir, 'local-image-export.pdf')
    await mockSaveDialog(electronApp, pdfPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')
    await waitForFile(pdfPath, 20000)
    const pdfBuffer = readFileSync(pdfPath)
    expect(pdfBuffer.length).toBeGreaterThan(1000)
    expect(pdfBuffer.toString('utf-8', 0, 4)).toBe('%PDF')
  })

  test('导出的 HTML 应该包含完整的样式', async ({ page, electronApp }) => {
    await openMarkdownFile(page, join(testDir, 'export-test.md'))

    const exportPath = join(testDir, 'styled.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(htmlContent).toContain('<style>')
    expect(htmlContent).toContain('.markdown-body')
    expect(htmlContent).toContain('.markdown-body blockquote')
    expect(htmlContent).toContain('.markdown-body table')
    expect(htmlContent).toContain('border-collapse: collapse')
    expect(htmlContent).toContain('--bg-primary')

    // 验证包含代码高亮样式
    expect(htmlContent).toContain('.token')
  })

  test('test-all-charts.md 导出的 HTML / PDF 不应残留源码或占位符', async ({ page, electronApp }) => {
    test.setTimeout(360000)
    await mockRemoteDiagramFetch(page, electronApp)

    const fixturePath = join(__dirname, 'fixtures/test-all-charts.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 20000 })
    await expect(page.locator('.markdown-body')).toContainText('全部图表类型汇总测试', { timeout: 20000 })

    const htmlPath = join(testDir, 'test-all-charts.html')
    await mockSaveDialog(electronApp, htmlPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await waitForFile(htmlPath, 180000)

    const htmlContent = readFileSync(htmlPath, 'utf-8')
    expect(htmlContent).toContain('全部图表类型汇总测试')
    expect(htmlContent).toContain('mermaid-container')
    expect(htmlContent).toContain('echarts-container')
    expect(htmlContent).toContain('markmap-container')
    expect(htmlContent).toContain('graphviz-container')
    expect(htmlContent).toContain('infographic-container')
    expect(htmlContent).toContain('drawio-container')
    expect(htmlContent).toContain('vega-lite-container')
    expect(htmlContent).toContain('d2-container')
    expect(htmlContent).toContain('bpmn-container')
    expect(htmlContent).toContain('wavedrom-container')
    expect(htmlContent).toContain('plantuml-container')
    expect(htmlContent).toContain('C4-PlantUML')
    expect(htmlContent).toContain('structurizr-container')
    expect(htmlContent).toContain('plotly-container')
    expect(htmlContent).toContain('dbml-container')
    expect(htmlContent).toContain('antv-g6-container')
    expect(htmlContent).toContain('kroki-container')
    expectNoRendererSourceResidue(htmlContent)

    const pdfPath = join(testDir, 'test-all-charts.pdf')
    await mockSaveDialog(electronApp, pdfPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')
    await waitForFile(pdfPath, 180000)

    const pdfBuffer = readFileSync(pdfPath)
    expect(pdfBuffer.toString('utf-8', 0, 4)).toBe('%PDF')

    const pdfText = execFileSync('pdftotext', ['-f', '1', '-l', '40', pdfPath, '-'], {
      encoding: 'utf-8',
    })
    expect(pdfText).toContain('全部图表类型汇总测试')
    expect(pdfText).toContain('Mermaid')
    expect(pdfText).toContain('ECharts')
    expect(pdfText).toContain('Markmap')
    expect(pdfText).toContain('Graphviz')
    expect(pdfText).toContain('DrawIO')
    expect(pdfText).toContain('Vega-Lite')
    expect(pdfText).toContain('BPMN')
    expect(pdfText).toContain('WaveDrom')
    expect(pdfText).toContain('DBML')
    expect(pdfText).toContain('Kroki')
    expect(pdfText).not.toContain('language-mermaid')
    expect(pdfText).not.toContain('language-echarts')
    expect(pdfText).not.toContain('language-graphviz')
    expect(pdfText).not.toContain('language-drawio')
    expect(pdfText).not.toContain('language-vega-lite')
    expect(pdfText).not.toContain('language-d2')
    expect(pdfText).not.toContain('language-bpmn')
    expect(pdfText).not.toContain('language-wavedrom')
    expect(pdfText).not.toContain('language-dbml')
    expect(pdfText).not.toContain('language-antv-g6')
  })

  test('别名图表导出的 HTML 不应残留源码块', async ({ page, electronApp }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><rect x="10" y="10" width="140" height="60" fill="#e3f2fd" stroke="#1565c0"/><text x="80" y="46" text-anchor="middle">alias</text></svg>'
    await page.route('https://www.plantuml.com/plantuml/svg/**', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg,
    }))
    await page.route('https://kroki.io/**/svg', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg,
    }))

    const fixturePath = join(__dirname, 'fixtures/test-export-alias-renderers.md')
    await openMarkdownFile(page, fixturePath)

    const exportPath = join(testDir, 'alias-renderers.html')
    await mockSaveDialog(electronApp, exportPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(htmlContent).toContain('graphviz-container')
    expect(htmlContent).toContain('drawio-container')
    expect(htmlContent).toMatch(/plantuml-(?:container|error)/)
    expect(htmlContent).toContain('kroki-container')
    expect(htmlContent).not.toContain('data-renderer-language="dot"')
    expect(htmlContent).not.toContain('data-renderer-language="dio"')
    expect(htmlContent).not.toContain('data-renderer-language="puml"')
    expect(htmlContent).not.toContain('data-renderer-language="c4"')
    expect(htmlContent).not.toContain('data-renderer-language="nomnoml"')
    expect(htmlContent).not.toContain('<pre class="language-graphviz"')
    expect(htmlContent).not.toContain('<pre class="language-drawio"')
    expect(htmlContent).not.toContain('<pre class="language-plantuml"')
    expect(htmlContent).not.toContain('<pre class="language-c4plantuml"')
  })

  test('大量 Graphviz 图表导出的 HTML 不应从第 21 个开始残留源码', async ({ page, electronApp }) => {
    test.setTimeout(120000)
    const fixturePath = join(__dirname, 'fixtures/test-graphviz.md')
    await openMarkdownFile(page, fixturePath)

    const exportPath = join(testDir, 'graphviz-full.html')
    await mockSaveDialog(electronApp, exportPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath, 90000)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect((htmlContent.match(/graphviz-container/g) || []).length).toBeGreaterThan(60)
    expect(htmlContent).not.toContain('language-graphviz')
    expect(htmlContent).not.toContain('data-renderer-language="dot"')
    expect(htmlContent).toContain('Graphviz 渲染失败')
  })

  test('大量 ECharts 图表导出的 HTML 不应从后半段开始残留源码', async ({ page, electronApp }) => {
    test.setTimeout(120000)
    const fixturePath = join(__dirname, 'fixtures/test-echarts.md')
    await openMarkdownFile(page, fixturePath)

    const exportPath = join(testDir, 'echarts-full.html')
    await mockSaveDialog(electronApp, exportPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath, 90000)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect((htmlContent.match(/echarts-container/g) || []).length).toBeGreaterThan(25)
    expect((htmlContent.match(/<pre\s+class="language-echarts"/g) || []).length).toBeLessThanOrEqual(2)
    expect(htmlContent).not.toContain('"type": "gauge"')
    expect(htmlContent).toContain('echarts-error')
  })

  test('大量 ECharts 图表导出的 PDF 第 13 页后不应残留有效图表源码', async ({ page, electronApp }) => {
    test.setTimeout(120000)
    const fixturePath = join(__dirname, 'fixtures/test-echarts.md')
    await openMarkdownFile(page, fixturePath)

    const exportPath = join(testDir, 'echarts-full.pdf')
    await mockSaveDialog(electronApp, exportPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')

    await waitForFile(exportPath, 90000)
    const text = execFileSync('pdftotext', ['-f', '13', '-l', '30', exportPath, '-'], {
      encoding: 'utf-8',
    })

    expect(text).toContain('MD-6.')
    expect(text).toContain('测试覆盖率仪表盘')
    expect(text).not.toContain('"type": "gauge"')
    expect(text).not.toContain('"series"')
    expect(text).not.toContain('language-echarts')
  })

  test('没有打开标签时不应该触发导出', async ({ page, electronApp }) => {
    const exportPath = join(testDir, 'empty.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await page.waitForTimeout(500)

    expect(existsSync(exportPath)).toBe(false)
    expect(await getSaveDialogCalls(electronApp)).toHaveLength(0)
  })

  test('导出应该处理特殊字符文件名', async ({ page, electronApp }) => {
    const specialMarkdown = '# Special Test'
    const markdownPath = join(testDir, '特殊-文件名 (1).md')
    writeFileSync(markdownPath, specialMarkdown)
    await openMarkdownFile(page, markdownPath)

    const exportPath = join(testDir, 'special.html')
    await mockSaveDialog(electronApp, exportPath)

    await triggerMarkdownExport(electronApp, 'markdown:export-html')

    await waitForFile(exportPath)
    const calls = await getSaveDialogCalls(electronApp)
    const htmlContent = readFileSync(exportPath, 'utf-8')

    expect(calls.at(-1)?.defaultPath).toBe('特殊-文件名 (1).html')
    expect(htmlContent).toContain('Special Test')
    expect(htmlContent).toContain('<title>特殊-文件名 (1).md</title>')
  })

  test('直接打开 .excalidraw 后应可导出 HTML、PDF 和 DOCX 渲染图', async ({ page, electronApp }) => {
    const excalidrawPath = join(testDir, 'direct-export.excalidraw')
    writeFileSync(excalidrawPath, DIRECT_EXCALIDRAW_SOURCE, 'utf8')

    await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), excalidrawPath)
    await expect(page.locator('.excalidraw-container svg')).toBeVisible({ timeout: 15000 })

    const htmlPath = join(testDir, 'direct-export.html')
    await mockSaveDialog(electronApp, htmlPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await waitForFile(htmlPath)
    expect((await getSaveDialogCalls(electronApp)).at(-1)?.defaultPath).toBe('direct-export.html')
    const htmlContent = readFileSync(htmlPath, 'utf-8')
    expect(htmlContent).toContain('excalidraw-container')
    expect(htmlContent).toContain('<svg')
    expect(htmlContent).not.toContain('"elements": [')

    const pdfPath = join(testDir, 'direct-export.pdf')
    await mockSaveDialog(electronApp, pdfPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')
    await waitForFile(pdfPath, 20000)
    expect((await getSaveDialogCalls(electronApp)).at(-1)?.defaultPath).toBe('direct-export.pdf')
    const pdfBuffer = readFileSync(pdfPath)
    expect(pdfBuffer.length).toBeGreaterThan(1000)
    expect(pdfBuffer.toString('utf-8', 0, 4)).toBe('%PDF')

    await page.evaluate((serverUrl) => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: false,
        serverUrl,
        style: 'preview',
        styleTouched: true,
        timeoutMs: 180000,
        embedFont: false,
        localFallbackEnabled: true,
      },
    }), DOCX_SERVICE_URL)

    const docxPath = join(testDir, 'direct-export.docx')
    await mockSaveDialog(electronApp, docxPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-docx')
    await waitForFile(docxPath, 30000)
    expect((await getSaveDialogCalls(electronApp)).at(-1)?.defaultPath).toBe('direct-export.docx')

    const zip = new AdmZip(docxPath)
    const entries = zip.getEntries().map(entry => entry.entryName)
    const documentXml = zip.readAsText('word/document.xml')
    expect(entries.some(name => name.startsWith('word/media/'))).toBe(true)
    expect(documentXml).not.toContain('md-viewer-direct-export-test')
    expect(documentXml).not.toContain('"elements"')
  })

  test('远程 DOCX 导出应嵌入普通 Markdown 本地图片', async ({ page, electronApp }) => {
    test.setTimeout(120000)
    const imageDir = join(testDir, 'images')
    mkdirSync(imageDir, { recursive: true })
    writeFileSync(join(imageDir, 'welcome.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const markdownPath = join(testDir, 'docx-local-image.md')
    writeFileSync(markdownPath, [
      '# 本地图片 DOCX 导出',
      '',
      '![欢迎图](./images/welcome.png)',
    ].join('\n'), 'utf8')

    await openMarkdownFile(page, markdownPath)
    await page.evaluate((serverUrl) => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: true,
        serverUrl,
        style: 'preview',
        styleTouched: true,
        timeoutMs: 120000,
        embedFont: false,
        localFallbackEnabled: false,
      },
    }), DOCX_SERVICE_URL)

    const docxPath = join(testDir, 'docx-local-image.docx')
    await mockSaveDialog(electronApp, docxPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-docx')
    await waitForFile(docxPath, 120000)

    const zip = new AdmZip(docxPath)
    const documentXml = zip.readAsText('word/document.xml')
    const relsXml = zip.readAsText('word/_rels/document.xml.rels')
    const pngCount = zip.getEntries()
      .filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png'))
      .length

    expect(pngCount).toBeGreaterThanOrEqual(1)
    expect(documentXml).toContain('<w:drawing>')
    expect(documentXml).not.toContain('mdv__chart__')
    expect(relsXml).not.toContain('Target="images/welcome.png"')
  })

  test('test-excalidraw.md 远程 DOCX 导出应保留全部可渲染 Excalidraw 图', async ({ page, electronApp }) => {
    test.setTimeout(300000)
    const fixturePath = join(__dirname, 'fixtures/test-excalidraw.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.excalidraw-container svg')).toHaveCount(64, { timeout: 120000 })

    await page.evaluate((serverUrl) => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: true,
        serverUrl,
        style: 'preview',
        styleTouched: true,
        timeoutMs: 240000,
        embedFont: false,
        localFallbackEnabled: false,
      },
    }), DOCX_SERVICE_URL)

    const docxPath = join(testDir, 'test-excalidraw.docx')
    await mockSaveDialog(electronApp, docxPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-docx')
    await waitForFile(docxPath, 240000)

    const zip = new AdmZip(docxPath)
    const pngCount = zip.getEntries()
      .filter(entry => entry.entryName.startsWith('word/media/') && entry.entryName.toLowerCase().endsWith('.png'))
      .length
    const documentXml = zip.readAsText('word/document.xml')

    expect(pngCount).toBe(65)
    expect(documentXml).not.toContain('mdv__chart__')
    const exportPanel = page.locator('.export-task-panel')
    await expect(exportPanel).not.toContainText('Error invoking remote method')
    await expect(exportPanel).not.toContainText('ENOENT')
    await expect(exportPanel).not.toContainText('Excalidraw 文件')
  })

  test('test-excalidraw.md 导出 HTML/PDF 应渲染文件引用图表', async ({ page, electronApp }) => {
    test.setTimeout(300000)
    const fixturePath = join(__dirname, 'fixtures/test-excalidraw.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.excalidraw-container svg')).toHaveCount(64, { timeout: 120000 })

    const htmlPath = join(testDir, 'test-excalidraw.html')
    await mockSaveDialog(electronApp, htmlPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-html')
    await waitForFile(htmlPath, 120000)

    const htmlContent = readFileSync(htmlPath, 'utf-8')
    expect((htmlContent.match(/class="excalidraw-container"/g) || []).length).toBe(64)
    expect((htmlContent.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(64)
    expect(htmlContent).not.toContain('excalidraw-file-placeholder')
    expect(htmlContent).not.toContain('data-excalidraw-src')

    const pdfPath = join(testDir, 'test-excalidraw.pdf')
    await mockSaveDialog(electronApp, pdfPath)
    await triggerMarkdownExport(electronApp, 'markdown:export-pdf')
    await waitForFile(pdfPath, 120000)

    const pdfText = execFileSync('pdftotext', ['-f', '1', '-l', '3', pdfPath, '-'], {
      encoding: 'utf-8',
    })
    expect(pdfText).toContain('基础文件引用')
    expect(pdfText).toContain('开始')
    expect(pdfText).toContain('静态渲染')
    expect(pdfText).toContain('读取文件')
    expect(readFileSync(pdfPath).toString('utf-8', 0, 4)).toBe('%PDF')
  })
})
