import { readFile, stat } from 'fs/promises'
import path from 'path'
import { validateSecurePath } from '../security/pathValidator'
import { checkDocxService } from './diagnostics'
import { createFailureResult, createSuccessResult } from './result'
import type { CliAction, CliWarning } from './types'

const SUPPORTED_FORMATS = new Set(['html', 'pdf', 'docx'])
const LOCAL_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/g
const DEFAULT_DOCX_SERVICE_URL = 'http://127.0.0.1:3179'

export async function buildPreflightResult(
  positional: string[],
  flags: Record<string, string | boolean>,
) {
  const input = positional[0]
  const format = typeof flags.format === 'string' ? flags.format : undefined

  if (!input || !format || !SUPPORTED_FORMATS.has(format)) {
    return createFailureResult('preflight', {
      code: 'INVALID_ARGUMENT',
      message: 'preflight 需要 Markdown 文件路径和有效的 --format html|pdf|docx',
      exitCode: 2,
      actions: [
        {
          label: '查看 preflight 命令帮助',
          command: 'md-viewer help preflight --json',
          target: 'preflight',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid || validation.type !== 'md-file') {
    return createFailureResult('preflight', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '输入文件不可用',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入文件路径',
          command: 'md-viewer help preflight --json',
          target: 'preflight',
          risk: 'safe',
        },
      ],
    })
  }

  const markdown = await readFile(validation.normalizedPath, 'utf8')
  const warnings = await collectLocalImageWarnings(markdown, validation.normalizedPath)
  const actions: CliAction[] = []
  const docxServiceUrl = format === 'docx' ? getDocxServiceUrl(flags) : undefined
  const docxService = docxServiceUrl ? await checkDocxService(docxServiceUrl) : undefined
  if (docxService && !docxService.ok) {
    warnings.push({
      code: 'DOCX_SERVICE_UNAVAILABLE',
      message: '无法连接 DOCX 服务',
      target: docxServiceUrl,
    })
    actions.push({
      label: '检查 DOCX 服务',
      command: `md-viewer doctor --docx-service ${docxServiceUrl} --json`,
      target: 'docx-service',
      risk: 'safe',
    })
  }
  const missingResources = warnings.filter(warning => warning.code === 'LOCAL_RESOURCE_MISSING').length

  return createSuccessResult('preflight', {
    summary: {
      status: warnings.length > 0 ? 'warning' : 'ok',
      format,
      input: validation.normalizedPath,
      missingResources,
      ...(docxService ? { docxService: docxService.ok } : {}),
    },
    results: {
      input: validation.normalizedPath,
      format,
      resources: {
        missing: missingResources,
      },
      ...(docxService ? { docxService } : {}),
    },
    warnings,
    actions,
  })
}

function getDocxServiceUrl(flags: Record<string, string | boolean>): string {
  if (typeof flags['docx-service'] === 'string') {
    return flags['docx-service']
  }
  return process.env.MD_VIEWER_DOCX_SERVICE_URL || DEFAULT_DOCX_SERVICE_URL
}

async function collectLocalImageWarnings(markdown: string, markdownPath: string): Promise<CliWarning[]> {
  const warnings: CliWarning[] = []
  const baseDir = path.dirname(markdownPath)

  for (const match of markdown.matchAll(LOCAL_IMAGE_PATTERN)) {
    const rawTarget = match[1]?.trim()
    if (!rawTarget || isRemoteOrDataUrl(rawTarget)) {
      continue
    }

    const cleanTarget = rawTarget.split(/\s+/)[0].replace(/^<|>$/g, '')
    const resourcePath = path.resolve(baseDir, decodeURIComponent(cleanTarget))

    try {
      await stat(resourcePath)
    } catch {
      warnings.push({
        code: 'LOCAL_RESOURCE_MISSING',
        message: `本地图片资源不存在：${cleanTarget}`,
        target: cleanTarget,
      })
    }
  }

  return warnings
}

function isRemoteOrDataUrl(target: string): boolean {
  return /^(?:https?:|data:|file:|local-image:)/i.test(target)
}
