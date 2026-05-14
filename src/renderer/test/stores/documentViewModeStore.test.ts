import { beforeEach, describe, expect, it } from 'vitest'
import { useDocumentViewModeStore } from '../../src/stores/documentViewModeStore'

describe('documentViewModeStore', () => {
  beforeEach(() => {
    useDocumentViewModeStore.getState().reset()
  })

  it('defaults every leaf and tab to preview', () => {
    expect(useDocumentViewModeStore.getState().getViewState('leaf-a', 'tab-a').mode).toBe('preview')
  })

  it('keeps mode scoped by leafId and tabId', () => {
    const store = useDocumentViewModeStore.getState()
    store.setMode('leaf-a', 'tab-a', 'compare')
    store.setMode('leaf-a', 'tab-b', 'edit')

    expect(useDocumentViewModeStore.getState().getViewState('leaf-a', 'tab-a').mode).toBe('compare')
    expect(useDocumentViewModeStore.getState().getViewState('leaf-a', 'tab-b').mode).toBe('edit')
    expect(useDocumentViewModeStore.getState().getViewState('leaf-b', 'tab-a').mode).toBe('preview')
  })

  it('stores quick edit targets without putting draft content in the view store', () => {
    const target = {
      filePath: '/docs/a.md',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      sourceLine: 12,
      mode: 'source-line' as const,
    }

    useDocumentViewModeStore.getState().setTarget('leaf-a', 'tab-a', target)

    expect(useDocumentViewModeStore.getState().getViewState('leaf-a', 'tab-a').target?.sourceLine).toBe(12)
    expect('draft' in useDocumentViewModeStore.getState().getViewState('leaf-a', 'tab-a')).toBe(false)
  })
})
