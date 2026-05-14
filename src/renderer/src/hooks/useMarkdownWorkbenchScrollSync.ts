import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentViewMode } from '../stores/documentViewModeStore'
import type { MarkdownEditorPaneHandle } from '../components/editor/MarkdownEditorPane'
import {
  buildScrollMap,
  clampScrollTop,
  collectPreviewAnchors,
  COMPOSITION_RESUME_DELAY_MS,
  findNearestLineByTop,
  getScrollRatio,
  shouldSkipSmallScroll,
  SYNC_IGNORE_MS,
  type ScrollMapMode,
} from '../utils/scrollSyncAnchors'

export type WorkbenchScrollSyncStatus = 'idle' | 'precise' | 'approximate' | 'paused' | 'unavailable'
type ScrollSyncSource = 'editor' | 'preview'

const TOP_EDGE_RATIO = 0

interface UseMarkdownWorkbenchScrollSyncOptions {
  enabled: boolean
  mode: DocumentViewMode
  previewElement: HTMLElement | null
  editorRef: RefObject<MarkdownEditorPaneHandle | null>
  content: string
}

function getLineCount(content: string): number {
  return Math.max(1, content.split('\n').length)
}

function mapModeToStatus(mode: ScrollMapMode): WorkbenchScrollSyncStatus {
  if (mode === 'precise') return 'precise'
  if (mode === 'approximate') return 'approximate'
  return 'approximate'
}

function getRatioLine(totalLines: number, scrollTop: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(1, Math.round(1 + getScrollRatio(scrollTop, scrollHeight, clientHeight) * Math.max(0, totalLines - 1)))
}

