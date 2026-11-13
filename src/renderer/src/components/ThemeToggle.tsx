import { memo } from 'react'
import { UiIcon, type UiIconName } from './UiIcon'
import { Theme } from '../hooks/useTheme'

interface ThemeToggleProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

/**
 * 主题切换组件
 * 三档切换：自动 / 亮色 / 暗色
 */
export function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps): JSX.Element {
  const themes: { value: Theme; label: string; icon: UiIconName }[] = [
    { value: 'auto', label: '自动', icon: 'auto' },
    { value: 'light', label: '亮色', icon: 'sun' },
    { value: 'dark', label: '暗色', icon: 'moon' }
  ]

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="主题选择">
      {themes.map(({ value, label, icon }) => (
        <button
          key={value}
          className={`theme-toggle-btn nav-instant-tooltip ${theme === value ? 'active' : ''}`}
          onClick={() => onThemeChange(value)}
          role="radio"
          aria-checked={theme === value}
          aria-label={`${label}主题`}
          data-tooltip={`${label}主题`}
        >
          <span className="theme-icon"><UiIcon name={icon} /></span>
        </button>
      ))}
    </div>
  )
}

export default memo(ThemeToggle)
