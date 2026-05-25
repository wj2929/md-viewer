import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickEditDrawer } from '../../src/components/QuickEditDrawer'
import { useEditSessionStore } from '../../src/stores/editSessionStore'
import { useQuickEditPlacementStore } from '../../src/stores/quickEditPlacementStore'

const sessionInput = {
  canonicalPath: '/real/docs/a.md',
  displayPath: '/docs/a.md',
  fileName: 'a.md',
  content: '# A',
  mtimeMs: 1000,
  size: 12,
  revisionToken: '1000:12',
}

describe('QuickEditDrawer', () => {
  beforeEach(() => {
    useEditSessionStore.getState().reset()
    useQuickEditPlacementStore.getState().reset()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('updates draft and saves with expected revision token', async () => {
    useEditSessionStore.getState().openSession(sessionInput)
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Markdown 源码编辑区'), {
      target: { value: '# B' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('/real/docs/a.md', '# B', '1000:12', false)
    })
  })

  it('saves the dirty draft with Cmd/Ctrl+S inside the drawer', async () => {
    useEditSessionStore.getState().openSession(sessionInput)
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={onSave} onClose={vi.fn()} />)

    const editor = screen.getByLabelText('Markdown 源码编辑区')
    fireEvent.change(editor, {
      target: { value: '# B' },
    })
    fireEvent.keyDown(editor, { key: 's', metaKey: true })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('/real/docs/a.md', '# B', '1000:12', false)
    })
  })

  it('closes with Escape and keeps the dirty confirmation guard', () => {
    useEditSessionStore.getState().openSession(sessionInput)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')
    const onClose = vi.fn()

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByLabelText('Markdown 源码编辑区'), { key: 'Escape' })

    expect(window.confirm).toHaveBeenCalledWith('有未保存修改，确定关闭快速编辑吗？')
    expect(onClose).toHaveBeenCalled()
  })

  it('confirms before closing a dirty draft', () => {
    useEditSessionStore.getState().openSession(sessionInput)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')
    const onClose = vi.fn()

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭快速编辑' }))

    expect(window.confirm).toHaveBeenCalledWith('有未保存修改，确定关闭快速编辑吗？')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows conflict actions without discarding the draft', () => {
    useEditSessionStore.getState().openSession(sessionInput)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Local Draft')
    useEditSessionStore.getState().markConflict('/real/docs/a.md', 'revision_changed', '2000:20')

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('文件已在外部变更')).toBeInTheDocument()
    expect(screen.getByDisplayValue('# Local Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存并覆盖' })).toBeInTheDocument()
  })

  it('confirms before force saving a conflicting draft', async () => {
    useEditSessionStore.getState().openSession(sessionInput)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Local Draft')
    useEditSessionStore.getState().markConflict('/real/docs/a.md', 'revision_changed', '2000:20')
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<QuickEditDrawer canonicalPath="/real/docs/a.md" onSave={onSave} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '保存并覆盖' }))

    expect(window.confirm).toHaveBeenCalledWith('磁盘版本已被外部修改。继续保存将覆盖外部修改，此操作不可撤销。建议先复制草稿备份。')
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('/real/docs/a.md', '# Local Draft', '1000:12', true)
    })
  })

  it('shows nearby line feedback for a quick edit target', () => {
    useEditSessionStore.getState().openSession({
      ...sessionInput,
      content: ['# A', '', '段落一', '段落二'].join('\n'),
    })

    render(
      <QuickEditDrawer
        canonicalPath="/real/docs/a.md"
        target={{ filePath: '/docs/a.md', tabId: 'tab-a', targetLine: 3, mode: 'source-line' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('已定位到第 3 行附近')).toBeInTheDocument()
  })

  it('does not re-scroll the editor while typing after target positioning', () => {
    const content = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    useEditSessionStore.getState().openSession({
      ...sessionInput,
      content,
    })

    render(
      <QuickEditDrawer
        canonicalPath="/real/docs/a.md"
        target={{ filePath: '/docs/a.md', tabId: 'tab-a', targetLine: 50, mode: 'source-line' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const editor = screen.getByLabelText('Markdown 源码编辑区') as HTMLTextAreaElement
    Object.defineProperty(editor, 'scrollHeight', { value: 2400, configurable: true })
    Object.defineProperty(editor, 'clientHeight', { value: 400, configurable: true })
    editor.scrollTop = 320

    fireEvent.change(editor, {
      target: { value: `${content}\n新增内容` },
    })

    expect(editor.scrollTop).toBe(320)
  })

  it('shows scroll sync as an opt-in switch scoped to the current preview', () => {
    useEditSessionStore.getState().openSession(sessionInput)
    const previewElement = document.createElement('div')

    render(
      <QuickEditDrawer
        canonicalPath="/real/docs/a.md"
        placementKey="single"
        previewElement={previewElement}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const switchControl = screen.getByRole('switch', { name: '同步当前预览区与快速编辑区滚动' })
    expect(switchControl).not.toBeChecked()

    fireEvent.click(switchControl)

    expect(switchControl).toBeChecked()
    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('single')).toBe(true)
  })

  it('hides one-time location feedback when scroll sync is active', () => {
    useEditSessionStore.getState().openSession({
      ...sessionInput,
      content: ['# A', '', '段落一'].join('\n'),
    })
    const previewElement = document.createElement('div')

    render(
      <QuickEditDrawer
        canonicalPath="/real/docs/a.md"
        placementKey="single"
        previewElement={previewElement}
        target={{ filePath: '/docs/a.md', tabId: 'tab-a', targetLine: 1, mode: 'source-line' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('已定位到第 1 行附近')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: '同步当前预览区与快速编辑区滚动' }))

    expect(screen.queryByText('已定位到第 1 行附近')).not.toBeInTheDocument()
  })

  it('explains when scroll sync cannot start without a preview container', () => {
    useEditSessionStore.getState().openSession(sessionInput)

    render(
      <QuickEditDrawer
        canonicalPath="/real/docs/a.md"
        placementKey="single"
        previewElement={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: '同步当前预览区与快速编辑区滚动' }))

    expect(screen.getByText('当前预览暂不可同步')).toBeInTheDocument()
  })
})