export function useMarkdownWorkbenchScrollSync({
  enabled,
  mode,
  previewElement,
  editorRef,
  content,
}: UseMarkdownWorkbenchScrollSyncOptions): { status: WorkbenchScrollSyncStatus } {
  const [status, setStatus] = useState<WorkbenchScrollSyncStatus>('idle')
  const frameRef = useRef<number | null>(null)
  const syncSourceRef = useRef<ScrollSyncSource | null>(null)
  const syncTokenRef = useRef(0)
  const ignoreUntilRef = useRef(0)
  const composingRef = useRef(false)
  const resumePreviewToEditorAtRef = useRef(0)
  const totalLines = useMemo(() => getLineCount(content), [content])

  useEffect(() => {
    if (!enabled || mode !== 'compare') setStatus('idle')
  }, [enabled, mode])

  useEffect(() => {
    const editor = editorRef.current
    const editorScroller = editor?.getScroller() ?? null
    if (!enabled || mode !== 'compare' || !previewElement || !editor || !editorScroller) {
      setStatus(enabled && mode === 'compare' ? 'unavailable' : 'idle')
      return
    }

    let active = true
    let rebuildTimer: number | null = null
    const buildMap = () => buildScrollMap({
      totalLines,
      scrollHeight: previewElement.scrollHeight,
      anchors: collectPreviewAnchors(previewElement),
    })
    let scrollMap = buildMap()
    setStatus(mapModeToStatus(scrollMap.mode))

    const clearFrame = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    const scheduleRebuild = () => {
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer)
      rebuildTimer = window.setTimeout(() => {
        if (!active) return
        scrollMap = buildMap()
        setStatus(mapModeToStatus(scrollMap.mode))
      }, 100)
    }

    const mutationObserver = new MutationObserver(scheduleRebuild)
    mutationObserver.observe(previewElement, { childList: true, subtree: true })

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleRebuild)
      : null
    resizeObserver?.observe(previewElement)
    resizeObserver?.observe(editorScroller)
    previewElement.querySelectorAll('[data-source-line], img').forEach(element => {
      resizeObserver?.observe(element)
    })

    const runWithToken = (source: ScrollSyncSource, callback: () => void) => {
      const now = performance.now()
      if (syncSourceRef.current && syncSourceRef.current !== source && now < ignoreUntilRef.current) return

      const token = syncTokenRef.current + 1
      syncTokenRef.current = token
      syncSourceRef.current = source
      ignoreUntilRef.current = now + SYNC_IGNORE_MS

      clearFrame()
      frameRef.current = requestAnimationFrame(() => {
        if (!active || syncTokenRef.current !== token) return
        callback()
        window.setTimeout(() => {
          if (syncTokenRef.current === token && performance.now() >= ignoreUntilRef.current) {
            syncSourceRef.current = null
            syncTokenRef.current = 0
          }
        }, SYNC_IGNORE_MS + 20)
      })
    }

    const scrollPreviewFromEditor = () => {
      const line = editor.getVisibleLine(TOP_EDGE_RATIO)
      const mappedTop = scrollMap.lineToTop[line]
      const targetTop = typeof mappedTop === 'number' && mappedTop >= 0
        ? mappedTop
        : getScrollRatio(editorScroller.scrollTop, editorScroller.scrollHeight, editorScroller.clientHeight) *
          Math.max(0, previewElement.scrollHeight - previewElement.clientHeight)
      const nextTop = clampScrollTop(targetTop, previewElement.scrollHeight, previewElement.clientHeight)
      if (shouldSkipSmallScroll(previewElement.scrollTop, nextTop, previewElement.clientHeight)) return
      previewElement.scrollTop = nextTop
      setStatus(mapModeToStatus(scrollMap.mode))
    }

    const scrollEditorFromPreview = () => {
      const now = performance.now()
      if (composingRef.current || now < resumePreviewToEditorAtRef.current) {
        setStatus('paused')
        return
      }

      const probeTop = previewElement.scrollTop + previewElement.clientHeight * TOP_EDGE_RATIO
      const sourceLine = scrollMap.mode === 'ratio'
        ? getRatioLine(totalLines, previewElement.scrollTop, previewElement.scrollHeight, previewElement.clientHeight)
        : findNearestLineByTop(scrollMap.lineToTop, probeTop)
      editor.scrollToLine(sourceLine, { focus: false, select: false, y: 'start' })
      setStatus(mapModeToStatus(scrollMap.mode))
    }

    const pauseReverseSync = () => {
      resumePreviewToEditorAtRef.current = performance.now() + COMPOSITION_RESUME_DELAY_MS
    }
    const handleCompositionStart = () => {
      composingRef.current = true
      setStatus('paused')
    }
    const handleCompositionEnd = () => {
      composingRef.current = false
      pauseReverseSync()
      window.setTimeout(() => {
        if (!composingRef.current && active) setStatus(mapModeToStatus(scrollMap.mode))
      }, COMPOSITION_RESUME_DELAY_MS)
    }

    const editorContent = editorScroller.querySelector('.cm-content')
    const handleEditorScroll = () => runWithToken('editor', scrollPreviewFromEditor)
    const handlePreviewScroll = () => runWithToken('preview', scrollEditorFromPreview)

    editorScroller.addEventListener('scroll', handleEditorScroll)
    previewElement.addEventListener('scroll', handlePreviewScroll)
    editorContent?.addEventListener('compositionstart', handleCompositionStart)
    editorContent?.addEventListener('compositionend', handleCompositionEnd)
    editorContent?.addEventListener('input', pauseReverseSync)
    previewElement.addEventListener('compositionstart', handleCompositionStart)
    previewElement.addEventListener('compositionend', handleCompositionEnd)
    previewElement.addEventListener('input', pauseReverseSync)

    return () => {
      active = false
      clearFrame()
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer)
      editorScroller.removeEventListener('scroll', handleEditorScroll)
      previewElement.removeEventListener('scroll', handlePreviewScroll)
      editorContent?.removeEventListener('compositionstart', handleCompositionStart)
      editorContent?.removeEventListener('compositionend', handleCompositionEnd)
      editorContent?.removeEventListener('input', pauseReverseSync)
      previewElement.removeEventListener('compositionstart', handleCompositionStart)
      previewElement.removeEventListener('compositionend', handleCompositionEnd)
      previewElement.removeEventListener('input', pauseReverseSync)
      syncSourceRef.current = null
      syncTokenRef.current = 0
    }
  }, [content, editorRef, enabled, mode, previewElement, totalLines])

  return { status }
}
