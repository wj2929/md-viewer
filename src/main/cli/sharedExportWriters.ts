import { writeFile, stat } from 'fs/promises'
import type { CliArtifact } from './types'

interface HtmlDocumentOptions {
  content: string
  title: string
  markdownCss: string
  prismCss: string
  katexCss?: string
  showBranding: boolean
}

export type PdfDocumentOptions = HtmlDocumentOptions & {
  signal?: AbortSignal
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, char => map[char])
}

const EXPORT_NON_CONTENT_CSS = `
    .no-export,
    [data-no-export="true"] {
      display: none !important;
      visibility: hidden !important;
    }
`

export function buildExportHtmlDocument(options: HtmlDocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root {
      /* 固定亮色主题变量，导出 HTML 不跟随系统暗色模式 */
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;
    }

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

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    .markdown-body {
      font-size: 16px;
      line-height: 1.6;
      word-wrap: break-word;
    }

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

    .mermaid-error,
    .echarts-error {
      color: #c53030;
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      margin: 1em 0;
      font-size: 14px;
    }

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

    .markdown-body img { max-width: 100%; }
    .markdown-body table { border-collapse: collapse; width: 100%; }
    .markdown-body th,
    .markdown-body td { border: 1px solid var(--border-color); padding: 6px 13px; }
    .markdown-body pre {
      padding: 16px;
      overflow: auto;
      background: var(--code-block-bg);
      border-radius: 6px;
    }
    ${EXPORT_NON_CONTENT_CSS}
    ${options.markdownCss}
    ${options.prismCss}
    ${options.katexCss || ''}
    .markdown-body .echarts-container {
      width: 100%;
      max-width: 100%;
      height: auto !important;
      overflow: visible;
    }
    .markdown-body .echarts-container > svg {
      position: static !important;
      display: block;
      width: 100% !important;
      height: auto !important;
      max-width: 100%;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="markdown-body">
      ${options.content}
    </div>
  </div>
  ${options.showBranding ? `<div style="text-align:center;padding:24px 0 12px;font-size:12px;color:#999;border-top:1px solid #eee;margin-top:40px;">由 <a href="https://github.com/wj2929/md-viewer" target="_blank" rel="noopener noreferrer" style="color:#007aff;text-decoration:none;">MD Viewer</a> 生成</div>` : ''}
</body>
</html>`
}

export async function writeHtmlExport(outputPath: string, options: HtmlDocumentOptions): Promise<CliArtifact> {
  const html = buildExportHtmlDocument(options)
  await writeFile(outputPath, html, 'utf8')
  const fileStat = await stat(outputPath)
  return {
    type: 'html',
    path: outputPath,
    bytes: fileStat.size,
  }
}

export function buildExportPdfDocument(options: PdfDocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(options.title)}</title>
  <style>${options.katexCss ?? ''}</style>
  <style>
    :root {
      --bg-primary: #ffffff;
      --bg-secondary: #f5f5f5;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-strong: #000000;
      --border-color: #e0e0e0;
      --accent-color: #007aff;
      --blockquote-bg: #f6f8fa;
      --blockquote-border: #dfe2e5;
      --inline-code-bg: #f6f8fa;
      --code-block-bg: #f6f8fa;
      --table-header-bg: #f6f8fa;
      --heading-border: #eaecef;
      --hr-color: #eaecef;
      --kbd-border-bottom: #b8b8b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      padding: 10mm;
      font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
      background: white;
      color: var(--text-primary);
      line-height: 1.6;
    }

    ${EXPORT_NON_CONTENT_CSS}
    ${options.markdownCss}
    ${options.prismCss}

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
    .markdown-body .svg-container,
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
    .markdown-body .svg-container svg,
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

    @media print {
      body {
        padding: 0;
      }

      .markdown-body {
        max-width: none;
      }

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

      .markdown-body table {
        page-break-inside: auto;
        table-layout: fixed;
      }

      .markdown-body tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      .markdown-body th,
      .markdown-body td {
        font-size: 90%;
        padding: 4px 8px;
      }

      .markdown-body pre,
      .markdown-body pre[class*="language-"] {
        white-space: pre-wrap;
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
    ${options.content}
  </div>
  ${options.showBranding ? `<div class="pdf-export-branding">由 MD Viewer 生成 · github.com/wj2929/md-viewer</div>` : ''}
</body>
</html>`
}

export async function writePdfExport(outputPath: string, options: PdfDocumentOptions): Promise<CliArtifact> {
  const [{ getPdfExportStyles }, { exportPdfSnapshot }] = await Promise.all([
    import('../ipc/exportStyles'),
    import('../pdf/pdfExport'),
  ])
  const styles = await getPdfExportStyles(options.markdownCss, options.prismCss)
  return exportPdfSnapshot(outputPath, buildExportPdfDocument({ ...options, ...styles }), options.title, options.signal)
}
