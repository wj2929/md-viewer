import { describe, expect, it } from 'vitest'
import { addSvgSafePaddingForDocx } from '../../src/utils/docxChartRenderer'

function readViewBox(svgString: string): number[] {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  const viewBox = svg?.getAttribute('viewBox')
  if (!viewBox) throw new Error('missing viewBox')
  return viewBox.split(/\s+/).map(Number)
}

describe('DOCX chart SVG safe padding', () => {
  it('expands the SVG viewBox so chart content is not rasterized against the edge', () => {
    const padded = addSvgSafePaddingForDocx(
      '<svg viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50"/></svg>',
      12,
    )

    expect(readViewBox(padded)).toEqual([-12, -12, 124, 74])
    expect(padded).toContain('preserveAspectRatio="xMidYMid meet"')
  })

  it('uses width and height attributes when an SVG does not provide a viewBox', () => {
    const padded = addSvgSafePaddingForDocx(
      '<svg width="200" height="80"><rect x="0" y="0" width="200" height="80"/></svg>',
      20,
    )

    expect(readViewBox(padded)).toEqual([-20, -20, 240, 120])
  })

  it('preserves the original SVG body without XML reserialization', () => {
    const source = '<svg viewBox="0 0 100 50"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">a&nbsp;b</div></foreignObject></svg>'

    const padded = addSvgSafePaddingForDocx(source, 12)

    expect(padded).toContain('a&nbsp;b')
    expect(padded).toContain('<foreignObject>')
  })

  it('does not convert browser-tolerated SVG markup into a parser error image', () => {
    const source = '<svg viewBox="0 0 100 50"><text>a & b</text></svg>'

    const padded = addSvgSafePaddingForDocx(source, 12)

    expect(padded).toContain('viewBox="-12 -12 124 74"')
    expect(padded).toContain('<text>a & b</text>')
    expect(padded).not.toContain('parsererror')
  })
})
