import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useQuickEditScrollSync } from '../hooks/useQuickEditScrollSync'
import { useEditSessionStore } from '../stores/editSessionStore'
import { useQuickEditPlacementStore } from '../stores/quickEditPlacementStore'
import type { QuickEditTarget } from '../utils/quickEditTarget'
import './QuickEditDrawer.css'

interface QuickEditDrawerProps {
  canonicalPath: string
  placementKey?: string
  previewElement?: HTMLElement | null
  target?: QuickEditTarget | null
  onSave: (canonicalPath: string, content: string, expectedRevisionToken: string, force: boolean) => Promise<void>
  onClose: () => void
  onReloadFromDisk?: (canonicalPath: string) => Promise<void>
  onCopyDraft?: (content: string) => void
}

export function QuickEditDrawer({
  canonicalPath,
  placementKey = 'single',
  previewElement = null,
  target = null,
  onSave,
  onClose,
  onReloadFromDisk,
  onCopyDraft,
}: QuickEditDrawerProps): JSX.Element | null {
  const session = useEditSessionStore(state => state.sessions[canonicalPath])
  const updateDraft = useEditSessionStore(state => state.updateDraft)
  const setSaving = useEditSessionStore(state => state.setSaving)
  const setError = useEditSessionStore(state => state.setError)
  const scrollSyncEnabled = useQuickEditPlacementStore(state => state.isScrollSyncEnabled(placementKey))
  const setScrollSyncEnabled = useQuickEditPlacementStore(state => state.setScrollSyncEnabled)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const drawerInstanceIdRef = useRef(`quick-edit-${Math.random().toString(36).slice(2)}`)

  const scrollSync = useQuickEditScrollSync({
    enabled: scrollSyncEnabled,
    placementKey,
    canonicalPath,
    drawerInstanceId: drawerInstanceIdRef.current,
    previewElement,
    textareaRef,
    content: session?.draft || '',
  })

  const targetLine = useMemo(() => {
    if (!session) return null
    const sourceContent = session.original
    if (target?.targetText) {
      const lines = sourceContent.split('\n')
      const preferredLine = target.sourceLine || target.targetLine
      const searchStart = preferredLine ? Math.max(0, preferredLine - 6) : 0
      const searchEnd = preferredLine ? Math.min(lines.length, preferredLine + 5) : lines.length
      const nearbyIndex = lines
        .slice(searchStart, searchEnd)
        .findIndex(line => line.includes(target.targetText || ''))
      if (nearbyIndex >= 0) return searchStart + nearbyIndex + 1

      const fallbackIndex = lines.findIndex(line => line.includes(target.targetText || ''))
      if (fallbackIndex >= 0) return fallbackIndex + 1
    }
    if (typeof target?.targetLine === 'number') return target.targetLine
    if (typeof target?.sourceLine === 'number') return target.sourceLine
    if (typeof target?.scrollRatio === 'number') {
      return Math.max(1, Math.round(sourceContent.split('\n').length * target.scrollRatio))
    }
    return null
  }, [session?.original, target])

  useEffect(() => {
    if (!targetLine || !textareaRef.current || !session) return
    const totalLines = Math.max(1, session.original.split('\n').length)
    const ratio = Math.max(0, Math.min(1, (targetLine - 1) / totalLines))
    textareaRef.current.scrollTop = ratio * textareaRef.current.scrollHeight
  }, [session?.original, targetLine])

  const handleClose = useCallback(() => {
    if (session?.dirty && !window.confirm('有未保存修改，确定关闭快速编辑吗？')) return
    onClose()
  }, [onClose, session?.dirty])

  const handleSave = useCallback(async (force = false) => {
    if (!session) return
    if (force && !window.confirm('磁盘版本已被外部修改。继续保存将覆盖外部修改，此操作不可撤销。建议先复制草稿备份。')) return

    setSaving(canonicalPath, true)
    try {
      await onSave(canonicalPath, session.draft, session.baseRevisionToken, force)
    } catch (error) {
      setError(canonicalPath, error instanceof Error ? error.message : '保存失败')
      setSaving(canonicalPath, false)
    }
  }, [canonicalPath, onSave, session, setError, setSaving])

  const handleDrawerKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (session?.dirty && !session.saving) void handleSave(false)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
    }
  }, [handleClose, handleSave, session?.dirty, session?.saving])

  if (!session) return null

  const hasConflict = Boolean(session.conflictReason)
  const hasExternalConflict = session.conflictReason === 'revision_changed' ||
    session.conflictReason === 'mtime_changed' ||
    session.conflictReason === 'external_changed'
  const showTargetLineFeedback = Boolean(targetLine && (!scrollSyncEnabled || scrollSync.status === 'unavailable'))
  const scrollSyncStatusText = scrollSyncEnabled
    ? scrollSync.status === 'unavailable'
      ? '当前预览暂不可同步'
      : scrollSync.status === 'paused'
        ? '输入中暂停反向同步'
        : scrollSync.status === 'approximate'
          ? '大致同步'
          : '已开启'
    : '默认关闭'

  return (
    <aside className="quick-edit-drawer" aria-label={`${session.fileName} 快速编辑`} onKeyDown={handleDrawerKeyDown}>
      <header className="quick-edit-header">
        <div>
          <strong>快速编辑</strong>
          <span className="quick-edit-file" title={session.displayPath}>{session.fileName}</span>
        </div>
        <button type="button" className="quick-edit-close" onClick={handleClose} aria-label="关闭快速编辑">×</button>
      </header>

      {showTargetLineFeedback && (
        <div className="quick-edit-location" role="status">
          已定位到第 {targetLine} 行附近
        </div>
      )}

      <div className="quick-edit-scroll-sync">
        <label>
          <input
            type="checkbox"
            role="switch"
            aria-label="同步当前预览区与快速编辑区滚动"
            checked={scrollSyncEnabled}
            onChange={event => setScrollSyncEnabled(placementKey, event.target.checked)}
          />
          <span>同步当前预览与快速编辑</span>
        </label>
        <span className="quick-edit-scroll-sync-status" aria-live="polite">
          {scrollSyncStatusText}
        </span>
      </div>

      {hasExternalConflict ? (
        <div className="quick-edit-warning" role="alert">
          <strong>文件已在外部变更</strong>
          <p>当前草稿尚未保存。继续保存会覆盖磁盘版本。</p>
          {onReloadFromDisk && (
            <button type="button" onClick={() => onReloadFromDisk(canonicalPath)}>
              重新载入磁盘版本（丢弃本地草稿）
            </button>
          )}
        </div>
      ) : null}

      {session.conflictReason === 'missing' || session.conflictReason === 'renamed' ? (
        <div className="quick-edit-warning" role="alert">
          <strong>磁盘文件已删除或路径已变更</strong>
          <p>当前草稿仍保留在内存中，但无法直接保存到原路径。</p>
        </div>
      ) : null}

      {session.error && (
        <div className="quick-edit-error" role="alert">
          <strong>保存失败</strong>
          <p>{session.error}</p>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="quick-edit-textarea"
        aria-label="Markdown 源码编辑区"
        value={session.draft}
        onChange={event => updateDraft(canonicalPath, event.target.value)}
        spellCheck={false}
      />

      <footer className="quick-edit-footer" aria-live="polite">
        <span className={session.dirty ? 'quick-edit-dirty' : 'quick-edit-clean'}>
          {session.saving ? '保存中…' : session.dirty ? '未保存' : '已同步'}
        </span>
        <div className="quick-edit-actions">
          <button type="button" onClick={() => onCopyDraft?.(session.draft)}>复制草稿</button>
          <button type="button" onClick={handleClose}>取消</button>
          {hasConflict && (
            <button type="button" className="quick-edit-danger" onClick={() => handleSave(true)} aria-label="保存并覆盖">
              保存并覆盖
            </button>
          )}
          <button type="button" onClick={() => handleSave(false)} disabled={!session.dirty || session.saving} aria-label="保存修改">
            {session.saving ? '保存中…' : '保存'}
          </button>
        </div>
      </footer>
    </aside>
  )
}
