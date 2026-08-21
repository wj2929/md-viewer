import { readFile } from 'fs/promises'
import path from 'path'
import { validateSecurePath } from '../security/pathValidator'
import type { BrowserPageRenderResult, RenderWarning } from '../../renderer/src/server-render/contracts'
import {
  DocxSourceExportError,
  exportDocxViaConvertSource,
  exportMergedDocxViaConvertSource,
  namespaceLocalImages,
  type ConvertSourceDocxOptions,
  type ConvertSourceDocxResult,
  type NamespacedPart,
} from './docxSourceExporter'
import { getRegisteredCapabilities } from './capabilitiesRegistry'
import { renderMarkdownHeadless, type HeadlessMarkdownRenderer } from './headlessRenderer'
import { getHeadlessRenderTimeoutMs } from './renderTimeout'
import { createFailureResult, createSuccessResult } from './result'
import { writeHtmlExport, writePdfExport, type PdfDocumentOptions } from './sharedExportWriters'
import type { CliArtifact, CliWarning } from './types'

const SUPPORTED_FORMATS = new Set(['html', 'pdf', 'docx'])
const DEFAULT_DOCX_SERVICE_URL = 'http://127.0.0.1:3179'

interface BuildExportResultOptions {
  renderer?: HeadlessMarkdownRenderer
  pdfWriter?: (outputPath: string, options: PdfDocumentOptions) => Promise<CliArtifact>
  docxExporter?: (options: ConvertSourceDocxOptions) => Promise<ConvertSourceDocxResult>
  // 注入点：默认读取与 GUI 一致的导出样式（markdown.css + prism-theme.css）。
  // 单测在非 electron 环境可传 mock，避免加载依赖 electron app 的 getExportStyles。
  styleProvider?: () => Promise<{ markdownCss: string; prismCss: string }>
  // 注入点：把 HTML 里的本地图片 <img> 内嵌成 data:base64。默认走主进程实现。
  imageEmbedder?: (html: string, markdownFilePath: string) => Promise<string>
}

