export type EditableBlockKind =
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'code'
  | 'table-cell'
  | 'chart'
  | 'embedded'
  | 'unknown'

export interface SourceRange {
  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number
}

export interface EditableBlockDecision {
  blockId: string
  kind: EditableBlockKind
  directEdit: 'supported' | 'conditional' | 'unsupported'
  sourceRange?: SourceRange
  contentHash?: string
  constraints?: string[]
  reason?: string
  action: 'edit-inline' | 'edit-source' | 'show-help'
  fallback?: 'source-range' | 'whole-block' | 'document-source'
}

const DIRECT_EDIT_KINDS = new Set<EditableBlockKind>([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'table-cell',
  'code',
])

export function createEditableBlockDecision(input: {
  blockId: string
  kind: EditableBlockKind
  sourceRange?: SourceRange
  contentHash?: string
  constraints?: string[]
  reason?: string
}): EditableBlockDecision {
  if (DIRECT_EDIT_KINDS.has(input.kind)) {
    return {
      ...input,
      directEdit: 'supported',
      action: 'edit-inline',
    }
  }

  return {
    ...input,
    directEdit: 'unsupported',
    action: 'edit-source',
    fallback: input.sourceRange ? 'source-range' : 'document-source',
    reason: input.reason || '该块类型暂不支持渲染区直接编辑，请在源码中编辑。',
  }
}

export interface OpenDocumentTarget {
  kind: 'line' | 'heading' | 'scroll-ratio' | 'match' | 'top'
  lineNumber?: number
  headingId?: string
  scrollRatio?: number
  matchRange?: { start: number; end: number }
  highlightText?: string
}

export interface OpenDocumentCommand {
  id: string
  source: 'file-tree' | 'search' | 'toc' | 'bookmark' | 'recent' | 'external' | 'read-position'
  filePath: string
  canonicalPath: string
  target?: OpenDocumentTarget
  leafId?: string
  mode?: 'preview' | 'source-edit' | 'split-edit'
  dirtyPolicy: 'block' | 'prompt' | 'save-draft' | 'discard'
  preserveFilter: boolean
  fallback: 'recent-position' | 'top' | 'none'
  issuedAt: number
}

export type OpenDocumentResultStatus =
  | 'opened'
  | 'focused'
  | 'target-missing'
  | 'blocked-by-dirty'
  | 'failed'

export interface OpenDocumentResult {
  commandId: string
  status: OpenDocumentResultStatus
  resolvedTarget?: OpenDocumentTarget
  message?: string
}

export function createOpenDocumentCommand(input: Omit<OpenDocumentCommand, 'id' | 'dirtyPolicy' | 'preserveFilter' | 'fallback' | 'issuedAt'> & {
  id?: string
  dirtyPolicy?: OpenDocumentCommand['dirtyPolicy']
  preserveFilter?: boolean
  fallback?: OpenDocumentCommand['fallback']
  issuedAt?: number
}): OpenDocumentCommand {
  const issuedAt = input.issuedAt ?? Date.now()
  return {
    ...input,
    id: input.id || `${input.source}:${input.canonicalPath}:${issuedAt}`,
    dirtyPolicy: input.dirtyPolicy || 'prompt',
    preserveFilter: input.preserveFilter ?? input.source === 'search',
    fallback: input.fallback || 'top',
    issuedAt,
  }
}

export interface SearchMatch {
  id: string
  lineNumber?: number
  columnStart?: number
  columnEnd?: number
  matchRange?: { start: number; end: number }
  snippet: string
  target?: OpenDocumentTarget
}

export interface SearchResult {
  id: string
  source: 'filename' | 'content' | 'in-page'
  scope: 'file-tree' | 'workspace' | 'current-document'
  query: string
  filePath: string
  canonicalPath: string
  title?: string
  matches: SearchMatch[]
  degradedReason?: string
  skippedReason?: string
  score?: number
}

export const SEARCH_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalMatches: 500,
  maxMatchesPerFile: 50,
  timeoutMs: 5000,
} as const

export interface SearchInputLimitResult<T> {
  files: T[]
  skippedCount: number
  skippedReasons: string[]
  degradedReason?: string
}

export function applySearchInputLimits<T extends { content?: string; path?: string; name?: string }>(
  files: T[],
  limits: typeof SEARCH_LIMITS = SEARCH_LIMITS,
): SearchInputLimitResult<T> {
  const skippedReasons = new Set<string>()
  let skippedCount = 0
  const boundedFiles: T[] = []

  for (const file of files) {
    if (boundedFiles.length >= limits.maxFiles) {
      skippedCount += 1
      skippedReasons.add('too-many-files')
      continue
    }

    const contentSize = typeof file.content === 'string' ? file.content.length : 0
    if (contentSize > limits.maxFileBytes) {
      skippedCount += 1
      skippedReasons.add('file-too-large')
      continue
    }

    boundedFiles.push(file)
  }

  const skippedReasonList = Array.from(skippedReasons)
  return {
    files: boundedFiles,
    skippedCount,
    skippedReasons: skippedReasonList,
    degradedReason: skippedCount > 0
      ? `只显示部分结果：已跳过 ${skippedCount} 个文件（${skippedReasonList.join(', ')}）。`
      : undefined,
  }
}

export function createSearchMatch(input: SearchMatch): SearchMatch {
  return {
    ...input,
    target: input.target || {
      kind: input.lineNumber ? 'match' : 'top',
      lineNumber: input.lineNumber,
      matchRange: input.matchRange,
    },
  }
}

