import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from '../../src/components/editor/MarkdownEditorPane'

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
