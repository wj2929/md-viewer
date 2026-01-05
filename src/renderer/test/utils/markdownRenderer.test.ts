import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMarkdownRenderer } from '../../src/utils/markdownRenderer'

// 创建一个真实的 markdown-it 实例进行测试
describe('markdownRenderer 工具函数测试', () => {
  let md: ReturnType<typeof createMarkdownRenderer>

  beforeEach(() => {
    md = createMarkdownRenderer()
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

    it('应该禁用 HTML 以防止 XSS', () => {
      const result = md.render('<script>alert("xss")</script>')
      expect(result).not.toContain('<script>')
      // HTML 被转义
      expect(result).toContain('&lt;script&gt;')
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
    it('应该转义 HTML 标签', () => {
      const result = md.render('<div onclick="alert(1)">test</div>')
      expect(result).not.toContain('<div onclick')
    })

    it('应该转义 script 标签', () => {
      const result = md.render('<script>alert(1)</script>')
      expect(result).toContain('&lt;script&gt;')
    })

    it('应该转义 img onerror', () => {
      const result = md.render('<img src="x" onerror="alert(1)">')
      // HTML 被转义为 &lt;img... 所以原始的 onerror 属性不会被执行
      // 但文本内容中仍包含 onerror 字符串（已被转义）
      expect(result).toContain('&lt;img')
      expect(result).not.toContain('<img ')
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
