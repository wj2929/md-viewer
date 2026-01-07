/**
 * 当前位置追踪 Hook
 * 使用 IntersectionObserver 监听标题可见性，实现目录高亮
 */

import { useState, useEffect, useRef } from 'react'
import type { TocItem } from '../utils/tocExtractor'

/**
 * 追踪当前可视的标题（用于目录高亮）
 *
 * @param toc - 目录项数组
 * @param container - 滚动容器元素
 * @returns 当前可视标题的 ID
 *
 * @example
 * const activeId = useActiveHeading(toc, containerRef.current)
 */
export function useActiveHeading(
  toc: TocItem[],
  container: HTMLElement | null
): string {
  const [activeId, setActiveId] = useState<string>('')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    if (!container || toc.length === 0) {
      setActiveId('')
      return
    }

    // 断开旧的 observer
    observerRef.current?.disconnect()

    // 记录所有可见的标题及其位置
    const visibleHeadings = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            visibleHeadings.set(entry.target.id, entry.boundingClientRect.top)
          } else {
            visibleHeadings.delete(entry.target.id)
          }
        })

        // 找到最上方可见的标题
        if (visibleHeadings.size > 0) {
          let topMostId = ''
          let topMostPosition = Infinity

          visibleHeadings.forEach((top, id) => {
            if (top < topMostPosition) {
              topMostPosition = top
              topMostId = id
            }
          })

          if (topMostId) {
            setActiveId(topMostId)
          }
        }
      },
      {
        root: container,
        // 顶部 10% 位置触发，底部 80% 位置截止
        rootMargin: '-10% 0px -80% 0px',
        threshold: 0
      }
    )

    // 观察所有标题元素
    toc.forEach(({ id }) => {
      const el = container.querySelector(`#${CSS.escape(id)}`)
      if (el) observer.observe(el)
    })

    observerRef.current = observer

    // 初始化时设置第一个标题为活动状态（如果没有可见标题）
    if (toc.length > 0 && !activeId) {
      setActiveId(toc[0].id)
    }

    return () => observer.disconnect()
  }, [toc, container])

  return activeId
}
