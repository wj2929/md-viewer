import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildScrollMap,
  clampScrollTop,
  collectPreviewAnchors,
  COMPOSITION_RESUME_DELAY_MS,
  DEFAULT_TOP_RATIO,
  findNearestAnchor,
  findNearestLineByTop,
  getScrollRatio,
  shouldSkipSmallScroll,
  SYNC_IGNORE_MS,
  type ScrollMapMode,
} from '../utils/scrollSyncAnchors'

export type ScrollSyncStatus = 'idle' | 'precise' | 'approximate' | 'paused' | 'unavailable'
type ScrollSyncSource = 'editor' | 'preview'

interface UseQuickEditScrollSyncOptions {
  enabled: boolean
  placementKey: string
  canonicalPath: string
  drawerInstanceId: string
  previewElement: HTMLElement | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  content: string
}

interface UseQuickEditScrollSyncResult {
  status: ScrollSyncStatus
}

function getLineCount(content: string): number {
  return Math.max(1, content.split('\n').length)
}

function estimateEditorLine(textarea: HTMLTextAreaElement, totalLines: number): number {
  const maxScrollTop = Math.max(1, textarea.scrollHeight - textarea.clientHeight)
  const ratio = textarea.scrollTop / maxScrollTop
  return Math.max(1, Math.min(totalLines, Math.round(1 + ratio * Math.max(0, totalLines - 1))))
}

function getEditorTopForLine(textarea: HTMLTextAreaElement, sourceLine: number, totalLines: number): number {
  const ratio = Math.max(0, Math.min(1, (sourceLine - 1) / Math.max(1, totalLines - 1)))
  return clampScrollTop(ratio * Math.max(0, textarea.scrollHeight - textarea.clientHeight), textarea.scrollHeight, textarea.clientHeight)
}

function mapModeToStatus(mode: ScrollMapMode): ScrollSyncStatus {
  if (mode === 'precise') return 'precise'
  if (mode === 'approximate') return 'approximate'
  return 'approximate'
}

export function useQuickEditScrollSync({
  enabled,
  placementKey,
  canonicalPath,
  drawerInstanceId,
  previewElement,
  textareaRef,
  content,
}: UseQuickEditScrollSyncOptions): UseQuickEditScrollSyncResult {
  const [status, setStatus] = useState<ScrollSyncStatus>('idle')
  const frameRef = useRef<number | null>(null)
  const syncSourceRef = useRef<ScrollSyncSource | null>(null)
  const syncTokenRef = useRef(0)
  const ignoreUntilRef = useRef(0)
  const composingRef = useRef(false)
  const resumePreviewToEditorAtRef = useRef(0)
  const observerCleanupRef = useRef<(() => void) | null>(null)
  const totalLines = useMemo(() => getLineCount(content), [content])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
    }
  }, [enabled])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!enabled || !previewElement || !textarea || totalLines <= 0) {
      setStatus(enabled ? 'unavailable' : 'idle')
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
    previewElement.querySelectorAll('[data-source-line], img').forEach(element => {
      resizeObserver?.observe(element)
    })

    observerCleanupRef.current = () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer)
    }

    const runWithToken = (source: ScrollSyncSource, callback: () => void) => {
      const now = performance.now()
      if (syncSourceRef.current && syncSourceRef.current !== source && now < ignoreUntilRef.current) {
        return
      }

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
      const line = estimateEditorLine(textarea, totalLines)
      const anchor = findNearestAnchor(collectPreviewAnchors(previewElement), line)
      const mappedTop = scrollMap.lineToTop[line] ?? anchor?.offsetTop
      const targetTop = typeof mappedTop === 'number'
        ? mappedTop - previewElement.clientHeight * DEFAULT_TOP_RATIO
        : getScrollRatio(textarea.scrollTop, textarea.scrollHeight, textarea.clientHeight) *
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

      const probeTop = previewElement.scrollTop + previewElement.clientHeight / 2
      const sourceLine = scrollMap.mode === 'ratio'
        ? Math.max(1, Math.round(totalLines * getScrollRatio(previewElement.scrollTop, previewElement.scrollHeight, previewElement.clientHeight)))
        : findNearestLineByTop(scrollMap.lineToTop, probeTop)
      const nextTop = getEditorTopForLine(textarea, sourceLine, totalLines)
      if (shouldSkipSmallScroll(textarea.scrollTop, nextTop, textarea.clientHeight)) return
      textarea.scrollTop = nextTop
      setStatus(mapModeToStatus(scrollMap.mode))
    }

    const handleEditorScroll = () => {
      runWithToken('editor', scrollPreviewFromEditor)
    }

    const handlePreviewScroll = () => {
      runWithToken('preview', scrollEditorFromPreview)
    }

    const handleCompositionStart = () => {
      composingRef.current = true
      setStatus('paused')
    }

    const handleCompositionEnd = () => {
      composingRef.current = false
      resumePreviewToEditorAtRef.current = performance.now() + COMPOSITION_RESUME_DELAY_MS
      window.setTimeout(() => {
        if (!composingRef.current && active) setStatus(mapModeToStatus(scrollMap.mode))
      }, COMPOSITION_RESUME_DELAY_MS)
    }

    const handleInput = () => {
      resumePreviewToEditorAtRef.current = performance.now() + COMPOSITION_RESUME_DELAY_MS
    }

    textarea.addEventListener('scroll', handleEditorScroll)
    textarea.addEventListener('compositionstart', handleCompositionStart)
    textarea.addEventListener('compositionend', handleCompositionEnd)
    textarea.addEventListener('input', handleInput)
    previewElement.addEventListener('scroll', handlePreviewScroll)

    return () => {
      active = false
      clearFrame()
      observerCleanupRef.current?.()
      observerCleanupRef.current = null
      textarea.removeEventListener('scroll', handleEditorScroll)
      textarea.removeEventListener('compositionstart', handleCompositionStart)
      textarea.removeEventListener('compositionend', handleCompositionEnd)
      textarea.removeEventListener('input', handleInput)
      previewElement.removeEventListener('scroll', handlePreviewScroll)
      syncSourceRef.current = null
      syncTokenRef.current = 0
    }
  }, [canonicalPath, drawerInstanceId, enabled, placementKey, previewElement, textareaRef, totalLines])

  return { status }
}
