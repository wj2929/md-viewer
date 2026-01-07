import { describe, it, expect } from 'vitest'
import { extractToc, extractTocFromTokens, TocItem } from '../../src/utils/tocExtractor'
import { createMarkdownRenderer } from '../../src/utils/markdownRenderer'

describe('tocExtractor 工具函数测试', () => {
  const md = createMarkdownRenderer()

  describe('extractTocFromTokens', () => {
    it('应该从 tokens 中提取标题', () => {
      const markdown = '# Title\n## Subtitle\n### Section'
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc).toHaveLength(3)
      expect(toc[0]).toMatchObject({ text: 'Title', level: 1 })
      expect(toc[1]).toMatchObject({ text: 'Subtitle', level: 2 })
      expect(toc[2]).toMatchObject({ text: 'Section', level: 3 })
    })

    it('应该生成正确的 slug', () => {
      const markdown = '# Hello World\n## 你好世界'
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc[0].id).toBe('hello-world')
      expect(toc[1].id).toBe('你好世界')
    })

    it('应该处理重复标题', () => {
      const markdown = '# Title\n## Title\n### Title'
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc[0].id).toBe('title')
      expect(toc[1].id).toBe('title-1')
      expect(toc[2].id).toBe('title-2')
    })

    it('应该忽略代码块中的标题语法', () => {
      const markdown = '# Real Title\n```\n# Not a title\n```'
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc).toHaveLength(1)
      expect(toc[0].text).toBe('Real Title')
    })

    it('应该提取包含行内代码的标题文本', () => {
      const markdown = '# The `code` Title'
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc[0].text).toBe('The code Title')
    })

    it('应该处理空文档', () => {
      const markdown = ''
      const tokens = md.parse(markdown, {})
      const toc = extractTocFromTokens(tokens)

      expect(toc).toHaveLength(0)
    })
  })

  describe('extractToc', () => {
    it('应该从 markdown 字符串提取目录', () => {
      const markdown = '# Title\n\nContent\n\n## Section 1\n\n## Section 2'
      const toc = extractToc(markdown, md)

      expect(toc).toHaveLength(3)
      expect(toc.map(t => t.text)).toEqual(['Title', 'Section 1', 'Section 2'])
    })

    it('应该处理所有级别的标题', () => {
      const markdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
      const toc = extractToc(markdown, md)

      expect(toc).toHaveLength(6)
      expect(toc.map(t => t.level)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('应该处理空字符串', () => {
      const toc = extractToc('', md)
      expect(toc).toHaveLength(0)
    })

    it('应该处理没有标题的文档', () => {
      const markdown = 'Just some text\n\nAnother paragraph'
      const toc = extractToc(markdown, md)

      expect(toc).toHaveLength(0)
    })

    it('应该与渲染结果的 ID 一致', () => {
      const markdown = '# Hello World\n## 测试标题'
      const toc = extractToc(markdown, md)
      const html = md.render(markdown)

      // 检查 HTML 中是否包含相同的 ID
      expect(html).toContain(`id="${toc[0].id}"`)
      expect(html).toContain(`id="${toc[1].id}"`)
    })
  })

  describe('边界情况', () => {
    it('应该处理特殊字符标题', () => {
      const markdown = '# Hello & World <test>'
      const toc = extractToc(markdown, md)

      expect(toc[0].text).toBe('Hello & World <test>')
    })

    it('应该处理多个空行分隔的标题', () => {
      const markdown = '# Title 1\n\n\n\n## Title 2'
      const toc = extractToc(markdown, md)

      expect(toc).toHaveLength(2)
    })

    it('应该处理标题后紧跟内容', () => {
      const markdown = '# Title\nContent right after'
      const toc = extractToc(markdown, md)

      expect(toc).toHaveLength(1)
      expect(toc[0].text).toBe('Title')
    })
  })
})
