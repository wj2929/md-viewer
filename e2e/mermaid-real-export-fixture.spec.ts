/**
 * 用真实的 md-viewer 导出 HTML 做 fixture 跑回归
 * 如果这个测试失败，说明导出 HTML 本身确实有 bug
 * 如果通过，说明 bug 在浏览器打开 HTML 的环境差异上
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const REAL_EXPORT = process.env.MD_VIEWER_MERMAID_REAL_EXPORT || ''
const OUT_DIR = path.join(__dirname, '..', 'test-results', 'mermaid-real-fixture')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

test('真实 md-viewer 导出 HTML：5.2 节点不应全黑', async ({ page }) => {
  test.skip(!REAL_EXPORT, '未设置 MD_VIEWER_MERMAID_REAL_EXPORT，跳过真实导出 HTML 回归检查')
  test.skip(!fs.existsSync(REAL_EXPORT), '跳过：真实导出 HTML 不存在')

  await page.goto(`file://${REAL_EXPORT}`)
  await page.waitForLoadState('networkidle')

  // 等 Mermaid 的 marker / 字体加载稳定
  await page.waitForTimeout(1000)

  // 截图两个关键节
  const el52 = page.locator('h3:has-text("5.2 NVR")').first()
  if (await el52.count() > 0) {
    await el52.scrollIntoViewIfNeeded()
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'full.png'), fullPage: true })

  // 定位 flowchart-v2 的 SVG，查默认节点 rect 的 computed fill
  const report = await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-roledescription="flowchart-v2"]')) as SVGSVGElement[]
    const result = svgs.map((svg, svgIdx) => {
      const rects = Array.from(svg.querySelectorAll('rect')) as SVGRectElement[]
      const nodeRects = rects.filter(r => {
        const w = parseFloat(r.getAttribute('width') || '0')
        const h = parseFloat(r.getAttribute('height') || '0')
        return w >= 50 && h >= 30
      })
      return {
        svgIdx,
        svgId: svg.id,
        nodeRectCount: nodeRects.length,
        samples: nodeRects.slice(0, 12).map(r => ({
          parentClass: (r.parentElement as Element | null)?.getAttribute('class') || '',
          inlineStyle: r.getAttribute('style') || '',
          computedFill: getComputedStyle(r).fill,
          computedStroke: getComputedStyle(r).stroke,
        })),
      }
    })
    return {
      totalFlowcharts: svgs.length,
      results: result,
    }
  })

  console.log('\n=== 真实导出 flowchart 节点分析 ===')
  console.log(JSON.stringify(report, null, 2))

  // 收集所有黑色节点
  const allBlacks: unknown[] = []
  for (const r of report.results) {
    for (const s of r.samples) {
      if (/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(s.computedFill)) {
        allBlacks.push({ svgId: r.svgId, ...s })
      }
    }
  }

  expect(
    allBlacks,
    `真实导出 HTML 中存在黑色节点 rect（历史复发 bug）：\n${JSON.stringify(allBlacks, null, 2)}`
  ).toHaveLength(0)
})
