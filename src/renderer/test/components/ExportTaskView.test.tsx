import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportTaskView } from '../../src/components/ExportTaskView'
import { useExportTaskStore } from '../../src/stores/exportTaskStore'

describe('ExportTaskView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useExportTaskStore.getState().close()
    ;(window as any).api = {
      ...window.api,
      getAppVersion: vi.fn().mockResolvedValue({
        version: '2.1.0',
        platform: 'darwin',
        arch: 'arm64',
        electron: '39.2.7',
      }),
    }
  })

  it('导出成功但存在 warning 时显示“已导出，但有问题”', () => {
    act(() => {
      useExportTaskStore.getState().startExport('report.md')
      useExportTaskStore.getState().cacheVersionInfo({
        version: '2.1.0',
        platform: 'darwin',
        arch: 'arm64',
        electron: '39.2.7',
      })
      useExportTaskStore.getState().setDone('/tmp/report.docx', 1, ['BPMN 文件渲染失败，已保留原引用。'])
    })

    render(<ExportTaskView />)

    expect(screen.getByText(/Word 已导出，但有问题/)).toBeInTheDocument()
    expect(screen.getByText('文件已生成，但有 2 项需要确认')).toBeInTheDocument()
    expect(screen.getByText(/1 个图表以代码形式保留/)).toBeInTheDocument()
    expect(screen.getByText(/BPMN 文件渲染失败/)).toBeInTheDocument()
  })
})
