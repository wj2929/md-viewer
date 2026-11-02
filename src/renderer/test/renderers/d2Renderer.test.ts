import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processD2InHtml, renderD2ToSvg, validateD2Source } from '../../src/utils/d2Renderer'

let mockedD2Svg = '<svg viewBox="0 0 100 40"><text>D2</text></svg>'
let d2ConstructorCount = 0
let activeD2Calls = 0
let maxActiveD2Calls = 0

vi.mock('@terrastruct/d2', () => ({
  D2: class {
    constructor() {
      d2ConstructorCount += 1
    }

    async compile(source: string) {
      activeD2Calls += 1
      maxActiveD2Calls = Math.max(maxActiveD2Calls, activeD2Calls)
      await Promise.resolve()
      activeD2Calls -= 1
      return {
        diagram: { source },
        renderOptions: { noXMLTag: true },
      }
    }

    async render() {
      return mockedD2Svg
    }
  },
}))

describe('d2Renderer', () => {
  beforeEach(() => {
    mockedD2Svg = '<svg viewBox="0 0 100 40"><text>D2</text></svg>'
  })

  it('renders D2 source to SVG without network access', async () => {
    const result = await renderD2ToSvg('input -> output')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('</svg>')
    }
  })

  it('sanitizes dangerous SVG returned by the D2 renderer', async () => {
    mockedD2Svg = '<svg><script>alert(1)</script><g onclick="alert(1)"><a href="javascript:alert(1)"><text>D2</text></a></g></svg>'

    const result = await renderD2ToSvg('input -> output')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('<text>D2</text>')
      expect(result.svg).not.toContain('<script')
      expect(result.svg).not.toContain('onclick')
      expect(result.svg).not.toContain('javascript:')
    }
  })

  it('caps extremely large SVG dimensions while keeping D2 responsive by default', async () => {
    mockedD2Svg = '<svg width="2400" height="1200" viewBox="0 0 2400 1200"><text>D2</text></svg>'

    const result = await renderD2ToSvg('input -> output')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).not.toContain('width="2400"')
      expect(result.svg).not.toContain('height="1200"')
      expect(result.svg).toContain('width="1800"')
      expect(result.svg).toContain('preserveAspectRatio')
      expect(result.svg).toContain('max-width: 100%')
      expect(result.svg).not.toContain('max-width: none')
    }
  })

  it('does not upscale small viewBox-only SVGs to full preview width', async () => {
    mockedD2Svg = '<svg viewBox="0 0 237 896"><text>D2</text></svg>'

    const result = await renderD2ToSvg('input -> output')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('width="237"')
      expect(result.svg).not.toContain('width="100%"')
    }
  })

  it('keeps wide D2 diagrams fully visible in the default preview', async () => {
    mockedD2Svg = '<svg viewBox="0 0 2252 148"><text font-size="16">wide D2 flow</text></svg>'

    const result = await renderD2ToSvg('input -> output')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('width="1800"')
      expect(result.svg).toContain('max-width: 100%')
      expect(result.svg).not.toContain('max-width: none')
    }
  })

  it('rejects empty D2 source with a user-readable error', () => {
    const result = validateD2Source('   ')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('D2_EMPTY_SOURCE')
    }
  })

  it('replaces D2 code blocks in exported html', async () => {
    const result = await processD2InHtml('<pre class="language-d2"><code class="language-d2">a -> b</code></pre>')

    expect(result).toContain('d2-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('language-d2')
  })

  it('reuses one D2 worker and serializes concurrent renders', async () => {
    const results = await Promise.all([
      renderD2ToSvg('a -> b'),
      renderD2ToSvg('c -> d'),
      renderD2ToSvg('e -> f'),
    ])

    expect(results.every(result => result.ok)).toBe(true)
    expect(d2ConstructorCount).toBe(1)
    expect(maxActiveD2Calls).toBe(1)
  })
})
