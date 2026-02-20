/**
 * Stores 统一导出
 * @module stores
 * @description 统一导出所有 Zustand stores
 */

// 剪贴板 Store（v1.3）
export { useClipboardStore } from './clipboardStore'
export type { PasteResult } from './clipboardStore'

// 窗口状态 Store（v1.4.2）
export { useWindowStore } from './windowStore'

// UI 状态 Store（v1.4.2）
export { useUIStore, FONT_SIZE } from './uiStore'

// 搜索历史 Store
export { useSearchHistoryStore } from './searchHistoryStore'

// v1.6.0: 新增 Stores
export { useFileStore } from './fileStore'
export { useTabStore } from './tabStore'
export { useBookmarkStore } from './bookmarkStore'
export { useLayoutStore } from './layoutStore'
