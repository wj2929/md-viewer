import { describe, expect, it } from 'vitest'
import { processWaveDromInHtml, renderWaveDromToSvg, validateWaveDromSource } from '../../src/utils/wavedromRenderer'

const VALID_WAVEDROM = "{ signal: [{ name: 'clk', wave: 'p..P' }, { name: 'data', wave: 'x.34', data: ['a', 'b'] }] }"

describe('wavedromRenderer', () => {
  it('renders WaveDrom JSON5 source to SVG', () => {
    const result = renderWaveDromToSvg(VALID_WAVEDROM)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('WaveDrom')
    }
  })

  it('uses a readable minimum preview width for compact timing diagrams', () => {
    const result = renderWaveDromToSvg(VALID_WAVEDROM)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('width="640"')
      expect(result.svg).toContain('max-width: 100%')
    }
  })

  it('rejects oversized WaveDrom input before parsing', () => {
    const result = validateWaveDromSource('x'.repeat(65_001))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('WAVEDROM_SOURCE_TOO_LARGE')
    }
  })

  it('replaces WaveDrom code blocks in exported html', async () => {
    const result = await processWaveDromInHtml(`<pre class="language-wavedrom"><code class="language-wavedrom">${VALID_WAVEDROM}</code></pre>`)

    expect(result).toContain('wavedrom-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('language-wavedrom')
  })
})
