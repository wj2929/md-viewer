import { BrowserWindow, ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import { IPCContext } from './context'
import { appDataManager } from '../appDataManager'
import { exportToDocx, ChartImageData } from '../docxExporter'
import { exportWithPandoc, isPandocAvailable } from '../pandocExporter'

// 获取导出用的完整 CSS（包含所有必需的变量和样式）
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
            const cssFile = files.find(f => f.endsWith('.css') && f.startsWith('index'))
            if (cssFile) {
              let combinedCss = await fs.readFile(join(assetsPath, cssFile), 'utf-8')
              // 过滤掉应用程序的布局样式（这些样式会阻止导出 HTML 滚动）
              // 移除 body { overflow: hidden; height: 100vh; } 等应用布局样式
              combinedCss = combinedCss
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
  if (!markdownCss) {
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
}

.markdown-body th, .markdown-body td {
  padding: 6px 13px;
  border: 1px solid var(--border-color);
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

// HTML 转义（用于标题等用户输入）
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, c => map[c])
}

// 生成导出用的完整 HTML 模板（含 CSP 和 Mermaid 支持）
function generateExportHTML(content: string, title: string, markdownCss: string, prismCss: string, showBranding = true): string {
  // v1.4.7: 导出 HTML 强制使用亮色主题，移除 dark mode 媒体查询
  // 恢复 .container 包装器以提供两侧间距
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://registry.npmmirror.com/katex/0.16.27/files/dist/katex.min.css" onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css'">
  <style>
    :root {
      /* 固定亮色主题变量（不响应系统暗色模式） */
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;
      /* Markdown 样式变量 */
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;
    }

    /* 注意：移除了 @media (prefers-color-scheme: dark) 块，确保导出 HTML 始终为亮色主题 */

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      height: 100%;
      overflow: auto;
    }

    body {
      background: var(--bg-primary);
      font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
      color: var(--text-primary);
    }

    /* 恢复 .container 包装器，提供两侧间距 */
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    /* Mermaid 图表样式 - 固定亮色主题 */
    .mermaid-container {
      display: flex;
      justify-content: center;
      margin: 1.5em 0;
      overflow-x: auto;
    }

    .mermaid-container svg {
      max-width: 100%;
      height: auto;
    }

    .mermaid-error {
      color: #c53030;
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      margin: 1em 0;
      font-size: 14px;
    }

    /* 注意：移除了 .mermaid-error 的 dark mode 样式 */

    /* ECharts 图表样式 - 固定亮色主题 */
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
      max-width: none;
    }

    .echarts-error {
      color: #c53030;
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      margin: 1em 0;
      font-size: 14px;
    }

    ${markdownCss}
    ${prismCss}
  </style>
</head>
<body>
  <div class="container">
    <div class="markdown-body">
      ${content}
    </div>
  </div>
  ${showBranding ? `<div style="text-align:center;padding:24px 0 12px;font-size:12px;color:#999;border-top:1px solid #eee;margin-top:40px;">由 <a href="https://github.com/wj2929/md-viewer" target="_blank" rel="noopener noreferrer" style="color:#007aff;text-decoration:none;">MD Viewer</a> 生成</div>` : ''}
