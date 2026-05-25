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
      openExternal: vi.fn().mockResolvedValue({ success: true }),
    }
  })

  it('导出成功但存在 warning 时显示“已导出，有事项需确认”', () => {
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

    expect(screen.getByText(/Word 已导出，有事项需确认/)).toBeInTheDocument()
    expect(screen.getByText('文件已生成，但有 2 项需要确认')).toBeInTheDocument()
    expect(screen.getByText(/1 个图表以代码形式保留/)).toBeInTheDocument()
    expect(screen.getAllByText(/BPMN 文件渲染失败/).length).toBeGreaterThan(0)
    expect(screen.getByText('发生了什么')).toBeInTheDocument()
    expect(screen.getByText('影响是什么')).toBeInTheDocument()
    expect(screen.getByText('下一步怎么做')).toBeInTheDocument()
    expect(screen.getByText(/部分图表或内容可能以源码、占位或降级形式保留/)).toBeInTheDocument()
  })

  it('导出失败时显示结构化影响和下一步动作', () => {
    act(() => {
      useExportTaskStore.getState().startExport('report.md')
      useExportTaskStore.getState().cacheVersionInfo({
        version: '2.1.0',
        platform: 'darwin',
        arch: 'arm64',
        electron: '39.2.7',
      })
      useExportTaskStore.getState().setError('API Key 错误：DOCX 服务返回 401')
    })

    render(<ExportTaskView />)

    expect(screen.getByText(/导出失败/)).toBeInTheDocument()
    expect(screen.getByText('发生了什么')).toBeInTheDocument()
    expect(screen.getByText('影响是什么')).toBeInTheDocument()
    expect(screen.getByText('下一步怎么做')).toBeInTheDocument()
    expect(screen.getByText(/DOCX 服务拒绝了本次请求/)).toBeInTheDocument()
    expect(screen.getByText(/检查 API Key/)).toBeInTheDocument()
  })

  it('DOCX warning 提供服务配置说明入口', async () => {
    act(() => {
      useExportTaskStore.getState().startExport('report.md')
      useExportTaskStore.getState().setDone('/tmp/report.docx', 0, ['未找到可嵌入字体，已跳过字体嵌入'])
    })

    render(<ExportTaskView />)

    const guideButton = screen.getByRole('button', { name: /查看 DOCX 服务配置说明/ })
    guideButton.click()

    expect(window.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user-manual.md#docx-服务配置'))
  })
})
