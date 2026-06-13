import { readFile } from 'fs/promises'
import { validateSecurePath } from '../security/pathValidator'
import type { BrowserPageRenderResult, RenderWarning } from '../../renderer/src/server-render/contracts'
import { getRegisteredCapabilities } from './capabilitiesRegistry'
import {
  captureMarkdownScreenshot,
  type MarkdownScreenshotCapture,
} from './headlessRenderer'
import { getHeadlessRenderTimeoutMs } from './renderTimeout'
import { createFailureResult, createSuccessResult } from './result'

interface BuildScreenshotResultOptions {
  capture?: MarkdownScreenshotCapture
}

export async function buildScreenshotResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildScreenshotResultOptions = {},
) {
  const input = positional[0]
  const out = typeof flags.out === 'string' ? flags.out : undefined
  if (!input || !out) {
    return createFailureResult('screenshot', {
      code: 'INVALID_ARGUMENT',
      message: 'screenshot 需要 Markdown 文件路径和 --out 输出 PNG 路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 screenshot 命令帮助',
          command: 'md-viewer help screenshot --json',
          target: 'screenshot',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('screenshot', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help screenshot --json',
          target: 'screenshot',
          risk: 'safe',
        },
      ],
    })
  }

  const markdown = await readFile(validation.normalizedPath, 'utf8')
  const chartIndex = parsePositiveInteger(flags.chart)
  const selector = chartIndex ? undefined : getSelector(flags)
  const viewport = {
    width: parsePositiveInteger(flags.width) ?? 1280,
    height: parsePositiveInteger(flags.height) ?? 900,
    scaleFactor: parsePositiveScale(flags.scale) ?? 1,
  }

  try {
    const captureResult = await (options.capture ?? captureMarkdownScreenshot)({
      outputPath: out,
      selector,
      chartIndex,
      viewport,
      renderInput: {
        schemaVersion: '1.0',
        markdown,
        markdownFilePath: validation.normalizedPath,
        enabledRenderers: getRegisteredCapabilities().chartTypes,
        networkPolicy: 'blocked',
        timeoutMs: getHeadlessRenderTimeoutMs(flags),
        ...(flags.theme === 'dark' || flags.theme === 'light' ? { theme: flags.theme } : {}),
      },
    })

    return createSuccessResult('screenshot', {
      summary: {
        input: validation.normalizedPath,
        output: out,
        selector: captureResult.target.selector,
        chart: chartIndex,
        bytes: captureResult.artifact.bytes,
        widthPx: captureResult.target.widthPx,
        heightPx: captureResult.target.heightPx,
        ...buildRenderSummary(captureResult.renderResult),
      },
      artifacts: [captureResult.artifact],
      warnings: captureResult.renderResult.warnings.map(mapRenderWarning),
    })
  } catch (error) {
    return createFailureResult('screenshot', {
      code: 'SCREENSHOT_FAILED',
      message: error instanceof Error ? error.message : String(error),
      target: out,
      exitCode: 1,
      actions: [
        {
          label: '检查 selector 或图表序号',
          command: 'md-viewer charts list <markdown> --json',
          target: 'charts',
          risk: 'safe',
        },
      ],
    })
  }
}

function getSelector(flags: Record<string, string | boolean>): string {
  return typeof flags.selector === 'string' && flags.selector.trim() ? flags.selector : '.markdown-body'
}

function parsePositiveInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parsePositiveScale(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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
