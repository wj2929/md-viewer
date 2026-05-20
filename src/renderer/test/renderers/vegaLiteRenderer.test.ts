import { describe, expect, it } from 'vitest'
import { processVegaLiteInHtml, renderVegaLiteToSvg, validateVegaLiteSource } from '../../src/utils/vegaLiteRenderer'

const VALID_VEGA_LITE = JSON.stringify({
  data: { values: [{ a: 'A', b: 28 }, { a: 'B', b: 55 }] },
  mark: 'bar',
  encoding: {
    x: { field: 'a', type: 'nominal' },
    y: { field: 'b', type: 'quantitative' },
  },
})

const CHINESE_CATEGORY_VEGA_LITE = JSON.stringify({
  data: {
    values: [
      { category: '预览', count: 18 },
      { category: '导出', count: 11 },
      { category: '编辑', count: 9 },
    ],
  },
  mark: 'bar',
  encoding: {
    x: { field: 'category', type: 'nominal' },
    y: { field: 'count', type: 'quantitative' },
  },
})

function collectTransforms(element: Element | null): string {
  const transforms: string[] = []
  let current: Element | null = element
  while (current) {
    const transform = current.getAttribute('transform')
    if (transform) transforms.push(transform)
    current = current.parentElement
  }
  return transforms.join(' ')
}

describe('vegaLiteRenderer', () => {
  it('renders inline data values to svg', async () => {
    const result = await renderVegaLiteToSvg(VALID_VEGA_LITE)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('</svg>')
    }
  })

  it('uses a readable default chart width when width is omitted', async () => {
    const result = await renderVegaLiteToSvg(VALID_VEGA_LITE)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const width = Number(result.svg.match(/\bwidth="([0-9.]+)"/)?.[1] || 0)
      expect(width).toBeGreaterThanOrEqual(520)
    }
  })

  it('keeps default nominal x-axis Chinese labels horizontal', async () => {
    const result = await renderVegaLiteToSvg(CHINESE_CATEGORY_VEGA_LITE)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
      for (const label of ['预览', '导出', '编辑']) {
        const text = Array.from(doc.querySelectorAll('text')).find(node => node.textContent === label)
        expect(text, `${label} label should be rendered`).toBeTruthy()
        expect(collectTransforms(text || null)).not.toMatch(/rotate\(/)
      }
    }
  })

  it('returns user-readable validation errors for invalid json', () => {
    const result = validateVegaLiteSource('{ invalid json')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('VEGA_LITE_INVALID_JSON')
    }
  })

  it('blocks external url data before rendering', () => {
    const result = validateVegaLiteSource(JSON.stringify({
      data: { url: 'https://example.com/data.csv' },
      mark: 'bar',
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('VEGA_LITE_EXTERNAL_DATA_BLOCKED')
    }
  })

  it('replaces vega-lite code blocks in exported html', async () => {
    const result = await processVegaLiteInHtml(`<pre class="language-vega-lite"><code class="language-vega-lite">${VALID_VEGA_LITE}</code></pre>`)

    expect(result).toContain('vega-lite-container')
    expect(result).toContain('<svg')
    expect(result).not.toContain('language-vega-lite')
  })
})
