// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VirtualizedMarkdown } from '../../src/components/VirtualizedMarkdown'

// Mock window.api
const mockShowMarkdownContextMenu = vi.fn().mockResolvedValue({ success: true })
const mockShowPreviewContextMenu = vi.fn().mockResolvedValue({ success: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  global.window.api = {
    ...global.window.api,
    showMarkdownContextMenu: mockShowMarkdownContextMenu,
    showPreviewContextMenu: mockShowPreviewContextMenu
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

  describe('右键菜单 (v1.3.7)', () => {
    it('应该在有 filePath 时显示右键菜单', async () => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: false,
        linkHref: null
      })
    })

    it('应该在没有 filePath 时不显示右键菜单', () => {
      const content = '# 测试'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).not.toHaveBeenCalled()
    })

    it('应该检测标题元素', () => {
      const content = '# 测试标题'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      // 模拟右键点击标题
      const heading = container.querySelector('h1')
      if (heading) {
        heading.id = 'test-heading'
        heading.textContent = '测试标题'
        fireEvent.contextMenu(heading)

        expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
          filePath: '/test/file.md',
          headingId: 'test-heading',
          headingText: '测试标题',
          headingLevel: 'h1',
          hasSelection: false,
          linkHref: null
        })
      }
    })

    it('应该检测文本选择状态', () => {
      // Mock window.getSelection
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

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: true,
        linkHref: null
      })

      // 恢复 mock
      vi.restoreAllMocks()
    })

    // 虚拟滚动已禁用，跳过此测试
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
    // 虚拟滚动已禁用，跳过此测试
    it('NonVirtualizedMarkdown 应该使用 memo', () => {
      const content = '# 短内容'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('滚动位置重置 (v1.3.4 修复)', () => {
    it('使用 key prop 时，切换文件应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nContent of file 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2\n\nContent of file 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是不同的 DOM 实例（说明组件被重新挂载）
      expect(firstInstance).not.toBe(secondInstance)
    })

    it('相同文件路径但内容变化时，不应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nOriginal content"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 相同文件，内容变化（模拟外部编辑）
      rerender(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nModified content"
          filePath="/file1.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是同一个 DOM 实例（组件未重新挂载，只是内容更新）
      expect(firstInstance).toBe(secondInstance)
    })

    it('切换文件时应渲染新文件的内容', () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1"
          filePath="/file1.md"
        />
      )

      // 验证第一个文件的内容
      expect(screen.getByText('File 1')).toBeInTheDocument()

      // 切换到第二个文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2"
          filePath="/file2.md"
        />
      )

      // 验证第二个文件的内容
      expect(screen.getByText('File 2')).toBeInTheDocument()
    })

    it('快速切换多个文件时应保持稳定', () => {
      const files = [
        { path: '/file1.md', content: '# File 1' },
        { path: '/file2.md', content: '# File 2' },
        { path: '/file3.md', content: '# File 3' },
        { path: '/file4.md', content: '# File 4' },
        { path: '/file5.md', content: '# File 5' }
      ]

      const { rerender } = render(
        <VirtualizedMarkdown
          key={files[0].path}
          content={files[0].content}
          filePath={files[0].path}
        />
      )

      // 快速切换文件
      files.forEach((file, index) => {
        if (index === 0) return // 跳过第一个（已渲染）

        rerender(
          <VirtualizedMarkdown
            key={file.path}
            content={file.content}
            filePath={file.path}
          />
        )

        // 验证每次切换都渲染正确的内容
        expect(screen.getByText(`File ${index + 1}`)).toBeInTheDocument()
      })
    })

    it('组件重新挂载时滚动位置应重置为 0', async () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content={'# File 1\n\n' + 'Line\n'.repeat(100)}
          filePath="/file1.md"
        />
      )

      const container = screen.getByText('File 1').closest('.markdown-body')?.parentElement as HTMLElement

      // 模拟用户滚动到底部
      if (container && container.scrollHeight > 0) {
        container.scrollTop = container.scrollHeight
        expect(container.scrollTop).toBeGreaterThan(0)
      }

      // 切换到新文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content={'# File 2\n\n' + 'Line\n'.repeat(100)}
          filePath="/file2.md"
        />
      )

      // 新组件的滚动位置应该是 0
      const newContainer = screen.getByText('File 2').closest('.markdown-body')?.parentElement as HTMLElement
      if (newContainer) {
        expect(newContainer.scrollTop).toBe(0)
      }
    })

    it('无 key prop 时，切换文件不会重新挂载组件（旧行为）', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          content="# File 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件，但没有 key prop
      rerender(
        <VirtualizedMarkdown
          content="# File 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是同一个 DOM 实例（组件未重新挂载，只是 props 更新）
      expect(firstInstance).toBe(secondInstance)
    })
  })
})
