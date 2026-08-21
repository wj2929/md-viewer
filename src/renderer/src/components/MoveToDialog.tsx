/**
 * 跨根移动目标选择弹窗。
 * 默认逐层浏览历史目录；搜索框只过滤“最近打开的目录”列表。
 * 移动只发送 opaque targetHistoryId + 相对子路径，绝不传目标绝对路径。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import './MoveToDialog.css'
import { getActiveWorkspaceOperationContext } from '../utils/workspaceOperationContext'

interface FolderHistoryItem {
  id: string
  path: string
  name: string
  lastOpened: number
}

interface MoveToDialogProps {
  isOpen: boolean
  sources: string[]
  onClose: () => void
  onMoveSuccess?: (message: string) => void
  onMoveError?: (message: string) => void
}

interface DirNode {
  name: string
  path: string
}

interface SelectedMoveTarget {
  historyId: string
  relPath: string
  displayLabel: string
  absolutePath: string
}

const normSep = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const baseName = (p: string): string => normSep(p).split('/').pop() ?? p
const dirName = (p: string): string => {
  const n = normSep(p)
  const idx = n.lastIndexOf('/')
  return idx <= 0 ? n : n.slice(0, idx)
}
const relFromRoot = (root: string, target: string): string | null => {
  const r = normSep(root)
  const t = normSep(target)
  if (t === r) return ''
  if (t.startsWith(`${r}/`)) return t.slice(r.length + 1)
  return null
}

const isInvalidTarget = (targetDir: string, sources: string[]): boolean => {
  const t = normSep(targetDir)
  return sources.some(src => {
    const s = normSep(src)
    if (t === s || t.startsWith(`${s}/`)) return true
    return dirName(s) === t
  })
}

interface TreeItemProps {
  node: DirNode
  depth: number
  sources: string[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

const TreeItem: React.FC<TreeItemProps> = ({ node, depth, sources, selectedPath, onSelect }) => {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const disabled = isInvalidTarget(node.path, sources)

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (children === null) {
      setLoading(true)
      try {
        setChildren(await window.api.listChildDirs(node.path))
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }, [expanded, children, node.path])

  return (
    <div className="move-to-tree-node">
      <div
        className={`move-to-tree-row ${selectedPath === node.path ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => !disabled && onSelect(node.path)}
        title={disabled ? '不能移动到源自身、子目录或原目录' : node.path}
      >
        <span
          className="move-to-tree-caret"
          onClick={(event) => {
            event.stopPropagation()
            void toggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span className="move-to-tree-icon">📁</span>
        <span className="move-to-tree-name">{node.name}</span>
      </div>
      {expanded && (
        <div className="move-to-tree-children">
          {loading && <div className="move-to-tree-hint">加载中…</div>}
          {!loading && children?.length === 0 && (
            <div className="move-to-tree-hint" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              （无子目录）
            </div>
          )}
          {children?.map(child => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              sources={sources}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const MoveToDialog: React.FC<MoveToDialogProps> = ({
  isOpen,
  sources,
  onClose,
  onMoveSuccess,
  onMoveError
}) => {
  const [history, setHistory] = useState<FolderHistoryItem[]>([])
  const [selectedRoot, setSelectedRoot] = useState<FolderHistoryItem | null>(null)
  const [rootChildren, setRootChildren] = useState<DirNode[] | null>(null)
  const [loadingRoot, setLoadingRoot] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<SelectedMoveTarget | null>(null)
  const [moving, setMoving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const rootRequestId = useRef(0)

  useEffect(() => {
    if (!isOpen) {
      rootRequestId.current += 1
      return
    }
    setSelectedRoot(null)
    setRootChildren(null)
    setSelectedTarget(null)
    setMoving(false)
    setSearchQuery('')
    window.api.getFolderHistory().then(setHistory).catch(() => setHistory([]))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !moving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, moving, onClose])



  const selectRoot = useCallback(async (item: FolderHistoryItem) => {
    const requestId = ++rootRequestId.current
    setSelectedRoot(item)
    setSelectedTarget({
      historyId: item.id,
      relPath: '',
      displayLabel: item.name,
      absolutePath: normSep(item.path)
    })
    setRootChildren(null)
    setLoadingRoot(true)
    try {
      const dirs = await window.api.listChildDirs(item.path)
      if (rootRequestId.current === requestId) setRootChildren(dirs)
    } catch {
      if (rootRequestId.current === requestId) setRootChildren([])
    } finally {
      if (rootRequestId.current === requestId) setLoadingRoot(false)
    }
  }, [])

  const selectTreeTarget = useCallback((absolutePath: string) => {
    if (!selectedRoot) return
    const relPath = relFromRoot(selectedRoot.path, absolutePath)
    if (relPath === null) return
    setSelectedTarget({
      historyId: selectedRoot.id,
      relPath,
      displayLabel: relPath ? `${selectedRoot.name}/${relPath}` : selectedRoot.name,
      absolutePath
    })
  }, [selectedRoot])



  const handleMove = useCallback(async () => {
    if (!selectedTarget) return
    if (!window.confirm(`确定把 ${sources.length} 项移动到「${selectedTarget.displayLabel}」？`)) return

    setMoving(true)
    const operation = getActiveWorkspaceOperationContext()
    if (!operation) return
    const succeeded: string[] = []
    const failed: { path: string; error: string }[] = []
    for (const src of sources) {
      try {
        await window.api.moveFileToFolder(
          src,
          selectedTarget.historyId,
          selectedTarget.relPath,
          operation
        )
        succeeded.push(src)
      } catch (error) {
        failed.push({ path: src, error: error instanceof Error ? error.message : String(error) })
      }
    }
    setMoving(false)

    if (failed.length === 0) {
      onMoveSuccess?.(`已移动 ${succeeded.length} 项到「${selectedTarget.displayLabel}」`)
    } else if (succeeded.length === 0) {
      onMoveError?.(`移动失败：${failed[0].error}`)
    } else {
      onMoveError?.(`已移动 ${succeeded.length} 项，${failed.length} 项失败：${failed[0].error}`)
    }
    onClose()
  }, [selectedTarget, sources, onMoveSuccess, onMoveError, onClose])

  if (!isOpen) return null

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredHistory = normalizedSearch
    ? history.filter(item =>
        item.name.toLocaleLowerCase().includes(normalizedSearch) ||
        item.path.toLocaleLowerCase().includes(normalizedSearch)
      )
    : history
  const selectedPath = selectedTarget?.absolutePath ?? null
  const rootIsInvalid = selectedRoot ? isInvalidTarget(selectedRoot.path, sources) : false
  const canMove = !!selectedTarget && !moving && !isInvalidTarget(selectedTarget.absolutePath, sources)

  return (
    <div className="move-to-overlay" onClick={() => !moving && onClose()}>
      <div className="move-to-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="move-to-header">
          <h2>📦 移动到…</h2>
          <button className="move-to-close" onClick={() => !moving && onClose()}>×</button>
        </div>

        <div className="move-to-summary">
          待移动：{sources.length} 项
          {sources.length <= 3 && `（${sources.map(baseName).join('、')}）`}
        </div>

        <div className="move-to-search">
          <span aria-hidden="true">🔍</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索最近打开的目录…"
            aria-label="搜索移动目标目录"
            autoFocus
          />
          {searchQuery && (
            <button aria-label="清空目录搜索" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>

        <div className="move-to-section-title">
          最近打开的目录{normalizedSearch ? ` · ${filteredHistory.length}/${history.length}` : ''}
        </div>
        <div className="move-to-roots">
          {history.length === 0 && <div className="move-to-tree-hint">（无历史目录）</div>}
          {history.length > 0 && filteredHistory.length === 0 && (
            <div className="move-to-tree-hint">未找到匹配的最近打开目录</div>
          )}
          {filteredHistory.map(item => (
            <div
              key={item.id}
              className={`move-to-root-row ${selectedRoot?.id === item.id ? 'selected' : ''}`}
              onClick={() => void selectRoot(item)}
              title={item.path}
            >
              <span className="move-to-root-radio">{selectedRoot?.id === item.id ? '●' : '○'}</span>
              <span className="move-to-root-name">{item.name}</span>
              <span className="move-to-root-path">{item.path}</span>
            </div>
          ))}
        </div>

        <div className="move-to-section-title">
          目标子目录{selectedRoot ? ` · ${selectedRoot.name}` : ''}
        </div>
        <div className="move-to-tree">
          <>
            {!selectedRoot && <div className="move-to-tree-hint">请先在上方选择一个目标目录</div>}
            {selectedRoot && (
              <>
                <div
                  className={`move-to-tree-row root-option ${selectedPath === normSep(selectedRoot.path) ? 'selected' : ''} ${rootIsInvalid ? 'disabled' : ''}`}
                  onClick={() => !rootIsInvalid && selectTreeTarget(selectedRoot.path)}
                  title={rootIsInvalid ? '源已在此目录或为其自身' : selectedRoot.path}
                >
                  <span className="move-to-tree-icon">📂</span>
                  <span className="move-to-tree-name">（移动到「{selectedRoot.name}」根）</span>
                </div>
                {loadingRoot && <div className="move-to-tree-hint">加载中…</div>}
                {rootChildren?.map(child => (
                  <TreeItem
                    key={child.path}
                    node={child}
                    depth={1}
                    sources={sources}
                    selectedPath={selectedPath}
                    onSelect={selectTreeTarget}
                  />
                ))}
              </>
            )}
          </>
        </div>

        <div className="move-to-footer">
          <span className="move-to-target">目标：{selectedTarget?.displayLabel ?? '（未选）'}</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={() => !moving && onClose()} disabled={moving}>取消</button>
            <button className="move-to-btn primary" onClick={() => void handleMove()} disabled={!canMove}>
              {moving ? '移动中…' : '移动'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
