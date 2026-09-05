import type { RendererSourceKind, RendererType } from '../../renderers/types'

export type ChartsSettingsView = 'capabilities' | 'examples' | 'service'

export interface ChartStarterTemplate {
  id: string
  rendererType: RendererType
  title: string
  sourceKind: RendererSourceKind
  description: string
  prefix: string
  body: string
  suffix: string
}

export interface ChartTemplateInsertion {
  prefix: string
  body: string
  suffix: string
  block: boolean
}

export interface EditorInsertionSession {
  targetKey: string
  targetLabel: string
  isValid: () => boolean
  insert: (template: ChartStarterTemplate) => boolean
}

export interface OpenChartSettingsRequest {
  initialView: ChartsSettingsView
  insertionSession?: EditorInsertionSession
}
