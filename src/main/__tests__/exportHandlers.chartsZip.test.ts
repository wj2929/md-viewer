// @vitest-environment node
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { registerExportHandlers } from '../ipc/exportHandlers'
import { resetSecurity, setAllowedBasePath } from '../security'

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
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
}))

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
})
