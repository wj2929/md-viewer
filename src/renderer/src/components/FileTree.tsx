import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useClipboardStore } from '../stores/clipboardStore'
import { useFilePreview } from '../hooks/useFilePreview'
import { FilePreviewTooltip } from './FilePreviewTooltip'

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
  // v1.3 阶段 5：多选支持
  selectedPaths?: Set<string>
  onSelectionChange?: (paths: Set<string>) => void
}

interface FileTreeItemProps {
  item: FileInfo
  depth: number
  onFileSelect: (file: FileInfo) => void
  selectedPath?: string
  basePath: string
  onFileRenamed?: (oldPath: string, newName: string) => void
  // v1.3 阶段 5：多选支持
  selectedPaths?: Set<string>
  onMultiSelect?: (path: string, event: React.MouseEvent) => void
  flatIndex: number
  // v1.5.3: 从父组件接收重命名目标路径
  renamingPath?: string | null
  // 文件预览 tooltip
  onFileMouseEnter?: (filePath: string, event: React.MouseEvent) => void
  onFileMouseLeave?: () => void
}

// 单个文件/文件夹项
function FileTreeItem({ item, depth, onFileSelect, selectedPath, basePath, onFileRenamed, selectedPaths, onMultiSelect, flatIndex, renamingPath, onFileMouseEnter, onFileMouseLeave }: FileTreeItemProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(item.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSelected = selectedPath === item.path
  // v1.3 阶段 5：多选状态检查
  const isMultiSelected = selectedPaths?.has(item.path) ?? false

  // 检查是否在剪贴板中（剪切状态）
  const isInClipboard = useClipboardStore(state => state.isInClipboard(item.path))
  const isCut = useClipboardStore(state => state.isCut && isInClipboard)

  // v1.5.3: 响应父组件广播的重命名事件（不再每个 item 注册 IPC 监听）
  useEffect(() => {
    if (renamingPath && renamingPath === item.path) {
      setIsRenaming(true)
      setNewName(item.name)
    }
  }, [renamingPath, item.path, item.name])

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

  const handleClick = useCallback((e: React.MouseEvent) => {
    // v1.3 阶段 5：多选逻辑
    const isMultiSelectKey = e.metaKey || e.ctrlKey || e.shiftKey

    if (isMultiSelectKey && onMultiSelect) {
      // 多选模式：不打开文件，只更新选择
      onMultiSelect(item.path, e)
    } else if (item.isDirectory) {
      setIsExpanded(prev => !prev)
    } else {
      onFileSelect(item)
    }
  }, [item, onFileSelect, onMultiSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      // 创建一个模拟的 MouseEvent 来处理键盘事件
      const syntheticEvent = {
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey
      } as React.MouseEvent
      handleClick(syntheticEvent)
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
        className={`file-tree-row ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${item.isDirectory ? 'directory' : 'file'} ${isCut ? 'cut' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        onMouseEnter={!item.isDirectory && onFileMouseEnter ? (e) => onFileMouseEnter(item.path, e) : undefined}
        onMouseLeave={!item.isDirectory ? onFileMouseLeave : undefined}
        role="treeitem"
        tabIndex={0}
        aria-expanded={item.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected || isMultiSelected}
        aria-describedby={!item.isDirectory && item.path.endsWith('.md') ? 'file-preview-tooltip' : undefined}
        data-flat-index={flatIndex}
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
          <span className="file-name" title={item.isDirectory ? item.path : undefined}>
            {item.name}
          </span>
        )}
      </div>

      {/* 子项 - 注意：flatIndex 需要在父组件计算并传递 */}
      {item.isDirectory && isExpanded && item.children && (
        <div className="file-tree-children" role="group">
          {item.children.map((child, idx) => (
            <FileTreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              basePath={basePath}
              onFileRenamed={onFileRenamed}
              selectedPaths={selectedPaths}
              onMultiSelect={onMultiSelect}
              flatIndex={flatIndex + idx + 1}
              renamingPath={renamingPath}
              onFileMouseEnter={onFileMouseEnter}
              onFileMouseLeave={onFileMouseLeave}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 将嵌套的文件树结构扁平化为数组
 * 用于 Shift+点击区间选择
 */
function flattenFileTree(files: FileInfo[]): FileInfo[] {
  const result: FileInfo[] = []

  function traverse(items: FileInfo[]) {
    for (const item of items) {
      result.push(item)
      if (item.isDirectory && item.children) {
        traverse(item.children)
      }
    }
  }

  traverse(files)
  return result
}

// 文件树组件
export function FileTree({ files, onFileSelect, selectedPath, basePath, onFileRenamed, selectedPaths, onSelectionChange }: FileTreeProps): JSX.Element {
  // v1.3 阶段 5：扁平化文件列表用于区间选择
  const flatFiles = useMemo(() => flattenFileTree(files), [files])

  // 文件预览 tooltip（父组件级别单一实例）
  const { tooltipProps, handleMouseEnter, handleMouseLeave } = useFilePreview()

  // v1.5.3: 在父组件统一监听重命名事件（只注册一次，避免 MaxListeners 警告）
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  useEffect(() => {
    const cleanup = window.api.onFileStartRename((targetPath: string) => {
      setRenamingPath(targetPath)
    })
    return cleanup
  }, [])

  // 最后一个选择的路径（用于 Shift 区间选择）
  const lastSelectedRef = useRef<string | null>(null)

  // 多选处理逻辑
  const handleMultiSelect = useCallback((path: string, event: React.MouseEvent) => {
    if (!onSelectionChange) return

    const currentSelection = selectedPaths || new Set<string>()

    if (event.shiftKey && lastSelectedRef.current) {
      // Shift+点击：区间选择
      const lastIndex = flatFiles.findIndex(f => f.path === lastSelectedRef.current)
      const currentIndex = flatFiles.findIndex(f => f.path === path)

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex)
        const end = Math.max(lastIndex, currentIndex)
        const newSelection = new Set(currentSelection)

        for (let i = start; i <= end; i++) {
          newSelection.add(flatFiles[i].path)
        }

        onSelectionChange(newSelection)
      }
    } else if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+点击：追加/取消选择
      const newSelection = new Set(currentSelection)
      if (newSelection.has(path)) {
        newSelection.delete(path)
      } else {
        newSelection.add(path)
      }
      onSelectionChange(newSelection)
      lastSelectedRef.current = path
    } else {
      // 普通点击：清空选择，只选中当前项
      onSelectionChange(new Set([path]))
      lastSelectedRef.current = path
    }
  }, [flatFiles, selectedPaths, onSelectionChange])

  // v1.3 阶段 5：键盘快捷键（Cmd+A 全选，Escape 取消）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!onSelectionChange) return

    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      // Cmd/Ctrl+A：全选所有文件（不包括目录）
      const allFilePaths = flatFiles
        .filter(f => !f.isDirectory)
        .map(f => f.path)
      onSelectionChange(new Set(allFilePaths))
    } else if (e.key === 'Escape') {
      // Escape：清空选择
      onSelectionChange(new Set())
      lastSelectedRef.current = null
    }
  }, [flatFiles, onSelectionChange])

  if (files.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>没有找到 Markdown 或 Excalidraw 文件</p>
      </div>
    )
  }

  return (
    <div
      className="file-tree"
      role="tree"
      aria-label="文件列表"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {files.map((file, index) => (
        <FileTreeItem
          key={file.path}
          item={file}
          depth={0}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          basePath={basePath}
          onFileRenamed={onFileRenamed}
          selectedPaths={selectedPaths}
          onMultiSelect={handleMultiSelect}
          flatIndex={index}
          renamingPath={renamingPath}
          onFileMouseEnter={handleMouseEnter}
          onFileMouseLeave={handleMouseLeave}
        />
      ))}
      <FilePreviewTooltip {...tooltipProps} />
    </div>
  )
}

export type { FileInfo }
