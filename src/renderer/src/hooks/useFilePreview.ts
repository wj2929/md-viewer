import { useState, useRef, useCallback, useEffect } from 'react'
import { extractFilePreview } from '../utils/filePreviewSummary'

interface TooltipProps {
  visible: boolean
  content: string
  fileName: string
  filePath: string
  position: { x: number; y: number }
}

const TOOLTIP_W = 320
const TOOLTIP_H = 340
const GAP = 8
const DELAY_MS = 500
const MAX_CACHE = 100

function calcPosition(rect: DOMRect): { x: number; y: number } {
  const tooltipHeight = Math.min(TOOLTIP_H, Math.max(0, window.innerHeight - GAP * 2))
  let x = rect.right + GAP
  let y = rect.top
  if (x + TOOLTIP_W > window.innerWidth) x = rect.left - TOOLTIP_W - GAP
  if (y + tooltipHeight > window.innerHeight - GAP) y = window.innerHeight - tooltipHeight - GAP
  return { x: Math.max(GAP, x), y: Math.max(GAP, y) }
}

export function useFilePreview() {
  const [tooltipProps, setTooltipProps] = useState<TooltipProps>({
    visible: false, content: '', fileName: '', filePath: '', position: { x: 0, y: 0 }
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentPathRef = useRef<string | null>(null)
  const cache = useRef(new Map<string, string>())

  const setCache = useCallback((key: string, value: string) => {
    if (cache.current.size >= MAX_CACHE) {
      const firstKey = cache.current.keys().next().value
      if (firstKey !== undefined) cache.current.delete(firstKey)
    }
    cache.current.set(key, value)
  }, [])

  const handleMouseEnter = useCallback((filePath: string, event: React.MouseEvent) => {
    // 只对 .md 文件生效
    if (!filePath.endsWith('.md')) return

    if (timerRef.current) clearTimeout(timerRef.current)
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    currentPathRef.current = filePath

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const fileName = filePath.split('/').pop() || filePath

    timerRef.current = setTimeout(async () => {
      if (currentPathRef.current !== filePath) return

      const pos = calcPosition(rect)

      // 缓存命中
      if (cache.current.has(filePath)) {
        setTooltipProps({ visible: true, content: cache.current.get(filePath)!, fileName, filePath, position: pos })
        return
      }

      // IPC 读取
      try {
        const raw = await window.api.readFilePreview(filePath)
        if (currentPathRef.current !== filePath) return // 竞态保护
        const content = raw ? extractFilePreview(raw) : '（空文件）'
        setCache(filePath, content)
        setTooltipProps({ visible: true, content, fileName, filePath, position: pos })
      } catch {
        if (currentPathRef.current !== filePath) return
        setTooltipProps({ visible: true, content: '无法预览此文件', fileName, filePath, position: pos })
      }
    }, DELAY_MS)
  }, [setCache])

  const hideNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    currentPathRef.current = null
    setTooltipProps(prev => prev.visible ? { ...prev, visible: false } : prev)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    hideTimerRef.current = setTimeout(hideNow, 140)
  }, [hideNow])

  const handleTooltipMouseEnter = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const handleTooltipMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(hideNow, 140)
  }, [hideNow])

  // 全局 mousedown：点击任何地方立即隐藏 tooltip
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('.file-preview-tooltip')) return
      hideNow()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [hideNow])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  return {
    tooltipProps,
    handleMouseEnter,
    handleMouseLeave,
    handleTooltipMouseEnter,
    handleTooltipMouseLeave,
    hideTooltip: hideNow,
  }
}
