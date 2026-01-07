import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FloatingNav from '../../src/components/FloatingNav'
import React from 'react'

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

    vi.clearAllMocks()
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
