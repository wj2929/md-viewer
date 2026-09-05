import templateData from './chartStarterTemplates.json'
import type { RendererType } from '../../renderers/types'
import type { ChartStarterTemplate, ChartTemplateInsertion } from './chartSettingsTypes'

export const chartStarterTemplates = templateData as ChartStarterTemplate[]

export function getTemplatesForRenderer(rendererType: RendererType): ChartStarterTemplate[] {
  return chartStarterTemplates.filter(template => template.rendererType === rendererType)
}

export function chartTemplateMarkdown(template: ChartStarterTemplate): string {
  return `${template.prefix}${template.body}${template.suffix}`
}

export function toInsertionTemplate(template: ChartStarterTemplate): ChartTemplateInsertion {
  return {
    prefix: template.prefix,
    body: template.body,
    suffix: template.suffix,
    block: template.sourceKind !== 'inlineMath',
  }
}
