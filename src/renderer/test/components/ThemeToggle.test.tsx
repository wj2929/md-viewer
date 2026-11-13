import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../../src/components/ThemeToggle'

describe('ThemeToggle SVG icons', () => {
  it.each(['auto', 'light', 'dark'] as const)('%s 保留三档选择且不依赖 Emoji 字体', theme => {
    const onThemeChange = vi.fn()
    const { container } = render(<ThemeToggle theme={theme} onThemeChange={onThemeChange} />)
    const labels = ['自动主题', '亮色主题', '暗色主题']
    for (const [index, value] of (['auto', 'light', 'dark'] as const).entries()) {
      const button = screen.getByRole('radio', { name: labels[index] })
      expect(button).toHaveAttribute('aria-checked', String(theme === value))
      const icon = button.querySelector('svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke', 'currentColor')
      expect(icon?.querySelector('text, image, use, foreignObject')).toBeNull()
      fireEvent.click(button)
      expect(onThemeChange).toHaveBeenLastCalledWith(value)
    }
    expect(container.querySelectorAll('.theme-icon svg')).toHaveLength(3)
    expect(container.textContent).toBe('')
  })
})
