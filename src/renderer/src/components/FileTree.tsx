import { useState, useCallback } from 'react'

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
}

interface FileTreeItemProps {
  item: FileInfo
  depth: number
  onFileSelect: (file: FileInfo) => void
  selectedPath?: string
}

// 单个文件/文件夹项
function FileTreeItem({ item, depth, onFileSelect, selectedPath }: FileTreeItemProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true)
  const isSelected = selectedPath === item.path

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

  return (
    <div className="file-tree-item">
      <div
        className={`file-tree-row ${isSelected ? 'selected' : ''} ${item.isDirectory ? 'directory' : 'file'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
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
        <span className="file-name" title={item.path}>
          {item.name}
        </span>
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

// 文件树组件
export function FileTree({ files, onFileSelect, selectedPath }: FileTreeProps): JSX.Element {
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
        />
      ))}
    </div>
  )
}

export type { FileInfo }
