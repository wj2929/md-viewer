import { useState, useCallback, useRef, useEffect } from 'react'
import { useClipboardStore } from '../stores/clipboardStore'

interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  children?: FileInfo[]
}

interface FileTreeProps {
  files: FileInfo[]
  onFileSelect: (file: FileInfo) => void
  selectedPath?: string
  basePath: string
  onFileRenamed?: (oldPath: string, newName: string) => void
}

interface FileTreeItemProps {
  item: FileInfo
  depth: number
  onFileSelect: (file: FileInfo) => void
  selectedPath?: string
  basePath: string
  onFileRenamed?: (oldPath: string, newName: string) => void
}

// 单个文件/文件夹项
function FileTreeItem({ item, depth, onFileSelect, selectedPath, basePath, onFileRenamed }: FileTreeItemProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(item.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSelected = selectedPath === item.path

  // 检查是否在剪贴板中（剪切状态）
  const isInClipboard = useClipboardStore(state => state.isInClipboard(item.path))
  const isCut = useClipboardStore(state => state.isCut && isInClipboard)

  // 监听重命名事件
  useEffect(() => {
    const handleStartRename = (targetPath: string) => {
      if (targetPath === item.path) {
        setIsRenaming(true)
        setNewName(item.name)
      }
    }

    const cleanup = window.api.onFileStartRename(handleStartRename)
    return cleanup
  }, [item.path, item.name])

  // 自动聚焦输入框
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      // 选中文件名（不包含扩展名）
      const dotIndex = item.name.lastIndexOf('.')
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex)
      } else {
        inputRef.current.select()
      }
    }
  }, [isRenaming, item.name])

  const handleClick = useCallback(() => {
    if (item.isDirectory) {
      setIsExpanded(prev => !prev)
    } else {
      onFileSelect(item)
    }
  }, [item, onFileSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }, [handleClick])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.api.showContextMenu(
      { name: item.name, path: item.path, isDirectory: item.isDirectory },
      basePath
    )
  }, [item, basePath])

  // 重命名处理
  const handleRenameSubmit = useCallback(() => {
    const trimmedName = newName.trim()
    if (trimmedName && trimmedName !== item.name) {
      onFileRenamed?.(item.path, trimmedName)
    }
    setIsRenaming(false)
  }, [newName, item.name, item.path, onFileRenamed])

  const handleRenameCancel = useCallback(() => {
    setIsRenaming(false)
    setNewName(item.name)
  }, [item.name])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleRenameCancel()
    }
  }, [handleRenameSubmit, handleRenameCancel])

  return (
    <div className="file-tree-item">
      <div
        className={`file-tree-row ${isSelected ? 'selected' : ''} ${item.isDirectory ? 'directory' : 'file'} ${isCut ? 'cut' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        role="treeitem"
        tabIndex={0}
        aria-expanded={item.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
      >
        {/* 展开/折叠图标 */}
        {item.isDirectory && (
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2 L8 6 L4 10" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}

        {/* 文件/文件夹图标 */}
        <span className="file-icon">
          {item.isDirectory ? (
            isExpanded ? '📂' : '📁'
          ) : (
            '📄'
          )}
        </span>

        {/* 文件名 */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            className="file-name-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
          />
        ) : (
          <span className="file-name" title={item.path}>
            {item.name}
          </span>
        )}
      </div>

      {/* 子项 */}
      {item.isDirectory && isExpanded && item.children && (
        <div className="file-tree-children" role="group">
          {item.children.map(child => (
            <FileTreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              basePath={basePath}
              onFileRenamed={onFileRenamed}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// 文件树组件
export function FileTree({ files, onFileSelect, selectedPath, basePath, onFileRenamed }: FileTreeProps): JSX.Element {
  if (files.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>没有找到 Markdown 文件</p>
      </div>
    )
  }

  return (
    <div className="file-tree" role="tree" aria-label="文件列表">
      {files.map(file => (
        <FileTreeItem
          key={file.path}
          item={file}
          depth={0}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          basePath={basePath}
          onFileRenamed={onFileRenamed}
        />
      ))}
    </div>
  )
}

export type { FileInfo }
