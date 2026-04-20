/**
 * 对比：独立 Chromium 跑出的 Mermaid SVG vs 项目 sanitizeSvg 处理后
 * 目的：定位 sanitizeSvg 里哪条规则破坏了节点样式
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const OUT_DIR = path.join(__dirname, '..', 'test-results', 'mermaid-sanitize-diff')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

const NVR = `graph LR
    NVR[NVR设备<br/>海康/大华/华为] -->|SDK下载| DW[dask-worker]
    DW -->|写入| OBS_H[OBS<br/>/var/lib/hikvision-*]
    style NVR fill:#f5f5f5,stroke:#666`

// 复制项目 sanitizeSvg 核心字符串替换（不含 fix* 系列，单独测净化本身）
function sanitizeOnly(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:["'][^"']*["']|`[^`]*`|[^\s>]+)/gi, '')
    .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
    .replace(/v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
    .replace(/data\s*:\s*(?!image\/)[^"'\s]*/gi, '')
    .replace(/expression\s*\(/gi, 'blocked(')
    .replace(/-moz-binding\s*:/gi, '-blocked-binding:')
}

test('sanitize 各条规则对 SVG 的影响', async ({ page }) => {
  const html = `<!DOCTYPE html><html><body><div id="mount"></div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs'
    window.mermaid = mermaid
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true } })
    const { svg } = await mermaid.render('t', ${JSON.stringify(NVR)})
    window.__RAW_SVG__ = svg
    window.__READY__ = true
  </script></body></html>`

  const htmlPath = path.join(OUT_DIR, 'raw.html')
  fs.writeFileSync(htmlPath, html)
  await page.goto(`file://${htmlPath}`)
  await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

  const rawSvg = await page.evaluate(() => (window as any).__RAW_SVG__ as string)
  fs.writeFileSync(path.join(OUT_DIR, 'raw.svg'), rawSvg)

  // 逐条应用 sanitize 规则，输出差异
  const rules: { name: string; fn: (s: string) => string }[] = [
    { name: '1_strip_script', fn: s => s.replace(/<script[\s\S]*?(?:<\/script>|$)/gi, '') },
    { name: '2_strip_on_attrs', fn: s => s.replace(/\s+on\w+\s*=\s*(?:["'][^"']*["']|`[^`]*`|[^\s>]+)/gi, '') },
    { name: '3_strip_javascript', fn: s => s.replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '') },
    { name: '4_strip_vbscript', fn: s => s.replace(/v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '') },
    { name: '5_strip_data_url', fn: s => s.replace(/data\s*:\s*(?!image\/)[^"'\s]*/gi, '') },
    { name: '6_block_expression', fn: s => s.replace(/expression\s*\(/gi, 'blocked(') },
    { name: '7_block_moz_binding', fn: s => s.replace(/-moz-binding\s*:/gi, '-blocked-binding:') },
  ]

  console.log(`\n=== RAW SVG length: ${rawSvg.length} ===`)
  console.log(`=== 包含 class="node default": ${rawSvg.includes('class="node default"')} ===`)

  let cur = rawSvg
  for (const r of rules) {
    const prev = cur
    cur = r.fn(cur)
    const changed = cur.length !== prev.length
    console.log(`[${r.name}] ${changed ? `✗ CHANGED ${prev.length}→${cur.length} (diff ${prev.length - cur.length})` : '✓ no change'}`)
    if (changed) {
      fs.writeFileSync(path.join(OUT_DIR, `after-${r.name}.svg`), cur)
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'final.svg'), cur)

  // 把最终 svg 再注入一次，查节点 rect 的 computed fill
  await page.evaluate((finalSvg) => {
    document.getElementById('mount')!.innerHTML = finalSvg
  }, cur)

  const report = await page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll('#mount svg rect')) as SVGRectElement[]
    const nodeRects = rects.filter(r => {
      const w = parseFloat(r.getAttribute('width') || '0')
      const h = parseFloat(r.getAttribute('height') || '0')
      return w >= 40 && h >= 20
    })
    return nodeRects.map(r => ({
      parentClass: (r.parentElement as Element | null)?.getAttribute('class') || '',
      computedFill: getComputedStyle(r).fill,
      inlineStyle: r.getAttribute('style') || '',
    }))
  })

  console.log('\n=== sanitize 后节点 rect computed fill ===')
  console.log(JSON.stringify(report, null, 2))

  await page.screenshot({ path: path.join(OUT_DIR, 'after-sanitize.png'), fullPage: true })

  const blacks = report.filter(r => /rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(r.computedFill))
  expect(blacks, `sanitize 后节点不应变黑：\n${JSON.stringify(blacks, null, 2)}`).toHaveLength(0)
})
