import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAttachmentDialog, LocalAttachmentContent } from '../../src/components/LocalAttachmentDialog'

const text = { kind: 'text', name: 'sample.json', relativePath: 'sample.json', extension: '.json', size: 13,
  content: '{"value":-0}', revealLabel: '在 Finder 中显示', canOpenExternally: true,
  resourceHandle: 'attachment-handle', systemOpenRef: './sample.json' } as const
const readRequest = { operation: { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
  source: { filePath: '/fixture/A.md' }, href: './sample.json', leafId: 'single', requestId: 'attachment-request' }
const isCurrent = () => true

beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: { platform: 'darwin' } })
  window.api.readLinkedAttachment = vi.fn().mockResolvedValue(text)
  window.api.readWorkspaceResource = vi.fn().mockResolvedValue(text)
  window.api.openWorkspaceResource = vi.fn().mockResolvedValue({ success: false, cancelled: true })
  window.api.openLocalAttachment = vi.fn().mockResolvedValue({ success: false, cancelled: true })
  window.api.revealLinkedResource = vi.fn().mockResolvedValue({ success: true })
  window.api.releaseLinkedReads = vi.fn().mockResolvedValue(undefined)
  window.api.cancelLinkedRead = vi.fn().mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

const workspaceRequest = { operation: readRequest.operation, relativePath: 'sample.json', leafId: 'browser', requestId: 'resource-request' }

describe('工作台中的临时资源内容', () => {
  it('复用只读高亮与格式化，但不重新读取、不抢焦点、不锁住目录的滚轮', async () => {
    const origin = document.createElement('button'); document.body.append(origin); origin.focus()
    try {
      const { unmount } = render(<LocalAttachmentContent workspaceRequest={workspaceRequest} initialResult={text} isCurrent={isCurrent} onClose={vi.fn()} />)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByRole('region', { name: /临时预览/ })).not.toHaveAttribute('aria-modal')
      expect(await screen.findByRole('textbox', { name: '只读附件文本' })).toHaveAttribute('aria-readonly', 'true')
      expect(document.activeElement).toBe(origin)
      expect(window.api.readWorkspaceResource).not.toHaveBeenCalled()
      expect(window.api.readLinkedAttachment).not.toHaveBeenCalled()
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true })
      origin.dispatchEvent(wheel)
      expect(wheel.defaultPrevented).toBe(false)
      unmount()
      expect(window.api.releaseLinkedReads).toHaveBeenCalledWith(['attachment-handle'])
      expect(window.api.cancelLinkedRead).toHaveBeenCalledWith(readRequest.operation, 'browser', 'resource-request')
    } finally { origin.remove() }
  })
  it('系统打开和定位仅发送受控handle；HTML源码不会插入实际元素', async () => {
    const source = { ...text, name: 'test.html', extension: '.html', content: '<script>window.synthetic = true</script>', canOpenExternally: false }
    render(<LocalAttachmentContent workspaceRequest={workspaceRequest} initialResult={source} isCurrent={isCurrent} onClose={vi.fn()} />)
    expect(await screen.findByRole('textbox', { name: '只读附件文本' })).toHaveTextContent('<script>')
    expect(document.querySelector('.workspace-resource-preview script')).toBeNull()
    expect(screen.queryByRole('button', { name: '用系统应用打开' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '在 Finder 中显示' }))
    await waitFor(() => expect(window.api.revealLinkedResource).toHaveBeenCalledWith('attachment-handle'))
  })
  it('显式文本查看绑定当前handle；系统打开不伪造Markdown来源', async () => {
    const unknown = { ...text, kind: 'file' as const, extension: '', canViewAsText: true }
    render(<LocalAttachmentContent workspaceRequest={workspaceRequest} initialResult={unknown} isCurrent={isCurrent} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '按文本查看' }))
    await waitFor(() => expect(window.api.readWorkspaceResource).toHaveBeenCalledWith(workspaceRequest, true, 'attachment-handle'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '按文本查看' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '用系统应用打开' }))
    await waitFor(() => expect(window.api.openWorkspaceResource).toHaveBeenCalledWith('attachment-handle'))
    expect(window.api.openLocalAttachment).not.toHaveBeenCalled()
  })
  it('音视频不自动播放，卸载时暂停并清空source，不撤销共享token', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      const media = { ...text, kind: 'file' as const, preview: { kind: 'video' as const, url: 'local-media://asset/synthetic' } }
      const { container, unmount } = render(<LocalAttachmentContent workspaceRequest={workspaceRequest} initialResult={media} isCurrent={isCurrent} onClose={vi.fn()} />)
      const video = container.querySelector('video')!
      expect(video.autoplay).toBe(false)
      expect(video.controls).toBe(true)
      unmount()
      expect(pause).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledOnce()
      expect(video.hasAttribute('src')).toBe(false)
    } finally { pause.mockRestore(); load.mockRestore() }
  })
  it('图片解码失败明确提示，不冒充已成功预览', () => {
    const image = { ...text, kind: 'file' as const, preview: { kind: 'image' as const, url: 'local-image://asset/synthetic' } }
    render(<LocalAttachmentContent workspaceRequest={workspaceRequest} initialResult={image} isCurrent={isCurrent} onClose={vi.fn()} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('无法解码此文件，请使用合适的系统工具查看。')).toBeVisible()
  })
})

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
