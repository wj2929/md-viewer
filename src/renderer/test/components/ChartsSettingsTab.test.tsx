import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartsSettingsTab } from '../../src/components/settings/ChartsSettingsTab'
import type { EditorInsertionSession } from '../../src/components/settings/chartSettingsTypes'
import { useRemoteChartSettingsStore } from '../../src/stores/remoteChartSettingsStore'

const virtualizedMarkdown = vi.hoisted(() => vi.fn(({ content }: { content: string }) => (
  <div data-testid="chart-preview">{content}</div>
)))

vi.mock('../../src/components/VirtualizedMarkdown', () => ({
  VirtualizedMarkdown: virtualizedMarkdown,
}))

const readyStatus = {
  state: 'ready' as const,
  packageVersion: '2.8.0',
  appVersion: '2.8.0',
  bytes: 101139,
  caseCount: 93,
  rendererCount: 20,
  message: '内置离线示例包已就绪，无需联网。',
}

function renderCharts(options: {
  initialView?: 'capabilities' | 'examples' | 'service'
  insertionSession?: EditorInsertionSession
  onCloseSettings?: () => void
  onOpenChartExamples?: () => Promise<any>
} = {}) {
  return render(
    <ChartsSettingsTab
      initialView={options.initialView ?? 'capabilities'}
      insertionSession={options.insertionSession}
      onCloseSettings={options.onCloseSettings ?? vi.fn()}
      onOpenChartExamples={options.onOpenChartExamples ?? vi.fn().mockResolvedValue({ canceled: true })}
    />
  )
}

