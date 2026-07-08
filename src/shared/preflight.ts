/**
 * 导出前预检的共享类型（main / preload / renderer 单一来源）。
 * PreflightWarning 字段与 renderer 侧 ExportWarning 兼容（category 为其子集），
 * GUI 收到后可直接按 ExportWarning 渲染。
 */

export interface PreflightWarning {
  severity: 'info' | 'warning' | 'action-required' | 'error'
  category: 'service-unavailable' | 'chart-render' | 'filesystem' | 'unknown'
  source: 'desktop' | 'docx-service' | 'renderer'
  message: string
  impact: string
  userAction: string
  diagnostics?: Record<string, string | number | boolean>
}

export interface PreflightResult {
  status: 'ok' | 'warning' | 'action-required'
  warnings: PreflightWarning[]
  /** 建议默认拦截的格式（如 DOCX 服务不可用时的 'docx'），GUI 可让用户强制继续。 */
  blockedFormats: string[]
}

export interface PreflightRequest {
  filePath: string
  formats: string[]
  docxServiceUrl?: string
}
