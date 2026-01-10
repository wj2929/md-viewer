/**
 * 窗口状态 Store
 * @module windowStore
 * @description v1.4.2 新增 - 管理窗口级别的全局状态
 *
 * 功能：
 * - 窗口置顶状态管理
 * - 与主进程双向同步
 * - 状态持久化（通过 electron-store）
 */

import { create } from 'zustand'

// ============================================================================
// 类型定义
// ============================================================================

interface WindowState {
  /** 窗口是否置顶 */
  isAlwaysOnTop: boolean
  /** 是否已初始化（从主进程获取初始状态） */
  initialized: boolean
}

interface WindowActions {
  /** 设置置顶状态（同步到主进程） */
  setAlwaysOnTop: (value: boolean) => Promise<void>
  /** 切换置顶状态 */
  toggleAlwaysOnTop: () => Promise<void>
  /** 从主进程同步状态（用于事件回调） */
  syncFromMain: (value: boolean) => void
  /** 初始化（从主进程获取初始状态） */
  initialize: () => Promise<void>
}

type WindowStore = WindowState & WindowActions

// ============================================================================
// Store 实现
// ============================================================================

/**
 * 窗口状态 Store
 *
 * @example
 * ```tsx
 * // 在组件中使用
 * function NavigationBar() {
 *   const { isAlwaysOnTop, toggleAlwaysOnTop } = useWindowStore()
 *
 *   return (
 *     <button onClick={toggleAlwaysOnTop}>
 *       {isAlwaysOnTop ? '📌' : '📍'}
 *     </button>
 *   )
 * }
 *
 * // 在 App.tsx 初始化
 * useEffect(() => {
 *   const { initialize, syncFromMain } = useWindowStore.getState()
 *   initialize()
 *
 *   // 监听主进程事件
 *   const cleanup = window.api.onAlwaysOnTopChanged(syncFromMain)
 *   return cleanup
 * }, [])
 * ```
 */
export const useWindowStore = create<WindowStore>((set, get) => ({
  // ---------------------------------------------------------------------------
  // 初始状态
  // ---------------------------------------------------------------------------
  isAlwaysOnTop: false,
  initialized: false,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * 设置置顶状态
   * 先更新本地状态，再同步到主进程
   */
  setAlwaysOnTop: async (value: boolean) => {
    // 乐观更新
    set({ isAlwaysOnTop: value })

    try {
      // 同步到主进程
      await window.api.setAlwaysOnTop(value)
      console.log('[WindowStore] setAlwaysOnTop:', value)
    } catch (error) {
      // 回滚
      console.error('[WindowStore] setAlwaysOnTop failed:', error)
      set({ isAlwaysOnTop: !value })
    }
  },

  /**
   * 切换置顶状态
   */
  toggleAlwaysOnTop: async () => {
    const newValue = !get().isAlwaysOnTop
    await get().setAlwaysOnTop(newValue)
  },

  /**
   * 从主进程同步状态
   * 用于响应快捷键触发或其他外部变化
   */
  syncFromMain: (value: boolean) => {
    set({ isAlwaysOnTop: value })
    console.log('[WindowStore] syncFromMain:', value)
  },

  /**
   * 初始化
   * 从主进程获取当前置顶状态
   */
  initialize: async () => {
    if (get().initialized) return

    try {
      const isOnTop = await window.api.getAlwaysOnTop()
      set({
        isAlwaysOnTop: isOnTop,
        initialized: true
      })
      console.log('[WindowStore] initialized:', isOnTop)
    } catch (error) {
      console.error('[WindowStore] initialize failed:', error)
      set({ initialized: true })
    }
  }
}))

export default useWindowStore
