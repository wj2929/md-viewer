import { beforeEach, describe, expect, it } from 'vitest'
import { useEditSessionStore } from '../../src/stores/editSessionStore'

const baseSession = {
  canonicalPath: '/real/docs/a.md',
  displayPath: '/docs/a.md',
  fileName: 'a.md',
  content: '# A',
  mtimeMs: 1000,
  size: 12,
  revisionToken: '1000:12',
}

describe('editSessionStore', () => {
  beforeEach(() => {
    useEditSessionStore.getState().reset()
  })

  it('opens a clean session keyed by canonicalPath', () => {
    useEditSessionStore.getState().openSession(baseSession)

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.original).toBe('# A')
    expect(session.draft).toBe('# A')
    expect(session.dirty).toBe(false)
    expect(session.baseRevisionToken).toBe('1000:12')
  })

  it('marks session dirty when draft changes', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    expect(useEditSessionStore.getState().sessions['/real/docs/a.md'].dirty).toBe(true)
  })

  it('marks session clean after successful save', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')
    useEditSessionStore.getState().markSaved('/real/docs/a.md', '# B', '2000:3')

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.original).toBe('# B')
    expect(session.draft).toBe('# B')
    expect(session.dirty).toBe(false)
    expect(session.baseRevisionToken).toBe('2000:3')
    expect(session.conflictReason).toBeNull()
  })

  it('records conflicts without discarding the draft', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Local Draft')
    useEditSessionStore.getState().setSaving('/real/docs/a.md', true)
    useEditSessionStore.getState().markConflict('/real/docs/a.md', 'revision_changed', '3000:20')

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.draft).toBe('# Local Draft')
    expect(session.dirty).toBe(true)
    expect(session.saving).toBe(false)
    expect(session.conflictReason).toBe('revision_changed')
    expect(session.lastKnownDiskRevisionToken).toBe('3000:20')
  })

  it('keeps draft dirty when saved snapshot differs from the current draft', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')
    useEditSessionStore.getState().markSaved('/real/docs/a.md', '# Saved snapshot', '2000:16')

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.original).toBe('# Saved snapshot')
    expect(session.draft).toBe('# B')
    expect(session.dirty).toBe(true)
  })

  it('allows only one writer per canonical path', () => {
    useEditSessionStore.getState().openSession(baseSession)

    expect(useEditSessionStore.getState().claimWriter('/real/docs/a.md', 'leaf-a:tab-a')).toBe(true)
    expect(useEditSessionStore.getState().claimWriter('/real/docs/a.md', 'leaf-b:tab-a')).toBe(false)

    useEditSessionStore.getState().releaseWriter('/real/docs/a.md', 'leaf-a:tab-a')
    expect(useEditSessionStore.getState().claimWriter('/real/docs/a.md', 'leaf-b:tab-a')).toBe(true)
  })

  it('increments draftVersion on draft updates', () => {
    useEditSessionStore.getState().openSession(baseSession)
    const before = useEditSessionStore.getState().sessions['/real/docs/a.md'].draftVersion

    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B', { writerId: null })

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.draftVersion).toBe(before + 1)
    expect(session.status).toBe('dirty')
  })

  it('records explicit undo history and redoes reverted draft changes', () => {
    useEditSessionStore.getState().openSession(baseSession)

    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B', { recordUndo: true })
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# C', { recordUndo: true })

    let session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.draft).toBe('# C')
    expect(session.undoStack).toEqual(['# A', '# B'])
    expect(session.redoStack).toEqual([])

    expect(useEditSessionStore.getState().undoDraft('/real/docs/a.md')).toBe(true)
    session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.draft).toBe('# B')
    expect(session.undoStack).toEqual(['# A'])
    expect(session.redoStack).toEqual(['# C'])

    expect(useEditSessionStore.getState().redoDraft('/real/docs/a.md')).toBe(true)
    session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.draft).toBe('# C')
    expect(session.undoStack).toEqual(['# A', '# B'])
    expect(session.redoStack).toEqual([])
  })

  it('does not record undo history for ordinary source editor typing', () => {
    useEditSessionStore.getState().openSession(baseSession)

    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B')

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.undoStack).toEqual([])
    expect(useEditSessionStore.getState().undoDraft('/real/docs/a.md')).toBe(false)
  })

  it('does not mark clean when saved version is older than current draftVersion', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# B', { writerId: null })
    const snapshot = useEditSessionStore.getState().createSaveSnapshot('/real/docs/a.md', '# B')
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# C', { writerId: null })

    useEditSessionStore.getState().markSaved('/real/docs/a.md', snapshot.content, '2000:3', snapshot.draftVersion)

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.original).toBe('# B')
    expect(session.draft).toBe('# C')
    expect(session.dirty).toBe(true)
    expect(session.status).toBe('dirty')
  })

  it('exports only dirty sessions for crash recovery', () => {
    useEditSessionStore.getState().openSession(baseSession)
    useEditSessionStore.getState().updateDraft('/real/docs/a.md', '# Recovered draft')
    useEditSessionStore.getState().claimWriter('/real/docs/a.md', 'leaf-a:tab-a')
    useEditSessionStore.getState().setSaving('/real/docs/a.md', true)

    const drafts = useEditSessionStore.getState().exportPersistedDrafts()

    expect(drafts).toEqual([expect.objectContaining({
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      original: '# A',
      draft: '# Recovered draft',
      baseRevisionToken: '1000:12',
    })])
    expect(drafts[0]).not.toHaveProperty('writerId')
    expect(drafts[0]).not.toHaveProperty('saving')
  })

  it('restores dirty sessions without reviving runtime-only state', () => {
    useEditSessionStore.getState().restorePersistedDrafts([{
      canonicalPath: '/real/docs/a.md',
      displayPath: '/docs/a.md',
      fileName: 'a.md',
      original: '# A',
      draft: '# Recovered draft',
      draftVersion: 3,
      baseRevisionToken: '1000:12',
      lastKnownDiskRevisionToken: '1000:12',
      savedAt: 1700000000000,
    }])

    const session = useEditSessionStore.getState().sessions['/real/docs/a.md']
    expect(session.dirty).toBe(true)
    expect(session.status).toBe('dirty')
    expect(session.writerId).toBeNull()
    expect(session.saving).toBe(false)
    expect(session.error).toBeNull()
    expect(session.draft).toBe('# Recovered draft')
  })
})
