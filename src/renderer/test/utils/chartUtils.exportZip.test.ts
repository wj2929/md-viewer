import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectExportableChartPngs,
  countExportableCharts,
} from '../../src/utils/chartUtils'

describe('chart zip export helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts only chart wrappers that contain SVG content', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="mermaid-wrapper">
        <div class="mermaid-container"><svg viewBox="0 0 120 60"></svg></div>
      </div>
      <div class="kroki-wrapper" data-kroki-format="tikz">
        <div class="kroki-container"><svg viewBox="0 0 80 40"></svg></div>
      </div>
      <div class="d2-wrapper">
        <div class="d2-container"></div>
      </div>
      <pre><code>not a chart</code></pre>
    `

    expect(countExportableCharts(root)).toBe(2)
  })

  it('converts SVG charts to numbered PNG payloads for the zip file', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="mermaid-wrapper">
        <div class="mermaid-container"><svg viewBox="0 0 120 60"></svg></div>
      </div>
      <div class="kroki-wrapper" data-kroki-format="tikz">
        <div class="kroki-container"><svg viewBox="0 0 80 40"></svg></div>
      </div>
      <div class="c4plantuml-wrapper">
        <div class="plantuml-container"><svg viewBox="0 0 100 80"></svg></div>
      </div>
    `

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({
        x: 0,
        y: 0,
        width: 120,
        height: 60,
      })),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
    } as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H')

    class TestImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('Image', TestImage)

    await expect(collectExportableChartPngs(root)).resolves.toEqual([
      { filename: '01-mermaid.png', pngBase64: 'UE5H' },
      { filename: '02-kroki-tikz.png', pngBase64: 'UE5H' },
      { filename: '03-c4plantuml.png', pngBase64: 'UE5H' },
    ])
  })

  it('preserves SVG viewBox aspect ratio when layout metrics are unavailable', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="bpmn-wrapper">
        <div class="bpmn-container">
          <svg width="446" viewBox="110 60 446 165.6">
            <circle cx="128" cy="128" r="18"></circle>
            <text x="117" y="160">提交</text>
          </svg>
        </div>
      </div>
    `

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('SVG layout is unavailable')
      }),
    })
    Object.defineProperty(SVGElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 0,
    })
    Object.defineProperty(SVGElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 0,
    })

    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
    } as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H')

    class TestImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('Image', TestImage)

    await expect(collectExportableChartPngs(root)).resolves.toEqual([
      { filename: '01-bpmn.png', pngBase64: 'UE5H' },
    ])
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 932, 372)
  })

  it('ignores anomalous SVG bounding boxes that are far wider than the viewBox', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="mermaid-wrapper">
        <div class="mermaid-container">
          <svg width="100%" viewBox="0 0 949 244">
            <g><path d="M0 0h949v244H0z"></path></g>
          </svg>
        </div>
      </div>
    `

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({
        x: 0,
        y: 8.5,
        width: 13991,
        height: 210.5,
      })),
    })

    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
      getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255),
        width,
        height,
      })),
    } as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H')

    class TestImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('Image', TestImage)

    await expect(collectExportableChartPngs(root)).resolves.toEqual([
      { filename: '01-mermaid.png', pngBase64: 'UE5H' },
    ])
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1938, 528)
  })

  it('uses rendered viewport for markmap SVGs because foreignObject labels are not included in getBBox', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="markmap-wrapper">
        <div class="markmap-container">
          <svg class="markmap" width="100%" height="400">
            <g transform="translate(69 209) scale(1.3)">
              <path d="M0 0 C100 0 200 0 300 0"></path>
              <foreignObject x="300" y="-30" width="300" height="60">
                <div>🌯 Burrito</div>
              </foreignObject>
            </g>
          </svg>
        </div>
      </div>
    `

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({
        x: 68,
        y: 10,
        width: 585,
        height: 381,
      })),
    })
    Object.defineProperty(SVGElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 721,
    })
    Object.defineProperty(SVGElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    })

    const drawImage = vi.fn()
    let serializedSvg = ''
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
      getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255),
        width,
        height,
      })),
    } as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H')

    class TestImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(value: string) {
        serializedSvg = decodeURIComponent(value.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('Image', TestImage)

    await expect(collectExportableChartPngs(root)).resolves.toEqual([
      { filename: '01-markmap.png', pngBase64: 'UE5H' },
    ])
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1482, 840)
    expect(serializedSvg).toContain('width="332"')
  })

  it('trims exported PNG whitespace around actual chart pixels', async () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="dbml-wrapper">
        <div class="dbml-container">
          <svg viewBox="0 0 240 100">
            <rect width="240" height="100" fill="#ffffff"></rect>
            <rect x="80" y="20" width="40" height="20" fill="#172033"></rect>
          </svg>
        </div>
      </div>
    `

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({
        x: 0,
        y: 0,
        width: 240,
        height: 100,
      })),
    })

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      const canvas = this
      return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        getImageData: vi.fn((x: number, y: number, width: number, height: number) => {
          const data = new Uint8ClampedArray(width * height * 4).fill(255)
          for (let py = 40; py < 80; py++) {
            for (let px = 160; px < 240; px++) {
              const offset = (py * canvas.width + px) * 4
              data[offset] = 23
              data[offset + 1] = 32
              data[offset + 2] = 51
              data[offset + 3] = 255
            }
          }
          return { data, width, height }
        }),
      } as any
    })

    const dataUrlSizes: Array<{ width: number; height: number }> = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function toDataURL(this: HTMLCanvasElement) {
      dataUrlSizes.push({ width: this.width, height: this.height })
      return 'data:image/png;base64,UE5H'
    })

    class TestImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('Image', TestImage)

    await expect(collectExportableChartPngs(root)).resolves.toEqual([
      { filename: '01-dbml.png', pngBase64: 'UE5H' },
    ])
    expect(dataUrlSizes).toEqual([{ width: 120, height: 80 }])
  })
})
