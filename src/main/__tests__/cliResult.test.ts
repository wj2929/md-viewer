import { describe, expect, it } from 'vitest'
import { createFailureResult, createSuccessResult, getExitCode, stringifyCliResult } from '../cli/result'

describe('CLI result contract', () => {
  it('creates stable success results with default arrays', () => {
    const result = createSuccessResult('capabilities', {
      summary: { commands: 3 },
      results: { names: ['capabilities', 'schema', 'help'] },
    })

    expect(result).toEqual({
      schemaVersion: '1.0',
      ok: true,
      command: 'capabilities',
      summary: { commands: 3 },
      results: { names: ['capabilities', 'schema', 'help'] },
      artifacts: [],
      warnings: [],
      actions: [],
    })
    expect(getExitCode(result)).toBe(0)
  })

  it('creates structured failure results with safe actions', () => {
    const result = createFailureResult('export', {
      code: 'DOCX_SERVICE_UNAVAILABLE',
      message: '无法连接 DOCX 服务',
      target: 'docx-service',
      exitCode: 4,
      actions: [
        {
          label: '检查 DOCX 服务',
          command: 'md-viewer doctor --json',
          target: 'docx-service',
          risk: 'safe',
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.schemaVersion).toBe('1.0')
    expect(result.actions[0].risk).toBe('safe')
    expect(getExitCode(result)).toBe(4)
  })

  it('stringifies stdout-safe JSON without extra text', () => {
    const result = createSuccessResult('help', { summary: { ok: true } })
    expect(JSON.parse(stringifyCliResult(result))).toEqual(result)
  })
})
