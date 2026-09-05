// @vitest-environment node

import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 生成器是 Node.js ESM 脚本
import { buildChartExamples } from '../../../scripts/generate-chart-examples.mjs'

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function countPageCases(markdown: string): number {
  let fence: { character: string; length: number } | null = null
  let count = 0
  for (const line of markdown.split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length) fence = null
      continue
    }
    if (!fence && line.startsWith('## ')) count += 1
  }
  return count
}

describe('chart examples generator', () => {
  it('生成可复现的分册包、真实远程 fence 和正确 KaTeX 空行', () => {
    const first = buildChartExamples(process.cwd())
    const second = buildChartExamples(process.cwd())
    const sidecar = JSON.parse(first.sidecarText)
    const quickStart = String(first.files.get('01-quick-start.md'))

    expect(first.zipBuffer.equals(second.zipBuffer)).toBe(true)
    expect(sidecar).toMatchObject({
      schemaVersion: '1.1',
      packageVersion: '2.8.0-r4',
      rendererCount: 20,
      starterCount: 21,
      designCaseCount: 93,
      galleryCaseCount: 885,
      totalCaseCount: 978,
      caseCount: 978,
      assetCount: 65,
      remoteCaseCount: 112,
    })
    expect(sidecar.countsByCollection).toMatchObject({
      'design-reference': 93,
      'service-renderers': 112,
    })
    expect(sidecar.countsByRenderer).toMatchObject({ d2: 65, svg: 10, mermaid: 45 })
    expect(sidecar.sha256).toBe(sha256(first.zipBuffer))
    expect(quickStart).toContain('适合独立展示的推导和长公式。\n\n$$\n\\begin{aligned}')
    expect(quickStart).toContain('```c4plantuml\n')
    expect(quickStart).toContain('```kroki\n')
    expect(quickStart).not.toContain('````markdown\n```c4plantuml')
  })

  it('默认每个 renderer 一个文件，仅固定分页实测重型 renderer', () => {
    const generated = buildChartExamples(process.cwd())
    const singleRendererCandidates = buildChartExamples(process.cwd(), { singleRendererPages: true })
    const galleryPages = [...generated.files.entries()].filter(([name]) =>
      name.startsWith('03-renderer-gallery/') && name.endsWith('.md') && !name.endsWith('/README.md')
    )
    const candidatePages = [...singleRendererCandidates.files.keys()].filter(name =>
      name.startsWith('03-renderer-gallery/') && name.endsWith('.md') && !name.endsWith('/README.md')
    )
    const allGalleryMarkdown = galleryPages.map(([, content]) => String(content)).join('\n')

    expect(galleryPages).toHaveLength(27)
    expect(candidatePages).toHaveLength(19)
    expect(candidatePages.every(name => !/-\d{2}\.md$/.test(name))).toBe(true)
    expect([...generated.files.keys()]).toEqual(expect.arrayContaining([
      '03-renderer-gallery/architecture-modeling/d2.md',
      '03-renderer-gallery/architecture-modeling/drawio-01.md',
      '03-renderer-gallery/data-visualization/infographic-04.md',
      '03-renderer-gallery/data-visualization/vega-lite-02.md',
      '03-renderer-gallery/process-and-protocol/wavedrom-04.md',
    ]))
    expect(allGalleryMarkdown).not.toContain('错误测试：无效 XML')
    expect(allGalleryMarkdown).not.toContain('超大压力测试 (100+ nodes)')
    expect(allGalleryMarkdown).not.toContain('包含 HTML 标签的代码（XSS 测试）')
    expect(allGalleryMarkdown).not.toContain('missing.excalidraw')
    for (const [name, content] of galleryPages) {
      expect(Buffer.byteLength(String(content)), name).toBeLessThanOrEqual(750_000)
      expect(countPageCases(String(content)), name).toBeGreaterThan(0)
    }
  })

  it('生成分层使用指南、稳定案例导航和一致的联网边界', () => {
    const generated = buildChartExamples(process.cwd())
    const rootReadme = String(generated.files.get('README.md'))
    const quickStart = String(generated.files.get('01-quick-start.md'))
    const designReadme = String(generated.files.get('02-design-reference/README.md'))
    const galleryReadme = String(generated.files.get('03-renderer-gallery/README.md'))
    const categoryReadme = String(generated.files.get('03-renderer-gallery/formula-and-knowledge/README.md'))
    const katexPage = String(generated.files.get('03-renderer-gallery/formula-and-knowledge/katex.md'))
    const drawioFirst = String(generated.files.get('03-renderer-gallery/architecture-modeling/drawio-01.md'))
    const drawioSecond = String(generated.files.get('03-renderer-gallery/architecture-modeling/drawio-02.md'))

    expect(rootReadme).toContain('内容版本：2.8.0-r4')
    expect(rootReadme).toContain('## 先选一条路线')
    expect(rootReadme).toContain('## 第一次成功')
    expect(rootReadme).toContain('## 离线、服务与隐私')
    expect(rootReadme).toContain('## 导出')
    expect(rootReadme).toContain('## 渲染失败时')
    expect(rootReadme).toContain('文件清单、字节数和 SHA-256 见同目录 `manifest.json`')
    expect(rootReadme).toContain('978 = 93 个设计核心案例 + 885 个 catalog positive 专项条目')
    expect(quickStart).toContain('只会发送对应图表块的源码')
    expect(quickStart).not.toContain('打开本文档不会联网')
    expect(designReadme).toContain('[专项案例库](../03-renderer-gallery/README.md)')
    expect(galleryReadme).toContain('| [服务渲染器](./service-renderers/README.md)')
    expect(galleryReadme).toContain('negative、stress 和 infra 共 49 个条目')
    expect(categoryReadme).toContain('## 选择 renderer')
    expect(categoryReadme).toContain('KaTeX（`katex`）')
    expect(katexPage).toContain('[`katex-010` · 10. 矩阵](#heading-katex-010)')
    expect(katexPage).toContain('<a id="heading-katex-010"></a>')
    expect(drawioFirst).toContain('[下一页 →](./drawio-02.md)')
    expect(drawioSecond).toContain('[← 上一页](./drawio-01.md)')
  })

  it('所有生成的 README 和案例页导航都指向包内文件', () => {
    const generated = buildChartExamples(process.cwd())
    const navigableFiles = [...generated.files.entries()].filter(([name, content]) =>
      typeof content === 'string' && name.endsWith('.md')
    )

    for (const [name, content] of navigableFiles) {
      const links = [...String(content).matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])
      for (const href of links) {
        if (/^(?:https?:|mailto:|#)/.test(href)) continue
        const target = href.split(/[?#]/)[0]
        if (!target) continue
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target))
        expect(generated.files.has(resolved), `${name} -> ${href}`).toBe(true)
      }
    }
  })

  it('内部 manifest 覆盖每个生成文件及外部资源', () => {
    const generated = buildChartExamples(process.cwd())
    const manifest = JSON.parse(String(generated.files.get('manifest.json')))
    const declared = new Map(manifest.files.map((file: { name: string; bytes: number; sha256: string }) => [file.name, file]))

    expect(manifest.files).toHaveLength(generated.files.size - 1)
    expect([...generated.files.keys()].filter(name => name.endsWith('.bpmn'))).toHaveLength(8)
    expect([...generated.files.keys()].filter(name => name.endsWith('.excalidraw'))).toHaveLength(57)
    for (const [name, content] of generated.files) {
      if (name === 'manifest.json') continue
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
      expect(declared.get(name), name).toEqual({
        name,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      })
    }
  })
})
