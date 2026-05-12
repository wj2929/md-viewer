import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { basicSetup } from 'codemirror'
import type { QuickEditTarget } from '../../utils/quickEditTarget'
import './MarkdownEditorPane.css'

export interface MarkdownEditorPaneHandle {
  getCurrentDoc: () => string
  replaceDocument: (content: string) => void
  focus: () => void
  scrollToLine: (lineNumber: number) => boolean
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

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const scrollToLine = (lineNumber: number): boolean => {
    const view = viewRef.current
    if (!view) return false
    const boundedLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines))
    const line = view.state.doc.line(boundedLine)
    const canMeasureTextRange = typeof document.createRange().getClientRects === 'function'
    view.dispatch({
      selection: { anchor: line.from },
      effects: canMeasureTextRange ? EditorView.scrollIntoView(line.from, { y: 'center' }) : [],
    })
    view.focus()
    return true
  }

  useImperativeHandle(ref, () => ({
    getCurrentDoc: () => viewRef.current?.state.doc.toString() ?? content,
    replaceDocument: (nextContent: string) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextContent },
      })
    },
    focus: () => viewRef.current?.focus(),
    scrollToLine,
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
      if (update.docChanged) onChangeRef.current(update.state.doc.toString())
    })

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        history(),
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        saveKey,
        updateListener,
        editableCompartment.of(EditorView.editable.of(!readOnly)),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      ],
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
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
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
