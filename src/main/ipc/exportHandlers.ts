import { BrowserWindow, ipcMain, dialog, app, net } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import AdmZip from 'adm-zip'
import { IPCContext } from './context'
import { appDataManager } from '../appDataManager'
import { exportToDocx, ChartImageData, EmbeddedDocxImage } from '../docxExporter'
import { exportWithPandoc, isPandocAvailable } from '../pandocExporter'
import { exportViaRemote, testConnection, RemoteImage, DocxExportError, resolveRemoteDocxStyle } from '../remoteDocxExporter'
import { DOCX_STYLE_LABELS, normalizeDocxStyle } from '../../shared/docxStyles'
import { validatePath } from '../security'
import { writeHtmlExport, writePdfExport } from '../cli/sharedExportWriters'

let lastDocxExportPath: string | null = null
const EXPORT_SOURCE_EXTENSION_RE = /\.(md|markdown|mdown|mkd|mkdn|excalidraw)$/i
const KROKI_ENDPOINT = 'https://kroki.io'
const KROKI_FORMATS = new Set(['pikchr', 'nomnoml', 'svgbob', 'bytefield', 'tikz', 'plantuml', 'erd', 'graphviz', 'd2'])
const MAX_KROKI_SOURCE_LENGTH = 128_000
const MAX_CHART_ZIP_IMAGES = 200

interface ChartZipImagePayload {
  filename: string
  pngBase64: string
}

interface ExportChartsZipPayload {
  markdownFilePath: string
  images: ChartZipImagePayload[]
}

export function getLastDocxExportPath(): string | null {
  return lastDocxExportPath
}

function withExportExtension(fileName: string, extension: 'html' | 'pdf' | 'docx'): string {
  if (EXPORT_SOURCE_EXTENSION_RE.test(fileName)) {
    return fileName.replace(EXPORT_SOURCE_EXTENSION_RE, `.${extension}`)
  }
  return `${fileName}.${extension}`
}

function resolveChartsZipDefaultPath(markdownFilePath: string): string {
  const dir = path.dirname(markdownFilePath)
  const baseName = path.basename(markdownFilePath).replace(EXPORT_SOURCE_EXTENSION_RE, '')
  return path.join(dir, `${baseName || 'markdown'}-charts.zip`)
}

function sanitizeZipEntryName(filename: string, fallbackIndex: number): string {
  const fallback = `${String(fallbackIndex + 1).padStart(2, '0')}-chart.png`
  const baseName = path.basename(filename || fallback)
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .trim()
  const normalized = baseName || fallback
  return normalized.toLowerCase().endsWith('.png') ? normalized : `${normalized}.png`
}

function sanitizeZipDirectoryName(name: string): string {
  const normalized = String(name || 'charts')
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/^\.+$/, '')
    .trim()
  return normalized || 'charts'
}

function uniqueZipEntryName(filename: string, usedNames: Set<string>): string {
  if (!usedNames.has(filename)) {
    usedNames.add(filename)
    return filename
  }

  const ext = path.extname(filename) || '.png'
  const stem = path.basename(filename, ext)
  let index = 2
  while (usedNames.has(`${stem}-${index}${ext}`)) {
    index += 1
  }
  const uniqueName = `${stem}-${index}${ext}`
  usedNames.add(uniqueName)
  return uniqueName
}

function decodePngBase64(input: string): Buffer | null {
  const clean = String(input || '')
    .replace(/^data:image\/png;base64,/i, '')
    .replace(/\s/g, '')
  if (!clean) return null

  const buffer = Buffer.from(clean, 'base64')
  return buffer.length > 0 ? buffer : null
}