describe('ChartsSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    ;(globalThis as any).fetch = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    ;(window as any).api = {
      getChartExamplesStatus: vi.fn().mockResolvedValue(readyStatus),
      saveChartExamples: vi.fn().mockResolvedValue({ canceled: true }),
      showItemInFolder: vi.fn().mockResolvedValue({ success: true }),
      getAppSettings: vi.fn().mockResolvedValue({ autoRenderRemoteCharts: true }),
      updateAppSettings: vi.fn().mockResolvedValue(undefined),
    }
    useRemoteChartSettingsStore.setState({
      hydration: 'ready',
      autoRenderRemoteCharts: true,
      approvedDocuments: {},
    })
  })

  it('shows all registry-backed renderers and filters by alias', () => {
    const { container } = renderCharts()

    expect(container.querySelectorAll('.chart-catalog-card')).toHaveLength(20)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索图表' }), {
      target: { value: 'vegalite' },
    })

    expect(container.querySelectorAll('.chart-catalog-card')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Vega-Lite/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mermaid/ })).not.toBeInTheDocument()
  })

  it('combines category filters with search and can recover from an empty result', () => {
    const { container } = renderCharts()

    fireEvent.click(screen.getByRole('button', { name: '需要服务，3 种' }))
    expect(container.querySelectorAll('.chart-catalog-card')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /^PlantUML\b/ })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索图表' }), {
      target: { value: 'mermaid' },
    })
    expect(screen.getByText('没有匹配的图表类型')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    expect(container.querySelectorAll('.chart-catalog-card')).toHaveLength(20)
  })

  it('previews offline and remote starters automatically when the default setting is enabled', async () => {
    renderCharts()

    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    expect(screen.getByTestId('chart-preview')).toHaveTextContent('```mermaid')
    expect(virtualizedMarkdown).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '返回模板库' }))
    fireEvent.click(screen.getByRole('button', { name: /^PlantUML\b/ }))
    expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('chart-preview')).toHaveTextContent('```plantuml'))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '连接服务并预览' })).not.toBeInTheDocument()
    expect(virtualizedMarkdown).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('需服务').length).toBeGreaterThan(0)
  })

  it('copies the selected starter as complete Markdown', async () => {
    renderCharts()
    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制源码' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '```mermaid\nflowchart LR\n  User([用户]) --> Check{源码有效?}\n  Check -->|是| Render[渲染图表]\n  Check -->|否| Edit[修正源码]\n  Edit --> Check\n  Render --> Export[(导出文档)]\n```'
      )
      expect(screen.getByText('模板源码已复制。')).toBeInTheDocument()
    })
  })

  it('switches among the three task-focused chart views without automatic network access', async () => {
    renderCharts()

    fireEvent.click(screen.getByRole('tab', { name: /离线示例/ }))
    await waitFor(() => {
      expect(screen.getByText('内置离线示例包已就绪，无需联网。')).toBeInTheDocument()
    })
    expect(window.api.getChartExamplesStatus).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: /渲染服务/ }))
    expect(screen.getAllByText('PlantUML').length).toBeGreaterThan(0)
    expect(screen.getByText('Kroki')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('persists the automatic remote rendering switch and rolls back failed saves', async () => {
    renderCharts({ initialView: 'service' })
    const checkbox = screen.getByRole('checkbox', { name: /自动渲染联网图表/ })
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    await waitFor(() => expect(window.api.updateAppSettings).toHaveBeenCalledWith({ autoRenderRemoteCharts: false }))
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('已关闭自动渲染；普通文档将每篇确认一次。')).toBeInTheDocument()

    vi.mocked(window.api.updateAppSettings).mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(checkbox)
    await waitFor(() => expect(screen.getByText('设置保存失败，已恢复原状态。')).toBeInTheDocument())
    expect(checkbox).not.toBeChecked()
  })

  it('rejects non-HTTP PlantUML service addresses without fetching or persisting them', () => {
    renderCharts({ initialView: 'service' })
    fireEvent.click(screen.getByRole('radio', { name: '自定义服务' }))
    const input = screen.getByLabelText('服务地址')

    fireEvent.change(input, { target: { value: 'file:///tmp/plantuml' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    expect(screen.getByText('请输入有效的 http:// 或 https:// 服务地址。')).toBeInTheDocument()
    expect(localStorage.getItem('plantuml-server-url')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('disables saving and shows the local integrity error when the package is corrupt', async () => {
    vi.mocked(window.api.getChartExamplesStatus).mockResolvedValue({
      state: 'corrupt',
      appVersion: '2.8.0',
      message: '内置图表示例包完整性校验失败，请重新安装 MD Viewer。',
    })
    renderCharts({ initialView: 'examples' })

    expect(await screen.findByText('内置图表示例包完整性校验失败，请重新安装 MD Viewer。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开离线示例…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '仅导出 ZIP…' })).toBeDisabled()
    expect(window.api.saveChartExamples).not.toHaveBeenCalled()
  })

  it('opens examples as the primary action and keeps ZIP export as a secondary action', async () => {
    const onOpenChartExamples = vi.fn().mockResolvedValue({ canceled: true })
    vi.mocked(window.api.saveChartExamples).mockResolvedValue({
      canceled: false,
      filePath: '/Users/test/Downloads/md-viewer-chart-examples-v2.8.0.zip',
      packageVersion: '2.8.0',
      bytes: 101139,
    })
    renderCharts({ initialView: 'examples', onOpenChartExamples })

    const openButton = await screen.findByRole('button', { name: '打开离线示例…' })
    const saveButton = screen.getByRole('button', { name: '仅导出 ZIP…' })
    await waitFor(() => expect(openButton).toBeEnabled())
    expect(screen.getByText(/无需选择位置或手工解压/)).toBeInTheDocument()
    expect(screen.queryByText('如何使用')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(openButton) })
    await waitFor(() => expect(onOpenChartExamples).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(openButton).toHaveTextContent('打开离线示例…'))
    expect(openButton).toBeEnabled()
    expect(screen.queryByText(/失败|无法准备/)).not.toBeInTheDocument()

    await act(async () => { fireEvent.click(saveButton) })
    expect(await screen.findByText('示例包已导出。')).toBeInTheDocument()
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '在文件管理器中显示' }))
    expect(window.api.showItemInFolder).toHaveBeenCalledWith('/Users/test/Downloads/md-viewer-chart-examples-v2.8.0.zip')
    expect(screen.queryByText(/请先.*解压|打开已解压/)).not.toBeInTheDocument()
  })

  it('keeps the examples page open and shows a structured install error', async () => {
    const onOpenChartExamples = vi.fn().mockResolvedValue({
      canceled: false,
      error: {
        code: 'DESTINATION_EXISTS',
        message: '目标示例文件夹已存在且内容不同。',
      },
    })
    renderCharts({ initialView: 'examples', onOpenChartExamples })

    const openButton = await screen.findByRole('button', { name: '打开离线示例…' })
    await waitFor(() => expect(openButton).toBeEnabled())
    await act(async () => { fireEvent.click(openButton) })

    expect(await screen.findByText('目标示例文件夹已存在且内容不同。')).toBeInTheDocument()
    expect(openButton).toBeEnabled()
  })

  it('keeps canceled saves quiet and displays structured save failures', async () => {
    renderCharts({ initialView: 'examples' })
    const saveButton = await screen.findByRole('button', { name: '仅导出 ZIP…' })
    await waitFor(() => expect(saveButton).toBeEnabled())

    fireEvent.click(saveButton)
    await waitFor(() => expect(window.api.saveChartExamples).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/失败|无法写入/)).not.toBeInTheDocument()

    vi.mocked(window.api.saveChartExamples).mockResolvedValueOnce({
      canceled: false,
      error: { code: 'OUTPUT_NOT_WRITABLE', message: '无法写入所选位置，请更换保存位置后重试。' },
    })
    fireEvent.click(saveButton)
    await waitFor(() => {
      expect(screen.getByText('无法写入所选位置，请更换保存位置后重试。')).toBeInTheDocument()
    })
  })

  it('offers insertion only for the bound session and closes after a successful insert', () => {
    const onCloseSettings = vi.fn()
    const session: EditorInsertionSession = {
      targetKey: 'leaf-a:tab-a:/docs/a.md:writer-a',
      targetLabel: 'a.md',
      isValid: vi.fn(() => true),
      insert: vi.fn(() => true),
    }
    const { rerender } = renderCharts()
    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    expect(screen.queryByRole('button', { name: /插入到/ })).not.toBeInTheDocument()

    rerender(
      <ChartsSettingsTab
        initialView="capabilities"
        insertionSession={session}
        onCloseSettings={onCloseSettings}
        onOpenChartExamples={vi.fn().mockResolvedValue({ canceled: true })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '插入到 a.md' }))

    expect(session.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mermaid-flow',
      rendererType: 'mermaid',
    }))
    expect(onCloseSettings).toHaveBeenCalledTimes(1)
  })

  it('refuses an insertion when the original editor session becomes invalid', () => {
    let valid = true
    const session: EditorInsertionSession = {
      targetKey: 'leaf-a:tab-a:/docs/a.md:writer-a',
      targetLabel: 'a.md',
      isValid: vi.fn(() => valid),
      insert: vi.fn(() => true),
    }
    renderCharts({ insertionSession: session })
    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    valid = false

    fireEvent.click(screen.getByRole('button', { name: '插入到 a.md' }))

    expect(session.insert).not.toHaveBeenCalled()
    expect(screen.getByText('目标编辑器已关闭或切换文档，请从目标编辑器重新打开图表设置。')).toBeInTheDocument()
  })
})
