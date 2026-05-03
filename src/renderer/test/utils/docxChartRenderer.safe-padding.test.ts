import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSvgSafePaddingForDocx, calculateDocxChartTrimRect, renderChartsForDocx } from '../../src/utils/docxChartRenderer'

const mockRenderExcalidrawToSvg = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/excalidrawRenderer', () => ({
  renderExcalidrawToSvg: mockRenderExcalidrawToSvg,
}))

let originalWindowApi: typeof window.api | undefined

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

describe('DOCX Excalidraw chart rendering', () => {
  beforeEach(() => {
    originalWindowApi = global.window.api
    vi.clearAllMocks()
    mockRenderExcalidrawToSvg.mockResolvedValue({
      ok: true,
      svg: '<svg viewBox="0 0 100 60"><rect width="100" height="60"></rect></svg>',
    })
    global.window.api = {
      ...global.window.api,
      renderSvgToPng: vi.fn().mockResolvedValue({
        success: true,
        data: 'a'.repeat(240),
      }),
    } as typeof window.api
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new Error('skip trim in test')
      }),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${'a'.repeat(240)}`)
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      width = 100
      height = 60
      naturalWidth = 100
      naturalHeight = 60

      set src(_value: string) {
        this.onload?.()
      }
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    global.window.api = originalWindowApi as typeof window.api
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('DOCX 图表管线识别 excalidraw 代码块并生成占位图片', async () => {
    const result = await renderChartsForDocx('```excalidraw\n{"type":"excalidraw","elements":[]}\n```')
    expect(result.modifiedMarkdown).toMatch(/!\[\]\(mdv__chart__/)
    expect(result.images.length).toBe(1)
  })

  it('DOCX 文件引用缺少 markdownFilePath 时产生 warning', async () => {
    const result = await renderChartsForDocx('![图](./a.excalidraw)')
    expect(result.warnings.join('\n')).toContain('markdownFilePath')
  })

  it('DOCX 文件引用扫描跳过 fenced code block 内的示例', async () => {
    const markdown = '```md\n![图](./a.excalidraw)\n```'
    const result = await renderChartsForDocx(markdown)

    expect(result.modifiedMarkdown).toBe(markdown)
    expect(result.images.length).toBe(0)
    expect(result.warnings.join('\n')).not.toContain('excalidraw file reference')
  })

  it('DOCX 文件引用替换不会改动 fenced code block 内的相同文本', async () => {
    const rawCode = '{"type":"excalidraw","elements":[]}'
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile: vi.fn().mockResolvedValue({
        content: rawCode,
        resolvedPath: '/docs/a.excalidraw',
      }),
    } as typeof window.api
    const markdown = [
      '```md',
      '![图](./a.excalidraw)',
      '```',
      '',
      '![图](./a.excalidraw)',
    ].join('\n')

    const result = await renderChartsForDocx(markdown, {
      markdownFilePath: '/docs/doc.md',
    })

    expect(result.images.length).toBe(1)
    expect(result.modifiedMarkdown).toMatch(/^```md\n!\[图\]\(\.\/a\.excalidraw\)\n```/)
    expect(result.modifiedMarkdown).toMatch(/\n\n!\[图\]\(mdv__chart__/)
  })

  it('DOCX 文件引用读取时支持 angle/title 并计入进度', async () => {
    const rawCode = '{"type":"excalidraw","elements":[]}'
    const readExcalidrawFile = vi.fn().mockResolvedValue({
      content: rawCode,
      resolvedPath: '/docs/a.excalidraw',
    })
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile,
    } as typeof window.api
    const onProgress = vi.fn()
    const markdown = [
      '```excalidraw',
      '{"type":"excalidraw","elements":[]}',
      '```',
      '',
      '![图](<./a.excalidraw?raw=1#v> "标题")',
    ].join('\n')

    const result = await renderChartsForDocx(markdown, {
      markdownFilePath: '/docs/doc.md',
      onProgress,
    })

    expect(readExcalidrawFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/doc.md',
      refPath: './a.excalidraw',
    })
    expect(result.images.length).toBe(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, 'excalidraw')
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, 'excalidraw')
  })

  it('DOCX 文件引用渲染失败时不使用预览 DOM fallback', async () => {
    document.body.innerHTML = '<div class="markdown-body"><div class="excalidraw-container"><svg viewBox="0 0 100 60"></svg></div></div>'
    mockRenderExcalidrawToSvg.mockResolvedValue({
      ok: false,
      error: 'bad file',
      warnings: [],
      sourceKind: 'file-reference',
    })
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile: vi.fn().mockResolvedValue({
        content: '{"bad":true}',
        resolvedPath: '/docs/bad.excalidraw',
      }),
    } as typeof window.api

    const result = await renderChartsForDocx('![图](./bad.excalidraw)', {
      markdownFilePath: '/docs/doc.md',
    })

    expect(result.images.length).toBe(0)
    expect(result.modifiedMarkdown).toBe('![图](./bad.excalidraw)')
    expect(result.warnings.join('\n')).toContain('render failed')
  })
})
