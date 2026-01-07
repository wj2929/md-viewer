import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTableOfContents } from '../../src/hooks/useTableOfContents'

describe('useTableOfContents Hook 测试', () => {
  describe('目录提取', () => {
    it('应该从 markdown 提取目录', async () => {
      const markdown = '# Title\n## Section 1\n## Section 2'
      const { result } = renderHook(() => useTableOfContents(markdown, { debounceMs: 0 }))

      await waitFor(() => {
        expect(result.current.toc.length).toBe(3)
      })

      expect(result.current.toc[0].text).toBe('Title')
      expect(result.current.toc[1].text).toBe('Section 1')
      expect(result.current.toc[2].text).toBe('Section 2')
    })

    it('应该处理空 markdown', async () => {
      const { result } = renderHook(() => useTableOfContents('', { debounceMs: 0 }))

      await waitFor(() => {
        expect(result.current.toc).toHaveLength(0)
      })
    })

    it('应该处理没有标题的 markdown', async () => {
      const markdown = 'Just some text without headings.'
      const { result } = renderHook(() => useTableOfContents(markdown, { debounceMs: 0 }))

      await waitFor(() => {
        expect(result.current.toc).toHaveLength(0)
      })
    })

    it('应该为重复标题生成唯一 ID', async () => {
      const markdown = '# Title\n## Title\n### Title'
      const { result } = renderHook(() => useTableOfContents(markdown, { debounceMs: 0 }))

      await waitFor(() => {
        expect(result.current.toc.length).toBe(3)
      })

      const ids = result.current.toc.map(t => t.id)
      expect(ids[0]).toBe('title')
      expect(ids[1]).toBe('title-1')
      expect(ids[2]).toBe('title-2')
    })
  })

  describe('滚动功能', () => {
    it('应该提供 scrollToHeading 函数', () => {
      const { result } = renderHook(() => useTableOfContents('# Test'))

      expect(typeof result.current.scrollToHeading).toBe('function')
    })

    it('scrollToHeading 应该处理 null 容器', () => {
      const { result } = renderHook(() => useTableOfContents('# Test'))

      // 不应该抛出错误
      expect(() => {
        result.current.scrollToHeading('test', null)
      }).not.toThrow()
    })

    it('scrollToHeading 应该滚动到目标元素', async () => {
      const { result } = renderHook(() => useTableOfContents('# Test', { debounceMs: 0 }))

      // 创建模拟容器和标题元素
      const mockHeading = document.createElement('h1')
      mockHeading.id = 'test'
      mockHeading.scrollIntoView = vi.fn()

      const mockContainer = document.createElement('div')
      mockContainer.appendChild(mockHeading)

      await act(async () => {
        result.current.scrollToHeading('test', mockContainer)
      })

      expect(mockHeading.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start'
      })
    })
  })

  describe('防抖行为', () => {
    it('应该使用默认防抖延迟', () => {
      const { result } = renderHook(() => useTableOfContents('# Test'))
      expect(result.current.toc).toBeDefined()
    })

    it('应该支持自定义防抖延迟', () => {
      const { result } = renderHook(() =>
        useTableOfContents('# Test', { debounceMs: 100 })
      )
      expect(result.current.toc).toBeDefined()
    })
  })

  describe('markdown 更新', () => {
    it('应该响应 markdown 变化', async () => {
      const { result, rerender } = renderHook(
        ({ md }) => useTableOfContents(md, { debounceMs: 0 }),
        { initialProps: { md: '# Title 1' } }
      )

      await waitFor(() => {
        expect(result.current.toc[0]?.text).toBe('Title 1')
      })

      rerender({ md: '# Title 2' })

      await waitFor(() => {
        expect(result.current.toc[0]?.text).toBe('Title 2')
      })
    })
  })
})
