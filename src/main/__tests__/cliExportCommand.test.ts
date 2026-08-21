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

/** 在同一临时目录建多个 md,返回各自路径(合并导出测试用) */
async function createMarkdownFiles(contents: Record<string, string>): Promise<string[]> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-export-'))
  const paths: string[] = []
  for (const [name, content] of Object.entries(contents)) {
    const filePath = path.join(tempDir, name)
    await writeFile(filePath, content, 'utf8')
    paths.push(filePath)
  }
  return paths
}

/** 生成成功 renderResult 的极简 renderer(html 可控,便于断言片段拼接) */
function makeRenderer(htmlByCall: string[], failedBlocks = 0): HeadlessMarkdownRenderer {
  let call = 0
  return async () => {
    const html = htmlByCall[Math.min(call, htmlByCall.length - 1)]
    call += 1
    return {
      schemaVersion: '1.0',
      ok: failedBlocks === 0,
      status: failedBlocks === 0 ? 'success' : 'partial',
      html,
      images: [],
      stats: { totalBlocks: failedBlocks, renderedBlocks: 0, failedBlocks, durationMs: 10 },
      warnings: [],
    }
  }
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

// 注入 stub 绕开依赖 electron 的默认样式/图片内嵌（vitest 非 electron 环境无法 import electron）。
// styleProvider 返回空样式、imageEmbedder 为 identity，保持既有断言（尤其 PDF content 精确匹配）不变。
const stubExportDeps = {
  styleProvider: async () => ({ markdownCss: '', prismCss: '' }),
  imageEmbedder: async (html: string) => html,
}

describe('buildExportResult', () => {
  it('exports markdown to an HTML artifact', async () => {
    const input = await createMarkdown('# Report\n\nHello')
    const outputPath = path.join(tempDir!, 'report.html')

    const result = await buildExportResult([input], { format: 'html', out: outputPath }, { ...stubExportDeps })

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

    const result = await buildExportResult([input], { format: 'html', out: outputPath }, { renderer, ...stubExportDeps })

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
      { renderer, ...stubExportDeps },
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
      { renderer, pdfWriter, ...stubExportDeps },
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
      { renderer, ...stubExportDeps },
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

  describe('多文件合并导出', () => {
    it('html:多文件合并成一份,含多段 merged-doc-part,第 2 段起有分页符', async () => {
      const [a, b] = await createMarkdownFiles({ 'a.md': '# A', 'b.md': '# B' })
      const outputPath = path.join(tempDir!, 'merged.html')
      const renderer = makeRenderer(['<h1>A</h1>', '<h1>B</h1>'])

      const result = await buildExportResult(
        [a, b],
        { format: 'html', out: outputPath },
        { renderer, ...stubExportDeps },
      )

      expect(result.ok).toBe(true)
      const html = await readFile(outputPath, 'utf8')
      // 两段 merged-doc-part
      expect(html.match(/class="merged-doc-part"/g)?.length).toBe(2)
      // 第 2 段有分页符,首段没有
      expect(html).toContain('page-break-before: always;')
      expect(html).toContain('<h1>A</h1>')
      expect(html).toContain('<h1>B</h1>')
      // A 段在 B 段之前(顺序)
      expect(html.indexOf('<h1>A</h1>')).toBeLessThan(html.indexOf('<h1>B</h1>'))
      // summary 带 inputs 数组(路径经 realpath 规范化,用 basename 校验)
      const inputs = (result.summary as { inputs?: string[] }).inputs ?? []
      expect(inputs.map(p => path.basename(p))).toEqual(['a.md', 'b.md'])
    })

    it('html:各文件用自身路径分别传给 renderer 和 imageEmbedder', async () => {
      const [a, b] = await createMarkdownFiles({ 'a.md': '# A', 'b.md': '# B' })
      const outputPath = path.join(tempDir!, 'merged.html')
      const rendererPaths: string[] = []
      const renderer: HeadlessMarkdownRenderer = async (input) => {
        const mdPath = input.markdownFilePath ?? ''
        rendererPaths.push(mdPath)
        return {
          schemaVersion: '1.0', ok: true, status: 'success',
          html: `<p>${path.basename(mdPath)}</p>`,
          images: [], stats: { totalBlocks: 0, renderedBlocks: 0, failedBlocks: 0, durationMs: 5 }, warnings: [],
        }
      }
      const embedPaths: string[] = []
      const imageEmbedder = async (html: string, mdPath: string) => {
        embedPaths.push(mdPath)
        return html
      }

      await buildExportResult(
        [a, b],
        { format: 'html', out: outputPath },
        { renderer, styleProvider: stubExportDeps.styleProvider, imageEmbedder },
      )

      // validateSecurePath 会 realpath 规范化路径(macOS /var→/private/var),用 basename 比对顺序与对应关系
      expect(rendererPaths.map(p => path.basename(p))).toEqual(['a.md', 'b.md'])
      expect(embedPaths.map(p => path.basename(p))).toEqual(['a.md', 'b.md'])
      // renderer 与 embedder 收到的是同一路径(各文件自身路径作基准)
      expect(rendererPaths).toEqual(embedPaths)
    })

    it('pdf:合并 content 传给 pdfWriter', async () => {
      const [a, b] = await createMarkdownFiles({ 'a.md': '# A', 'b.md': '# B' })
      const outputPath = path.join(tempDir!, 'merged.pdf')
      const renderer = makeRenderer(['<h1>A</h1>', '<h1>B</h1>'])
      const pdfWriter = vi.fn(async () => ({ type: 'pdf', path: outputPath, bytes: 200 }))

      const result = await buildExportResult(
        [a, b],
        { format: 'pdf', out: outputPath },
        { renderer, pdfWriter, ...stubExportDeps },
      )

      expect(result.ok).toBe(true)
      expect(pdfWriter).toHaveBeenCalledWith(
        outputPath,
        expect.objectContaining({
          content: expect.stringContaining('page-break-before: always;'),
        }),
      )
      const contentArg = (pdfWriter.mock.calls[0] as unknown as [string, { content: string }])[1].content
      expect(contentArg).toContain('<h1>A</h1>')
      expect(contentArg).toContain('<h1>B</h1>')
    })

    it('docx + 多文件:任一文件不存在 → INPUT_NOT_FOUND(校验先于导出)', async () => {
      const [a] = await createMarkdownFiles({ 'a.md': '# A' })
      const missing = path.join(tempDir!, 'nope.md')
      const outputPath = path.join(tempDir!, 'merged.docx')

      const result = await buildExportResult(
        [a, missing],
        { format: 'docx', out: outputPath },
        {} as any,
      )

      expect(result).toMatchObject({ ok: false, code: 'INPUT_NOT_FOUND', target: missing })
    })

    it('任一文件不存在 → INPUT_NOT_FOUND,target 指向该文件', async () => {
      const [a] = await createMarkdownFiles({ 'a.md': '# A' })
      const missing = path.join(tempDir!, 'nope.md')
      const outputPath = path.join(tempDir!, 'merged.html')

      const result = await buildExportResult(
        [a, missing],
        { format: 'html', out: outputPath },
        { renderer: makeRenderer(['<h1>A</h1>']), ...stubExportDeps },
      )

      expect(result).toMatchObject({ ok: false, code: 'INPUT_NOT_FOUND', target: missing })
    })

    it('stats 累加:两文件各 1 图表失败 → failedCharts=2,报 RENDER_PARTIAL', async () => {
      const [a, b] = await createMarkdownFiles({ 'a.md': '# A', 'b.md': '# B' })
      const outputPath = path.join(tempDir!, 'merged.html')
      const renderer = makeRenderer(['<h1>A</h1>', '<h1>B</h1>'], 1) // 每次 failedBlocks=1

      const result = await buildExportResult(
        [a, b],
        { format: 'html', out: outputPath },
        { renderer, ...stubExportDeps },
      )

      expect(result).toMatchObject({
        ok: false,
        code: 'RENDER_PARTIAL',
        summary: { failedCharts: 2 },
      })
    })

    it('单文件:行为与改动前一致(不进合并分支,summary 无 inputs 数组)', async () => {
      const input = await createMarkdown('# Solo')
      const outputPath = path.join(tempDir!, 'solo.html')

      const result = await buildExportResult(
        [input],
        { format: 'html', out: outputPath },
        { renderer: makeRenderer(['<h1>Solo</h1>']), ...stubExportDeps },
      )

      expect(result.ok).toBe(true)
      const html = await readFile(outputPath, 'utf8')
      expect(html).not.toContain('merged-doc-part')
      expect((result.summary as { inputs?: string[] }).inputs).toBeUndefined()
    })
  })
})
