import { useEffect } from 'react'
import { useLayoutStore, useTabStore } from '../stores'
import { createLeaf, PanelNode } from '../utils/splitTree'

/**
 * 键盘快捷键 hook
 * 处理全屏切换、分屏快捷键等全局键盘事件
 */
export function useKeyboardShortcuts(): void {
  const { isFullscreen, setIsFullscreen } = useLayoutStore()
  const { activeTabId, setSplitState } = useTabStore()

  // v1.4.3：全屏查看快捷键监听（macOS: Cmd+F11, Win/Linux: F11, ESC 退出）
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = window.api?.platform === 'darwin'

      const isFullscreenToggle = isMac
        ? (e.metaKey && e.key === 'F11')
        : (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey)

      if (isFullscreenToggle) {
        e.preventDefault()
        const currentFullScreen = await window.api.isFullScreen()
        setIsFullscreen(!currentFullScreen)
        await window.api.setFullScreen(!currentFullScreen)
      }
      // ESC 退出全屏
      else if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault()
        setIsFullscreen(false)
        await window.api.setFullScreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, setIsFullscreen])

  // v1.4.3：监听系统全屏状态变化
  useEffect(() => {
    if (!isFullscreen) return

    const checkFullScreen = async () => {
      const isSysFullScreen = await window.api.isFullScreen()
      if (!isSysFullScreen) {
        setIsFullscreen(false)
      }
    }

    const interval = setInterval(checkFullScreen, 500)
    return () => clearInterval(interval)
  }, [isFullscreen, setIsFullscreen])

  // v1.5.1：分屏快捷键 Cmd+\ / Ctrl+\
  useEffect(() => {
    const handleSplitShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        const currentTabs = useTabStore.getState().tabs
        setSplitState(prev => {
          if (prev.root) {
            return { root: null, activeLeafId: '' }
          }
          const activeIdx = currentTabs.findIndex(t => t.id === activeTabId)
          const nextTab = currentTabs.find((t, i) => i !== activeIdx)
          if (!nextTab || !activeTabId) return prev
          const firstLeaf = createLeaf(activeTabId)
          const secondLeaf = createLeaf(nextTab.id)
          const root: PanelNode = {
            type: 'split',
            id: `panel-split-${Date.now()}`,
            direction: 'horizontal',
            ratio: 0.5,
            first: firstLeaf,
            second: secondLeaf
          }
          return { root, activeLeafId: firstLeaf.id }
        })
      }
    }
    window.addEventListener('keydown', handleSplitShortcut)
    return () => window.removeEventListener('keydown', handleSplitShortcut)
  }, [activeTabId, setSplitState])
}
