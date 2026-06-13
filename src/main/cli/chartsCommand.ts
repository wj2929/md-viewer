import AdmZip from 'adm-zip'
import path from 'path'
import { mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { validateSecurePath } from '../security/pathValidator'
import type { BrowserPageRenderResult, RenderWarning } from '../../renderer/src/server-render/contracts'
import { getRegisteredCapabilities } from './capabilitiesRegistry'
import {
  captureMarkdownScreenshot,
  renderMarkdownHeadless,
  type HeadlessMarkdownRenderer,
  type MarkdownScreenshotCapture,
} from './headlessRenderer'
import { getHeadlessRenderTimeoutMs } from './renderTimeout'
import { createFailureResult, createSuccessResult } from './result'
import type { CliArtifact } from './types'

interface BuildChartsResultOptions {
  renderer?: HeadlessMarkdownRenderer
  capture?: MarkdownScreenshotCapture
}

export async function buildChartsResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildChartsResultOptions = {},
) {
  const action = positional[0]
  const input = positional[1]

  if ((action !== 'list' && action !== 'export') || !input) {
    return createFailureResult('charts', {
      code: 'INVALID_ARGUMENT',
      message: 'charts 需要 action=list|export 和 Markdown 文件路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 charts 命令帮助',
          command: 'md-viewer help charts --json',
          target: 'charts',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('charts', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help charts --json',
          target: 'charts',
          risk: 'safe',
        },
      ],
    })
  }

  const markdown = await readFile(validation.normalizedPath, 'utf8')
  const renderer = options.renderer ?? renderMarkdownHeadless
  const timeoutMs = getHeadlessRenderTimeoutMs(flags)
  const renderResult = await renderer({
    schemaVersion: '1.0',
    markdown,
    markdownFilePath: validation.normalizedPath,
    enabledRenderers: getRegisteredCapabilities().chartTypes,
    networkPolicy: 'blocked',
    timeoutMs,
  })

  if (action === 'list') {
    return createSuccessResult('charts', {
      summary: {
        action,
        input: validation.normalizedPath,
        ...buildRenderSummary(renderResult),
      },
      results: {
        charts: buildChartList(renderResult),
      },
      warnings: renderResult.warnings.map(mapRenderWarning),
    })
  }

  const outDir = typeof flags['out-dir'] === 'string' ? flags['out-dir'] : undefined
  const outZip = typeof flags.out === 'string' ? flags.out : undefined
  if (!outDir && !outZip) {
    return createFailureResult('charts', {
      code: 'INVALID_ARGUMENT',
      message: 'charts export 需要 --out-dir 输出目录或 --out ZIP 路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 charts 命令帮助',
          command: 'md-viewer help charts --json',
          target: 'charts',
          risk: 'safe',
        },
      ],
    })
  }

  const captureDir = outDir ?? await mkdtemp(path.join(tmpdir(), 'mdv-cli-charts-export-'))
  const capture = options.capture ?? captureMarkdownScreenshot
  const artifacts: CliArtifact[] = []

  try {
    await mkdir(captureDir, { recursive: true })
    for (const [index, chart] of renderResult.images.entries()) {
      const outputPath = path.join(captureDir, buildChartFileName(index, chart.type, chart.id))
      const captured = await capture({
        outputPath,
        chartIndex: index + 1,
        viewport: {
          width: 1280,
          height: 900,
          scaleFactor: 1,
        },
        renderInput: {
          schemaVersion: '1.0',
          markdown,
          markdownFilePath: validation.normalizedPath,
          enabledRenderers: getRegisteredCapabilities().chartTypes,
          networkPolicy: 'blocked',
          timeoutMs,
        },
      })
      artifacts.push(captured.artifact)
    }

    if (outZip) {
      const zip = new AdmZip()
      for (const artifact of artifacts) {
        zip.addLocalFile(artifact.path)
      }
      await mkdir(path.dirname(outZip), { recursive: true })
      await new Promise<void>((resolve, reject) => {
        zip.writeZip(outZip, error => {
          if (error) reject(error)
          else resolve()
        })
      })
      const zipStat = await stat(outZip)
      artifacts.push({
        type: 'zip',
        path: outZip,
        bytes: zipStat.size,
      })
    }

    return createSuccessResult('charts', {
      summary: {
        action,
        input: validation.normalizedPath,
        outputDir: outDir,
        outputZip: outZip,
        exportedCharts: renderResult.images.length,
        ...buildRenderSummary(renderResult),
      },
      results: {
        charts: buildChartList(renderResult),
      },
      artifacts,
      warnings: renderResult.warnings.map(mapRenderWarning),
    })
  } finally {
    if (!outDir) {
      await rm(captureDir, { recursive: true, force: true })
    }
  }
}

function buildChartList(renderResult: BrowserPageRenderResult) {
  return renderResult.images.map((image, index) => ({
    index: index + 1,
    id: image.id,
    type: image.type,
    selector: image.selector,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
    widthCm: image.widthCm,
    durationMs: image.durationMs,
    sourceIndex: image.sourceIndex,
    blockId: image.blockId,
  }))
}

function buildChartFileName(index: number, type: string, id: string): string {
  return `${String(index + 1).padStart(2, '0')}-${sanitizeFileSegment(type)}-${sanitizeFileSegment(id)}.png`
}

function sanitizeFileSegment(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'chart'
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
