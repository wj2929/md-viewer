import { getCommandParameterSchema, getSharedResultSchema } from './schemas'
import { createFailureResult, createSuccessResult } from './result'

export function getResultSchema() {
  return getSharedResultSchema()
}

export function getCommandSchema(command: string) {
  return getCommandParameterSchema(command)
}

export function buildSchemaResult(positional: string[] = []) {
  const target = positional[0] ?? 'result'
  const schema = target === 'result' ? getResultSchema() : getCommandSchema(target)

  if (!schema) {
    return createFailureResult('schema', {
      code: 'UNKNOWN_SCHEMA_TARGET',
      message: `未知 schema 目标：${target}`,
      target,
      exitCode: 2,
      actions: [
        {
          label: '查看可用能力',
          command: 'md-viewer capabilities --json',
          target: 'capabilities',
          risk: 'safe',
        },
      ],
    })
  }

  return createSuccessResult('schema', {
    summary: { target },
    results: { schema },
  })
}
