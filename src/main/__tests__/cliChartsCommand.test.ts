import { afterEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildChartsResult } from '../cli/chartsCommand'
import type { HeadlessMarkdownRenderer, MarkdownScreenshotCapture } from '../cli/headlessRenderer'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-charts-'))
  const filePath = path.join(tempDir, 'charts.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildChartsResult', () => {
  it('lists rendered charts with stable selectors and render summary', async () => {
    const input = await createMarkdown('# Charts\n\n```mermaid\ngraph TD\nA --> B\n```')
    let rendererInput: Parameters<HeadlessMarkdownRenderer>[0] | null = null
    const renderer: HeadlessMarkdownRenderer = async (headlessInput) => {
      rendererInput = headlessInput
      return {
        schemaVersion: '1.0',
        ok: true,
        status: 'success',
        html: '<h1>Charts</h1><div data-mdv-render-id="mdv-mermaid-0"><svg /></div>',
        images: [
          {
            id: 'mdv-mermaid-0',
            type: 'mermaid',
            selector: '[data-mdv-render-id="mdv-mermaid-0"]',
            widthPx: 640,
            heightPx: 360,
            widthCm: 14,
            durationMs: 18,
            sourceIndex: 0,
            blockId: 'mdv-mermaid-0',
          },
        ],
        stats: {
          totalBlocks: 1,
          renderedBlocks: 1,
          failedBlocks: 0,
          durationMs: 22,
        },
        warnings: [],
      }
    }

    const result = await buildChartsResult(['list', input], { json: true }, { renderer })

    expect(rendererInput).toMatchObject({
      markdownFilePath: expect.stringContaining('charts.md'),
      networkPolicy: 'blocked',
    })
    expect(result).toMatchObject({
      ok: true,
      command: 'charts',
      summary: {
        action: 'list',
        totalCharts: 1,
        renderedCharts: 1,
        failedCharts: 0,
        renderDurationMs: 22,
      },
      results: {
        charts: [
          {
            index: 1,
            id: 'mdv-mermaid-0',
            type: 'mermaid',
            selector: '[data-mdv-render-id="mdv-mermaid-0"]',
            widthPx: 640,
            heightPx: 360,
            widthCm: 14,
            sourceIndex: 0,
            blockId: 'mdv-mermaid-0',
          },
        ],
      },
    })
  })

  it('rejects unsupported chart actions with help action', async () => {
    const input = await createMarkdown('# Charts')

    const result = await buildChartsResult(['preview', input], {})

    expect(result).toMatchObject({
      ok: false,
      command: 'charts',
      code: 'INVALID_ARGUMENT',
      actions: [
        {
          command: 'md-viewer help charts --json',
          risk: 'safe',
        },
      ],
    })
  })

  it('exports all rendered charts to an output directory', async () => {
    const input = await createMarkdown('# Charts')
    const outDir = path.join(tempDir!, 'charts')
    const renderer = createTwoChartRenderer()
    const capture: MarkdownScreenshotCapture = async (options) => {
      await writeFile(options.outputPath, Buffer.from(`png-${options.chartIndex}`))
      return {
        artifact: {
          type: 'png',
          path: options.outputPath,
          bytes: 5,
        },
        renderResult: await renderer(options.renderInput),
        target: {
          selector: `[data-mdv-render-id="chart-${options.chartIndex}"]`,
          widthPx: 640,
          heightPx: 360,
        },
      }
    }

    const result = await buildChartsResult(['export', input], { 'out-dir': outDir }, { renderer, capture })

    expect(result).toMatchObject({
      ok: true,
      command: 'charts',
      summary: {
        action: 'export',
        exportedCharts: 2,
        totalCharts: 2,
      },
      artifacts: [
        {
          type: 'png',
          path: path.join(outDir, '01-mermaid-mdv-mermaid-0.png'),
        },
        {
          type: 'png',
          path: path.join(outDir, '02-graphviz-mdv-graphviz-1.png'),
        },
      ],
    })
    expect(await readFile(path.join(outDir, '01-mermaid-mdv-mermaid-0.png'), 'utf8')).toBe('png-1')
    expect(await readFile(path.join(outDir, '02-graphviz-mdv-graphviz-1.png'), 'utf8')).toBe('png-2')
  })

  it('packages exported charts into a ZIP when --out is provided', async () => {
    const input = await createMarkdown('# Charts')
    const outputPath = path.join(tempDir!, 'charts.zip')
    const renderer = createTwoChartRenderer()
    const capture: MarkdownScreenshotCapture = async (options) => {
      await writeFile(options.outputPath, Buffer.from(`png-${options.chartIndex}`))
      return {
        artifact: {
          type: 'png',
          path: options.outputPath,
          bytes: 5,
        },
        renderResult: await renderer(options.renderInput),
        target: {
          selector: `[data-mdv-render-id="chart-${options.chartIndex}"]`,
          widthPx: 640,
          heightPx: 360,
        },
      }
    }

    const result = await buildChartsResult(['export', input], { out: outputPath }, { renderer, capture })

    expect(result).toMatchObject({
      ok: true,
      artifacts: [
        { type: 'png' },
        { type: 'png' },
        {
          type: 'zip',
          path: outputPath,
          bytes: expect.any(Number),
        },
      ],
    })
    expect(result.artifacts.at(-1)?.bytes).toBeGreaterThan(100)
    const zip = new AdmZip(outputPath)
    expect(zip.getEntries().map(entry => entry.entryName)).toEqual([
      '01-mermaid-mdv-mermaid-0.png',
      '02-graphviz-mdv-graphviz-1.png',
    ])
  })
})

function createTwoChartRenderer(): HeadlessMarkdownRenderer {
  return async () => ({
    schemaVersion: '1.0',
    ok: true,
    status: 'success',
    html: '<div data-mdv-render-id="mdv-mermaid-0"></div><div data-mdv-render-id="mdv-graphviz-1"></div>',
    images: [
      {
        id: 'mdv-mermaid-0',
        type: 'mermaid',
        selector: '[data-mdv-render-id="mdv-mermaid-0"]',
        widthPx: 640,
        heightPx: 360,
        widthCm: 14,
        durationMs: 18,
        sourceIndex: 0,
        blockId: 'mdv-mermaid-0',
      },
      {
        id: 'mdv-graphviz-1',
        type: 'graphviz',
        selector: '[data-mdv-render-id="mdv-graphviz-1"]',
        widthPx: 800,
        heightPx: 420,
        widthCm: 16,
        durationMs: 22,
        sourceIndex: 1,
        blockId: 'mdv-graphviz-1',
      },
    ],
    stats: {
      totalBlocks: 2,
      renderedBlocks: 2,
      failedBlocks: 0,
      durationMs: 44,
    },
    warnings: [],
  })
}
