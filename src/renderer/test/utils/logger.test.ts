// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logToFile, clearLog } from '../../src/utils/logger'

describe('logger 工具函数测试', () => {
  const originalWindow = global.window
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    vi.useRealTimers()
    global.window = originalWindow
  })

  describe('logToFile', () => {
    it('应该输出带时间戳的日志到 console', () => {
      // 设置 window.api 为 undefined
      global.window = { api: undefined } as typeof window

      logToFile('Test message')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z] Test message')
    })

    it('应该在有 api.logToFile 时调用它', () => {
      const mockLogToFile = vi.fn()
      global.window = {
        api: { logToFile: mockLogToFile }
      } as unknown as typeof window

      logToFile('Test message')

      expect(mockLogToFile).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z] Test message\n')
    })

    it('应该处理空消息', () => {
      global.window = { api: undefined } as typeof window

      logToFile('')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z]')
    })

    it('应该处理特殊字符', () => {
      global.window = { api: undefined } as typeof window

      logToFile('Special chars: <>&"\'')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z] Special chars: <>&"\'')
    })

    it('应该处理多行消息', () => {
      global.window = { api: undefined } as typeof window

      logToFile('Line 1\nLine 2\nLine 3')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z] Line 1\nLine 2\nLine 3')
    })

    it('应该处理 Unicode 字符', () => {
      global.window = { api: undefined } as typeof window

      logToFile('中文日志 🎉')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-01-03T12:00:00.000Z] 中文日志 🎉')
    })

    it('应该在 window.api 存在但 logToFile 不存在时正常工作', () => {
      global.window = {
        api: { otherMethod: vi.fn() }
      } as unknown as typeof window

      logToFile('Test')

      expect(consoleSpy).toHaveBeenCalled()
    })

    it('应该正确格式化时间戳', () => {
      vi.setSystemTime(new Date('2026-06-15T23:59:59.999Z'))
      global.window = { api: undefined } as typeof window

      logToFile('Test')

      expect(consoleSpy).toHaveBeenCalledWith('[2026-06-15T23:59:59.999Z] Test')
    })
  })

  describe('clearLog', () => {
    it('应该在有 api.clearLog 时调用它', () => {
      const mockClearLog = vi.fn()
      global.window = {
        api: { clearLog: mockClearLog }
      } as unknown as typeof window

      clearLog()

      expect(mockClearLog).toHaveBeenCalled()
    })

    it('应该在没有 api.clearLog 时不报错', () => {
      global.window = { api: undefined } as typeof window

      expect(() => clearLog()).not.toThrow()
    })

    it('应该在 window.api 存在但 clearLog 不存在时不报错', () => {
      global.window = {
        api: { otherMethod: vi.fn() }
      } as unknown as typeof window

      expect(() => clearLog()).not.toThrow()
    })
  })

  describe('边界情况', () => {
    it('应该处理非常长的消息', () => {
      global.window = { api: undefined } as typeof window
      const longMessage = 'A'.repeat(10000)

      logToFile(longMessage)

      expect(consoleSpy).toHaveBeenCalled()
      const calledArg = consoleSpy.mock.calls[0][0]
      expect(calledArg).toContain(longMessage)
    })

    it('应该处理包含换行符的日志', () => {
      const mockLogToFile = vi.fn()
      global.window = {
        api: { logToFile: mockLogToFile }
      } as unknown as typeof window

      logToFile('Error:\nStack trace here')

      expect(mockLogToFile).toHaveBeenCalledWith(
        '[2026-01-03T12:00:00.000Z] Error:\nStack trace here\n'
      )
    })
  })
})
