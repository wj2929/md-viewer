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

  it('uses compact select filters and a plain type list', () => {
    const { container } = renderCharts()
    expect(screen.getByRole('combobox', { name: '按用途筛选图表' })).toHaveValue('全部')
    expect(screen.getByRole('combobox', { name: '按运行方式筛选图表' })).toHaveValue('全部')
    expect(container.querySelector('.chart-catalog-intro')).toBeNull()
    expect(screen.getByRole('note', { name: '格式参考使用说明' })).toHaveTextContent('Claude、Codex')
    expect(screen.getByRole('note', { name: '格式参考使用说明' })).toHaveTextContent('并非所有 Markdown 查看器都支持')
    expect(container.querySelectorAll('.chart-card-description')).toHaveLength(0)
    expect(container.querySelectorAll('.chart-type-directory .chart-network-badge')).toHaveLength(3)
  })

  it('opens Mermaid by default without network access or persistent changes', () => {
    const { container } = renderCharts()
    expect(container.querySelector('.chart-reference-browser')).not.toHaveClass('is-empty')
    expect(screen.getByRole('button', { name: /Mermaid/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox', { name: '图表类型' })).toHaveValue('mermaid')
    expect(screen.getByTestId('chart-preview')).toHaveTextContent('```mermaid')
    expect(screen.getAllByTestId('chart-preview')).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(window.api.updateAppSettings).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it.each(['examples', 'service'] as const)('does not mount the default preview until entering format reference from %s', async initialView => {
    renderCharts({ initialView })
    if (initialView === 'examples') await screen.findByText('内置离线示例包已就绪，无需联网。')
    expect(virtualizedMarkdown).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: /格式参考/ }))
    expect(screen.getByTestId('chart-preview')).toHaveTextContent('```mermaid')
    expect(screen.getAllByTestId('chart-preview')).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the approved positioning and complete compatibility copy', () => {
    renderCharts()
    expect(screen.getByRole('heading', { name: '图表与公式', level: 3 })).toBeVisible()
    const guidance = screen.getByRole('note', { name: '格式参考使用说明' })
    expect(screen.getByRole('heading', { name: '让 AI 参考格式，生成你需要的图表', level: 4 })).toBeVisible()
    expect(guidance).toHaveTextContent('不必手写复杂的图表代码。选择合适的表达方式，把完整 Markdown 示例和兼容说明交给 Claude、Codex 等 AI 工具，再描述你的需求，由 AI 生成内容，在 MD Viewer 中查看效果。这里提供格式参考，不在应用内调用 AI。')
    expect(guidance).toHaveTextContent('这些图表和公式通过 Markdown 扩展语法嵌入，并非所有 Markdown 查看器都支持。图表内容有的采用上游工具的原生语法，有的使用 MD Viewer 的适配格式或支持子集。请以每种类型的格式说明和示例为准，不能将其等同于完整上游 API，也不保证在其他工具中原样呈现。')
    expect(guidance).toHaveTextContent('运行方式17 类离线，3 类需服务')
    fireEvent.click(screen.getByRole('button', { name: /AntV G6/ }))
    expect(guidance).toBeVisible()
    expect(screen.getByRole('region', { name: '语法与兼容范围' })).toHaveTextContent('不是完整 G6 API')
  })

  it('keeps usage and format guidance visible while collapsing only export details', () => {
    const { container } = renderCharts()
    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    const details = container.querySelector('details')!
    const guidance = screen.getByRole('region', { name: '语法与兼容范围' })
    expect(details).not.toHaveAttribute('open')
    expect(guidance).toBeVisible()
    expect(guidance.compareDocumentPosition(screen.getByTestId('chart-preview')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('chart-preview').compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByText('导出支持详情'))
    expect(details).toHaveAttribute('open')
    expect(guidance).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Graphviz/ }))
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('region', { name: '语法与兼容范围' })).toHaveTextContent('Graphviz DOT')
    expect(screen.getByRole('note', { name: '格式参考使用说明' })).toBeVisible()
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

    fireEvent.change(screen.getByRole('combobox', { name: '按运行方式筛选图表' }), { target: { value: '需要服务' } })
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
    fireEvent.click(screen.getByRole('button', { name: '复制示例' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '```mermaid\nflowchart LR\n  User([用户]) --> Check{源码有效?}\n  Check -->|是| Render[渲染图表]\n  Check -->|否| Edit[修正源码]\n  Edit --> Check\n  Render --> Export[(导出文档)]\n```'
      )
      expect(screen.getByText('示例已复制。')).toBeInTheDocument()
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

  it('keeps the directory, selection and Markdown mode while comparing types', () => {
    renderCharts()
    fireEvent.click(screen.getByRole('button', { name: /Mermaid/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: /Graphviz/ }))

    expect(screen.getByRole('heading', { name: 'Graphviz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mermaid/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Markdown' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('chart-preview')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索图表' }), { target: { value: 'mermaid' } })
    expect(screen.getByText('当前类型不在筛选结果中')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Graphviz' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /渲染服务/ }))
    fireEvent.click(screen.getByRole('tab', { name: /格式参考/ }))
    expect(screen.getByRole('searchbox')).toHaveValue('mermaid')
    expect(screen.getByRole('heading', { name: 'Graphviz' })).toBeInTheDocument()
  })

  it('uses scoped arrow navigation without losing focus or wrapping at the ends', () => {
    renderCharts()
    const mermaid = screen.getByRole('button', { name: /Mermaid/ })
    mermaid.focus()
    fireEvent.click(mermaid)
    fireEvent.keyDown(mermaid, { key: 'ArrowDown' })
    const markmap = screen.getByRole('button', { name: /Markmap/ })
    expect(markmap).toHaveFocus()
    expect(markmap).toHaveAttribute('aria-pressed', 'true')
    expect(mermaid).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(markmap, { key: 'ArrowUp' })
    expect(mermaid).toHaveFocus()
    fireEvent.keyDown(mermaid, { key: 'ArrowUp' })
    expect(mermaid).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(mermaid, { key: 'ArrowDown', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(mermaid).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('chart-preview')).toHaveLength(1)
  })

  it('navigates filtered remote types without carrying a one-time permission', () => {
    useRemoteChartSettingsStore.setState({ autoRenderRemoteCharts: false })
    renderCharts()
    fireEvent.change(screen.getByRole('combobox', { name: '按运行方式筛选图表' }), { target: { value: '需要服务' } })
    const plantuml = screen.getByRole('button', { name: /^PlantUML\b/ })
    fireEvent.click(plantuml)
    fireEvent.click(screen.getByRole('button', { name: '连接服务并预览' }))
    expect(screen.getByTestId('chart-preview')).toHaveTextContent('```plantuml')
    fireEvent.keyDown(plantuml, { key: 'ArrowDown' })
    const c4 = screen.getByRole('button', { name: /C4-PlantUML/ })
    expect(c4).toHaveFocus()
    expect(screen.queryByTestId('chart-preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '连接服务并预览' })).toBeInTheDocument()
    fireEvent.keyDown(c4, { key: 'ArrowUp' })
    expect(screen.queryByTestId('chart-preview')).not.toBeInTheDocument()
    expect(plantuml).toHaveFocus()
    fireEvent.keyDown(plantuml, { key: 'ArrowDown' })
    fireEvent.keyDown(c4, { key: 'ArrowDown' })
    const kroki = screen.getByRole('button', { name: /^Kroki/ })
    expect(kroki).toHaveFocus()
    fireEvent.keyDown(kroki, { key: 'ArrowDown' })
    expect(kroki).toHaveFocus()
    expect(kroki).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('chart-preview')).not.toBeInTheDocument()
  })

  it('shows accurate format guidance and copies only the selected complete example', async () => {
    renderCharts()
    fireEvent.click(screen.getByRole('button', { name: /AntV G6/ }))
    fireEvent.click(screen.getByText('导出支持详情'))
    expect(screen.getByRole('region', { name: '语法与兼容范围' })).toHaveTextContent('不是完整 G6 API')
    fireEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: '复制示例' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/^```antv-g6\n[\s\S]*\n```$/)))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /复制 AI|打开参考文件/ })).not.toBeInTheDocument()
    expect(await screen.findByText('示例已复制。')).toBeInTheDocument()
  })

  it('keeps both KaTeX examples and uses the same selection for the compact picker', () => {
    renderCharts()
    fireEvent.change(screen.getByRole('combobox', { name: '图表类型' }), { target: { value: 'katex' } })
    fireEvent.change(screen.getByRole('combobox', { name: '示例形式' }), { target: { value: 'katex-inline' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    expect(screen.getByText(/^\$\\int/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /KaTeX/ }))
    expect(screen.getByRole('combobox', { name: '示例形式' })).toHaveValue('katex-inline')
  })
})
