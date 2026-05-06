export type ServerRenderNetworkPolicy = 'blocked' | 'local-friendly' | 'allowlist'

export interface ServerRenderResource {
  path: string
  kind: 'text' | 'binary'
  content?: string
  base64?: string
  mediaType: string
  size: number
}

export interface ServerRenderInput {
  schemaVersion: '1.0'
  markdown: string
  markdownFilePath?: string
  resources?: ServerRenderResource[]
  theme?: 'light' | 'dark'
  enabledRenderers?: string[]
  networkPolicy?: ServerRenderNetworkPolicy
  allowlistHosts?: string[]
  timeoutMs?: number
}

export interface RenderWarning {
  code:
    | 'RENDER_TIMEOUT'
    | 'RENDERER_UNAVAILABLE'
    | 'RESOURCE_NOT_FOUND'
    | 'RESOURCE_BLOCKED'
    | 'UNSUPPORTED_CHART'
    | 'SCREENSHOT_FAILED'
    | 'FONT_LOAD_FAILED'
    | 'FALLBACK_USED'
  severity: 'info' | 'warning' | 'error'
  title: string
  message: string
  detail?: string
  action?: string
  fallback?: 'none' | 'source_code_preserved' | 'placeholder_inserted' | 'block_removed'
  location?: {
    blockIndex?: number
    lineStart?: number
    lineEnd?: number
  }
  source?: string
  renderer?: string
  recoverable: boolean
}

export interface BrowserPageRenderResult {
  schemaVersion: '1.0'
  ok: boolean
  status: 'success' | 'partial' | 'failed' | 'timeout'
  html: string
  images: Array<{
    id: string
    type: 'mermaid' | 'katex' | 'echarts' | 'markmap' | 'graphviz' | 'excalidraw' | 'drawio' | 'infographic' | 'plantuml'
    selector: string
    widthPx: number
    heightPx: number
    widthCm: number
    durationMs: number
    sourceIndex?: number
  }>
  stats: {
    totalBlocks: number
    renderedBlocks: number
    failedBlocks: number
    durationMs: number
  }
  warnings: RenderWarning[]
}

declare global {
  interface Window {
    __MDV_RENDER_INPUT__?: ServerRenderInput
    __MDV_RENDER_DONE__?: boolean
    __MDV_RENDER_RESULT__?: BrowserPageRenderResult
  }
}

export {}
