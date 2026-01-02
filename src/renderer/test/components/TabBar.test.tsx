import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TabBar, Tab } from '../../src/components/TabBar'
import { FileInfo } from '../../src/components/FileTree'

describe('TabBar 组件测试', () => {
  const mockFileInfo: FileInfo = {
    name: 'test.md',
    path: '/test/test.md',
    isDirectory: false
  }

  const mockTabs: Tab[] = [
    {
      id: 'tab-1',
      file: { name: 'file1.md', path: '/test/file1.md', isDirectory: false },
      content: '# File 1'
    },
    {
      id: 'tab-2',
      file: { name: 'file2.md', path: '/test/file2.md', isDirectory: false },
      content: '# File 2'
    },
    {
      id: 'tab-3',
      file: { name: 'file3.md', path: '/test/file3.md', isDirectory: false },
      content: '# File 3'
    }
  ]

  describe('渲染测试', () => {
    it('应该渲染所有标签', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(screen.getByText('file1.md')).toBeInTheDocument()
      expect(screen.getByText('file2.md')).toBeInTheDocument()
      expect(screen.getByText('file3.md')).toBeInTheDocument()
    })

    it('应该高亮显示活动标签', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-2"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).not.toHaveClass('active')
      expect(tabs[1]).toHaveClass('active')
      expect(tabs[2]).not.toHaveClass('active')
    })

    it('空标签列表应该渲染空 div', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      const { container } = render(
        <TabBar
          tabs={[]}
          activeTabId={null}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(container.querySelector('.tabs')).toBeInTheDocument()
      expect(container.querySelector('.tab')).not.toBeInTheDocument()
    })

    it('应该显示文件图标', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={[mockTabs[0]]}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(screen.getByText('📄')).toBeInTheDocument()
    })

    it('标签应该显示文件完整路径作为 title', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={[mockTabs[0]]}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabName = screen.getByText('file1.md')
      expect(tabName).toHaveAttribute('title', '/test/file1.md')
    })
  })

  describe('交互测试', () => {
    it('点击标签应该触发 onTabClick', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tab2 = screen.getByText('file2.md').closest('.tab')
      fireEvent.click(tab2!)

      expect(onTabClick).toHaveBeenCalledWith('tab-2')
      expect(onTabClick).toHaveBeenCalledTimes(1)
    })

    it('点击关闭按钮应该触发 onTabClose', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const closeButton = screen.getByLabelText('关闭 file1.md')
      fireEvent.click(closeButton)

      expect(onTabClose).toHaveBeenCalledWith('tab-1')
      expect(onTabClose).toHaveBeenCalledTimes(1)
    })

    it('点击关闭按钮不应该触发 onTabClick', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const closeButton = screen.getByLabelText('关闭 file1.md')
      fireEvent.click(closeButton)

      expect(onTabClick).not.toHaveBeenCalled()
      expect(onTabClose).toHaveBeenCalledTimes(1)
    })

    it('按 Enter 键应该触发 onTabClick', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tab2 = screen.getByText('file2.md').closest('.tab')
      fireEvent.keyDown(tab2!, { key: 'Enter' })

      expect(onTabClick).toHaveBeenCalledWith('tab-2')
    })

    it('按空格键应该触发 onTabClick', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tab3 = screen.getByText('file3.md').closest('.tab')
      fireEvent.keyDown(tab3!, { key: ' ' })

      expect(onTabClick).toHaveBeenCalledWith('tab-3')
    })

    it('按其他键不应该触发 onTabClick', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tab2 = screen.getByText('file2.md').closest('.tab')
      fireEvent.keyDown(tab2!, { key: 'Escape' })

      expect(onTabClick).not.toHaveBeenCalled()
    })
  })

  describe('可访问性测试', () => {
    it('标签应该有 role="tab"', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(3)
    })

    it('活动标签应该有 aria-selected="true"', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-2"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
    })

    it('标签应该可以通过键盘聚焦', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabs = screen.getAllByRole('tab')
      tabs.forEach(tab => {
        expect(tab).toHaveAttribute('tabIndex', '0')
      })
    })

    it('关闭按钮应该有描述性的 aria-label', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(screen.getByLabelText('关闭 file1.md')).toBeInTheDocument()
      expect(screen.getByLabelText('关闭 file2.md')).toBeInTheDocument()
      expect(screen.getByLabelText('关闭 file3.md')).toBeInTheDocument()
    })
  })

  describe('边界情况测试', () => {
    it('应该处理只有一个标签的情况', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={[mockTabs[0]]}
          activeTabId="tab-1"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(screen.getAllByRole('tab')).toHaveLength(1)
    })

    it('应该处理 activeTabId 为 null 的情况', () => {
      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={mockTabs}
          activeTabId={null}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      const tabs = screen.getAllByRole('tab')
      tabs.forEach(tab => {
        expect(tab).not.toHaveClass('active')
      })
    })

    it('应该处理超长文件名', () => {
      const longNameTab: Tab = {
        id: 'tab-long',
        file: {
          name: 'this-is-a-very-long-file-name-that-should-be-truncated-in-the-ui.md',
          path: '/test/this-is-a-very-long-file-name-that-should-be-truncated-in-the-ui.md',
          isDirectory: false
        },
        content: '# Content'
      }

      const onTabClick = vi.fn()
      const onTabClose = vi.fn()

      render(
        <TabBar
          tabs={[longNameTab]}
          activeTabId="tab-long"
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
      )

      expect(screen.getByText(longNameTab.file.name)).toBeInTheDocument()
    })
  })
})
