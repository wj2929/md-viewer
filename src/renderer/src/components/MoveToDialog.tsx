/**
 * 跨根移动目标选择弹窗（阶段 B）
 * 上半：文件夹历史里的目录（目标根，带 opaque id）
 * 下半：选中根后逐层懒加载其子目录树，供下钻选择目标子目录
 * 移动只把 opaque targetHistoryId + 相对子路径发给主进程，绝不传目标绝对路径。
 */

import { useCallback, useEffect, useState } from 'react'
import './MoveToDialog.css'

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

// 渲染进程无 node path，用正则手搓（与 FileTree 一致）
const normSep = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const baseName = (p: string): string => normSep(p).split('/').pop() ?? p
const dirName = (p: string): string => {
  const n = normSep(p)
  const idx = n.lastIndexOf('/')
  return idx <= 0 ? n : n.slice(0, idx)
}
// 相对子路径（targetDir 相对 root），越界返回 null
const relFromRoot = (root: string, target: string): string | null => {
  const r = normSep(root)
  const t = normSep(target)
  if (t === r) return ''
  if (t.startsWith(`${r}/`)) return t.slice(r.length + 1)
  return null
}

// 目标目录对给定源集合是否非法（自身/子目录 或 同目录 no-op）
const isInvalidTarget = (targetDir: string, sources: string[]): boolean => {
  const t = normSep(targetDir)
  return sources.some(src => {
    const s = normSep(src)
    if (t === s || t.startsWith(`${s}/`)) return true // 移入自身/子目录
    if (dirName(s) === t) return true // 已在该目录，移动无意义
    return false
  })
}

interface DirNode {
  name: string
  path: string
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
        const dirs = await window.api.listChildDirs(node.path)
        setChildren(dirs)
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
          onClick={(e) => {
            e.stopPropagation()
            toggle()
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
          {!loading && children && children.length === 0 && (
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
  const [targetDir, setTargetDir] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  // 打开时加载历史，重置选择
  useEffect(() => {
    if (!isOpen) return
    setSelectedRoot(null)
    setRootChildren(null)
    setTargetDir(null)
    setMoving(false)
    window.api
      .getFolderHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [isOpen])

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !moving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, moving, onClose])

  const selectRoot = useCallback(async (item: FolderHistoryItem) => {
    setSelectedRoot(item)
    setTargetDir(item.path) // 默认目标 = 根本身
    setRootChildren(null)
    setLoadingRoot(true)
    try {
      const dirs = await window.api.listChildDirs(item.path)
      setRootChildren(dirs)
    } catch {
      setRootChildren([])
    } finally {
      setLoadingRoot(false)
    }
  }, [])

  const handleMove = useCallback(async () => {
    if (!selectedRoot || !targetDir) return
    const subRelPath = relFromRoot(selectedRoot.path, targetDir)
    if (subRelPath === null) {
      onMoveError?.('目标路径越界')
      return
    }
    const targetDisplay = subRelPath ? `${selectedRoot.name}/${subRelPath}` : selectedRoot.name
    if (!window.confirm(`确定把 ${sources.length} 项移动到「${targetDisplay}」？`)) return

    setMoving(true)
    const succeeded: string[] = []
    const failed: { path: string; error: string }[] = []
    for (const src of sources) {
      try {
        await window.api.moveFileToFolder(src, selectedRoot.id, subRelPath)
        succeeded.push(src)
      } catch (error) {
        failed.push({ path: src, error: error instanceof Error ? error.message : String(error) })
      }
    }
    setMoving(false)

    if (failed.length === 0) {
      onMoveSuccess?.(`已移动 ${succeeded.length} 项到「${targetDisplay}」`)
    } else if (succeeded.length === 0) {
      onMoveError?.(`移动失败：${failed[0].error}`)
    } else {
      onMoveError?.(`已移动 ${succeeded.length} 项，${failed.length} 项失败：${failed[0].error}`)
    }
    onClose()
  }, [selectedRoot, targetDir, sources, onMoveSuccess, onMoveError, onClose])

  if (!isOpen) return null

  const targetDisplay =
    selectedRoot && targetDir
      ? (() => {
          const rel = relFromRoot(selectedRoot.path, targetDir)
          return rel ? `${selectedRoot.name}/${rel}` : selectedRoot.name
        })()
      : null
  const rootIsInvalid = selectedRoot ? isInvalidTarget(selectedRoot.path, sources) : false
  const canMove =
    !!selectedRoot && !!targetDir && !moving && !isInvalidTarget(targetDir, sources)

  return (
    <div className="move-to-overlay" onClick={() => !moving && onClose()}>
      <div className="move-to-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="move-to-header">
          <h2>📦 移动到…</h2>
          <button className="move-to-close" onClick={() => !moving && onClose()}>
            ×
          </button>
        </div>

        <div className="move-to-summary">
          待移动：{sources.length} 项
          {sources.length <= 3 && `（${sources.map(baseName).join('、')}）`}
        </div>

        <div className="move-to-section-title">最近打开的目录</div>
        <div className="move-to-roots">
          {history.length === 0 && <div className="move-to-tree-hint">（无历史目录）</div>}
          {history.map(item => (
            <div
              key={item.id}
              className={`move-to-root-row ${selectedRoot?.id === item.id ? 'selected' : ''}`}
              onClick={() => selectRoot(item)}
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
          {!selectedRoot && <div className="move-to-tree-hint">请先在上方选择一个目标目录</div>}
          {selectedRoot && (
            <>
              <div
                className={`move-to-tree-row root-option ${targetDir === selectedRoot.path ? 'selected' : ''} ${rootIsInvalid ? 'disabled' : ''}`}
                onClick={() => !rootIsInvalid && setTargetDir(selectedRoot.path)}
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
                  selectedPath={targetDir}
                  onSelect={setTargetDir}
                />
              ))}
            </>
          )}
        </div>

        <div className="move-to-footer">
          <span className="move-to-target">目标：{targetDisplay ?? '（未选）'}</span>
          <div className="move-to-actions">
            <button className="move-to-btn" onClick={() => !moving && onClose()} disabled={moving}>
              取消
            </button>
            <button className="move-to-btn primary" onClick={handleMove} disabled={!canMove}>
              {moving ? '移动中…' : '移动'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