export async function buildExportResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildExportResultOptions = {},
) {
  const inputs = positional
  const input = inputs[0]
  const format = typeof flags.format === 'string' ? flags.format : undefined
  const out = typeof flags.out === 'string' ? flags.out : undefined

  if (!input || !format || !out || !SUPPORTED_FORMATS.has(format)) {
    return createFailureResult('export', {
      code: 'INVALID_ARGUMENT',
      message: 'export 需要 Markdown 文件路径、--format html|pdf|docx 和 --out 输出路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 export 命令帮助',
          command: 'md-viewer help export --json',
          target: 'export',
          risk: 'safe',
        },
      ],
    })
  }

  // 多文件:合并成一份文档
  if (inputs.length > 1) {
    if (format === 'docx') {
      return buildMergedDocxResult(inputs, out, flags, options)
    }
    return buildMergedExportResult(inputs, format, out, flags, options)
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('export', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help export --json',
          target: 'export',
          risk: 'safe',
        },
      ],
    })
  }

  const markdown = await readFile(validation.normalizedPath, 'utf8')

  if (format === 'docx') {
    const serviceUrl = getDocxServiceUrl(flags)
    try {
      const docxResult = await (options.docxExporter ?? exportDocxViaConvertSource)({
        markdown,
        outputPath: out,
        serviceUrl,
        apiKey: typeof flags['docx-api-key'] === 'string' ? flags['docx-api-key'] : undefined,
        style: typeof flags['docx-style'] === 'string' ? flags['docx-style'] : 'preview',
        embedFont: flags['embed-font'] === true,
        sourceFilePath: validation.normalizedPath,
      })

      const docxSummary = {
        format,
        input: validation.normalizedPath,
        output: out,
        bytes: docxResult.artifact.bytes,
        serviceVersion: docxResult.serviceVersion,
        mode: docxResult.mode,
        renderStatus: docxResult.renderStatus,
        totalCharts: undefined,
        renderedCharts: docxResult.chartsRendered,
        failedCharts: docxResult.failedBlocks,
      }
      const docxWarnings = ensureDocxFailureWarning(
        docxResult.warnings.map(message => ({
          code: 'DOCX_SERVICE_WARNING',
          message,
          target: 'docx-service',
        })),
        docxResult,
      )

      // 契约诚实化（W1）：DOCX 渲染未完全成功时不得报告 ok:true。
      if (docxResult.renderStatus !== 'success' || docxResult.failedBlocks > 0) {
        return createFailureResult('export', {
          code: 'DOCX_RENDER_PARTIAL',
          message: `${docxResult.failedBlocks} 个图表在 DOCX 导出中失败，文档可能缺图`,
          target: 'docx-service',
          exitCode: 5,
          summary: docxSummary,
          artifacts: [docxResult.artifact],
          warnings: docxWarnings,
        })
      }

      return createSuccessResult('export', {
        summary: docxSummary,
        artifacts: [docxResult.artifact],
        warnings: docxWarnings,
      })
    } catch (error) {
      return buildDocxFailure(serviceUrl, error)
    }
  }

  const renderer = options.renderer ?? renderMarkdownHeadless
  const renderResult = await renderer({
    schemaVersion: '1.0',
    markdown,
    markdownFilePath: validation.normalizedPath,
    enabledRenderers: getRegisteredCapabilities().chartTypes,
    networkPolicy: 'blocked',
    timeoutMs: getHeadlessRenderTimeoutMs(flags),
  })
  const loadStyles = options.styleProvider ?? (async () => {
    const { getExportStyles } = await import('../ipc/exportStyles')
    return getExportStyles()
  })
  const { markdownCss, prismCss } = await loadStyles()

  // 内嵌本地图片：与 GUI 导出一致，把 <img src="相对路径"> 换成 data:base64，
  // 否则导出的 HTML/PDF 换机打开图片会裂。失败的图保持原样，不阻断导出。
  const embedImages = options.imageEmbedder ?? (async (html: string, mdPath: string) => {
    const { embedLocalImagesInExportedHtml } = await import('../localImageEmbed')
    return embedLocalImagesInExportedHtml(html, mdPath)
  })
  const embeddedHtml = await embedImages(renderResult.html, validation.normalizedPath)

  const writerOptions = {
    content: embeddedHtml,
    title: path.basename(validation.normalizedPath),
    markdownCss,
    prismCss,
    showBranding: true,
  }
  const artifact = format === 'pdf'
    ? await (options.pdfWriter ?? writePdfExport)(out, writerOptions)
    : await writeHtmlExport(out, writerOptions)

  const renderSummary = {
    format,
    input: validation.normalizedPath,
    output: out,
    bytes: artifact.bytes,
    ...buildRenderSummary(renderResult),
  }
  const renderWarnings = ensureFailureWarning(
    renderResult.warnings.map(mapRenderWarning),
    renderResult,
  )

  if (renderResult.status === 'timeout') {
    return createFailureResult('export', {
      code: 'RENDER_TIMEOUT',
      message: `headless 渲染超过 ${renderResult.stats.durationMs}ms 未完成，导出文件可能未完整渲染`,
      target: validation.normalizedPath,
      exitCode: 5,
      summary: renderSummary,
      artifacts: [artifact],
      warnings: renderWarnings,
      actions: [
        {
          label: '增大 headless 渲染超时',
          command: `md-viewer export "${validation.normalizedPath}" --format ${format} --out "${out}" --timeout-ms 180000 --json`,
          target: 'export',
          risk: 'safe',
        },
      ],
    })
  }

  // 契约诚实化（W1）：有图表失败时不得报告 ok:true。文件已写出，但产物可能缺图/残留源码。
  if (renderResult.status !== 'success' || renderResult.stats.failedBlocks > 0) {
    return createFailureResult('export', {
      code: 'RENDER_PARTIAL',
      message: `${renderResult.stats.failedBlocks} 个图表渲染失败，导出文件可能缺图或残留源码`,
      target: validation.normalizedPath,
      exitCode: 5,
      summary: renderSummary,
      artifacts: [artifact],
      warnings: renderWarnings,
    })
  }

  return createSuccessResult('export', {
    summary: renderSummary,
    artifacts: [artifact],
    warnings: renderWarnings,
  })
}

interface RenderedFragment {
  fragment: string
  renderResult: BrowserPageRenderResult
  input: string
}

