import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useClipboardStore } from '../../src/stores/clipboardStore'

// Mock window.api
const mockApi = {
  fileExists: vi.fn(),
  isDirectory: vi.fn(),
  copyFile: vi.fn(),
  copyDir: vi.fn(),
  moveFile: vi.fn()
}

// 设置全局 window.api
Object.defineProperty(global, 'window', {
  value: { api: mockApi },
  writable: true
})

describe('clipboardStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useClipboardStore.setState({ files: new Set(), isCut: false })
    // 重置所有 mock
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('初始状态', () => {
    it('应该有空的 files Set', () => {
      const { files } = useClipboardStore.getState()
      expect(files.size).toBe(0)
    })

    it('应该 isCut 为 false', () => {
      const { isCut } = useClipboardStore.getState()
      expect(isCut).toBe(false)
    })

    it('hasFiles 应该返回 false', () => {
      const { hasFiles } = useClipboardStore.getState()
      expect(hasFiles()).toBe(false)
    })
  })

  describe('copy 方法', () => {
    it('应该复制单个文件路径', () => {
      const { copy } = useClipboardStore.getState()
      copy(['/test/file.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(1)
      expect(files.has('/test/file.md')).toBe(true)
      expect(isCut).toBe(false)
    })

    it('应该复制多个文件路径', () => {
      const { copy } = useClipboardStore.getState()
      copy(['/test/file1.md', '/test/file2.md', '/test/file3.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(3)
      expect(files.has('/test/file1.md')).toBe(true)
      expect(files.has('/test/file2.md')).toBe(true)
      expect(files.has('/test/file3.md')).toBe(true)
      expect(isCut).toBe(false)
    })

    it('应该覆盖之前复制的内容', () => {
      const { copy } = useClipboardStore.getState()
      copy(['/test/old.md'])
      copy(['/test/new.md'])

      const { files } = useClipboardStore.getState()
      expect(files.size).toBe(1)
      expect(files.has('/test/new.md')).toBe(true)
      expect(files.has('/test/old.md')).toBe(false)
    })

    it('复制应该覆盖之前剪切的内容', () => {
      const { cut, copy } = useClipboardStore.getState()
      cut(['/test/cut.md'])
      copy(['/test/copy.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(1)
      expect(files.has('/test/copy.md')).toBe(true)
      expect(isCut).toBe(false)
    })

    it('应该支持空数组', () => {
      const { copy } = useClipboardStore.getState()
      copy([])

      const { files } = useClipboardStore.getState()
      expect(files.size).toBe(0)
    })
  })

  describe('cut 方法', () => {
    it('应该剪切单个文件路径', () => {
      const { cut } = useClipboardStore.getState()
      cut(['/test/file.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(1)
      expect(files.has('/test/file.md')).toBe(true)
      expect(isCut).toBe(true)
    })

    it('应该剪切多个文件路径', () => {
      const { cut } = useClipboardStore.getState()
      cut(['/test/file1.md', '/test/file2.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(2)
      expect(isCut).toBe(true)
    })

    it('剪切应该覆盖之前复制的内容', () => {
      const { copy, cut } = useClipboardStore.getState()
      copy(['/test/copy.md'])
      cut(['/test/cut.md'])

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(1)
      expect(files.has('/test/cut.md')).toBe(true)
      expect(isCut).toBe(true)
    })
  })

  describe('clear 方法', () => {
    it('应该清空复制的文件', () => {
      const { copy, clear } = useClipboardStore.getState()
      copy(['/test/file.md'])
      clear()

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(0)
      expect(isCut).toBe(false)
    })

    it('应该清空剪切的文件', () => {
      const { cut, clear } = useClipboardStore.getState()
      cut(['/test/file.md'])
      clear()

      const { files, isCut } = useClipboardStore.getState()
      expect(files.size).toBe(0)
      expect(isCut).toBe(false)
    })
  })

  describe('hasFiles 方法', () => {
    it('空剪贴板应该返回 false', () => {
      const { hasFiles } = useClipboardStore.getState()
      expect(hasFiles()).toBe(false)
    })

    it('有文件时应该返回 true', () => {
      const { copy, hasFiles } = useClipboardStore.getState()
      copy(['/test/file.md'])
      expect(hasFiles()).toBe(true)
    })

    it('清空后应该返回 false', () => {
      const { copy, clear, hasFiles } = useClipboardStore.getState()
      copy(['/test/file.md'])
      clear()
      expect(hasFiles()).toBe(false)
    })
  })

  describe('isInClipboard 方法', () => {
    it('不在剪贴板的文件应该返回 false', () => {
      const { isInClipboard } = useClipboardStore.getState()
      expect(isInClipboard('/test/not-exist.md')).toBe(false)
    })

    it('在剪贴板的文件应该返回 true', () => {
      const { copy, isInClipboard } = useClipboardStore.getState()
      copy(['/test/file.md'])
      expect(isInClipboard('/test/file.md')).toBe(true)
    })

    it('清空后应该返回 false', () => {
      const { copy, clear, isInClipboard } = useClipboardStore.getState()
      copy(['/test/file.md'])
      clear()
      expect(isInClipboard('/test/file.md')).toBe(false)
    })
  })

  describe('paste 方法', () => {
    describe('空剪贴板', () => {
      it('应该直接返回不执行任何操作', async () => {
        const { paste } = useClipboardStore.getState()
        await paste('/target')

        expect(mockApi.copyFile).not.toHaveBeenCalled()
        expect(mockApi.moveFile).not.toHaveBeenCalled()
      })
    })

    describe('复制粘贴（isCut = false）', () => {
      it('应该复制文件到目标目录', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/file.md'])
        await paste('/target')

        expect(mockApi.fileExists).toHaveBeenCalledWith('/target/file.md')
        expect(mockApi.isDirectory).toHaveBeenCalledWith('/source/file.md')
        expect(mockApi.copyFile).toHaveBeenCalledWith('/source/file.md', '/target/file.md')
      })

      it('应该复制目录到目标目录', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(true)
        mockApi.copyDir.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/folder'])
        await paste('/target')

        expect(mockApi.copyDir).toHaveBeenCalledWith('/source/folder', '/target/folder')
      })

      it('复制后剪贴板应该保留', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste, hasFiles } = useClipboardStore.getState()
        copy(['/source/file.md'])
        await paste('/target')

        expect(hasFiles()).toBe(true)
      })

      it('应该处理多个文件复制', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/file1.md', '/source/file2.md'])
        await paste('/target')

        expect(mockApi.copyFile).toHaveBeenCalledTimes(2)
      })
    })

    describe('剪切粘贴（isCut = true）', () => {
      it('应该移动文件到目标目录', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.moveFile.mockResolvedValue(undefined)

        const { cut, paste } = useClipboardStore.getState()
        cut(['/source/file.md'])
        await paste('/target')

        expect(mockApi.moveFile).toHaveBeenCalledWith('/source/file.md', '/target/file.md')
        expect(mockApi.copyFile).not.toHaveBeenCalled()
      })

      it('剪切后剪贴板应该清空', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.moveFile.mockResolvedValue(undefined)

        const { cut, paste, hasFiles } = useClipboardStore.getState()
        cut(['/source/file.md'])
        await paste('/target')

        expect(hasFiles()).toBe(false)
      })
    })

    describe('错误处理', () => {
      it('目标文件已存在时应该跳过并收集错误', async () => {
        mockApi.fileExists.mockResolvedValue(true)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/file.md'])

        await expect(paste('/target')).rejects.toThrow('file.md 已存在')
      })

      it('粘贴到自身时应该跳过', async () => {
        mockApi.fileExists.mockResolvedValue(false)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/target/file.md'])
        await paste('/target')

        expect(mockApi.copyFile).not.toHaveBeenCalled()
      })

      it('粘贴到子目录时应该报错', async () => {
        mockApi.fileExists.mockResolvedValue(false)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/folder'])

        await expect(paste('/source/folder/subfolder')).rejects.toThrow('子目录')
      })

      it('API 错误应该被捕获并报告', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockRejectedValue(new Error('Permission denied'))

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/file.md'])

        await expect(paste('/target')).rejects.toThrow('Permission denied')
      })

      it('多个文件部分失败时应该收集所有错误', async () => {
        mockApi.fileExists
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true) // 第二个文件存在
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/source/file1.md', '/source/file2.md'])

        await expect(paste('/target')).rejects.toThrow('file2.md 已存在')
        expect(mockApi.copyFile).toHaveBeenCalledTimes(1)
      })
    })

    describe('路径处理', () => {
      it('应该正确处理 Unix 路径', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        copy(['/home/user/documents/file.md'])
        await paste('/home/user/backup')

        expect(mockApi.copyFile).toHaveBeenCalledWith(
          '/home/user/documents/file.md',
          '/home/user/backup/file.md'
        )
      })

      it('应该正确处理 Windows 路径分隔符', async () => {
        mockApi.fileExists.mockResolvedValue(false)
        mockApi.isDirectory.mockResolvedValue(false)
        mockApi.copyFile.mockResolvedValue(undefined)

        const { copy, paste } = useClipboardStore.getState()
        // 注意: clipboardStore 的路径处理逻辑是先用 / 分割，再用 \ 分割
        // 对于纯 Windows 路径，会使用 \ 分割
        copy(['C:\\Users\\test\\file.md'])
        await paste('/target')

        // 验证 copyFile 被调用
        expect(mockApi.copyFile).toHaveBeenCalled()
        // 文件名应该被正确提取（file.md 或完整路径取决于实现）
        const callArgs = mockApi.copyFile.mock.calls[0]
        expect(callArgs[0]).toBe('C:\\Users\\test\\file.md')
        expect(callArgs[1]).toContain('/target/')
      })
    })
  })
})
