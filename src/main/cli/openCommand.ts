import { validateSecurePath } from '../security/pathValidator'
import { createFailureResult, createSuccessResult } from './result'

export async function buildOpenResult(
  positional: string[],
  flags: Record<string, string | boolean>,
) {
  const input = positional[0]

  if (!input) {
    return createFailureResult('open', {
      code: 'INVALID_ARGUMENT',
      message: '缺少要打开的 Markdown 文件或目录路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 open 命令帮助',
          command: 'md-viewer help open --json',
          target: 'open',
          risk: 'safe',
        },
      ],
    })
  }

  const validation = await validateSecurePath(input)
  if (!validation.valid) {
    return createFailureResult('open', {
      code: validation.error === '路径不存在' ? 'INPUT_NOT_FOUND' : 'INPUT_NOT_ALLOWED',
      message: validation.error ?? '路径不可打开',
      target: input,
      exitCode: validation.error === '路径不存在' ? 3 : 2,
      actions: [
        {
          label: '检查输入路径',
          command: 'md-viewer help open --json',
          target: 'open',
          risk: 'safe',
        },
      ],
    })
  }

  const openPayload = {
    type: validation.type,
    normalizedPath: validation.normalizedPath,
    ...(flags.line ? { line: Number(flags.line) } : {}),
    ...(typeof flags.heading === 'string' ? { heading: flags.heading } : {}),
  }

  return createSuccessResult('open', {
    summary: openPayload,
    results: {
      open: openPayload,
    },
  })
}
