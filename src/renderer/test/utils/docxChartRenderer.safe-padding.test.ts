import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSvgSafePaddingForDocx, calculateDocxChartTrimRect, calculateDocxImageWidthCm, renderChartsForDocx } from '../../src/utils/docxChartRenderer'

const mockRenderExcalidrawToSvg = vi.hoisted(() => vi.fn())
const mockRenderInfographicToSvg = vi.hoisted(() => vi.fn())
const mockRenderDrawioInElement = vi.hoisted(() => vi.fn())
const mockValidateDrawioCode = vi.hoisted(() => vi.fn())
const mockRenderVegaLiteToSvg = vi.hoisted(() => vi.fn())
const mockRenderD2ToSvg = vi.hoisted(() => vi.fn())
const mockRenderBpmnToSvg = vi.hoisted(() => vi.fn())
const mockRenderWaveDromToSvg = vi.hoisted(() => vi.fn())
const mockRenderPlantUMLToSvg = vi.hoisted(() => vi.fn())
const mockRenderStructurizrToSvg = vi.hoisted(() => vi.fn())
const mockRenderPlotlyToSvg = vi.hoisted(() => vi.fn())
const mockRenderDbmlToSvg = vi.hoisted(() => vi.fn())
const mockRenderAntvG6ToSvg = vi.hoisted(() => vi.fn())
const mockRenderKrokiToSvg = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/excalidrawRenderer', () => ({
  renderExcalidrawToSvg: mockRenderExcalidrawToSvg,
}))

vi.mock('../../src/utils/infographicRenderer', () => ({
  renderInfographicToSvg: mockRenderInfographicToSvg,
}))

vi.mock('../../src/utils/drawioRenderer', () => ({
  renderDrawioInElement: mockRenderDrawioInElement,
  validateDrawioCode: mockValidateDrawioCode,
}))

vi.mock('../../src/utils/vegaLiteRenderer', () => ({
  renderVegaLiteToSvg: mockRenderVegaLiteToSvg,
}))

vi.mock('../../src/utils/d2Renderer', () => ({
  renderD2ToSvg: mockRenderD2ToSvg,
}))

vi.mock('../../src/utils/bpmnRenderer', () => ({
  renderBpmnToSvg: mockRenderBpmnToSvg,
  isMissingReadBpmnFileHandlerError: (error: unknown) => String((error as Error)?.message || error).includes('No handler registered')
    && String((error as Error)?.message || error).includes('fs:readBpmnFile'),
  resolveBpmnFallbackPath: (markdownFilePath: string, refPath: string) => {
    const baseDir = markdownFilePath.replace(/[/\\][^/\\]*$/, '')
    return `${baseDir}/${refPath.replace(/^\.\//, '')}`
  },
}))

vi.mock('../../src/utils/wavedromRenderer', () => ({
  renderWaveDromToSvg: mockRenderWaveDromToSvg,
}))

vi.mock('../../src/utils/plantumlRenderer', () => ({
  renderPlantUMLToSvg: mockRenderPlantUMLToSvg,
}))

vi.mock('../../src/utils/structurizrRenderer', () => ({
  renderStructurizrToSvg: mockRenderStructurizrToSvg,
}))

vi.mock('../../src/utils/plotlyRenderer', () => ({
  renderPlotlyToSvg: mockRenderPlotlyToSvg,
}))

vi.mock('../../src/utils/dbmlRenderer', () => ({
  renderDbmlToSvg: mockRenderDbmlToSvg,
}))

vi.mock('../../src/utils/antvG6Renderer', () => ({
  renderAntvG6ToSvg: mockRenderAntvG6ToSvg,
}))

