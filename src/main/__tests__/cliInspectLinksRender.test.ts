import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildInspectResult } from '../cli/inspectCommand'
import { buildLinksResult } from '../cli/linksCommand'
import { buildRenderResult } from '../cli/renderCommand'
import type { HeadlessMarkdownRenderer } from '../cli/headlessRenderer'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-p1a-'))
  await mkdir(path.join(tempDir, 'assets'), { recursive: true })
  await writeFile(path.join(tempDir, 'assets/ok.png'), 'png', 'utf8')
  await writeFile(path.join(tempDir, 'target.md'), '# 目标\n\n## 锚点\n', 'utf8')
  const filePath = path.join(tempDir, 'doc.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('P1a CLI commands', () => {
  it('inspect returns document structure and resource summary', async () => {
    const input = await createMarkdown([
      '# 文档标题',
      '',
      '[目标](./target.md#锚点)',
      '[坏锚点](./target.md#不存在)',
      '![缺图](./assets/missing.png)',
      '',
      '```graphviz',
      'digraph G { A -> B }',
      '```',
    ].join('\n'))

    const result = await buildInspectResult([input], { json: true })

    expect(result).toMatchObject({
      ok: true,
      command: 'inspect',
      summary: {
        headings: 1,
        links: 2,
        images: 1,
        chartBlocks: 1,
        missingAssets: 1,
        missingAnchors: 1,
      },
      results: {
        headings: [
          expect.objectContaining({ text: '文档标题', id: '文档标题' }),
        ],
        chartBlocks: [
          expect.objectContaining({ type: 'graphviz' }),
        ],
      },
      warnings: [
        expect.objectContaining({ code: 'LOCAL_RESOURCE_MISSING' }),
        expect.objectContaining({ code: 'ANCHOR_MISSING' }),
      ],
    })
  })

  it('links reports broken markdown links, anchors and missing image assets', async () => {
    const input = await createMarkdown([
      '# 文档标题',
      '',
      '[正常](./target.md#锚点)',
      '[缺文件](./missing.md)',
      '[缺锚点](./target.md#不存在)',
      '[外链](https://example.com)',
      '![缺图](./assets/missing.png)',
    ].join('\n'))

    const result = await buildLinksResult([input], { json: true })

    expect(result).toMatchObject({
      ok: true,
      command: 'links',
      summary: {
        status: 'issues',
        brokenLinks: 2,
        missingAssets: 1,
        externalLinks: 1,
      },
      results: {
        missingFiles: [
          expect.objectContaining({ target: './missing.md' }),
        ],
        missingAnchors: [
          expect.objectContaining({ target: './target.md#不存在' }),
        ],
        missingAssets: [
          expect.objectContaining({ target: './assets/missing.png' }),
        ],
        externalLinks: [
          expect.objectContaining({ target: 'https://example.com' }),
        ],
      },
      actions: [
        expect.objectContaining({
          command: 'md-viewer inspect',
          risk: 'safe',
        }),
      ],
    })
  })

  it('render returns diagnostic render output and optionally writes HTML', async () => {
    const input = await createMarkdown('# 图表\n\n```mermaid\ngraph TD\nA --> B\n```')
    const outputPath = path.join(tempDir!, 'render.html')
    const renderer = vi.fn<HeadlessMarkdownRenderer>(async () => ({
      schemaVersion: '1.0',
      ok: true,
      status: 'success',
      html: '<h1>图表</h1><div data-mdv-render-id="mdv-mermaid-0"><svg /></div>',
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
    }))

    const result = await buildRenderResult([input], { out: outputPath, json: true }, { renderer })

    expect(result).toMatchObject({
      ok: true,
      command: 'render',
      summary: {
        renderStatus: 'success',
        totalCharts: 1,
        renderedCharts: 1,
        failedCharts: 0,
      },
      results: {
        htmlLength: expect.any(Number),
        charts: [
          expect.objectContaining({ type: 'mermaid', id: 'mdv-mermaid-0' }),
        ],
      },
      artifacts: [
        {
          type: 'html',
          path: outputPath,
        },
      ],
    })
    expect(await readFile(outputPath, 'utf8')).toContain('data-mdv-render-id="mdv-mermaid-0"')
    expect(renderer).toHaveBeenCalledWith(expect.objectContaining({
      markdownFilePath: expect.stringContaining('doc.md'),
      networkPolicy: 'blocked',
    }))
  })
})
