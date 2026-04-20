/**
 * 验证：Mermaid 单例"先预览后导出"串行 initialize，会不会导致第二次 render 的 SVG class 丢失
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const OUT = path.join(__dirname, '..', 'test-results', 'mermaid-sequential')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const CODE = `graph LR
  A[Start] --> B[Middle]
  B --> C[End]
  style A fill:#f5f5f5`

const PREVIEW = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis' },
}

const EXPORT = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: { htmlLabels: false, useMaxWidth: true },
}

test('预览 initialize → 渲染 → 切换导出 initialize → 再渲染：第二次 SVG 是否有 class=node', async ({ page }) => {
  const html = `<!DOCTYPE html><html><body><div id="mount"></div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs'
    window.mermaid = mermaid
    window.__run__ = async () => {
      // 第 1 步：预览配置
      mermaid.initialize(${JSON.stringify(PREVIEW)})
      const r1 = await mermaid.render('r1', ${JSON.stringify(CODE)})
      window.__svg1__ = r1.svg

      // 第 2 步：导出配置（模拟 Electron 里的情况）
      mermaid.initialize(${JSON.stringify(EXPORT)})
      const r2 = await mermaid.render('r2', ${JSON.stringify(CODE)})
      window.__svg2__ = r2.svg

      // 第 3 步：再导出一次（同一份代码第二次）
      const r3 = await mermaid.render('r3', ${JSON.stringify(CODE)})
      window.__svg3__ = r3.svg

      window.__READY__ = true
    }
    window.__run__()
  </script></body></html>`

  const p = path.join(OUT, 'seq.html')
  fs.writeFileSync(p, html)
  await page.goto(`file://${p}`)
  await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 15000 })

  const out = await page.evaluate(() => ({
    svg1: (window as any).__svg1__ as string,
    svg2: (window as any).__svg2__ as string,
    svg3: (window as any).__svg3__ as string,
  }))

  const check = (svg: string) => ({
    hasNodeDefault: (svg.match(/class="node default"/g) || []).length,
    hasNodeOnly: (svg.match(/class="node"/g) || []).length,
    hasForeignObject: svg.includes('foreignObject'),
    len: svg.length,
  })

  const r1 = check(out.svg1)
  const r2 = check(out.svg2)
  const r3 = check(out.svg3)

  console.log('第 1 次 render (PREVIEW 配置):', r1)
  console.log('第 2 次 render (EXPORT 配置):', r2)
  console.log('第 3 次 render (EXPORT 配置):', r3)

  fs.writeFileSync(path.join(OUT, '1-preview.svg'), out.svg1)
  fs.writeFileSync(path.join(OUT, '2-export-first.svg'), out.svg2)
  fs.writeFileSync(path.join(OUT, '3-export-second.svg'), out.svg3)

  // 核心断言：EXPORT 配置下的 render 应该有 class="node default"
  expect(r2.hasNodeDefault, `第 2 次 render 应该有 class=node default (实际: ${JSON.stringify(r2)})`).toBeGreaterThan(0)
  expect(r3.hasNodeDefault, `第 3 次 render 应该有 class=node default (实际: ${JSON.stringify(r3)})`).toBeGreaterThan(0)
})