</body>
</html>`
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
      .markdown-body table,
      .markdown-body blockquote {
        page-break-inside: avoid;
      }

      /* 优化代码块显示 */
      .markdown-body pre {
        white-space: pre-wrap;       /* ✅ 自动换行 */
        word-wrap: break-word;
        overflow-x: visible;
      }
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    ${content}
  </div>
  ${showBranding ? `<div style="text-align:center;padding:24px 0 12px;font-size:10px;color:#999;border-top:1px solid #eee;margin-top:40px;">由 MD Viewer 生成 · github.com/wj2929/md-viewer</div>` : ''}
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
      defaultPath: fileName.replace(/\.md$/, '.html'),
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
    const fullHtml = generateExportHTML(htmlContent, fileName, markdownCss, prismCss, showBranding)

    await fs.writeFile(result.filePath, fullHtml, 'utf-8')
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
      defaultPath: fileName.replace(/\.md$/, '.pdf'),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 创建一个隐藏的窗口用于打印
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 获取样式
    const settings = appDataManager.getSettings()
    const showBranding = settings.showExportBranding !== false
    const { markdownCss, prismCss } = await getExportStyles()
    const pdfHtml = generatePDFHTML(htmlContent, markdownCss, prismCss, showBranding)

    // 加载 HTML 内容（使用临时文件避免 data URL 长度限制）
    const tmpPdfPath = path.join(os.tmpdir(), `md-viewer-pdf-${Date.now()}.html`)
    await fs.writeFile(tmpPdfPath, pdfHtml, 'utf-8')
    try {
      await printWindow.loadFile(tmpPdfPath)
    } finally {
      fs.remove(tmpPdfPath).catch(() => {})
    }

    // ✅ 等待 KaTeX 渲染完成（智能检测，而不是硬编码时间）
    await printWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        // 检查 KaTeX 是否渲染完成
        const checkKatex = () => {
          const katexElements = document.querySelectorAll('.katex')

          // 如果没有 KaTeX 元素，直接完成
          if (katexElements.length === 0) {
            resolve(true)
            return
          }

          // 检查所有 KaTeX 元素是否都已渲染
          const allRendered = Array.from(katexElements).every(el => {
            // KaTeX 渲染完成后会包含 <math> 或 <mrow> 元素
            return el.querySelector('math') || el.querySelector('mrow') || el.querySelector('span.katex-html')
          })

          if (allRendered) {
            resolve(true)
          } else {
            // 每 100ms 检查一次
            setTimeout(checkKatex, 100)
          }
        }

        // 最多等待 5 秒，防止无限等待
        setTimeout(() => resolve(false), 5000)

        // 开始检查
        if (document.readyState === 'complete') {
          checkKatex()
        } else {
          window.addEventListener('load', checkKatex)
        }
      })
    `)

    // ✅ 额外等待 500ms 确保字体完全加载（CDN 字体可能需要额外时间）
    await new Promise(resolve => setTimeout(resolve, 500))

    // 打印为 PDF
    // ⚠️ Electron printToPDF margins 单位是英寸（inches）
    // 10mm ≈ 0.39 inches (10 / 25.4)
    const marginInInches = 10 / 25.4  // 10mm ≈ 0.39 inches
    const pdfData = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      margins: {
        top: marginInInches,     // ✅ 10mm 上边距
        bottom: marginInInches,  // ✅ 10mm 下边距
        left: marginInInches,    // ✅ 10mm 左边距
        right: marginInInches    // ✅ 10mm 右边距
      },
      printBackground: true,
      preferCSSPageSize: false  // ✅ 强制使用 PDF 边距设置
    })

    // 关闭打印窗口
    printWindow.close()

    await fs.writeFile(result.filePath, pdfData)
    return result.filePath
  } catch (error) {
    console.error('Failed to export PDF:', error)
    throw error
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


ipcMain.handle('export:docx', async (event, htmlContent: string, fileName: string, basePath: string, markdown?: string, chartImages?: ChartImageData[], docStyle?: string) => {
  try {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('无法获取窗口实例')
    }

    const styleLabel = docStyle === 'gongwen' ? '（公文格式）' : ''
    const result = await dialog.showSaveDialog(window, {
      title: `导出 Word 文档${styleLabel}`,
      defaultPath: fileName.replace(/\.md$/, '.docx'),
      filters: [
        { name: 'Word Documents', extensions: ['docx'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // 检查 Pandoc 是否可用
    const pandocAvailable = await isPandocAvailable()

    let filePath: string
    let warnings: string[]
    let usedPandoc = false

    if (pandocAvailable) {
      // 使用 Pandoc 导出（高质量，从 HTML 转换）
      console.log(`[DOCX Export] 使用 Pandoc 从 HTML 导出${docStyle === 'gongwen' ? '（公文格式）' : ''}`)
      const pandocResult = await exportWithPandoc(htmlContent, result.filePath, basePath, docStyle)
      filePath = pandocResult.filePath
      warnings = pandocResult.warnings
      usedPandoc = true
    } else if (markdown) {
      // 回退到 docx 库（需要 markdown 和 chartImages）
      console.log('[DOCX Export] Pandoc 不可用，使用 docx 库导出')
      const docxResult = await exportToDocx(markdown, result.filePath, basePath, chartImages || [])
      filePath = docxResult.filePath
      warnings = docxResult.warnings
    } else {
      throw new Error('Pandoc 不可用，且未提供 Markdown 内容作为回退')
    }

    return { filePath, warnings, usedPandoc }
  } catch (error) {
    console.error('Failed to export DOCX:', error)
    throw error
  }
})
}
