import { describe, it, expect, afterEach } from 'vitest'
import { normalizeFailedChartBlocks } from '../../src/server-render/normalizeFailedCharts'

function mount(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('normalizeFailedChartBlocks (W2: 失败图表 → 中性占位)', () => {
  it('保留成功渲染的图表及其保留源码（不误伤好图）', () => {
    const root = mount(`
      <div class="mermaid-wrapper" data-mermaid-index="0">
        <div class="mermaid-toggle-bar no-export"><button>code</button></div>
        <svg><g class="node"></g></svg>
        <pre class="language-mermaid"><code class="language-mermaid">graph TD A--&gt;B</code></pre>
      </div>
    `)
    const n = normalizeFailedChartBlocks(root)
    expect(n).toBe(0)
    expect(root.querySelector('.mermaid-wrapper svg')).not.toBeNull()
    expect(root.querySelector('pre.language-mermaid')).not.toBeNull()
    expect(root.querySelector('.chart-export-placeholder')).toBeNull()
  })

  it('失败的错误块（含源码）→ 中性占位，源码消失', () => {
    const root = mount(`
      <div class="mermaid-error mermaid-error-fallback">
        <div class="error-title">Mermaid 渲染失败</div>
        <pre class="language-mermaid"><code class="language-mermaid">sankey-beta 客户,产品,100</code></pre>
      </div>
    `)
    const n = normalizeFailedChartBlocks(root)
    expect(n).toBe(1)
    expect(root.querySelector('.mermaid-error')).toBeNull()
    expect(root.querySelector('pre.language-mermaid')).toBeNull()
    expect(root.textContent).not.toContain('sankey-beta')
    const ph = root.querySelector('.chart-export-placeholder')
    expect(ph).not.toBeNull()
    expect(ph?.getAttribute('data-chart-type')).toBe('mermaid')
  })

  it('裸的图表源码（无 wrapper，如封网 kroki）→ 占位', () => {
    const root = mount('<pre class="language-kroki"><code class="language-kroki">[A] -&gt; [B]</code></pre>')
    const n = normalizeFailedChartBlocks(root)
    expect(n).toBe(1)
    expect(root.querySelector('pre.language-kroki')).toBeNull()
    expect(root.querySelector('.chart-export-placeholder[data-chart-type="kroki"]')).not.toBeNull()
  })

  it('边界：故意展示的非图表代码块（language-text）不动', () => {
    const root = mount('<pre class="language-text"><code class="language-text">graph TD 这是给人看的示例</code></pre>')
    const n = normalizeFailedChartBlocks(root)
    expect(n).toBe(0)
    expect(root.querySelector('pre.language-text')).not.toBeNull()
    expect(root.querySelector('.chart-export-placeholder')).toBeNull()
    expect(root.textContent).toContain('graph TD')
  })

  it('失败的 wrapper（有 error、无 svg，如 plantuml）→ 整个 wrapper 换占位', () => {
    const root = mount(`
      <div class="plantuml-wrapper">
        <div class="plantuml-container"><div class="plantuml-error">PlantUML 渲染失败</div></div>
        <pre class="language-plantuml"><code class="language-plantuml">@startuml a-&gt;b @enduml</code></pre>
      </div>
    `)
    normalizeFailedChartBlocks(root)
    expect(root.querySelector('.plantuml-wrapper')).toBeNull()
    expect(root.textContent).not.toContain('@startuml')
    expect(root.querySelector('.chart-export-placeholder')).not.toBeNull()
  })

  it('混合文档：成功图保留、失败图占位（一次处理对齐）', () => {
    const root = mount(`
      <div class="mermaid-wrapper"><svg></svg><pre class="language-mermaid"><code>ok</code></pre></div>
      <div class="mermaid-error"><pre class="language-mermaid"><code>fail-cn 客户</code></pre></div>
      <pre class="language-kroki"><code>[A]-&gt;[B]</code></pre>
    `)
    const n = normalizeFailedChartBlocks(root)
    expect(n).toBe(2)
    expect(root.querySelectorAll('.chart-export-placeholder').length).toBe(2)
    expect(root.querySelector('.mermaid-wrapper svg')).not.toBeNull() // 成功图还在
    expect(root.textContent).not.toContain('fail-cn')
  })
})
