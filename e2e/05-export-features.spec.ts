import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import AdmZip from 'adm-zip'

/**
 * E2E 测试 5: 导出功能
 * 验证 HTML 和 PDF 导出功能
 */

let testDir: string
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
  await expect.poll(() => existsSync(filePath), { timeout }).toBe(true)
}

test.beforeEach(() => {
  testDir = join(tmpdir(), `md-viewer-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

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

    await page.evaluate(() => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: false,
        serverUrl: 'http://127.0.0.1:3179',
        style: 'preview',
        styleTouched: true,
        timeoutMs: 180000,
        embedFont: false,
        localFallbackEnabled: true,
      },
    }))

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
    await page.evaluate(() => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: true,
        serverUrl: 'http://127.0.0.1:3179',
        style: 'preview',
        styleTouched: true,
        timeoutMs: 120000,
        embedFont: false,
        localFallbackEnabled: false,
      },
    }))

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

    await page.evaluate(() => window.api.updateAppSettings({
      docxExport: {
        remoteEnabled: true,
        serverUrl: 'http://127.0.0.1:3179',
        style: 'preview',
        styleTouched: true,
        timeoutMs: 240000,
        embedFont: false,
        localFallbackEnabled: false,
      },
    }))

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
})
