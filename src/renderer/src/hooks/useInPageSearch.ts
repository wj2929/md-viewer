/**
 * 页面内搜索 Hook
 * v1.4.0 新增功能
 *
 * 使用 mark.js 实现 Markdown 文档内的实时搜索高亮
 *
 * 特性：
 * - 排除代码块、KaTeX 公式、Mermaid 图表
 * - 限制高亮数量（默认 500 个）
 * - 自适应防抖（根据文件大小调整）
 * - 支持上一个/下一个导航
 * - 只在匹配项不可见时滚动所属预览
 */

import { useState, useEffect, useRef, RefObject, useCallback, useMemo } from 'react'
import Mark from 'mark.js'
import { useDebouncedValue } from './useDebouncedValue'
import { useSearchHistoryStore } from '../stores'

// ============================================================================
// 类型定义
// ============================================================================

export interface InPageSearchOptions {
  caseSensitive?: boolean  // v1.5.0 支持
  wholeWord?: boolean      // v1.5.0 支持
  useRegex?: boolean       // v1.5.0 支持
}

export interface InPageSearchResult {
  /** 搜索词 */
  query: string
  /** 设置搜索词 */
  setQuery: (query: string) => void
  /** 当前匹配索引（0-based） */
  currentIndex: number
  /** 总匹配数 */
  totalCount: number
  /** 跳转到下一个匹配 */
  goNext: () => void
  /** 跳转到上一个匹配 */
  goPrev: () => void
  /** 清除搜索（清空搜索词和高亮） */
  clear: () => void
  /** 是否显示搜索框 */
  isVisible: boolean
  /** 设置搜索框可见性 */
  setVisible: (visible: boolean) => void
  /** v1.4.2: 是否区分大小写 */
  caseSensitive: boolean
  /** v1.4.2: 切换大小写敏感 */
  toggleCaseSensitive: () => void
  /** 搜索历史 */
  searchHistory: string[]
  /** 选择历史项 */
  onSelectHistory: (keyword: string) => void
  /** 删除历史项 */
  onRemoveHistory: (keyword: string) => void
  /** 清空历史 */
  onClearHistory: () => void
}

// ============================================================================
// 常量配置
// ============================================================================

/** 最大高亮数量（性能保护） */
const MAX_HIGHLIGHTS = 500

/** 搜索词最大长度 */
const MAX_QUERY_LENGTH = 200

/** 大文件阈值（字符数） */
const LARGE_FILE_THRESHOLD = 5000

/** 超大文件阈值（字符数） */
const VERY_LARGE_FILE_THRESHOLD = 20000

/** mark.js 排除配置（防止破坏特殊渲染内容） */
const MARK_EXCLUDE_SELECTORS = [
  '.katex',                  // KaTeX 公式容器
  '.katex *',                // KaTeX 公式内部元素
  '.mermaid-container',      // Mermaid 图表容器
  '.mermaid-container *',    // Mermaid 图表内部元素
  '.echarts-container',      // ECharts 图表容器
  '.echarts-container *',    // ECharts 图表内部元素
  '.infographic-container',  // Infographic 信息图容器
  '.infographic-container *', // Infographic 信息图内部元素
  '.markmap-container',      // Markmap 思维导图容器
  '.markmap-container *',    // Markmap 思维导图内部元素
  '.graphviz-container',     // Graphviz 图表容器
  '.graphviz-container *',   // Graphviz 图表内部元素
  '.drawio-container',       // DrawIO 图表容器
  '.drawio-container *',     // DrawIO 图表内部元素
  '.plantuml-container',     // PlantUML 图表容器
  '.plantuml-container *'    // PlantUML 图表内部元素
]

/** v1.4.2: 大小写敏感设置存储键 */
const CASE_SENSITIVE_KEY = 'searchCaseSensitive'

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算自适应防抖延迟（根据文件大小）
 */
function getAdaptiveDelay(contentLength: number): number {
  if (contentLength < LARGE_FILE_THRESHOLD) return 150
  if (contentLength < VERY_LARGE_FILE_THRESHOLD) return 200
  return 250
}