export function createSearchResult(input: SearchResult): SearchResult {
  return {
    ...input,
    matches: input.matches.map(createSearchMatch),
  }
}

export function searchResultToOpenDocumentCommand(
  result: SearchResult,
  matchId: string,
  options: { leafId?: string; issuedAt?: number } = {},
): OpenDocumentCommand {
  const match = result.matches.find(item => item.id === matchId)
  const target: OpenDocumentTarget = {
    kind: 'match',
    lineNumber: match?.lineNumber,
    matchRange: match?.matchRange,
    highlightText: result.query,
  }

  return createOpenDocumentCommand({
    source: 'search',
    filePath: result.filePath,
    canonicalPath: result.canonicalPath,
    target,
    leafId: options.leafId,
    issuedAt: options.issuedAt,
    preserveFilter: true,
    fallback: 'top',
  })
}

export interface ExportWarning {
  severity: 'info' | 'warning' | 'action-required' | 'error'
  category:
    | 'service-unavailable'
    | 'auth'
    | 'version'
    | 'font'
    | 'chart-render'
    | 'filesystem'
    | 'unknown'
  source: 'desktop' | 'docx-service' | 'renderer'
  message: string
  impact: string
  userAction: string
  diagnostics?: Record<string, string | number | boolean>
  serviceVersion?: string
  rendererType?: string
  blockId?: string
}

export interface ExportResult {
  schemaVersion: 2
  status: 'success' | 'success-with-warning' | 'action-required' | 'failed'
  primaryFilePath?: string
  outputFiles?: string[]
  warnings: ExportWarning[]
  legacyWarnings?: string[]
  diagnostics?: Record<string, string | number | boolean>
}

function normalizeLegacyWarning(message: string): ExportWarning {
  if (/API\s*Key|401|403|鉴权|认证|unauthori[sz]ed|forbidden/i.test(message)) {
    return {
      severity: 'action-required',
      category: 'auth',
      source: 'docx-service',
      message,
      impact: 'DOCX 服务拒绝了本次请求，文件可能未生成。',
      userAction: '打开 DOCX 服务设置，检查 API Key 和服务端鉴权配置后重新导出。',
    }
  }

  if (/无法连接|服务未启动|ECONNREFUSED|connect/i.test(message)) {
    return {
      severity: 'action-required',
      category: 'service-unavailable',
      source: 'docx-service',
      message,
      impact: 'DOCX 文件未生成，或只能使用本地降级导出能力。',
      userAction: '检查 DOCX 服务地址、启动状态和 API Key 配置后重新导出。',
    }
  }

  if (/版本|version|升级|兼容/i.test(message)) {
    return {
      severity: 'action-required',
      category: 'version',
      source: 'docx-service',
      message,
      impact: '当前 DOCX 服务版本可能缺少客户端需要的导出能力。',
      userAction: '升级 md-viewer-docx-service 到推荐版本后重新导出。',
    }
  }

  if (/不可写|权限|permission|EACCES|EPERM|ENOENT|输出目录|目标文件夹/i.test(message)) {
    return {
      severity: 'error',
      category: 'filesystem',
      source: 'desktop',
      message,
      impact: '目标文件可能未生成，或无法写入到所选位置。',
      userAction: '检查输出目录权限、关闭已打开的目标文件后重新导出。',
    }
  }

  if (/字体|font/i.test(message)) {
    return {
      severity: 'warning',
      category: 'font',
      source: 'docx-service',
      message,
      impact: '文件可打开，但其他电脑可能使用替代字体，版式可能变化。',
      userAction: '关闭字体嵌入，或在本地、Docker、远程服务中挂载授权字体目录。',
    }
  }

  if (/图表|BPMN|Mermaid|ECharts|DrawIO|PlantUML|Graphviz|D2|Vega/i.test(message)) {
    return {
      severity: 'warning',
      category: 'chart-render',
      source: 'desktop',
      message,
      impact: '文件已生成，但部分图表或内容可能以源码、占位或降级形式保留。',
      userAction: '查看导出详情，确认受影响内容；必要时修正文档源码后重新导出。',
    }
  }

  return {
    severity: 'warning',
    category: 'unknown',
    source: 'desktop',
    message,
    impact: '文件可能已降级生成，部分内容需要人工确认。',
    userAction: '查看导出详情，确认生成文件是否符合预期。',
  }
}

export function normalizeExportResult(input: {
  filePath?: string
  outputFiles?: string[]
  imagesFailed?: number
  warnings?: string[]
  structuredWarnings?: ExportWarning[]
  diagnostics?: Record<string, string | number | boolean>
}): ExportResult {
  const legacyWarnings = input.warnings || []
  const warnings = [
    ...(input.structuredWarnings || []),
    ...legacyWarnings.map(normalizeLegacyWarning),
  ]
  const hasErrors = warnings.some(w => w.severity === 'error')
  const hasActionRequired = warnings.some(w => w.severity === 'action-required' || w.severity === 'error')
  const hasWarnings = warnings.length > 0 || (input.imagesFailed || 0) > 0

  return {
    schemaVersion: 2,
    status: hasErrors ? 'failed' : hasActionRequired ? 'action-required' : hasWarnings ? 'success-with-warning' : 'success',
    primaryFilePath: input.filePath,
    outputFiles: input.outputFiles || (input.filePath ? [input.filePath] : undefined),
    warnings,
    legacyWarnings,
    diagnostics: input.diagnostics,
  }
}
