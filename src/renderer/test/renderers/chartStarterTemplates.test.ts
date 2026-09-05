import { describe, expect, it } from 'vitest'
import { builtinRendererDefinitions } from '../../src/renderers/builtin'
import { createRendererRegistry } from '../../src/renderers/registry'
import {
  chartStarterTemplates,
  chartTemplateMarkdown,
  getTemplatesForRenderer,
  toInsertionTemplate,
} from '../../src/components/settings/chartStarterTemplates'

describe('chart starter templates', () => {
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
