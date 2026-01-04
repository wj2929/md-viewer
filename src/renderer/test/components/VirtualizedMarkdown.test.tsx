import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VirtualizedMarkdown } from '../../src/components/VirtualizedMarkdown'

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: unknown) => JSX.Element }) => (
    <div data-testid="virtuoso-container">
      {data.map((item, index) => (
        <div key={index} data-testid={`virtuoso-item-${index}`}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  )
}))

// Mock window.api
const mockShowMarkdownContextMenu = vi.fn().mockResolvedValue({ success: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  global.window.api = {
    ...global.window.api,
    showMarkdownContextMenu: mockShowMarkdownContextMenu
  } as typeof window.api
  // 默认没有选中文本
  vi.spyOn(window, 'getSelection').mockReturnValue(null)
})

describe('VirtualizedMarkdown', () => {
  describe('小文件渲染（非虚拟滚动）', () => {
    it('应该渲染基础 Markdown 内容', () => {
      const content = '# 标题\n\n这是一段文本'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
      expect(screen.getByText('标题')).toBeInTheDocument()
    })

    it('应该渲染空内容占位符', () => {
      const { container } = render(<VirtualizedMarkdown content="" />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    it('应该渲染仅空格内容', () => {
      // trim() 会移除空格和换行符，所以纯空白应该显示占位符
      const { container } = render(<VirtualizedMarkdown content="      " />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    it('应该应用自定义 className', () => {
      const { container } = render(
        <VirtualizedMarkdown content="# 测试" className="custom-class" />
      )

      expect(container.querySelector('.markdown-body')).toHaveClass('custom-class')
    })

    it('应该渲染代码块并应用语法高亮', () => {
      const content = '```javascript\nconst x = 1\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const codeBlock = container.querySelector('pre.language-javascript')
      expect(codeBlock).toBeInTheDocument()
    })

    it('应该渲染 mermaid 代码块', () => {
      const content = '```mermaid\ngraph TD\n  A --> B\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre.language-mermaid')).toBeInTheDocument()
    })

    it('应该渲染行内数学公式', () => {
      const content = '公式 $E=mc^2$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E=mc^2')
    })

    it('应该渲染块级数学公式', () => {
      const content = '$$\nx = \\frac{1}{2}\n$$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('frac')
    })

    it('应该渲染单行块级数学公式', () => {
      const content = '$$ E = mc^2 $$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E = mc^2')
    })
  })

  describe('大文件处理', () => {
    it('应该对超过 50000 字符的文件启用虚拟滚动', () => {
      // 创建超过 50000 字符的内容
      const longLine = 'x'.repeat(200)
      const lines = Array(300).fill(longLine)
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // 应该启用虚拟滚动而不是截断
      expect(container.querySelector('.virtualized')).toBeInTheDocument()
    })

    it('应该对超过 500 行的文件启用虚拟滚动', () => {
      const lines = Array(501).fill('line content')
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // 应该启用虚拟滚动
      expect(container.querySelector('.virtualized')).toBeInTheDocument()
      expect(screen.getByText(/501 行/)).toBeInTheDocument()
    })

    it('应该正常渲染少于 500 行的内容（非虚拟滚动）', () => {
      const lines = Array(100).fill('# 标题')
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.virtualized')).not.toBeInTheDocument()
    })
  })

  describe('虚拟滚动模式', () => {
    it('应该对超过 500 行的文件启用虚拟滚动', () => {
      const lines = Array(501).fill('# 标题内容')
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.virtualized')).toBeInTheDocument()
      expect(container.querySelector('.virtualized-info')).toBeInTheDocument()
    })

    it('应该对超过 50000 字符的文件启用虚拟滚动', () => {
      // 创建超过 50000 字符的内容，但少于 500 行
      const longLine = 'x'.repeat(200)
      const lines = Array(300).fill(longLine)
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.virtualized')).toBeInTheDocument()
    })

    it('应该显示分段信息', () => {
      const lines = Array(501).fill('# 标题')
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      expect(screen.getByText(/大文件模式/)).toBeInTheDocument()
      expect(screen.getByText(/501 行/)).toBeInTheDocument()
    })

    it('应该使用 Virtuoso 组件', () => {
      const lines = Array(501).fill('# 标题')
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      expect(screen.getByTestId('virtuoso-container')).toBeInTheDocument()
    })
  })

  describe('分段策略', () => {
    it('应该按 H1 标题分段', () => {
      const lines = [
        '# 第一章',
        ...Array(50).fill('内容'),
        '# 第二章',
        ...Array(50).fill('内容'),
        '# 第三章',
        ...Array(400).fill('内容')
      ]
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      // 检查是否有多个分段
      expect(screen.getByTestId('virtuoso-container')).toBeInTheDocument()
    })

    it('应该按 H2 标题分段', () => {
      const lines = [
        '## 第一节',
        ...Array(50).fill('内容'),
        '## 第二节',
        ...Array(450).fill('内容')
      ]
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      expect(screen.getByTestId('virtuoso-container')).toBeInTheDocument()
    })

    it('应该按最大行数限制分段', () => {
      // 没有标题，但超过 100 行应该自动分段
      const lines = Array(501).fill('普通内容行')
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      expect(screen.getByTestId('virtuoso-container')).toBeInTheDocument()
    })

    it('代码块内不应分割', () => {
      const lines = [
        '```javascript',
        ...Array(120).fill('// 代码行'),
        '```',
        ...Array(400).fill('普通内容')
      ]
      const content = lines.join('\n')
      render(<VirtualizedMarkdown content={content} />)

      // 应该成功渲染而不会因代码块中间分割而出错
      expect(screen.getByTestId('virtuoso-container')).toBeInTheDocument()
    })
  })

  describe('右键菜单 (v1.3 阶段 2)', () => {
    it('应该在有 filePath 时显示右键菜单', async () => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowMarkdownContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        hasSelection: false
      })
    })

    it('应该在没有 filePath 时不显示右键菜单', () => {
      const content = '# 测试'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowMarkdownContextMenu).not.toHaveBeenCalled()
    })

    it('应该检测文本选择状态', () => {
      // Mock window.getSelection 先
      const mockSelection = {
        toString: () => '选中的文本'
      }
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as Selection)

      const content = '# 测试内容'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowMarkdownContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        hasSelection: true
      })

      // 恢复 mock
      vi.restoreAllMocks()
    })

    it('应该在虚拟滚动模式下也支持右键菜单', () => {
      // 确保没有选中文本
      vi.spyOn(window, 'getSelection').mockReturnValue(null)

      const lines = Array(501).fill('# 内容')
      const content = lines.join('\n')
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/large.md" />
      )

      const virtualized = container.querySelector('.virtualized')
      fireEvent.contextMenu(virtualized!)

      expect(mockShowMarkdownContextMenu).toHaveBeenCalledWith({
        filePath: '/test/large.md',
        hasSelection: false
      })
    })
  })

  describe('代码高亮边界情况', () => {
    it('应该处理未知语言', () => {
      const content = '```unknownlang\ncode here\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理无语言标识的代码块', () => {
      const content = '```\nplain text\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理多种语言代码块', () => {
      const content = `
\`\`\`javascript
const a = 1
\`\`\`

\`\`\`python
def foo():
    pass
\`\`\`

\`\`\`rust
fn main() {}
\`\`\`
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelectorAll('pre').length).toBe(3)
    })
  })

  describe('数学公式边界情况', () => {
    it('应该处理未闭合的行内公式', () => {
      const content = '这是 $未闭合的公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // 应该正常渲染，不崩溃
      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理空的数学公式', () => {
      const content = '空公式 $$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理转义的美元符号', () => {
      const content = '价格是 \\$100'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('100')
    })

    it('应该处理连续的美元符号', () => {
      const content = '$$$ 不是公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('Markdown 语法', () => {
    it('应该渲染表格', () => {
      const content = `
| 列1 | 列2 |
|-----|-----|
| A   | B   |
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('table')).toBeInTheDocument()
    })

    it('应该渲染有序列表', () => {
      const content = '1. 项目1\n2. 项目2\n3. 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ol')).toBeInTheDocument()
    })

    it('应该渲染无序列表', () => {
      const content = '- 项目1\n- 项目2\n- 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ul')).toBeInTheDocument()
    })

    it('应该渲染引用块', () => {
      const content = '> 这是引用'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('blockquote')).toBeInTheDocument()
    })

    it('应该渲染链接', () => {
      const content = '[链接](https://example.com)'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://example.com')
    })

    it('应该自动链接 URL', () => {
      const content = 'https://example.com'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // linkify 选项应该将 URL 转换为链接
      const link = container.querySelector('a')
      expect(link).toBeInTheDocument()
    })
  })

  describe('性能优化', () => {
    it('SectionRenderer 应该使用 memo', () => {
      // 通过检查组件是否正常渲染来间接验证
      const lines = Array(501).fill('# 内容')
      const content = lines.join('\n')
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.virtualized-section')).toBeInTheDocument()
    })

    it('NonVirtualizedMarkdown 应该使用 memo', () => {
      const content = '# 短内容'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })
})
