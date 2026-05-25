import { beforeEach, describe, expect, it } from 'vitest'
import { useExportTaskStore } from '../../src/stores/exportTaskStore'

describe('exportTaskStore', () => {
  beforeEach(() => {
    useExportTaskStore.getState().close()
  })

  it('stores a normalized ExportResult when DOCX export completes with legacy warnings', () => {
    useExportTaskStore.getState().startExport('report.md')
    useExportTaskStore.getState().setDone('/tmp/report.docx', 0, ['BPMN 文件渲染失败，已保留原引用。'])

    const state = useExportTaskStore.getState()
    expect(state.exportResult).toMatchObject({
      schemaVersion: 2,
      status: 'success-with-warning',
      primaryFilePath: '/tmp/report.docx',
      legacyWarnings: ['BPMN 文件渲染失败，已保留原引用。'],
    })
    expect(state.exportResult?.warnings[0]).toMatchObject({
      category: 'chart-render',
      impact: '文件已生成，但部分图表或内容可能以源码、占位或降级形式保留。',
    })
  })

  it('stores a structured ExportResult when DOCX export fails before generating a file', () => {
    useExportTaskStore.getState().startExport('report.md')
    useExportTaskStore.getState().setError('输出目录不可写')

    const state = useExportTaskStore.getState()
    expect(state.exportResult).toMatchObject({
      schemaVersion: 2,
      status: 'failed',
    })
    expect(state.exportResult?.warnings[0]).toMatchObject({
      severity: 'error',
      category: 'filesystem',
      message: '输出目录不可写',
    })
  })
})
