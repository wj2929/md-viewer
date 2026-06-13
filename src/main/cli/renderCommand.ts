import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import { validateSecurePath } from '../security/pathValidator'
import type { BrowserPageRenderResult, RenderWarning } from '../../renderer/src/server-render/contracts'
import { getRegisteredCapabilities } from './capabilitiesRegistry'
import { renderMarkdownHeadless, type HeadlessMarkdownRenderer } from './headlessRenderer'
import { getHeadlessRenderTimeoutMs } from './renderTimeout'
import { createFailureResult, createSuccessResult } from './result'
import type { CliArtifact } from './types'

interface BuildRenderResultOptions {
  renderer?: HeadlessMarkdownRenderer
}

export async function buildRenderResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildRenderResultOptions = {},
) {
  const input = positional[0]
  if (!input) {
    return createFailureResult('render', {
      code: 'INVALID_ARGUMENT',
      message: 'render 需要 Markdown 文件路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 render 命令帮助',
          command: 'md-viewer help render --json',
          target: 'render',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('render', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help render --json',
          target: 'render',
          risk: 'safe',
        },
      ],
    })
  }

  const markdown = await readFile(validation.normalizedPath, 'utf8')
  const renderer = options.renderer ?? renderMarkdownHeadless
  const renderResult = await renderer({
    schemaVersion: '1.0',
    markdown,
    markdownFilePath: validation.normalizedPath,
    enabledRenderers: getRegisteredCapabilities().chartTypes,
    networkPolicy: 'blocked',
    timeoutMs: getHeadlessRenderTimeoutMs(flags),
  })

  const artifacts: CliArtifact[] = []
  const out = typeof flags.out === 'string' ? flags.out : undefined
  if (out) {
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, renderResult.html, 'utf8')
    const outStat = await stat(out)
    artifacts.push({
      type: 'html',
      path: out,
      bytes: outStat.size,
    })
  }

  return createSuccessResult('render', {
    summary: {
      input: validation.normalizedPath,
      ...buildRenderSummary(renderResult),
    },
    results: {
      htmlLength: renderResult.html.length,
      charts: buildChartList(renderResult),
    },
    artifacts,
    warnings: renderResult.warnings.map(mapRenderWarning),
  })
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
