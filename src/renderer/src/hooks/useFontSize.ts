/**
 * 字体大小调节 Hook
 * v1.4.2 新增功能
 *
 * 提供 Markdown 预览区字体大小调节功能
 *
 * 特性：
 * - 范围: 12px - 24px
 * - 步进: 2px
 * - 状态持久化（localStorage）
 * - CSS 变量控制
 */

import { useState, useEffect, useCallback } from 'react'

// ============================================================================
// 常量配置
// ============================================================================

/** 字体大小存储键 */
const FONT_SIZE_KEY = 'markdownFontSize'

/** 最小字体大小 */
const MIN_SIZE = 12

/** 最大字体大小 */
const MAX_SIZE = 24

/** 默认字体大小 */
const DEFAULT_SIZE = 16

/** 步进大小 */
const STEP = 2

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 解析并验证字体大小
 */
function parseFontSize(value: string | null): number {
  if (!value) return DEFAULT_SIZE
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) return DEFAULT_SIZE
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, parsed))
}

// ============================================================================
// Hook 导出
// ============================================================================

export interface UseFontSizeResult {
  /** 当前字体大小 */
  fontSize: number
  /** 放大字体 */
  increase: () => void
  /** 缩小字体 */
  decrease: () => void
  /** 重置为默认大小 */
  reset: () => void
}

/**
 * 字体大小调节 Hook
 *
 * @returns UseFontSizeResult - 字体大小状态和操作方法
 *
 * @example
 * ```tsx
 * function App() {
 *   const { fontSize, increase, decrease, reset } = useFontSize()
 *
 *   // 监听快捷键事件
 *   useEffect(() => {
 *     const cleanupIncrease = window.api.onShortcutFontIncrease(increase)
 *     const cleanupDecrease = window.api.onShortcutFontDecrease(decrease)
 *     const cleanupReset = window.api.onShortcutFontReset(reset)
 *     return () => {
 *       cleanupIncrease()
 *       cleanupDecrease()
 *       cleanupReset()
 *     }
 *   }, [increase, decrease, reset])
 *
 *   return <div style={{ fontSize }}>...</div>
 * }
 * ```
 */
export function useFontSize(): UseFontSizeResult {
  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------
  const [fontSize, setFontSize] = useState(() => {
    return parseFontSize(localStorage.getItem(FONT_SIZE_KEY))
  })

  // -------------------------------------------------------------------------
  // 同步到 CSS 变量和 localStorage
  // -------------------------------------------------------------------------
  useEffect(() => {
    document.documentElement.style.setProperty('--markdown-font-size', `${fontSize}px`)
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
  }, [fontSize])

  // -------------------------------------------------------------------------
  // 监听其他标签页的修改（可选，多窗口同步）
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === FONT_SIZE_KEY && e.newValue) {
        setFontSize(parseFontSize(e.newValue))
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  // -------------------------------------------------------------------------
  // 操作方法（使用函数式更新，避免闭包问题）
  // -------------------------------------------------------------------------
  const increase = useCallback(() => {
    setFontSize(prev => Math.min(prev + STEP, MAX_SIZE))
  }, [])

  const decrease = useCallback(() => {
    setFontSize(prev => Math.max(prev - STEP, MIN_SIZE))
  }, [])

  const reset = useCallback(() => {
    setFontSize(DEFAULT_SIZE)
  }, [])

  // -------------------------------------------------------------------------
  // 返回结果
  // -------------------------------------------------------------------------
  return { fontSize, increase, decrease, reset }
}

export default useFontSize
