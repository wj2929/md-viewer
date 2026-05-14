import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from '../../src/components/editor/MarkdownEditorPane'
import type { MarkdownFormatCommand } from '../../src/components/editor'

describe('MarkdownEditorPane', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    if (!document.createRange().getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => [],
      })
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the current CodeMirror document through an imperative handle', () => {
    const ref = createRef<MarkdownEditorPaneHandle>()
    render(
      <MarkdownEditorPane
        ref={ref}
        content="# A"
        readOnly={false}
        target={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    )

    act(() => {
      ref.current?.replaceDocument('# B')
    })

    expect(ref.current?.getCurrentDoc()).toBe('# B')
  })

  it('exposes the CodeMirror scroller and visible source line for scroll sync', () => {
    const ref = createRef<MarkdownEditorPaneHandle>()
    render(
      <MarkdownEditorPane
        ref={ref}
        content={['# A', '', '## B'].join('\n')}
        readOnly={false}
        target={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(ref.current?.getScroller()).toBeInstanceOf(HTMLElement)
    expect(ref.current?.getVisibleLine()).toBe(1)
  })

  it('does not report programmatic content replacement as user edits', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditorPane
        content="# A"
        readOnly={false}
        target={null}
        onChange={onChange}
        onSave={vi.fn()}
      />
    )

    rerender(
      <MarkdownEditorPane
        content="# From disk"
        readOnly={false}
        target={null}
        onChange={onChange}
        onSave={vi.fn()}
      />
    )

    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['bold', '**文本**# A'],
    ['italic', '*文本*# A'],
    ['inlineCode', '`文本`# A'],
    ['link', '[链接文本](https://example.com)# A'],
    ['heading', '## # A'],
    ['quote', '> # A'],
    ['bulletList', '- # A'],
    ['codeBlock', '```\ncode\n```# A'],
  ] satisfies Array<[MarkdownFormatCommand, string]>)('applies the %s Markdown formatting command', (command, expected) => {
    const onChange = vi.fn()
    const ref = createRef<MarkdownEditorPaneHandle>()
    render(
      <MarkdownEditorPane
        ref={ref}
        content="# A"
        readOnly={false}
        target={null}
        onChange={onChange}
        onSave={vi.fn()}
      />
    )

    act(() => {
      ref.current?.applyFormat(command)
    })

    expect(ref.current?.getCurrentDoc()).toBe(expected)
    expect(onChange).toHaveBeenCalledWith(expected)
  })

  it('locates a source line target and reports completion', () => {
    const onLocateComplete = vi.fn()
    const ref = createRef<MarkdownEditorPaneHandle>()
    render(
      <MarkdownEditorPane
        ref={ref}
        content={['# A', '', 'target line'].join('\n')}
        readOnly={false}
        target={{ filePath: '/docs/a.md', tabId: 'tab-a', sourceLine: 3, mode: 'source-line' }}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onLocateComplete={onLocateComplete}
      />
    )

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(onLocateComplete).toHaveBeenCalledWith(true)
    expect(screen.getByRole('textbox', { name: 'Markdown 源码编辑区' })).toBeInTheDocument()
  })
})
