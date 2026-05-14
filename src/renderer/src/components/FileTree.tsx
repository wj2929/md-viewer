import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useClipboardStore } from '../stores/clipboardStore'
import { useFilePreview } from '../hooks/useFilePreview'
import { FilePreviewTooltip } from './FilePreviewTooltip'

interface FileInfo {
  name: string
  path: string
  treePath?: string
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
  collapsedFolders: Record<string, false>
  treeStateLoaded: boolean
  onFolderToggle: (folder: FileInfo, expanded: boolean) => void
  forceExpanded?: boolean
}

// 单个文件/文件夹项
function FileTreeItem({ item, depth, onFileSelect, selectedPath, basePath, onFileRenamed, selectedPaths, onMultiSelect, flatIndex, renamingPath, onFileMouseEnter, onFileMouseLeave, collapsedFolders, treeStateLoaded, onFolderToggle, forceExpanded = false }: FileTreeItemProps): JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(item.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSelected = selectedPath === item.path
  const isExpanded = item.isDirectory
    ? forceExpanded || (treeStateLoaded && item.treePath ? collapsedFolders[item.treePath] !== false : false)
    : false
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
      if (!treeStateLoaded) return
      if (forceExpanded) return
      onFolderToggle(item, !isExpanded)
    } else {
      onFileSelect(item)
    }
  }, [item, onFileSelect, onMultiSelect, treeStateLoaded, onFolderToggle, isExpanded])

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
              collapsedFolders={collapsedFolders}
              treeStateLoaded={treeStateLoaded}
              onFolderToggle={onFolderToggle}
              forceExpanded={forceExpanded}
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

function fileMatchesFilter(item: FileInfo, query: string): boolean {
  const lowerQuery = query.toLowerCase()
  return [
    item.name,
    item.treePath,
    item.path
  ].some(value => value?.toLowerCase().includes(lowerQuery))
}

function filterFileTree(files: FileInfo[], query: string): FileInfo[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return files

  const filterItem = (item: FileInfo): FileInfo | null => {
    const selfMatches = fileMatchesFilter(item, trimmedQuery)

    if (!item.isDirectory) {
      return selfMatches ? item : null
    }

    if (selfMatches) {
      return item
    }

    const filteredChildren = item.children
      ?.map(filterItem)
      .filter((child): child is FileInfo => child !== null) ?? []

    if (filteredChildren.length === 0) return null

    return {
      ...item,
      children: filteredChildren
    }
  }

  return files
    .map(filterItem)
    .filter((item): item is FileInfo => item !== null)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
}

function isReactImeComposingEvent(e: React.KeyboardEvent): boolean {
  const nativeEvent = e.nativeEvent as KeyboardEvent & { keyCode?: number }
  return e.key === 'Process' || e.key === 'Unidentified' || nativeEvent.isComposing || nativeEvent.keyCode === 229
}

