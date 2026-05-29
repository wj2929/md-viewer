// @ts-nocheck
/**
 * 回归保障：导出 HTML 里 Graphviz/PlantUML/Infographic 的 SVG 应自适应宽度
 *
 * 历史问题：这类 WASM/服务端渲染产出的 SVG 自带 width="1800" 硬像素属性，
 * 独立 HTML 打开会超出容器裁切，PDF 导出也横向溢出。
 *
 * 不变式：导出 HTML 文本里，上述容器内的 <svg> 开始标签不应再有 width=/height= 硬属性，
 * 且应该按自身宽度设置自适应上限，避免小图被撑满整行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildExportHtmlContent, normalizeDrawioSvgForExport } from '../../src/utils/exportHtml'

const mockRenderExcalidrawToSvg = vi.hoisted(() => vi.fn())

// Mock 所有 process* 渲染器，只测 responsive 后处理
vi.mock('../../src/utils/markdownRenderer', () => ({
  createMarkdownRenderer: () => ({
    render: (md: string) => {
      const excalidrawBlock = md.match(/^```excalidraw\n([\s\S]*)\n```$/)
      if (excalidrawBlock) {
        return `<pre class="language-excalidraw"><code class="language-excalidraw">${excalidrawBlock[1]}</code></pre>`
      }
      const excalidrawImage = md.match(/^!\[([^\]]*)\]\(([^)]+\.excalidraw(?:[?#][^)]*)?)\)$/)
      if (excalidrawImage) {
        return `<p><img src="${excalidrawImage[2]}" alt="${excalidrawImage[1]}"></p>`
      }
      const pngImage = md.match(/^!\[([^\]]*)\]\(([^)]+\.png(?:[?#][^)]*)?)\)$/)
      if (pngImage) {
        return `<p><img src="${pngImage[2]}" alt="${pngImage[1]}"></p>`
      }
      return md
    },
  }),
}))
vi.mock('../../src/utils/mermaidRenderer', () => ({
  processMermaidInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/echartsRenderer', () => ({
  processEChartsInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/infographicRenderer', () => ({
  processInfographicInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/markmapRenderer', () => ({
  processMarkmapInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/drawioRenderer', () => ({
  processDrawioInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/plantumlRenderer', () => ({
  processPlantUMLInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/graphvizRenderer', () => ({
  processGraphvizInHtml: (h: string) => Promise.resolve(h),
}))
vi.mock('../../src/utils/excalidrawRenderer', () => ({
  renderExcalidrawToSvg: mockRenderExcalidrawToSvg,
}))

describe('buildExportHtmlContent - SVG 自适应', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRenderExcalidrawToSvg.mockResolvedValue({
      ok: true,
      svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100"></rect></svg>',
    })
    global.window.api = {
      ...global.window.api,
    }
  })

  it('graphviz-container 里的 SVG 剥掉 width/height 并按自身 viewBox 宽度自适应', async () => {
    const input =
      '<div class="graphviz-container" style="width: 100%; text-align: center;">' +
      '<svg width="1800" height="600" viewBox="0 0 1800 600"><g></g></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).not.toMatch(/<svg[^>]*\swidth="1800"/)
    expect(out).not.toMatch(/<svg[^>]*\sheight="600"/)
    expect(out).toMatch(/<svg[^>]*style="[^"]*width:\s*min\(100%,\s*1800px\)/)
    expect(out).toMatch(/viewBox="0 0 1800 600"/)
  })

  it('graphviz-container 小图不应在 HTML 导出中被撑满整行', async () => {
    const input =
      '<div class="graphviz-container">' +
      '<svg width="134pt" height="188pt" viewBox="0.00 0.00 134.00 188.00"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).toMatch(/<svg[^>]*style="[^"]*width:\s*min\(100%,\s*134px\)/)
    expect(out).not.toMatch(/<svg[^>]*style="[^"]*max-width:\s*100%;\s*height/)
  })

  it('plantuml-container 同样处理', async () => {
    const input =
      '<div class="plantuml-container">' +
      '<svg width="900" height="500" viewBox="0 0 900 500"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).not.toMatch(/<svg[^>]*\swidth="900"/)
    expect(out).toMatch(/width:\s*min\(100%,\s*900px\)/)
  })

  it('infographic-container 同样处理', async () => {
    const input =
      '<div class="infographic-container">' +
      '<svg width="2000" height="1200" viewBox="0 0 2000 1200"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).not.toMatch(/<svg[^>]*\swidth="2000"/)
  })

  it('已有 style 属性的 SVG 追加而非覆盖', async () => {
    const input =
      '<div class="graphviz-container">' +
      '<svg width="1200" height="400" style="background:#fff" viewBox="0 0 1200 400"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).toMatch(/style="[^"]*background:#fff[^"]*width:\s*min\(100%,\s*1200px\)/)
  })

  it('不影响非目标容器里的 SVG', async () => {
    const input =
      '<div class="markmap-container"><svg width="500" height="300"></svg></div>'
    const out = await buildExportHtmlContent(input)
    // markmap 不在列表里，保持原样
    expect(out).toMatch(/<svg[^>]*\swidth="500"/)
  })

  it('preserveAspectRatio 没有时自动补', async () => {
    const input =
      '<div class="graphviz-container">' +
      '<svg width="800" height="600" viewBox="0 0 800 600"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).toMatch(/preserveAspectRatio="xMidYMid meet"/)
  })

  it('DrawIO 导出对超高图应限制高度并避免无限放大', () => {
    document.body.innerHTML = `
      <svg style="width: 100px; height: 100px;">
        <rect x="10" y="10" width="220" height="700"></rect>
      </svg>
    `
    const svg = document.querySelector('svg') as SVGSVGElement
    const rect = svg.querySelector('rect') as SVGRectElement

    const svgMatrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse: () => svgMatrix,
    }
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => svgMatrix,
    })
    vi.spyOn(rect, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      right: 230,
      bottom: 710,
      width: 220,
      height: 700,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect)

    normalizeDrawioSvgForExport(svg, svg)

    expect(svg.getAttribute('style')).toContain('max-height: 680px')
    expect(svg.getAttribute('style')).toContain('min(100%,')
  })

  it('DrawIO 导出对普通图应按自身宽度上限展示而不是默认撑满整行', () => {
    document.body.innerHTML = `
      <svg style="width: 100px; height: 100px;">
        <rect x="10" y="10" width="380" height="220"></rect>
      </svg>
    `
    const svg = document.querySelector('svg') as SVGSVGElement
    const rect = svg.querySelector('rect') as SVGRectElement

    const svgMatrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse: () => svgMatrix,
    }
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => svgMatrix,
    })
    vi.spyOn(rect, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      right: 390,
      bottom: 230,
      width: 380,
      height: 220,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect)

    normalizeDrawioSvgForExport(svg, svg)

    expect(svg.getAttribute('style')).toContain('width: min(100%, 400px)')
    expect(svg.getAttribute('style')).toContain('max-height: 680px')
  })

  it('HTML 导出渲染 excalidraw 代码块为容器 SVG', async () => {
    const out = await buildExportHtmlContent('```excalidraw\n{"type":"excalidraw","elements":[]}\n```')
    expect(out).toContain('excalidraw-container')
    expect(out).toContain('<svg')
  })

  it('缺少 markdownFilePath 时 .excalidraw 文件引用导出为可见错误', async () => {
    const out = await buildExportHtmlContent('![图](./a.excalidraw)')
    expect(out).toContain('Excalidraw 渲染失败')
    expect(out).toContain('./a.excalidraw')
  })

  it('不含 Excalidraw 时保留原始 HTML 片段', async () => {
    const input = '</div><p>保留原始片段</p>'
    const out = await buildExportHtmlContent(input)
    expect(out).toBe(input)
  })

  it('导出 .excalidraw 文件引用时清理 query 和 fragment 后读取文件', async () => {
    const rawCode = '{"type":"excalidraw","elements":[]}'
    const readExcalidrawFile = vi.fn().mockResolvedValue({
      content: rawCode,
      resolvedPath: '/docs/a.excalidraw',
    })
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile,
    }

    const out = await buildExportHtmlContent('![图](./a.excalidraw?raw=1#v)', {
      markdownFilePath: '/docs/doc.md',
    })

    expect(readExcalidrawFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/doc.md',
      refPath: './a.excalidraw',
    })
    expect(mockRenderExcalidrawToSvg).toHaveBeenCalledWith(rawCode, {
      sourceKind: 'file-reference',
      sourceLabel: '图',
    })
    expect(out).toContain('excalidraw-container')
    expect(out).toContain('<svg')
  })

  it('导出 markdown 渲染后的 .excalidraw 占位符时应替换为 SVG', async () => {
    const rawCode = '{"type":"excalidraw","elements":[]}'
    const readExcalidrawFile = vi.fn().mockResolvedValue({
      content: rawCode,
      resolvedPath: '/docs/a.excalidraw',
    })
    global.window.api = {
      ...global.window.api,
      readExcalidrawFile,
    }

    const out = await buildExportHtmlContent(
      '<div class="excalidraw-file-placeholder" data-excalidraw-src="./a.excalidraw" data-excalidraw-alt="占位图"></div>',
      { markdownFilePath: '/docs/doc.md' },
    )

    expect(readExcalidrawFile).toHaveBeenCalledWith({
      markdownFilePath: '/docs/doc.md',
      refPath: './a.excalidraw',
    })
    expect(mockRenderExcalidrawToSvg).toHaveBeenCalledWith(rawCode, {
      sourceKind: 'file-reference',
      sourceLabel: '占位图',
    })
    expect(out).toContain('excalidraw-container')
    expect(out).toContain('<svg')
    expect(out).not.toContain('excalidraw-file-placeholder')
  })

  it('导出普通本地图片时内嵌为 data URI，避免 PDF 临时目录丢图', async () => {
    const readLocalAssetBase64 = vi.fn().mockResolvedValue({
      base64: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      resolvedPath: '/docs/images/welcome.png',
    })
    global.window.api = {
      ...global.window.api,
      readLocalAssetBase64,
    }

    const out = await buildExportHtmlContent('![欢迎图](./images/welcome.png)', {
      markdownFilePath: '/docs/user-manual.md',
    })

    expect(readLocalAssetBase64).toHaveBeenCalledWith({
      markdownFilePath: '/docs/user-manual.md',
      refPath: './images/welcome.png',
    })
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(out).not.toContain('src="./images/welcome.png"')
  })
})

describe('normalizeDrawioSvgForExport', () => {
  it('使用可见图形边界重算 viewBox，避免 DrawIO 导出图表视觉偏右', () => {
    document.body.innerHTML = `
      <svg style="width: 100px; height: 100px;">
        <g transform="translate(-100,0)">
          <rect x="120" y="20" width="200" height="80"></rect>
        </g>
      </svg>
    `
    const svg = document.querySelector('svg') as SVGSVGElement
    const rect = svg.querySelector('rect') as SVGRectElement

    const svgMatrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      inverse: () => svgMatrix,
    }
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => svgMatrix,
    })
    vi.spyOn(rect, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 20,
      right: 220,
      bottom: 100,
      width: 200,
      height: 80,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect)

    normalizeDrawioSvgForExport(svg, svg)

    expect(svg.getAttribute('viewBox')).toBe('10 10 220 100')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('style')).toContain('width: min(100%, 220px)')
  })
})
