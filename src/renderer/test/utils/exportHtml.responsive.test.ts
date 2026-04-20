// @ts-nocheck
/**
 * 回归保障：导出 HTML 里 Graphviz/PlantUML/Infographic 的 SVG 应自适应宽度
 *
 * 历史问题：这类 WASM/服务端渲染产出的 SVG 自带 width="1800" 硬像素属性，
 * 独立 HTML 打开会超出容器裁切，PDF 导出也横向溢出。
 *
 * 不变式：导出 HTML 文本里，上述容器内的 <svg> 开始标签不应再有 width=/height= 硬属性，
 * 且应该有 max-width:100% 的 style
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildExportHtmlContent } from '../../src/utils/exportHtml'

// Mock 所有 process* 渲染器，只测 responsive 后处理
vi.mock('../../src/utils/markdownRenderer', () => ({
  createMarkdownRenderer: () => ({
    render: (md: string) => md,
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

describe('buildExportHtmlContent - SVG 自适应', () => {
  beforeEach(() => {
    // jsdom 下已经有 document，此处不做处理
  })

  it('graphviz-container 里的 SVG 剥掉 width/height 并加 max-width:100%', async () => {
    const input =
      '<div class="graphviz-container" style="width: 100%; text-align: center;">' +
      '<svg width="1800" height="600" viewBox="0 0 1800 600"><g></g></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).not.toMatch(/<svg[^>]*\swidth="1800"/)
    expect(out).not.toMatch(/<svg[^>]*\sheight="600"/)
    expect(out).toMatch(/<svg[^>]*style="[^"]*max-width:\s*100%/)
    expect(out).toMatch(/viewBox="0 0 1800 600"/)
  })

  it('plantuml-container 同样处理', async () => {
    const input =
      '<div class="plantuml-container">' +
      '<svg width="900" height="500" viewBox="0 0 900 500"></svg>' +
      '</div>'
    const out = await buildExportHtmlContent(input)
    expect(out).not.toMatch(/<svg[^>]*\swidth="900"/)
    expect(out).toMatch(/max-width:\s*100%/)
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
    expect(out).toMatch(/style="[^"]*background:#fff[^"]*max-width:\s*100%/)
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
})
