import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from '../../src/components/MarkdownRenderer'

describe('MarkdownRenderer', () => {
  describe('基础 Markdown 渲染', () => {
    it('应该渲染标题', () => {
      const content = '# 一级标题\n## 二级标题'
      render(<MarkdownRenderer content={content} />)

      expect(screen.getByText('一级标题')).toBeInTheDocument()
      expect(screen.getByText('二级标题')).toBeInTheDocument()
    })

    it('应该渲染粗体和斜体', () => {
      const content = '**粗体文本** 和 *斜体文本*'
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.querySelector('strong')).toHaveTextContent('粗体文本')
      expect(container.querySelector('em')).toHaveTextContent('斜体文本')
    })

    it('应该渲染列表', () => {
      const content = '- 项目1\n- 项目2\n- 项目3'
      const { container } = render(<MarkdownRenderer content={content} />)

      const listItems = container.querySelectorAll('ul li')
      expect(listItems).toHaveLength(3)
      expect(listItems[0]).toHaveTextContent('项目1')
      expect(listItems[1]).toHaveTextContent('项目2')
      expect(listItems[2]).toHaveTextContent('项目3')
    })

    it('应该渲染链接', () => {
      const content = '[Google](https://google.com)'
      const { container } = render(<MarkdownRenderer content={content} />)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://google.com')
      expect(link).toHaveTextContent('Google')
    })

    it('应该渲染表格', () => {
      const content = `| 列1 | 列2 |
|-----|-----|
| A   | B   |
| C   | D   |`
      const { container } = render(<MarkdownRenderer content={content} />)

      const table = container.querySelector('table')
      expect(table).toBeInTheDocument()

      const headers = container.querySelectorAll('th')
      expect(headers).toHaveLength(2)
      expect(headers[0]).toHaveTextContent('列1')
      expect(headers[1]).toHaveTextContent('列2')
    })
  })

  describe('代码高亮', () => {
    it('应该渲染行内代码', () => {
      const content = '这是 `代码` 示例'
      const { container } = render(<MarkdownRenderer content={content} />)

      const code = container.querySelector('code')
      expect(code).toHaveTextContent('代码')
    })

    it('应该渲染代码块', () => {
      const content = '```javascript\nconst x = 1\n```'
      const { container } = render(<MarkdownRenderer content={content} />)

      const codeBlock = container.querySelector('pre code')
      expect(codeBlock).toBeInTheDocument()
      expect(codeBlock).toHaveClass('language-javascript')
    })

    it('应该支持多种语言的代码高亮', () => {
      const content = '```python\ndef hello():\n    pass\n```'
      const { container } = render(<MarkdownRenderer content={content} />)

      const codeBlock = container.querySelector('pre code')
      expect(codeBlock).toHaveClass('language-python')
    })

    it('应该处理无语言标识的代码块', () => {
      const content = '```\nplain text\n```'
      const { container } = render(<MarkdownRenderer content={content} />)

      const codeBlock = container.querySelector('pre code')
      expect(codeBlock).toBeInTheDocument()
    })
  })

  describe('数学公式', () => {
    it('应该渲染行内数学公式', () => {
      const content = '这是一个公式 $E = mc^2$ 示例'
      const { container } = render(<MarkdownRenderer content={content} />)

      // KaTeX 被 mock 了，检查是否包含公式内容
      expect(container.innerHTML).toContain('E = mc^2')
    })

    it('应该渲染块级数学公式', () => {
      const content = '$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$'
      const { container } = render(<MarkdownRenderer content={content} />)

      // 检查是否包含公式
      expect(container.innerHTML).toContain('frac')
    })

    it('应该处理单行块级公式', () => {
      const content = '$$ E = mc^2 $$'
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.innerHTML).toContain('E = mc^2')
    })
  })

  describe('大文件处理', () => {
    it('应该截断超过 10000 行的内容', () => {
      const lines = Array(10001).fill('# 标题')
      const content = lines.join('\n')
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.innerHTML).toContain('内容过长，已截断显示')
      expect(container.innerHTML).toContain('10001 行')
    })

    it('应该正常渲染少于 10000 行的内容', () => {
      const lines = Array(100).fill('# 标题')
      const content = lines.join('\n')
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.innerHTML).not.toContain('内容过长')
    })
  })

  describe('错误处理', () => {
    it('应该正常渲染空内容', () => {
      const { container } = render(<MarkdownRenderer content="" />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该应用自定义 className', () => {
      const { container } = render(<MarkdownRenderer content="# 测试" className="custom-class" />)

      const element = container.querySelector('.markdown-body')
      expect(element).toHaveClass('custom-class')
    })
  })

  describe('HTML 安全', () => {
    it('应该允许安全的 HTML 标签', () => {
      const content = '<div>安全内容</div>'
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.innerHTML).toContain('安全内容')
    })

    it('应该正确处理特殊字符', () => {
      const content = '< > & " \''
      const { container } = render(<MarkdownRenderer content={content} />)

      expect(container.textContent).toContain('<')
      expect(container.textContent).toContain('>')
    })
  })

  describe('Markdown 扩展语法', () => {
    it('应该渲染删除线', () => {
      const content = '~~删除的文本~~'
      const { container } = render(<MarkdownRenderer content={content} />)

      const del = container.querySelector('s, del')
      expect(del).toHaveTextContent('删除的文本')
    })

    it('应该渲染引用块', () => {
      const content = '> 这是引用'
      const { container } = render(<MarkdownRenderer content={content} />)

      const blockquote = container.querySelector('blockquote')
      expect(blockquote).toHaveTextContent('这是引用')
    })

    it('应该渲染水平分隔线', () => {
      const content = '---'
      const { container } = render(<MarkdownRenderer content={content} />)

      const hr = container.querySelector('hr')
      expect(hr).toBeInTheDocument()
    })

    it('应该启用 typographer', () => {
      const content = '"引号" -- 破折号'
      const { container } = render(<MarkdownRenderer content={content} />)

      // typographer 会转换引号和破折号
      expect(container.innerHTML).toContain('引号')
    })
  })
})
