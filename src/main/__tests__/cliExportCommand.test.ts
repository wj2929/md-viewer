import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildExportResult } from '../cli/exportCommand'
import type { HeadlessMarkdownRenderer } from '../cli/headlessRenderer'
import { DEFAULT_HEADLESS_RENDER_TIMEOUT_MS } from '../cli/renderTimeout'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-export-'))
  const filePath = path.join(tempDir, 'report.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildExportResult', () => {
  it('exports markdown to an HTML artifact', async () => {
    const input = await createMarkdown('# Report\n\nHello')
    const outputPath = path.join(tempDir!, 'report.html')

    const result = await buildExportResult([input], { format: 'html', out: outputPath })

    expect(result).toMatchObject({
      ok: true,
      command: 'export',
      summary: {
        format: 'html',
      },
      artifacts: [
        {
          type: 'html',
          path: outputPath,
        },
      ],
    })
    const exported = await readFile(outputPath, 'utf8')
    expect(exported).toContain('<h1>Report</h1>')
    expect(exported).toContain('<p>Hello</p>')
  })

  it('rejects unsupported export formats with a structured action', async () => {
    const input = await createMarkdown('# Report')

    const result = await buildExportResult([input], { format: 'pptx', out: 'report.pptx' })

    expect(result).toMatchObject({
      ok: false,
      command: 'export',
      code: 'INVALID_ARGUMENT',
      actions: [
        {
          command: 'md-viewer help export --json',
          risk: 'safe',
        },
      ],
    })
  })

  it('uses headless rendered HTML and reports chart statistics', async () => {
    const input = await createMarkdown('# Report\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'report.html')
    let rendererInput: Parameters<HeadlessMarkdownRenderer>[0] | null = null
    const renderer: HeadlessMarkdownRenderer = async (headlessInput) => {
      rendererInput = headlessInput
      return {
        schemaVersion: '1.0',
        ok: true,
        status: 'success',
        html: '<h1>Report</h1><div class="mermaid-container"><svg><text>A</text></svg></div>',
        images: [
          {
            id: 'mdv-mermaid-0',
            type: 'mermaid',
            selector: '[data-mdv-render-id="mdv-mermaid-0"]',
            widthPx: 320,
            heightPx: 180,
            widthCm: 12,
            durationMs: 25,
            sourceIndex: 0,
            blockId: 'mdv-mermaid-0',
          },
        ],
        stats: {
          totalBlocks: 1,
          renderedBlocks: 1,
          failedBlocks: 0,
          durationMs: 30,
        },
        warnings: [],
      }
    }

    const result = await buildExportResult([input], { format: 'html', out: outputPath }, { renderer })

    expect(result.ok).toBe(true)
    expect(rendererInput).not.toBeNull()
    const capturedInput = rendererInput as unknown as Parameters<HeadlessMarkdownRenderer>[0]
    expect(capturedInput.enabledRenderers).toContain('mermaid')
    expect(capturedInput.enabledRenderers).toContain('echarts')
    expect(capturedInput.timeoutMs).toBe(DEFAULT_HEADLESS_RENDER_TIMEOUT_MS)
    expect(result.summary).toMatchObject({
      format: 'html',
      totalCharts: 1,
      renderedCharts: 1,
      failedCharts: 0,
    })
    const exported = await readFile(outputPath, 'utf8')
    expect(exported).toContain('class="mermaid-container"')
    expect(exported).not.toContain('```mermaid')
  })

  it('passes custom headless render timeout to export rendering', async () => {
    const input = await createMarkdown('# Report\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'report.html')
    let rendererInput: Parameters<HeadlessMarkdownRenderer>[0] | null = null
    const renderer: HeadlessMarkdownRenderer = async (headlessInput) => {
      rendererInput = headlessInput
      return {
        schemaVersion: '1.0',
        ok: true,
        status: 'success',
        html: '<h1>Report</h1>',
        images: [],
        stats: {
          totalBlocks: 0,
          renderedBlocks: 0,
          failedBlocks: 0,
          durationMs: 10,
        },
        warnings: [],
      }
    }

    const result = await buildExportResult(
      [input],
      { format: 'html', out: outputPath, 'timeout-ms': '180000' },
      { renderer },
    )

    expect(result.ok).toBe(true)
    expect(rendererInput).not.toBeNull()
    expect((rendererInput as unknown as Parameters<HeadlessMarkdownRenderer>[0]).timeoutMs).toBe(180000)
  })

  it('exports headless rendered markdown to a PDF artifact through the shared writer', async () => {
    const input = await createMarkdown('# Report\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'report.pdf')
    const renderer: HeadlessMarkdownRenderer = async () => ({
      schemaVersion: '1.0',
      ok: true,
      status: 'success',
      html: '<h1>Report</h1><div class="mermaid-container"><svg><text>A</text></svg></div>',
      images: [
        {
          id: 'mdv-mermaid-0',
          type: 'mermaid',
          selector: '[data-mdv-render-id="mdv-mermaid-0"]',
          widthPx: 320,
          heightPx: 180,
          widthCm: 12,
          durationMs: 25,
          sourceIndex: 0,
          blockId: 'mdv-mermaid-0',
        },
      ],
      stats: {
        totalBlocks: 1,
        renderedBlocks: 1,
        failedBlocks: 0,
        durationMs: 30,
      },
      warnings: [],
    })
    const pdfWriter = vi.fn(async () => ({
      type: 'pdf',
      path: outputPath,
      bytes: 128,
    }))

    const result = await buildExportResult(
      [input],
      { format: 'pdf', out: outputPath },
      { renderer, pdfWriter },
    )

    expect(result).toMatchObject({
      ok: true,
      command: 'export',
      summary: {
        format: 'pdf',
        totalCharts: 1,
        renderedCharts: 1,
        failedCharts: 0,
      },
      artifacts: [
        {
          type: 'pdf',
          path: outputPath,
          bytes: 128,
        },
      ],
    })
    expect(pdfWriter).toHaveBeenCalledWith(outputPath, expect.objectContaining({
      content: '<h1>Report</h1><div class="mermaid-container"><svg><text>A</text></svg></div>',
      title: 'report.md',
      showBranding: true,
    }))
  })

  it('returns a failure result when headless export rendering times out but keeps the artifact metadata', async () => {
    const input = await createMarkdown('# Report\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'report.html')
    const renderer: HeadlessMarkdownRenderer = async () => ({
      schemaVersion: '1.0',
      ok: false,
      status: 'timeout',
      html: '<h1>Report</h1><pre><code>graph TD</code></pre>',
      images: [],
      stats: {
        totalBlocks: 1,
        renderedBlocks: 0,
        failedBlocks: 1,
        durationMs: 120000,
      },
      warnings: [
        {
          code: 'RENDER_TIMEOUT',
          severity: 'error',
          title: '渲染超时',
          message: 'headless 渲染超过 120000ms 未完成',
          recoverable: true,
          fallback: 'source_code_preserved',
        },
      ],
    })

    const result = await buildExportResult(
      [input],
      { format: 'html', out: outputPath },
      { renderer },
    )

    expect(result).toMatchObject({
      ok: false,
      command: 'export',
      code: 'RENDER_TIMEOUT',
      summary: {
        format: 'html',
        totalCharts: 1,
        renderedCharts: 0,
        failedCharts: 1,
      },
      artifacts: [
        {
          type: 'html',
          path: outputPath,
        },
      ],
      actions: [
        {
          command: expect.stringContaining('--timeout-ms 180000'),
          risk: 'safe',
        },
      ],
    })
  })

  it('exports markdown to DOCX through convert-source without running local headless render', async () => {
    const input = await createMarkdown('# Report\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'report.docx')
    const renderer = vi.fn<HeadlessMarkdownRenderer>()
    const docxExporter = vi.fn(async () => ({
      artifact: {
        type: 'docx',
        path: outputPath,
        bytes: 256,
      },
      warnings: ['服务端已使用替代字体'],
      serviceVersion: '0.2.2',
      mode: 'fullFidelity',
      renderStatus: 'success',
      failedBlocks: 0,
      chartsRendered: 1,
    }))

    const result = await buildExportResult(
      [input],
      { format: 'docx', out: outputPath, 'docx-style': 'preview', 'docx-service': 'http://127.0.0.1:3179' },
      { renderer, docxExporter } as any,
    )

    expect(result).toMatchObject({
      ok: true,
      command: 'export',
      summary: {
        format: 'docx',
        serviceVersion: '0.2.2',
        mode: 'fullFidelity',
        renderStatus: 'success',
        failedCharts: 0,
        renderedCharts: 1,
      },
      artifacts: [
        {
          type: 'docx',
          path: outputPath,
          bytes: 256,
        },
      ],
      warnings: [
        {
          code: 'DOCX_SERVICE_WARNING',
          message: '服务端已使用替代字体',
          target: 'docx-service',
        },
      ],
    })
    expect(renderer).not.toHaveBeenCalled()
    expect(docxExporter).toHaveBeenCalledWith(expect.objectContaining({
      markdown: '# Report\n\n```mermaid\ngraph TD\nA --> B\n```',
      outputPath,
      serviceUrl: 'http://127.0.0.1:3179',
      style: 'preview',
    }))
  })
})