// 获取导出用的完整 CSS（包含所有必需的变量和样式）
function sanitizeBundledExportCss(css: string): string {
  // 过滤掉应用程序的布局样式（这些样式会阻止导出 HTML 滚动）
  // 移除 body { overflow: hidden; height: 100vh; } 等应用布局样式
  return css
    // 移除 body 的 overflow: hidden 和 height: 100vh
    .replace(/body\s*\{[^}]*overflow\s*:\s*hidden[^}]*\}/g, (match) => {
      // 只移除 overflow: hidden 和 height: 100vh，保留其他样式
      return match
        .replace(/overflow\s*:\s*hidden\s*;?/g, '')
        .replace(/height\s*:\s*100vh\s*;?/g, '')
    })
    // 移除 #root, .app, .workspace-container 等应用容器样式
    .replace(/#root\s*\{[^}]*\}/g, '')
    .replace(/\.app\s*\{[^}]*\}/g, '')
    .replace(/\.workspace-container\s*\{[^}]*\}/g, '')
    .replace(/\.main-content\s*\{[^}]*\}/g, '')
    .replace(/\.sidebar\s*\{[^}]*\}/g, '')
    .replace(/\.titlebar\s*\{[^}]*\}/g, '')
    .replace(/\.header\s*\{[^}]*\}/g, '')
    // 移除文件树相关样式
    .replace(/\.file-tree[^{]*\{[^}]*\}/g, '')
    // 移除标签栏相关样式
    .replace(/\.tab-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.tab-item[^{]*\{[^}]*\}/g, '')
    // 移除导航栏相关样式
    .replace(/\.navigation-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.nav-[^{]*\{[^}]*\}/g, '')
    // 移除书签栏相关样式
    .replace(/\.bookmark-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.bookmark-panel[^{]*\{[^}]*\}/g, '')
    // 移除搜索相关样式
    .replace(/\.search-[^{]*\{[^}]*\}/g, '')
    // 移除设置面板相关样式
    .replace(/\.settings-[^{]*\{[^}]*\}/g, '')
}

