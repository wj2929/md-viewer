import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../../src/utils/markdownRenderer'

// 创建一个真实的 markdown-it 实例进行测试
describe('markdownRenderer 工具函数测试', () => {
  let md: ReturnType<typeof createMarkdownRenderer>

  beforeEach(() => {
    md = createMarkdownRenderer()
    setupDOMPurifyHooks()
  })

  describe('createMarkdownRenderer', () => {
    it('应该创建 markdown-it 实例', () => {
      expect(md).toBeDefined()
      expect(typeof md.render).toBe('function')
    })

    it('应该启用 linkify', () => {
      const result = md.render('Visit https://example.com')
      expect(result).toContain('href="https://example.com"')
    })

    it('应该启用 breaks（换行转 br）', () => {
      const result = md.render('Line 1\nLine 2')
      expect(result).toContain('<br>')
    })

    it('v1.4.6: html: true + DOMPurify 防止 XSS', () => {
      // v1.4.6: 允许 HTML 但通过 DOMPurify 消毒
      const rawHtml = md.render('<script>alert("xss")</script>')
      const cleanHtml = sanitizeHtml(rawHtml)
      expect(cleanHtml).not.toContain('<script>')
      // DOMPurify 会移除 script 标签
      // 注意：不同配置下可能保留或不保留内容，这里只验证标签被移除
    })
  })

  describe('基本 Markdown 渲染', () => {
    it('应该渲染标题', () => {
      // 标题现在带有 id 属性
      expect(md.render('# H1')).toContain('<h1 id="h1">')
      expect(md.render('## H2')).toContain('<h2 id="h2">')
      expect(md.render('### H3')).toContain('<h3 id="h3">')
    })

    it('应该渲染粗体', () => {
      const result = md.render('**bold**')
      expect(result).toContain('<strong>bold</strong>')
    })

    it('应该渲染斜体', () => {
      const result = md.render('*italic*')
      expect(result).toContain('<em>italic</em>')
    })

    it('应该渲染链接', () => {
      const result = md.render('[Link](https://example.com)')
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('Link</a>')
    })

    it('应该渲染列表', () => {
      const result = md.render('- Item 1\n- Item 2')
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>')
    })

    it('应该渲染有序列表', () => {
      const result = md.render('1. First\n2. Second')
      expect(result).toContain('<ol>')
      expect(result).toContain('<li>')
    })

    it('应该渲染引用块', () => {
      const result = md.render('> Quote')
      expect(result).toContain('<blockquote>')
    })

    it('应该渲染水平线', () => {
      const result = md.render('---')
      expect(result).toContain('<hr>')
    })
  })

  describe('代码高亮', () => {
    it('应该渲染行内代码', () => {
      const result = md.render('`code`')
      expect(result).toContain('<code>')
      expect(result).toContain('code')
    })

    it('应该渲染代码块', () => {
      const result = md.render('```\ncode\n```')
      expect(result).toContain('<pre')
      expect(result).toContain('<code')
    })

    it('应该为指定语言的代码块添加语言类', () => {
      const result = md.render('```javascript\nconst x = 1;\n```')
      expect(result).toContain('language-javascript')
    })

    it('应该为未知语言使用 plaintext 类', () => {
      const result = md.render('```unknownlang\nsome code\n```')
      expect(result).toContain('language-plaintext')
    })

    it('应该转义代码块中的 HTML', () => {
      const result = md.render('```\n<div>test</div>\n```')
      expect(result).toContain('&lt;div&gt;')
    })

    it('应该将 JS 代码块中的 ECharts 配置标记为 language-echarts', () => {
      const code = '```javascript\n// ECharts\nconst option = { title: { text: "Test" }, series: [{ type: "bar" }] }\n```'
      const result = md.render(code)
      expect(result).toContain('language-echarts')
    })

    it('应该将 JSON 代码块中的 ECharts 配置标记为 language-echarts', () => {
      const code = '```json\n{\n  "title": { "text": "Test" },\n  "series": [{ "type": "bar" }],\n  "xAxis": { "type": "category" }\n}\n```'
      const result = md.render(code)
      expect(result).toContain('language-echarts')
    })

    it('应该保持普通 JSON 代码块为 language-json', () => {
      const code = '```json\n{\n  "name": "test",\n  "version": "1.0.0"\n}\n```'
      const result = md.render(code)
      expect(result).toContain('language-json')
      expect(result).not.toContain('language-echarts')
    })

    it('应该将 drawio 代码块标记为 language-drawio', () => {
      const code = '```drawio\n<mxfile><diagram><mxGraphModel></mxGraphModel></diagram></mxfile>\n```'
      const result = md.render(code)
      expect(result).toContain('language-drawio')
    })

    it('应该将 dio 代码块标记为 language-drawio', () => {
      const code = '```dio\n<mxfile></mxfile>\n```'
      const result = md.render(code)
      expect(result).toContain('language-drawio')
    })

    it('应该转义 drawio 代码块中的 HTML', () => {
      const code = '```drawio\n<mxGraphModel dx="100"><root></root></mxGraphModel>\n```'
      const result = md.render(code)
      expect(result).toContain('&lt;mxGraphModel')
      expect(result).toContain('language-drawio')
    })

    it('应该将 plantuml 代码块标记为 language-plantuml', () => {
      const code = '```plantuml\n@startuml\nA -> B: hello\n@enduml\n```'
      const result = md.render(code)
      expect(result).toContain('language-plantuml')
    })

    it('应该将 puml 代码块标记为 language-plantuml', () => {
      const code = '```puml\n@startuml\nA -> B\n@enduml\n```'
      const result = md.render(code)
      expect(result).toContain('language-plantuml')
    })

    it('应该转义 plantuml 代码块中的特殊字符', () => {
      const code = '```plantuml\n@startuml\nnote right: <b>bold</b> & "quoted"\n@enduml\n```'
      const result = md.render(code)
      expect(result).toContain('&lt;b&gt;')
      expect(result).toContain('language-plantuml')
    })
  })

  describe('行内数学公式（KaTeX）', () => {
    it('应该渲染行内公式 $...$', () => {
      const result = md.render('Equation: $E = mc^2$')
      expect(result).toContain('katex')
    })

    it('应该处理多个行内公式', () => {
      const result = md.render('$x$ and $y$')
      // 应该有两个 katex 元素
      const matches = result.match(/katex/g)
      expect(matches?.length).toBeGreaterThanOrEqual(2)
    })

    it('应该忽略转义的 $', () => {
      const result = md.render('Price is \\$100')
      // 不应该触发公式渲染
      expect(result).not.toContain('class="katex"')
    })

    it('应该处理公式渲染错误', () => {
      // KaTeX mock 会正常渲染，这里测试基本行为
      const result = md.render('$\\invalid{$')
      expect(result).toBeDefined()
    })

    it('应该正确处理单个 $ 符号', () => {
      const result = md.render('Price: $100')
      // 单个 $ 不应该触发公式
      expect(result).toContain('$100')
    })
  })

  describe('块级数学公式（KaTeX）', () => {
    it('应该渲染块级公式 $$...$$', () => {
      const result = md.render('$$\nE = mc^2\n$$')
      expect(result).toContain('katex')
    })

    it('应该渲染单行块级公式', () => {
      const result = md.render('$$E = mc^2$$')
      expect(result).toContain('katex')
    })

    it('应该渲染多行块级公式', () => {
      const result = md.render('$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$')
      expect(result).toContain('katex')
    })
  })

  describe('复杂文档渲染', () => {
    it('应该渲染包含多种元素的文档', () => {
      const content = `
# Title

This is a paragraph with **bold** and *italic*.

## Code Example

\`\`\`javascript
const x = 1;
\`\`\`

## Math

Inline: $E = mc^2$

Block:
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

## List

- Item 1
- Item 2

> Quote here
`
      const result = md.render(content)

      expect(result).toContain('<h1 id="title">')
      expect(result).toContain('<h2 id="code-example">')  // 第一个 h2 是 "Code Example"
      expect(result).toContain('<strong>bold</strong>')
      expect(result).toContain('<em>italic</em>')
      expect(result).toContain('language-javascript')
      expect(result).toContain('katex')
      expect(result).toContain('<ul>')
      expect(result).toContain('<blockquote>')
    })
  })

  describe('安全性', () => {
    it('v1.4.6: 应该通过 DOMPurify 移除危险 HTML 标签', () => {
      const rawHtml = md.render('<div onclick="alert(1)">test</div>')
      const cleanHtml = sanitizeHtml(rawHtml)
      expect(cleanHtml).not.toContain('onclick')
      // 保留内容但移除危险属性
      expect(cleanHtml).toContain('test')
    })

    it('v1.4.6: 应该通过 DOMPurify 移除 script 标签', () => {
      const rawHtml = md.render('<script>alert(1)</script>')
      const cleanHtml = sanitizeHtml(rawHtml)
      expect(cleanHtml).not.toContain('<script>')
      // DOMPurify 会移除 script 标签
      // 注意：不同配置下可能保留或不保留内容，这里只验证标签被移除
    })

    it('v1.4.6: 应该通过 DOMPurify 移除 img onerror', () => {
      const rawHtml = md.render('<img src="x" onerror="alert(1)">')
      const cleanHtml = sanitizeHtml(rawHtml)
      expect(cleanHtml).not.toContain('onerror')
      // 保留 img 标签但移除危险属性
      expect(cleanHtml).toContain('<img')
    })

    it('应该安全处理 javascript: URL', () => {
      const result = md.render('[click](javascript:alert(1))')
      // markdown-it 默认会阻止 javascript: 链接
      expect(result).not.toContain('href="javascript:')
    })
  })

  describe('边界情况', () => {
    it('应该处理空字符串', () => {
      const result = md.render('')
      expect(result).toBe('')
    })

    it('应该处理只有空白的字符串', () => {
      const result = md.render('   \n\n   ')
      expect(result.trim()).toBe('')
    })

    it('应该处理非常长的文档', () => {
      const longContent = '# Title\n\n' + 'Paragraph.\n\n'.repeat(1000)
      const result = md.render(longContent)
      expect(result).toContain('<h1 id="title">')
    })

    it('应该处理深层嵌套列表', () => {
      const nested = `
- Level 1
  - Level 2
    - Level 3
      - Level 4
`
      const result = md.render(nested)
      expect(result).toContain('<ul>')
    })

    it('应该处理包含特殊字符的内容', () => {
      const result = md.render('Special: & < > " \'')
      expect(result).toContain('&amp;')
      expect(result).toContain('&lt;')
      expect(result).toContain('&gt;')
    })
  })
})
