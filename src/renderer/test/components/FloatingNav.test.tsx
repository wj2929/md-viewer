import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FloatingNav from '../../src/components/FloatingNav'
import React from 'react'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'

// Mock hooks
vi.mock('../../src/hooks/useTableOfContents', () => ({
  useTableOfContents: vi.fn().mockReturnValue({
    toc: [
      { id: 'title', text: 'Title', level: 1 },
      { id: 'section-1', text: 'Section 1', level: 2 },
      { id: 'section-2', text: 'Section 2', level: 2 }
    ],
    scrollToHeading: vi.fn()
  })
}))

vi.mock('../../src/hooks/useActiveHeading', () => ({
  useActiveHeading: vi.fn().mockReturnValue('title')
}))

describe('FloatingNav 组件测试', () => {
  let containerRef: React.RefObject<HTMLDivElement>
  let mockContainer: HTMLDivElement

  beforeEach(() => {
    // Mock scrollIntoView 和 getBoundingClientRect（TocPanel v1.4.4 需要）
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 100,
      bottom: 200,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => ({})
    }))

    mockContainer = document.createElement('div')
    mockContainer.scrollTo = vi.fn()
    // scrollHeight 是只读属性，使用 Object.defineProperty 设置
    Object.defineProperty(mockContainer, 'scrollHeight', {
      value: 1000,
      writable: true,
      configurable: true
    })

    containerRef = {
      current: mockContainer
    }

    global.window.api = {
      ...(global.window.api || {}),
      getWorkspaceBacklinks: vi.fn().mockResolvedValue([]),
      getWorkspaceIndexStatus: vi.fn().mockResolvedValue({
        state: 'ready', generation: 1, indexedDocuments: 1, totalDocuments: 1, pendingDocuments: 0, errors: 0,
      }),
      subscribeWorkspaceIndexStatus: vi.fn(() => () => {}),
      rebuildWorkspaceIndex: vi.fn(),
    } as any
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, runtimes: {} })

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应该渲染浮动导航按钮', () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByLabelText('返回顶部')).toBeInTheDocument()
    expect(screen.getByLabelText('目录')).toBeInTheDocument()
    expect(screen.getByLabelText('跳到底部')).toBeInTheDocument()
  })

  it('点击返回顶部按钮应该滚动到顶部', () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    fireEvent.click(screen.getByLabelText('返回顶部'))

    expect(mockContainer.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth'
    })
  })

  it('点击跳到底部按钮应该滚动到底部', () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    fireEvent.click(screen.getByLabelText('跳到底部'))

    expect(mockContainer.scrollTo).toHaveBeenCalledWith({
      top: 1000,
      behavior: 'smooth'
    })
  })

  it('点击目录按钮应该显示目录面板', async () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    const tocButton = screen.getByLabelText('目录')
    fireEvent.click(tocButton)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: '文档目录' })).toBeInTheDocument()
    })
  })

  it('目录面板应该显示所有标题', async () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    fireEvent.click(screen.getByLabelText('目录'))

    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Section 1')).toBeInTheDocument()
      expect(screen.getByText('Section 2')).toBeInTheDocument()
    })
  })

  it('点击目录项应该滚动但不关闭目录', async () => {
    const { useTableOfContents } = await import('../../src/hooks/useTableOfContents')
    const mockScrollToHeading = vi.fn()
    vi.mocked(useTableOfContents).mockReturnValue({
      toc: [{ id: 'title', text: 'Title', level: 1 }],
      scrollToHeading: mockScrollToHeading
    })

    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    fireEvent.click(screen.getByLabelText('目录'))

    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Title'))

    await waitFor(() => {
      expect(mockScrollToHeading).toHaveBeenCalledWith('title', mockContainer)
    })

    // 目录面板应该保持打开状态
    expect(screen.getByRole('navigation', { name: '文档目录' })).toBeInTheDocument()
  })

  it('按 Escape 应该关闭目录', async () => {
    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    fireEvent.click(screen.getByLabelText('目录'))

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: '文档目录' })).toBeInTheDocument()
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: '文档目录' })).not.toBeInTheDocument()
    })
  })

  it('没有标题时不应该显示目录按钮', async () => {
    const { useTableOfContents } = await import('../../src/hooks/useTableOfContents')
    vi.mocked(useTableOfContents).mockReturnValue({
      toc: [],
      scrollToHeading: vi.fn()
    })

    render(<FloatingNav containerRef={containerRef} markdown="" />)

    expect(screen.queryByLabelText('目录')).not.toBeInTheDocument()
  })

  it('目录与反向链接面板保持互斥并可定位来源行', async () => {
    const { useTableOfContents } = await import('../../src/hooks/useTableOfContents')
    vi.mocked(useTableOfContents).mockReturnValue({
      toc: [{ id: 'title', text: 'Title', level: 1 }],
      scrollToHeading: vi.fn(),
    })
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 3, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    ;(window.api.getWorkspaceBacklinks as any).mockResolvedValue([{
      sourceRelativePath: 'docs/source.md',
      sourceDisplayName: 'source.md',
      lineStart: 12,
      rawTarget: '../target.md',
      context: '参见目标文档。',
      sourceRange: { startOffset: 1, endOffset: 20, startLine: 12, startColumn: 1, endLine: 12, endColumn: 20 },
    }])
    const onBacklinkSelect = vi.fn()
    render(
      <FloatingNav
        containerRef={containerRef}
        markdown="# Test"
        filePath="/workspace/target.md"
        onBacklinkSelect={onBacklinkSelect}
      />
    )

    await waitFor(() => expect(screen.getByLabelText(/^链接到这里/)).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('目录'))
    expect(screen.getByRole('navigation', { name: '文档目录' })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/^链接到这里/))
    expect(screen.queryByRole('navigation', { name: '文档目录' })).not.toBeInTheDocument()
    expect(await screen.findByRole('complementary', { name: '链接到这里' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /^打开 source.md 第 12 行/ }))

    expect(onBacklinkSelect).toHaveBeenCalledWith(
      expect.objectContaining({ lineStart: 12 }),
      '/workspace/docs/source.md',
    )
  })

  it('按来源文档归组反链并显示可读上下文', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 3, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    const sourceRange = (startOffset: number, startLine: number) => ({
      startOffset,
      endOffset: startOffset + 10,
      startLine,
      startColumn: 1,
      endLine: startLine,
      endColumn: 11,
    })
    ;(window.api.getWorkspaceBacklinks as any).mockResolvedValue([
      {
        sourceRelativePath: 'docs/source.md', sourceDisplayName: 'source.md', lineStart: 3,
        rawTarget: '../target.md', context: '分类目录 · 示例包首页', placement: 'standalone-link',
        sourceRange: sourceRange(1, 3),
      },
      {
        sourceRelativePath: 'docs/source.md', sourceDisplayName: 'source.md', lineStart: 18,
        rawTarget: '../target.md', context: '完整案例见 图表快速入门。', placement: 'prose',
        sourceRange: sourceRange(30, 18),
      },
      {
        sourceRelativePath: 'guides/source.md', sourceDisplayName: 'source.md', lineStart: 7,
        rawTarget: '../target.md', context: '另见 target 文档。', placement: 'prose',
        sourceRange: sourceRange(60, 7),
      },
    ])

    const onBacklinkSelect = vi.fn()
    render(
      <FloatingNav
        containerRef={containerRef}
        markdown="# Test"
        filePath="/workspace/target.md"
        onBacklinkSelect={onBacklinkSelect}
      />
    )

    fireEvent.click(await screen.findByLabelText(/^链接到这里/))
    expect(await screen.findByText('2 个文档 · 3 处链接')).toBeInTheDocument()
    expect(screen.getByText('target.md')).toBeInTheDocument()
    expect(screen.getByText('正文提及')).toBeInTheDocument()
    expect(screen.getByText('完整案例见 图表快速入门。', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('另见 target 文档。', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('docs/')).toBeInTheDocument()
    expect(screen.getByText('guides/')).toBeInTheDocument()
    expect(screen.queryByText('分类目录 · 示例包首页')).not.toBeInTheDocument()

    const otherLinks = screen.getByRole('button', { name: /其他链接/ })
    expect(otherLinks).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(otherLinks)
    const directLink = screen.getByRole('button', {
      name: '打开 source.md 的独立链接，第 3 行',
    })
    expect(directLink).not.toHaveAttribute('aria-expanded')
    fireEvent.click(directLink)
    expect(onBacklinkSelect).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRelativePath: 'docs/source.md', lineStart: 3 }),
      '/workspace/docs/source.md',
    )
  })

  it('索引只读时仍显示已扫描到的反向链接', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 3, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    ;(window.api.getWorkspaceBacklinks as any).mockResolvedValue([{
      sourceRelativePath: 'docs/source.md',
      sourceDisplayName: 'source.md',
      lineStart: 12,
      rawTarget: '../target.md',
      context: '参见目标文档。',
      sourceRange: { startOffset: 1, endOffset: 20, startLine: 12, startColumn: 1, endLine: 12, endColumn: 20 },
    }])
    ;(window.api.getWorkspaceIndexStatus as any).mockResolvedValue({
      state: 'read-only', generation: 1, indexedDocuments: 2, totalDocuments: 2, pendingDocuments: 0, errors: 0,
    })

    render(
      <FloatingNav
        containerRef={containerRef}
        markdown="# Test"
        filePath="/workspace/target.md"
        onBacklinkSelect={vi.fn()}
      />
    )

    const button = await screen.findByLabelText(/^链接到这里/)
    fireEvent.click(button)
    expect(await screen.findByText('source.md')).toBeInTheDocument()
    expect(screen.queryByText('docs/')).not.toBeInTheDocument()
    expect(screen.getByText('索引正以只读模式运行；结果可用，但不会保存到磁盘')).toBeInTheDocument()
    expect(screen.queryByText('链接信息暂不可用')).not.toBeInTheDocument()
  })

  it('当前文档没有反向链接时不显示入口', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 3, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    ;(window.api.getWorkspaceBacklinks as any).mockResolvedValue([])

    render(
      <FloatingNav
        containerRef={containerRef}
        markdown="# Test"
        filePath="/workspace/target.md"
        onBacklinkSelect={vi.fn()}
      />
    )

    await waitFor(() => expect(window.api.getWorkspaceBacklinks).toHaveBeenCalled())
    expect(screen.queryByLabelText(/^链接到这里/)).not.toBeInTheDocument()
  })

  it('索引更新后发现反向链接时显示入口', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 3, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    let publishStatus = (_status: any): void => {}
    ;(window.api.subscribeWorkspaceIndexStatus as any).mockImplementation((_lifecycle: any, listener: any) => {
      publishStatus = listener
      return vi.fn()
    })
    ;(window.api.getWorkspaceBacklinks as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        sourceRelativePath: 'source.md', sourceDisplayName: 'source.md', lineStart: 3,
        rawTarget: './target.md', context: '参见目标。',
        sourceRange: { startOffset: 1, endOffset: 10, startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 },
      }])

    render(
      <FloatingNav
        containerRef={containerRef}
        markdown="# Test"
        filePath="/workspace/target.md"
        onBacklinkSelect={vi.fn()}
      />
    )
    await waitFor(() => expect(window.api.getWorkspaceBacklinks).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText(/^链接到这里/)).not.toBeInTheDocument()

    publishStatus({ state: 'ready' })
    await waitFor(() => expect(screen.getByLabelText(/^链接到这里/)).toBeInTheDocument())
  })

  it('应该有正确的 ARIA 属性', async () => {
    // 确保 mock 返回有目录的数据
    const { useTableOfContents } = await import('../../src/hooks/useTableOfContents')
    vi.mocked(useTableOfContents).mockReturnValue({
      toc: [{ id: 'title', text: 'Title', level: 1 }],
      scrollToHeading: vi.fn()
    })

    render(<FloatingNav containerRef={containerRef} markdown="# Test" />)

    const tocButton = screen.getByLabelText('目录')
    expect(tocButton).toHaveAttribute('aria-expanded', 'false')
    expect(tocButton).toHaveAttribute('aria-controls', 'toc-panel')

    fireEvent.click(tocButton)

    expect(tocButton).toHaveAttribute('aria-expanded', 'true')
  })
})
