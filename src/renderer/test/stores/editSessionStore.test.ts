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
})
