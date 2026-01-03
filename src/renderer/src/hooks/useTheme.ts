import { useState, useEffect, useCallback } from 'react'

/**
 * 主题类型
 * - auto: 跟随系统
 * - light: 亮色主题
 * - dark: 暗色主题
 */
export type Theme = 'auto' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'md-viewer-theme'

/**
 * 获取实际应用的主题（解析 auto）
 */
function getResolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/**
 * 应用主题到 DOM
 */
function applyTheme(theme: Theme): void {
  const resolved = getResolvedTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)

  // 同时更新 meta 标签（用于 Mermaid 等）
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.setAttribute('content', resolved)
  }
}

/**
 * 主题管理 Hook
 */
export function useTheme() {
  // 从 localStorage 读取初始值，默认 auto
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      return stored
    }
    return 'auto'
  })

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      // 只有在 auto 模式下才需要响应系统变化
      if (theme === 'auto') {
        applyTheme('auto')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  // 初始化和主题变化时应用
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // 切换主题
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)
  }, [])

  // 循环切换：auto -> light -> dark -> auto
  const cycleTheme = useCallback(() => {
    setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')
  }, [theme, setTheme])

  return {
    theme,
    resolvedTheme: getResolvedTheme(theme),
    setTheme,
    cycleTheme
  }
}
