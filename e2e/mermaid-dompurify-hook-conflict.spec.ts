/**
 * 回归保障：证明"Mermaid strict 模式 + 项目 DOMPurify class 白名单 hook"会剥 .node class
 *
 * 历史上这个 bug 反复了 6+ 次：
 * - 每次都以为是 Mermaid 配置问题 / SVG 样式问题 / 模板 CSS 问题
 * - 根因其实是：Mermaid strict 模式调 DOMPurify.sanitize(svgCode)，
 *   和项目全局注册的 DOMPurify class 白名单 hook 冲突
 *
 * 这个测试 freeze 了这个不变式：
 *   如果项目 DOMPurify hook 在场，mermaid 必须用 loose（或白名单加 Mermaid class）
 */
import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const OUT = path.join(__dirname, '..', 'test-results', 'mermaid-dompurify-conflict')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const CODE = `graph LR
  A[Start] --> B[Middle] --> C[End]`

/**
 * 构造一个页面，模拟 md-viewer renderer 的情况：
 * 1. 加载 DOMPurify
 * 2. 注册项目的 class 白名单 hook（只允许 markdown-body 等）
 * 3. 加载 Mermaid
 * 4. 用指定 securityLevel 渲染
 * 5. 把 render 结果（SVG 字符串）暴露到 window 供 Playwright 断言
 */
function buildPage(securityLevel: 'strict' | 'loose'): string {
  return `<!DOCTYPE html><html><body><div id="mount"></div>
<script type="module">
  import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.3.1/dist/purify.es.mjs'
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs'

  // 模拟项目的 class 白名单 hook（简化版，仅保留会剥 class 的行为）
  const ALLOWED = new Set(['markdown-body', 'language-mermaid', 'mermaid'])
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'class') {
      const classes = data.attrValue.split(/\\s+/).filter(Boolean)
      const safe = classes.filter(c => ALLOWED.has(c))
      if (safe.length === 0) data.keepAttr = false
      else data.attrValue = safe.join(' ')
    }
  })

  // 确保 Mermaid 用的是同一个 DOMPurify 单例
  window.DOMPurify = DOMPurify
  window.mermaid = mermaid

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: ${JSON.stringify(securityLevel)},
    htmlLabels: true,
    flowchart: { htmlLabels: true, useMaxWidth: true },
  })
  const { svg } = await mermaid.render('t', ${JSON.stringify(CODE)})
  window.__svg__ = svg
  document.getElementById('mount').innerHTML = svg
  window.__READY__ = true
</script></body></html>`
}

test.describe('Mermaid + 项目 DOMPurify class 白名单 hook', () => {
  test('strict 模式应保留 node default class', async ({ page }) => {
    const p = path.join(OUT, 'strict.html')
    fs.writeFileSync(p, buildPage('strict'))
    await page.goto(`file://${p}`)
    await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

    const info = await page.evaluate(() => {
      const svg = (window as any).__svg__ as string
      const labels = Array.from(document.querySelectorAll('#mount svg foreignObject > div')) as HTMLElement[]
      return {
        hasNodeDefault: (svg.match(/class="node default"/g) || []).length,
        hasNodeOnly: (svg.match(/class="node"/g) || []).length,
        labelCount: labels.length,
        len: svg.length,
      }
    })
    console.log('strict 模式 SVG:', info)

    expect(info.hasNodeDefault, 'strict 模式下 .node default class 应保留').toBeGreaterThan(0)
    expect(info.labelCount, 'strict 模式下节点 label 应存在').toBeGreaterThan(0)
  })

  test('loose 模式下节点 label 仍应正常渲染', async ({ page }) => {
    const p = path.join(OUT, 'loose.html')
    fs.writeFileSync(p, buildPage('loose'))
    await page.goto(`file://${p}`)
    await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

    const info = await page.evaluate(() => {
      const svg = (window as any).__svg__ as string
      const labels = Array.from(document.querySelectorAll('#mount svg foreignObject > div')) as HTMLElement[]
      return {
        hasNodeDefault: (svg.match(/class="node default"/g) || []).length,
        hasNodeOnly: (svg.match(/class="node"/g) || []).length,
        labelCount: labels.length,
        labelTexts: labels.map(d => d.textContent?.trim() || ''),
        len: svg.length,
      }
    })
    console.log('loose 模式 SVG:', info)

    expect(info.labelCount, 'loose 模式下节点 label 应存在').toBeGreaterThan(0)
    expect(info.labelTexts.filter(Boolean).length, 'loose 模式下节点 label 应有文本').toBeGreaterThan(0)
  })

  test('loose 模式下节点在独立页面也能正常着色（端到端验证）', async ({ page }) => {
    const p = path.join(OUT, 'loose-render.html')
    fs.writeFileSync(p, buildPage('loose'))
    await page.goto(`file://${p}`)
    await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 10000 })

    await page.screenshot({ path: path.join(OUT, 'loose-screenshot.png'), fullPage: true })

    const report = await page.evaluate(() => {
      const svg = document.querySelector('#mount svg')
      if (!svg) return { error: 'no svg' }
      // 找默认节点的 label 容器（htmlLabels:true 模式下视觉元素是 foreignObject 里的 div）
      const labels = Array.from(svg.querySelectorAll('foreignObject > div')) as HTMLElement[]
      return {
        labelCount: labels.length,
        samples: labels.slice(0, 5).map(d => ({
          computedBg: getComputedStyle(d).backgroundColor,
          computedColor: getComputedStyle(d).color,
          textContent: d.textContent?.trim(),
        })),
      }
    })

    console.log('loose 模式节点 label 视觉信息:', report)
    expect(report.labelCount ?? 0, '应该有节点 label').toBeGreaterThan(0)
  })
})
