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
    // warning 级折成一行：只展示 message（附 impact），不再有「发生了什么/影响是什么/下一步怎么做」三段标签
    expect(screen.queryByText('发生了什么')).not.toBeInTheDocument()
    expect(screen.queryByText('影响是什么')).not.toBeInTheDocument()
    expect(screen.queryByText('下一步怎么做')).not.toBeInTheDocument()
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
    // action-required 级保留引导两段（去掉与圆点行重复的「发生了什么」）
    expect(screen.queryByText('发生了什么')).not.toBeInTheDocument()
    expect(screen.getByText('影响是什么')).toBeInTheDocument()
    expect(screen.getByText('下一步怎么做')).toBeInTheDocument()
    expect(screen.getByText(/DOCX 服务拒绝了本次请求/)).toBeInTheDocument()
    expect(screen.getByText(/检查 API Key/)).toBeInTheDocument()
  })

  it('字体替代警告折成一行且不显示配置说明按钮', () => {
    act(() => {
      useExportTaskStore.getState().startExport('report.md')
      useExportTaskStore.getState().setDone('/tmp/report.docx', 0, ['未找到可嵌入字体，已跳过字体嵌入'])
    })

    render(<ExportTaskView />)

    // 字体替代为纯告知（warning 级）：一行展示，不再有三段标签或 DOCX 配置说明按钮
    expect(screen.getByText(/未找到可嵌入字体/)).toBeInTheDocument()
    expect(screen.queryByText('发生了什么')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看 DOCX 服务配置说明/ })).not.toBeInTheDocument()
  })

  it('DOCX 服务不可用（action-required）保留配置说明入口', async () => {
    act(() => {
      useExportTaskStore.getState().startExport('report.md')
      useExportTaskStore.getState().setError('DOCX 服务连接失败：无法连接到 http://127.0.0.1:3179')
    })

    render(<ExportTaskView />)

    const guideButton = screen.getByRole('button', { name: /查看 DOCX 服务配置说明/ })
    guideButton.click()

    expect(window.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user-manual.md#docx-服务配置'))
  })
})
