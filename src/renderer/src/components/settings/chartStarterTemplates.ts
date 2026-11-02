import templateData from './chartStarterTemplates.json'
import formatGuidance from './chartFormatGuidance.json'
import type { RendererType } from '../../renderers/types'
import type { ChartFormatGuidance, ChartStarterTemplate, ChartTemplateInsertion } from './chartSettingsTypes'

export const chartStarterTemplates = templateData as ChartStarterTemplate[]

export function getChartFormatGuidance(rendererType: RendererType): ChartFormatGuidance {
  return formatGuidance[rendererType]
}

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
