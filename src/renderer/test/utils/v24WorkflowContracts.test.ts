import { describe, expect, it } from 'vitest'
import {
  SEARCH_LIMITS,
  applySearchInputLimits,
  createEditableBlockDecision,
  createOpenDocumentCommand,
  createSearchMatch,
  createSearchResult,
  normalizeExportResult,
  searchResultToOpenDocumentCommand,
} from '../../src/utils/v24WorkflowContracts'

describe('v2.4 workflow contracts', () => {
  it('applies searchable file limits with explicit degraded reasons', () => {
    const files = [
      { name: 'large.md', path: '/docs/large.md', content: 'x'.repeat(SEARCH_LIMITS.maxFileBytes + 1) },
      { name: 'small.md', path: '/docs/small.md', content: 'hello' },
      ...Array.from({ length: SEARCH_LIMITS.maxFiles }, (_, index) => ({
        name: `extra-${index}.md`,
        path: `/docs/extra-${index}.md`,
        content: 'hello',
      })),
    ]

    const limited = applySearchInputLimits(files)

    expect(limited.files).toHaveLength(SEARCH_LIMITS.maxFiles)
    expect(limited.files.some(file => file.path === '/docs/large.md')).toBe(false)
    expect(limited.skippedCount).toBeGreaterThan(0)
    expect(limited.degradedReason).toContain('只显示部分结果')
    expect(limited.skippedReasons).toContain('file-too-large')
    expect(limited.skippedReasons).toContain('too-many-files')
  })

  it('supports direct editing only for simple Markdown blocks in P0', () => {
    expect(createEditableBlockDecision({
      blockId: 'paragraph-1',
      kind: 'paragraph',
      sourceRange: { startLine: 3, endLine: 3 },
    })).toMatchObject({
      directEdit: 'supported',
      action: 'edit-inline',
    })

    expect(createEditableBlockDecision({
      blockId: 'table-1-cell-2',
      kind: 'table-cell',
      sourceRange: { startLine: 12, endLine: 16 },
    })).toMatchObject({
      directEdit: 'supported',
      action: 'edit-inline',
    })

    expect(createEditableBlockDecision({
      blockId: 'chart-1',
      kind: 'chart',
      sourceRange: { startLine: 20, endLine: 25 },
    })).toMatchObject({
      directEdit: 'unsupported',
      action: 'edit-source',
    })
  })

  it('converts a search match into an explicit open-document command', () => {
    const match = createSearchMatch({
      id: 'match-1',
      lineNumber: 42,
      snippet: '教师智能素养项目调用量',
      matchRange: { start: 3, end: 9 },
    })
    const result = createSearchResult({
      id: 'result-1',
      source: 'content',
      scope: 'workspace',
      query: '智能素养',
      filePath: '/docs/report.md',
      canonicalPath: '/real/docs/report.md',
      matches: [match],
    })

    const command = searchResultToOpenDocumentCommand(result, match.id, {
      leafId: 'leaf-a',
      issuedAt: 1700000000000,
    })

    expect(command).toMatchObject({
      source: 'search',
      filePath: '/docs/report.md',
      canonicalPath: '/real/docs/report.md',
      leafId: 'leaf-a',
      dirtyPolicy: 'prompt',
      preserveFilter: true,
      fallback: 'top',
      target: {
        kind: 'match',
        lineNumber: 42,
        matchRange: { start: 3, end: 9 },
        highlightText: '智能素养',
      },
    })
  })

  it('normalizes legacy string warnings into a structured export result', () => {
    const result = normalizeExportResult({
      filePath: '/tmp/report.docx',
      imagesFailed: 0,
      warnings: ['BPMN 文件渲染失败，已保留原引用。'],
    })

    expect(result).toMatchObject({
      schemaVersion: 2,
      status: 'success-with-warning',
      primaryFilePath: '/tmp/report.docx',
      legacyWarnings: ['BPMN 文件渲染失败，已保留原引用。'],
    })
    expect(result.warnings[0]).toMatchObject({
      severity: 'warning',
      category: 'chart-render',
      source: 'desktop',
      message: 'BPMN 文件渲染失败，已保留原引用。',
      impact: '文件已生成，但部分图表或内容可能以源码、占位或降级形式保留。',
      userAction: '查看导出详情，确认受影响内容；必要时修正文档源码后重新导出。',
    })
  })

  it('marks missing DOCX service as action-required even when no file was generated', () => {
    const result = normalizeExportResult({
      warnings: ['无法连接 DOCX 服务：http://127.0.0.1:3179'],
    })

    expect(result.status).toBe('action-required')
    expect(result.warnings[0]).toMatchObject({
      severity: 'action-required',
      category: 'service-unavailable',
      userAction: '检查 DOCX 服务地址、启动状态和 API Key 配置后重新导出。',
    })
  })

  it('classifies auth and version warnings as action-required diagnostics', () => {
    const authResult = normalizeExportResult({
      warnings: ['API Key 错误：DOCX 服务返回 401'],
    })
    expect(authResult.status).toBe('action-required')
    expect(authResult.warnings[0]).toMatchObject({
      severity: 'action-required',
      category: 'auth',
      source: 'docx-service',
    })

    const versionResult = normalizeExportResult({
      filePath: '/tmp/report.docx',
      warnings: ['DOCX 服务版本过低，建议升级到 v2.4.0'],
    })
    expect(versionResult.status).toBe('action-required')
    expect(versionResult.warnings[0]).toMatchObject({
      severity: 'action-required',
      category: 'version',
      source: 'docx-service',
    })
  })

  it('marks filesystem errors without a generated file as failed', () => {
    const result = normalizeExportResult({
      structuredWarnings: [{
        severity: 'error',
        category: 'filesystem',
        source: 'desktop',
        message: '输出目录不可写',
        impact: 'DOCX 文件未生成。',
        userAction: '检查输出目录权限后重新导出。',
      }],
    })

    expect(result.status).toBe('failed')
    expect(result.warnings[0]).toMatchObject({
      severity: 'error',
      category: 'filesystem',
    })
  })
})
