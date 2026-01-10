/**
 * UI 状态 Store
 * @module uiStore
 * @description v1.4.2 新增 - 管理 UI 级别的全局状态
 *
 * 功能：
 * - 字体大小调节（12-24px，步进 2px）
 * - 状态持久化（localStorage）
 * - CSS 变量同步
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================================
// 常量配置
// ============================================================================

/** 字体大小配置 */
const FONT_SIZE = {
  MIN: 12,
  MAX: 24,
  DEFAULT: 16,
  STEP: 2
} as const

// ============================================================================
// 类型定义
// ============================================================================

interface UIState {
  /** 字体大小（px） */
  fontSize: number
}

interface UIActions {
  /** 放大字体 */
  increaseFontSize: () => void
  /** 缩小字体 */
  decreaseFontSize: () => void
  /** 重置字体大小 */
  resetFontSize: () => void
  /** 设置字体大小 */
  setFontSize: (size: number) => void
  /** 应用 CSS 变量 */
  applyCSSVariable: () => void
}

type UIStore = UIState & UIActions

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 限制字体大小在有效范围内
 */
function clampFontSize(size: number): number {
  return Math.max(FONT_SIZE.MIN, Math.min(FONT_SIZE.MAX, size))
}

/**
 * 同步字体大小到 CSS 变量
 */
function syncCSSVariable(fontSize: number): void {
  document.documentElement.style.setProperty('--markdown-font-size', `${fontSize}px`)
}

// ============================================================================
// Store 实现
// ============================================================================

/**
 * UI 状态 Store
 *
 * @example
 * ```tsx
 * // 在组件中使用
 * function FontSizeControl() {
 *   const { fontSize, increaseFontSize, decreaseFontSize, resetFontSize } = useUIStore()
 *
 *   return (
 *     <div>
 *       <span>{fontSize}px</span>
 *       <button onClick={decreaseFontSize}>-</button>
 *       <button onClick={resetFontSize}>重置</button>
 *       <button onClick={increaseFontSize}>+</button>
 *     </div>
 *   )
 * }
 *
 * // 在 App.tsx 初始化 CSS 变量
 * useEffect(() => {
 *   useUIStore.getState().applyCSSVariable()
 * }, [])
 * ```
 */
export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      // -----------------------------------------------------------------------
      // 初始状态
      // -----------------------------------------------------------------------
      fontSize: FONT_SIZE.DEFAULT,

      // -----------------------------------------------------------------------
      // Actions
      // -----------------------------------------------------------------------

      /**
       * 放大字体
       */
      increaseFontSize: () => {
        const newSize = clampFontSize(get().fontSize + FONT_SIZE.STEP)
        set({ fontSize: newSize })
        syncCSSVariable(newSize)
        console.log('[UIStore] increaseFontSize:', newSize)
      },

      /**
       * 缩小字体
       */
      decreaseFontSize: () => {
        const newSize = clampFontSize(get().fontSize - FONT_SIZE.STEP)
        set({ fontSize: newSize })
        syncCSSVariable(newSize)
        console.log('[UIStore] decreaseFontSize:', newSize)
      },

      /**
       * 重置字体大小
       */
      resetFontSize: () => {
        set({ fontSize: FONT_SIZE.DEFAULT })
        syncCSSVariable(FONT_SIZE.DEFAULT)
        console.log('[UIStore] resetFontSize:', FONT_SIZE.DEFAULT)
      },

      /**
       * 设置字体大小
       */
      setFontSize: (size: number) => {
        const newSize = clampFontSize(size)
        set({ fontSize: newSize })
        syncCSSVariable(newSize)
        console.log('[UIStore] setFontSize:', newSize)
      },

      /**
       * 应用 CSS 变量
       * 用于应用启动时初始化
       */
      applyCSSVariable: () => {
        syncCSSVariable(get().fontSize)
      }
    }),
    {
      name: 'md-viewer-ui',
      // 只持久化特定字段
      partialize: (state) => ({
        fontSize: state.fontSize
      })
    }
  )
)

// ============================================================================
// 导出常量（供其他模块使用）
// ============================================================================

export { FONT_SIZE }

export default useUIStore
