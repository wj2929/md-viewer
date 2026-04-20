/**
 * 端到端回归：Mermaid 导出 HTML 节点视觉正确
 *
 * 不变式：
 *   导出的 HTML 独立打开后，flowchart 节点应可见着色（非全黑）
 *
 * 直接模拟：
 *   1. Mermaid 用当前项目配置渲染 SVG
 *   2. SVG 嵌入到一个最小 HTML（模拟 generateExportHTML 的模板）
 *   3. 独立 Chromium 加载这个 HTML
 *   4. 读节点 rect 或 foreignObject div 的 computed 样式
 *   5. 断言：不能全黑
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const OUT = path.join(__dirname, '..', 'test-results', 'mermaid-e2e')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

// 从真实文件里选的问题图（5.2 NVR 录像处理流）
const NVR = `graph LR
    NVR[NVR设备<br/>海康/大华/华为] -->|SDK下载| DW[dask-worker]
    DW -->|写入| OBS_H[OBS<br/>/var/lib/hikvision-*]
    OBS_H -->|读取| DW2[dask-worker<br/>转码处理]
    DW2 -->|中转| SFS[SFS Turbo<br/>/tmp/inbound-ilesson]

    style NVR fill:#f5f5f5,stroke:#666
    style OBS_H fill:#e6f7ff,stroke:#1890ff
    style SFS fill:#fff7e6,stroke:#fa8c16`

// 项目当前的导出配置（loose + htmlLabels:true）
const EXPORT_CONFIG = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  htmlLabels: true,
  flowchart: { htmlLabels: true, useMaxWidth: true },
}

test('完整模拟 md-viewer 导出：节点应可见着色', async ({ page }) => {
  // 阶段 1：在页面里调 mermaid.render 拿 SVG（就像 processMermaidInHtml）
  const renderPage = `<!DOCTYPE html><html><body><div id="mount"></div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs'
  mermaid.initialize(${JSON.stringify(EXPORT_CONFIG)})
  const { svg } = await mermaid.render('m1', ${JSON.stringify(NVR)})
  window.__svg__ = svg
  window.__READY__ = true
</script></body></html>`

  const rp = path.join(OUT, 'render.html')
  fs.writeFileSync(rp, renderPage)
  await page.goto(`file://${rp}`)
  await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

  const svg = await page.evaluate(() => (window as any).__svg__ as string)
  fs.writeFileSync(path.join(OUT, 'mermaid-svg.svg'), svg)

  // 阶段 2：构造独立 HTML 把 SVG 包进去（模拟 generateExportHTML 的最小模板）
  const standaloneHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { font-family: sans-serif; padding: 20px; background: white; }
    .markdown-body { max-width: 900px; margin: 0 auto; }
    .mermaid-container { display: flex; justify-content: center; margin: 1.5em 0; }
    .mermaid-container svg { max-width: 100%; height: auto; }
  </style></head><body>
  <div class="markdown-body">
    <h2>5.2 NVR 录像处理流</h2>
    <div class="mermaid-container">${svg}</div>
  </div></body></html>`

  const sp = path.join(OUT, 'standalone.html')
  fs.writeFileSync(sp, standaloneHtml)

  // 阶段 3：独立打开，和用户双击 HTML 是一样的
  await page.goto(`file://${sp}`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)

  await page.screenshot({ path: path.join(OUT, 'standalone.png'), fullPage: true })

  // 阶段 4：验证节点视觉
  const report = await page.evaluate(() => {
    const svg = document.querySelector('.mermaid-container svg') as SVGSVGElement
    if (!svg) return { error: 'no svg' }

    // htmlLabels:true 模式下，视觉元素是 foreignObject 里的 span/div
    const labels = Array.from(svg.querySelectorAll('foreignObject')) as SVGForeignObjectElement[]

    // 同时也看背景 rect（节点的灰框）
    const rects = Array.from(svg.querySelectorAll('rect')) as SVGRectElement[]
    const nodeRects = rects.filter(r => {
      const w = parseFloat(r.getAttribute('width') || '0')
      const h = parseFloat(r.getAttribute('height') || '0')
      return w >= 50 && h >= 30
    })

    return {
      svgId: svg.id,
      totalRects: rects.length,
      nodeRectsCount: nodeRects.length,
      labelsCount: labels.length,
      nodeRectSamples: nodeRects.slice(0, 8).map(r => ({
        parentClass: (r.parentElement as Element | null)?.getAttribute('class') || '(none)',
        inlineStyle: r.getAttribute('style') || '',
        computedFill: getComputedStyle(r).fill,
        computedStroke: getComputedStyle(r).stroke,
        width: r.getAttribute('width'),
      })),
      labelSamples: labels.slice(0, 5).map(fo => {
        const inner = fo.querySelector('div, span') as HTMLElement | null
        return {
          text: inner?.textContent?.trim() || '',
          hasInner: !!inner,
          innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
          innerColor: inner ? getComputedStyle(inner).color : null,
        }
      }),
    }
  })

  console.log('\n=== 独立 HTML 渲染报告 ===')
  console.log(JSON.stringify(report, null, 2))

  expect(report.nodeRectsCount ?? 0, '应该有节点 rect').toBeGreaterThan(0)

  // 核心不变式：节点 rect 的 computed fill 不能全是黑
  const blackRects = (report.nodeRectSamples ?? []).filter(s =>
    /rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(s.computedFill)
  )
  expect(
    blackRects,
    `节点 rect 不应该全黑。黑色样本：\n${JSON.stringify(blackRects, null, 2)}`
  ).toHaveLength(0)

  // 如果有 foreignObject labels，文字应该有内容
  if (report.labelsCount! > 0) {
    const emptyLabels = (report.labelSamples ?? []).filter(s => !s.text)
    expect(emptyLabels, `节点 label 文字不应为空`).toHaveLength(0)
  }
})