function hasCoreMarkdownExportCss(css: string): boolean {
  return /\.markdown-body\s*\{/.test(css) &&
    /\.markdown-body\s+blockquote\b/.test(css) &&
    /\.markdown-body\s+table\b/.test(css) &&
    /\.markdown-body\s+table\s+(td|th)\b/.test(css)
}

async function getExportStyles(): Promise<{ markdownCss: string; prismCss: string }> {
  let markdownCss = ''
  let prismCss = ''

  try {
    // 开发环境路径
    if (is.dev) {
      const srcPath = join(__dirname, '../../src/renderer/src/assets')
      markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
      prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
    } else {
      // 生产环境：尝试多个可能的路径
      const possiblePaths = [
        join(__dirname, '../renderer/assets'),
        join(__dirname, '../renderer'),
        join(app.getAppPath(), 'out/renderer/assets'),
        join(app.getAppPath(), 'out/renderer')
      ]

      for (const assetsPath of possiblePaths) {
        try {
          // 尝试直接读取文件
          markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
          prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
          break
        } catch {
          // 尝试读取合并后的 CSS 文件（Vite 可能会重命名）
          try {
            const files = await fs.readdir(assetsPath)
            const cssFiles = files.filter(f => f.endsWith('.css')).sort((a, b) => {
              const score = (name: string): number => name.startsWith('katex') ? 0 : name.startsWith('index') ? 1 : 2
              return score(a) - score(b) || a.localeCompare(b)
            })
            if (cssFiles.length > 0) {
              const combinedCss = sanitizeBundledExportCss(
                (await Promise.all(cssFiles.map(file => fs.readFile(join(assetsPath, file), 'utf-8')))).join('\n')
              )
              if (!hasCoreMarkdownExportCss(combinedCss)) {
                continue
              }
              markdownCss = combinedCss
              prismCss = ''
              break
            }
          } catch {
            continue
          }
        }
      }
    }
  } catch (cssError) {
    console.error('Failed to read CSS files:', cssError)
  }

  // 如果仍然没有样式，使用内嵌的完整样式
  if (!markdownCss || !hasCoreMarkdownExportCss(markdownCss)) {
    markdownCss = getBuiltinMarkdownCSS()
    prismCss = getBuiltinPrismCSS()
  }

  return { markdownCss, prismCss }
}

// 内置的完整 Markdown 样式
function getBuiltinMarkdownCSS(): string {
  return `
.markdown-body {
  font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  word-wrap: break-word;
}

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  line-height: 1.2;
  margin-top: 1em;
  margin-bottom: 16px;
  color: var(--text-strong);
  font-weight: 600;
}

.markdown-body h1 { font-size: 2.25em; font-weight: 300; }
.markdown-body h2 { font-size: 1.75em; font-weight: 400; }
.markdown-body h3 { font-size: 1.5em; font-weight: 500; }
.markdown-body h4 { font-size: 1.25em; }
.markdown-body h5, .markdown-body h6 { font-size: 1em; }
.markdown-body h6 { color: var(--text-secondary); }

.markdown-body strong { color: var(--text-strong); font-weight: 600; }
.markdown-body a { color: #08c; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body p, .markdown-body ul, .markdown-body ol,
.markdown-body blockquote, .markdown-body table, .markdown-body pre {
  margin-bottom: 16px;
}

.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }

.markdown-body blockquote {
  padding: 0 1em;
  color: var(--text-secondary);
  border-left: 4px solid var(--blockquote-border);
  background: var(--blockquote-bg);
}

.markdown-body code {
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 85%;
  background: var(--inline-code-bg);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

.markdown-body pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background: var(--code-block-bg);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.markdown-body pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  /* 列多 + 单元格含长 URL/路径时，默认 table-layout:auto 会让某列撑爆导致最后列被裁。
     配合单元格 word-break，允许内容换行而不是撑宽列。 */
  word-break: break-word;
  overflow-wrap: anywhere;
}

.markdown-body th, .markdown-body td {
  padding: 6px 13px;
  border: 1px solid var(--border-color);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.markdown-body th {
  font-weight: 600;
  background: var(--table-header-bg);
}

.markdown-body tr:nth-child(2n) {
  background: var(--bg-secondary);
}

.markdown-body hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--hr-color);
  border: 0;
}

.markdown-body img {
  max-width: 100%;
  box-sizing: content-box;
}

.markdown-body .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
}
`
}

// 内置的 Prism 代码高亮样式
function getBuiltinPrismCSS(): string {
  return `
code[class*="language-"], pre[class*="language-"] {
  color: var(--text-primary);
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  text-align: left;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  line-height: 1.4;
  tab-size: 4;
}

.token.comment, .token.blockquote { color: #969896; }
.token.cdata { color: #183691; }
.token.doctype, .token.punctuation, .token.variable { color: var(--text-primary); }
.token.operator, .token.important, .token.keyword, .token.rule, .token.builtin { color: #a71d5d; }
.token.string, .token.url, .token.regex, .token.attr-value { color: #183691; }
.token.property, .token.number, .token.boolean, .token.entity, .token.atrule,
.token.constant, .token.symbol, .token.command, .token.code { color: #0086b3; }
.token.tag, .token.selector, .token.prolog { color: #63a35c; }
.token.function, .token.namespace, .token.pseudo-element, .token.class,
.token.class-name, .token.pseudo-class, .token.id, .token.url-reference .token.variable,
.token.attr-name { color: #795da3; }
.token.entity { cursor: help; }
.token.title, .token.title .token.punctuation { font-weight: bold; color: #1d3e81; }
.token.list { color: #ed6a43; }
.token.inserted { background-color: #eaffea; color: #55a532; }
.token.deleted { background-color: #ffecec; color: #bd2c00; }
.token.bold { font-weight: bold; }
.token.italic { font-style: italic; }
`
}

// 生成 PDF 专用的 HTML 模板（用于打印）
function generatePDFHTML(content: string, markdownCss: string, prismCss: string, showBranding = true): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://registry.npmmirror.com/katex/0.16.27/files/dist/katex.min.css" onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css'">
  <style>
    :root {
      /* ✅ PDF 使用固定的亮色主题 - 完整版本 */
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;

      /* ✅ Markdown 样式变量（完整） */
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;

      /* ✅ Prism 主题需要的变量 */
      --kbd-border-bottom: #b8b8b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      padding: 10mm;  /* ✅ 减小内边距（因为 printToPDF 已设置 15mm 边距） */
      font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
      background: white;
      color: var(--text-primary);
      line-height: 1.6;  /* ✅ 提升可读性 */
    }

    ${markdownCss}
    ${prismCss}

    /* ECharts 图表样式 - PDF 优化 */
    .echarts-container {
      width: 100%;
      max-width: 100%;
      margin: 1.5em 0;
      border-radius: 6px;
      overflow: visible;
      background: transparent;
    }

    .echarts-container svg {
      display: block;
      width: 100% !important;
      height: auto;
      margin: 0 auto;
    }

    /* 统一 PDF 中图表的打印尺寸，避免导出后整页铺满 */
    .markdown-body .mermaid-container,
    .markdown-body .echarts-container,
    .markdown-body .graphviz-container,
    .markdown-body .plantuml-container,
    .markdown-body .c4plantuml-container,
    .markdown-body .excalidraw-container,
    .markdown-body .vega-lite-container,
    .markdown-body .d2-container,
    .markdown-body .bpmn-container,
    .markdown-body .wavedrom-container,
    .markdown-body .structurizr-container,
    .markdown-body .plotly-container,
    .markdown-body .dbml-container,
    .markdown-body .antv-g6-container,
    .markdown-body .kroki-container,
    .markdown-body .markmap-container,
    .markdown-body .infographic-container {
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      text-align: center;
      width: 100%;
      max-width: 150mm;
      margin: 1.5em auto !important;
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: visible;
    }

    .markdown-body .mermaid-container svg,
    .markdown-body .echarts-container svg,
    .markdown-body .echarts-container canvas,
    .markdown-body .graphviz-container svg,
    .markdown-body .plantuml-container svg,
    .markdown-body .c4plantuml-container svg,
    .markdown-body .excalidraw-container svg,
    .markdown-body .vega-lite-container svg,
    .markdown-body .d2-container svg,
    .markdown-body .bpmn-container svg,
    .markdown-body .wavedrom-container svg,
    .markdown-body .structurizr-container svg,
    .markdown-body .plotly-container svg,
    .markdown-body .dbml-container svg,
    .markdown-body .antv-g6-container svg,
    .markdown-body .kroki-container svg,
    .markdown-body .markmap-container svg,
    .markdown-body .infographic-container svg {
      display: block;
      max-width: 100% !important;
      max-height: 180mm;
      height: auto !important;
      margin: 0 auto !important;
      flex: 0 1 auto;
    }

    .pdf-export-branding {
      text-align: center;
      margin: 12px 0 0;
      padding-top: 8px;
      border-top: 1px solid #eee;
      font-size: 10px;
      line-height: 1.2;
      color: #999;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ✅ 增强 PDF 打印样式 */
    @media print {
      body {
        padding: 0;  /* 打印时去除内边距（避免双重边距） */
      }

      .markdown-body {
        max-width: none;
      }

      /* 防止元素跨页断裂 */
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3,
      .markdown-body h4,
      .markdown-body h5,
      .markdown-body h6 {
        page-break-after: avoid;
      }

      .markdown-body pre,
      .markdown-body blockquote {
        page-break-inside: avoid;
      }

      /* 表格：允许跨页（table 整体 avoid 在长表下导致溢出被裁），
         但同一行不跨页 */
      .markdown-body table {
        page-break-inside: auto;
        /* 列多时用 fixed 布局兜底：列按首行或 colgroup 等宽分配，
           避免某列内容长导致其他列被裁 */
        table-layout: fixed;
      }
      .markdown-body tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      /* 列多时字号略缩，缓解挤压 */
      .markdown-body th,
      .markdown-body td {
        font-size: 90%;
        padding: 4px 8px;
      }

      /* 优化代码块显示 */
      .markdown-body pre,
      .markdown-body pre[class*="language-"] {
        white-space: pre-wrap;       /* ✅ 自动换行 */
        word-wrap: break-word;
        overflow-wrap: anywhere;
        word-break: break-word;
        overflow-x: visible;
      }

      .markdown-body pre > code,
      .markdown-body pre code,
      .markdown-body pre code[class*="language-"],
      .markdown-body pre[class*="language-"] > code,
      .markdown-body pre[class*="language-"] code[class*="language-"] {
        white-space: pre-wrap !important;
        word-wrap: break-word;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      /* 表格单元格里内嵌的代码 / 行内代码，同样允许换行 */
      .markdown-body td code,
      .markdown-body th code {
        white-space: pre-wrap;
        word-break: break-all;
      }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    ${content}
  </div>
  ${showBranding ? `<div class="pdf-export-branding">由 MD Viewer 生成 · github.com/wj2929/md-viewer</div>` : ''}
</body>
</html>`
}

export function registerExportHandlers(ctx: IPCContext): void {
  // 导出 HTML
// 导出 HTML
ipcMain.handle('export:html', async (_, htmlContent: string, fileName: string) => {
  try {
    const result = await dialog.showSaveDialog({
      title: '导出 HTML',
      defaultPath: withExportExtension(fileName, 'html'),
      filters: [
        { name: 'HTML Files', extensions: ['html'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const settings = appDataManager.getSettings()
    const showBranding = settings.showExportBranding !== false
    const { markdownCss, prismCss } = await getExportStyles()

    await writeHtmlExport(result.filePath, {
      content: htmlContent,
      title: fileName,
      markdownCss,
      prismCss,
      showBranding,
    })
    return result.filePath
  } catch (error) {
    console.error('Failed to export HTML:', error)
    throw error
  }
})

// 导出 PDF
ipcMain.handle('export:pdf', async (event, htmlContent: string, fileName: string) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出 PDF',
      defaultPath: withExportExtension(fileName, 'pdf'),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const settings = appDataManager.getSettings()
    const showBranding = settings.showExportBranding !== false
    const { markdownCss, prismCss } = await getExportStyles()
    await writePdfExport(result.filePath, {
      content: htmlContent,
      title: fileName,
      markdownCss,
      prismCss,
      showBranding,
    })
    return result.filePath
  } catch (error) {
    console.error('Failed to export PDF:', error)
    throw error
  }
})

ipcMain.handle('export:charts-zip', async (event, payload: ExportChartsZipPayload) => {
  try {
    const markdownFilePath = payload?.markdownFilePath
    const images = Array.isArray(payload?.images) ? payload.images : []

    if (!markdownFilePath) {
      return { error: '缺少 Markdown 文件路径' }
    }
    validatePath(markdownFilePath)

    if (images.length === 0) {
      return { error: '当前文档没有可打包下载的图表' }
    }
    if (images.length > MAX_CHART_ZIP_IMAGES) {
      return { error: `单次最多打包 ${MAX_CHART_ZIP_IMAGES} 张图表，请拆分文档后重试` }
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '打包下载图表',
      defaultPath: resolveChartsZipDefaultPath(markdownFilePath),
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    const zip = new AdmZip()
    const usedNames = new Set<string>()
    const rootDirectory = sanitizeZipDirectoryName(
      path.basename(result.filePath, path.extname(result.filePath)),
    )
    let written = 0

    images.forEach((image, index) => {
      const buffer = decodePngBase64(image.pngBase64)
      if (!buffer) return

      const safeName = uniqueZipEntryName(
        sanitizeZipEntryName(image.filename, index),
        usedNames,
      )
      zip.addFile(`${rootDirectory}/${safeName}`, buffer)
      written += 1
    })

    if (written === 0) {
      return { error: '没有有效的 PNG 图表数据可写入 ZIP' }
    }

    await new Promise<void>((resolve, reject) => {
      zip.writeZip(result.filePath!, (error: Error | null) => {
        if (error) reject(error)
        else resolve()
      })
    })
    return { filePath: result.filePath, written }
  } catch (error) {
    console.error('Failed to export chart ZIP:', error)
    return { error: error instanceof Error ? error.message : String(error) }
  }
})


ipcMain.handle('render:codeBlockToPng', async (_, code: string) => {
  try {
    // 获取样式
    const { markdownCss, prismCss } = await getExportStyles()

    // 创建隐藏窗口（不使用 offscreen 模式，macOS 上 offscreen 的 capturePage 不稳定）
    const renderWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 转义 HTML 特殊字符
    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    // 生成 HTML（改进字体栈，添加 CJK 等宽字体支持）
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${markdownCss}
    ${prismCss}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: #f5f5f5;
      width: fit-content;
      height: fit-content;
    }
    .code-container {
      display: inline-block;
      background: #f5f5f5;
      border-radius: 6px;
      padding: 16px;
      border: 1px solid #e0e0e0;
    }
    pre {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      font-family: 'Sarasa Mono SC', 'Source Han Mono', Menlo, Monaco, Consolas, 'Courier New', monospace !important;
      font-size: 13px !important;
      line-height: 1.5 !important;
      white-space: pre !important;
      overflow: visible !important;
    }
    code {
      font-family: inherit !important;
      font-size: inherit !important;
      background: transparent !important;
      padding: 0 !important;
    }
  </style>
</head>
<body>
  <div class="code-container">
    <pre><code>${escapeHtml(code)}</code></pre>
  </div>
</body>
</html>`

    // 加载 HTML（使用临时文件避免 data URL 长度限制）
    const tmpCodePath = path.join(os.tmpdir(), `md-viewer-code-${Date.now()}.html`)
    await fs.writeFile(tmpCodePath, html, 'utf-8')
    try {
      await renderWindow.loadFile(tmpCodePath)
    } finally {
      fs.remove(tmpCodePath).catch(() => {})
    }

    // 等待渲染完成（增加等待时间确保字体加载）
    await new Promise(resolve => setTimeout(resolve, 500))

    // 获取内容尺寸
    const bounds = await renderWindow.webContents.executeJavaScript(`
      (() => {
        const container = document.querySelector('.code-container');
        if (!container) return { width: 800, height: 400 };
        const rect = container.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width) + 4,
          height: Math.ceil(rect.height) + 4
        };
      })()
    `)

    // 调整窗口大小以匹配内容
    renderWindow.setSize(bounds.width, bounds.height)
    await new Promise(resolve => setTimeout(resolve, 100))

    // 截图（带重试机制）
    let image = await renderWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })

    // 空图检测：如果截图为空或过小，重试一次
    let pngBuffer = image.toPNG()
    if (pngBuffer.length < 1000) {
      console.log(`[CodeBlock] 首次截图过小 (${pngBuffer.length} bytes)，等待后重试...`)
      await new Promise(resolve => setTimeout(resolve, 500))
      image = await renderWindow.webContents.capturePage({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      })
      pngBuffer = image.toPNG()
    }

    // 关闭窗口
    renderWindow.close()

    // 最终空图检测
    if (pngBuffer.length < 500) {
      console.error(`[CodeBlock] 截图仍为空 (${pngBuffer.length} bytes)，放弃截图`)
      return {
        success: false,
        error: '截图结果为空，可能是渲染引擎问题'
      }
    }

    const base64 = pngBuffer.toString('base64')

    console.log(`[CodeBlock] 截图成功: ${bounds.width}x${bounds.height}, ${Math.round(pngBuffer.length / 1024)}KB`)

    return {
      success: true,
      data: base64,
      width: bounds.width,
      height: bounds.height
    }
  } catch (error) {
    console.error('[CodeBlock] 截图失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})


ipcMain.handle('render:svgToPng', async (_, svgString: string, width?: number) => {
  try {
    const renderWidth = width || 1170
    const renderWindow = new BrowserWindow({
      show: false,
      width: renderWidth + 40,
      height: 800,
      frame: false,
      useContentSize: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: white;
  width: max-content;
  height: max-content;
  overflow: hidden !important;
}
::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
.svg-container {
  display: inline-block;
  background: white;
  padding: 8px;
  width: ${renderWidth}px;
  overflow: visible !important;
}
.svg-container svg {
  display: block;
  width: 100% !important;
  max-width: ${renderWidth}px !important;
  height: auto !important;
  overflow: visible !important;
}
</style></head>
<body><div class="svg-container">${svgString}</div></body></html>`

    const tmpPath = path.join(os.tmpdir(), `md-viewer-svg-${Date.now()}.html`)
    await fs.writeFile(tmpPath, html, 'utf-8')
    try { await renderWindow.loadFile(tmpPath) } finally { fs.remove(tmpPath).catch(() => {}) }

    await new Promise(resolve => setTimeout(resolve, 300))

    const bounds = await renderWindow.webContents.executeJavaScript(`
      (() => {
        const c = document.querySelector('.svg-container');
        if (!c) return { width: 800, height: 400 };
        const r = c.getBoundingClientRect();
        return {
          width: Math.ceil(Math.max(r.width, c.scrollWidth)) + 4,
          height: Math.ceil(Math.max(r.height, c.scrollHeight)) + 4
        };
      })()
    `)

    const captureWidth = Math.min(bounds.width, 2400)
    const captureHeight = Math.min(bounds.height, 4000)
    renderWindow.setContentSize(captureWidth, captureHeight)
    await new Promise(resolve => setTimeout(resolve, 100))

    let image = await renderWindow.webContents.capturePage({
      x: 0, y: 0, width: captureWidth, height: captureHeight
    })
    let pngBuffer = image.toPNG()

    if (pngBuffer.length < 1000) {
      await new Promise(resolve => setTimeout(resolve, 500))
      image = await renderWindow.webContents.capturePage({
        x: 0, y: 0, width: captureWidth, height: captureHeight
      })
      pngBuffer = image.toPNG()
    }

    renderWindow.close()

    if (pngBuffer.length < 500) {
      return { success: false, error: 'Screenshot empty' }
    }

    return { success: true, data: pngBuffer.toString('base64'), width: bounds.width, height: bounds.height }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('render:krokiSvg', async (_, payload: { format?: string; source?: string }) => {
  const format = String(payload?.format || '').trim().toLowerCase()
  const source = String(payload?.source || '').trim()

  if (!KROKI_FORMATS.has(format)) {
    return { ok: false, error: `暂不支持 Kroki 格式：${format || 'unknown'}` }
  }
  if (!source) {
    return { ok: false, error: 'Kroki 图表内容为空' }
  }
  if (source.length > MAX_KROKI_SOURCE_LENGTH) {
    return { ok: false, error: 'Kroki 图表内容超过 128KB，已阻止渲染' }
  }

  try {
    const response = await net.fetch(`${KROKI_ENDPOINT}/${format}/svg`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: source,
    })
    const svg = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, error: svg || `Kroki 服务返回 ${response.status}` }
    }
    if (!/<svg[\s>]/i.test(svg)) {
      return { ok: false, error: 'Kroki 服务未返回 SVG' }
    }
    return { ok: true, svg }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})


ipcMain.handle('export:docx', async (event, htmlContent: string, fileName: string, basePath: string, markdown?: string, chartImages?: ChartImageData[], docStyle?: string, remoteImages?: RemoteImage[]) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const settings = appDataManager.getSettings()
    const showBranding = settings.showExportBranding !== false
    const docxConfig = settings.docxExport
    const selectedRemoteStyle = normalizeDocxStyle(docxConfig?.style)
    let effectiveRemoteStyle = selectedRemoteStyle
    let styleCompatibilityWarnings: string[] = []

    if (docxConfig?.remoteEnabled && docxConfig.serverUrl) {
      try {
        const compatibility = await resolveRemoteDocxStyle(docxConfig, selectedRemoteStyle)
        effectiveRemoteStyle = compatibility.style
        styleCompatibilityWarnings = compatibility.warnings
      } catch (compatErr) {
        const detail = compatErr instanceof DocxExportError
          ? compatErr.detail
          : {
              errorType: 'unknown' as const,
              message: compatErr instanceof Error ? compatErr.message : String(compatErr),
              serverUrl: docxConfig.serverUrl || '',
              timestamp: new Date().toISOString(),
            }
        return { error: detail }
      }
    }

    const styleLabel = docStyle === 'gongwen' ? '（公文格式）' :
      (docxConfig?.style ? `（${DOCX_STYLE_LABELS[effectiveRemoteStyle]}）` : '')
    const testSavePath = process.env.NODE_ENV === 'test'
      ? resolveTestDocxSavePath(process.env.MD_VIEWER_TEST_SAVE_DOCX_PATH, fileName, effectiveRemoteStyle)
      : undefined
    const result = testSavePath
      ? { canceled: false, filePath: testSavePath }
      : await dialog.showSaveDialog(window, {
          title: `导出 Word 文档${styleLabel}`,
          defaultPath: withExportExtension(fileName, 'docx'),
          filters: [
            { name: 'Word Documents', extensions: ['docx'] }
          ]
        })

    if (result.canceled || !result.filePath) {
      return null
    }

    let filePath: string
    let warnings: string[] = [...styleCompatibilityWarnings]
    let usedPandoc = false
    let usedRemote = false
    let imagesFailed = 0

    // 三分支路由
    if (docxConfig?.remoteEnabled && docxConfig.serverUrl) {
      // 路径 1：远程服务
      try {
        console.log(`[DOCX Export] 使用远程服务: ${docxConfig.serverUrl}`)
        const remoteResult = await exportViaRemote(
          markdown || htmlContent,
          result.filePath,
          {
            style: effectiveRemoteStyle,
            title: undefined,
            footerText: showBranding ? '由 MD Viewer 生成 · github.com/wj2929/md-viewer' : null,
            images: remoteImages,
            embedFont: docxConfig.embedFont,
          }
        )
        filePath = remoteResult.filePath
        warnings = [...styleCompatibilityWarnings, ...remoteResult.warnings]
        usedRemote = true
        imagesFailed = remoteResult.imagesFailed
      } catch (remoteErr) {
        console.error('[DOCX Export] 远程服务失败:', remoteErr)

        if (docxConfig.localFallbackEnabled) {
          console.log('[DOCX Export] 降级到本地路径')
          warnings.push(`远程服务失败: ${remoteErr instanceof Error ? remoteErr.message : String(remoteErr)}`)
          const localResult = await _exportLocalDocx(htmlContent, result.filePath, basePath, markdown, chartImages, docStyle, remoteImages)
          filePath = localResult.filePath
          warnings.push(...localResult.warnings)
          usedPandoc = localResult.usedPandoc
        } else {
          const detail = remoteErr instanceof DocxExportError
            ? remoteErr.detail
            : {
                errorType: 'unknown' as const,
                message: `DOCX 服务不可用: ${remoteErr instanceof Error ? remoteErr.message : String(remoteErr)}`,
                serverUrl: docxConfig.serverUrl || '',
                timestamp: new Date().toISOString(),
              }
          return { error: detail }
        }
      }
    } else if (docxConfig?.localFallbackEnabled) {
      // 路径 2：本地路径（用户主动启用）
      console.log('[DOCX Export] 使用本地路径（用户启用离线模式）')
      const localResult = await _exportLocalDocx(htmlContent, result.filePath, basePath, markdown, chartImages, docStyle, remoteImages)
      filePath = localResult.filePath
      warnings = localResult.warnings
      usedPandoc = localResult.usedPandoc
    } else {
      // 路径 3：两个开关都未启用（理论上 UI 已隐藏菜单，不应走到）
      throw new Error('DOCX 导出未启用，请在设置中开启远程服务或本地导出')
    }

    lastDocxExportPath = filePath
    return { filePath, warnings, usedPandoc, usedRemote, imagesFailed }
  } catch (error) {
    console.error('Failed to export DOCX:', error)
    if (error instanceof DocxExportError) {
      return { error: error.detail }
    }
    throw error
  }
})

function resolveTestDocxSavePath(template: string | undefined, fileName: string, style: string): string | undefined {
  if (!template) return undefined
  return template
    .replace(/\{style\}/g, style)
    .replace(/\{name\}/g, fileName.replace(EXPORT_SOURCE_EXTENSION_RE, ''))
}

// 本地 DOCX 导出（Pandoc → docx 库 fallback，保持原有逻辑）
async function _exportLocalDocx(
  htmlContent: string,
  outputPath: string,
  basePath: string,
  markdown?: string,
  chartImages?: ChartImageData[],
  docStyle?: string,
  embeddedImages?: EmbeddedDocxImage[]
): Promise<{ filePath: string; warnings: string[]; usedPandoc: boolean }> {
  const pandocAvailable = await isPandocAvailable()

  if (pandocAvailable) {
    console.log(`[DOCX Export] 本地 Pandoc 导出${docStyle === 'gongwen' ? '（公文格式）' : ''}`)
    const pandocResult = await exportWithPandoc(htmlContent, outputPath, basePath, docStyle)
    return { filePath: pandocResult.filePath, warnings: pandocResult.warnings, usedPandoc: true }
  } else if (markdown) {
    console.log('[DOCX Export] Pandoc 不可用，使用 docx 库导出')
    const docxResult = await exportToDocx(markdown, outputPath, basePath, chartImages || [], embeddedImages || [])
    return { filePath: docxResult.filePath, warnings: docxResult.warnings, usedPandoc: false }
  } else {
    throw new Error('Pandoc 不可用，且未提供 Markdown 内容')
  }
}

// 测试 DOCX 服务连接
ipcMain.handle('docx:testConnection', async (_, serverUrl: string, apiKey?: string) => {
  return testConnection(serverUrl, apiKey)
})

ipcMain.handle('docx:selectReferenceDocx', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: '选择 reference.docx 模板',
    properties: ['openFile'],
    filters: [{ name: 'Word 模板', extensions: ['docx'] }],
  } as Electron.OpenDialogOptions
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('docx:getLastExportedFile', () => lastDocxExportPath)

ipcMain.handle('docx:openLastExport', async () => {
  if (!lastDocxExportPath) return { ok: false, error: '没有导出记录' }
  const exists = await fs.pathExists(lastDocxExportPath)
  if (!exists) return { ok: false, error: '文件已不存在' }
  const { shell } = require('electron')
  const err = await shell.openPath(lastDocxExportPath)
  return err ? { ok: false, error: err } : { ok: true }
})

}
