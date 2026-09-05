import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRestrictedSvgChart } from '../../src/components/charts/useRestrictedSvgChart'

function createRoot(source: string): HTMLElement {
  const root = document.createElement('div')
  const pre = document.createElement('pre')
  pre.className = 'language-svg'
  const code = document.createElement('code')
  code.className = 'language-svg'
  code.textContent = source
  pre.appendChild(code)
  root.appendChild(pre)
  document.body.appendChild(root)
  return root
}

describe('useRestrictedSvgChart', () => {
  it('renders a safe SVG fence with the shared chart toolbar and text source view', () => {
    const source = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#dbeafe"/><text x="12" y="36">安全 SVG</text></svg>'
    const root = createRoot(source)
    const ref = { current: root }

    renderHook(() => useRestrictedSvgChart(ref, source))

    const wrapper = root.querySelector('.svg-wrapper') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.querySelector('.svg-container svg')).not.toBeNull()
    expect(wrapper.querySelector('[data-action="toggleCode"]')).not.toBeNull()
    expect(wrapper.querySelector('[data-action="download"]')).not.toBeNull()
    expect(wrapper.querySelector('[data-action="fullscreen"]')).not.toBeNull()

    fireEvent.click(wrapper.querySelector('[data-action="toggleCode"]') as Element)
    const codeView = wrapper.querySelector('.svg-code-view') as HTMLElement
    expect(codeView.style.display).not.toBe('none')
    expect(codeView.textContent).toContain(source)
    expect(codeView.querySelector('svg')).toBeNull()
  })

  it('keeps fragment ids unique across independent preview roots', () => {
    const source = '<svg viewBox="0 0 20 20"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="20" height="20" fill="url(#paint)"/></svg>'
    const firstRoot = createRoot(source)
    const secondRoot = createRoot(source)

    renderHook(() => useRestrictedSvgChart({ current: firstRoot }, source))
    renderHook(() => useRestrictedSvgChart({ current: secondRoot }, source))

    const firstId = firstRoot.querySelector('linearGradient')?.id
    const secondId = secondRoot.querySelector('linearGradient')?.id
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId).not.toBe(secondId)
    expect(firstRoot.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${firstId})`)
    expect(secondRoot.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${secondId})`)
  })

  it('replaces an unsafe SVG fence with a neutral error and no active payload', () => {
    const source = '<svg viewBox="0 0 10 10"><script>window.pwned = true</script></svg>'
    const root = createRoot(source)
    const ref = { current: root }

    renderHook(() => useRestrictedSvgChart(ref, source))

    expect(root.querySelector('.svg-wrapper')).toBeNull()
    expect(root.querySelector('.svg-error')).not.toBeNull()
    expect(root.querySelector('script')).toBeNull()
    expect(root.innerHTML).not.toContain('window.pwned')
  })
})
