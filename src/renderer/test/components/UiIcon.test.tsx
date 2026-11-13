import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UiIcon, type UiIconName } from '../../src/components/UiIcon'

const names: UiIconName[] = ['document', 'document-edit', 'folder', 'folder-open', 'pin', 'settings', 'auto', 'sun', 'moon', 'volume', 'refresh', 'clock', 'star']

describe('UiIcon', () => {
  it.each(names)('%s 仅使用本地 SVG 几何，继承颜色且不新增焦点', name => {
    const { container } = render(<UiIcon name={name} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveAttribute('width', '1em')
    expect(svg).toHaveAttribute('height', '1em')
    expect(svg.textContent).toBe('')
    expect(svg.querySelector('path, circle, rect, line')).not.toBeNull()
    expect(svg.querySelector('text, image, use, foreignObject')).toBeNull()
  })
})
