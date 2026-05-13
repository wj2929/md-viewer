import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditWorkbench } from '../../src/components/editor/MarkdownEditWorkbench'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

vi.mock('../../src/components/VirtualizedMarkdown', () => ({
  VirtualizedMarkdown: ({ content }: { content: string }) => <div data-testid="draft-preview">{content}</div>,
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
    expect(screen.getByText('草稿预览，未保存到磁盘')).toBeInTheDocument()
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
