import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAttachmentDialog } from '../../src/components/LocalAttachmentDialog'

const text = { kind: 'text', name: 'sample.json', relativePath: 'sample.json', extension: '.json', size: 13,
  content: '{"value":-0}', revealLabel: '在 Finder 中显示', canOpenExternally: true,
  resourceHandle: 'attachment-handle', systemOpenRef: './sample.json' } as const
const readRequest = { operation: { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
  source: { filePath: '/fixture/A.md' }, href: './sample.json', leafId: 'single', requestId: 'attachment-request' }
const isCurrent = () => true

beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: { platform: 'darwin' } })
  window.api.readLinkedAttachment = vi.fn().mockResolvedValue(text)
  window.api.openLocalAttachment = vi.fn().mockResolvedValue({ success: false, cancelled: true })
  window.api.revealLinkedResource = vi.fn().mockResolvedValue({ success: true })
  window.api.releaseLinkedReads = vi.fn().mockResolvedValue(undefined)
  window.api.cancelLinkedRead = vi.fn().mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('本地附件弹窗', () => {
  it('结构化附件默认语法高亮，可独立关闭且保留JSON原文和只读状态', async () => {
    render(<LocalAttachmentDialog readRequest={readRequest} isCurrent={isCurrent} onClose={vi.fn()} />)
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    const toggle = await screen.findByRole('checkbox', { name: '语法高亮' })
    expect(toggle).toBeChecked()
    await waitFor(() => expect(editor.querySelector('.attachment-token-number')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '原文' }))
    expect(editor).toHaveTextContent('{"value":-0}')
    fireEvent.click(toggle)
    await waitFor(() => expect(editor.querySelector('.attachment-token-number')).toBeNull())
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(editor).toHaveAttribute('aria-readonly', 'true')
    expect(editor).toHaveTextContent('{"value":-0}')
    fireEvent.click(toggle)
    await waitFor(() => expect(editor.querySelector('.attachment-token-number')).not.toBeNull())
  })
  it('未完成读取可立即关闭，卸载后迟到结果不抢焦点或执行动作', async () => {
    let finish!: (value: typeof text) => void
    vi.mocked(window.api.readLinkedAttachment).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const close = vi.fn()
    const { unmount } = render(<LocalAttachmentDialog readRequest={readRequest} isCurrent={isCurrent} onClose={close} />)
    expect(screen.getByRole('status')).toHaveTextContent('附件读取中')
    fireEvent.click(screen.getByRole('button', { name: '关闭附件' }))
    expect(close).toHaveBeenCalledOnce()
    unmount()
    await act(async () => { finish(text) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.api.openLocalAttachment).not.toHaveBeenCalled()
  })

  it('只读纯文本、保真原文和分层Escape，不把已消费事件送到底层窗口', async () => {
    const close = vi.fn(), background = vi.fn()
    window.addEventListener('keydown', background)
    try {
      render(<LocalAttachmentDialog readRequest={readRequest} isCurrent={isCurrent} onClose={close} />)
      const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
      expect(editor).toHaveAttribute('aria-readonly', 'true')
      fireEvent.click(screen.getByRole('button', { name: '原文' }))
      expect(editor).toHaveTextContent('{"value":-0}')
      fireEvent.click(screen.getByRole('button', { name: /查找/ }))
      expect(document.querySelector('.cm-search')).not.toBeNull()
      fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape' })
      expect(document.querySelector('.cm-search')).toBeNull()
      expect(close).not.toHaveBeenCalled()
      expect(background).not.toHaveBeenCalled()
      fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape' })
      expect(close).toHaveBeenCalledOnce()
      expect(background).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', background) }
  })

  it('系统打开必须点击，取消无错误，受控错误明确显示，定位只用窄授权接口', async () => {
    render(<LocalAttachmentDialog readRequest={readRequest} isCurrent={isCurrent} onClose={vi.fn()} />)
    await screen.findByRole('textbox', { name: '只读附件文本' })
    expect(window.api.openLocalAttachment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '用系统应用打开' }))
    await waitFor(() => expect(window.api.openLocalAttachment).toHaveBeenCalledWith('/fixture/A.md', './sample.json'))
    await waitFor(() => expect(screen.getByRole('button', { name: '用系统应用打开' })).not.toBeDisabled())
    expect(screen.queryByRole('alert')).toBeNull()
    vi.mocked(window.api.openLocalAttachment).mockResolvedValueOnce({ success: false, code: 'stale' })
    fireEvent.click(screen.getByRole('button', { name: '用系统应用打开' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('来源工作区或附件已变化，请重新打开。')
    fireEvent.click(screen.getByRole('button', { name: '在 Finder 中显示' }))
    await waitFor(() => expect(window.api.revealLinkedResource).toHaveBeenCalledWith('attachment-handle'))
  })
})
