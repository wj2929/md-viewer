// @vitest-environment node

import { readFileSync } from 'node:fs'
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
  it('includes AI file-reference instructions and the same compatibility notes as the UI', () => {
    const generated = buildChartExamples(process.cwd())
    const quickStart = String(generated.files.get('01-quick-start.md'))
    const guidance = JSON.parse(readFileSync(path.join(process.cwd(), 'src/renderer/src/components/settings/chartFormatGuidance.json'), 'utf8'))
    const templates = JSON.parse(readFileSync(path.join(process.cwd(), 'src/renderer/src/components/settings/chartStarterTemplates.json'), 'utf8'))
    expect(quickStart).toContain('无需手写复杂代码')
    expect(quickStart).toContain('复制文件路径')
    expect(quickStart).toContain('支持 @ 的工具')
    expect(generated.files.size).toBeLessThanOrEqual(120)
    expect(generated.zipBuffer.byteLength).toBeLessThanOrEqual(524288)
    for (const note of Object.values(guidance) as Array<{ syntax: string; limits: string }>) {
      expect(quickStart).toContain(note.syntax)
      expect(quickStart).toContain(note.limits)
    }
    for (const template of templates) {
      expect(quickStart).toContain(`${template.prefix}${template.body}${template.suffix}`)
      expect(quickStart).toContain(`id="format-${template.id}"`)
      expect(quickStart).toContain(`](#format-${template.id})`)
    }
  })

  it('生成可复现的分册包、真实远程 fence 和正确 KaTeX 空行', () => {
    const first = buildChartExamples(process.cwd())
    const second = buildChartExamples(process.cwd())
    const sidecar = JSON.parse(first.sidecarText)
    const quickStart = String(first.files.get('01-quick-start.md'))

    expect(first.zipBuffer.equals(second.zipBuffer)).toBe(true)
    expect(sidecar).toMatchObject({
      schemaVersion: '1.1',
      packageVersion: '2.9.0-r2',
      minAppVersion: '2.9.0',
      maxAppVersion: '2.9.0',
      rendererCount: 20,
      starterCount: 21,
      designCaseCount: 129,
      galleryCaseCount: 885,
      totalCaseCount: 1014,
      caseCount: 1014,
      assetCount: 65,
      remoteCaseCount: 112,
    })
    expect(sidecar.countsByCollection).toMatchObject({
      'design-reference': 129,
      'service-renderers': 112,
    })
    expect(sidecar.countsByRenderer).toMatchObject({ d2: 66, svg: 22, mermaid: 46 })
    expect(sidecar.sha256).toBe(sha256(first.zipBuffer))
    expect(quickStart).toContain('适合独立展示的推导和长公式。\n\n$$\n\\begin{aligned}')
    expect(quickStart).toContain('```c4plantuml\n')
    expect(quickStart).toContain('```kroki\n')
    expect(quickStart).not.toContain('````markdown\n```c4plantuml')
  })

  it('enforces the r6 fixture implementation targets below hard safety limits', () => {
    const fixture = readFileSync(path.join(process.cwd(), 'e2e/fixtures/test-diagram-design.md'), 'utf8')

    expect(fixture.length, 'implementation target: fixture characters').toBeLessThanOrEqual(1_000_000)
    expect(fixture.split(/\r?\n/).length, 'implementation target: fixture lines').toBeLessThanOrEqual(15_000)
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

    expect(rootReadme).toContain('内容版本：2.9.0-r2')
    expect(rootReadme).toContain('## 先选一条路线')
    expect(rootReadme).toContain('## 第一次成功')
    expect(rootReadme).toContain('## 离线、服务与隐私')
    expect(rootReadme).toContain('## 导出')
    expect(rootReadme).toContain('## 渲染失败时')
    expect(rootReadme).toContain('文件清单、字节数和 SHA-256 见同目录 `manifest.json`')
    expect(rootReadme).toContain('1014 = 129 个设计核心案例 + 885 个 catalog positive 专项条目')
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

  it('保留案例说明和源表，剔除 fixture 标记且不串入相邻章节', () => {
    const generated = buildChartExamples(process.cwd())
    const svg = String(generated.files.get('02-design-reference/08-svg.md'))
    const drawio = String(generated.files.get('02-design-reference/07-drawio.md'))
    const graphviz = String(generated.files.get('02-design-reference/02-graphviz.md'))
    const markmap = String(generated.files.get('02-design-reference/09-markmap.md'))
    const cost = svg.split('<a id="heading-svg-service-monthly-cost-bridge"></a>')[1].split('<a id="heading-')[0]

    expect(cost).toContain('**要回答的问题：**')
    expect(cost).toContain('**迁移提示：**')
    expect(cost).toContain('| 冷数据分层 | 增量 | -2000 | 24000 |')
    expect(cost).not.toContain('候选原因与证据状态')
    expect(svg).toContain('| 访问者 / 读取 | 分享授权仍有效且未撤销 |')
    expect(svg).toContain('| 等待 | 80 | 260 | 180 | 等待 |')
    expect(drawio).toContain('| date | — | 未提供 | 未知 / 待确认 |')
    expect(graphviz).toContain('r7 候选不得发布')
    expect(markmap).toContain('# ADR 选项与证据')
    for (const markdown of [svg, drawio, graphviz, markmap]) {
      expect(markdown).not.toContain('<div id="md-case-')
      expect(markdown).not.toContain('Fixture 维护约束')
      expect(markdown).not.toMatch(/^## \d+\. (?:SVG|DrawIO|Markmap)：/m)
    }
    expect(String(generated.files.get('02-design-reference/README.md'))).toContain('先选问题，再选表达方式')
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
