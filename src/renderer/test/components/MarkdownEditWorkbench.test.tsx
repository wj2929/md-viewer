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
        target={null}
        onModeChange={vi.fn()}
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
        target={null}
        onModeChange={vi.fn()}
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
})
