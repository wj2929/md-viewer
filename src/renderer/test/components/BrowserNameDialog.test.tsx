import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrowserNameDialog } from '../../src/components/BrowserNameDialog'

describe('BrowserNameDialog', () => {
  it('selects the basename, cancels with Escape and never submits by cancelling', () => {
    const onSubmit = vi.fn(), onClose = vi.fn()
    render(<BrowserNameDialog title="新建文件" location="fixture" initialName="未命名.md" onSubmit={onSubmit} onClose={onClose} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input).toHaveFocus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('blocks double submission and closing while busy, then shows an actionable error', async () => {
    let reject!: (error: Error) => void
    const onSubmit = vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail })), onClose = vi.fn()
    render(<BrowserNameDialog title="重命名" location="fixture" initialName="file.txt" onSubmit={onSubmit} onClose={onClose} />)
    const form = screen.getByRole('dialog')
    fireEvent.submit(form); fireEvent.submit(form)
    fireEvent.keyDown(form, { key: 'Escape' })
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('file.txt')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => reject(new Error('已有同名文件')))
    expect(await screen.findByRole('alert')).toHaveTextContent('已有同名文件')
    await waitFor(() => expect(screen.getByRole('button', { name: '继续' })).toBeEnabled())
  })
})
