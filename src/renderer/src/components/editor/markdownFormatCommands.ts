import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type MarkdownFormatCommand =
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'link'
  | 'heading'
  | 'quote'
  | 'bulletList'
  | 'codeBlock'

function wrapSelection(view: EditorView, before: string, after = before, placeholder = '文本'): void {
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to)
  const body = selected || placeholder
  const insert = `${before}${body}${after}`
  const anchor = selection.from + before.length
  const head = anchor + body.length

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

function prefixSelectedLines(view: EditorView, prefix: string): void {
  const selection = view.state.selection.main
  const fromLine = view.state.doc.lineAt(selection.from)
  const toLine = view.state.doc.lineAt(selection.to)
  const changes: ChangeSpec[] = []

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    changes.push({ from: line.from, insert: prefix })
  }

  view.dispatch({
    changes,
    selection: {
      anchor: selection.from + prefix.length,
      head: selection.to + prefix.length * changes.length,
    },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

function wrapCodeBlock(view: EditorView): void {
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to)
  const body = selected || 'code'
  const trailingNewline = body.endsWith('\n') ? '' : '\n'
  const insert = `\`\`\`\n${body}${trailingNewline}\`\`\``
  const anchor = selection.from + 4
  const head = anchor + body.length

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

export interface MarkdownInsertionTemplate {
  prefix: string
  body: string
  suffix: string
  block: boolean
}

function blockBoundaryBefore(view: EditorView, from: number): string {
  if (from === 0) return ''
  const before = view.state.sliceDoc(Math.max(0, from - 2), from)
  if (before.endsWith('\n\n')) return ''
  return before.endsWith('\n') ? '\n' : '\n\n'
}

function blockBoundaryAfter(view: EditorView, to: number): string {
  if (to === view.state.doc.length) return ''
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2))
  if (after.startsWith('\n\n')) return ''
  return after.startsWith('\n') ? '\n' : '\n\n'
}

export function insertMarkdownTemplate(view: EditorView, template: MarkdownInsertionTemplate): void {
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to)
  const body = selected || template.body
  const leading = template.block ? blockBoundaryBefore(view, selection.from) : ''
  const trailing = template.block ? blockBoundaryAfter(view, selection.to) : ''
  const insert = `${leading}${template.prefix}${body}${template.suffix}${trailing}`
  const anchor = selection.from + leading.length + template.prefix.length
  const head = anchor + body.length

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

export function applyMarkdownFormat(view: EditorView, command: MarkdownFormatCommand): void {
  switch (command) {
    case 'bold':
      wrapSelection(view, '**')
      break
    case 'italic':
      wrapSelection(view, '*')
      break
    case 'inlineCode':
      wrapSelection(view, '`')
      break
    case 'link':
      wrapSelection(view, '[', '](https://example.com)', '链接文本')
      break
    case 'heading':
      prefixSelectedLines(view, '## ')
      break
    case 'quote':
      prefixSelectedLines(view, '> ')
      break
    case 'bulletList':
      prefixSelectedLines(view, '- ')
      break
    case 'codeBlock':
      wrapCodeBlock(view)
      break
  }
}
