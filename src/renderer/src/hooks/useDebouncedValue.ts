import { useState, useEffect } from 'react'

/**
 * 防抖 hook - 延迟更新值直到用户停止输入
 *
 * @param value - 需要防抖的值
 * @param delay - 延迟时间（毫秒）
 * @returns 防抖后的值
 *
 * @example
 * const [query, setQuery] = useState('')
 * const debouncedQuery = useDebouncedValue(query, 300)
 *
 * // debouncedQuery 会在用户停止输入 300ms 后更新
 * useEffect(() => {
 *   // 执行搜索
 * }, [debouncedQuery])
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    // 设置定时器
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    // 清理函数：值变化时取消之前的定时器
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}
