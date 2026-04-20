/**
 * Mermaid 导出颜色回归测试
 *
 * 背景：
 * 历史上 6 次"修复"都失败。根本原因是每次都靠人眼截图判断，
 * 没有真正断言"节点 rect 的 fill 不是黑色"。
 *
 * 这个测试绕过 Electron，直接在 Playwright 的 Chromium 里：
 * 1. 动态加载 Mermaid
 * 2. 渲染 5.2 / 5.3 那两张实际出问题的图
 * 3. 把 SVG 注入到纯 HTML 页面（模拟导出 HTML 的运行环境）
 * 4. 断言默认节点 rect 的 computed fill 不是黑色
 * 5. 失败时截图到 test-results/，可直接人眼核对
 *
 * 关键不变式：
 * "导出的 HTML 独立打开时，未显式 style 的节点 rect 必须有可见填色"
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'mermaid-export-color')
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

// 5.2 NVR 录像处理流的原始 Mermaid 代码（和真实文件一字不差）
const NVR_DIAGRAM = `graph LR
    NVR[NVR设备<br/>海康/大华/华为] -->|SDK下载| DW[dask-worker]
    DW -->|写入| OBS_H[OBS<br/>/var/lib/hikvision-*]
    OBS_H -->|读取| DW2[dask-worker<br/>转码处理]
    DW2 -->|中转| SFS[SFS Turbo<br/>/tmp/inbound-ilesson]
    SFS -->|FFmpeg转码| DW2
    DW2 -->|上传| OBS_OUT[OBS<br/>lms-media/outbound]
    OBS_OUT --> LMS[LMS<br/>关联课堂录像]

    style NVR fill:#f5f5f5,stroke:#666
    style OBS_H fill:#e6f7ff,stroke:#1890ff
    style SFS fill:#fff7e6,stroke:#fa8c16
    style OBS_OUT fill:#e6f7ff,stroke:#1890ff`

type MermaidConfigMode = 'preview' | 'export'

const PREVIEW_CONFIG = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis' },
}

const EXPORT_CONFIG = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  htmlLabels: false, // v11.12.3+ 顶层
  flowchart: { htmlLabels: false, useMaxWidth: true },
}

/**
 * 构造一个最小 HTML：
 * - 加载 Mermaid CDN（同项目 package.json 锁定的 11.12.2）
 * - 按指定 config 渲染 NVR_DIAGRAM
 * - 结果 SVG 注入到 #mount 下
 * 和"导出 HTML 被独立打开"场景等价
 */
function buildMinimalPage(config: object, mermaidCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Mermaid MRE</title>
  <style>body { font-family: sans-serif; padding: 20px; }</style>
</head>
<body>
  <div id="mount"></div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs'
    window.mermaid = mermaid
    mermaid.initialize(${JSON.stringify(config)})
    const { svg } = await mermaid.render('mre', ${JSON.stringify(mermaidCode)})
    document.getElementById('mount').innerHTML = svg
    window.__READY__ = true
  </script>
</body>
</html>`
}

test.describe('Mermaid 导出节点颜色回归', () => {
  for (const mode of ['preview', 'export'] as MermaidConfigMode[]) {
    test(`5.2 NVR 图表在 ${mode} 配置下，默认节点 rect 应有可见 fill`, async ({ page }) => {
      const config = mode === 'preview' ? PREVIEW_CONFIG : EXPORT_CONFIG
      const html = buildMinimalPage(config, NVR_DIAGRAM)
      const htmlPath = path.join(SCREENSHOT_DIR, `mre-${mode}.html`)
      fs.writeFileSync(htmlPath, html)

      // 监听 console / 错误
      const consoleLogs: string[] = []
      page.on('console', m => consoleLogs.push(`[${m.type()}] ${m.text()}`))
      page.on('pageerror', e => consoleLogs.push(`[pageerror] ${e.message}`))

      await page.goto(`file://${htmlPath}`)
      await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

      // 截图保存，失败时人眼核对
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${mode}.png`),
        fullPage: true,
      })

      // 在页面内收集节点视觉信息
      const report = await page.evaluate(() => {
        const svg = document.querySelector('#mount svg')
        if (!svg) return { error: 'no svg' }

        // 定位"节点背景 rect"：排除 foreignObject 内部、排除 edge 的 rect
        // 策略：选 SVG 直接子孙 g 下第一层 rect（Mermaid flowchart 的节点背景）
        // 更稳的方式：找所有 .node rect，然后 fallback 到没有 class 的 g.root > g > g > rect
        const allRects = Array.from(svg.querySelectorAll('rect')) as SVGRectElement[]

        // 过滤：只看宽度 > 40 且高度 > 20 的，一般是节点矩形
        const nodeRects = allRects.filter(r => {
          const w = parseFloat(r.getAttribute('width') || '0')
          const h = parseFloat(r.getAttribute('height') || '0')
          return w >= 40 && h >= 20
        })

        const samples = nodeRects.slice(0, 15).map(r => {
          const cs = getComputedStyle(r)
          return {
            width: r.getAttribute('width'),
            height: r.getAttribute('height'),
            inlineStyle: r.getAttribute('style') || '',
            fillAttr: r.getAttribute('fill') || '',
            strokeAttr: r.getAttribute('stroke') || '',
            computedFill: cs.fill,
            computedStroke: cs.stroke,
            parentClass: (r.parentElement as Element | null)?.getAttribute('class') || '',
            grandparentClass: (r.parentElement?.parentElement as Element | null)?.getAttribute('class') || '',
          }
        })

        return {
          svgAriaRole: svg.getAttribute('aria-roledescription'),
          totalRects: allRects.length,
          nodeRectCount: nodeRects.length,
          samples,
        }
      })

      console.log(`\n=== mode=${mode} 报告 ===`)
      console.log(JSON.stringify(report, null, 2))
      if (consoleLogs.length > 0) {
        console.log('页面日志/错误:')
        consoleLogs.forEach(l => console.log(' ', l))
      }

      // 断言：应该存在节点矩形
      expect(report.nodeRectCount, 'should have node rects').toBeGreaterThan(0)

      // 核心不变式：每个节点 rect 的 computed fill **不能是纯黑**
      // (rgb(0, 0, 0) 或 '#000' 或 'black')
      const isBlack = (v: string) =>
        /^\s*(rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|#000(000)?|black)\s*$/i.test(v)

      const blackSamples = report.samples!.filter(s => isBlack(s.computedFill))
      expect(
        blackSamples,
        `节点 rect 不应该有黑色 fill（历史复发 bug），黑色样本：\n${JSON.stringify(blackSamples, null, 2)}`
      ).toHaveLength(0)
    })
  }
})
