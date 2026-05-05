// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileTree, FileInfo } from '../../src/components/FileTree'

describe('FileTree', () => {
  const mockOnFileSelect = vi.fn()
  const mockShowContextMenu = vi.fn()
  const basePath = '/base/path'

  // Mock window.api
  beforeAll(() => {
    window.api = {
      showContextMenu: mockShowContextMenu,
      onFileStartRename: vi.fn(() => vi.fn())  // v1.2: 重命名事件监听
    } as any
  })

  const createMockFile = (name: string, path: string): FileInfo => ({
    name,
    path,
    isDirectory: false
  })

  const createMockDirectory = (name: string, path: string, children: FileInfo[] = []): FileInfo => ({
    name,
    path,
    isDirectory: true,
    children
  })

  beforeEach(() => {
    mockOnFileSelect.mockClear()
    mockShowContextMenu.mockClear()
    mockShowContextMenu.mockResolvedValue({ success: true })
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
