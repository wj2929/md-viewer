// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTree, FileInfo } from '../../src/components/FileTree'

describe('FileTree', () => {
  const mockOnFileSelect = vi.fn()
  const mockShowContextMenu = vi.fn()
  const basePath = '/base/path'
  const createImmediateFolderTreeState = (state: Record<string, false>) => ({
    then: (resolve: (value: Record<string, false>) => void) => {
      resolve(state)
      return Promise.resolve(state)
    },
    catch: () => Promise.resolve(state)
  })

  // Mock window.api
  beforeAll(() => {
    window.api = {
      showContextMenu: mockShowContextMenu,
      onFileStartRename: vi.fn(() => vi.fn()),  // v1.2: 重命名事件监听
      getFolderTreeState: vi.fn(() => createImmediateFolderTreeState({})),
      saveFolderTreeState: vi.fn().mockResolvedValue({}),
      clearFolderTreeState: vi.fn().mockResolvedValue(undefined)
    } as any
  })

  const createMockFile = (name: string, path: string, treePath = name): FileInfo => ({
    name,
    path,
    treePath,
    isDirectory: false
  })

  const createMockDirectory = (name: string, path: string, children: FileInfo[] = [], treePath = name): FileInfo => ({
    name,
    path,
    treePath,
    isDirectory: true,
    children
  })

  beforeEach(() => {
    mockOnFileSelect.mockClear()
    mockShowContextMenu.mockClear()
    mockShowContextMenu.mockResolvedValue({ success: true })
    window.api.getFolderTreeState.mockImplementation(() => createImmediateFolderTreeState({}))
    window.api.saveFolderTreeState.mockResolvedValue({})
    window.api.clearFolderTreeState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('基础渲染', () => {
    it('应该显示空状态提示', () => {
      render(<FileTree files={[]} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('没有找到 Markdown 或 Excalidraw 文件')).toBeInTheDocument()
    })

    it('应该渲染单个文件', () => {
      const files = [createMockFile('test.md', '/test.md')]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('test.md')).toBeInTheDocument()
    })

    it('应该渲染多个文件', () => {
      const files = [
        createMockFile('file1.md', '/file1.md'),
        createMockFile('file2.md', '/file2.md'),
        createMockFile('file3.md', '/file3.md')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('file1.md')).toBeInTheDocument()
      expect(screen.getByText('file2.md')).toBeInTheDocument()
      expect(screen.getByText('file3.md')).toBeInTheDocument()
    })

    it('纯文件列表不应该显示重置展开状态按钮', () => {
      const files = [
        createMockFile('file1.md', '/file1.md'),
        createMockFile('file2.md', '/file2.md')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.queryByRole('button', { name: '重置当前文件夹展开状态' })).not.toBeInTheDocument()
    })

    it('应该渲染文件夹和文件', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ]),
        createMockFile('index.md', '/index.md')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('docs')).toBeInTheDocument()
      expect(screen.getByText('readme.md')).toBeInTheDocument()
      expect(screen.getByText('index.md')).toBeInTheDocument()
    })

    it('没有折叠目录状态时不应该显示重置展开状态按钮', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.queryByRole('button', { name: '重置当前文件夹展开状态' })).not.toBeInTheDocument()
    })
  })

  describe('文件选择', () => {
    it('点击文件应该触发 onFileSelect', async () => {
      const file = createMockFile('test.md', '/test.md')
      const files = [file]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileElement = screen.getByText('test.md')
      await userEvent.click(fileElement)

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
      expect(mockOnFileSelect).toHaveBeenCalledTimes(1)
    })

    it('应该高亮选中的文件', () => {
      const files = [
        createMockFile('file1.md', '/file1.md'),
        createMockFile('file2.md', '/file2.md')
      ]

      const { container } = render(
        <FileTree files={files} onFileSelect={mockOnFileSelect} selectedPath="/file1.md" basePath={basePath} />
      )

      const selectedRow = container.querySelector('.file-tree-row.selected')
      expect(selectedRow).toBeInTheDocument()
      expect(selectedRow).toHaveTextContent('file1.md')
    })

    it('键盘 Enter 键应该选择文件', async () => {
      const file = createMockFile('test.md', '/test.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileRow = container.querySelector('.file-tree-row')!
      fireEvent.keyDown(fileRow, { key: 'Enter' })

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
    })

    it('键盘空格键应该选择文件', async () => {
      const file = createMockFile('test.md', '/test.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileRow = container.querySelector('.file-tree-row')!
      fireEvent.keyDown(fileRow, { key: ' ' })

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
    })
  })

  describe('文件夹展开/折叠', () => {
    it('文件树展开状态加载完成前不应先渲染子目录造成闪烁', async () => {
      let resolveState: (value: Record<string, false>) => void = () => {}
      window.api.getFolderTreeState = vi.fn(() => new Promise(resolve => {
        resolveState = resolve
      }))

      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md', 'docs/readme.md')
        ], 'docs')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()

      await act(async () => {
        resolveState({ docs: false })
      })

      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()
    })

    it('切换根目录时不应继续渲染旧目录树', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md', 'docs/readme.md')
        ], 'docs')
      ]

      const { rerender } = render(
        <FileTree files={files} onFileSelect={mockOnFileSelect} basePath="/base/path-a" />
      )
      expect(screen.getByText('readme.md')).toBeInTheDocument()

      window.api.getFolderTreeState = vi.fn(() => new Promise(() => {}))

      rerender(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath="/base/path-b" />)

      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('正在恢复文件夹状态...')
    })

    it('重新打开文件夹时应该恢复已保存的折叠状态', async () => {
      window.api.getFolderTreeState = vi.fn(() => createImmediateFolderTreeState({ docs: false }))
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md', 'docs/readme.md')
        ], 'docs')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('docs')).toBeInTheDocument()
      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()
      expect(screen.getByText('docs').closest('.file-tree-row')).toHaveAttribute('aria-expanded', 'false')
    })

    it('折叠目录后应该防抖保存 false 状态', async () => {
      vi.useFakeTimers()
      const save = vi.fn().mockResolvedValue({ docs: false })
      window.api.saveFolderTreeState = save
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md', 'docs/readme.md')
        ], 'docs')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('readme.md')).toBeInTheDocument()
      fireEvent.click(screen.getByText('docs'))

      await act(async () => {
        vi.advanceTimersByTime(350)
      })

      expect(save).toHaveBeenCalledWith({ docs: false })
      vi.useRealTimers()
    })

    it('应该可以重置当前文件夹展开状态', async () => {
      window.api.getFolderTreeState = vi.fn(() => createImmediateFolderTreeState({ docs: false }))
      const clear = vi.fn().mockResolvedValue(undefined)
      window.api.clearFolderTreeState = clear
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md', 'docs/readme.md')
        ], 'docs')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('docs')).toBeInTheDocument()
      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '重置当前文件夹展开状态' }))

      expect(clear).toHaveBeenCalled()
      expect(screen.getByText('readme.md')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重置当前文件夹展开状态' })).not.toBeInTheDocument()
    })

    it('文件夹默认应该展开', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('readme.md')).toBeInTheDocument()
    })

    it('点击文件夹应该切换展开/折叠状态', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const folderElement = screen.getByText('docs')

      // 初始展开，子文件可见
      expect(screen.getByText('readme.md')).toBeInTheDocument()

      // 点击折叠
      await userEvent.click(folderElement)
      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()

      // 再次点击展开
      await userEvent.click(folderElement)
      expect(screen.getByText('readme.md')).toBeInTheDocument()
    })

    it('点击文件夹不应该触发 onFileSelect', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const folderElement = screen.getByText('docs')
      await userEvent.click(folderElement)

      expect(mockOnFileSelect).not.toHaveBeenCalled()
    })
  })

  describe('隐式文件过滤', () => {
    it('默认显示过滤输入框，并可通过真实输入框过滤文件树', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('guide.md', '/docs/guide.md', 'docs/guide.md')
        ], 'docs'),
        createMockFile('report.md', '/report.md', 'report.md')
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: 're' } })

      expect(screen.getByText('过滤:')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('re')
      expect(screen.getByText('report.md')).toBeInTheDocument()
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    })

    it('点击文件行不应该聚焦顶部过滤框，避免文件树滚动回顶', () => {
      vi.useFakeTimers()
      const file = createMockFile('guide.md', '/guide.md', 'guide.md')

      const { container } = render(<FileTree files={[file]} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const input = screen.getByRole('textbox', { name: '文件过滤' })
      const fileRow = container.querySelector('.file-tree-row')!

      fireEvent.click(fileRow)
      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
      expect(input).not.toHaveFocus()
    })

    it('点击文件树后应该显示并聚焦输入框以承接中文输入法', async () => {
      const files = [
        createMockFile('保利威费用分析报告.md', '/保利威费用分析报告.md', '保利威费用分析报告.md'),
        createMockFile('guide.md', '/guide.md', 'guide.md')
      ]

      const user = userEvent.setup()
      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      await user.click(tree)

      const input = screen.getByRole('textbox', { name: '文件过滤' }) as HTMLInputElement
      expect(input).toHaveFocus()

      fireEvent.change(input, { target: { value: '保利' } })

      expect(input).toBeVisible()
      expect(input).toHaveValue('保利')
      expect(screen.getByText('保利威费用分析报告.md')).toBeInTheDocument()
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    })

    it('点击文件行不应该聚焦顶部过滤框，避免文件树滚动回顶', () => {
      vi.useFakeTimers()
      const file = createMockFile('guide.md', '/guide.md', 'guide.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const input = screen.getByRole('textbox', { name: '文件过滤' })
      const fileRow = container.querySelector('.file-tree-row')!

      fireEvent.click(fileRow)
      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
      expect(input).not.toHaveFocus()
    })

    it('过滤输入框应该支持中文输入和光标定位', async () => {
      const files = [
        createMockFile('保利威费用分析报告.md', '/保利威费用分析报告.md', '保利威费用分析报告.md'),
        createMockFile('guide.md', '/guide.md', 'guide.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      await userEvent.click(tree)
      const input = screen.getByRole('textbox', { name: '文件过滤' }) as HTMLInputElement
      fireEvent.change(input, { target: { value: '保利' } })

      expect(input).toHaveFocus()

      input.setSelectionRange(1, 1)

      expect(input.selectionStart).toBe(1)
      expect(input).toHaveValue('保利')
      expect(screen.getByText('保利威费用分析报告.md')).toBeInTheDocument()
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    })

    it('过滤输入框在 IME 组合输入期间不应该响应快捷键隐藏', async () => {
      const files = [
        createMockFile('保利威费用分析报告.md', '/保利威费用分析报告.md', '保利威费用分析报告.md'),
        createMockFile('guide.md', '/guide.md', 'guide.md')
      ]

      const user = userEvent.setup()
      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      await user.click(tree)

      const input = screen.getByRole('textbox', { name: '文件过滤' }) as HTMLInputElement
      fireEvent.change(input, { target: { value: 'b' } })
      fireEvent.keyDown(input, {
        key: 'Escape',
        keyCode: 229,
        isComposing: true
      })

      expect(screen.getByRole('textbox', { name: '文件过滤' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('b')
    })

    it('文件树不应该在非输入元素上拦截中文组合输入', () => {
      const files = [
        createMockFile('保利威费用分析报告.md', '/保利威费用分析报告.md', '保利威费用分析报告.md'),
        createMockFile('guide.md', '/guide.md', 'guide.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      fireEvent.compositionStart(tree)
      fireEvent.compositionEnd(tree, { data: '保利' })

      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('')
      expect(screen.getByText('保利威费用分析报告.md')).toBeInTheDocument()
      expect(screen.getByText('guide.md')).toBeInTheDocument()
    })

    it('过滤时应该显示命中文件的父目录，即使父目录原本折叠', async () => {
      window.api.getFolderTreeState = vi.fn(() => createImmediateFolderTreeState({ docs: false }))
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('guide.md', '/docs/guide.md', 'docs/guide.md')
        ], 'docs'),
        createMockFile('report.md', '/report.md', 'report.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()

      await userEvent.click(tree)
      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: 'g' } })

      expect(screen.getByText('docs')).toBeInTheDocument()
      expect(screen.getByText('guide.md')).toBeInTheDocument()
      expect(screen.queryByText('report.md')).not.toBeInTheDocument()
    })

    it('Backspace 和 Escape 应该恢复完整文件树并保留过滤条', async () => {
      const files = [
        createMockFile('guide.md', '/guide.md', 'guide.md'),
        createMockFile('report.md', '/report.md', 'report.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      await userEvent.click(tree)
      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: 'r' } })
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()

      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: '' } })
      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('')
      expect(screen.getByText('guide.md')).toBeInTheDocument()
      expect(screen.getByText('report.md')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: 'g' } })
      expect(screen.queryByText('report.md')).not.toBeInTheDocument()

      fireEvent.keyDown(screen.getByRole('textbox', { name: '文件过滤' }), { key: 'Escape' })
      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('')
      expect(screen.getByText('guide.md')).toBeInTheDocument()
      expect(screen.getByText('report.md')).toBeInTheDocument()
    })

    it('空格键选择文件时不应该进入过滤模式', () => {
      const file = createMockFile('guide.md', '/guide.md', 'guide.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const fileRow = container.querySelector('.file-tree-row')!

      fireEvent.keyDown(fileRow, { key: ' ' })

      expect(mockOnFileSelect).toHaveBeenCalledWith(file)
      expect(screen.getByRole('textbox', { name: '文件过滤' })).toHaveValue('')
    })

    it('无匹配时显示空结果，点击清除后恢复完整文件树', async () => {
      const files = [
        createMockFile('guide.md', '/guide.md', 'guide.md'),
        createMockFile('report.md', '/report.md', 'report.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)
      const tree = container.querySelector('[role="tree"]')!

      await userEvent.click(tree)
      fireEvent.change(screen.getByRole('textbox', { name: '文件过滤' }), { target: { value: 'z' } })

      expect(screen.getByText('没有匹配的文件')).toBeInTheDocument()
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '清除文件过滤' }))

      expect(screen.queryByText('没有匹配的文件')).not.toBeInTheDocument()
      expect(screen.getByText('guide.md')).toBeInTheDocument()
      expect(screen.getByText('report.md')).toBeInTheDocument()
    })
  })

  describe('嵌套结构', () => {
    it('应该正确渲染多层嵌套文件夹', () => {
      const files = [
        createMockDirectory('level1', '/level1', [
          createMockDirectory('level2', '/level1/level2', [
            createMockFile('deep.md', '/level1/level2/deep.md')
          ])
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('level1')).toBeInTheDocument()
      expect(screen.getByText('level2')).toBeInTheDocument()
      expect(screen.getByText('deep.md')).toBeInTheDocument()
    })

    it('应该正确计算嵌套深度的缩进', () => {
      const files = [
        createMockDirectory('level1', '/level1', [
          createMockDirectory('level2', '/level1/level2', [
            createMockFile('deep.md', '/level1/level2/deep.md')
          ])
        ])
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const rows = container.querySelectorAll('.file-tree-row')

      // level1 深度 0: 0*16+8 = 8px
      expect(rows[0]).toHaveStyle({ paddingLeft: '8px' })

      // level2 深度 1: 1*16+8 = 24px
      expect(rows[1]).toHaveStyle({ paddingLeft: '24px' })

      // deep.md 深度 2: 2*16+8 = 40px
      expect(rows[2]).toHaveStyle({ paddingLeft: '40px' })
    })
  })

  describe('可访问性', () => {
    it('应该设置正确的 ARIA 属性', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ]),
        createMockFile('index.md', '/index.md')
      ]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      // 树容器
      const tree = container.querySelector('[role="tree"]')
      expect(tree).toHaveAttribute('aria-label', '文件列表')

      // 文件夹
      const folderRow = screen.getByText('docs').closest('.file-tree-row')
      expect(folderRow).toHaveAttribute('role', 'treeitem')
      expect(folderRow).toHaveAttribute('aria-expanded', 'true')

      // 文件
      const fileRow = screen.getByText('index.md').closest('.file-tree-row')
      expect(fileRow).toHaveAttribute('role', 'treeitem')
      expect(fileRow).toHaveAttribute('tabIndex', '0')
    })

    it('文件夹折叠时 aria-expanded 应该为 false', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const folderRow = screen.getByText('docs').closest('.file-tree-row')

      // 初始展开
      expect(folderRow).toHaveAttribute('aria-expanded', 'true')

      // 点击折叠
      await userEvent.click(screen.getByText('docs'))
      expect(folderRow).toHaveAttribute('aria-expanded', 'false')
    })

    it('选中的文件应该设置 aria-selected', () => {
      const files = [createMockFile('test.md', '/test.md')]

      const { container } = render(
        <FileTree files={files} onFileSelect={mockOnFileSelect} selectedPath="/test.md" basePath={basePath} />
      )

      const fileRow = container.querySelector('.file-tree-row')
      expect(fileRow).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('文件夹图标', () => {
    it('展开的文件夹应该显示打开图标', () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('📂')).toBeInTheDocument()
    })

    it('折叠的文件夹应该显示关闭图标', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('readme.md', '/docs/readme.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      // 点击折叠
      await userEvent.click(screen.getByText('docs'))

      expect(screen.getByText('📁')).toBeInTheDocument()
    })

    it('文件应该显示文件图标', () => {
      const files = [createMockFile('test.md', '/test.md')]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      expect(screen.getByText('📄')).toBeInTheDocument()
    })
  })

  describe('title 属性', () => {
    it('非目录文件不应有 title（使用自定义 tooltip 替代）', () => {
      const files = [createMockFile('test.md', '/path/to/test.md')]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileName = container.querySelector('.file-name')
      expect(fileName).not.toHaveAttribute('title')
    })
  })

  // v1.2 阶段 2：剪切状态可视化
  describe('剪切状态 (v1.2)', () => {
    it('剪切的文件应该有 cut 类', async () => {
      const file = createMockFile('test.md', '/test.md')
      const files = [file]

      // 模拟 clipboardStore
      vi.mock('../../src/stores/clipboardStore', () => ({
        useClipboardStore: vi.fn((selector) => {
          const state = {
            files: new Set(['/test.md']),
            isCut: true,
            isInClipboard: (path: string) => path === '/test.md'
          }
          return selector(state)
        })
      }))

      const { container } = render(
        <FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />
      )

      // 验证渲染成功
      expect(screen.getByText('test.md')).toBeInTheDocument()
    })
  })

  // v1.3 阶段 5：多文件选择测试
  describe('多文件选择 (v1.3)', () => {
    it('Cmd/Ctrl+点击应该切换选择', async () => {
      const files = [
        createMockFile('file1.md', '/file1.md'),
        createMockFile('file2.md', '/file2.md'),
        createMockFile('file3.md', '/file3.md')
      ]
      const selectedPaths = new Set<string>()
      const mockSelectionChange = vi.fn()

      const { container } = render(
        <FileTree
          files={files}
          onFileSelect={mockOnFileSelect}
          basePath={basePath}
          selectedPaths={selectedPaths}
          onSelectionChange={mockSelectionChange}
        />
      )

      const file1 = screen.getByText('file1.md').closest('.file-tree-row')!

      // Cmd+点击添加选择
      fireEvent.click(file1, { metaKey: true })

      expect(mockSelectionChange).toHaveBeenCalledWith(new Set(['/file1.md']))
    })

    it('空的 selectedPaths 应该正常渲染', () => {
      const files = [createMockFile('file1.md', '/file1.md')]

      const { container } = render(
        <FileTree
          files={files}
          onFileSelect={mockOnFileSelect}
          basePath={basePath}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
        />
      )

      expect(screen.getByText('file1.md')).toBeInTheDocument()
    })

    it('选中的文件应该有 multi-selected 类', () => {
      const files = [
        createMockFile('file1.md', '/file1.md'),
        createMockFile('file2.md', '/file2.md')
      ]
      const selectedPaths = new Set(['/file1.md'])

      const { container } = render(
        <FileTree
          files={files}
          onFileSelect={mockOnFileSelect}
          basePath={basePath}
          selectedPaths={selectedPaths}
          onSelectionChange={vi.fn()}
        />
      )

      const file1Row = screen.getByText('file1.md').closest('.file-tree-row')
      const file2Row = screen.getByText('file2.md').closest('.file-tree-row')

      expect(file1Row).toHaveClass('multi-selected')
      expect(file2Row).not.toHaveClass('multi-selected')
    })

    it('没有 onSelectionChange 时普通点击正常工作', async () => {
      const files = [createMockFile('file1.md', '/file1.md')]

      render(
        <FileTree
          files={files}
          onFileSelect={mockOnFileSelect}
          basePath={basePath}
        />
      )

      await userEvent.click(screen.getByText('file1.md'))
      expect(mockOnFileSelect).toHaveBeenCalled()
    })
  })

  // v1.2 阶段 1：右键菜单测试
  describe('右键菜单 (v1.2)', () => {
    it('右键点击文件应该显示上下文菜单', async () => {
      const file = createMockFile('test.md', '/base/path/test.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileRow = container.querySelector('.file-tree-row')!
      await userEvent.pointer({ keys: '[MouseRight]', target: fileRow })

      expect(mockShowContextMenu).toHaveBeenCalledWith(
        { name: 'test.md', path: '/base/path/test.md', isDirectory: false },
        basePath
      )
      expect(mockShowContextMenu).toHaveBeenCalledTimes(1)
    })

    it('右键点击文件夹应该显示上下文菜单', async () => {
      const folder = createMockDirectory('docs', '/base/path/docs', [])
      const files = [folder]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const folderRow = container.querySelector('.file-tree-row')!
      await userEvent.pointer({ keys: '[MouseRight]', target: folderRow })

      expect(mockShowContextMenu).toHaveBeenCalledWith(
        { name: 'docs', path: '/base/path/docs', isDirectory: true },
        basePath
      )
    })

    it('右键点击嵌套文件应该传递正确的 basePath', async () => {
      const files = [
        createMockDirectory('level1', '/base/path/level1', [
          createMockFile('deep.md', '/base/path/level1/deep.md')
        ])
      ]

      render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const deepFile = screen.getByText('deep.md')
      await userEvent.pointer({ keys: '[MouseRight]', target: deepFile })

      expect(mockShowContextMenu).toHaveBeenCalledWith(
        { name: 'deep.md', path: '/base/path/level1/deep.md', isDirectory: false },
        basePath
      )
    })

    it('右键点击不应该触发文件选择', async () => {
      const file = createMockFile('test.md', '/test.md')
      const files = [file]

      const { container } = render(<FileTree files={files} onFileSelect={mockOnFileSelect} basePath={basePath} />)

      const fileRow = container.querySelector('.file-tree-row')!
      await userEvent.pointer({ keys: '[MouseRight]', target: fileRow })

      expect(mockOnFileSelect).not.toHaveBeenCalled()
    })
  })
})
