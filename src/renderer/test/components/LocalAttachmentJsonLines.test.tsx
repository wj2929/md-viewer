import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { LocalAttachmentDialog } from '../../src/components/LocalAttachmentDialog'
import { formatAttachmentJsonLines } from '../../src/utils/localAttachmentText'

const request = { operation: { workspaceId: 'workspace-a', lifecycleEpoch: 1 }, source: { filePath: '/fixture/A.md' },
  href: './records.jsonl', leafId: 'single', requestId: 'jsonlines-request' }
const current = () => true
const source = '{"id":9007199254740993123,"id":-0,"name":"first"}\n{"id":2,"n":1.00e+400}\n'
const result = (extension: string, content: string) => ({ kind: 'text' as const, name: `records${extension}`, relativePath: `records${extension}`,
  extension, size: new TextEncoder().encode(content).length, content, revealLabel: '在 Finder 中显示', canOpenExternally: false, resourceHandle: 'jsonlines-handle' })
beforeEach(() => {
  window.api = { ...window.api, platform: 'darwin', readLinkedAttachment: vi.fn(),
    releaseLinkedReads: vi.fn().mockResolvedValue(undefined), cancelLinkedRead: vi.fn().mockResolvedValue(undefined) }
})

function open(extension: string, content: string) {
  vi.mocked(window.api.readLinkedAttachment).mockResolvedValue(result(extension, content))
  return render(<LocalAttachmentDialog readRequest={request} isCurrent={current} onClose={vi.fn()} />)
}

describe('JSONL/NDJSON附件格式化', () => {
  it.each(['.jsonl', '.ndjson'])('%s 默认逐条展开，可还原原文；高亮和查找独立且保持只读', async extension => {
    open(extension, source)
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    const view = EditorView.findFromDOM(editor)!
    expect(view.state.doc.toString()).toBe(formatAttachmentJsonLines(source).content)
    expect(screen.getByRole('button', { name: '格式化' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/此视图不再是单行记录格式/)).toBeVisible()
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(view.state.readOnly).toBe(true)
    const highlight = screen.getByRole('checkbox', { name: '语法高亮' })
    await waitFor(() => expect(editor.querySelector('.attachment-token-property')).not.toBeNull())
    fireEvent.click(highlight)
    expect(view.state.doc.toString()).toBe(formatAttachmentJsonLines(source).content)
    fireEvent.click(screen.getByRole('button', { name: '原文' }))
    expect(view.state.doc.toString()).toBe(source)
    expect(screen.queryByText(/此视图不再是单行记录格式/)).toBeNull()
    expect(EditorView.findFromDOM(editor)).toBe(view)
    fireEvent.click(screen.getByRole('button', { name: /查找/ }))
    expect(document.querySelector('.cm-search input')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '格式化' }))
    expect(view.state.doc.toString()).toBe(formatAttachmentJsonLines(source).content)
    expect(highlight).not.toBeChecked()
    expect(editor.querySelector('[class*="attachment-token-"]')).toBeNull()
  })

  it.each(['.jsonl', '.ndjson'])('%s 任一非法记录指出原始行号，并保留全文与原文入口', async extension => {
    const content = '{"ok":1}\n\n{bad}\n{"ok":2}'
    open(extension, content)
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    expect(screen.getByText('第 3 行不是有效 JSON，按原文显示。')).toBeVisible()
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(content)
    fireEvent.click(screen.getByRole('button', { name: '原文' }))
    expect(screen.queryByText(/不是有效 JSON/)).toBeNull()
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(content)
  })

  it('预算超限仍然保留完整原文且不显示逐条展开说明', async () => {
    const content = '{"ok":1}\n' + '['.repeat(65) + '0' + ']'.repeat(65)
    open('.jsonl', content)
    const editor = await screen.findByRole('textbox', { name: '只读附件文本' })
    expect(screen.getByText('超过格式化预算，按原文显示。')).toBeVisible()
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(content)
    expect(screen.queryByText(/此视图不再是单行记录格式/)).toBeNull()
  })
})