// 文件树组件
export function FileTree({ files, onFileSelect, selectedPath, basePath, onFileRenamed, selectedPaths, onSelectionChange }: FileTreeProps): JSX.Element {
  const [filterQuery, setFilterQuery] = useState('')
  const filterInputRef = useRef<HTMLInputElement>(null)
  const trimmedFilterQuery = filterQuery.trim()
  const isFilteringFileTree = trimmedFilterQuery.length > 0
  const visibleFiles = useMemo(
    () => filterFileTree(files, trimmedFilterQuery),
    [files, trimmedFilterQuery]
  )
  // v1.3 阶段 5：扁平化文件列表用于区间选择
  const flatFiles = useMemo(() => flattenFileTree(visibleFiles), [visibleFiles])

  // 文件预览 tooltip（父组件级别单一实例）
  const { tooltipProps, handleMouseEnter, handleMouseLeave } = useFilePreview()

  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, false>>({})
  const [treeStateLoaded, setTreeStateLoaded] = useState(false)
  const [loadedBasePath, setLoadedBasePath] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => {
    let cancelled = false

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    setTreeStateLoaded(false)
    setCollapsedFolders({})
    setLoadedBasePath(null)
    setFilterQuery('')

    if (!basePath) {
      setLoadedBasePath(basePath)
      setTreeStateLoaded(true)
      return () => {
        cancelled = true
      }
    }

    window.api.getFolderTreeState()
      .then((state) => {
        if (!cancelled) {
          setCollapsedFolders(state || {})
          setLoadedBasePath(basePath)
          setTreeStateLoaded(true)
        }
      })
      .catch((error) => {
        console.error('[FileTree] Failed to load folder expansion state:', error)
        if (!cancelled) {
          setCollapsedFolders({})
          setLoadedBasePath(basePath)
          setTreeStateLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [basePath])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const scheduleSaveCollapsedFolders = useCallback((nextFolders: Record<string, false>) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      window.api.saveFolderTreeState(nextFolders).catch((error) => {
        console.error('[FileTree] Failed to save folder expansion state:', error)
      })
    }, 300)
  }, [])

  const handleFolderToggle = useCallback((folder: FileInfo, expanded: boolean) => {
    const treePath = folder.treePath
    if (!treePath) return

    setCollapsedFolders(prev => {
      const next = { ...prev }
      if (expanded) {
        delete next[treePath]
      } else {
        next[treePath] = false
      }
      scheduleSaveCollapsedFolders(next)
      return next
    })
  }, [scheduleSaveCollapsedFolders])

  const handleResetFolderTreeState = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    setCollapsedFolders({})

    try {
      await window.api.clearFolderTreeState()
    } catch (error) {
      console.error('[FileTree] Failed to clear folder expansion state:', error)
    }
  }, [])

  const hasResettableFolderTreeState = Object.keys(collapsedFolders).length > 0

  const handleClearFilter = useCallback(() => {
    setFilterQuery('')
  }, [])

  const focusFilterInput = useCallback(() => {
    window.setTimeout(() => {
      filterInputRef.current?.focus()
    }, 0)
  }, [])

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

  const handleFilterInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = e.target.value
    setFilterQuery(nextQuery)
  }, [])

  const handleFilterInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isReactImeComposingEvent(e)) return

    if (e.key === 'Escape') {
      e.preventDefault()
      setFilterQuery('')
    } else if (e.key === 'Enter' && !filterQuery) {
      e.preventDefault()
    }
  }, [filterQuery])

  // v1.3 阶段 5：键盘快捷键（Cmd+A 全选，Escape 取消）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (isEditableTarget(e.target)) return

    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      if (!onSelectionChange) return
      e.preventDefault()
      // Cmd/Ctrl+A：全选所有文件（不包括目录）
      const allFilePaths = flatFiles
        .filter(f => !f.isDirectory)
        .map(f => f.path)
      onSelectionChange(new Set(allFilePaths))
    } else if (e.key === 'Escape') {
      if (filterQuery) {
        e.preventDefault()
        setFilterQuery('')
        return
      }
      if (!onSelectionChange) return
      // Escape：清空选择
      onSelectionChange(new Set())
      lastSelectedRef.current = null
    } else if (e.key === 'Backspace' && filterQuery) {
      e.preventDefault()
      setFilterQuery(prev => {
        return prev.slice(0, -1)
      })
    }
  }, [filterQuery, flatFiles, onSelectionChange])

  const handleFileTreeClick = useCallback((e: React.MouseEvent) => {
    if (isEditableTarget(e.target)) return
    focusFilterInput()
  }, [focusFilterInput])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (isEditableTarget(e.target)) return

    const text = e.clipboardData.getData('text').trim()
    if (!text) return

    e.preventDefault()
    setFilterQuery(prev => `${prev}${text}`)
  }, [])

  if (!treeStateLoaded || loadedBasePath !== basePath) {
    return (
      <div className="file-tree-loading" role="status" aria-live="polite">
        正在恢复文件夹状态...
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>没有找到 Markdown 或 Excalidraw 文件</p>
      </div>
    )
  }

  return (
    <div className="file-tree-shell">
      <div
        className="file-tree-filter-bar"
        role="search"
        aria-label="文件树过滤"
      >
        <span className="file-tree-filter-label">过滤:</span>
        <input
          ref={filterInputRef}
          type="text"
          className="file-tree-filter-input"
          value={filterQuery}
          onChange={handleFilterInputChange}
          onKeyDown={handleFilterInputKeyDown}
          aria-label="文件过滤"
          spellCheck={false}
        />
        <button
          type="button"
          className="file-tree-filter-clear"
          onClick={handleClearFilter}
          title="清除文件过滤"
          aria-label="清除文件过滤"
        >
          ×
        </button>
      </div>
      {hasResettableFolderTreeState && (
        <div className="file-tree-toolbar">
          <button
            type="button"
            className="file-tree-reset-btn"
            onClick={handleResetFolderTreeState}
            title="重置当前文件夹展开状态"
            aria-label="重置当前文件夹展开状态"
          >
            重置展开状态
          </button>
        </div>
      )}
      <div
        className="file-tree"
        role="tree"
        aria-label="文件列表"
        onClick={handleFileTreeClick}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        tabIndex={-1}
      >
        {visibleFiles.length === 0 && isFilteringFileTree ? (
          <div className="file-tree-no-results" role="status">
            没有匹配的文件
          </div>
        ) : (
          visibleFiles.map((file, index) => (
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
              collapsedFolders={collapsedFolders}
              treeStateLoaded={treeStateLoaded}
              onFolderToggle={handleFolderToggle}
              forceExpanded={isFilteringFileTree}
            />
          ))
        )}
      </div>
      <FilePreviewTooltip {...tooltipProps} />
    </div>
  )
}

export type { FileInfo }
