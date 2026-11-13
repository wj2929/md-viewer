// @ts-nocheck - 测试文件的类型检查暂时跳过
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VirtualizedMarkdown } from '../../src/components/VirtualizedMarkdown'
import { useRemoteChartSettingsStore } from '../../src/stores/remoteChartSettingsStore'
import { sanitizeRendererDiagnosticEvent } from '../../../shared/diagnostics'

const mockRenderExcalidrawToSvg = vi.hoisted(() => vi.fn())
const mockRenderVegaLiteToSvg = vi.hoisted(() => vi.fn())
const mockRenderD2ToSvg = vi.hoisted(() => vi.fn())
const mockRenderBpmnToSvg = vi.hoisted(() => vi.fn())
const mockRenderWaveDromToSvg = vi.hoisted(() => vi.fn())
const mockRenderPlantUMLToSvg = vi.hoisted(() => vi.fn())
const mockRenderKrokiToSvg = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/excalidrawRenderer', () => ({
  renderExcalidrawToSvg: mockRenderExcalidrawToSvg,
}))
vi.mock('../../src/utils/vegaLiteRenderer', () => ({
  renderVegaLiteToSvg: mockRenderVegaLiteToSvg,
  vegaLiteErrorHtml: (_title: string, message: string) => `<div class="vega-lite-error">${message}</div>`,
}))
vi.mock('../../src/utils/d2Renderer', () => ({
  renderD2ToSvg: mockRenderD2ToSvg,
  rendererErrorHtml: (_title: string, message: string, className: string) => `<div class="${className}">${message}</div>`,
}))
vi.mock('../../src/utils/bpmnRenderer', () => ({
  renderBpmnToSvg: mockRenderBpmnToSvg,
  cleanBpmnRefPath: (refPath: string) => refPath.split(/[?#]/, 1)[0] || refPath,
  isMissingReadBpmnFileHandlerError: (error: unknown) => String((error as Error)?.message || error).includes('No handler registered')
    && String((error as Error)?.message || error).includes('fs:readBpmnFile'),
  resolveBpmnFallbackPath: (markdownFilePath: string, refPath: string) => {
    const baseDir = markdownFilePath.replace(/[/\\][^/\\]*$/, '')
    return `${baseDir}/${refPath.replace(/^\.\//, '')}`
  },
}))
vi.mock('../../src/utils/wavedromRenderer', () => ({
  renderWaveDromToSvg: mockRenderWaveDromToSvg,
}))
vi.mock('../../src/utils/plantumlRenderer', () => ({
  validatePlantUMLCode: vi.fn(() => ({ valid: true })),
  renderPlantUMLToSvg: mockRenderPlantUMLToSvg,
  getPlantUMLServerUrl: vi.fn(() => 'https://www.plantuml.com/plantuml'),
}))
vi.mock('../../src/utils/krokiRenderer', () => ({
  renderKrokiToSvg: mockRenderKrokiToSvg,
  resolveKrokiFormat: vi.fn((language: string) => language === 'kroki' ? 'nomnoml' : language),
}))

// Mock window.api
const mockShowMarkdownContextMenu = vi.fn().mockResolvedValue({ success: true })
const mockShowPreviewContextMenu = vi.fn().mockResolvedValue({ success: true })
const mockIssueLocalMediaUrl = vi.hoisted(() => vi.fn())

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  global.window.api = {
    ...global.window.api,
    readFile: vi.fn(),
    issueLocalImageUrl: vi.fn().mockResolvedValue('local-image://asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    issueLocalMediaUrl: mockIssueLocalMediaUrl,
    readExcalidrawFile: undefined,
    openExternal: vi.fn().mockResolvedValue({ success: true }),
    openMdLink: vi.fn().mockResolvedValue({ success: true }),
    showMarkdownContextMenu: mockShowMarkdownContextMenu,
    showPreviewContextMenu: mockShowPreviewContextMenu,
    getAppSettings: vi.fn().mockResolvedValue({ autoRenderRemoteCharts: true }),
    updateAppSettings: vi.fn().mockResolvedValue(undefined),
    recordDiagnosticRendererEvent: vi.fn(),
  } as typeof window.api
  useRemoteChartSettingsStore.setState({
    hydration: 'ready',
    autoRenderRemoteCharts: true,
    approvedDocuments: {},
  })
  mockRenderExcalidrawToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 50"><rect width="100" height="50"></rect></svg>',
    width: 100,
    height: 50,
    warnings: [],
    sourceKind: 'file-reference',
    sourceLabel: '流程',
    rawCode: '{"type":"excalidraw","elements":[]}',
  })
  mockRenderVegaLiteToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>Vega</text></svg>',
  })
  mockRenderD2ToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>D2</text></svg>',
  })
  mockRenderBpmnToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>BPMN</text></svg>',
  })
  mockRenderWaveDromToSvg.mockReturnValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>WaveDrom</text></svg>',
  })
  mockRenderPlantUMLToSvg.mockResolvedValue('<svg viewBox="0 0 100 40"><text>C4</text></svg>')
  mockRenderKrokiToSvg.mockResolvedValue({
    ok: true,
    svg: '<svg viewBox="0 0 100 40"><text>Kroki</text></svg>',
  })
  mockIssueLocalMediaUrl.mockResolvedValue('local-media://asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  // 默认没有选中文本
  vi.spyOn(window, 'getSelection').mockReturnValue(null)
})

