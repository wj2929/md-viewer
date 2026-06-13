import { readFile } from 'fs/promises'
import path from 'path'
import { validateSecurePath } from '../security/pathValidator'
import type { BrowserPageRenderResult, RenderWarning } from '../../renderer/src/server-render/contracts'
import {
  DocxSourceExportError,
  exportDocxViaConvertSource,
  type ConvertSourceDocxOptions,
  type ConvertSourceDocxResult,
} from './docxSourceExporter'
import { getRegisteredCapabilities } from './capabilitiesRegistry'
import { renderMarkdownHeadless, type HeadlessMarkdownRenderer } from './headlessRenderer'
import { getHeadlessRenderTimeoutMs } from './renderTimeout'
import { createFailureResult, createSuccessResult } from './result'
import { writeHtmlExport, writePdfExport, type PdfDocumentOptions } from './sharedExportWriters'
import type { CliArtifact } from './types'

const SUPPORTED_FORMATS = new Set(['html', 'pdf', 'docx'])
const DEFAULT_DOCX_SERVICE_URL = 'http://127.0.0.1:3179'

interface BuildExportResultOptions {
  renderer?: HeadlessMarkdownRenderer
  pdfWriter?: (outputPath: string, options: PdfDocumentOptions) => Promise<CliArtifact>
  docxExporter?: (options: ConvertSourceDocxOptions) => Promise<ConvertSourceDocxResult>
}

export async function buildExportResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildExportResultOptions = {},
) {
  const input = positional[0]
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
      })

      return createSuccessResult('export', {
        summary: {
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
        },
        artifacts: [docxResult.artifact],
        warnings: docxResult.warnings.map(message => ({
          code: 'DOCX_SERVICE_WARNING',
          message,
          target: 'docx-service',
        })),
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
  const writerOptions = {
    content: renderResult.html,
    title: path.basename(validation.normalizedPath),
    markdownCss: '',
    prismCss: '',
    showBranding: true,
  }
  const artifact = format === 'pdf'
    ? await (options.pdfWriter ?? writePdfExport)(out, writerOptions)
    : await writeHtmlExport(out, writerOptions)

  if (renderResult.status === 'timeout') {
    return createFailureResult('export', {
      code: 'RENDER_TIMEOUT',
      message: `headless 渲染超过 ${renderResult.stats.durationMs}ms 未完成，导出文件可能未完整渲染`,
      target: validation.normalizedPath,
      exitCode: 5,
      summary: {
        format,
        input: validation.normalizedPath,
        output: out,
        bytes: artifact.bytes,
        ...buildRenderSummary(renderResult),
      },
      artifacts: [artifact],
      warnings: renderResult.warnings.map(mapRenderWarning),
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

  return createSuccessResult('export', {
    summary: {
      format,
      input: validation.normalizedPath,
      output: out,
      bytes: artifact.bytes,
      ...buildRenderSummary(renderResult),
    },
    artifacts: [artifact],
    warnings: renderResult.warnings.map(mapRenderWarning),
  })
}

function replaceExtension(filePath: string, extension: string): string {
  return filePath.replace(/\.[^.\\/]+$/, `.${extension}`)
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
