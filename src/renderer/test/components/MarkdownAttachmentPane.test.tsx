import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { loadAttachmentHighlight } from '../../src/utils/localAttachmentHighlight'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from '../../src/components/editor/MarkdownEditorPane'

it('附件纯文本模式双重只读、可聚焦，HTML/链接仅为原文，不保存或创建编辑回调', () => {
  const onChange = vi.fn(), onSave = vi.fn()
  const ref = createRef<MarkdownEditorPaneHandle>()
  render(<MarkdownEditorPane ref={ref} content='<script>window.executed=true</script>\nhttps://example.com'
    readOnly plainText accessibleLabel="只读附件文本" onChange={onChange} onSave={onSave} />)
  const content = screen.getByRole('textbox', { name: '只读附件文本' })
  expect(content).toHaveAttribute('aria-readonly', 'true')
  expect(content).toHaveAttribute('contenteditable', 'false')
  expect(content).toHaveAttribute('tabindex', '0')
  expect(EditorView.findFromDOM(content)?.state.readOnly).toBe(true)
  expect(content.querySelector('script')).toBeNull()
  expect(content.querySelector('a')).toBeNull()
  act(() => { ref.current?.focus(); ref.current?.replaceDocument('完整新快照') })
  expect(content).toHaveFocus()
  expect(ref.current?.getCurrentDoc()).toBe('完整新快照')
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) fireEvent.keyDown(content, { key: 's', code: 'KeyS', ...modifier })
  expect(onSave).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

describe('附件CodeMirror查找', () => {
  it('切换语法扩展不重建查看器或清空选区、查找及正文', async () => {
    const ref = createRef<MarkdownEditorPaneHandle>()
    const onChange = vi.fn(), onSave = vi.fn()
    const { rerender } = render(<MarkdownEditorPane ref={ref} content="SELECT 42;" readOnly plainText
      accessibleLabel="只读附件文本" onChange={onChange} onSave={onSave} />)
    const editor = screen.getByRole('textbox', { name: '只读附件文本' })
    const view = EditorView.findFromDOM(editor)!
    act(() => { view.dispatch({ selection: { anchor: 0, head: 6 } }); ref.current?.openSearch() })
    const search = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]')!
    fireEvent.change(search, { target: { value: '42' } })
    const syntaxExtension = await loadAttachmentHighlight('sql')
    rerender(<MarkdownEditorPane ref={ref} content="SELECT 42;" readOnly plainText syntaxExtension={syntaxExtension}
      accessibleLabel="只读附件文本" onChange={onChange} onSave={onSave} />)
    expect(EditorView.findFromDOM(editor)).toBe(view)
    expect(view.state.selection.main.to).toBe(6)
    expect(document.querySelector('.cm-search input[name="search"]')).toBe(search)
    expect(search.value).toBe('42')
    expect(ref.current?.getCurrentDoc()).toBe('SELECT 42;')
    expect(view.state.readOnly).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
  it('可通过窄handle打开和分层关闭查找，不改变只读正文', () => {
    const ref = createRef<MarkdownEditorPaneHandle>()
    render(<MarkdownEditorPane ref={ref} content='中文 原始记录' readOnly plainText accessibleLabel="只读附件文本" onChange={vi.fn()} onSave={vi.fn()} />)
    act(() => ref.current?.openSearch())
    expect(document.querySelector('.cm-search input[name="search"]')).toBeInTheDocument()
    act(() => expect(ref.current?.closeSearch()).toBe(true))
    expect(document.querySelector('.cm-search')).toBeNull()
    act(() => expect(ref.current?.closeSearch()).toBe(false))
    expect(ref.current?.getCurrentDoc()).toBe('中文 原始记录')
  })
})
