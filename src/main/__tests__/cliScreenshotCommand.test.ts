import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildScreenshotResult } from '../cli/screenshotCommand'
import type { MarkdownScreenshotCapture } from '../cli/headlessRenderer'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-screenshot-'))
  const filePath = path.join(tempDir, 'screen.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildScreenshotResult', () => {
  it('captures markdown body to a PNG artifact by default', async () => {
    const input = await createMarkdown('# Screen')
    const outputPath = path.join(tempDir!, 'screen.png')
    const capture = vi.fn<MarkdownScreenshotCapture>(async () => ({
      artifact: {
        type: 'png',
        path: outputPath,
        bytes: 2048,
      },
      renderResult: {
        schemaVersion: '1.0',
        ok: true,
        status: 'success',
        html: '<h1>Screen</h1>',
        images: [],
        stats: {
          totalBlocks: 0,
          renderedBlocks: 0,
          failedBlocks: 0,
          durationMs: 15,
        },
        warnings: [],
      },
      target: {
        selector: '.markdown-body',
        widthPx: 900,
        heightPx: 400,
      },
    }))

    const result = await buildScreenshotResult([input], { out: outputPath }, { capture })

    expect(result).toMatchObject({
      ok: true,
      command: 'screenshot',
      summary: {
        input: expect.stringContaining('screen.md'),
        output: outputPath,
        selector: '.markdown-body',
        bytes: 2048,
        totalCharts: 0,
      },
      artifacts: [
        {
          type: 'png',
          path: outputPath,
          bytes: 2048,
        },
      ],
    })
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      outputPath,
      selector: '.markdown-body',
      viewport: {
        width: 1280,
        height: 900,
        scaleFactor: 1,
      },
      renderInput: expect.objectContaining({
        markdown: '# Screen',
        markdownFilePath: expect.stringContaining('screen.md'),
      }),
    }))
  })

  it('uses a chart selector when --chart is provided', async () => {
    const input = await createMarkdown('# Screen\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'chart.png')
    const capture = vi.fn<MarkdownScreenshotCapture>(async () => ({
      artifact: {
        type: 'png',
        path: outputPath,
        bytes: 4096,
      },
      renderResult: {
        schemaVersion: '1.0',
        ok: true,
        status: 'success',
        html: '<div data-mdv-render-id="mdv-mermaid-0"><svg /></div>',
        images: [
          {
            id: 'mdv-mermaid-0',
            type: 'mermaid',
            selector: '[data-mdv-render-id="mdv-mermaid-0"]',
            widthPx: 640,
            heightPx: 360,
            widthCm: 14,
            durationMs: 20,
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
      },
      target: {
        selector: '[data-mdv-render-id="mdv-mermaid-0"]',
        widthPx: 640,
        heightPx: 360,
      },
    }))

    const result = await buildScreenshotResult([input], { out: outputPath, chart: '1' }, { capture })

    expect(result.summary).toMatchObject({
      selector: '[data-mdv-render-id="mdv-mermaid-0"]',
      chart: 1,
      totalCharts: 1,
      renderedCharts: 1,
    })
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      chartIndex: 1,
      selector: undefined,
    }))
  })

  it('rejects screenshots without an output path', async () => {
    const input = await createMarkdown('# Screen')

    const result = await buildScreenshotResult([input], {})

    expect(result).toMatchObject({
      ok: false,
      command: 'screenshot',
      code: 'INVALID_ARGUMENT',
      actions: [
        {
          command: 'md-viewer help screenshot --json',
          risk: 'safe',
        },
      ],
    })
  })
})
