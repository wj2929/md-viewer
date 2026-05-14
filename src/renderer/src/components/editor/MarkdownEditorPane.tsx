import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate, keymap } from '@codemirror/view'
import type { QuickEditTarget } from '../../utils/quickEditTarget'
import { DEFAULT_TOP_RATIO, getScrollRatio } from '../../utils/scrollSyncAnchors'
import { applyMarkdownFormat, type MarkdownFormatCommand } from './markdownFormatCommands'
import { createMarkdownEditorExtensions } from './markdownEditorExtensions'
import './MarkdownEditorPane.css'

interface ScrollToLineOptions {
  focus?: boolean
  select?: boolean
  y?: 'start' | 'end' | 'center' | 'nearest'
}

export interface MarkdownEditorPaneHandle {
  getCurrentDoc: () => string
  replaceDocument: (content: string) => void
  focus: () => void
  getScroller: () => HTMLElement | null
  getVisibleLine: (topRatio?: number) => number
  scrollToLine: (lineNumber: number, options?: ScrollToLineOptions) => boolean
  applyFormat: (command: MarkdownFormatCommand) => void
}

interface MarkdownEditorPaneProps {
  content: string
  readOnly: boolean
  target?: QuickEditTarget | null
  onChange: (content: string) => void
  onSave: (content: string) => void
  onLocateComplete?: (located: boolean) => void
}

function lineFromTarget(content: string, target?: QuickEditTarget | null): number | null {
  if (!target) return null
  if (typeof target.sourceLine === 'number') return target.sourceLine
  if (typeof target.targetLine === 'number') return target.targetLine

  const lines = content.split('\n')
  if (target.targetText) {
    const preferredLine = target.sourceLine || target.targetLine
    const searchStart = preferredLine ? Math.max(0, preferredLine - 6) : 0
    const searchEnd = preferredLine ? Math.min(lines.length, preferredLine + 5) : lines.length
    const nearbyIndex = lines
      .slice(searchStart, searchEnd)
      .findIndex(line => line.includes(target.targetText || ''))
    if (nearbyIndex >= 0) return searchStart + nearbyIndex + 1

    const fallbackIndex = lines.findIndex(line => line.includes(target.targetText || ''))
    if (fallbackIndex >= 0) return fallbackIndex + 1
  }

  if (typeof target.scrollRatio === 'number') {
    return Math.max(1, Math.round(lines.length * target.scrollRatio))
  }

  return null
}

export const MarkdownEditorPane = forwardRef<MarkdownEditorPaneHandle, MarkdownEditorPaneProps>(function MarkdownEditorPane(
  { content, readOnly, target = null, onChange, onSave, onLocateComplete },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editableCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const suppressChangeRef = useRef(false)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const getVisibleLine = (topRatio = DEFAULT_TOP_RATIO): number => {
    const view = viewRef.current
    if (!view) return 1

    const scroller = view.scrollDOM
    try {
      const block = view.lineBlockAtHeight(scroller.scrollTop + scroller.clientHeight * topRatio)
      return view.state.doc.lineAt(block.from).number
    } catch {
      const ratio = getScrollRatio(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight)
      return Math.max(1, Math.min(view.state.doc.lines, Math.round(1 + ratio * Math.max(0, view.state.doc.lines - 1))))
    }
  }

  const scrollToLine = (lineNumber: number, options: ScrollToLineOptions = {}): boolean => {
    const view = viewRef.current
    if (!view) return false
    const boundedLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines))
    const line = view.state.doc.line(boundedLine)
    const canMeasureTextRange = typeof document.createRange().getClientRects === 'function'
    view.dispatch({
      ...(options.select === false ? {} : { selection: { anchor: line.from } }),
      effects: canMeasureTextRange ? EditorView.scrollIntoView(line.from, { y: options.y ?? 'center' }) : [],
    })
    if (options.focus !== false) view.focus()
    return true
  }

  useImperativeHandle(ref, () => ({
    getCurrentDoc: () => viewRef.current?.state.doc.toString() ?? content,
    replaceDocument: (nextContent: string) => {
      const view = viewRef.current
      if (!view) return
      suppressChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextContent },
      })
      suppressChangeRef.current = false
    },
    focus: () => viewRef.current?.focus(),
    getScroller: () => viewRef.current?.scrollDOM ?? null,
    getVisibleLine,
    scrollToLine,
    applyFormat: (command: MarkdownFormatCommand) => {
      const view = viewRef.current
      if (!view) return
      applyMarkdownFormat(view, command)
    },
  }), [content])

  useEffect(() => {
    if (!hostRef.current) return

    const editableCompartment = editableCompartmentRef.current
    const readOnlyCompartment = readOnlyCompartmentRef.current
    const saveKey = keymap.of([{
      key: 'Mod-s',
      preventDefault: true,
      run: (view) => {
        onSaveRef.current(view.state.doc.toString())
        return true
      },
    }])
    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged && !suppressChangeRef.current) onChangeRef.current(update.state.doc.toString())
    })

    const state = EditorState.create({
      doc: content,
      extensions: createMarkdownEditorExtensions([
        saveKey,
        updateListener,
        editableCompartment.of(EditorView.editable.of(!readOnly)),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      ]),
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)),
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentContent = view.state.doc.toString()
    if (currentContent === content) return
    suppressChangeRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
    suppressChangeRef.current = false
  }, [content])

  useEffect(() => {
    if (!target) return
    const timer = window.setTimeout(() => {
      const line = lineFromTarget(viewRef.current?.state.doc.toString() ?? content, target)
      onLocateComplete?.(line ? scrollToLine(line) : false)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [content, onLocateComplete, target])

  return (
    <div
      ref={hostRef}
      className={`markdown-editor-pane ${readOnly ? 'readonly' : ''}`}
      role="textbox"
      aria-label="Markdown 源码编辑区"
    />
  )
})