/**
 * 渲染单个文件为 HTML 片段(用该文件自身路径作渲染/图片基准)。
 * 合并导出用:多文件各自 embed 图片后拼接,保证各文件本地图片路径正确。
 */
async function renderOneToHtmlFragment(
  normalizedPath: string,
  flags: Record<string, string | boolean>,
  options: BuildExportResultOptions,
): Promise<RenderedFragment> {
  const markdown = await readFile(normalizedPath, 'utf8')
  const renderer = options.renderer ?? renderMarkdownHeadless
  const renderResult = await renderer({
    schemaVersion: '1.0',
    markdown,
    markdownFilePath: normalizedPath,
    enabledRenderers: getRegisteredCapabilities().chartTypes,
    networkPolicy: 'blocked',
    timeoutMs: getHeadlessRenderTimeoutMs(flags),
  })
  const embedImages = options.imageEmbedder ?? (async (html: string, mdPath: string) => {
    const { embedLocalImagesInExportedHtml } = await import('../localImageEmbed')
    return embedLocalImagesInExportedHtml(html, mdPath)
  })
  const fragment = await embedImages(renderResult.html, normalizedPath)
  return { fragment, renderResult, input: normalizedPath }
}

/**
 * 多文件合并导出(html/pdf)。每个文件各自渲染 + 各自 embed 本地图片(自身目录基准),
 * 再按顺序拼接成一份文档;文件间插分页符(第 2 个起 page-break-before)。
 */
async function buildMergedExportResult(
  inputs: string[],
  format: string,
  out: string,
  flags: Record<string, string | boolean>,
  options: BuildExportResultOptions,
) {
  // 1. 逐个安全校验:任一失败即整体失败
  const normalizedPaths: string[] = []
  for (const input of inputs) {
    const validation = await validateSecurePath(input)
    if (!validation.valid || validation.type !== 'md-file') {
      return createFailureResult('export', {
        code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
        message: validation.error ?? '输入文件不可用',
        target: input,
        exitCode: validation.error === '路径不存在' ? 3 : 2,
        actions: [
          {
            label: '检查输入文件路径',
            command: 'md-viewer help export --json',
            target: 'export',
            risk: 'safe',
          },
        ],
      })
    }
    normalizedPaths.push(validation.normalizedPath)
  }

  // 2. 逐文件渲染为 HTML 片段(各自路径作基准)
  const rendered: RenderedFragment[] = []
  for (const normalizedPath of normalizedPaths) {
    rendered.push(await renderOneToHtmlFragment(normalizedPath, flags, options))
  }

  // 3. 拼接片段:第 2 个起加分页符
  const mergedContent = rendered
    .map((r, index) => {
      const pageBreak = index > 0 ? ' style="page-break-before: always;"' : ''
      return `<section class="merged-doc-part"${pageBreak}>\n${r.fragment}\n</section>`
    })
    .join('\n')

  // 4. 样式 + 写出
  const loadStyles = options.styleProvider ?? (async () => {
    const { getExportStyles } = await import('../ipc/exportStyles')
    return getExportStyles()
  })
  const { markdownCss, prismCss } = await loadStyles()
  const title = typeof flags.title === 'string' ? flags.title : path.basename(normalizedPaths[0])
  const writerOptions = {
    content: mergedContent,
    title,
    markdownCss,
    prismCss,
    showBranding: true,
  }
  const artifact = format === 'pdf'
    ? await (options.pdfWriter ?? writePdfExport)(out, writerOptions)
    : await writeHtmlExport(out, writerOptions)

  // 5. 汇总各文件 stats(累加,status 取最差)
  const totals = rendered.reduce(
    (acc, r) => {
      acc.totalCharts += r.renderResult.stats.totalBlocks
      acc.renderedCharts += r.renderResult.stats.renderedBlocks
      acc.failedCharts += r.renderResult.stats.failedBlocks
      acc.durationMs += r.renderResult.stats.durationMs
      return acc
    },
    { totalCharts: 0, renderedCharts: 0, failedCharts: 0, durationMs: 0 },
  )
  const hasTimeout = rendered.some(r => r.renderResult.status === 'timeout')
  const allSuccess = rendered.every(r => r.renderResult.status === 'success')
  const mergedStatus = hasTimeout ? 'timeout' : allSuccess ? 'success' : 'partial'

  const summary = {
    format,
    input: normalizedPaths[0],
    inputs: normalizedPaths,
    output: out,
    bytes: artifact.bytes,
    renderStatus: mergedStatus,
    totalCharts: totals.totalCharts,
    renderedCharts: totals.renderedCharts,
    failedCharts: totals.failedCharts,
    renderDurationMs: totals.durationMs,
  }
  const warnings = rendered.flatMap(r =>
    ensureFailureWarning(r.renderResult.warnings.map(mapRenderWarning), r.renderResult),
  )

  // 契约诚实化:任一文件超时/有失败图表 → failure
  if (hasTimeout) {
    return createFailureResult('export', {
      code: 'RENDER_TIMEOUT',
      message: `部分文件 headless 渲染超时,合并文档可能未完整渲染`,
      exitCode: 5,
      summary,
      artifacts: [artifact],
      warnings,
    })
  }
  if (!allSuccess || totals.failedCharts > 0) {
    return createFailureResult('export', {
      code: 'RENDER_PARTIAL',
      message: `${totals.failedCharts} 个图表渲染失败,合并文档可能缺图或残留源码`,
      exitCode: 5,
      summary,
      artifacts: [artifact],
      warnings,
    })
  }

  return createSuccessResult('export', {
    summary,
    artifacts: [artifact],
    warnings,
  })
}

