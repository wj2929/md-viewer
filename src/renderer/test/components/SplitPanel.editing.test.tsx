import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SplitPanel } from '../../src/components/SplitPanel'
import type { Tab } from '../../src/components/TabBar'
import type { PanelNode } from '../../src/utils/splitTree'
import { useEditSessionStore } from '../../src/stores/editSessionStore'
import { useQuickEditPlacementStore } from '../../src/stores/quickEditPlacementStore'

vi.mock('../../src/components/VirtualizedMarkdown', () => ({
  VirtualizedMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../../src/components/FloatingNav', () => ({
  default: () => null,
}))

const tabs: Tab[] = [
  { id: 'tab-a', file: { name: 'a.md', path: '/docs/a.md', isDirectory: false }, content: '# A' },
  { id: 'tab-b', file: { name: 'b.md', path: '/docs/b.md', isDirectory: false }, content: '# B' },
]

const root: PanelNode = {
  type: 'split',
  id: 'split-1',
  direction: 'horizontal',
  ratio: 0.5,
  first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
  second: { type: 'leaf', id: 'leaf-b', tabId: 'tab-b' },
}

describe('SplitPanel lightweight editing', () => {
  beforeEach(() => {
    useEditSessionStore.getState().reset()
    useQuickEditPlacementStore.getState().reset()
  })

  it('does not show a header quick edit button', () => {
    render(
      <SplitPanel
        node={root}
        tabs={tabs}
        activeLeafId="leaf-a"
        onSplitPanel={vi.fn()}
        onClosePanel={vi.fn()}
        onResizePanel={vi.fn()}
        onSetActiveLeaf={vi.fn()}
        onImageClick={vi.fn()}
        onDropTab={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '快速编辑 b.md' })).not.toBeInTheDocument()
  })

  it('renders the quick edit drawer inside the matching split panel after a session opens', () => {
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/b.md',
      displayPath: '/docs/b.md',
      fileName: 'b.md',
      content: '# B',
      mtimeMs: 1000,
      size: 3,
      revisionToken: '1000:3',
    })

    render(
      <SplitPanel
        node={root}
        tabs={tabs}
        activeLeafId="leaf-a"
        onSplitPanel={vi.fn()}
        onClosePanel={vi.fn()}
        onResizePanel={vi.fn()}
        onSetActiveLeaf={vi.fn()}
        onImageClick={vi.fn()}
        onDropTab={vi.fn()}
        getQuickEditCanonicalPath={(tab) => tab.file.path === '/docs/b.md' ? '/real/docs/b.md' : null}
        onSaveQuickEdit={vi.fn()}
        onCloseQuickEdit={vi.fn()}
      />
    )

    expect(screen.getByLabelText('b.md 快速编辑')).toBeInTheDocument()
  })

  it('renders the draft content in the matching split preview while editing', () => {
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/b.md',
      displayPath: '/docs/b.md',
      fileName: 'b.md',
      content: '# B',
      mtimeMs: 1000,
      size: 3,
      revisionToken: '1000:3',
    })
    useEditSessionStore.getState().updateDraft('/real/docs/b.md', '# B draft')

    render(
      <SplitPanel
        node={root}
        tabs={tabs}
        activeLeafId="leaf-b"
        onSplitPanel={vi.fn()}
        onClosePanel={vi.fn()}
        onResizePanel={vi.fn()}
        onSetActiveLeaf={vi.fn()}
        onImageClick={vi.fn()}
        onDropTab={vi.fn()}
        getQuickEditCanonicalPath={(tab) => tab.file.path === '/docs/b.md' ? '/real/docs/b.md' : null}
        onSaveQuickEdit={vi.fn()}
        onCloseQuickEdit={vi.fn()}
      />
    )

    const preview = document.querySelector('.split-panel-content.with-quick-edit .preview')
    expect(preview).toBeInTheDocument()
    expect(within(preview as HTMLElement).getByText('# B draft')).toBeInTheDocument()
    expect(screen.getByText('草稿预览，未保存')).toBeInTheDocument()
  })

  it('passes the matching split preview element to the quick edit drawer scroll sync', () => {
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/b.md',
      displayPath: '/docs/b.md',
      fileName: 'b.md',
      content: '# B',
      mtimeMs: 1000,
      size: 3,
      revisionToken: '1000:3',
    })

    render(
      <SplitPanel
        node={root}
        tabs={tabs}
        activeLeafId="leaf-b"
        onSplitPanel={vi.fn()}
        onClosePanel={vi.fn()}
        onResizePanel={vi.fn()}
        onSetActiveLeaf={vi.fn()}
        onImageClick={vi.fn()}
        onDropTab={vi.fn()}
        getQuickEditCanonicalPath={(tab) => tab.file.path === '/docs/b.md' ? '/real/docs/b.md' : null}
        onSaveQuickEdit={vi.fn()}
        onCloseQuickEdit={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: '同步当前预览区与快速编辑区滚动' }))

    expect(screen.queryByText('当前预览暂不可同步')).not.toBeInTheDocument()
    expect(useQuickEditPlacementStore.getState().isScrollSyncEnabled('leaf-b')).toBe(true)
  })

  it('renders the compare workbench for the matching leaf and tab mode', () => {
    useEditSessionStore.getState().openSession({
      canonicalPath: '/real/docs/b.md',
      displayPath: '/docs/b.md',
      fileName: 'b.md',
      content: '# B',
      mtimeMs: 1000,
      size: 3,
      revisionToken: '1000:3',
    })

    render(
      <SplitPanel
        node={root}
        tabs={tabs}
        activeLeafId="leaf-b"
        onSplitPanel={vi.fn()}
        onClosePanel={vi.fn()}
        onResizePanel={vi.fn()}
        onSetActiveLeaf={vi.fn()}
        onImageClick={vi.fn()}
        onDropTab={vi.fn()}
        getDocumentViewMode={(leafId, tabId) => leafId === 'leaf-b' && tabId === 'tab-b' ? 'compare' : 'preview'}
        onDocumentViewModeChange={vi.fn()}
        getQuickEditCanonicalPath={(tab) => tab.file.path === '/docs/b.md' ? '/real/docs/b.md' : null}
        onOpenMarkdownEdit={vi.fn()}
        onSaveQuickEdit={vi.fn()}
        onCloseQuickEdit={vi.fn()}
        onReloadQuickEdit={vi.fn()}
        onCopyDraft={vi.fn()}
      />
    )

    expect(screen.getByLabelText('b.md 编辑工作区')).toBeInTheDocument()
    expect(screen.queryByLabelText('b.md 快速编辑')).not.toBeInTheDocument()
  })
})
