import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExport, waitForExportFeedbackPaint } from '../../src/hooks/useExport'
import { useExportTaskStore } from '../../src/stores/exportTaskStore'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

const mocks = vi.hoisted(() => ({
  buildExportHtmlContent: vi.fn(),
  renderChartsForDocx: vi.fn(),
}))

vi.mock('../../src/utils/exportHtml', () => ({
  buildExportHtmlContent: mocks.buildExportHtmlContent,
}))

vi.mock('../../src/utils/docxChartRenderer', () => ({
  renderChartsForDocx: mocks.renderChartsForDocx,
}))

const tab = {
  id: 'tab-1',
  file: { name: 'report.md', path: '/docs/report.md', isDirectory: false },
  content: '# Report',
}

function createToast() {
  return {
    info: vi.fn(() => 'toast-1'),
    close: vi.fn(),
    update: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }
}

function renderExportHook(toast = createToast()) {
  const hook = renderHook(() => useExport({
    splitState: { root: null, activeLeafId: '' },
    tabs: [tab],
    activeTabId: 'tab-1',
    folderPath: '/docs',
    toast,
  }))
  return { ...hook, toast }
}

describe('useExport immediate feedback', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useEditSessionStore.getState().reset()
    useExportTaskStore.getState().close()
    document.body.innerHTML = ''
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    ;(window as any).api = {
      exportHTML: vi.fn().mockResolvedValue('/tmp/report.html'),
      exportPDF: vi.fn().mockResolvedValue('/tmp/report.pdf'),
      exportDOCX: vi.fn().mockResolvedValue({ filePath: '/tmp/report.docx', usedRemote: true, imagesFailed: 0 }),
      getAppSettings: vi.fn().mockResolvedValue({
        docxExport: { remoteEnabled: true, serverUrl: 'http://localhost:3179', localFallbackEnabled: false },
      }),
    }
    mocks.buildExportHtmlContent.mockResolvedValue('<h1>Report</h1>')
    mocks.renderChartsForDocx.mockResolvedValue({
      modifiedMarkdown: '# Report',
      images: [],
      warnings: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useExportTaskStore.getState().close()
  })

  async function flushExportFeedbackPaint() {
    expect(rafCallbacks.length).toBeGreaterThan(0)
    const callbacks = rafCallbacks.splice(0)
    callbacks.forEach(callback => callback(0))
    await vi.runOnlyPendingTimersAsync()
  }

  it('HTML 导出应先显示 toast 并让出一帧，再构建导出内容', async () => {
    const { result, toast } = renderExportHook()

    await act(async () => {
      void result.current.handleExportHTML()
      await Promise.resolve()
    })

    expect(toast.info).toHaveBeenCalledWith('正在导出 HTML...', { duration: 60000 })
    expect(mocks.buildExportHtmlContent).not.toHaveBeenCalled()

    await act(async () => {
      await flushExportFeedbackPaint()
    })

    expect(mocks.buildExportHtmlContent).toHaveBeenCalled()
  })

  it('PDF 导出应先显示 toast 并让出一帧，再构建导出内容', async () => {
    const { result, toast } = renderExportHook()

    await act(async () => {
      void result.current.handleExportPDF()
      await Promise.resolve()
    })

    expect(toast.info).toHaveBeenCalledWith('正在导出 PDF...', { duration: 60000 })
    expect(mocks.buildExportHtmlContent).not.toHaveBeenCalled()

    await act(async () => {
      await flushExportFeedbackPaint()
    })

    expect(mocks.buildExportHtmlContent).toHaveBeenCalled()
  })

  it('远程 DOCX 导出应先显示任务面板并让出一帧，再准备内容和渲染图表', async () => {
    const { result } = renderExportHook()

    await act(async () => {
      void result.current.handleExportDOCX('preview')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useExportTaskStore.getState().status).toBe('rendering')
    expect(mocks.buildExportHtmlContent).not.toHaveBeenCalled()
    expect(mocks.renderChartsForDocx).not.toHaveBeenCalled()

    await act(async () => {
      await flushExportFeedbackPaint()
    })

    expect(mocks.buildExportHtmlContent).toHaveBeenCalled()
  })

  it('上一次远程 DOCX 成功面板未关闭时，仍应允许启动新的导出', async () => {
    useExportTaskStore.getState().setDone('/tmp/old-report.docx', 0, [])
    const { result } = renderExportHook()

    await act(async () => {
      void result.current.handleExportDOCX('preview')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useExportTaskStore.getState().status).toBe('rendering')
    expect(useExportTaskStore.getState().fileName).toBe('report.md')
  })

  it('带 warning 的 DOCX 导出 toast 应提示已导出但有问题', async () => {
    const { result, toast } = renderExportHook()
    ;(window.api.exportDOCX as any).mockResolvedValue({
      filePath: '/tmp/report.docx',
      usedRemote: false,
      usedPandoc: true,
      imagesFailed: 0,
      warnings: ['BPMN 文件渲染失败，已保留原引用。'],
    })

    await act(async () => {
      void result.current.handleExportDOCX('preview')
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await flushExportFeedbackPaint()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toast.success).toHaveBeenCalledWith(
      'Word 已导出，但有问题（Pandoc，1 个警告）',
      expect.any(Object),
    )
  })

  it('waitForExportFeedbackPaint 在没有 requestAnimationFrame 时退回到 setTimeout', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const promise = waitForExportFeedbackPaint()
    let resolved = false
    promise.then(() => { resolved = true })

    await Promise.resolve()
    expect(resolved).toBe(false)

    await vi.runOnlyPendingTimersAsync()
    await promise
    expect(resolved).toBe(true)
  })
})