function replaceExtension(filePath: string, extension: string): string {
  return filePath.replace(/\.[^.\\/]+$/, `.${extension}`)
}

/**
 * 多文件合并 DOCX:各文件命名空间化本地图片 → 用 <!-- pagebreak --> 拼接 → 单次 bundle 请求。
 * 服务端 v0.2.4+ 识别 <!-- pagebreak --> 生成硬分页。
 */
async function buildMergedDocxResult(
  inputs: string[],
  out: string,
  flags: Record<string, string | boolean>,
  options: BuildExportResultOptions,
) {
  // 1. 逐个安全校验
  const normalizedPaths: string[] = []
  for (const input of inputs) {
    const validation = await validateSecurePath(input)
    if (!validation.valid || validation.type !== 'md-file') {
      return createFailureResult('export', {
        code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
        message: validation.error ?? '输入文件不可用',
        target: input,
        exitCode: validation.error === '路径不存在' ? 3 : 2,
        actions: [
          { label: '检查输入文件路径', command: 'md-viewer help export --json', target: 'export', risk: 'safe' },
        ],
      })
    }
    normalizedPaths.push(validation.normalizedPath)
  }

  // 2. 逐文件命名空间化(图片引用重写 + 收集资源)
  const parts: NamespacedPart[] = []
  for (let i = 0; i < normalizedPaths.length; i++) {
    const markdown = await readFile(normalizedPaths[i], 'utf8')
    parts.push(await namespaceLocalImages(markdown, normalizedPaths[i], i))
  }

  // 3. 合并请求
  const serviceUrl = getDocxServiceUrl(flags)
  try {
    const docxResult = await exportMergedDocxViaConvertSource(parts, {
      outputPath: out,
      serviceUrl,
      apiKey: typeof flags['docx-api-key'] === 'string' ? flags['docx-api-key'] : undefined,
      style: typeof flags['docx-style'] === 'string' ? flags['docx-style'] : 'preview',
      embedFont: flags['embed-font'] === true,
    })

    const docxSummary = {
      format: 'docx',
      input: normalizedPaths[0],
      inputs: normalizedPaths,
      output: out,
      bytes: docxResult.artifact.bytes,
      serviceVersion: docxResult.serviceVersion,
      mode: docxResult.mode,
      renderStatus: docxResult.renderStatus,
      renderedCharts: docxResult.chartsRendered,
      failedCharts: docxResult.failedBlocks,
    }
    const docxWarnings = ensureDocxFailureWarning(
      docxResult.warnings.map(message => ({ code: 'DOCX_SERVICE_WARNING', message, target: 'docx-service' })),
      docxResult,
    )

    if (docxResult.renderStatus !== 'success' || docxResult.failedBlocks > 0) {
      return createFailureResult('export', {
        code: 'DOCX_RENDER_PARTIAL',
        message: `${docxResult.failedBlocks} 个图表在 DOCX 合并导出中失败,文档可能缺图`,
        target: 'docx-service',
        exitCode: 5,
        summary: docxSummary,
        artifacts: [docxResult.artifact],
        warnings: docxWarnings,
      })
    }

    return createSuccessResult('export', {
      summary: docxSummary,
      artifacts: [docxResult.artifact],
      warnings: docxWarnings,
    })
  } catch (error) {
    return buildDocxFailure(serviceUrl, error)
  }
}

