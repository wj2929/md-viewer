import { useState, useRef, useCallback, useEffect } from 'react'

interface TooltipProps {
  visible: boolean
  content: string
  fileName: string
  position: { x: number; y: number }
}

const TOOLTIP_W = 320
const TOOLTIP_H = 300
const GAP = 8
const DELAY_MS = 500
const MAX_CACHE = 100

function calcPosition(rect: DOMRect): { x: number; y: number } {
  let x = rect.right + GAP
  let y = rect.top
  if (x + TOOLTIP_W > window.innerWidth) x = rect.left - TOOLTIP_W - GAP
  if (y + TOOLTIP_H > window.innerHeight) y = window.innerHeight - TOOLTIP_H - GAP
  return { x: Math.max(0, x), y: Math.max(0, y) }
}

function extractPreview(raw: string): string {
  const cleaned = raw.split('\n')
    .map(l => {
      return l
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^\s*[-*+]\s+/, '• ')
        .replace(/^\s*\d+\.\s+/, '')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/^>\s*/, '│ ')
    })
    .join('\n')
    // 合并连续空行为单个空行
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned.length > 500 ? cleaned.slice(0, 500) + '…' : cleaned
}

export function useFilePreview() {
  const [tooltipProps, setTooltipProps] = useState<TooltipProps>({
    visible: false, content: '', fileName: '', position: { x: 0, y: 0 }
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    currentPathRef.current = filePath

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const fileName = filePath.split('/').pop() || filePath

    timerRef.current = setTimeout(async () => {
      if (currentPathRef.current !== filePath) return

      const pos = calcPosition(rect)

      // 缓存命中
      if (cache.current.has(filePath)) {
        setTooltipProps({ visible: true, content: cache.current.get(filePath)!, fileName, position: pos })
        return
      }

      // IPC 读取
      try {
        const raw = await window.api.readFilePreview(filePath)
        if (currentPathRef.current !== filePath) return // 竞态保护
        const content = raw ? extractPreview(raw) : '（空文件）'
        setCache(filePath, content)
        setTooltipProps({ visible: true, content, fileName, position: pos })
      } catch {
        if (currentPathRef.current !== filePath) return
        setTooltipProps({ visible: true, content: '无法预览此文件', fileName, position: pos })
      }
    }, DELAY_MS)
  }, [setCache])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    currentPathRef.current = null
    setTooltipProps(prev => prev.visible ? { ...prev, visible: false } : prev)
  }, [])

  // 全局 mousedown：点击任何地方立即隐藏 tooltip
  useEffect(() => {
    const onMouseDown = () => handleMouseLeave()
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [handleMouseLeave])

  return { tooltipProps, handleMouseEnter, handleMouseLeave }
}