vi.mock('../../src/utils/krokiRenderer', () => ({
  renderKrokiToSvg: mockRenderKrokiToSvg,
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

describe('DOCX chart image sizing', () => {
  it('keeps normal landscape charts within the maximum content width', () => {
    expect(calculateDocxImageWidthCm(1600, 900)).toBe(15.5)
  })

  it('shrinks tall charts so their inserted height does not exceed the page budget', () => {
    const widthCm = calculateDocxImageWidthCm(2348, 7790)
    expect(widthCm).toBeCloseTo(7.23, 1)
    expect(widthCm * (7790 / 2348)).toBeLessThanOrEqual(24.1)
  })

  it('does not enlarge tiny charts beyond the normal chart width', () => {
    expect(calculateDocxImageWidthCm(400, 120)).toBe(15.5)
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
    mockRenderInfographicToSvg.mockResolvedValue('<svg viewBox="0 0 800 600"><rect width="800" height="600"></rect></svg>')
    mockValidateDrawioCode.mockReturnValue({ valid: true })
    mockRenderVegaLiteToSvg.mockResolvedValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderD2ToSvg.mockResolvedValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderBpmnToSvg.mockResolvedValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderWaveDromToSvg.mockReturnValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderPlantUMLToSvg.mockResolvedValue('<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>')
    mockRenderStructurizrToSvg.mockReturnValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderPlotlyToSvg.mockResolvedValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderDbmlToSvg.mockReturnValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderAntvG6ToSvg.mockReturnValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderKrokiToSvg.mockResolvedValue({ ok: true, svg: '<svg viewBox="0 0 800 360"><rect width="800" height="360"></rect></svg>' })
    mockRenderDrawioInElement.mockImplementation(async (_code: string, container: HTMLElement) => {
      container.innerHTML = '<svg viewBox="0 0 320 140"><rect width="320" height="140"></rect></svg>'
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

  it('DOCX 图表管线识别 infographic 代码块并替换为图片占位符', async () => {
    const result = await renderChartsForDocx('```infographic\nlist-row-simple-horizontal-arrow\ndata\n  title 产品开发流程\n```')

    expect(mockRenderInfographicToSvg).toHaveBeenCalled()
    expect(result.images.length).toBe(1)
    expect(result.modifiedMarkdown).toMatch(/!\[\]\(mdv__chart__/)
    expect(result.modifiedMarkdown).not.toContain('```infographic')
  })

  it('DOCX 图表管线将 dio 别名归一为 drawio 并使用 DrawIO DOM fallback', async () => {
    document.body.innerHTML = [
      '<div class="markdown-body">',
      '<div class="drawio-container"><svg viewBox="0 0 300 120"><rect width="300" height="120"></rect></svg></div>',
      '</div>',
    ].join('')

    const result = await renderChartsForDocx('```dio\n<mxGraphModel><root></root></mxGraphModel>\n```')

    expect(result.images.length).toBe(1)
    expect(result.modifiedMarkdown).toMatch(/!\[\]\(mdv__chart__/)
    expect(result.modifiedMarkdown).not.toContain('<mxGraphModel')
  })

  it('DOCX 图表管线识别新增 RendererPlugin 代码块', async () => {
    const markdown = [
      '```vega-lite',
      '{"data":{"values":[]},"mark":"bar"}',
      '```',
      '',
      '```d2',
      'a -> b',
      '```',
      '',
      '```bpmn',
      '<definitions />',
      '```',
      '',
      '```wavedrom',
      "{ signal: [{ name: 'clk', wave: 'p..P' }] }",
      '```',
      '',
      '```c4',
      '@startuml',
      'Person(user, "用户")',
      '@enduml',
      '```',
      '',
      '```structurizr',
      'workspace "x" { model { user = person "User" } }',
      '```',
      '',
      '```plotly',
      '{"data":[{"type":"bar","x":["A"],"y":[1]}]}',
      '```',
      '',
      '```dbml',
      'Table users { id int [pk] }',
      '```',
      '',
      '```antv-g6',
      '{"nodes":[{"id":"a"}],"edges":[]}',
      '```',
      '',
      '```nomnoml',
      '[A]->[B]',
      '```',
    ].join('\n')

    const result = await renderChartsForDocx(markdown)

    expect(mockRenderVegaLiteToSvg).toHaveBeenCalled()
    expect(mockRenderD2ToSvg).toHaveBeenCalled()
    expect(mockRenderBpmnToSvg).toHaveBeenCalled()
    expect(mockRenderWaveDromToSvg).toHaveBeenCalled()
    expect(mockRenderPlantUMLToSvg).toHaveBeenCalled()
    expect(mockRenderStructurizrToSvg).toHaveBeenCalled()
    expect(mockRenderPlotlyToSvg).toHaveBeenCalled()
    expect(mockRenderDbmlToSvg).toHaveBeenCalled()
    expect(mockRenderAntvG6ToSvg).toHaveBeenCalled()
    expect(mockRenderKrokiToSvg).toHaveBeenCalledWith(expect.any(String), { language: 'nomnoml' })
    expect(result.images.length).toBe(10)
    expect(result.modifiedMarkdown.match(/mdv__chart__/g)?.length).toBe(10)
    expect(result.modifiedMarkdown).not.toContain('```vega-lite')
    expect(result.modifiedMarkdown).not.toContain('```c4')
    expect(result.modifiedMarkdown).not.toContain('```structurizr')
    expect(result.modifiedMarkdown).not.toContain('```nomnoml')
  })

  it('DOCX 图表管线在预览 DOM 缺失时主动离屏渲染 DrawIO', async () => {
    document.body.innerHTML = ''
    const markdown = [
      '```drawio',
      '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>',
      '```',
      '',
      '```drawio',
      '<mxGraphModel><root><mxCell id="1"/></root></mxGraphModel>',
      '```',
    ].join('\n')

    const result = await renderChartsForDocx(markdown)

    expect(mockRenderDrawioInElement).toHaveBeenCalledTimes(2)
    expect(result.images.length).toBe(2)
    expect(result.modifiedMarkdown.match(/mdv__chart__/g)?.length).toBe(2)
    expect(result.modifiedMarkdown).not.toContain('```drawio')
    expect(result.warnings.join('\n')).not.toContain('drawio 图表渲染失败')
  })

  it('DOCX 文件引用缺少 markdownFilePath 时产生 warning', async () => {
    const result = await renderChartsForDocx('![图](./a.excalidraw)')
    expect(result.warnings.join('\n')).toContain('缺少 Markdown 文件路径')
  })

  it('DOCX BPMN 文件引用读取并替换为图片占位符', async () => {
    const readBpmnFile = vi.fn().mockResolvedValue({
      content: '<definitions />',
      resolvedPath: '/docs/flow.bpmn',
    })
    global.window.api = {
      ...global.window.api,
      readBpmnFile,
    } as typeof window.api

    const result = await renderChartsForDocx('![流程](./flow.bpmn?raw=1#v)', {
      markdownFilePath: '/docs/doc.md',
    })

    expect(readBpmnFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/doc.md',
      refPath: './flow.bpmn',
    })
    expect(result.images.length).toBe(1)
    expect(result.modifiedMarkdown).toMatch(/!\[流程\]\(mdv__chart__/)
  })

  it('DOCX BPMN 文件引用在 readBpmnFile handler 缺失时回退到 readFile', async () => {
    const readBpmnFile = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'fs:readBpmnFile': Error: No handler registered for 'fs:readBpmnFile'")
    )
    const readFile = vi.fn().mockResolvedValue('<definitions />')
    global.window.api = {
      ...global.window.api,
      readBpmnFile,
      readFile,
    } as typeof window.api

    const result = await renderChartsForDocx('![流程](./flow.bpmn)', {
      markdownFilePath: '/docs/doc.md',
    })

    expect(readBpmnFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/doc.md',
      refPath: './flow.bpmn',
    })
    expect(readFile).toHaveBeenCalledWith('/docs/flow.bpmn')
    expect(result.images.length).toBe(1)
    expect(result.modifiedMarkdown).toMatch(/!\[流程\]\(mdv__chart__/)
    expect(result.warnings.join('\n')).not.toContain('No handler registered')
  })

  it('DOCX 文件引用扫描跳过 fenced code block 内的示例', async () => {
    const markdown = '```md\n![图](./a.excalidraw)\n```'
    const result = await renderChartsForDocx(markdown)

    expect(result.modifiedMarkdown).toBe(markdown)
    expect(result.images.length).toBe(0)
    expect(result.warnings.join('\n')).not.toContain('Excalidraw 文件')
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
    expect(result.warnings.join('\n')).toContain('Excalidraw 文件“./bad.excalidraw”渲染失败')
  })

  it('DOCX 文件引用读取失败时隐藏底层 IPC 错误细节', async () => {
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'fs:readExcalidrawFile': Error: ENOENT: no such file or directory, lstat '/docs/missing.excalidraw'")
      ),
    } as typeof window.api

    const result = await renderChartsForDocx('![缺失文件](./missing.excalidraw)', {
      markdownFilePath: '/docs/doc.md',
    })

    const warning = result.warnings.join('\n')
    expect(warning).toContain('Excalidraw 文件“./missing.excalidraw”读取失败：文件不存在')
    expect(warning).not.toContain('Error invoking remote method')
    expect(warning).not.toContain('/docs/missing.excalidraw')
  })

  it('DOCX 图表管线会渲染全部 Excalidraw 图表而不是按数量跳过', async () => {
    const markdown = Array.from({ length: 3 }, (_, index) => [
      '```excalidraw',
      `{"type":"excalidraw","elements":[{"id":"${index}","type":"rectangle","x":0,"y":0,"width":10,"height":10}]}`,
      '```',
    ].join('\n')).join('\n\n')

    const result = await renderChartsForDocx(markdown)

    expect(result.images.length).toBe(3)
    expect(result.modifiedMarkdown.match(/mdv__chart__/g)?.length).toBe(3)
    expect(result.modifiedMarkdown).not.toContain('```excalidraw')
    expect(result.warnings.join('\n')).not.toContain('超过 DOCX 服务上限')
  })
})
