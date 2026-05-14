import { beforeEach, describe, expect, it } from 'vitest'
import {
  EDIT_DRAFT_STORAGE_KEY,
  loadPersistedEditDrafts,
  savePersistedEditDrafts,
} from '../../src/utils/editDraftPersistence'
import type { PersistedEditDraft } from '../../src/stores/editSessionStore'

const draft: PersistedEditDraft = {
  canonicalPath: '/real/docs/a.md',
  displayPath: '/docs/a.md',
  fileName: 'a.md',
  original: '# A',
  draft: '# B',
  draftVersion: 2,
  baseRevisionToken: '1000:12',
  lastKnownDiskRevisionToken: '1000:12',
  savedAt: 1700000000000,
}

describe('editDraftPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and loads persisted edit drafts with a schema version', () => {
    savePersistedEditDrafts([draft])

    expect(JSON.parse(localStorage.getItem(EDIT_DRAFT_STORAGE_KEY) || '{}')).toMatchObject({
      version: 1,
      drafts: [expect.objectContaining({ canonicalPath: '/real/docs/a.md', draft: '# B' })],
    })
    expect(loadPersistedEditDrafts()).toEqual([draft])
  })

  it('clears storage when there are no dirty drafts', () => {
    savePersistedEditDrafts([draft])
    savePersistedEditDrafts([])

    expect(localStorage.getItem(EDIT_DRAFT_STORAGE_KEY)).toBeNull()
    expect(loadPersistedEditDrafts()).toEqual([])
  })

  it('ignores malformed persisted data', () => {
    localStorage.setItem(EDIT_DRAFT_STORAGE_KEY, '{bad json')

    expect(loadPersistedEditDrafts()).toEqual([])
  })
})
