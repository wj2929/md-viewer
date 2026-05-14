import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditDraftPersistence } from '../../src/hooks/useEditDraftPersistence'
import { EDIT_DRAFT_STORAGE_KEY } from '../../src/utils/editDraftPersistence'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

const persistedPayload = {
  version: 1,
  drafts: [{
    canonicalPath: '/real/docs/a.md',
    displayPath: '/docs/a.md',
    fileName: 'a.md',
    original: '# A',
    draft: '# Restored',
    draftVersion: 2,
    baseRevisionToken: '1000:12',
    lastKnownDiskRevisionToken: '1000:12',
    savedAt: 1700000000000,
  }],
}

describe('useEditDraftPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useEditSessionStore.getState().reset()
  })

  it('restores persisted dirty drafts on mount', () => {
    localStorage.setItem(EDIT_DRAFT_STORAGE_KEY, JSON.stringify(persistedPayload))

    renderHook(() => useEditDraftPersistence())

    expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].draft).toBe('# Restored')
  })

  it('persists dirty drafts and clears storage after save', () => {
    renderHook(() => useEditDraftPersistence())

    act(() => {
      useEditSessionStore.getState().openSession({
        canonicalPath: '/real/docs/a.md',
        displayPath: '/docs/a.md',
        fileName: 'a.md',
        content: '# A',
        mtimeMs: 1000,
        size: 12,
        revisionToken: '1000:12',
      })
      useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')
    })

    expect(localStorage.getItem(EDIT_DRAFT_STORAGE_KEY)).toContain('# B')

    act(() => {
      useEditSessionStore.getState().markSaved('/real/docs/a.md', '# B', '2000:3')
    })

    expect(localStorage.getItem(EDIT_DRAFT_STORAGE_KEY)).toBeNull()
  })
})
