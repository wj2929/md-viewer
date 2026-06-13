import { validateSecurePath } from '../security/pathValidator'
import { analyzeMarkdownFile, type MarkdownAnalysis } from './markdownAnalysis'
import { createFailureResult, createSuccessResult } from './result'
import type { CliWarning } from './types'

export async function buildInspectResult(
  positional: string[],
  _flags: Record<string, string | boolean>,
) {
  const input = positional[0]
  if (!input) {
    return createFailureResult('inspect', {
      code: 'INVALID_ARGUMENT',
      message: 'inspect 需要 Markdown 文件路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 inspect 命令帮助',
          command: 'md-viewer help inspect --json',
          target: 'inspect',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('inspect', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help inspect --json',
          target: 'inspect',
          risk: 'safe',
        },
      ],
    })
  }

  const analysis = await analyzeMarkdownFile(validation.normalizedPath)
  return createSuccessResult('inspect', {
    summary: {
      input: validation.normalizedPath,
      ...analysis.summary,
    },
    results: buildInspectResults(analysis),
    warnings: buildAnalysisWarnings(analysis),
    actions: buildInspectActions(analysis),
  })
}

function buildInspectResults(analysis: MarkdownAnalysis): Record<string, unknown> {
  return {
    input: analysis.input,
    headings: analysis.headings,
    images: analysis.images,
    links: analysis.links,
    codeBlocks: analysis.codeBlocks,
    chartBlocks: analysis.chartBlocks,
  }
}

export function buildAnalysisWarnings(analysis: MarkdownAnalysis): CliWarning[] {
  const warnings: CliWarning[] = []

  for (const image of analysis.images.filter(image => image.kind === 'local' && image.exists === false)) {
    warnings.push({
      code: 'LOCAL_RESOURCE_MISSING',
      message: `本地图片资源不存在：${image.target}`,
      target: image.target,
    })
  }

  for (const link of analysis.links.filter(link => link.kind === 'markdown' && link.exists === false)) {
    warnings.push({
      code: 'MARKDOWN_LINK_MISSING',
      message: `Markdown 链接目标不存在：${link.target}`,
      target: link.target,
    })
  }

  for (const link of analysis.links.filter(link => link.anchor && link.anchorExists === false)) {
    warnings.push({
      code: 'ANCHOR_MISSING',
      message: `Markdown 链接锚点不存在：${link.target}`,
      target: link.target,
    })
  }

  return warnings
}

function buildInspectActions(analysis: MarkdownAnalysis) {
  if (analysis.summary.missingAssets + analysis.summary.missingMarkdownLinks + analysis.summary.missingAnchors === 0) {
    return []
  }
  return [
    {
      label: '检查链接和资源',
      command: `md-viewer links "${analysis.input}" --json`,
      target: 'links',
      risk: 'safe' as const,
    },
  ]
}
