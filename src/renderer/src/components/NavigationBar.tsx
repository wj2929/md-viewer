/**
 * NavigationBar 组件 - 全局导航栏
 * v1.3.6 混合方案
 * v1.4.2 添加窗口置顶按钮
 *
 * 包含：Logo + 当前文件夹路径 + 搜索 + 置顶 + 设置 + 主题切换
 */

import { ThemeToggle } from './ThemeToggle'
import { SearchBar, SearchBarHandle } from './SearchBar'
import { FolderHistoryDropdown } from './FolderHistoryDropdown'
import { RecentFilesDropdown } from './RecentFilesDropdown'
import { FileInfo } from './FileTree'
import './NavigationBar.css'
import { RefObject } from 'react'

interface NavigationBarProps {
  folderPath: string | null
  files: FileInfo[]
  theme: 'light' | 'dark' | 'auto'
  searchBarRef: RefObject<SearchBarHandle | null>
  // v1.4.2：窗口置顶
  isAlwaysOnTop: boolean
  onToggleAlwaysOnTop: () => void
  onOpenFolder: () => void
  onSelectHistoryFolder: (folderPath: string) => void
  onSelectRecentFile: (path: string) => void
  onFileSelect: (file: FileInfo) => void
  onSettingsClick: () => void
  onThemeChange: (theme: 'light' | 'dark' | 'auto') => void
  onRefreshFiles: () => void
  isLoading: boolean
}

export function NavigationBar({
  folderPath,
  files,
  theme,
  searchBarRef,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  onOpenFolder,
  onSelectHistoryFolder,
  onSelectRecentFile,
  onFileSelect,
  onSettingsClick,
  onThemeChange,
  onRefreshFiles,
  isLoading
}: NavigationBarProps): JSX.Element {
  return (
    <div className="navigation-bar">
      {/* macOS 拖拽区域 */}
      <div className="titlebar-drag-region" />

      {/* Logo */}
      <div className="nav-logo">
        <span className="nav-logo-icon">📝</span>
        <span className="nav-logo-text">MD Viewer</span>
      </div>

      {/* 当前文件夹路径 + 快捷操作 */}
      {folderPath && (
        <div className="nav-folder-section">
          <span className="nav-folder-path" title={folderPath}>
            📂 {folderPath.split(/[/\\]/).pop()}
          </span>
          <button
            className="nav-refresh-btn"
            onClick={onRefreshFiles}
            title="刷新文件列表"
            disabled={isLoading}
          >
            🔄
          </button>
          <FolderHistoryDropdown
            onSelectFolder={onSelectHistoryFolder}
            onOpenFolder={onOpenFolder}
          />
          <RecentFilesDropdown onSelectFile={onSelectRecentFile} />
        </div>
      )}

      {/* 搜索框（仅在有文件夹时显示） */}
      {folderPath && (
        <div className="nav-search-section">
          <SearchBar
            ref={searchBarRef}
            files={files}
            onFileSelect={onFileSelect}
          />
        </div>
      )}

      {/* 右侧操作区 */}
      <div className="nav-actions">
        {/* v1.4.2：窗口置顶按钮 */}
        <button
          className={`nav-always-on-top-btn ${isAlwaysOnTop ? 'active' : ''}`}
          onClick={onToggleAlwaysOnTop}
          title={isAlwaysOnTop ? `取消置顶 (${window.api?.platform === 'darwin' ? '⌘⌥T' : 'Ctrl+Alt+T'})` : `窗口置顶 (${window.api?.platform === 'darwin' ? '⌘⌥T' : 'Ctrl+Alt+T'})`}
          aria-pressed={isAlwaysOnTop}
          aria-label="窗口置顶"
        >
          {isAlwaysOnTop ? '📌' : '📍'}
        </button>
        <button
          className="nav-settings-btn"
          onClick={onSettingsClick}
          title="设置"
        >
          ⚙️
        </button>
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
      </div>
    </div>
  )
}
