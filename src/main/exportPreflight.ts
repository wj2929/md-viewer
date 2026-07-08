import { analyzeMarkdown } from './cli/markdownAnalysis'
import { testConnection } from './remoteDocxExporter'
import type { PreflightResult, PreflightWarning } from '../shared/preflight'

/**
 * 导出前预检（Export Preflight）—— 在真正导出之前，检查当前 Markdown 是否存在交付风险。
 * MVP 只做「导出前能确定判断、不需真渲染」的 4 项检查：
 *   1) 本地图片缺失   2) 链接目标失效   3) 标题锚点失效   4) 外部服务型图表依赖
 *   + DOCX 服务连通性（仅当导出目标含 docx）
 * 不做需要真渲染的检查（图表渲染失败预测 / 超尺寸），否则预检等于先跑一遍导出、会变慢。
 *
 * 返回结构与 renderer 侧 ExportWarning 兼容（经 IPC 传给 GUI，避免跨 main/renderer import）。
 */

// 外部服务型图表：builtin.ts 中 networkPolicy='explicitRemoteAllowed' 的渲染器语言（plantuml / c4plantuml / kroki 系）。
// 无配置对应服务时这些图表会渲染失败。新增此类图表时需同步此集合。
const EXTERNAL_SERVICE_CHART_TYPES = new Set([
  'plantuml', 'puml', 'c4plantuml', 'c4',
  'kroki', 'pikchr', 'nomnoml', 'svgbob', 'bytefield', 'tikz',
])

const DOCX_PING_TIMEOUT_MS = 2500

export async function runExportPreflight(
  markdown: string,
  filePath: string,
  formats: string[],
  options: { docxServiceUrl?: string } = {},
): Promise<PreflightResult> {
  const warnings: PreflightWarning[] = []
  const blockedFormats: string[] = []

  // 1) 缺图 / 断链 / 锚点 —— 复用主进程既有 markdown 分析引擎（含 exists / anchorExists 判定）
  let analysis: Awaited<ReturnType<typeof analyzeMarkdown>> | null = null
  try {
    analysis = await analyzeMarkdown(markdown, filePath)
  } catch {
    analysis = null // 分析失败不阻塞导出
  }

  if (analysis) {
    for (const image of analysis.images) {
      if (image.kind === 'local' && image.exists === false) {
        warnings.push({
          severity: 'warning', category: 'filesystem', source: 'desktop',
          message: `本地图片不存在：${image.target}`,
          impact: '导出后该图片位置会显示为断裂或空白。',
          userAction: `补齐文件或修正路径：${image.target}`,
          diagnostics: { line: image.lineStart },
        })
      }
    }
    for (const link of analysis.links) {
      if (link.kind === 'markdown' && link.exists === false) {
        warnings.push({
          severity: 'warning', category: 'filesystem', source: 'desktop',
          message: `链接目标不存在：${link.target}`,
          impact: '导出文件里这个链接会指向不存在的位置。',
          userAction: `检查链接目标：${link.target}`,
          diagnostics: { line: link.lineStart },
        })
      }
      if (link.anchor && link.anchorExists === false) {
        warnings.push({
          severity: 'warning', category: 'filesystem', source: 'desktop',
          message: `锚点无效：#${link.anchor}`,
          impact: '点击该锚点链接不会跳转到目标标题。',
          userAction: `确认目标标题存在，或修正锚点：#${link.anchor}`,
          diagnostics: { line: link.lineStart },
        })
      }
    }

    // 2) 外部服务型图表依赖
    const external = analysis.chartBlocks.filter(b => EXTERNAL_SERVICE_CHART_TYPES.has(b.type.toLowerCase()))
    if (external.length > 0) {
      const types = Array.from(new Set(external.map(b => b.type))).join('、')
      warnings.push({
        severity: 'warning', category: 'chart-render', source: 'renderer',
        message: `${external.length} 个图表依赖外部服务（${types}）`,
        impact: '若对应图表服务未配置或不可达，这些图表会渲染失败，导出中显示占位。',
        userAction: '确认已配置对应图表服务，或接受占位降级后继续。',
        diagnostics: { count: external.length },
      })
    }
  }

  // 3) DOCX 服务连通性（仅当导出目标含 docx）
  if (formats.includes('docx') && options.docxServiceUrl) {
    const url = options.docxServiceUrl
    const conn = await pingDocxWithTimeout(url, DOCX_PING_TIMEOUT_MS)
    if (!conn.ok) {
      warnings.push({
        severity: 'action-required', category: 'service-unavailable', source: 'docx-service',
        message: conn.timedOut ? 'DOCX 服务响应超时' : '无法连接 DOCX 服务',
        impact: 'DOCX 文件无法生成（HTML / PDF 不受影响）。',
        userAction: `启动 DOCX 服务或检查服务地址：${url}`,
        diagnostics: { serviceUrl: url },
      })
      blockedFormats.push('docx')
    }
  }

  const status: PreflightResult['status'] =
    warnings.some(w => w.severity === 'action-required' || w.severity === 'error')
      ? 'action-required'
      : warnings.length > 0 ? 'warning' : 'ok'
  return { status, warnings, blockedFormats }
}

async function pingDocxWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; timedOut?: boolean }> {
  try {
    return await Promise.race([
      testConnection(url).then(r => ({ ok: Boolean(r.ok) })),
      new Promise<{ ok: boolean; timedOut: boolean }>(resolve =>
        setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs)),
    ])
  } catch {
    return { ok: false }
  }
}
