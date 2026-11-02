import { describe, expect, it } from 'vitest'
import guidance from '../../src/components/settings/chartFormatGuidance.json'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { createRendererRegistry } from '../../src/renderers/registry'
import {
  chartStarterTemplates,
  chartTemplateMarkdown,
  getTemplatesForRenderer,
  getChartFormatGuidance,
  toInsertionTemplate,
} from '../../src/components/settings/chartStarterTemplates'

describe('chart starter templates', () => {
  it('provides concise guidance for exactly the registered types without claiming full API compatibility', () => {
    expect(Object.keys(guidance).sort()).toEqual(builtinRendererDefinitions.map(item => item.type).sort())
    for (const definition of builtinRendererDefinitions) {
      const entry = getChartFormatGuidance(definition.type)
      expect(entry.syntax.trim()).not.toBe('')
      expect(entry.limits.trim()).not.toBe('')
    }
    expect(getChartFormatGuidance('antv-g6').limits).toContain('不是完整 G6 API')
    expect(getChartFormatGuidance('plotly').limits).toContain('不是完整 Plotly.js')
    expect(getChartFormatGuidance('svg').syntax).toContain('受限静态子集')
  })

  it('covers every built-in renderer with stable unique templates', () => {
    const rendererTypes = new Set(builtinRendererDefinitions.map(definition => definition.type))
    const templateIds = chartStarterTemplates.map(template => template.id)

    expect(builtinRendererDefinitions).toHaveLength(20)
    expect(new Set(templateIds).size).toBe(templateIds.length)
    expect(new Set(chartStarterTemplates.map(template => template.rendererType))).toEqual(rendererTypes)
    for (const definition of builtinRendererDefinitions) {
      const templates = getTemplatesForRenderer(definition.type)
      expect(templates.length).toBeGreaterThan(0)
      for (const template of templates) {
        expect(definition.sourceKinds, template.id).toContain(template.sourceKind)
      }
    }
  })

  it('maps every fence language back to its declared renderer', () => {
    const registry = createRendererRegistry(builtinRendererDefinitions)
    const fenceTemplates = chartStarterTemplates.filter(template => template.sourceKind === 'fence')

    for (const template of fenceTemplates) {
      const language = template.prefix.match(/^```([^\s]+)\n$/)?.[1]
      expect(language, template.id).toBeTruthy()
      expect(registry.resolveLanguage(language!)?.type, template.id).toBe(template.rendererType)
      expect(template.suffix, template.id).toBe('\n```')
    }
  })

  it('derives remote types exclusively from the renderer network policy', () => {
    const remoteTypes = builtinRendererDefinitions
      .filter(definition => definition.networkPolicy === 'explicitRemoteAllowed')
      .map(definition => definition.type)
      .sort()

    expect(remoteTypes).toEqual(['c4plantuml', 'kroki', 'plantuml'])
    for (const type of remoteTypes) {
      expect(getTemplatesForRenderer(type)).not.toHaveLength(0)
    }
  })

  it('精确保留 KaTeX 行内与块级模板语义', () => {
    const inline = chartStarterTemplates.find(template => template.id === 'katex-inline')!
    const block = chartStarterTemplates.find(template => template.id === 'katex-block')!

    expect(inline).toMatchObject({ rendererType: 'katex', sourceKind: 'inlineMath' })
    expect(block).toMatchObject({ rendererType: 'katex', sourceKind: 'blockMath' })
    expect(chartTemplateMarkdown(inline)).toBe('$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$')
    expect(chartTemplateMarkdown(block)).toBe(
      '$$\n\\begin{aligned}\nA &= \\pi r^2 \\\\\nV &= \\frac{4}{3}\\pi r^3\n\\end{aligned}\n$$'
    )
    expect(toInsertionTemplate(inline)).toMatchObject({ block: false })
    expect(toInsertionTemplate(block)).toMatchObject({ block: true })
  })
})