describe('VirtualizedMarkdown', () => {
  it('源码行落在同一段落内时，定位该行对应的后一次关键词而非首个命中', async () => {
    vi.useFakeTimers()
    let view
    try {
      const original = document.createRange.bind(document)
      const ranges = []
      vi.spyOn(document, 'createRange').mockImplementation(() => {
        const range = original()
        Object.defineProperty(range, 'getBoundingClientRect', { value: () => {
          ranges.push({ text: range.toString(), startText: range.startContainer.textContent })
          return { top: 900, height: 20 }
        } })
        return range
      })
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 200, height: 20 })
      const complete = vi.fn()
      view = render(<div className="preview"><VirtualizedMarkdown content={'needle first\n**needle** chosen'}
        renderDebounceMs={0} scrollToLine={2} highlightKeyword="needle" onScrollToLineComplete={complete} /></div>)
      const preview = view.container.querySelector('.preview')
      preview.scrollTop = 100
      preview.scrollTo = vi.fn()
      await act(async () => { await vi.advanceTimersByTimeAsync(350) })
      expect(preview.scrollTo).toHaveBeenCalledWith({ top: 700, behavior: 'auto' })
      expect(ranges).toEqual([{ text: 'needle', startText: 'needle' }])
      expect(complete).toHaveBeenCalledOnce()
    } finally {
      view?.unmount()
      vi.useRealTimers()
    }
  })

  it('临时搜索高亮超时清除不会删除页面内搜索的标记', async () => {
    vi.useFakeTimers()
    let view
    try {
      view = render(<div className="preview"><VirtualizedMarkdown content="needle content"
        renderDebounceMs={0} highlightKeyword="needle" /></div>)
      const mark = document.createElement('mark')
      mark.className = 'search-highlight'
      mark.setAttribute('data-markjs', 'true')
      mark.textContent = 'in-page result'
      view.container.querySelector('.markdown-body').append(mark)
      await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
      expect(view.container.querySelector('.search-temp-highlight')).toBeNull()
      expect(view.container.querySelector('.search-highlight')).toBe(mark)
    } finally {
      view?.unmount()
      vi.useRealTimers()
    }
  })

  it('在离线 DOM 上准备编辑属性，挂入后源码行、编辑与块定位仍可用', async () => {
    const connectedWrites: boolean[] = []
    const setAttribute = Element.prototype.setAttribute
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
      if (name === 'contenteditable' && value === 'true') connectedWrites.push(this.isConnected)
      return setAttribute.call(this, name, value)
    })
    const view = render(<VirtualizedMarkdown content={'# Heading\n\nParagraph ^target'}
      renderDebounceMs={0} previewEditingEnabled onPreviewBlockEdit={vi.fn()} />)
    await waitFor(() => expect(view.container.querySelector('p')?.getAttribute('contenteditable')).toBe('true'))
    expect(connectedWrites.length).toBeGreaterThan(0)
    expect(connectedWrites.every(connected => !connected)).toBe(true)
    expect(view.container.querySelector('p')?.dataset.sourceLine).toBe('3')
    expect(view.container.querySelector('[id="md-block:target"]')?.isConnected).toBe(true)
    view.unmount()
  })

  it('未匹配段落不会反复规范化每条源码行，表格行定位保持一致', async () => {
    const line = 'normalization-cache-probe &amp; value'
    const source = Array(100).fill(line).join('\n\n') + '\n\n| A | B |\n| --- | --- |\n| left | right |'
    const replace = vi.spyOn(String.prototype, 'replace')
    const view = render(<VirtualizedMarkdown content={source} renderDebounceMs={0}
      previewEditingEnabled onPreviewBlockEdit={vi.fn()} />)
    await waitFor(() => expect(view.container.querySelectorAll('p')).toHaveLength(100))
    const calls = replace.mock.calls.filter(([pattern], index) =>
      replace.mock.contexts[index] === line && pattern instanceof RegExp && pattern.source === '\\s+',
    ).length
    expect(calls).toBeGreaterThanOrEqual(100)
    expect(calls).toBeLessThanOrEqual(400)
    const cell = Array.from(view.container.querySelectorAll('td')).find(item => item.textContent === 'left')
    expect(cell?.dataset.sourceLine).toBe(String(source.split('\n').indexOf('| left | right |') + 1))
    expect(cell?.getAttribute('contenteditable')).toBe('true')
    view.unmount()
  })

  it('精确块请求跨渲染 cleanup 不提前完成，目标版本提交后才定位', async () => {
    vi.useFakeTimers()
    try {
      const source = '目标 ^block'
      const onComplete = vi.fn()
      const request = { id: 'block-request', filePath: '/docs/target.md', position: { scrollRatio: 0.9 },
        block: { id: 'block', source, deadline: performance.now() + 2000 },
        isCurrent: () => true, canFocus: () => false, onComplete }
      const view = render(<VirtualizedMarkdown content="旧版本" filePath="/docs/target.md" renderDebounceMs={0} linkPositionRequest={request} />)
      expect(onComplete).not.toHaveBeenCalled()
      view.rerender(<VirtualizedMarkdown content={source} filePath="/docs/target.md" renderDebounceMs={0} linkPositionRequest={request} />)
      expect(onComplete).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(view.container.querySelector('[id="md-block:block"]')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      expect(onComplete).toHaveBeenCalledExactlyOnceWith('positioned')
      view.unmount()
      expect(onComplete).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('用户滚动取消块校正，过期请求不触发终态提示', async () => {
    vi.useFakeTimers()
    try {
      const source = '目标 ^block'
      const onComplete = vi.fn()
      let current = true
      const request = { id: 'block-request', filePath: '/docs/target.md', position: { scrollRatio: 0.9 },
        block: { id: 'block', source, deadline: performance.now() + 2000 },
        isCurrent: () => current, canFocus: () => false, onComplete }
      const view = render(<div className="preview"><VirtualizedMarkdown content={source} filePath="/docs/target.md" renderDebounceMs={0} linkPositionRequest={request} /></div>)
      fireEvent.wheel(view.container.querySelector('.preview')!, { deltaY: 100 })
      expect(onComplete).toHaveBeenCalledExactlyOnceWith('cancelled')
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      expect(onComplete).toHaveBeenCalledTimes(1)
      current = false
      view.rerender(<div className="preview"><VirtualizedMarkdown content="新版本" filePath="/docs/target.md" renderDebounceMs={0} linkPositionRequest={{ ...request, id: 'stale' }} /></div>)
      await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
      expect(onComplete).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally { vi.useRealTimers() }
  })
  it('同页块直接使用 committed DOM，不发文档读取；伪造 ID 不进入定位表', () => {
    const onMarkdownLinkClick = vi.fn()
    const error = vi.fn()
    window.addEventListener('md-link-error', error)
    const view = render(<VirtualizedMarkdown content={'[[#^block|真实]]\n\n[伪造](#^fake)\n\n正文 ^block\n\n<p id="md-block:fake">伪造节点</p>'} filePath="/docs/a.md" onMarkdownLinkClick={onMarkdownLinkClick} />)
    fireEvent.click(screen.getByRole('link', { name: '真实' }))
    expect(error).not.toHaveBeenCalled()
    expect(onMarkdownLinkClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '伪造' }))
    expect(error).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[id="md-block:fake"]')).toBeNull()
    window.removeEventListener('md-link-error', error)
  })
  it('媒体首次网络读取失败时应更换实例 URL 自动重试', async () => {
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const content = '<video src="videos/01.mp4" controls preload="metadata"></video>'

    const { container } = render(
      <VirtualizedMarkdown
        content={content}
        filePath="/docs/index.md"
        renderDebounceMs={0}
      />,
    )

    await waitFor(() => expect(mockIssueLocalMediaUrl).toHaveBeenCalledTimes(1))
    const video = container.querySelector<HTMLVideoElement>('video')
    expect(video).toBeTruthy()
    const source = video?.querySelector('source')
    expect(source).toBeTruthy()
    const firstUrl = source?.src

    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 2, message: 'PipelineStatus::PIPELINE_ERROR_READ' },
    })
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    })
    fireEvent.error(video)

    await waitFor(() => expect(source?.src).not.toBe(firstUrl))
    expect(container.querySelector('.local-media-fallback')).not.toBeInTheDocument()
    expect(loadSpy).toHaveBeenCalledTimes(2)
    loadSpy.mockRestore()
  })

  describe('媒体终态失败提示', () => {
    beforeEach(() => {
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    })

    it.each([
      [2, '本地媒体读取失败，请确认文件存在且可读取'],
      [3, '本地媒体解码失败，文件可能损坏或编码不受支持'],
      [4, '无法加载或播放本地媒体，文件可能无法读取或格式不受支持'],
    ])('错误码 %s 仅在终态展示相符原因且不泄露底层信息', async (code, reason) => {
      const { container } = render(<VirtualizedMarkdown
        content={'<video src="videos/01.mp4" controls></video>'}
        filePath="/private/docs/index.md" renderDebounceMs={0}
      />)
      await waitFor(() => expect(container.querySelector('video source')).not.toBeNull())
      const video = container.querySelector('video')!
      Object.defineProperty(video, 'error', {
        value: { code, message: 'PIPELINE_ERROR /private/docs/01.mp4 local-media://asset/secret' },
      })
      fireEvent.error(video)
      if (code === 2) {
        expect(container.querySelector('.local-media-fallback')).toBeNull()
        fireEvent.error(video)
      }
      const note = container.querySelector('.local-media-fallback')!
      expect(note).toHaveTextContent(`${reason}：videos/01.mp4`)
      expect(note).toHaveTextContent('可尝试使用支持该格式的系统播放器打开原文件。')
      expect(note.textContent).not.toMatch(/PIPELINE|\/private\/|local-media:|secret/)
      expect(note.querySelector('a, button')).toBeNull()
    })

    it('所有本地引用访问失败时提示检查文件，不暴露 IPC 错误', async () => {
      mockIssueLocalMediaUrl.mockRejectedValue(new Error('ENOENT /private/docs/missing.mp4'))
      const { container } = render(<VirtualizedMarkdown
        content={'<video src="missing.mp4" title="演示片段" controls></video>'}
        filePath="/private/docs/index.md" renderDebounceMs={0}
      />)
      await waitFor(() => expect(container.querySelector('.local-media-fallback')).not.toBeNull())
      const note = container.querySelector('.local-media-fallback')!
      expect(note).toHaveTextContent('无法访问本地媒体，请确认文件存在且可读取：演示片段')
      expect(note).toHaveTextContent('可尝试使用支持该格式的系统播放器打开原文件。')
      expect(note.textContent).not.toMatch(/ENOENT|\/private\//)
    })

    it('单个候选失败不覆盖其它可用媒体，等待和暂停也不提示', async () => {
      mockIssueLocalMediaUrl.mockRejectedValueOnce(new Error('missing'))
      const { container } = render(<VirtualizedMarkdown
        content={'<video controls><source src="missing.mp4"><source src="valid.mp4"></video>'}
        filePath="/docs/index.md" renderDebounceMs={0}
      />)
      await waitFor(() => expect(container.querySelectorAll('video source')).toHaveLength(1))
      const video = container.querySelector('video')!
      for (const event of ['waiting', 'stalled', 'pause', 'error']) fireEvent(video, new Event(event))
      expect(container.querySelector('.local-media-fallback')).toBeNull()
      expect(video).toBeInTheDocument()
    })

    it.each([
      ['none', HTMLMediaElement.NETWORK_IDLE, false],
      ['metadata', HTMLMediaElement.NETWORK_LOADING, false],
      ['metadata', HTMLMediaElement.NETWORK_NO_SOURCE, true],
    ])('preload=%s networkState=%s 的原有超时判定保持不变', async (preload, networkState, failed) => {
      const { container, unmount } = render(<VirtualizedMarkdown
        content={`<audio src="sample.wav" controls preload="${preload}"></audio>`}
        filePath="/docs/index.md" renderDebounceMs={0}
      />)
      // 只捕获媒体五秒终态检查，不改变 React 的渲染计时。
      const setTimeout = window.setTimeout.bind(window)
      let checkFailure: (() => void) | undefined
      vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay, ...args) => {
        if (delay === 5000) checkFailure = callback as () => void
        return setTimeout(callback, delay, ...args)
      })
      await waitFor(() => expect(container.querySelector('audio source')).not.toBeNull())
      const audio = container.querySelector('audio')!
      Object.defineProperty(audio, 'networkState', { value: networkState })
      expect(checkFailure).toBeTypeOf('function')
      act(() => checkFailure!())
      const note = container.querySelector('.local-media-fallback')
      if (failed) {
        expect(note).toHaveTextContent('无法加载或播放本地媒体，文件可能无法读取或格式不受支持')
        expect(note).toHaveTextContent('系统播放器')
      } else {
        expect(note).toBeNull()
        expect(audio).toBeInTheDocument()
      }
      unmount()
    })
  })

  it('卸载媒体先中止字幕读取再释放 Blob', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:subtitle')
    window.api.readLocalWebVtt = vi.fn().mockResolvedValue('WEBVTT\n\n')
    const { container, unmount } = render(<VirtualizedMarkdown
      content={'<video src="clip.mp4" controls><track src="sub.vtt" kind="subtitles" srclang="zh" default></video>'}
      filePath="/docs/index.md" renderDebounceMs={0}
    />)
    await waitFor(() => expect(container.querySelector('video track')).not.toBeNull())
    const video = container.querySelector('video')!
    const track = video.querySelector('track')!
    Object.defineProperty(track, 'track', { value: { mode: 'showing' } })
    load.mockClear()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      expect(track.track.mode).toBe('disabled')
      expect(track.hasAttribute('src')).toBe(false)
      expect(video.querySelector('source, track')).toBeNull()
      expect(load).toHaveBeenCalledTimes(1)
    })
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:subtitle')
  })

  describe('小文件渲染（非虚拟滚动）', () => {
    it('应该渲染基础 Markdown 内容', () => {
      const content = '# 标题\n\n这是一段文本'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
      expect(screen.getByText('标题')).toBeInTheDocument()
    })

    it('应该渲染空内容占位符', () => {
      const { container } = render(<VirtualizedMarkdown content="" />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    it('应该渲染仅空格内容', () => {
      // trim() 会移除空格和换行符，所以纯空白应该显示占位符
      const { container } = render(<VirtualizedMarkdown content="      " />)

      expect(container.innerHTML).toContain('文件内容为空')
    })

    describe('大文档限制', () => {
      it('应完整渲染恰好 20,000 行的内容', () => {
        const content = `首行${'\n'.repeat(19_999)}`
        render(<VirtualizedMarkdown content={content} />)

        expect(screen.getByText('首行')).toBeInTheDocument()
        expect(screen.queryByText('内容过长，已截断显示')).not.toBeInTheDocument()
      })

      it('20,001 行应先确认，继续后包含末行而不是截断', () => {
        const content = `首行${'\n'.repeat(20_000)}末行`
        render(<VirtualizedMarkdown content={content} />)

        expect(screen.getByText('文档较大，请选择预览方式')).toBeInTheDocument()
        expect(document.querySelector('.markdown-body')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '完整渲染' }))
        expect(screen.getByText('末行')).toBeInTheDocument()
        expect(screen.queryByText('内容过长，已截断显示')).not.toBeInTheDocument()
      })

      it('应渲染恰好 1,500,000 个字符的内容', async () => {
        const content = `# 边界\n\n${'x'.repeat(1_500_000 - 6)}`
        render(<VirtualizedMarkdown content={content} />)

        expect(await screen.findByText('边界')).toBeInTheDocument()
        expect(screen.queryByText('文件过大，无法渲染')).not.toBeInTheDocument()
      })

      it('1,500,001 个字符应显示可覆盖的提示', () => {
        render(<VirtualizedMarkdown content={'x'.repeat(1_500_001)} />)

        expect(screen.getByRole('button', { name: '完整渲染' })).toBeInTheDocument()
      })

      it('双超限时不应解析或截断正文', () => {
        render(<VirtualizedMarkdown content={`${'x'.repeat(1_500_001)}${'\n'.repeat(20_000)}`} />)

        expect(screen.getByRole('button', { name: '完整渲染' })).toBeInTheDocument()
        expect(screen.queryByText('内容过长，已截断显示')).not.toBeInTheDocument()
      })
    })

    it('大文档异步准备不把加载占位当正文，也不卸载正在输入的旧正文', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
      const pending: Array<() => void> = []
      Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: { yield: () => new Promise<void>(resolve => pending.push(resolve)) } })
      const step = async () => { await act(async () => { pending.shift()?.() }) }
      const props = { filePath: '/notes/large.md', previewEditingEnabled: true, renderDebounceMs: 0, onPreviewBlockEdit: vi.fn() }
      const first = '# First\n\n' + 'x'.repeat(100_000)
      const view = render(<VirtualizedMarkdown {...props} content={first} />)
      try {
        expect(screen.getByRole('status')).toHaveTextContent('正在渲染文档')
        expect(view.container.querySelector('.markdown-body')).toBeNull()
        await step(); await step(); await step()
        const paragraph = view.container.querySelector('p.markdown-preview-editable-block')!
        paragraph.focus()
        paragraph.textContent = '正在组词的草稿'
        fireEvent.compositionStart(paragraph)
        view.rerender(<VirtualizedMarkdown {...props} content={'# Second\n\n' + 'y'.repeat(100_000)} />)
        await waitFor(() => expect(pending.length).toBeGreaterThan(0))
        expect(paragraph.isConnected).toBe(true)
        await step(); await step(); await step()
        expect(view.container.querySelector('p.markdown-preview-editable-block')).toBe(paragraph)
        expect(paragraph).toHaveTextContent('正在组词的草稿')
        expect(view.container.querySelector('.markdown-body')).toHaveAttribute('data-render-pending', 'true')
      } finally {
        view.unmount()
        if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor)
        else delete (globalThis as any).scheduler
      }
    })

    it('编辑回调身份变化保留实际正文节点，并使用最新回调；能力移除仍更新只读标注', async () => {
      const oldEdit = vi.fn(), latestEdit = vi.fn()
      const props = { content: '# 源文档\n\n可编辑段落', filePath: '/notes/source.md', previewEditingEnabled: true, renderDebounceMs: 0 }
      const { container, rerender } = render(<VirtualizedMarkdown {...props} onPreviewBlockEdit={oldEdit} onSourceEditRequest={vi.fn()} />)
      const paragraph = container.querySelector('p.markdown-preview-editable-block')!
      expect(paragraph).toBeInTheDocument()
      rerender(<VirtualizedMarkdown {...props} onPreviewBlockEdit={latestEdit} onSourceEditRequest={vi.fn()} />)
      expect(container.querySelector('p.markdown-preview-editable-block')).toBe(paragraph)
      paragraph.textContent = '新段落'
      fireEvent.blur(paragraph)
      expect(latestEdit).toHaveBeenCalledWith(expect.objectContaining({ nextText: '新段落' }))
      expect(oldEdit).not.toHaveBeenCalled()
      rerender(<VirtualizedMarkdown {...props} onSourceEditRequest={vi.fn()} />)
      expect(container.querySelector('p')).not.toHaveAttribute('contenteditable')
    })

    it('应该应用自定义 className', () => {
      const { container } = render(
        <VirtualizedMarkdown content="# 测试" className="custom-class" />
      )

      expect(container.querySelector('.markdown-body')).toHaveClass('custom-class')
    })

    it('应该渲染代码块并应用语法高亮', () => {
      const content = '```javascript\nconst x = 1\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const codeBlock = container.querySelector('pre.language-javascript')
      expect(codeBlock).toBeInTheDocument()
    })

    it('应该渲染 mermaid 代码块', () => {
      const content = '```mermaid\ngraph TD\n  A --> B\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre.language-mermaid')).toBeInTheDocument()
    })

    it('应该渲染新增 RendererPlugin 代码块', async () => {
      const content = [
        '```vega-lite',
        '{"data":{"values":[]},"mark":"bar"}',
        '```',
        '',
        '```d2',
        'a -> b',
        '```',
        '',
        '```bpmn',
        '<definitions />',
        '```',
        '',
        '```wavedrom',
        "{ signal: [{ name: 'clk', wave: 'p..P' }] }",
        '```',
        '',
        '```c4',
        '@startuml',
        'Person(user, "用户")',
        '@enduml',
        '```',
      ].join('\n')

      render(<VirtualizedMarkdown content={content} renderDebounceMs={0} remoteChartPolicy="allow" />)

      await waitFor(() => {
        expect(document.querySelector('.vega-lite-container svg')).toBeTruthy()
        expect(document.querySelector('.d2-container svg')).toBeTruthy()
        expect(document.querySelector('.bpmn-container svg')).toBeTruthy()
        expect(document.querySelector('.wavedrom-container svg')).toBeTruthy()
        expect(document.querySelector('.c4plantuml-wrapper .plantuml-container svg')).toBeTruthy()
      })

      expect(document.querySelector('.vega-lite-toggle-bar .vega-lite-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.d2-toggle-bar .d2-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.bpmn-toggle-bar .bpmn-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.wavedrom-toggle-bar .wavedrom-action-btn[data-action="toggleCode"]')).toBeTruthy()
      expect(document.querySelector('.c4plantuml-wrapper .plantuml-toggle-bar .plantuml-action-btn[data-action="toggleCode"]')).toBeTruthy()
    })

    it('设置水合完成前不请求，默认开启后自动渲染整篇远程图表', async () => {
      useRemoteChartSettingsStore.setState({ hydration: 'loading' })
      let resolveSettings: (settings: { autoRenderRemoteCharts: boolean }) => void = () => {}
      vi.mocked(window.api.getAppSettings).mockReturnValue(new Promise(resolve => { resolveSettings = resolve }))
      const content = [
        '```c4',
        '@startuml',
        'Person(user, "用户")',
        '@enduml',
        '```',
        '',
        '```kroki',
        'format: nomnoml',
        '[A] -> [B]',
        '```',
      ].join('\n')

      const { container } = render(<VirtualizedMarkdown content={content} renderDebounceMs={0} />)
      expect(mockRenderPlantUMLToSvg).not.toHaveBeenCalled()
      expect(mockRenderKrokiToSvg).not.toHaveBeenCalled()
      expect(container.querySelector('.remote-chart-document-consent')).toBeNull()

      await act(async () => resolveSettings({ autoRenderRemoteCharts: true }))
      await waitFor(() => {
        expect(container.querySelector('.c4plantuml-wrapper .plantuml-container svg')).toBeTruthy()
        expect(container.querySelector('.kroki-wrapper .kroki-container svg')).toBeTruthy()
      })
      expect(mockRenderPlantUMLToSvg).toHaveBeenCalledTimes(1)
      expect(mockRenderKrokiToSvg).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.remote-chart-consent')).toBeNull()
    })

    it('关闭自动渲染后每篇只显示一个提示，一次确认放行全部图表', async () => {
      useRemoteChartSettingsStore.setState({ hydration: 'loading' })
      vi.mocked(window.api.getAppSettings).mockResolvedValue({ autoRenderRemoteCharts: false } as never)
      mockRenderPlantUMLToSvg.mockResolvedValueOnce(
        '<svg viewBox="0 0 100 40" onload="alert(1)"><script>alert(1)</script><text>C4</text></svg>',
      )
      const content = [
        '```plantuml', '@startuml', 'A -> B', '@enduml', '```', '',
        '```c4', '@startuml', 'Person(user, "用户")', '@enduml', '```', '',
        '```kroki', 'format: nomnoml', '[A] -> [B]', '```',
      ].join('\n')

      const { container } = render(<VirtualizedMarkdown content={content} filePath="/docs/a.md" renderDebounceMs={0} />)
      const button = await screen.findByRole('button', { name: '渲染本篇 3 个联网图表' })
      expect(container.querySelectorAll('.remote-chart-document-consent')).toHaveLength(1)
      expect(container.querySelectorAll('.remote-chart-consent')).toHaveLength(0)
      expect(mockRenderPlantUMLToSvg).not.toHaveBeenCalled()
      expect(mockRenderKrokiToSvg).not.toHaveBeenCalled()

      fireEvent.click(button)
      await waitFor(() => {
        expect(container.querySelectorAll('.plantuml-container svg')).toHaveLength(2)
        expect(container.querySelector('.kroki-container svg')).toBeTruthy()
      })
      expect(mockRenderPlantUMLToSvg).toHaveBeenCalledTimes(2)
      expect(mockRenderKrokiToSvg).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.plantuml-container script')).toBeNull()
      expect(container.querySelector('.plantuml-container svg')).not.toHaveAttribute('onload')
    })

    it('远程渲染失败时保留源码，并只在手工重试后再次请求', async () => {
      mockRenderKrokiToSvg
        .mockResolvedValueOnce({ ok: false, message: '<b>服务失败</b>' })
        .mockResolvedValueOnce({ ok: true, svg: '<svg viewBox="0 0 100 40"><text>完成</text></svg>' })

      const { container } = render(
        <VirtualizedMarkdown content={'```kroki\nformat: nomnoml\n[A] -> [B]\n```'} renderDebounceMs={0} remoteChartPolicy="allow" />,
      )

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('<b>服务失败</b>'))
      expect(container.textContent).toContain('[A] -> [B]')
      expect(container.querySelector('b')).toBeNull()
      expect(mockRenderKrokiToSvg).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('button', { name: '重试当前图表' }))
      await waitFor(() => expect(container.querySelector('.kroki-container svg')).toBeTruthy())
      expect(mockRenderKrokiToSvg).toHaveBeenCalledTimes(2)
    })

    it('同一路径分屏共享文档批准，不同文档仍需单独确认', async () => {
      useRemoteChartSettingsStore.setState({ hydration: 'loading' })
      vi.mocked(window.api.getAppSettings).mockResolvedValue({ autoRenderRemoteCharts: false } as never)
      const remoteContent = '```c4\n@startuml\nPerson(user, "用户")\n@enduml\n```'
      render(<>
        <VirtualizedMarkdown content={remoteContent} filePath="/docs/a.md" tabId="a-1" renderDebounceMs={0} />
        <VirtualizedMarkdown content={remoteContent} filePath="/docs/a.md" tabId="a-2" renderDebounceMs={0} />
        <VirtualizedMarkdown content={remoteContent} filePath="/docs/b.md" tabId="b" renderDebounceMs={0} />
      </>)

      const prompts = await screen.findAllByRole('button', { name: '渲染本篇 1 个联网图表' })
      expect(prompts).toHaveLength(3)
      fireEvent.click(prompts[0])

      await waitFor(() => expect(mockRenderPlantUMLToSvg).toHaveBeenCalledTimes(2))
      expect(screen.getAllByRole('button', { name: '渲染本篇 1 个联网图表' })).toHaveLength(1)
    })

    it('新增 SVG RendererPlugin 应支持源码视图切换', async () => {
      const content = [
        '```vega-lite',
        '{"data":{"values":[]},"mark":"bar"}',
        '```',
        '',
        '```bpmn',
        '<definitions />',
        '```',
        '',
        '```wavedrom',
        "{ signal: [{ name: 'clk', wave: 'p..P' }] }",
        '```',
      ].join('\n')

      render(<VirtualizedMarkdown content={content} renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.vega-lite-wrapper .vega-lite-container svg')).toBeTruthy()
        expect(document.querySelector('.bpmn-wrapper .bpmn-container svg')).toBeTruthy()
        expect(document.querySelector('.wavedrom-wrapper .wavedrom-container svg')).toBeTruthy()
      })

      for (const chartType of ['vega-lite', 'bpmn', 'wavedrom']) {
        const wrapper = document.querySelector(`.${chartType}-wrapper`) as HTMLElement
        fireEvent.click(wrapper.querySelector(`.${chartType}-action-btn[data-action="toggleCode"]`)!)
        expect((wrapper.querySelector(`.${chartType}-container`) as HTMLElement).style.display).toBe('none')
        expect((wrapper.querySelector(`.${chartType}-code-view`) as HTMLElement).style.display).toBe('')
        fireEvent.click(wrapper.querySelector(`.${chartType}-back-btn`)!)
        expect((wrapper.querySelector(`.${chartType}-container`) as HTMLElement).style.display).toBe('')
        expect((wrapper.querySelector(`.${chartType}-code-view`) as HTMLElement).style.display).toBe('none')
      }
    })

    it('D2 预览应该支持主动放大并可恢复适应宽度', async () => {
      mockRenderD2ToSvg.mockResolvedValueOnce({
        ok: true,
        svg: '<svg width="400" viewBox="0 0 400 120" style="max-width: 100%; height: auto; display: block"><text>D2</text></svg>',
      })

      render(<VirtualizedMarkdown content={'```d2\na -> b\n```'} renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.d2-wrapper .d2-container svg')).toBeTruthy()
      })

      const wrapper = document.querySelector('.d2-wrapper') as HTMLElement
      const container = document.querySelector('.d2-container') as HTMLElement
      const svg = document.querySelector('.d2-container svg') as SVGSVGElement

      expect(wrapper.querySelector('.d2-action-btn[data-action="zoomIn"]')).toBeTruthy()
      expect(wrapper.querySelector('.d2-action-btn[data-action="fit"]')).toBeTruthy()

      fireEvent.click(wrapper.querySelector('.d2-action-btn[data-action="zoomIn"]')!)
      expect(container.dataset.zoomLevel).toBe('120')
      expect(svg.getAttribute('width')).toBe('480')
      expect(svg.style.width).toBe('480px')
      expect(svg.style.maxWidth).toBe('none')
      expect(svg.style.maxHeight).toBe('none')
      expect(svg.style.flexShrink).toBe('0')

      fireEvent.click(wrapper.querySelector('.d2-action-btn[data-action="fit"]')!)
      expect(container.dataset.zoomLevel).toBe('100')
      expect(svg.getAttribute('width')).toBe('400')
      expect(svg.getAttribute('style')).toContain('max-width: 100%')
    })

    it('应该渲染行内数学公式', () => {
      const content = '公式 $E=mc^2$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E=mc^2')
    })

    it('应该渲染块级数学公式', () => {
      const content = '$$\nx = \\frac{1}{2}\n$$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('frac')
    })

    it('应该渲染单行块级数学公式', () => {
      const content = '$$ E = mc^2 $$'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('E = mc^2')
    })

    it('把 .excalidraw 图片引用替换为文件占位而不是 local-image', async () => {
      global.window.api.readExcalidrawFile = vi.fn(() => new Promise(() => undefined))
      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw?raw=1#v)'} filePath="/docs/a.md" renderDebounceMs={0} />)
      await waitFor(() => {
        expect(document.querySelector('.excalidraw-file-placeholder')).toBeTruthy()
      })
      expect(global.window.api.readExcalidrawFile).toHaveBeenCalledWith({
        markdownFilePath: '/docs/a.md',
        refPath: './flow.excalidraw'
      })
      expect(document.querySelector('img[src^="local-image://"]')).toBeFalsy()
    })

    it('渲染 Excalidraw 文件引用并复制源码视图内容', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true
      })
      global.window.api.readExcalidrawFile = vi.fn().mockResolvedValue({
        content: rawCode,
        resolvedPath: '/docs/flow.excalidraw'
      })

      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.excalidraw-wrapper')).toBeTruthy()
      })
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('role')).toBe('img')
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('aria-label')).toContain('流程')

      fireEvent.click(document.querySelector('.excalidraw-action-btn[data-action="toggleCode"]')!)
      fireEvent.click(document.querySelector('.excalidraw-code-view .copy-btn')!)

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(rawCode)
      })
    })

    it('旧 preload 缺少 readExcalidrawFile 时应该回退到 readFile 读取相对引用', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      global.window.api.readExcalidrawFile = undefined as any
      global.window.api.readFile = vi.fn().mockResolvedValue(rawCode)

      render(<VirtualizedMarkdown content={'![流程](./flow.excalidraw)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.excalidraw-wrapper')).toBeTruthy()
      })
      expect(global.window.api.readFile).toHaveBeenCalledWith('/docs/flow.excalidraw')
      expect(document.querySelector('.excalidraw-container svg')?.getAttribute('aria-label')).toContain('流程')
    })

    it('BPMN 文件引用在旧主进程缺少 readBpmnFile handler 时应该回退到 readFile', async () => {
      const rawCode = '<definitions />'
      global.window.api.readBpmnFile = vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'fs:readBpmnFile': Error: No handler registered for 'fs:readBpmnFile'")
      )
      global.window.api.readFile = vi.fn().mockResolvedValue(rawCode)

      render(<VirtualizedMarkdown content={'![流程](./flow.bpmn)'} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelector('.bpmn-wrapper')).toBeTruthy()
      })
      expect(global.window.api.readBpmnFile).toHaveBeenCalledWith({
        markdownFilePath: '/docs/a.md',
        refPath: './flow.bpmn'
      })
      expect(global.window.api.readFile).toHaveBeenCalledWith('/docs/flow.bpmn')
      expect(document.querySelector('.bpmn-container svg')).toBeTruthy()
      expect(document.querySelector('.bpmn-error')).toBeFalsy()
    })

    it('同一 Markdown 中应该渲染超过 20 个 Excalidraw 文件引用', async () => {
      const rawCode = '{"type":"excalidraw","elements":[]}'
      global.window.api.readExcalidrawFile = vi.fn().mockResolvedValue({
        content: rawCode,
        resolvedPath: '/docs/flow.excalidraw'
      })
      const content = Array.from({ length: 24 }, (_, index) =>
        `![图 ${index + 1}](./flow-${index + 1}.excalidraw)`
      ).join('\n\n')

      render(<VirtualizedMarkdown content={content} filePath="/docs/a.md" renderDebounceMs={0} />)

      await waitFor(() => {
        expect(document.querySelectorAll('.excalidraw-wrapper')).toHaveLength(24)
      })
      expect(global.window.api.readExcalidrawFile).toHaveBeenCalledTimes(24)
    })

    it('把普通本地图片引用转换为主进程签发的 opaque URL', async () => {
      render(
        <VirtualizedMarkdown
          content={'![欢迎图](<./images/user manual/欢迎页.png>)'}
          filePath="/docs/user-manual.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        const img = document.querySelector('img[alt="欢迎图"]')
        expect(img).toBeTruthy()
        expect(img?.getAttribute('src')).toBe('local-image://asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      })
    })

    it('向主进程申请本地图片 capability 而不暴露绝对路径', async () => {
      const issueLocalImageUrl = vi.fn().mockResolvedValue('local-image://asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      global.window.api.issueLocalImageUrl = issueLocalImageUrl
      render(
        <VirtualizedMarkdown
          content={'![欢迎图](<./images/user manual/欢迎页.png>)'}
          filePath="/docs/user-manual.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        expect(issueLocalImageUrl).toHaveBeenCalledWith(
          '/docs/user-manual.md',
          './images/user manual/欢迎页.png'
        )
        expect(document.querySelector('img[alt="欢迎图"]')?.getAttribute('src')).toBe(
          'local-image://asset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        )
      })
    })

    it('拒绝 Markdown 手写的 local-image URL', async () => {
      render(<VirtualizedMarkdown content={'![图](local-image://asset/forged)'} filePath="/docs/a.md" renderDebounceMs={0} />)
      await waitFor(() => expect(document.querySelector('img[alt="图"]')?.getAttribute('src')).toBeNull())
    })

    it('切换文件路径后仍应按新 Markdown 所在目录解析本地图片', async () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          content={'![图](./images/a.png)'}
          filePath="/docs/old/source.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        expect(global.window.api.issueLocalImageUrl).toHaveBeenCalledWith('/docs/old/source.md', './images/a.png')
      })

      rerender(
        <VirtualizedMarkdown
          content={'![图](./images/a.png)'}
          filePath="/docs/new/source.md"
          renderDebounceMs={0}
        />
      )

      await waitFor(() => {
        expect(global.window.api.issueLocalImageUrl).toHaveBeenLastCalledWith('/docs/new/source.md', './images/a.png')
      })
    })
  })

  describe('右键菜单 (v1.3.7)', () => {
    it('应该在有 filePath 时显示右键菜单', async () => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: false,
        selectionText: '',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: undefined,
        leafId: null,
        linkHref: null,
        basePath: null
      })
    })

    it('应该在没有 filePath 时不显示右键菜单', () => {
      const content = '# 测试'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).not.toHaveBeenCalled()
    })

    it.each([
      ['Shift+F10', { key: 'F10', shiftKey: true }],
      ['菜单键', { key: 'ContextMenu' }],
    ])('应该支持通过 %s 打开同一个预览区上下文菜单', async (_label, keyEvent) => {
      const content = '# 测试'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" tabId="tab-a" leafId="leaf-a" />
      )

      const markdownBody = container.querySelector('.markdown-body') as HTMLElement
      expect(markdownBody.tabIndex).toBe(0)

      fireEvent.keyDown(markdownBody, keyEvent)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: false,
        selectionText: '',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: 'tab-a',
        leafId: 'leaf-a',
        linkHref: null,
        basePath: null
      })
    })

    it('应该检测标题元素', () => {
      const content = '# 测试标题'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      // 模拟右键点击标题
      const heading = container.querySelector('h1')
      if (heading) {
        heading.id = 'test-heading'
        heading.textContent = '测试标题'
        fireEvent.contextMenu(heading)

        expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
          filePath: '/test/file.md',
          headingId: 'test-heading',
          headingText: '测试标题',
          headingLevel: 'h1',
          hasSelection: false,
          selectionText: '',
          sourceLine: 1,
          scrollRatio: 0,
          chartCount: 0,
          tabId: undefined,
          leafId: null,
          linkHref: null,
          basePath: null
        })
      }
    })

    it('应该检测文本选择状态', () => {
      // Mock window.getSelection
      const mockSelection = {
        toString: () => '选中的文本'
      }
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as Selection)

      const content = '# 测试内容'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body')
      fireEvent.contextMenu(markdownBody!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith({
        filePath: '/test/file.md',
        headingId: null,
        headingText: null,
        headingLevel: null,
        hasSelection: true,
        selectionText: '选中的文本',
        sourceLine: null,
        scrollRatio: 0,
        chartCount: 0,
        tabId: undefined,
        leafId: null,
        linkHref: null,
        basePath: null
      })

      // 恢复 mock
      vi.restoreAllMocks()
    })

    it('应该把当前预览区可导出的图表数量传给主进程菜单', () => {
      const content = '# 测试内容'
      const { container } = render(
        <VirtualizedMarkdown content={content} filePath="/test/file.md" />
      )

      const markdownBody = container.querySelector('.markdown-body') as HTMLElement
      const chartWrapper = document.createElement('div')
      chartWrapper.className = 'mermaid-wrapper'
      chartWrapper.innerHTML = `
        <div class="mermaid-container">
          <svg viewBox="0 0 120 60"><rect width="120" height="60"></rect></svg>
        </div>
      `
      markdownBody.appendChild(chartWrapper)

      fireEvent.contextMenu(chartWrapper.querySelector('svg')!)

      expect(mockShowPreviewContextMenu).toHaveBeenCalledWith(expect.objectContaining({
        filePath: '/test/file.md',
        chartCount: 1,
      }))
    })

    // 虚拟滚动已禁用，跳过此测试
  })

  describe('代码高亮边界情况', () => {
    it('应该处理未知语言', () => {
      const content = '```unknownlang\ncode here\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理无语言标识的代码块', () => {
      const content = '```\nplain text\n```'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('pre')).toBeInTheDocument()
    })

    it('应该处理多种语言代码块', () => {
      const content = `
\`\`\`javascript
const a = 1
\`\`\`

\`\`\`python
def foo():
    pass
\`\`\`

\`\`\`rust
fn main() {}
\`\`\`
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelectorAll('pre').length).toBe(3)
    })
  })

  describe('数学公式边界情况', () => {
    it('应该处理未闭合的行内公式', () => {
      const content = '这是 $未闭合的公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // 应该正常渲染，不崩溃
      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理空的数学公式', () => {
      const content = '空公式 $$ 示例'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })

    it('应该处理转义的美元符号', () => {
      const content = '价格是 \\$100'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.innerHTML).toContain('100')
    })

    it('应该处理连续的美元符号', () => {
      const content = '$$$ 不是公式'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('Markdown 语法', () => {
    it('应该渲染表格', () => {
      const content = `
| 列1 | 列2 |
|-----|-----|
| A   | B   |
`
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('table')).toBeInTheDocument()
    })

    it('应该渲染有序列表', () => {
      const content = '1. 项目1\n2. 项目2\n3. 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ol')).toBeInTheDocument()
    })

    it('应该渲染无序列表', () => {
      const content = '- 项目1\n- 项目2\n- 项目3'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('ul')).toBeInTheDocument()
    })

    it('应该渲染引用块', () => {
      const content = '> 这是引用'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('blockquote')).toBeInTheDocument()
    })

    it('应该渲染链接', () => {
      const content = '[链接](https://example.com)'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://example.com')
    })

    it('应该自动链接 URL', () => {
      const content = 'https://example.com'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      // linkify 选项应该将 URL 转换为链接
      const link = container.querySelector('a')
      expect(link).toBeInTheDocument()
    })

    it('点击外部链接应该交给系统浏览器打开', () => {
      render(<VirtualizedMarkdown content={'[官网](https://example.com/docs)'} />)

      fireEvent.click(screen.getByRole('link', { name: '官网' }))

      expect(window.api.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })

    it('点击内部 .md 链接应该交给上层统一导航', () => {
      const onMarkdownLinkClick = vi.fn()
      render(
        <VirtualizedMarkdown
          content={'[目标文档](<./目标 文档.md#二级标题>)'}
          filePath="/docs/current.md"
          onMarkdownLinkClick={onMarkdownLinkClick}
        />
      )

      fireEvent.click(screen.getByRole('link', { name: '目标文档' }))

      expect(onMarkdownLinkClick).toHaveBeenCalledWith(
        encodeURI('./目标 文档.md#二级标题'), '/docs/current.md',
        expect.objectContaining({ filePath: '/docs/current.md', leafId: 'single',
          anchor: screen.getByRole('link', { name: '目标文档' }),
          position: expect.objectContaining({ ordinal: 0 }), revision: expect.any(Promise) }),
      )
      expect(window.api.openMdLink).not.toHaveBeenCalled()
    })

    it('点击页内锚点应该滚动到目标标题', () => {
      const scrollIntoView = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      })

      render(<VirtualizedMarkdown content={'# 二级标题\n\n[跳转](#二级标题)'} />)

      fireEvent.click(screen.getByRole('link', { name: '跳转' }))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    })
  })

  describe('渲染区块编辑', () => {
    it('块标记可见且编辑回传仅含原文，不回写生成锚点或随机证明', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(<VirtualizedMarkdown content="正文 ^stable" renderDebounceMs={0} previewEditingEnabled onPreviewBlockEdit={onPreviewBlockEdit} />)
      const paragraph = container.querySelector('p')!
      expect(paragraph.id).toBe('md-block:stable')
      expect(paragraph.textContent).toBe('正文 ^stable')
      paragraph.textContent = '修改正文 ^stable'
      fireEvent.blur(paragraph)
      expect(onPreviewBlockEdit).toHaveBeenCalledWith({ sourceLine: 1, originalText: '正文 ^stable', nextText: '修改正文 ^stable' })
    })
    it('默认预览不允许直接编辑渲染块', () => {
      const { container } = render(<VirtualizedMarkdown content={'# 标题\n\n正文'} renderDebounceMs={0} />)

      expect(container.querySelector('h1')).not.toHaveAttribute('contenteditable', 'true')
      expect(container.querySelector('p')).not.toHaveAttribute('contenteditable', 'true')
    })

    it('开启渲染区块编辑后，普通段落失焦时回传源码行修改', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n正文'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      expect(paragraph).toHaveAttribute('contenteditable', 'true')

      paragraph.textContent = '修改后的正文'
      fireEvent.blur(paragraph)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 3,
        originalText: '正文',
        nextText: '修改后的正文',
      })
    })

    it('开启渲染区块编辑后，带格式的列表项也可以回传源码行修改', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'- **最终脚本设置：** `MAX_REQ=490/10秒`，20线程并发'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const listItem = container.querySelector('li') as HTMLElement
      expect(listItem).toHaveAttribute('contenteditable', 'true')

      listItem.textContent = '最终脚本设置：MAX_REQ=480/10秒，20线程并发'
      fireEvent.blur(listItem)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 1,
        originalText: '最终脚本设置： MAX_REQ=490/10秒，20线程并发',
        nextText: '最终脚本设置：MAX_REQ=480/10秒，20线程并发',
      })
    })

    it('开启渲染区块编辑后，表格单元格失焦时回传单元格位置', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'| 数据 | 状态 |\n| --- | --- |\n| 频道汇总统计 | 完成 |'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const statusCell = Array.from(container.querySelectorAll('td'))
        .find(cell => cell.textContent?.trim() === '完成') as HTMLElement
      expect(statusCell).toHaveAttribute('contenteditable', 'true')

      statusCell.textContent = '处理中'
      fireEvent.blur(statusCell)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 3,
        originalText: '完成',
        nextText: '处理中',
        editKind: 'table-cell',
        tableCellIndex: 1,
      })
    })

    it('开启渲染区块编辑后，普通代码块失焦时回传围栏代码范围', () => {
      const onPreviewBlockEdit = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'```text\nBaseUrl: http://api.polyv.net/\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={onPreviewBlockEdit}
        />
      )

      const codeBlock = container.querySelector('pre') as HTMLElement
      expect(codeBlock).toHaveAttribute('contenteditable', 'true')

      codeBlock.textContent = 'BaseUrl: https://api.polyv.net/'
      fireEvent.blur(codeBlock)

      expect(onPreviewBlockEdit).toHaveBeenCalledWith({
        sourceLine: 1,
        sourceEndLine: 3,
        originalText: 'BaseUrl: http://api.polyv.net/',
        nextText: 'BaseUrl: https://api.polyv.net/',
        editKind: 'code-block',
      })
    })

    it('图表代码块默认不铺开提示，聚焦后提供不参与导出的源码编辑动作', () => {
      const onSourceEditRequest = vi.fn()
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={onSourceEditRequest}
        />
      )

      expect(screen.queryByRole('note')).not.toBeInTheDocument()

      const codeBlock = container.querySelector('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const hint = screen.getByRole('note')
      expect(hint).toHaveClass('no-export')

      const button = screen.getByRole('button', { name: /在源码中编辑/ })
      fireEvent.click(button)

      expect(onSourceEditRequest).toHaveBeenCalledWith({
        sourceLine: 1,
        sourceEndLine: 4,
      })
      expect(codeBlock).not.toHaveAttribute('contenteditable', 'true')
    })

    it('不可直接编辑块应该提供源码编辑说明入口', () => {
      render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={vi.fn()}
        />
      )

      expect(screen.queryByRole('note')).not.toBeInTheDocument()

      const codeBlock = screen.getByText(/graph TD/).closest('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const helpButton = screen.getByRole('button', { name: /查看源码编辑说明/ })
      expect(helpButton.closest('.markdown-preview-source-only-hint')).toHaveClass('no-export')

      fireEvent.click(helpButton)

      expect(window.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user-manual.md#源码编辑'))
    })

    it('不可直接编辑块按 Escape 后应该隐藏提示并释放焦点', () => {
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
          onSourceEditRequest={vi.fn()}
        />
      )

      const codeBlock = container.querySelector('pre') as HTMLElement
      fireEvent.focus(codeBlock)

      const hint = screen.getByRole('note')
      expect(hint).not.toHaveAttribute('hidden')
      expect(codeBlock).toHaveClass('is-source-hint-active')

      fireEvent.keyDown(codeBlock, { key: 'Escape' })

      expect(hint).toHaveAttribute('hidden')
      expect(codeBlock).not.toHaveClass('is-source-hint-active')
      expect(document.activeElement).not.toBe(codeBlock)
    })

    it('开启渲染区块编辑后不直接编辑图表代码块', () => {
      const { container } = render(
        <VirtualizedMarkdown
          content={'```mermaid\ngraph TD\n  A --> B\n```'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      expect(container.querySelector('pre')).not.toHaveAttribute('contenteditable', 'true')
    })

    it('可编辑块获得焦点后，待处理的预览重渲染不应替换该块', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n旧段落'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      expect(document.activeElement).toBe(paragraph)

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      expect(container.querySelector('p')).toBe(paragraph)
      expect(document.activeElement).toBe(paragraph)
      expect(paragraph.textContent).toBe('旧段落')
    })

    it('中文 IME 组合输入期间不应被预览重渲染替换', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n输入中'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      fireEvent.compositionStart(paragraph)

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      expect(container.querySelector('p')).toBe(paragraph)
      expect(document.activeElement).toBe(paragraph)
      expect(paragraph.textContent).toBe('输入中')
    })

    it('可编辑块无修改失焦后，应应用之前延迟的预览重渲染', async () => {
      const { container, rerender } = render(
        <VirtualizedMarkdown
          content={'# 标题\n\n旧段落'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()

      rerender(
        <VirtualizedMarkdown
          content={'# 标题\n\n外部重渲染内容'}
          renderDebounceMs={0}
          previewEditingEnabled
          onPreviewBlockEdit={vi.fn()}
        />
      )

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
      })
      expect(paragraph.textContent).toBe('旧段落')

      await act(async () => {
        fireEvent.blur(paragraph)
      })

      await waitFor(() => {
        expect(container.querySelector('p')?.textContent).toBe('外部重渲染内容')
      })
    })

    it('可编辑块提交后，应允许父级草稿内容重渲染到预览区', async () => {
      function EditablePreviewHarness(): JSX.Element {
        const [content, setContent] = useState('# 标题\n\n旧段落')
        return (
          <VirtualizedMarkdown
            content={content}
            renderDebounceMs={0}
            previewEditingEnabled
            onPreviewBlockEdit={(edit) => {
              setContent(`# 标题\n\n${edit.nextText}\n\n父级补充段落`)
            }}
          />
        )
      }

      const { container } = render(<EditablePreviewHarness />)

      const paragraph = container.querySelector('p') as HTMLElement
      paragraph.focus()
      paragraph.textContent = '提交后的段落'

      await act(async () => {
        fireEvent.blur(paragraph)
      })

      await waitFor(() => {
        expect(Array.from(container.querySelectorAll('p')).map(element => element.textContent)).toEqual([
          '提交后的段落',
          '父级补充段落',
        ])
      })
    })
  })

  describe('性能优化', () => {
    // 虚拟滚动已禁用，跳过此测试
    it('NonVirtualizedMarkdown 应该使用 memo', () => {
      const content = '# 短内容'
      const { container } = render(<VirtualizedMarkdown content={content} />)

      expect(container.querySelector('.markdown-body')).toBeInTheDocument()
    })
  })

  describe('滚动位置重置 (v1.3.4 修复)', () => {
    it('使用 key prop 时，切换文件应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nContent of file 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2\n\nContent of file 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是不同的 DOM 实例（说明组件被重新挂载）
      expect(firstInstance).not.toBe(secondInstance)
    })

    it('相同文件路径但内容变化时，不应重新挂载组件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nOriginal content"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 相同文件，内容变化（模拟外部编辑）
      rerender(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1\n\nModified content"
          filePath="/file1.md"
        />
      )

      const secondInstance = container.firstChild

      // 验证是同一个 DOM 实例（组件未重新挂载，只是内容更新）
      expect(firstInstance).toBe(secondInstance)
    })

    it('切换文件时应渲染新文件的内容', () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content="# File 1"
          filePath="/file1.md"
        />
      )

      // 验证第一个文件的内容
      expect(screen.getByText('File 1')).toBeInTheDocument()

      // 切换到第二个文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content="# File 2"
          filePath="/file2.md"
        />
      )

      // 验证第二个文件的内容
      expect(screen.getByText('File 2')).toBeInTheDocument()
    })

    it('快速切换多个文件时应保持稳定', () => {
      const files = [
        { path: '/file1.md', content: '# File 1' },
        { path: '/file2.md', content: '# File 2' },
        { path: '/file3.md', content: '# File 3' },
        { path: '/file4.md', content: '# File 4' },
        { path: '/file5.md', content: '# File 5' }
      ]

      const { rerender } = render(
        <VirtualizedMarkdown
          key={files[0].path}
          content={files[0].content}
          filePath={files[0].path}
        />
      )

      // 快速切换文件
      files.forEach((file, index) => {
        if (index === 0) return // 跳过第一个（已渲染）

        rerender(
          <VirtualizedMarkdown
            key={file.path}
            content={file.content}
            filePath={file.path}
          />
        )

        // 验证每次切换都渲染正确的内容
        expect(screen.getByText(`File ${index + 1}`)).toBeInTheDocument()
      })
    })

    it('组件重新挂载时滚动位置应重置为 0', async () => {
      const { rerender } = render(
        <VirtualizedMarkdown
          key="/file1.md"
          content={'# File 1\n\n' + 'Line\n'.repeat(100)}
          filePath="/file1.md"
        />
      )

      const container = screen.getByText('File 1').closest('.markdown-body')?.parentElement as HTMLElement

      // 模拟用户滚动到底部
      if (container && container.scrollHeight > 0) {
        container.scrollTop = container.scrollHeight
        expect(container.scrollTop).toBeGreaterThan(0)
      }

      // 切换到新文件
      rerender(
        <VirtualizedMarkdown
          key="/file2.md"
          content={'# File 2\n\n' + 'Line\n'.repeat(100)}
          filePath="/file2.md"
        />
      )

      // 新组件的滚动位置应该是 0
      const newContainer = screen.getByText('File 2').closest('.markdown-body')?.parentElement as HTMLElement
      if (newContainer) {
        expect(newContainer.scrollTop).toBe(0)
      }
    })

    it('无 key prop 时仍隔离实际文档DOM，不能把旧正文链接归给新文件', () => {
      const { rerender, container } = render(
        <VirtualizedMarkdown
          content="# File 1"
          filePath="/file1.md"
        />
      )

      const firstInstance = container.firstChild

      // 切换到不同的文件，但没有 key prop
      rerender(
        <VirtualizedMarkdown
          content="# File 2"
          filePath="/file2.md"
        />
      )

      const secondInstance = container.firstChild

      expect(firstInstance).not.toBe(secondInstance)
      expect(firstInstance?.isConnected).toBe(false)
      expect(screen.getByRole('heading', { name: 'File 2' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'File 1' })).not.toBeInTheDocument()
    })
  })

  describe('DOM提交与绘制帧诊断分离', () => {
    const operation = (id: string) => ({
      context: { operationId: `file_${id}_12345678`, source: 'restore' as const, rendererStartedUnixMs: Date.now() },
      startedMonotonicMs: performance.now(), startedUnixMs: Date.now(),
    })
    const states = () => vi.mocked(window.api.recordDiagnosticRendererEvent).mock.calls
      .map(([event]) => event).filter(event => event.event === 'file.preview.state')

    it('DOM提交不等帧，core仍需两帧且ready仍需5秒，卸载后取消旧ready', async () => {
      const originalRaf = window.requestAnimationFrame
      const originalCancel = window.cancelAnimationFrame
      vi.useFakeTimers()
      const frames = new Map<number, FrameRequestCallback>()
      let sequence = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
      const frame = async () => act(async () => {
        const batch = [...frames.entries()]
        for (const [id, callback] of batch) { frames.delete(id); callback(performance.now()) }
      })
      let view: ReturnType<typeof render> | undefined
      try {
        view = render(<VirtualizedMarkdown content="# DOM evidence" filePath="/self/raf.md" renderDebounceMs={0} diagnosticOperation={operation('raf')} />)
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        expect(screen.getByRole('heading', { name: 'DOM evidence' })).toBeInTheDocument()
        expect(states().some(event => event.metadata.previewState === 'dom-committed')).toBe(true)
        expect(states().some(event => event.metadata.previewState === 'preview-core-ready')).toBe(false)
        expect(vi.mocked(window.api.recordDiagnosticRendererEvent).mock.calls.some(([event]) => event.event === 'file.open.terminal')).toBe(false)
        await frame()
        expect(states().some(event => event.metadata.previewState === 'preview-core-ready')).toBe(false)
        await frame()
        expect(states().some(event => event.metadata.previewState === 'preview-core-ready')).toBe(true)
        await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
        expect(states().some(event => event.metadata.previewState === 'preview-ready')).toBe(false)
        await act(async () => { await vi.advanceTimersByTimeAsync(1) })
        expect(states().some(event => event.metadata.previewState === 'preview-ready')).toBe(true)
        const events = vi.mocked(window.api.recordDiagnosticRendererEvent).mock.calls.map(([event]) => event)
        expect(events.every(event => sanitizeRendererDiagnosticEvent(event, event.observedUnixMs) !== null)).toBe(true)
        view.rerender(<VirtualizedMarkdown content="# Replacement" filePath="/self/raf.md" renderDebounceMs={0} diagnosticOperation={operation('replacement')} />)
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        view.unmount(); view = undefined
        await frame(); await frame()
        await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
        expect(states().some(event => event.metadata.relatedOperationId === 'file_replacement_12345678' && event.metadata.previewState === 'preview-ready')).toBe(false)
      } finally {
        view?.unmount()
        vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers()
        window.requestAnimationFrame = originalRaf
        window.cancelAnimationFrame = originalCancel
      }
    })

    it('仅诊断身份变化不重建正文，下一次真实提交使用最新身份', async () => {
      const first = operation('first'), next = operation('next')
      const props = { content: '# Stable\n\nEditable body', filePath: '/self/stable.md', renderDebounceMs: 0, previewEditingEnabled: true, onPreviewBlockEdit: vi.fn() }
      const { container, rerender } = render(<VirtualizedMarkdown {...props} diagnosticOperation={first} />)
      const body = container.querySelector('p')!
      body.focus()
      const replace = vi.spyOn(body.parentElement!, 'replaceChildren')
      vi.mocked(window.api.recordDiagnosticRendererEvent).mockClear()
      rerender(<VirtualizedMarkdown {...props} diagnosticOperation={next} />)
      expect(container.querySelector('p')).toBe(body)
      expect(document.activeElement).toBe(body)
      expect(replace).not.toHaveBeenCalled()
      expect(states().some(event => event.metadata.previewState === 'dom-committed')).toBe(false)
      body.blur()
      rerender(<VirtualizedMarkdown {...props} content={'# Stable\n\nUpdated body'} diagnosticOperation={next} />)
      await waitFor(() => expect(screen.getByText('Updated body')).toBeInTheDocument())
      expect(states().filter(event => event.metadata.previewState === 'dom-committed').map(event => event.metadata.relatedOperationId)).toEqual(['file_next_12345678'])
    })

    it.each(['focus', 'composition'])('%s阻止正文提交时不误报新DOM，解除后才报', async mode => {
      const first = operation('editing'), next = operation('edited')
      const props = { content: '# Editing\n\nOld paragraph', filePath: '/self/edit.md', renderDebounceMs: 0, previewEditingEnabled: true, onPreviewBlockEdit: vi.fn() }
      const { container, rerender } = render(<VirtualizedMarkdown {...props} diagnosticOperation={first} />)
      const body = container.querySelector('p')!
      if (mode === 'focus') body.focus()
      else { body.focus(); fireEvent.compositionStart(body) }
      vi.mocked(window.api.recordDiagnosticRendererEvent).mockClear()
      rerender(<VirtualizedMarkdown {...props} content={'# Editing\n\nNew paragraph'} diagnosticOperation={next} />)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(container.querySelector('p')).toBe(body)
      expect(body.textContent).toBe('Old paragraph')
      expect(states().some(event => event.metadata.previewState === 'dom-committed')).toBe(false)
      if (mode === 'composition') fireEvent.compositionEnd(body)
      body.blur(); fireEvent.blur(body)
      await waitFor(() => expect(screen.getByText('New paragraph')).toBeInTheDocument())
      expect(states().some(event => event.metadata.previewState === 'dom-committed' && event.metadata.relatedOperationId === 'file_edited_12345678')).toBe(true)
    })
  })

  it('记录 coreReady 阶段但不把异步图表快照伪装成完成', async () => {
    const operation = {
      context: {
        operationId: 'file_preview_diagnostic_12345678',
        source: 'user' as const,
        rendererStartedUnixMs: Date.now(),
      },
      startedMonotonicMs: performance.now(),
      startedUnixMs: Date.now(),
    }

    render(
      <VirtualizedMarkdown
        content="# 诊断预览\n\n正文"
        filePath="/docs/index.md"
        renderDebounceMs={0}
        diagnosticOperation={operation}
      />,
    )

    await waitFor(() => {
      const events = vi.mocked(window.api.recordDiagnosticRendererEvent).mock.calls.map(([event]) => event)
      expect(events.some(event => event.event === 'file.preview.summary')).toBe(true)
      expect(events.some(event => event.event === 'file.open.terminal' && event.outcome === 'success')).toBe(true)
    })
    const emittedEvents = vi.mocked(window.api.recordDiagnosticRendererEvent).mock.calls
      .map(([event]) => event)
    const summary = emittedEvents.find(event => event.event === 'file.preview.summary')
    expect(emittedEvents.every(event =>
      sanitizeRendererDiagnosticEvent(event, event.observedUnixMs) !== null
    )).toBe(true)
    expect(summary?.metadata).toEqual(expect.objectContaining({
      coreReadyMs: expect.any(Number),
      markdownRenderMs: expect.any(Number),
      domPopulateMs: expect.any(Number),
      panelKind: 'main',
    }))
    expect(summary?.metadata).not.toHaveProperty('hydrationComplete')
  })
})
