import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { LocalAttachmentDialog } from '../../src/components/LocalAttachmentDialog'
import * as highlight from '../../src/utils/localAttachmentHighlight'

const request = { operation: { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
  source: { filePath: '/fixture/A.md' }, href: './sample.sql', leafId: 'single', requestId: 'highlight-request' }
const current = () => true
const result = (extension: string, content: string) => ({ kind: 'text' as const, name: `sample${extension}`,
  relativePath: `sample${extension}`, extension, content, size: new TextEncoder().encode(content).length,
  revealLabel: '在 Finder 中显示', canOpenExternally: false, resourceHandle: 'highlight-handle' })

beforeEach(() => {
  window.api = { ...window.api, platform: 'darwin',
    readLinkedAttachment: vi.fn().mockResolvedValue(result('.sql', 'SELECT 42;')),
    releaseLinkedReads: vi.fn().mockResolvedValue(undefined), cancelLinkedRead: vi.fn().mockResolvedValue(undefined),
  }
})
afterEach(() => vi.restoreAllMocks())

function open() {
  return render(<LocalAttachmentDialog readRequest={request} isCurrent={current} onClose={vi.fn()} />)
}

describe('附件高亮交互与回退', () => {
  it.each([
    ['.sql', "-- 注释\nSELECT '文字' AS name, 42 FROM sample;"],
    ['.jsonl', '{"id":1}\n{"id":2}\n'], ['.ndjson', '{"id":1}\n{"id":2}\n'],
    ['.yaml', 'count: 42\nname: "文字"'], ['.xml', '<root name="value"/>'],
    ['.html', '<script>window.executed=true</script><img src="https://example.invalid/x">'],
    ['.svg', '<svg onload="window.executed=true"><text>文字</text></svg>'],
  ])('%s 仍是只读源码而不是HTML渲染', async (extension, content) => {
    vi.mocked(window.api.readLinkedAttachment).mockResolvedValue(result(extension, content))
    open()
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    if (extension === '.jsonl' || extension === '.ndjson') fireEvent.click(screen.getByRole('button', { name: '原文' }))
    await waitFor(() => expect(editor.querySelector('[class*="attachment-token-"]')).not.toBeNull())
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(content)
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(editor.querySelector('script, img, svg, a')).toBeNull()
    if (['.sql', '.jsonl', '.ndjson'].includes(extension)) expect(screen.getByRole('button', { name: '格式化' })).toBeInTheDocument()
    else expect(screen.queryByRole('button', { name: '格式化' })).toBeNull()
  })

  it.each(['.txt', '.log', '.csv', '.tsv', '.unknown'])('%s 不加载或显示高亮功能', async extension => {
    const loader = vi.spyOn(highlight, 'loadAttachmentHighlight')
    vi.mocked(window.api.readLinkedAttachment).mockResolvedValue(result(extension, 'SELECT 42;'))
    open()
    await screen.findByRole('textbox', { name: '只读附件文本' })
    expect(screen.queryByRole('checkbox', { name: '语法高亮' })).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('超预算不加载语言，不截断完整文本，查找仍然可用', async () => {
    const loader = vi.spyOn(highlight, 'loadAttachmentHighlight')
    const content = 'x'.repeat(16 * 1024 + 1) + 'NEEDLE_END'
    vi.mocked(window.api.readLinkedAttachment).mockResolvedValue(result('.sql', content))
    open()
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    expect(screen.getByRole('checkbox', { name: '语法高亮' })).toBeDisabled()
    expect(screen.getByText('内容较大、行数较多或单行过长，已按纯文本显示。')).toBeInTheDocument()
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(content)
    expect(loader).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /查找/ }))
    expect(document.querySelector('.cm-search input[name="search"]')).not.toBeNull()
  })

  it('加载失败只退回纯文本，关闭再开启可重试', async () => {
    vi.spyOn(highlight, 'loadAttachmentHighlight').mockRejectedValueOnce(new Error('fixture failure'))
    open()
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    await screen.findByText('高亮加载失败，按纯文本显示。')
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe('SELECT 42;')
    const toggle = screen.getByRole('checkbox', { name: '语法高亮' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await waitFor(() => expect(editor.querySelector('.attachment-token-keyword')).not.toBeNull())
    expect(screen.queryByText('高亮加载失败，按纯文本显示。')).toBeNull()
  })

  it('关闭高亮或卸载后的迟到加载不会重新应用', async () => {
    const extension = await highlight.loadAttachmentHighlight('sql')
    let finish!: (value: Extension) => void
    const loader = vi.spyOn(highlight, 'loadAttachmentHighlight').mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { unmount } = open()
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    fireEvent.click(screen.getByRole('checkbox', { name: '语法高亮' }))
    await act(async () => { finish(extension) })
    expect(editor.querySelector('[class*="attachment-token-"]')).toBeNull()
    let finishAfterClose!: (value: Extension) => void
    loader.mockReturnValueOnce(new Promise(resolve => { finishAfterClose = resolve }))
    fireEvent.click(screen.getByRole('checkbox', { name: '语法高亮' }))
    unmount()
    await act(async () => { finishAfterClose(extension) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