function getDocxServiceUrl(flags: Record<string, string | boolean>): string {
  if (typeof flags['docx-service'] === 'string') {
    return flags['docx-service']
  }
  return process.env.MD_VIEWER_DOCX_SERVICE_URL || DEFAULT_DOCX_SERVICE_URL
}

function buildDocxFailure(serviceUrl: string, error: unknown) {
  if (error instanceof DocxSourceExportError) {
    const isConnectionIssue = error.errorType === 'network' || error.errorType === 'timeout'
    const isWriteIssue = error.errorType === 'write_error'
    return createFailureResult('export', {
      code: isConnectionIssue
        ? 'DOCX_SERVICE_UNAVAILABLE'
        : isWriteIssue
          ? 'OUTPUT_NOT_WRITABLE'
          : 'DOCX_SERVICE_ERROR',
      message: error.message,
      target: isWriteIssue ? undefined : 'docx-service',
      exitCode: isWriteIssue ? 6 : isConnectionIssue ? 4 : 1,
      diagnostics: {
        serviceUrl,
        errorType: error.errorType,
        statusCode: error.statusCode,
        raw: error.raw,
      },
      actions: [
        {
          label: isConnectionIssue ? '检查 DOCX 服务' : '查看 DOCX 服务诊断',
          command: `md-viewer doctor --docx-service ${serviceUrl} --json`,
          target: 'docx-service',
          risk: 'safe',
        },
      ],
    })
  }

  return createFailureResult('export', {
    code: 'DOCX_EXPORT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    target: 'docx-service',
    exitCode: 1,
    diagnostics: { serviceUrl },
    actions: [
      {
        label: '查看 DOCX 服务诊断',
        command: `md-viewer doctor --docx-service ${serviceUrl} --json`,
        target: 'docx-service',
        risk: 'safe',
      },
    ],
  })
}

function buildRenderSummary(renderResult: BrowserPageRenderResult): Record<string, unknown> {
  return {
    renderStatus: renderResult.status,
    totalCharts: renderResult.stats.totalBlocks,
    renderedCharts: renderResult.stats.renderedBlocks,
    failedCharts: renderResult.stats.failedBlocks,
    renderDurationMs: renderResult.stats.durationMs,
  }
}

function mapRenderWarning(warning: RenderWarning) {
  return {
    code: warning.code,
    message: warning.message,
    target: warning.source ?? warning.renderer,
    action: warning.action
      ? {
          label: warning.action,
          target: warning.renderer,
          risk: 'safe' as const,
        }
      : undefined,
  }
}

// W1：失败但渲染器没产出任何 warning 时，合成一条，保证“有失败必有 warning”（不静默）。
function ensureFailureWarning(warnings: CliWarning[], renderResult: BrowserPageRenderResult): CliWarning[] {
  if (warnings.length > 0) return warnings
  const failed = renderResult.stats.failedBlocks
  if (renderResult.status === 'success' && failed === 0) return warnings
  return [
    {
      code: 'CHART_RENDER_FAILED',
      message:
        failed > 0
          ? `${failed} 个图表未渲染成功（status=${renderResult.status}），产物可能缺图或残留源码`
          : `渲染未完成（status=${renderResult.status}），产物可能不完整`,
      target: 'renderer',
    },
  ]
}

function ensureDocxFailureWarning(warnings: CliWarning[], docxResult: ConvertSourceDocxResult): CliWarning[] {
  if (warnings.length > 0) return warnings
  if (docxResult.renderStatus === 'success' && docxResult.failedBlocks === 0) return warnings
  return [
    {
      code: 'CHART_RENDER_FAILED',
      message: `${docxResult.failedBlocks} 个图表在 DOCX 导出中失败（status=${docxResult.renderStatus}）`,
      target: 'docx-service',
    },
  ]
}
