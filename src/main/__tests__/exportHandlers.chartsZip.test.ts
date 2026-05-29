// @vitest-environment node
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { registerExportHandlers } from '../ipc/exportHandlers'
import { resetSecurity, setAllowedBasePath } from '../security'

let loadedPdfHtml = ''

vi.mock('electron', () => {
  const BrowserWindowMock = vi.fn(function BrowserWindowMock() {
    return {
      loadFile: vi.fn(async (filePath: string) => {
        loadedPdfHtml = await fs.readFile(filePath, 'utf-8')
      }),
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue(true),
        printToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7\n')),
      },
      close: vi.fn(),
    }
  })
  ;(BrowserWindowMock as any).fromWebContents = vi.fn()

  return {
    BrowserWindow: BrowserWindowMock,
    dialog: {
      showSaveDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    app: {
      getAppPath: vi.fn(() => process.cwd()),
    },
    net: {
      fetch: vi.fn(),
    },
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

vi.mock('../appDataManager', () => ({
  appDataManager: {
    getSettings: vi.fn().mockReturnValue({
      showExportBranding: false,
      docxExport: {
        remoteEnabled: false,
        localFallbackEnabled: false,
      },
    }),
  },
}))

vi.mock('../docxExporter', () => ({
  exportToDocx: vi.fn(),
}))

vi.mock('../pandocExporter', () => ({
  exportWithPandoc: vi.fn(),
  isPandocAvailable: vi.fn(),
}))

vi.mock('../remoteDocxExporter', () => ({
  exportViaRemote: vi.fn(),
  testConnection: vi.fn(),
  resolveRemoteDocxStyle: vi.fn(),
  DocxExportError: class DocxExportError extends Error {
    detail: unknown
    constructor(message: string, detail: unknown) {
      super(message)
      this.detail = detail
    }
  },
}))

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!found) throw new Error(`Missing handler: ${channel}`)
  return found[1] as T
}

describe('chart zip export handler', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    loadedPdfHtml = ''
    resetSecurity()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-viewer-chart-zip-'))
    setAllowedBasePath(tmpDir)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({} as BrowserWindow)
    registerExportHandlers({} as any)
  })

  afterEach(async () => {
    await fs.remove(tmpDir)
  })

  it('writes selected chart PNG payloads into a zip file', async () => {
    const markdownFilePath = path.join(tmpDir, 'report.md')
    const outputPath = path.join(tmpDir, 'report-charts.zip')
    await fs.writeFile(markdownFilePath, '# report')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    } as any)

    const exportChartsZip = handler<(event: any, payload: {
      markdownFilePath: string
      images: Array<{ filename: string; pngBase64: string }>
    }) => Promise<any>>('export:charts-zip')

    const result = await exportChartsZip({ sender: {} }, {
      markdownFilePath,
      images: [
        { filename: '../01-mermaid.png', pngBase64: 'data:image/png;base64,aGVsbG8=' },
        { filename: '02-kroki-tikz.png', pngBase64: Buffer.from('world').toString('base64') },
      ],
    })

    expect(result).toEqual({ filePath: outputPath, written: 2 })
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      title: '打包下载图表',
      defaultPath: outputPath,
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    }))

    const zip = new AdmZip(outputPath)
    expect(zip.getEntries().map(entry => entry.entryName)).toEqual([
      'report-charts/01-mermaid.png',
      'report-charts/02-kroki-tikz.png',
    ])
    expect(zip.readFile('report-charts/01-mermaid.png')?.toString()).toBe('hello')
    expect(zip.readFile('report-charts/02-kroki-tikz.png')?.toString()).toBe('world')
  })

  it('returns canceled when user cancels the save dialog', async () => {
    const markdownFilePath = path.join(tmpDir, 'report.md')
    await fs.writeFile(markdownFilePath, '# report')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true } as any)

    const exportChartsZip = handler<(event: any, payload: {
      markdownFilePath: string
      images: Array<{ filename: string; pngBase64: string }>
    }) => Promise<any>>('export:charts-zip')

    await expect(exportChartsZip({ sender: {} }, {
      markdownFilePath,
      images: [{ filename: '01-mermaid.png', pngBase64: 'aGVsbG8=' }],
    })).resolves.toEqual({ canceled: true })
  })

  it('rejects oversized chart batches before opening save dialog', async () => {
    const markdownFilePath = path.join(tmpDir, 'report.md')
    await fs.writeFile(markdownFilePath, '# report')

    const exportChartsZip = handler<(event: any, payload: {
      markdownFilePath: string
      images: Array<{ filename: string; pngBase64: string }>
    }) => Promise<any>>('export:charts-zip')

    const images = Array.from({ length: 201 }, (_, index) => ({
      filename: `${index + 1}.png`,
      pngBase64: 'aGVsbG8=',
    }))

    await expect(exportChartsZip({ sender: {} }, {
      markdownFilePath,
      images,
    })).resolves.toEqual({
      error: '单次最多打包 200 张图表，请拆分文档后重试',
    })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('adds print sizing constraints for SVG chart containers without forcing DrawIO full width', async () => {
    const outputPath = path.join(tmpDir, 'charts.pdf')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    } as any)

    const exportPdf = handler<(event: any, htmlContent: string, fileName: string) => Promise<string>>('export:pdf')

    await exportPdf({ sender: {} }, [
      '<div class="drawio-container"><svg style="width:100%" viewBox="0 0 1200 800"></svg></div>',
      '<div class="kroki-container"><svg style="width:100%" viewBox="0 0 1200 800"></svg></div>',
    ].join('\n'), 'charts.md')

    expect(loadedPdfHtml).toContain('.kroki-container')
    expect(loadedPdfHtml).toContain('page-break-inside: avoid')
    expect(loadedPdfHtml).toContain('justify-content: center !important')
    expect(loadedPdfHtml).toContain('text-align: center')
    expect(loadedPdfHtml).toContain('max-width: 150mm')
    expect(loadedPdfHtml).toContain('max-height: 180mm')
    expect(loadedPdfHtml).not.toMatch(/\.markdown-body \.drawio-container,\s*\.markdown-body \.plantuml-container/)
    expect(loadedPdfHtml).not.toContain('.markdown-body .drawio-container svg {\n      width: 100% !important;')
    expect(loadedPdfHtml).toMatch(/\.markdown-body \.graphviz-container svg,[\s\S]*?max-width: 100% !important;[\s\S]*?max-height: 180mm;/)
    expect(loadedPdfHtml).not.toMatch(/\.markdown-body \.graphviz-container svg,[\s\S]*?width: auto !important;[\s\S]*?max-height: 180mm;/)
  })

  it('keeps PDF branding compact to avoid a trailing blank page', async () => {
    const outputPath = path.join(tmpDir, 'branded.pdf')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    } as any)

    const appDataManager = await import('../appDataManager')
    vi.mocked(appDataManager.appDataManager.getSettings).mockReturnValueOnce({
      showExportBranding: true,
      docxExport: {
        remoteEnabled: false,
        localFallbackEnabled: false,
      },
    } as any)

    const exportPdf = handler<(event: any, htmlContent: string, fileName: string) => Promise<string>>('export:pdf')

    await exportPdf({ sender: {} }, '<h1>Report</h1>', 'report.md')

    expect(loadedPdfHtml).toContain('.pdf-export-branding')
    expect(loadedPdfHtml).toContain('<div class="pdf-export-branding">由 MD Viewer 生成')
    expect(loadedPdfHtml).not.toContain('padding:24px 0 12px')
    expect(loadedPdfHtml).not.toContain('margin-top:40px')
  })

  it('forces long highlighted code lines to wrap in PDF export', async () => {
    const outputPath = path.join(tmpDir, 'long-code.pdf')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    } as any)

    const exportPdf = handler<(event: any, htmlContent: string, fileName: string) => Promise<string>>('export:pdf')

    await exportPdf({ sender: {} }, [
      '<pre class="language-bash"><code class="language-bash">',
      'kubectl exec &lt;apisix-pod&gt; -n ingress-apisix -- curl -s -X PUT http://127.0.0.1:9180/apisix/admin/global_rules/1 -d "{\\"plugins\\":{\\"cors\\":{\\"allow_headers\\":\\"**\\",\\"expose_headers\\":\\"*,X-Session-Id,x-session-id,X-Api-Version,Content-Type,Content-Length\\"}}}"',
      '</code></pre>',
    ].join(''), 'long-code.md')

    expect(loadedPdfHtml).toContain('.markdown-body pre code[class*="language-"]')
    expect(loadedPdfHtml).toContain('white-space: pre-wrap !important')
    expect(loadedPdfHtml).toContain('overflow-wrap: anywhere')
    expect(loadedPdfHtml).toContain('word-break: break-word')
  })

  it('passes generated branding as body text for remote DOCX export', async () => {
    const outputPath = path.join(tmpDir, 'formal.docx')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    } as any)

    const appDataManager = await import('../appDataManager')
    vi.mocked(appDataManager.appDataManager.getSettings).mockReturnValueOnce({
      showExportBranding: true,
      docxExport: {
        remoteEnabled: true,
        serverUrl: 'http://127.0.0.1:3179',
        style: 'official',
        localFallbackEnabled: false,
      },
    } as any)
    const remote = await import('../remoteDocxExporter')
    vi.mocked(remote.resolveRemoteDocxStyle).mockResolvedValueOnce({ style: 'official', warnings: [] })
    vi.mocked(remote.exportViaRemote).mockResolvedValueOnce({
      filePath: outputPath,
      warnings: [],
      serviceVersion: 'test',
      imagesFailed: 0,
      mode: 'remote',
      style: 'official',
    } as any)

    const exportDocx = handler<(event: any, htmlContent: string, fileName: string, basePath: string, markdown?: string) => Promise<any>>('export:docx')

    await exportDocx({ sender: {} }, '<h1>Report</h1>', 'report.md', tmpDir, '# Report')

    expect(remote.exportViaRemote).toHaveBeenCalledWith(
      '# Report',
      outputPath,
      expect.objectContaining({
        style: 'official',
        footerText: '由 MD Viewer 生成 · github.com/wj2929/md-viewer',
      }),
    )
  })
})
