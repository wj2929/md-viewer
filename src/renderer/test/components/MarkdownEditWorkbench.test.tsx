import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditWorkbench } from '../../src/components/editor/MarkdownEditWorkbench'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

vi.mock('../../src/components/VirtualizedMarkdown', () => ({
  VirtualizedMarkdown: ({
    content,
    previewEditingEnabled,
    onPreviewBlockEdit,
  }: {
    content: string
    previewEditingEnabled?: boolean
    onPreviewBlockEdit?: (edit: {
      sourceLine: number
      sourceEndLine?: number
      originalText: string
      nextText: string
      editKind?: 'block' | 'table-cell' | 'code-block'
      tableCellIndex?: number
    }) => void
  }) => (
    <div data-testid="draft-preview" data-preview-editing-enabled={previewEditingEnabled ? 'true' : 'false'}>
      {content}
      <button
        type="button"
        onClick={() => onPreviewBlockEdit?.({ sourceLine: 2, originalText: 'old', nextText: 'new' })}
      >
        mock preview block edit
      </button>
      <button
        type="button"
        onClick={() => onPreviewBlockEdit?.({
          sourceLine: 3,
          originalText: '完成',
          nextText: '处理中',
          editKind: 'table-cell',
          tableCellIndex: 1,
        })}
      >
        mock table cell edit
      </button>
      <button
        type="button"
        onClick={() => onPreviewBlockEdit?.({
          sourceLine: 1,
          sourceEndLine: 3,
          originalText: 'BaseUrl: http://api.polyv.net/',
          nextText: 'BaseUrl: https://api.polyv.net/',
          editKind: 'code-block',
        })}
      >
        mock code block edit
      </button>
    </div>
  ),
}))

vi.mock('../../src/components/FloatingNav', () => ({
  default: () => null,
}))

const tab = {
  id: 'tab-a',
  file: { name: 'a.md', path: '/docs/a.md', isDirectory: false },
  content: '# A',
}

describe('MarkdownEditWorkbench', () => {
  beforeEach(() => {
    useEditSessionStore.getState().reset()
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      content: '# A',
      mtimeMs: 1000,
      size: 3,
      revisionToken: '1000:3',
    })
  })

  it('renders editor and draft preview in compare mode', () => {
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# A draft', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Markdown 源码编辑区' })).toBeInTheDocument()
    expect(screen.getByTestId('draft-preview')).toHaveTextContent('# A draft')
    expect(screen.getByTestId('draft-preview')).toHaveAttribute('data-preview-editing-enabled', 'true')
    expect(screen.getByText('草稿预览，未保存到磁盘')).toBeInTheDocument()
  })

  it('enables scroll sync controls only in compare mode', () => {
    const { rerender } = render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    expect(screen.getByRole('checkbox', { name: '同步编辑区与预览区滚动' })).toBeChecked()

    rerender(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="edit"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    expect(screen.queryByRole('checkbox', { name: '同步编辑区与预览区滚动' })).not.toBeInTheDocument()
  })

  it('keeps rendered preview read-only in preview mode', () => {
    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="preview"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    expect(screen.getByTestId('draft-preview')).toHaveAttribute('data-preview-editing-enabled', 'false')
  })

  it('shows an explicit exit edit mode action outside preview mode', async () => {
    const onModeChange = vi.fn()

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={onModeChange}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '退出编辑模式' }))

    await waitFor(() => {
      expect(onModeChange).toHaveBeenCalledWith('preview')
    })
  })

  it('discards an unsaved draft after confirmation and returns to preview', async () => {
    const onModeChange = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Unsaved', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={onModeChange}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '放弃编辑' }))

    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md']).toBeUndefined()
      expect(onModeChange).toHaveBeenCalledWith('preview')
    })
  })

  it('keeps an unsaved draft when discard is cancelled', () => {
    const onModeChange = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Unsaved', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={onModeChange}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '放弃编辑' }))

    expect(useEditSessionStore.getState().sessions['/real/docs/a.md']).toBeDefined()
    expect(onModeChange).not.toHaveBeenCalledWith('preview')
  })

  it('writes rendered preview block edits back to the draft source line', async () => {
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# A\nold', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'mock preview block edit' }))

    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe('# A\nnew')
    })
  })

  it('undoes and redoes rendered preview edits from keyboard shortcuts', async () => {
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# A\nold', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'mock preview block edit' }))
    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe('# A\nnew')
    })

    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe('# A\nold')
    })

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe('# A\nnew')
    })
  })

  it('does not intercept undo shortcuts from the source editor', async () => {
    const undoDraft = vi.spyOn(useEditSessionStore.getState(), 'undoDraft')

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    const editor = document.querySelector('.cm-editor') as HTMLElement
    fireEvent.keyDown(editor, { key: 'z', metaKey: true })

    expect(undoDraft).not.toHaveBeenCalled()
  })

  it('writes rendered table cell edits back to the matching markdown table cell', async () => {
    useEditSessionStore.getState().updateDraft(
      '/real/docs/a.md',
      '| 数据 | 状态 |\n| --- | --- |\n| 频道汇总统计 | 完成 |',
      { writerId: null }
    )

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'mock table cell edit' }))

    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe(
        '| 数据 | 状态 |\n| --- | --- |\n| 频道汇总统计 | 处理中 |'
      )
    })
  })

  it('writes rendered code block edits back inside the original fence', async () => {
    useEditSessionStore.getState().updateDraft(
      '/real/docs/a.md',
      '```text\nBaseUrl: http://api.polyv.net/\n```',
      { writerId: null }
    )

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'mock code block edit' }))

    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe(
        '```text\nBaseUrl: https://api.polyv.net/\n```'
      )
    })
  })

  it('uses current editor content when saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B', { writerId: null })

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={onSave}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('/real/docs/a.md', '# B', '1000:3', false, expect.any(Number))
    })
  })

  it('persists compare ratio changes from the separator keyboard control', () => {
    const onCompareRatioChange = vi.fn()

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={onCompareRatioChange}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.keyDown(screen.getByRole('separator', { name: '调整编辑和预览宽度' }), { key: 'ArrowRight' })

    expect(onCompareRatioChange).toHaveBeenCalledWith(0.55)
  })

  it.each([
    ['加粗', '**文本**# A'],
    ['斜体', '*文本*# A'],
    ['行内代码', '`文本`# A'],
    ['链接', '[链接文本](https://example.com)# A'],
    ['二级标题', '## # A'],
    ['无序列表', '- # A'],
    ['引用', '> # A'],
    ['代码块', '```\ncode\n```# A'],
  ])('applies the %s toolbar action to the draft', async (buttonName, expectedDraft) => {
    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    await waitFor(() => {
      expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe(expectedDraft)
    })
  })

  it('shows clear conflict guidance when disk changed externally', () => {
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Local draft')
    useEditSessionStore.getState().markConflict('/real/docs/a.md', 'external_changed', '2000:20')

    render(
      <MarkdownEditWorkbench
        tab={tab}
        leafId="single"
        canonicalPath="/real/docs/a.md"
        mode="compare"
        compareRatio={0.5}
        target={null}
        onModeChange={vi.fn()}
        onCompareRatioChange={vi.fn()}
        onSave={vi.fn()}
        onCopyDraft={vi.fn()}
        onReloadFromDisk={vi.fn()}
        onLocateComplete={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('磁盘文件已被外部修改')
    expect(screen.getByRole('alert')).toHaveTextContent('当前草稿仍保留')
    expect(screen.getByRole('button', { name: '复制草稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存并覆盖' })).toBeInTheDocument()
  })
})
