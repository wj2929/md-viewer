import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TocPanel from '../../src/components/TocPanel'

describe('TocPanel 组件测试', () => {
  const mockToc = [
    { id: 'title', text: 'Title', level: 1 },
    { id: 'section-1', text: 'Section 1', level: 2 },
    { id: 'subsection', text: 'Subsection', level: 3 },
    { id: 'section-2', text: 'Section 2', level: 2 }
  ]

  const defaultProps = {
    toc: mockToc,
    activeId: 'title',
    onSelect: vi.fn(),
    onClose: vi.fn()
  }

  it('应该渲染目录面板', () => {
    render(<TocPanel {...defaultProps} />)

    expect(screen.getByRole('navigation', { name: '文档目录' })).toBeInTheDocument()
    expect(screen.getByText('目录')).toBeInTheDocument()
  })

  it('应该显示所有目录项', () => {
    render(<TocPanel {...defaultProps} />)

    mockToc.forEach(item => {
      expect(screen.getByText(item.text)).toBeInTheDocument()
    })
  })

  it('应该高亮当前活动项', () => {
    render(<TocPanel {...defaultProps} activeId="section-1" />)

    const activeItem = screen.getByText('Section 1').closest('a')
    expect(activeItem).toHaveClass('toc-item-active')
    expect(activeItem).toHaveAttribute('aria-current', 'location')
  })

  it('点击目录项应该调用 onSelect', () => {
    const onSelect = vi.fn()
    render(<TocPanel {...defaultProps} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('Section 1'))

    expect(onSelect).toHaveBeenCalledWith('section-1')
  })

  it('点击关闭按钮应该调用 onClose', () => {
    const onClose = vi.fn()
    render(<TocPanel {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('关闭目录'))

    expect(onClose).toHaveBeenCalled()
  })

  it('应该设置正确的层级属性', () => {
    render(<TocPanel {...defaultProps} />)

    const titleLink = screen.getByText('Title').closest('a')
    const sectionLink = screen.getByText('Section 1').closest('a')
    const subsectionLink = screen.getByText('Subsection').closest('a')

    expect(titleLink).toHaveAttribute('data-level', '1')
    expect(sectionLink).toHaveAttribute('data-level', '2')
    expect(subsectionLink).toHaveAttribute('data-level', '3')
  })

  it('按 Enter 键应该触发选择', () => {
    const onSelect = vi.fn()
    render(<TocPanel {...defaultProps} onSelect={onSelect} />)

    const item = screen.getByText('Section 1')
    fireEvent.keyDown(item, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('section-1')
  })

  it('按空格键应该触发选择', () => {
    const onSelect = vi.fn()
    render(<TocPanel {...defaultProps} onSelect={onSelect} />)

    const item = screen.getByText('Section 1')
    fireEvent.keyDown(item, { key: ' ' })

    expect(onSelect).toHaveBeenCalledWith('section-1')
  })

  it('应该阻止点击默认行为', () => {
    render(<TocPanel {...defaultProps} />)

    const link = screen.getByText('Section 1')
    const clickEvent = fireEvent.click(link)

    // 验证链接有正确的 href
    expect(link.closest('a')).toHaveAttribute('href', '#section-1')
  })

  it('应该正确设置目录项的 href', () => {
    render(<TocPanel {...defaultProps} />)

    mockToc.forEach(item => {
      const link = screen.getByText(item.text).closest('a')
      expect(link).toHaveAttribute('href', `#${item.id}`)
    })
  })

  it('非活动项不应该有 aria-current 属性', () => {
    render(<TocPanel {...defaultProps} activeId="title" />)

    const inactiveItem = screen.getByText('Section 1').closest('a')
    expect(inactiveItem).not.toHaveAttribute('aria-current')
  })
})
