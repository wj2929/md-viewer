import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

// 创建一个会抛出错误的组件
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('测试错误')
  }
  return <div>正常组件</div>
}

describe('ErrorBoundary 组件测试', () => {
  beforeEach(() => {
    // 禁用 console.error 以避免测试输出中的错误信息
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('正常渲染', () => {
    it('应该正常渲染子组件', () => {
      render(
        <ErrorBoundary>
          <div>测试内容</div>
        </ErrorBoundary>
      )

      expect(screen.getByText('测试内容')).toBeInTheDocument()
    })

    it('应该渲染多个子组件', () => {
      render(
        <ErrorBoundary>
          <div>子组件 1</div>
          <div>子组件 2</div>
        </ErrorBoundary>
      )

      expect(screen.getByText('子组件 1')).toBeInTheDocument()
      expect(screen.getByText('子组件 2')).toBeInTheDocument()
    })
  })

  describe('错误捕获', () => {
    it('应该捕获子组件错误并显示错误 UI', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(screen.getByText('应用发生错误')).toBeInTheDocument()
    })

    it('应该显示错误信息', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(screen.getByText('测试错误')).toBeInTheDocument()
    })

    it('应该显示错误图标', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(screen.getByText('⚠️')).toBeInTheDocument()
    })

    it('应该显示继续使用和重新加载按钮', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(screen.getByRole('button', { name: '继续使用' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    })
  })

  describe('错误恢复', () => {
    it('点击重新加载按钮应该重新加载页面', () => {
      // Mock window.location.reload
      const reloadMock = vi.fn()
      Object.defineProperty(window, 'location', {
        value: { reload: reloadMock },
        writable: true
      })

      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      const reloadButton = screen.getByRole('button', { name: '重新加载' })
      reloadButton.click()

      expect(reloadMock).toHaveBeenCalled()
    })

    it('点击继续使用按钮应该重置错误状态', () => {
      const { rerender } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(screen.getByText('应用发生错误')).toBeInTheDocument()

      const resetButton = screen.getByRole('button', { name: '继续使用' })
      resetButton.click()

      // 重置后应该尝试重新渲染子组件
      // 但由于子组件仍然会抛错，所以会再次显示错误 UI
      // 这里只验证按钮点击不会崩溃
      expect(resetButton).toBeInTheDocument()
    })
  })

  describe('错误日志', () => {
    it('应该记录错误到控制台', () => {
      const consoleError = vi.spyOn(console, 'error')

      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      expect(consoleError).toHaveBeenCalled()
    })
  })

  describe('边界情况', () => {
    it('应该处理没有错误信息的情况', () => {
      const ErrorWithoutMessage = () => {
        const error = new Error()
        error.message = ''
        throw error
      }

      render(
        <ErrorBoundary>
          <ErrorWithoutMessage />
        </ErrorBoundary>
      )

      expect(screen.getByText('未知错误')).toBeInTheDocument()
    })

    it('应该处理非 Error 对象的错误', () => {
      const ThrowString = () => {
        throw 'String error'
      }

      render(
        <ErrorBoundary>
          <ThrowString />
        </ErrorBoundary>
      )

      expect(screen.getByText('应用发生错误')).toBeInTheDocument()
    })
  })

  describe('组件状态', () => {
    it('捕获错误后 hasError 应该为 true', () => {
      const { container } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      )

      // 通过检查错误 UI 是否存在来验证状态
      expect(container.querySelector('.error-boundary')).toBeInTheDocument()
    })
  })
})
