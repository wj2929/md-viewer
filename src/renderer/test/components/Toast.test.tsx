import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ToastContainer, ToastMessage } from '../../src/components/Toast'

describe('Toast 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ToastContainer', () => {
    it('应该渲染空容器当没有消息时', () => {
      const { container } = render(
        <ToastContainer messages={[]} onClose={vi.fn()} />
      )
      expect(container.querySelector('.toast-container')).toBeInTheDocument()
      expect(container.querySelectorAll('.toast')).toHaveLength(0)
    })

    it('应该渲染多个 Toast', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'Success!' },
        { id: '2', type: 'error', message: 'Error!' }
      ]
      render(<ToastContainer messages={messages} onClose={vi.fn()} />)

      expect(screen.getByText('Success!')).toBeInTheDocument()
      expect(screen.getByText('Error!')).toBeInTheDocument()
    })
  })

  describe('Toast 类型', () => {
    it('应该渲染 success 类型', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'Success message' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-success')
      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('应该渲染 error 类型', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'error', message: 'Error message' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-error')
      // error 图标和关闭按钮都是 ✕，检查 toast-icon 中的
      expect(container.querySelector('.toast-icon')?.textContent).toBe('✕')
    })

    it('应该渲染 info 类型', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'info', message: 'Info message' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-info')
      expect(screen.getByText('ℹ')).toBeInTheDocument()
    })

    it('应该渲染 warning 类型', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'warning', message: 'Warning message' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-warning')
      expect(screen.getByText('⚠')).toBeInTheDocument()
    })
  })

  describe('Toast 内容', () => {
    it('应该显示消息文本', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: '操作成功完成！' }
      ]
      render(<ToastContainer messages={messages} onClose={vi.fn()} />)

      expect(screen.getByText('操作成功完成！')).toBeInTheDocument()
    })

    it('应该显示长文本消息', () => {
      const longMessage = '这是一条非常非常非常非常非常非常非常非常非常长的消息'
      const messages: ToastMessage[] = [
        { id: '1', type: 'info', message: longMessage }
      ]
      render(<ToastContainer messages={messages} onClose={vi.fn()} />)

      expect(screen.getByText(longMessage)).toBeInTheDocument()
    })
  })

  describe('自动关闭', () => {
    it('应该在默认 3 秒后自动关闭', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: 'test-1', type: 'success', message: 'Test' }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 等待 3 秒（默认 duration）+ 300ms（退出动画）
      act(() => {
        vi.advanceTimersByTime(3000 + 300)
      })

      expect(onClose).toHaveBeenCalledWith('test-1')
    })

    it('应该在自定义 duration 后关闭', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: 'test-1', type: 'success', message: 'Test', duration: 1000 }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 1 秒后还没关闭
      act(() => {
        vi.advanceTimersByTime(999)
      })
      expect(onClose).not.toHaveBeenCalled()

      // 1 秒 + 300ms 后关闭
      act(() => {
        vi.advanceTimersByTime(301)
      })
      expect(onClose).toHaveBeenCalledWith('test-1')
    })

    it('应该在较长的 duration 后关闭', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: 'test-1', type: 'error', message: 'Error', duration: 5000 }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 3 秒后还没关闭
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(onClose).not.toHaveBeenCalled()

      // 5 秒 + 300ms 后关闭
      act(() => {
        vi.advanceTimersByTime(2300)
      })
      expect(onClose).toHaveBeenCalledWith('test-1')
    })
  })

  describe('手动关闭', () => {
    it('应该能通过点击关闭按钮关闭', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: 'test-1', type: 'success', message: 'Test' }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      // 等待退出动画
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onClose).toHaveBeenCalledWith('test-1')
    })

    it('手动关闭应该触发 onClose', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: 'test-1', type: 'success', message: 'Test', duration: 10000 }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 手动关闭
      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onClose).toHaveBeenCalledWith('test-1')
    })
  })

  describe('动画类', () => {
    it('应该初始有 toast-enter 类', () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'Test' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-enter')
      expect(toast).not.toHaveClass('toast-exit')
    })

    it('关闭时应该切换到 toast-exit 类', async () => {
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'Test' }
      ]
      const { container } = render(
        <ToastContainer messages={messages} onClose={vi.fn()} />
      )

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      const toast = container.querySelector('.toast')
      expect(toast).toHaveClass('toast-exit')
      expect(toast).not.toHaveClass('toast-enter')
    })
  })

  describe('多个 Toast 管理', () => {
    it('应该正确关闭指定的 Toast', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'First', duration: 10000 },
        { id: '2', type: 'error', message: 'Second', duration: 10000 }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 获取所有关闭按钮
      const closeButtons = screen.getAllByRole('button')
      expect(closeButtons).toHaveLength(2)

      // 关闭第一个
      fireEvent.click(closeButtons[0])

      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onClose).toHaveBeenCalledWith('1')
      expect(onClose).not.toHaveBeenCalledWith('2')
    })

    it('每个 Toast 应该有独立的定时器', async () => {
      const onClose = vi.fn()
      const messages: ToastMessage[] = [
        { id: '1', type: 'success', message: 'First', duration: 1000 },
        { id: '2', type: 'error', message: 'Second', duration: 3000 }
      ]
      render(<ToastContainer messages={messages} onClose={onClose} />)

      // 1.3 秒后第一个关闭
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(onClose).toHaveBeenCalledWith('1')
      expect(onClose).not.toHaveBeenCalledWith('2')

      // 再等 2 秒，第二个关闭
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(onClose).toHaveBeenCalledWith('2')
    })
  })
})
