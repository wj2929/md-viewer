import { useEffect, useRef, useState } from 'react'
import type { WorkspaceDescriptor } from '../stores/workspaceStore'
import { getWorkspaceDisplayLabel } from '../utils/workspacePresentation'

interface WorkspaceRuntimeSummary {
  tabCount: number
  hasSplit: boolean
  hasDraft: boolean
  hasMeaningfulState: boolean
}

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceDescriptor[]
  activeWorkspaceId: string | null
  summaries?: Record<string, WorkspaceRuntimeSummary>
  onSelect: (workspaceId: string) => void
  onCloseActive?: () => void
  onSplitActive?: () => void
  onMergeOtherWindows?: (anchor: HTMLButtonElement | null) => void
  canMergeOtherWindows?: boolean
}

function getWorkspaceLabel(workspace: WorkspaceDescriptor): string {
  return getWorkspaceDisplayLabel(workspace)
}

function getWorkspacePath(workspace: WorkspaceDescriptor): string {
  if (!workspace.primaryRoot) return '尚未打开目录'
  const parts = workspace.primaryRoot.split(/[/\\]/).filter(Boolean)
  return parts.slice(-3).join(' / ')
}

function getWorkspaceStatus(summary?: WorkspaceRuntimeSummary): string {
  if (!summary) return '尚未恢复内容'
  const states = [`${summary.tabCount} 个标签`]
  if (summary.hasSplit) states.push('分屏')
  if (summary.hasDraft) states.push('有草稿')
  return states.join(' · ')
}

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, summaries = {}, onSelect, onCloseActive, onSplitActive, onMergeOtherWindows, canMergeOtherWindows = true }: WorkspaceSwitcherProps): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const activeRoot = active?.primaryRoot
  const uniqueWorkspaces = workspaces.filter((workspace) =>
    workspace.id === activeWorkspaceId || summaries[workspace.id]?.hasMeaningfulState
  )
  const duplicateRootCounts = uniqueWorkspaces.reduce<Record<string, number>>((counts, workspace) => {
    if (workspace.primaryRoot) counts[workspace.primaryRoot] = (counts[workspace.primaryRoot] || 0) + 1
    return counts
  }, {})

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (uniqueWorkspaces.length < 2) return null

  const label = active ? getWorkspaceLabel(active) : '空白会话'
  return (
    <div className="workspace-switcher" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-switcher-trigger"
        aria-label={`工作区：${label}，${uniqueWorkspaces.length} 个工作区。打开工作区菜单`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="workspace-switcher-icon" aria-hidden="true">▣</span>
        <span className="workspace-switcher-name">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div className="workspace-switcher-menu" role="menu" aria-label="工作区">
          <div className="workspace-switcher-section-label">当前会话</div>
          {active && <button
            type="button"
            role="menuitemradio"
            aria-checked="true"
            className="workspace-switcher-option active"
            onClick={() => setIsOpen(false)}
          >
            <span className="workspace-switcher-check" aria-hidden="true">✓</span>
            <span className="workspace-switcher-option-name">{getWorkspaceLabel(active)}</span>
            <span className="workspace-switcher-option-meta">{getWorkspacePath(active)} · {getWorkspaceStatus(summaries[active.id])}</span>
          </button>}
          {uniqueWorkspaces.some((workspace) => workspace.id !== activeWorkspaceId) && <>
            <div className="workspace-switcher-section-label">此窗口中的其他会话</div>
            {uniqueWorkspaces.filter((workspace) => workspace.id !== activeWorkspaceId).map((workspace) => {
              const duplicateRoot = workspace.primaryRoot && duplicateRootCounts[workspace.primaryRoot] > 1
              return <button
                key={workspace.id}
                type="button"
                role="menuitemradio"
                aria-checked="false"
                className="workspace-switcher-option"
                onClick={() => {
                  onSelect(workspace.id)
                  setIsOpen(false)
                }}
              >
                <span className="workspace-switcher-check" aria-hidden="true" />
                <span className="workspace-switcher-option-name">{getWorkspaceLabel(workspace)}{duplicateRoot ? ' · 另一个会话' : ''}</span>
                <span className="workspace-switcher-option-meta">{getWorkspacePath(workspace)} · {getWorkspaceStatus(summaries[workspace.id])}</span>
              </button>
            })}
          </>}
          {(canMergeOtherWindows && onMergeOtherWindows || onSplitActive || onCloseActive) && <>
            <div className="workspace-switcher-divider" />
            {canMergeOtherWindows && onMergeOtherWindows && <button
              type="button"
              role="menuitem"
              className="workspace-switcher-option"
              onClick={() => {
                setIsOpen(false)
                onMergeOtherWindows(triggerRef.current)
              }}
            >
              <span className="workspace-switcher-check" aria-hidden="true">⇥</span>
              <span className="workspace-switcher-option-name">合并其他窗口</span>
            </button>}
            {onSplitActive && <button
              type="button"
              role="menuitem"
              className="workspace-switcher-option"
              onClick={() => {
                onSplitActive()
                setIsOpen(false)
              }}
            >
              <span className="workspace-switcher-check" aria-hidden="true">↗</span>
              <span className="workspace-switcher-option-name">将当前工作区拆分为新窗口</span>
            </button>}
            {onCloseActive && <button
              type="button"
              role="menuitem"
              className="workspace-switcher-option workspace-switcher-close"
              onClick={() => {
                onCloseActive()
                setIsOpen(false)
              }}
            >
              <span className="workspace-switcher-check" aria-hidden="true">×</span>
              <span className="workspace-switcher-option-name">关闭当前工作区</span>
            </button>}
          </>}
        </div>
      )}
    </div>
  )
}
