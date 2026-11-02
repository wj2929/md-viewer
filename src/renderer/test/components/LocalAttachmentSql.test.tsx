import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { LocalAttachmentDialog } from '../../src/components/LocalAttachmentDialog'
import { requestAttachmentSqlFormat, type SqlFormatResult } from '../../src/utils/localAttachmentSql'
import { formatAttachmentSql } from '../../src/utils/localAttachmentSqlFormat'

vi.mock('../../src/utils/localAttachmentSql', () => ({ requestAttachmentSqlFormat: vi.fn() }))
const request = { operation: { workspaceId: 'workspace-a', lifecycleEpoch: 1 }, source: { filePath: '/fixture/A.md' },
  href: './sample.sql', leafId: 'single', requestId: 'sql-request' }
const current = () => true
const source = "select id, '文本' as name from orders where id=42;"
const result = { kind: 'text' as const, name: 'sample.sql', relativePath: 'sample.sql', extension: '.sql', size: source.length,
  content: source, revealLabel: '在 Finder 中显示', canOpenExternally: false, resourceHandle: 'sql-handle' }

beforeEach(() => {
  window.api = { ...window.api, platform: 'darwin', readLinkedAttachment: vi.fn().mockResolvedValue(result),
    releaseLinkedReads: vi.fn().mockResolvedValue(undefined), cancelLinkedRead: vi.fn().mockResolvedValue(undefined) }
  vi.mocked(requestAttachmentSqlFormat).mockImplementation(async value => formatAttachmentSql(value))
})
afterEach(() => vi.clearAllMocks())

function open(isCurrent = current) {
  return render(<LocalAttachmentDialog readRequest={request} isCurrent={isCurrent} onClose={vi.fn()} />)
}

describe('SQL附件格式化显示', () => {
  it('默认原文，显式请求后排版，与高亮独立，不重建只读编辑器', async () => {
    open()
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    const view = EditorView.findFromDOM(editor)!
    expect(screen.getByRole('button', { name: '原文' })).toHaveAttribute('aria-pressed', 'true')
    expect(view.state.doc.toString()).toBe(source)
    expect(requestAttachmentSqlFormat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: '语法高亮' }))
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(formatAttachmentSql(source).content))
    expect(EditorView.findFromDOM(editor)).toBe(view)
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(view.state.readOnly).toBe(true)
    expect(editor.querySelector('[class*="attachment-token-"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /查找/ }))
    expect(document.querySelector('.cm-search input')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '原文' }))
    expect(view.state.doc.toString()).toBe(source)
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(formatAttachmentSql(source).content))
    expect(requestAttachmentSqlFormat).toHaveBeenCalledOnce()
  })

  it.each(['unsupported', 'budget', 'unavailable'] as const)('%s显示原因并保留完整原文', async reason => {
    vi.mocked(requestAttachmentSqlFormat).mockResolvedValue({ content: source, reason })
    open()
    await screen.findByRole('textbox', { name: '只读附件文本' })
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    await screen.findByText(/按原文显示。/)
    expect(EditorView.findFromDOM(screen.getByRole('textbox'))?.state.doc.toString()).toBe(source)
    fireEvent.click(screen.getByRole('button', { name: '原文' }))
    expect(screen.queryByText(/按原文显示。/)).toBeNull()
  })

  it.each(['original', 'unmount', 'stale'])('%s取消后迟到结果不会替换正文', async action => {
    let finish!: (value: SqlFormatResult) => void
    let signal!: AbortSignal
    let valid = true
    vi.mocked(requestAttachmentSqlFormat).mockImplementation((_source, cancelSignal) => {
      signal = cancelSignal
      return new Promise(resolve => { finish = resolve })
    })
    const { unmount } = open(() => valid)
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    await screen.findByText('SQL 格式化中，暂时显示原文…')
    if (action === 'original') fireEvent.click(screen.getByRole('button', { name: '原文' }))
    else if (action === 'unmount') unmount()
    else valid = false
    if (action !== 'stale') expect(signal.aborted).toBe(true)
    await act(async () => { finish({ content: 'LATE' }) })
    if (action === 'unmount') expect(screen.queryByRole('dialog')).toBeNull()
    else expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(source)
  })
})
