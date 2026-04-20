/**
 * 统一的 HTML 导出内容构建
 *
 * 为什么统一到这一条路径：
 * 历史上 useExport.ts（clone DOM）和 useIPC.ts（读磁盘重渲染）两条路径并存，
 * 每次加新图表类型都得两边同步，历史 bug 多次因此复发（Mermaid 配置、DrawIO 支持、
 * ECharts 是否注册等）。现在两条路径（预览区右键、文件树右键）都调这个函数。
 *
 * 取舍（已和用户确认）：
 * - 导出基于磁盘文件，不反映编辑器未保存的修改（md-viewer 本来就是只读预览器）
 * - 预览的缩放/视图切换不带到导出里
 * - DrawIO 图能否导出取决于"文件已打开 + 滚过 drawio 块"（drawio 不能离线渲染）
 */

import { createMarkdownRenderer } from './markdownRenderer'
import { processMermaidInHtml } from './mermaidRenderer'
import { processEChartsInHtml } from './echartsRenderer'
import { processInfographicInHtml } from './infographicRenderer'
import { processMarkmapInHtml } from './markmapRenderer'
import { processGraphvizInHtml } from './graphvizRenderer'
import { processDrawioInHtml } from './drawioRenderer'
import { processPlantUMLInHtml } from './plantumlRenderer'

/**
 * 借预览 DOM 里已渲染的 DrawIO SVG 覆盖导出 HTML 里的占位。
 * 选取当前活动预览面板下的 .drawio-container svg，顺序替换 HTML 字符串里
 * processDrawioInHtml 生成的占位 <div>。
 *
 * drawio 预览 SVG 默认没 viewBox + 没 width/height，独立浏览器打开会按 300x150
 * 默认尺寸显示一小块，必须补 viewBox + 清尺寸属性。
 */
function overrideDrawioWithPreviewSvgs(html: string): string {
  if (typeof document === 'undefined') return html
  const previewSvgs = document.querySelectorAll<SVGSVGElement>(
    '.split-leaf-panel.active .drawio-container svg, .markdown-body .drawio-container svg'
  )
  if (previewSvgs.length === 0) return html

  let idx = 0
  return html.replace(
    /<div class="drawio-container" style="[^"]*"[^>]*>DrawIO 图表（需在应用内查看）<\/div>/g,
    () => {
      const svg = previewSvgs[idx++]
      if (!svg) {
        return '<div class="drawio-container" style="width: 100%; text-align: center; padding: 20px; border: 1px dashed #ccc; color: #999;">DrawIO 图表（需在应用内查看）</div>'
      }
      const cloned = svg.cloneNode(true) as SVGSVGElement

      // 补 viewBox（独立 HTML 里 SVG 没 viewBox 会被裁成 300x150）
      if (!cloned.getAttribute('viewBox')) {
        let bbox: { x: number; y: number; width: number; height: number } | null = null
        try {
          const b = svg.getBBox()
          if (b.width > 0 && b.height > 0) {
            bbox = { x: b.x, y: b.y, width: b.width, height: b.height }
          }
        } catch { /* ignore */ }
        if (!bbox) {
          const rect = svg.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            bbox = { x: 0, y: 0, width: rect.width, height: rect.height }
          }
        }
        if (bbox) {
          const pad = 10
          cloned.setAttribute(
            'viewBox',
            `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
          )
        }
      }

      cloned.removeAttribute('width')
      cloned.removeAttribute('height')
      cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      cloned.setAttribute('style', 'width: 100%; height: auto; display: block; margin: 0 auto;')
      return `<div class="drawio-container" style="width: 100%; text-align: center; margin: 1.5em 0;">${cloned.outerHTML}</div>`
    }
  )
}

/**
 * 让 Graphviz / PlantUML / Infographic 产出的 SVG 自适应容器宽度。
 *
 * 这类 WASM / 服务端渲染产物通常自带 width="1800" height="600" 硬像素属性
 * （因为它们是按原始坐标系渲染的）。独立 HTML 里容器 max-width:900 时会横向
 * 溢出被浏览器裁切或 PDF 按纸张边缘裁掉。
 *
 * 只要剥掉硬编码的 width/height，保留 viewBox，用 style:width:100%/height:auto
 * + preserveAspectRatio，浏览器就会等比缩到容器宽度。
 *
 * 为什么用正则而不是 DOMParser：
 * 1. 字符串替换阶段只有 HTML 片段，没有 DOM
 * 2. 实测每个容器内部 SVG 是单层，正则可读且稳定
 */
function makeSvgsResponsiveInContainers(html: string, containerClasses: string[]): string {
  for (const cls of containerClasses) {
    // 匹配 <div class="xxx-container" ...>...<svg ...>...</svg>...</div>
    // 非贪婪，且限定在单个容器内
    const containerRe = new RegExp(
      `(<div class="${cls}"[^>]*>)([\\s\\S]*?)(<\\/div>)`,
      'g'
    )
    html = html.replace(containerRe, (_full, open, inner, close) => {
      // 只改第一个 <svg ...> 开始标签
      const patched = inner.replace(
        /<svg\b([^>]*)>/,
        (_svgTag: string, attrs: string) => {
          // 去掉硬编码的 width / height
          let a = attrs
            .replace(/\s+width="[^"]*"/gi, '')
            .replace(/\s+height="[^"]*"/gi, '')
            .replace(/\s+width='[^']*'/gi, '')
            .replace(/\s+height='[^']*'/gi, '')
          // 合并/追加 style
          const responsiveStyle = 'max-width: 100%; height: auto; display: block; margin: 0 auto;'
          if (/\s+style="[^"]*"/i.test(a)) {
            a = a.replace(/\s+style="([^"]*)"/i, (_s, existing) => ` style="${existing}; ${responsiveStyle}"`)
          } else {
            a += ` style="${responsiveStyle}"`
          }
          // preserveAspectRatio 没就加
          if (!/\bpreserveAspectRatio\s*=/i.test(a)) {
            a += ' preserveAspectRatio="xMidYMid meet"'
          }
          return `<svg${a}>`
        }
      )
      return `${open}${patched}${close}`
    })
  }
  return html
}

/**
 * 把 Markdown 文本构建成导出用的 HTML 内容（不含 HTML 模板外壳，只是 body 内容）。
 * 主进程 ipcMain.handle('export:html') 会再套上 <!DOCTYPE html>... 模板。
 */
export async function buildExportHtmlContent(markdown: string): Promise<string> {
  const md = createMarkdownRenderer()
  let html = md.render(markdown)

  // 所有图表类型按固定顺序处理
  html = await processMermaidInHtml(html)
  html = await processEChartsInHtml(html)
  html = await processInfographicInHtml(html)
  html = await processMarkmapInHtml(html)
  html = await processGraphvizInHtml(html)
  html = await processDrawioInHtml(html)
  html = await processPlantUMLInHtml(html)

  // DrawIO 特殊：借预览 DOM 的 SVG 覆盖占位（如果当前有打开的预览）
  html = overrideDrawioWithPreviewSvgs(html)

  // 超宽 SVG 自适应：剥硬编码 width/height，改用 max-width:100%
  html = makeSvgsResponsiveInContainers(html, [
    'graphviz-container',
    'plantuml-container',
    'infographic-container',
  ])

  return html
}
