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
 * - 大文件禁用 smooth 滚动
 */

import { useState, useEffect, useRef, RefObject, useCallback, useMemo } from 'react'
import Mark from 'mark.js'
import { useDebouncedValue } from './useDebouncedValue'

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

/** mark.js 排除配置（防止破坏渲染） */
const MARK_EXCLUDE_SELECTORS = [
  'pre',                     // 代码块
  'code',                    // 行内代码
  '.katex',                  // KaTeX 公式容器
  '.katex *',                // KaTeX 公式内部元素
  '.mermaid-container',      // Mermaid 图表容器
  '.mermaid-container *'     // Mermaid 图表内部元素
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
  if (contentLength < LARGE_FILE_THRESHOLD) return 300      // 小文件：300ms
  if (contentLength < VERY_LARGE_FILE_THRESHOLD) return 450 // 中等文件：450ms
  return 600                                                 // 大文件：600ms
}

/**
 * 获取滚动行为（大文件禁用 smooth）
 */
function getScrollBehavior(contentLength: number): ScrollBehavior {
  return contentLength > LARGE_FILE_THRESHOLD ? 'auto' : 'smooth'
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
  contentLength: number = 0
): InPageSearchResult {
  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------
  const [query, setQueryRaw] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [isVisible, setVisible] = useState(false)
  // v1.4.2: 大小写敏感（默认不敏感，更符合用户习惯）
  const [caseSensitive, setCaseSensitive] = useState(() => {
    return localStorage.getItem(CASE_SENSITIVE_KEY) === 'true'
  })

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const markInstanceRef = useRef<Mark | null>(null)
  const marksRef = useRef<Element[]>([])
  const highlightCountRef = useRef(0)

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

  // 滚动行为
  const scrollBehavior = useMemo(
    () => getScrollBehavior(contentLength),
    [contentLength]
  )

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

    // 清除旧实例和高亮
    if (markInstanceRef.current) {
      markInstanceRef.current.unmark()
    }
    marksRef.current = []
    highlightCountRef.current = 0

    // 空搜索词：重置状态
    if (!debouncedQuery.trim()) {
      setTotalCount(0)
      setCurrentIndex(0)
      return
    }

    // ⚠️ 关键修复：每次搜索都重新创建 Mark 实例
    // 确保 mark.js 操作的是当前的 DOM 内容
    const instance = new Mark(container)
    markInstanceRef.current = instance

    // 标记新匹配
    instance.mark(debouncedQuery, {
      className: 'search-highlight',
      separateWordSearch: false,
      acrossElements: true,  // 允许跨元素匹配
      // v1.4.2: 支持大小写敏感切换
      caseSensitive: caseSensitive,

      // 排除代码块、公式、图表（防止破坏渲染）
      exclude: MARK_EXCLUDE_SELECTORS,

      // 限制高亮数量（性能保护）
      filter: () => {
        if (highlightCountRef.current >= MAX_HIGHLIGHTS) {
          return false
        }
        highlightCountRef.current++
        return true
      },

      // 高亮完成回调
      done: (count) => {
        // 查找所有标记元素
        const marks = Array.from(container.querySelectorAll('mark'))

        marksRef.current = marks
        setTotalCount(marks.length)

        // 高亮并滚动到第一个匹配
        if (marks.length > 0) {
          setCurrentIndex(0)
          // 直接在这里处理滚动，避免依赖 highlightCurrentMark
          marks.forEach(m => m.classList.remove('search-highlight-current'))
          marks[0].classList.add('search-highlight-current')
          marks[0].scrollIntoView({
            behavior: scrollBehavior,
            block: 'center'
          })
        }
      }
    })

    // 注意：不要在清理函数中 unmark！
    // 因为 setTotalCount 会触发重新渲染，导致清理函数执行
    // unmark 应该只在搜索词变化或组件卸载时执行
  }, [debouncedQuery, scrollBehavior, caseSensitive])  // v1.4.2: 添加 caseSensitive 依赖

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

        // 滚动到当前匹配（大文件禁用 smooth）
        currentMark.scrollIntoView({
          behavior: scrollBehavior,
          block: 'center'
        })
      }
    },
    [scrollBehavior]
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
    markInstanceRef.current?.unmark()
    marksRef.current = []
    highlightCountRef.current = 0
  }, [])

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
    toggleCaseSensitive
  }
}

export default useInPageSearch