function revealSearchMatch(mark: Element, center = false): void {
  const preview = mark.closest<HTMLElement>('.preview')
  if (!preview) { mark.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); return }
  if (preview.clientHeight === 0) return
  const viewport = preview.getBoundingClientRect()
  let top = Math.max(0, viewport.top + preview.clientTop)
  let bottom = Math.min(window.innerHeight, viewport.top + preview.clientTop + preview.clientHeight)
  // Fullscreen layouts can extend beyond the window or be clipped by a parent.
  for (let parent = preview.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
      const bounds = parent.getBoundingClientRect()
      top = Math.max(top, bounds.top + parent.clientTop)
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight)
    }
  }
  const box = preview.querySelector('.in-page-search-box')?.getBoundingClientRect()
  top = Math.max(top, box?.bottom ?? top) + 12
  bottom -= 12
  if (bottom <= top) return
  const rect = mark.getBoundingClientRect()
  const hidden = rect.top < top || rect.bottom > bottom
  const delta = !hidden ? 0 : center ? (rect.top + rect.bottom - top - bottom) / 2
    : rect.top < top ? rect.top - top : rect.bottom - bottom
  // Do not recenter visible matches or queue smooth animations during rapid navigation.
  if (delta) preview.scrollTo({ top: preview.scrollTop + delta, behavior: 'auto' })

  for (let parent = mark.parentElement; parent; parent = parent.parentElement) {
    if (parent.clientWidth > 0 && parent.scrollWidth > parent.clientWidth &&
      /^(auto|scroll)$/.test(getComputedStyle(parent).overflowX)) {
      const bounds = parent.getBoundingClientRect()
      const hit = mark.getBoundingClientRect()
      const left = bounds.left + parent.clientLeft
      const right = left + parent.clientWidth
      const dx = hit.left < left ? hit.left - left : hit.right > right ? hit.right - right : 0
      if (dx) parent.scrollTo({ left: parent.scrollLeft + dx, behavior: 'auto' })
    }
    if (parent === preview) break
  }
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * 页面内搜索 Hook
 *
 * @param containerRef - Markdown 内容容器的 ref
 * @param contentLength - 内容长度（用于自适应优化）
 * @returns InPageSearchResult - 搜索状态和操作方法
 *
 * @example
 * ```tsx
 * function MarkdownPreview({ content }: { content: string }) {
 *   const containerRef = useRef<HTMLDivElement>(null)
 *   const search = useInPageSearch(containerRef, content.length)
 *
 *   return (
 *     <div ref={containerRef}>
 *       <InPageSearchBox {...search} />
 *       <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useInPageSearch(
  containerRef: RefObject<HTMLElement | null>,
  contentLength: number = 0,
  contentKey: string = ''
): InPageSearchResult {
  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------
  const [query, setQueryRaw] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [isVisible, setVisibleRaw] = useState(false)
  // v1.4.2: 大小写敏感（默认不敏感，更符合用户习惯）
  const [caseSensitive, setCaseSensitive] = useState(() => {
    return localStorage.getItem(CASE_SENSITIVE_KEY) === 'true'
  })

  // 搜索历史
  const inPageSearchHistory = useSearchHistoryStore(s => s.inPageSearchHistory)
  const addInPageSearchHistory = useSearchHistoryStore(s => s.addInPageSearchHistory)
  const removeInPageSearchHistory = useSearchHistoryStore(s => s.removeInPageSearchHistory)
  const clearInPageSearchHistory = useSearchHistoryStore(s => s.clearInPageSearchHistory)

  // 包装 setVisible，关闭时保存历史
  const setVisible = useCallback((visible: boolean) => {
    if (!visible && query.trim()) {
      addInPageSearchHistory(query.trim())
    }
    setVisibleRaw(visible)
  }, [query, addInPageSearchHistory])

  // 选择历史项
  const onSelectHistory = useCallback((keyword: string) => {
    setQueryRaw(keyword)
  }, [])

  // 删除历史项
  const onRemoveHistory = useCallback((keyword: string) => {
    removeInPageSearchHistory(keyword)
  }, [removeInPageSearchHistory])

  // 清空历史
  const onClearHistory = useCallback(() => {
    clearInPageSearchHistory()
  }, [clearInPageSearchHistory])

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const marksRef = useRef<Element[]>([])
  const highlightCountRef = useRef(0)
  const clearHighlights = useCallback(() => {
    const parents = new Set<Node>()
    for (const mark of marksRef.current) {
      if (!mark.parentNode) continue
      parents.add(mark.parentNode)
      mark.replaceWith(...Array.from(mark.childNodes))
    }
    parents.forEach(parent => parent.normalize())
    marksRef.current = []
    highlightCountRef.current = 0
  }, [])
  useEffect(() => clearHighlights, [clearHighlights])

  // -------------------------------------------------------------------------
  // 计算值
  // -------------------------------------------------------------------------

  // 自适应防抖延迟
  const debounceDelay = useMemo(
    () => getAdaptiveDelay(contentLength),
    [contentLength]
  )

  // 防抖后的搜索词
  const debouncedQuery = useDebouncedValue(query, debounceDelay)

  // -------------------------------------------------------------------------
  // 搜索词设置（带长度限制）
  // -------------------------------------------------------------------------
  const setQuery = useCallback((newQuery: string) => {
    // 限制搜索词长度
    const trimmedQuery = newQuery.slice(0, MAX_QUERY_LENGTH)
    setQueryRaw(trimmedQuery)
  }, [])

  // -------------------------------------------------------------------------
  // v1.4.2: 大小写敏感持久化
  // -------------------------------------------------------------------------
  useEffect(() => {
    localStorage.setItem(CASE_SENSITIVE_KEY, String(caseSensitive))
  }, [caseSensitive])

  // v1.4.2: 切换大小写敏感
  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive(prev => !prev)
  }, [])

  // -------------------------------------------------------------------------
  // 搜索高亮逻辑
  // 关键：每次搜索都重新创建 Mark 实例，确保使用最新的 DOM
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    clearHighlights()

    // 空搜索词：重置状态
    if (!query.trim() || debouncedQuery !== query) {
      setTotalCount(0)
      setCurrentIndex(0)
      return
    }

    // ⚠️ 关键修复：每次搜索都重新创建 Mark 实例
    // 确保 mark.js 操作的是当前的 DOM 内容
    const instance = new Mark(container)
    const exclusionAttribute = `data-page-search-excluded-${crypto.randomUUID()}`
    const excluded = container.querySelectorAll(MARK_EXCLUDE_SELECTORS.join(','))
    excluded.forEach(element => element.setAttribute(exclusionAttribute, ''))

    // 排除规则只解析一次；高亮遍历仅检查局部标记，不反复匹配祖先选择器。
    try {
      instance.mark(debouncedQuery, {
        className: 'search-highlight',
        separateWordSearch: false,
        acrossElements: true,
        caseSensitive,
        iframes: false,
        exclude: [`[${exclusionAttribute}]`],
        filter: () => {
          if (highlightCountRef.current >= MAX_HIGHLIGHTS) return false
          highlightCountRef.current++
          return true
        },
        done: () => {
          const marks = Array.from(container.querySelectorAll('mark.search-highlight'))
          marksRef.current = marks
          setTotalCount(marks.length)
          setCurrentIndex(0)
          if (marks.length > 0) {
            marks[0].classList.add('search-highlight-current')
            revealSearchMatch(marks[0], true)
          }
        },
      })
    } finally {
      excluded.forEach(element => element.removeAttribute(exclusionAttribute))
    }

  }, [query, debouncedQuery, caseSensitive, contentKey, clearHighlights])

  // -------------------------------------------------------------------------
  // 高亮当前匹配
  // -------------------------------------------------------------------------
  const highlightCurrentMark = useCallback(
    (index: number, marks: Element[] = marksRef.current) => {
      if (marks.length === 0) return

      // 移除旧的 current 标记
      marks.forEach(m => m.classList.remove('search-highlight-current'))

      // 添加新的 current 标记
      const currentMark = marks[index]
      if (currentMark) {
        currentMark.classList.add('search-highlight-current')

        revealSearchMatch(currentMark)
      }
    },
    []
  )

  // -------------------------------------------------------------------------
  // 导航：下一个匹配
  // -------------------------------------------------------------------------
  const goNext = useCallback(() => {
    if (totalCount === 0) return

    const nextIndex = (currentIndex + 1) % marksRef.current.length
    setCurrentIndex(nextIndex)
    highlightCurrentMark(nextIndex)
  }, [currentIndex, totalCount, highlightCurrentMark])

  // -------------------------------------------------------------------------
  // 导航：上一个匹配
  // -------------------------------------------------------------------------
  const goPrev = useCallback(() => {
    if (totalCount === 0) return

    const prevIndex = (currentIndex - 1 + marksRef.current.length) % marksRef.current.length
    setCurrentIndex(prevIndex)
    highlightCurrentMark(prevIndex)
  }, [currentIndex, totalCount, highlightCurrentMark])

  // -------------------------------------------------------------------------
  // 清除搜索
  // -------------------------------------------------------------------------
  const clear = useCallback(() => {
    setQueryRaw('')
    setCurrentIndex(0)
    setTotalCount(0)
    clearHighlights()
  }, [clearHighlights])

  // -------------------------------------------------------------------------
  // 返回结果
  // -------------------------------------------------------------------------
  return {
    query,
    setQuery,
    currentIndex,
    totalCount,
    goNext,
    goPrev,
    clear,
    isVisible,
    setVisible,
    // v1.4.2: 大小写敏感
    caseSensitive,
    toggleCaseSensitive,
    // 搜索历史
    searchHistory: inPageSearchHistory,
    onSelectHistory,
    onRemoveHistory,
    onClearHistory
  }
}

export default useInPageSearch
