import { createRef, type ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationBar } from '../../src/components/NavigationBar'

vi.mock('../../src/components/SearchBar', () => ({ SearchBar: () => null }))
vi.mock('../../src/components/FolderHistoryDropdown', () => ({ FolderHistoryDropdown: () => null }))
vi.mock('../../src/components/RecentFilesDropdown', () => ({ RecentFilesDropdown: () => null }))
vi.mock('../../src/components/WatchStatus', () => ({ WatchStatus: () => null }))

describe('NavigationBar SVG icons', () => {
  it('核心入口用 SVG，保留回调、可访问名称和置顶状态', () => {
    const props: ComponentProps<typeof NavigationBar> = {
      folderPath: '/tmp/fixture', files: [], theme: 'light', searchBarRef: createRef(),
      isAlwaysOnTop: false, isLoading: false, sidebarCollapsed: false, bookmarkPanelCollapsed: true,
      onToggleAlwaysOnTop: vi.fn(), onOpenFolder: vi.fn(), onSelectHistoryFolder: vi.fn(),
      onSelectRecentFile: vi.fn(), onFileSelect: vi.fn(), onExternalFileOpen: vi.fn(),
      onSettingsClick: vi.fn(), onThemeChange: vi.fn(), onRefreshFiles: vi.fn(),
      onToggleSidebar: vi.fn(), onToggleBookmarkPanel: vi.fn(),
      lastExportedFilePath: '/tmp/fixture/output.html', onOpenLastExport: vi.fn(),
    }
    const { container, rerender } = render(<NavigationBar {...props} />)
    for (const selector of ['.nav-logo-icon', '.nav-folder-path', '.nav-settings-btn', '.nav-always-on-top-btn', '.nav-last-export-btn']) {
      const icon = container.querySelector(`${selector} svg`)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke', 'currentColor')
      expect(icon?.querySelector('text, image, use, foreignObject')).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '窗口置顶' }))
    fireEvent.click(screen.getByRole('button', { name: '打开上次导出的文件' }))
    expect(props.onSettingsClick).toHaveBeenCalledTimes(1)
    expect(props.onToggleAlwaysOnTop).toHaveBeenCalledTimes(1)
    expect(props.onOpenLastExport).toHaveBeenCalledTimes(1)
    rerender(<NavigationBar {...props} isAlwaysOnTop />)
    expect(screen.getByRole('button', { name: '取消窗口置顶' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.nav-always-on-top-btn')).toHaveClass('active')
  })
})
