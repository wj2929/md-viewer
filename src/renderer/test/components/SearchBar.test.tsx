import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '../../src/components/SearchBar'
import { FileInfo } from '../../src/components/FileTree'

// Mock window.api
const mockReadFile = vi.fn()
global.window.api = {
  readFile: mockReadFile
} as any

describe('SearchBar', () => {
  const mockOnFileSelect = vi.fn()

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
    mockReadFile.mockClear()
  })

  describe('基础渲染', () => {
    it('应该渲染搜索按钮', () => {
      render(<SearchBar files={[]} onFileSelect={mockOnFileSelect} />)

      expect(screen.getByText('搜索文件...')).toBeInTheDocument()
    })

    it('应该显示快捷键提示', () => {
      render(<SearchBar files={[]} onFileSelect={mockOnFileSelect} />)

      expect(screen.getByText('⌘K')).toBeInTheDocument()
    })

    it('点击搜索按钮应该打开搜索框', async () => {
      render(<SearchBar files={[]} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      expect(screen.getByPlaceholderText('搜索文件名...')).toBeInTheDocument()
    })
  })

  describe('文件名搜索', () => {
    const files = [
      createMockFile('readme.md', '/readme.md'),
      createMockFile('guide.md', '/docs/guide.md'),
      createMockFile('api.md', '/docs/api.md')
    ]

    it('应该模糊搜索文件名', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'gui')

      await waitFor(() => {
        expect(screen.getByText('guide.md')).toBeInTheDocument()
      })
    })

    it('应该匹配文件路径', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'docs')

      await waitFor(() => {
        expect(screen.getByText('guide.md')).toBeInTheDocument()
        expect(screen.getByText('api.md')).toBeInTheDocument()
      })
    })

    it('没有匹配结果时应该显示提示', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'xyz')

      await waitFor(() => {
        expect(screen.getByText(/没有找到匹配的文件/i)).toBeInTheDocument()
      })
    })

    it('应该限制显示前 10 个结果', async () => {
      const manyFiles = Array.from({ length: 20 }, (_, i) =>
        createMockFile(`file${i}.md`, `/file${i}.md`)
      )

      const { container } = render(<SearchBar files={manyFiles} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'file')

      await waitFor(() => {
        const resultItems = container.querySelectorAll('.search-result-item')
        expect(resultItems.length).toBeLessThanOrEqual(10)
      })
    })
  })

  describe('全文搜索', () => {
    const files = [
      createMockFile('readme.md', '/readme.md'),
      createMockFile('guide.md', '/docs/guide.md')
    ]

    beforeEach(() => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/readme.md') {
          return Promise.resolve('# 项目简介\n这是一个 Markdown 预览器')
        }
        if (path === '/docs/guide.md') {
          return Promise.resolve('# 使用指南\n如何使用这个应用')
        }
        return Promise.resolve('')
      })
    })

    it('应该显示搜索模式切换按钮', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      expect(screen.getByText('文件名')).toBeInTheDocument()
      expect(screen.getByText('全文')).toBeInTheDocument()
    })

    it('切换到全文模式应该加载文件内容', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const contentModeBtn = screen.getByText('全文')
      await userEvent.click(contentModeBtn)

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledWith('/readme.md')
        expect(mockReadFile).toHaveBeenCalledWith('/docs/guide.md')
      })
    })

    it('全文搜索应该显示匹配片段', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      // 切换到全文模式
      const contentModeBtn = screen.getByText('全文')
      await userEvent.click(contentModeBtn)

      // 等待内容加载
      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalled()
      })

      // 搜索内容
      const input = screen.getByPlaceholderText('搜索文件内容...')
      await userEvent.type(input, '预览器')

      await waitFor(() => {
        expect(screen.getByText('readme.md')).toBeInTheDocument()
      })
    })

    it('全文搜索无匹配时应该显示提示', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const contentModeBtn = screen.getByText('全文')
      await userEvent.click(contentModeBtn)

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalled()
      })

      const input = screen.getByPlaceholderText('搜索文件内容...')
      await userEvent.type(input, 'xyz')

      await waitFor(() => {
        expect(screen.getByText(/没有找到匹配的内容/i)).toBeInTheDocument()
      })
    })
  })

  describe('搜索结果操作', () => {
    const files = [createMockFile('test.md', '/test.md')]

    it('点击搜索结果应该选择文件', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      await waitFor(() => {
        expect(screen.getByText('test.md')).toBeInTheDocument()
      })

      const result = screen.getByText('test.md')
      await userEvent.click(result)

      expect(mockOnFileSelect).toHaveBeenCalledWith(files[0])
    })

    it('选择文件后应该关闭搜索框', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      await waitFor(() => {
        expect(screen.getByText('test.md')).toBeInTheDocument()
      })

      const result = screen.getByText('test.md')
      await userEvent.click(result)

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('搜索文件名...')).not.toBeInTheDocument()
      })
    })

    it('选择文件后应该清空搜索关键词', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      const result = await screen.findByText('test.md')
      await userEvent.click(result)

      // 重新打开搜索
      await userEvent.click(trigger)

      const newInput = screen.getByPlaceholderText('搜索文件名...')
      expect(newInput).toHaveValue('')
    })
  })

  describe('清空按钮', () => {
    const files = [createMockFile('test.md', '/test.md')]

    it('输入内容后应该显示清空按钮', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      const clearButton = screen.getByRole('button', { name: /清空搜索/i })
      expect(clearButton).toBeInTheDocument()
    })

    it('点击清空按钮应该清除输入', async () => {
      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      const clearButton = screen.getByRole('button', { name: /清空搜索/i })
      await userEvent.click(clearButton)

      expect(input).toHaveValue('')
    })
  })

  describe('展平文件树', () => {
    it('应该只包含文件，不包含目录', async () => {
      const files = [
        createMockDirectory('docs', '/docs', [
          createMockFile('guide.md', '/docs/guide.md')
        ]),
        createMockFile('readme.md', '/readme.md')
      ]

      render(<SearchBar files={files} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'docs')

      // 搜索 'docs' 应该不会显示目录本身，只显示目录下的文件
      await waitFor(() => {
        expect(screen.getByText('guide.md')).toBeInTheDocument()
      })
    })
  })

  describe('空文件列表', () => {
    it('空文件列表应该显示无结果', async () => {
      render(<SearchBar files={[]} onFileSelect={mockOnFileSelect} />)

      const trigger = screen.getByRole('button', { name: /搜索文件/i })
      await userEvent.click(trigger)

      const input = screen.getByPlaceholderText('搜索文件名...')
      await userEvent.type(input, 'test')

      await waitFor(() => {
        expect(screen.getByText(/没有找到匹配的文件/i)).toBeInTheDocument()
      })
    })
  })
})
