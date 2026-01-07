/**
 * 目录状态管理 Hook
 * 提供目录提取和滚动跳转功能
 */

import { useMemo, useCallback } from 'react'
import { useDebouncedValue } from './useDebouncedValue'
import { extractToc, TocItem } from '../utils/tocExtractor'
import { createMarkdownRenderer } from '../utils/markdownRenderer'

export type { TocItem }

interface UseTableOfContentsOptions {
  /** 防抖延迟（毫秒），默认 300ms */
  debounceMs?: number
}

/**
 * 目录状态管理 Hook
 *
 * @param markdown - Markdown 源文本
 * @param options - 配置选项
 * @returns 目录数据和滚动方法
 *
 * @example
 * const { toc, scrollToHeading } = useTableOfContents(markdown)
 */
export function useTableOfContents(
  markdown: string,
  options: UseTableOfContentsOptions = {}
) {
  const { debounceMs = 300 } = options

  // 防抖处理，避免频繁解析
  const debouncedMarkdown = useDebouncedValue(markdown, debounceMs)

  // 缓存 markdown-it 实例
  const md = useMemo(() => createMarkdownRenderer(), [])

  // 提取目录
  const toc = useMemo(() => {
    if (!debouncedMarkdown) return []
    return extractToc(debouncedMarkdown, md)
  }, [debouncedMarkdown, md])

  // 滚动到指定标题
  const scrollToHeading = useCallback((
    id: string,
    container: HTMLElement | null
  ) => {
    if (!container) return

    const heading = container.querySelector(`#${CSS.escape(id)}`)
    if (!heading) return

    heading.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // 焦点管理（a11y）
    const el = heading as HTMLElement
    el.setAttribute('tabindex', '-1')
    el.focus()
    el.addEventListener('blur', () => {
      el.removeAttribute('tabindex')
    }, { once: true })
  }, [])

  return { toc, scrollToHeading }
}
