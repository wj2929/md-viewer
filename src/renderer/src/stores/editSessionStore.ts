import { create } from 'zustand'

export type EditConflictReason = 'revision_changed' | 'mtime_changed' | 'external_changed' | 'missing' | 'renamed'

export interface OpenEditSessionInput {
  canonicalPath: string
  displayPath: string
  fileName: string
  content: string
  mtimeMs: number
  size?: number
  revisionToken: string
}

export interface EditSession {
  canonicalPath: string
  displayPath: string
  fileName: string
  original: string
  draft: string
  dirty: boolean
  saving: boolean
  error: string | null
  baseRevisionToken: string
  lastKnownDiskRevisionToken: string | null
  conflictReason: EditConflictReason | null
}

interface EditSessionState {
  sessions: Record<string, EditSession>
  openSession: (input: OpenEditSessionInput) => void
  closeSession: (canonicalPath: string) => void
  updateDraft: (canonicalPath: string, draft: string) => void
  setSaving: (canonicalPath: string, saving: boolean) => void
  setError: (canonicalPath: string, error: string | null) => void
  markSaved: (canonicalPath: string, content: string, revisionToken: string) => void
  markConflict: (canonicalPath: string, reason: EditConflictReason, diskRevisionToken?: string) => void
  replaceFromDisk: (canonicalPath: string, content: string, revisionToken: string) => void
  reset: () => void
}

export const useEditSessionStore = create<EditSessionState>((set, get) => ({
  sessions: {},

  openSession: (input) => {
    const existing = get().sessions[input.canonicalPath]
    if (existing) return

    set(state => ({
      sessions: {
        ...state.sessions,
        [input.canonicalPath]: {
          canonicalPath: input.canonicalPath,
          displayPath: input.displayPath,
          fileName: input.fileName,
          original: input.content,
          draft: input.content,
          dirty: false,
          saving: false,
          error: null,
          baseRevisionToken: input.revisionToken,
          lastKnownDiskRevisionToken: input.revisionToken,
          conflictReason: null,
        },
      },
    }))
  },

  closeSession: (canonicalPath) => {
    set(state => {
      const sessions = { ...state.sessions }
      delete sessions[canonicalPath]
      return { sessions }
    })
  },

  updateDraft: (canonicalPath, draft) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            draft,
            dirty: draft !== session.original,
            error: null,
          },
        },
      }
    })
  },

  setSaving: (canonicalPath, saving) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: { ...session, saving },
        },
      }
    })
  },

  setError: (canonicalPath, error) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: { ...session, error },
        },
      }
    })
  },

  markSaved: (canonicalPath, content, revisionToken) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state
      const currentDraft = session.draft
      const draftChangedAfterSnapshot = currentDraft !== content

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            original: content,
            draft: draftChangedAfterSnapshot ? currentDraft : content,
            dirty: draftChangedAfterSnapshot,
            saving: false,
            error: null,
            baseRevisionToken: revisionToken,
            lastKnownDiskRevisionToken: revisionToken,
            conflictReason: null,
          },
        },
      }
    })
  },

  markConflict: (canonicalPath, reason, diskRevisionToken) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            saving: false,
            conflictReason: reason,
            lastKnownDiskRevisionToken: diskRevisionToken ?? session.lastKnownDiskRevisionToken,
          },
        },
      }
    })
  },

  replaceFromDisk: (canonicalPath, content, revisionToken) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            original: content,
            draft: content,
            dirty: false,
            error: null,
            baseRevisionToken: revisionToken,
            lastKnownDiskRevisionToken: revisionToken,
            conflictReason: null,
          },
        },
      }
    })
  },

  reset: () => set({ sessions: {} }),
}))
