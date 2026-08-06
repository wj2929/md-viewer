import { describe, it, expect } from 'vitest'
import { collectFencedRenderSourceLocators, countSourceChartBlocks } from '../../src/renderers/sourceIdentity'
import { createRendererRegistry } from '../../src/renderers/registry'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'

const registry = createRendererRegistry(builtinRendererDefinitions)
const counts = (md: string) => countSourceChartBlocks(collectFencedRenderSourceLocators(md, registry))

describe('countSourceChartBlocks（导出计数权威来源）', () => {
  it('按类型数源块，同类型累加', () => {
    const md = '```mermaid\nA-->B\n```\n\n```mermaid\nC-->D\n```\n\n```kroki\n[A]->[B]\n```'
    expect(counts(md)).toEqual({ mermaid: 2, kroki: 1 })
  })

  it('kroki 别名(pikchr/nomnoml)归一到 kroki，不重复不漏', () => {
    const md = '```pikchr\nbox\n```\n\n```nomnoml\n[a]\n```\n\n```kroki\nx\n```'
    expect(counts(md).kroki).toBe(3)
  })

  it('c4plantuml 独立计数', () => {
    const md = '```c4plantuml\nPerson(a)\n```'
    expect(counts(md).c4plantuml).toBe(1)
  })

  it('普通代码块(python/json)不计入图表', () => {
    const md = '```python\nx = 1\n```\n\n```json\n{"a":1}\n```'
    expect(counts(md)).toEqual({})
  })

  it('无图表文档 → 空对象', () => {
    expect(counts('# 标题\n\n正文，没有图表。')).toEqual({})
  })

  it('多类型混合计数正确', () => {
    const md = '```echarts\n{}\n```\n\n```graphviz\ndigraph{}\n```\n\n```mermaid\nA\n```\n\n```echarts\n{}\n```'
    expect(counts(md)).toEqual({ echarts: 2, graphviz: 1, mermaid: 1 })
  })
})
