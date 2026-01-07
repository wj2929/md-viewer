import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isMermaidCode, renderMermaidToSvg, processMermaidInHtml } from '../../src/utils/mermaidRenderer'

// Mock mermaid
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg><text>Mermaid Chart</text></svg>'
    })
  }
}))

// Mock DOMPurify
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((svg: string) => svg)
  }
}))

describe('mermaidRenderer 工具函数测试', () => {
  describe('isMermaidCode', () => {
    it('应该识别 graph 图表', () => {
      expect(isMermaidCode('graph TD\n  A --> B')).toBe(true)
      expect(isMermaidCode('graph LR\n  A --> B')).toBe(true)
    })

    it('应该识别 flowchart 图表', () => {
      expect(isMermaidCode('flowchart TD\n  A --> B')).toBe(true)
      expect(isMermaidCode('flowchart LR\n  A --> B')).toBe(true)
    })

    it('应该识别 sequenceDiagram', () => {
      expect(isMermaidCode('sequenceDiagram\n  A->>B: Hello')).toBe(true)
    })

    it('应该识别 classDiagram', () => {
      expect(isMermaidCode('classDiagram\n  Class01 <|-- Class02')).toBe(true)
    })

    it('应该识别 stateDiagram', () => {
      expect(isMermaidCode('stateDiagram\n  [*] --> Still')).toBe(true)
      expect(isMermaidCode('stateDiagram-v2\n  [*] --> Still')).toBe(true)
    })

    it('应该识别 erDiagram', () => {
      expect(isMermaidCode('erDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe(true)
    })

    it('应该识别 gantt', () => {
      expect(isMermaidCode('gantt\n  title A Gantt Diagram')).toBe(true)
    })

    it('应该识别 pie', () => {
      expect(isMermaidCode('pie\n  title Pets')).toBe(true)
    })

    it('应该识别 journey', () => {
      expect(isMermaidCode('journey\n  title My Day')).toBe(true)
    })

    it('应该识别 gitgraph', () => {
      expect(isMermaidCode('gitgraph\n  commit')).toBe(true)
    })

    it('应该识别 mindmap', () => {
      expect(isMermaidCode('mindmap\n  root')).toBe(true)
    })

    it('应该识别 timeline', () => {
      expect(isMermaidCode('timeline\n  title History')).toBe(true)
    })

    it('应该忽略注释行', () => {
      expect(isMermaidCode('%% comment\ngraph TD\n  A --> B')).toBe(true)
    })

    it('应该拒绝非 Mermaid 代码', () => {
      expect(isMermaidCode('const x = 1;')).toBe(false)
      expect(isMermaidCode('function foo() {}')).toBe(false)
      expect(isMermaidCode('')).toBe(false)
    })

    it('应该处理空输入', () => {
      expect(isMermaidCode('')).toBe(false)
      expect(isMermaidCode(null as unknown as string)).toBe(false)
      expect(isMermaidCode(undefined as unknown as string)).toBe(false)
    })

    it('应该处理只有注释的代码', () => {
      expect(isMermaidCode('%% just a comment')).toBe(false)
      expect(isMermaidCode('%% comment 1\n%% comment 2')).toBe(false)
    })
  })

  describe('renderMermaidToSvg', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('应该渲染有效的 Mermaid 代码', async () => {
      const result = await renderMermaidToSvg('graph TD\n  A --> B', 'test-1')
      expect(result).toContain('<svg>')
    })

    it('应该拒绝过长的代码', async () => {
      const longCode = 'a'.repeat(60000)
      const result = await renderMermaidToSvg(longCode, 'test-2')
      expect(result).toContain('mermaid-error')
      expect(result).toContain('代码长度超出限制')
    })

    it('应该检测 javascript: URL', async () => {
      const maliciousCode = 'graph TD\n  click A "javascript:alert(1)"'
      const result = await renderMermaidToSvg(maliciousCode, 'test-3')
      expect(result).toContain('mermaid-error')
      expect(result).toContain('不安全')
    })

    it('应该检测 script 标签', async () => {
      const maliciousCode = 'graph TD\n  A[<script>alert(1)</script>]'
      const result = await renderMermaidToSvg(maliciousCode, 'test-4')
      expect(result).toContain('mermaid-error')
    })

    it('应该检测 onclick 事件', async () => {
      const maliciousCode = 'graph TD\n  A[onclick=alert(1)]'
      const result = await renderMermaidToSvg(maliciousCode, 'test-5')
      expect(result).toContain('mermaid-error')
    })
  })

  describe('processMermaidInHtml', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('应该处理包含 Mermaid 代码块的 HTML', async () => {
      const html = `
        <p>Some text</p>
        <pre class="language-mermaid"><code class="language-mermaid">graph TD
  A --> B</code></pre>
        <p>More text</p>
      `
      const result = await processMermaidInHtml(html)
      expect(result).toContain('mermaid-container')
      expect(result).toContain('<svg>')
    })

    it('应该保留非 Mermaid 内容', async () => {
      const html = `
        <p>Text before</p>
        <pre class="language-mermaid"><code class="language-mermaid">graph TD
  A --> B</code></pre>
        <p>Text after</p>
      `
      const result = await processMermaidInHtml(html)
      expect(result).toContain('Text before')
      expect(result).toContain('Text after')
    })

    it('应该处理没有 Mermaid 的 HTML', async () => {
      const html = '<p>No mermaid here</p>'
      const result = await processMermaidInHtml(html)
      expect(result).toBe(html)
    })

    it('应该处理多个 Mermaid 代码块', async () => {
      const html = `
        <pre class="language-mermaid"><code class="language-mermaid">graph TD
  A --> B</code></pre>
        <pre class="language-mermaid"><code class="language-mermaid">pie
  "A": 50
  "B": 50</code></pre>
      `
      const result = await processMermaidInHtml(html)
      const matches = result.match(/mermaid-container/g)
      expect(matches?.length).toBe(2)
    })

    it('应该解码 HTML 实体', async () => {
      const html = `<pre class="language-mermaid"><code class="language-mermaid">graph TD
  A --&gt; B</code></pre>`
      const result = await processMermaidInHtml(html)
      expect(result).toContain('<svg>')
    })
  })
})
