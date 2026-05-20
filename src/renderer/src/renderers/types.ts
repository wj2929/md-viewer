export type RendererType =
  | 'mermaid'
  | 'echarts'
  | 'markmap'
  | 'graphviz'
  | 'plantuml'
  | 'drawio'
  | 'infographic'
  | 'katex'
  | 'excalidraw'
  | 'vega-lite'
  | 'd2'
  | 'bpmn'
  | 'wavedrom'
  | 'c4plantuml'
  | 'structurizr'
  | 'plotly'
  | 'dbml'
  | 'antv-g6'
  | 'kroki'

export type RendererSourceKind = 'fence' | 'inlineMath' | 'blockMath' | 'imageRef' | 'fileResource'

export type RendererTarget = 'preview' | 'html' | 'pdf' | 'docxClient' | 'serverRender' | 'docxService'

export type RendererCapabilityState = 'supported' | 'unsupported' | 'optional' | 'disabledByDefault'

export interface RendererTargetCapability {
  state: RendererCapabilityState
  reason?: string
  requires?: Array<'rendererArtifact' | 'docxService' | 'localCli' | 'remoteService' | 'network'>
}

export type NetworkPolicy = 'offlineOnly' | 'localOnly' | 'explicitRemoteAllowed'

export type ExportFallbackPolicy = 'imageRequired' | 'allowSourceFallbackWithWarning' | 'skipWithWarning'

export type RendererState =
  | 'rendering'
  | 'success'
  | 'degraded'
  | 'failed'
  | 'unsupported'
  | 'blockedBySecurityPolicy'
  | 'dependencyMissing'

export interface RendererWarning {
  rendererType: RendererType
  blockId: string
  sourceKind: RendererSourceKind
  sourceIndex?: number
  filePath?: string
  target: RendererTarget
  code: string
  reason: string
  fallback: 'imageRendered' | 'sourcePreserved' | 'skipped' | 'blocked'
  userAction?: string
  diagnostics?: Record<string, string | number | boolean>
}

export interface RendererSanitizePolicy {
  classes: string[]
  attributes: string[]
  tags?: string[]
}

export interface RendererReplacementPolicy {
  strategy: 'blockId' | 'imageRefByResolvedPath' | 'mathBlockId'
  fileExtensions?: string[]
}

export interface RendererDefinition {
  type: RendererType
  displayName: string
  aliases: string[]
  languages: string[]
  sourceKinds: RendererSourceKind[]
  renderMode: 'svg' | 'dom' | 'canvas'
  capabilities: Record<RendererTarget, RendererTargetCapability>
  networkPolicy: NetworkPolicy
  fallbackPolicy: ExportFallbackPolicy
  manifestVersion: string
  userHelp: {
    exampleFence: string
    settingsDescription: string
    failureHints: Record<string, string>
  }
  sanitizePolicy: RendererSanitizePolicy
  replacement: RendererReplacementPolicy
  selectors: {
    preview: string
    ready: string
    screenshotTarget: string
  }
}

export interface RendererRegistry {
  definitions: RendererDefinition[]
  resolveLanguage: (language: string) => RendererDefinition | undefined
  getByType: (type: RendererType) => RendererDefinition | undefined
}
