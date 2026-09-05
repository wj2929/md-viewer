import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { analyzeMarkdownFile } from '../cli/markdownAnalysis'

let tempDir: string | null = null

async function createMarkdown(content: string): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-analysis-'))
  await mkdir(path.join(tempDir, 'assets'), { recursive: true })
  await writeFile(path.join(tempDir, 'assets/existing.png'), 'png', 'utf8')
  await writeFile(path.join(tempDir, 'assets/架构 图.png'), 'png', 'utf8')
  await writeFile(path.join(tempDir, '目标 文档.md'), '# 目标标题\n\n## 子标题\n', 'utf8')
  const filePath = path.join(tempDir, 'source.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('markdownAnalysis', () => {
  it('extracts headings, charts, images and links with stable anchors', async () => {
    const input = await createMarkdown([
      '# 总览',
      '',
      '查看 [目标](./目标%20文档.md#子标题)、[缺失](./missing.md) 和 [页内](#重复标题-1)。',
      '',
      '![存在图片](./assets/existing.png)',
      '![空格图片](./assets/架构%20图.png)',
      '![缺失图片](./assets/missing.png)',
      '',
      '## 重复标题',
      '## 重复标题',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '```ts',
      'console.log("not chart")',
      '```',
    ].join('\n'))

    const analysis = await analyzeMarkdownFile(input)

    expect(analysis.summary).toMatchObject({
      headings: 3,
      images: 3,
      links: 3,
      codeBlocks: 2,
      chartBlocks: 1,
      missingAssets: 1,
      missingMarkdownLinks: 1,
      missingAnchors: 0,
    })
    expect(analysis.headings.map(heading => ({
      level: heading.level,
      text: heading.text,
      id: heading.id,
    }))).toEqual([
      { level: 1, text: '总览', id: '总览' },
      { level: 2, text: '重复标题', id: '重复标题' },
      { level: 2, text: '重复标题', id: '重复标题-1' },
    ])
    expect(analysis.chartBlocks).toEqual([
      expect.objectContaining({
        type: 'mermaid',
        language: 'mermaid',
        lineStart: 12,
      }),
    ])
    expect(analysis.images).toEqual([
      expect.objectContaining({ target: './assets/existing.png', exists: true }),
      expect.objectContaining({
        target: './assets/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png',
        exists: true,
        resolvedPath: expect.stringContaining('架构 图.png'),
      }),
      expect.objectContaining({ target: './assets/missing.png', exists: false }),
    ])
    expect(analysis.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: './目标 文档.md#子标题',
        kind: 'markdown',
        exists: true,
        anchorExists: true,
      }),
      expect.objectContaining({
        target: './missing.md',
        kind: 'markdown',
        exists: false,
      }),
      expect.objectContaining({
        target: '#重复标题-1',
        kind: 'anchor',
        anchorExists: true,
      }),
    ]))
  })

  it('识别受限 SVG 围栏为可导出图表', async () => {
    const input = await createMarkdown([
      '```svg',
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>',
      '```',
    ].join('\n'))

    const analysis = await analyzeMarkdownFile(input)

    expect(analysis.summary).toMatchObject({ codeBlocks: 1, chartBlocks: 1 })
    expect(analysis.chartBlocks).toEqual([
      expect.objectContaining({ type: 'svg', language: 'svg', lineStart: 1 }),
    ])
  })

  it('与 renderer 一致地处理碰撞、Setext 标题和 query', async () => {
    const input = await createMarkdown([
      '# Foo',
      '# Foo',
      '# Foo-1',
      '',
      'Setext title',
      '============',
      '',
      '[目标](./目标%20文档.md?view=compact#子标题)',
      '[自然后缀](#foo-1-1)',
    ].join('\n'))

    const analysis = await analyzeMarkdownFile(input)

    expect(analysis.headings.map(heading => heading.id)).toEqual([
      'foo',
      'foo-1',
      'foo-1-1',
      'setext-title',
    ])
    expect(analysis.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: './目标 文档.md?view=compact#子标题',
        kind: 'markdown',
        exists: true,
        anchorExists: true,
      }),
      expect.objectContaining({
        target: '#foo-1-1',
        kind: 'anchor',
        anchorExists: true,
      }),
    ]))
  })
})
