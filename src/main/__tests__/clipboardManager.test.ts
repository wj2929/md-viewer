import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as os from 'os'
import * as fs from 'fs'
import { clipboard } from 'electron'

// Mock 模块
vi.mock('electron', () => ({
  clipboard: {
    readBuffer: vi.fn(),
    readText: vi.fn(),
    writeBuffer: vi.fn(),
    writeText: vi.fn(),
    clear: vi.fn()
  }
}))

vi.mock('os', () => ({
  platform: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('../security', () => ({
  isProtectedPath: vi.fn((path: string) => {
    // 模拟受保护路径
    return path.startsWith('/System') || path.startsWith('/usr')
  })
}))

// 动态导入被测模块
let clipboardManager: typeof import('../clipboardManager')

describe('clipboardManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 每次测试前重新导入模块
    clipboardManager = await import('../clipboardManager')
  })

  describe('readFilesFromSystemClipboard', () => {
    describe('macOS', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('darwin')
      })

      it('应该从 NSFilenamesPboardType 读取文件路径', () => {
        const plistContent = `<?xml version="1.0"?>
<plist>
<array>
  <string>/Users/test/file1.txt</string>
  <string>/Users/test/file2.md</string>
</array>
</plist>`
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(plistContent))
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toHaveLength(2)
        expect(result[0]).toEqual({
          path: '/Users/test/file1.txt',
          exists: true,
          isAllowed: true,
          reason: undefined
        })
        expect(result[1]).toEqual({
          path: '/Users/test/file2.md',
          exists: true,
          isAllowed: true,
          reason: undefined
        })
      })

      it('应该从 file:// URL 格式读取', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))
        vi.mocked(clipboard.readText).mockReturnValue('file:///Users/test/file.md')
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toHaveLength(1)
        expect(result[0].path).toBe('/Users/test/file.md')
      })

      it('应该过滤受保护路径', () => {
        const plistContent = `<plist><array><string>/System/Library/file.txt</string></array></plist>`
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(plistContent))
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result[0].isAllowed).toBe(false)
        expect(result[0].reason).toBe('受保护的系统路径')
      })

      it('应该标记不存在的文件', () => {
        const plistContent = `<plist><array><string>/Users/test/nonexistent.txt</string></array></plist>`
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(plistContent))
        vi.mocked(fs.existsSync).mockReturnValue(false)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result[0].exists).toBe(false)
        expect(result[0].isAllowed).toBe(false)
        expect(result[0].reason).toBe('文件不存在')
      })

      it('应该处理空剪贴板', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))
        vi.mocked(clipboard.readText).mockReturnValue('')

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toEqual([])
      })
    })

    describe('Windows', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('win32')
      })

      it('应该从 FileNameW 读取文件路径', () => {
        // UTF-16LE 编码的路径
        const path = 'C:\\Users\\test\\file.txt'
        const buffer = Buffer.from(path + '\0', 'utf16le')
        vi.mocked(clipboard.readBuffer).mockReturnValue(buffer)
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toHaveLength(1)
        expect(result[0].path).toBe(path)
      })

      it('应该处理空 FileNameW buffer', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toEqual([])
      })
    })

    describe('Linux', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('linux')
      })

      it('应该从 text/uri-list 读取文件路径', () => {
        vi.mocked(clipboard.readText).mockReturnValue('file:///home/user/file.txt')
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toHaveLength(1)
        expect(result[0].path).toBe('/home/user/file.txt')
      })

      it('应该处理多个文件路径', () => {
        vi.mocked(clipboard.readText).mockReturnValue(
          'file:///home/user/file1.txt\nfile:///home/user/file2.txt'
        )
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toHaveLength(2)
      })

      it('应该处理非文件内容', () => {
        vi.mocked(clipboard.readText).mockReturnValue('普通文本内容')

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toEqual([])
      })
    })

    describe('错误处理', () => {
      it('应该处理读取异常', () => {
        vi.mocked(os.platform).mockReturnValue('darwin')
        vi.mocked(clipboard.readBuffer).mockImplementation(() => {
          throw new Error('读取失败')
        })

        const result = clipboardManager.readFilesFromSystemClipboard()

        expect(result).toEqual([])
      })
    })
  })

  describe('writeFilesToSystemClipboard', () => {
    describe('macOS', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('darwin')
      })

      it('应该写入有效文件路径', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['/Users/test/file.txt'],
          false
        )

        expect(result).toBe(true)
        expect(clipboard.writeBuffer).toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalled()
      })

      it('应该写入多个文件路径', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['/Users/test/file1.txt', '/Users/test/file2.txt'],
          false
        )

        expect(result).toBe(true)
      })

      it('应该过滤不存在的文件', () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/Users/test/exists.txt'
        })

        clipboardManager.writeFilesToSystemClipboard(
          ['/Users/test/exists.txt', '/Users/test/nonexistent.txt'],
          false
        )

        // 检查写入的内容只包含存在的文件
        const writeBufferCall = vi.mocked(clipboard.writeBuffer).mock.calls[0]
        const plistContent = writeBufferCall[1].toString()
        expect(plistContent).toContain('/Users/test/exists.txt')
        expect(plistContent).not.toContain('nonexistent.txt')
      })

      it('应该在所有文件都不存在时返回 false', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['/nonexistent.txt'],
          false
        )

        expect(result).toBe(false)
      })
    })

    describe('Windows', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('win32')
      })

      it('应该写入文本格式', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['C:\\Users\\test\\file.txt'],
          false
        )

        expect(result).toBe(true)
        expect(clipboard.writeText).toHaveBeenCalledWith('C:\\Users\\test\\file.txt')
      })
    })

    describe('Linux', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('linux')
      })

      it('应该写入 file:// URI 格式', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['/home/user/file.txt'],
          false
        )

        expect(result).toBe(true)
        expect(clipboard.writeText).toHaveBeenCalled()
        const writeCall = vi.mocked(clipboard.writeText).mock.calls[0][0]
        expect(writeCall).toContain('file://')
      })
    })

    describe('错误处理', () => {
      it('应该处理写入异常', () => {
        vi.mocked(os.platform).mockReturnValue('darwin')
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(clipboard.writeBuffer).mockImplementation(() => {
          throw new Error('写入失败')
        })

        const result = clipboardManager.writeFilesToSystemClipboard(
          ['/Users/test/file.txt'],
          false
        )

        expect(result).toBe(false)
      })
    })
  })

  describe('hasFilesInSystemClipboard', () => {
    describe('macOS', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('darwin')
      })

      it('应该检测 NSFilenamesPboardType 内容', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from('some content'))

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(true)
      })

      it('应该检测 file:// 文本', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))
        vi.mocked(clipboard.readText).mockReturnValue('file:///path/to/file')

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(true)
      })

      it('应该返回 false 当没有文件', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))
        vi.mocked(clipboard.readText).mockReturnValue('普通文本')

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(false)
      })
    })

    describe('Windows', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('win32')
      })

      it('应该检测 FileNameW buffer', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from('C:\\file.txt', 'utf16le'))

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(true)
      })

      it('应该返回 false 当 buffer 为空', () => {
        vi.mocked(clipboard.readBuffer).mockReturnValue(Buffer.from(''))

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(false)
      })
    })

    describe('Linux', () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue('linux')
      })

      it('应该检测 file:// 文本', () => {
        vi.mocked(clipboard.readText).mockReturnValue('file:///home/user/file.txt')

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(true)
      })
    })

    describe('错误处理', () => {
      it('应该在异常时返回 false', () => {
        vi.mocked(os.platform).mockReturnValue('darwin')
        vi.mocked(clipboard.readBuffer).mockImplementation(() => {
          throw new Error('读取失败')
        })

        const result = clipboardManager.hasFilesInSystemClipboard()

        expect(result).toBe(false)
      })
    })
  })

  describe('clearSystemClipboard', () => {
    it('应该清空剪贴板', () => {
      clipboardManager.clearSystemClipboard()

      expect(clipboard.clear).toHaveBeenCalled()
    })

    it('应该处理清空异常', () => {
      vi.mocked(clipboard.clear).mockImplementation(() => {
        throw new Error('清空失败')
      })

      // 不应该抛出异常
      expect(() => clipboardManager.clearSystemClipboard()).not.toThrow()
    })
  })
})
