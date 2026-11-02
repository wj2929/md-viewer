import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastContainer } from '../Toast'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('PDF busy toast lifecycle', () => {
  it('keeps duration-zero messages until the export explicitly removes them', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = render(<ToastContainer messages={[{ id: 'pdf', type: 'info', message: '正在导出 PDF...', duration: 0 }]} onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(180_000) })
    expect(screen.getByText('正在导出 PDF...')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    view.rerender(<ToastContainer messages={[]} onClose={onClose} />)
    expect(screen.queryByText('正在导出 PDF...')).toBeNull()
  })
  it('retains the original three-second default for normal messages', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<ToastContainer messages={[{ id: 'normal', type: 'success', message: '完成' }]} onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(3300) })
    expect(onClose).toHaveBeenCalledWith('normal')
  })
})
