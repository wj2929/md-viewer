import type { PersistedEditDraft } from '../stores/editSessionStore'

export const EDIT_DRAFT_STORAGE_KEY = 'md-viewer:markdown-edit-drafts'

interface PersistedEditDraftPayload {
  version: 1
  drafts: PersistedEditDraft[]
}

function isPersistedDraft(value: unknown): value is PersistedEditDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<PersistedEditDraft>
  return typeof draft.canonicalPath === 'string' &&
    typeof draft.displayPath === 'string' &&
    typeof draft.fileName === 'string' &&
    typeof draft.original === 'string' &&
    typeof draft.draft === 'string' &&
    typeof draft.draftVersion === 'number' &&
    typeof draft.baseRevisionToken === 'string' &&
    typeof draft.savedAt === 'number'
}

export function loadPersistedEditDrafts(storage: Storage = localStorage): PersistedEditDraft[] {
  try {
    const raw = storage.getItem(EDIT_DRAFT_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as Partial<PersistedEditDraftPayload>
    if (parsed.version !== 1 || !Array.isArray(parsed.drafts)) return []
    return parsed.drafts.filter(isPersistedDraft)
  } catch {
    return []
  }
}

export function savePersistedEditDrafts(drafts: PersistedEditDraft[], storage: Storage = localStorage): void {
  if (drafts.length === 0) {
    storage.removeItem(EDIT_DRAFT_STORAGE_KEY)
    return
  }

  const payload: PersistedEditDraftPayload = {
    version: 1,
    drafts,
  }
  storage.setItem(EDIT_DRAFT_STORAGE_KEY, JSON.stringify(payload))
}
