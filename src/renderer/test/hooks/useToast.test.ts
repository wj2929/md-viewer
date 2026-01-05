import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToast } from '../../src/hooks/useToast'

describe('useToast Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('初始状态', () => {
    it('应该初始化为空消息数组', () => {
      const { result } = renderHook(() => useToast())
      expect(result.current.messages).toEqual([])
    })

    it('应该提供所有必要的方法', () => {
      const { result } = renderHook(() => useToast())
      expect(typeof result.current.success).toBe('function')
      expect(typeof result.current.error).toBe('function')
      expect(typeof result.current.warning).toBe('function')
      expect(typeof result.current.info).toBe('function')
      expect(typeof result.current.close).toBe('function')
    })
  })

  describe('success 方法', () => {
    it('应该添加 success 类型的消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('成功消息')
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0].type).toBe('success')
      expect(result.current.messages[0].message).toBe('成功消息')
    })

    it('应该返回消息 ID', () => {
      const { result } = renderHook(() => useToast())

      let id: string | undefined
      act(() => {
        id = result.current.success('Test')
      })

      expect(id).toBeDefined()
      expect(id).toMatch(/^toast-\d+$/)
    })

    it('应该支持自定义 duration', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('Test', { duration: 5000 })
      })

      expect(result.current.messages[0].duration).toBe(5000)
    })
  })

  describe('error 方法', () => {
    it('应该添加 error 类型的消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.error('错误消息')
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0].type).toBe('error')
      expect(result.current.messages[0].message).toBe('错误消息')
    })

    it('应该支持自定义 duration', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.error('Error', { duration: 10000 })
      })

      expect(result.current.messages[0].duration).toBe(10000)
    })
  })

  describe('warning 方法', () => {
    it('应该添加 warning 类型的消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.warning('警告消息')
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0].type).toBe('warning')
      expect(result.current.messages[0].message).toBe('警告消息')
    })
  })

  describe('info 方法', () => {
    it('应该添加 info 类型的消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.info('提示消息')
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0].type).toBe('info')
      expect(result.current.messages[0].message).toBe('提示消息')
    })
  })

  describe('close 方法', () => {
    it('应该根据 ID 移除消息', () => {
      const { result } = renderHook(() => useToast())

      let id: string | undefined
      act(() => {
        id = result.current.success('Test')
      })

      expect(result.current.messages).toHaveLength(1)

      act(() => {
        result.current.close(id!)
      })

      expect(result.current.messages).toHaveLength(0)
    })

    it('应该只移除指定 ID 的消息', () => {
      const { result } = renderHook(() => useToast())

      let id1: string | undefined
      let id2: string | undefined
      act(() => {
        id1 = result.current.success('First')
        id2 = result.current.error('Second')
      })

      expect(result.current.messages).toHaveLength(2)

      act(() => {
        result.current.close(id1!)
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0].id).toBe(id2)
    })

    it('关闭不存在的 ID 应该不报错', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('Test')
      })

      act(() => {
        result.current.close('non-existent-id')
      })

      expect(result.current.messages).toHaveLength(1)
    })
  })

  describe('多消息管理', () => {
    it('应该能同时管理多个消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('Success')
        result.current.error('Error')
        result.current.warning('Warning')
        result.current.info('Info')
      })

      expect(result.current.messages).toHaveLength(4)
      expect(result.current.messages.map(m => m.type)).toEqual([
        'success', 'error', 'warning', 'info'
      ])
    })

    it('每个消息应该有唯一 ID', () => {
      const { result } = renderHook(() => useToast())

      const ids: string[] = []
      act(() => {
        ids.push(result.current.success('1'))
        ids.push(result.current.success('2'))
        ids.push(result.current.success('3'))
      })

      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })

    it('消息应该按添加顺序排列', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('First')
        result.current.error('Second')
        result.current.warning('Third')
      })

      expect(result.current.messages[0].message).toBe('First')
      expect(result.current.messages[1].message).toBe('Second')
      expect(result.current.messages[2].message).toBe('Third')
    })
  })

  describe('Hook 稳定性', () => {
    it('方法引用应该稳定（不会在每次渲染时改变）', () => {
      const { result, rerender } = renderHook(() => useToast())

      const initialSuccess = result.current.success
      const initialError = result.current.error
      const initialClose = result.current.close

      rerender()

      expect(result.current.success).toBe(initialSuccess)
      expect(result.current.error).toBe(initialError)
      expect(result.current.close).toBe(initialClose)
    })
  })

  describe('边界情况', () => {
    it('应该处理空字符串消息', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('')
      })

      expect(result.current.messages[0].message).toBe('')
    })

    it('应该处理特殊字符消息', () => {
      const { result } = renderHook(() => useToast())
      const specialMessage = '<script>alert("xss")</script>'

      act(() => {
        result.current.error(specialMessage)
      })

      expect(result.current.messages[0].message).toBe(specialMessage)
    })

    it('应该处理 Unicode 消息', () => {
      const { result } = renderHook(() => useToast())
      const unicodeMessage = '你好世界 🎉 مرحبا'

      act(() => {
        result.current.info(unicodeMessage)
      })

      expect(result.current.messages[0].message).toBe(unicodeMessage)
    })

    it('应该处理很长的消息', () => {
      const { result } = renderHook(() => useToast())
      const longMessage = 'A'.repeat(10000)

      act(() => {
        result.current.warning(longMessage)
      })

      expect(result.current.messages[0].message.length).toBe(10000)
    })

    it('应该处理 0 duration', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('Test', { duration: 0 })
      })

      expect(result.current.messages[0].duration).toBe(0)
    })

    it('应该处理 undefined duration', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.success('Test', {})
      })

      expect(result.current.messages[0].duration).toBeUndefined()
    })
  })
})
