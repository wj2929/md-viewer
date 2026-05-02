import { describe, expect, it } from 'vitest'
import { addSvgSafePaddingForDocx, calculateDocxChartTrimRect } from '../../src/utils/docxChartRenderer'

function makeWhiteImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { width, height, data } as ImageData
}

function paintRect(imageData: ImageData, x: number, y: number, width: number, height: number, color: [number, number, number]): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = (row * imageData.width + col) * 4
      imageData.data[offset] = color[0]
      imageData.data[offset + 1] = color[1]
      imageData.data[offset + 2] = color[2]
      imageData.data[offset + 3] = 255
    }
  }
}

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

describe('DOCX chart PNG whitespace trimming', () => {
  it('trims excessive white canvas while preserving a safe padding around chart content', () => {
    const imageData = makeWhiteImageData(400, 300)
    paintRect(imageData, 160, 120, 80, 60, [24, 24, 24])

    const rect = calculateDocxChartTrimRect(imageData, { paddingPx: 30, maxMarginRatio: 0.18 })

    expect(rect).toEqual({ x: 130, y: 90, width: 140, height: 120 })
  })

  it('keeps images unchanged when margins are already within the allowed range', () => {
    const imageData = makeWhiteImageData(400, 300)
    paintRect(imageData, 36, 36, 328, 228, [24, 24, 24])

    const rect = calculateDocxChartTrimRect(imageData, { paddingPx: 30, maxMarginRatio: 0.18 })

    expect(rect).toBeNull()
  })

  it('keeps horizontal-only whitespace because tall charts use it to preserve page-friendly aspect ratio', () => {
    const imageData = makeWhiteImageData(400, 300)
    paintRect(imageData, 150, 20, 100, 260, [24, 24, 24])

    const rect = calculateDocxChartTrimRect(imageData, { paddingPx: 30, maxMarginRatio: 0.18 })

    expect(rect).toBeNull()
  })
})
