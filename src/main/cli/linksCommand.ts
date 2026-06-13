import { validateSecurePath } from '../security/pathValidator'
import { analyzeMarkdownFile, type MarkdownAnalysis } from './markdownAnalysis'
import { buildAnalysisWarnings } from './inspectCommand'
import { createFailureResult, createSuccessResult } from './result'

export async function buildLinksResult(
  positional: string[],
  _flags: Record<string, string | boolean>,
) {
  const input = positional[0]
  if (!input) {
    return createFailureResult('links', {
      code: 'INVALID_ARGUMENT',
      message: 'links 需要 Markdown 文件路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 links 命令帮助',
          command: 'md-viewer help links --json',
          target: 'links',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('links', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help links --json',
          target: 'links',
          risk: 'safe',
        },
      ],
    })
  }

  const analysis = await analyzeMarkdownFile(validation.normalizedPath)
  const results = buildLinksResults(analysis)
  const issueCount = results.missingFiles.length + results.missingAnchors.length + results.missingAssets.length

  return createSuccessResult('links', {
    summary: {
      input: validation.normalizedPath,
      status: issueCount > 0 ? 'issues' : 'ok',
      totalLinks: analysis.links.length,
      brokenLinks: results.missingFiles.length + results.missingAnchors.length,
      missingAssets: results.missingAssets.length,
      externalLinks: results.externalLinks.length,
    },
    results,
    warnings: buildAnalysisWarnings(analysis),
    actions: issueCount > 0
      ? [
          {
            label: '查看文档结构分析',
            command: 'md-viewer inspect',
            target: 'inspect',
            risk: 'safe',
          },
        ]
      : [],
  })
}

function buildLinksResults(analysis: MarkdownAnalysis) {
  return {
    missingFiles: analysis.links.filter(link => link.kind === 'markdown' && link.exists === false),
    missingAnchors: analysis.links.filter(link => link.anchor && link.anchorExists === false),
    missingAssets: analysis.images.filter(image => image.kind === 'local' && image.exists === false),
    externalLinks: analysis.links.filter(link => link.kind === 'external'),
    markdownLinks: analysis.links.filter(link => link.kind === 'markdown'),
    anchorLinks: analysis.links.filter(link => link.kind === 'anchor'),
    localResourceLinks: analysis.links.filter(link => link.kind === 'local-resource'),
  }
}
