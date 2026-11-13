import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { EditorView } from '@codemirror/view'
import { MarkdownEditorPane, type MarkdownEditorPaneHandle } from '../../src/components/editor/MarkdownEditorPane'

class SearchWorker {
  static instances: SearchWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { SearchWorker.instances.push(this) }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}

const filler = ('x'.repeat(63) + '\n').repeat(8192)
const source = 'first second\n' + filler

function mount(content = source) {
  const ref = createRef<MarkdownEditorPaneHandle>()
  const props = { ref, content, readOnly: true, plainText: true, onChange: vi.fn(), onSave: vi.fn() }
  const result = render(<MarkdownEditorPane {...props} />)
  act(() => ref.current?.openSearch())
  const input = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]')!
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
  return { ...result, input, view, props, ref }
}

function find(input: HTMLInputElement, query: string) {
  fireEvent.input(input, { target: { value: query } })
  fireEvent.keyDown(input, { key: 'Enter' })
  return SearchWorker.instances.at(-1)!
}

describe('read-only attachment asynchronous search panel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    SearchWorker.instances = []
    vi.stubGlobal('Worker', SearchWorker)
    if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('keeps the complete text read-only and selects a worker result', () => {
    const { input, view, ref } = mount()
    expect(input).toHaveFocus()
    const worker = find(input, 'second')
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ content: source, backward: false }))
    act(() => worker.respond({ from: 6, to: 12 }))
    expect(view.state.selection.main.from).toBe(6)
    expect(view.state.selection.main.to).toBe(12)
    expect(view.state.readOnly).toBe(true)
    expect(ref.current?.getCurrentDoc()).toBe(source)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('keeps small attachments on the existing low-overhead CodeMirror path', () => {
    const { input, view } = mount('first second')
    find(input, 'second')
    expect(SearchWorker.instances).toHaveLength(0)
    expect(view.state.selection.main.from).toBe(6)
    expect(view.state.selection.main.to).toBe(12)
  })

  it('terminates superseded searches and ignores their late replies', () => {
    const { input, view } = mount()
    const old = find(input, 'first')
    const current = find(input, 'second')
    expect(old.terminate).toHaveBeenCalledOnce()
    act(() => old.respond({ from: 0, to: 5 }))
    expect(view.state.selection.main.empty).toBe(true)
    act(() => current.respond({ from: 6, to: 12 }))
    expect(view.state.selection.main.from).toBe(6)
  })

  it('does not override a newer manual selection with a late result', () => {
    const { input, view } = mount()
    const worker = find(input, 'second')
    act(() => view.dispatch({ selection: { anchor: 1, head: 3 } }))
    expect(worker.terminate).toHaveBeenCalledOnce()
    act(() => worker.respond({ from: 6, to: 12 }))
    expect(view.state.selection.main.from).toBe(1)
    expect(view.state.selection.main.to).toBe(3)
  })

  it('cancels on document changes, closing the panel and unmounting', () => {
    const { input, view, rerender, props, ref, unmount } = mount()
    const old = find(input, 'second')
    rerender(<MarkdownEditorPane {...props} content={'replacement\n' + filler} />)
    expect(old.terminate).toHaveBeenCalledOnce()
    act(() => old.respond({ from: 6, to: 12 }))
    expect(view.state.selection.main.empty).toBe(true)
    const closing = find(input, 'replacement')
    act(() => ref.current?.closeSearch())
    expect(closing.terminate).toHaveBeenCalledOnce()
    act(() => ref.current?.openSearch())
    const active = find(document.querySelector('.cm-search input[name="search"]')!, 'replacement')
    unmount()
    expect(active.terminate).toHaveBeenCalledOnce()
  })

  it('stops a timed out expression without falling back to synchronous scanning', () => {
    const { input, view } = mount()
    const worker = find(input, 'second')
    act(() => vi.advanceTimersByTime(30_000))
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(document.querySelector('.cm-search [role="status"]')).toHaveTextContent('查找超时')
    act(() => worker.respond({ from: 6, to: 12 }))
    expect(view.state.selection.main.empty).toBe(true)
  })
})
