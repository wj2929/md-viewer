import { EditorSelection, EditorState } from '@codemirror/state'
import { history, redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { insertMarkdownTemplate, type MarkdownInsertionTemplate } from '../../src/components/editor/markdownFormatCommands'

const blockTemplate: MarkdownInsertionTemplate = {
  prefix: '```mermaid\n',
  body: 'flowchart LR\n  A --> B',
  suffix: '\n```',
  block: true,
}

const views: EditorView[] = []

function createView(doc: string, anchor: number, head = anchor): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [history()],
    }),
  })
  views.push(view)
  return view
}

function selectedText(view: EditorView): string {
  const selection = view.state.selection.main
  return view.state.sliceDoc(selection.from, selection.to)
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('insertMarkdownTemplate', () => {
  it('inserts a block template into an empty document and selects its body', () => {
    const view = createView('', 0)

    insertMarkdownTemplate(view, blockTemplate)

    expect(view.state.doc.toString()).toBe('```mermaid\nflowchart LR\n  A --> B\n```')
    expect(selectedText(view)).toBe(blockTemplate.body)
  })

  it.each([
    ['start', '正文', 0, '```mermaid\nflowchart LR\n  A --> B\n```\n\n正文'],
    ['middle', '前半后半', 2, '前半\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n后半'],
    ['end', '正文', 2, '正文\n\n```mermaid\nflowchart LR\n  A --> B\n```'],
    ['after one newline', '正文\n', 3, '正文\n\n```mermaid\nflowchart LR\n  A --> B\n```'],
    ['after paragraph gap', '正文\n\n', 4, '正文\n\n```mermaid\nflowchart LR\n  A --> B\n```'],
  ])('adds only necessary block boundaries at the %s', (_label, doc, cursor, expected) => {
    const view = createView(doc, cursor)

    insertMarkdownTemplate(view, blockTemplate)

    expect(view.state.doc.toString()).toBe(expected)
    expect(selectedText(view)).toBe(blockTemplate.body)
  })

  it('uses a non-empty selection as the body without losing surrounding text', () => {
    const doc = 'before\nchosen\nafter'
    const view = createView(doc, 7, 13)

    insertMarkdownTemplate(view, blockTemplate)

    expect(view.state.doc.toString()).toBe('before\n\n```mermaid\nchosen\n```\n\nafter')
    expect(selectedText(view)).toBe('chosen')
  })

  it('keeps inline templates inline', () => {
    const view = createView('公式：。', 3)

    insertMarkdownTemplate(view, {
      prefix: '$',
      body: 'E = mc^2',
      suffix: '$',
      block: false,
    })

    expect(view.state.doc.toString()).toBe('公式：$E = mc^2$。')
    expect(selectedText(view)).toBe('E = mc^2')
  })

  it('records the whole insertion as one undo and redo step', () => {
    const view = createView('正文', 2)

    insertMarkdownTemplate(view, blockTemplate)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('正文')
    expect(undo(view)).toBe(false)
    expect(redo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('正文\n\n```mermaid\nflowchart LR\n  A --> B\n```')
  })
})
