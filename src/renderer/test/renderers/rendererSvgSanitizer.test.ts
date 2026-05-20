import { describe, expect, it } from 'vitest'
import { sanitizeRendererSvg } from '../../src/utils/rendererSvgSanitizer'

describe('rendererSvgSanitizer', () => {
  it('preserves embedded font styles required by Kroki TikZ SVG output', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<style>text.f0{font-family:cmss8;font-size:6.973848px}@font-face{font-family:cmss8;src:url(data:application/x-font-woff;base64,QUJD) format("woff");}</style>',
      '<text class="f0">Markdown</text>',
      '</svg>',
    ].join('')

    const sanitized = sanitizeRendererSvg(svg)

    expect(sanitized).toContain('<style')
    expect(sanitized).toContain('application/x-font-woff')
    expect(sanitized).toContain('font-size:6.973848px')
    expect(sanitized).toContain('class="f0"')
    expect(sanitized).toContain('font-family="cmss8"')
    expect(sanitized).toContain('font-size="6.973848px"')
  })

  it('removes SVG styles that reference external CSS URLs', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<style>text{font-family:bad;src:url(https://example.com/font.woff)}</style>',
      '<text>Unsafe</text>',
      '</svg>',
    ].join('')

    const sanitized = sanitizeRendererSvg(svg)

    expect(sanitized).not.toContain('<style')
    expect(sanitized).not.toContain('example.com')
  })
})
