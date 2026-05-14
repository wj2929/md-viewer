import { create } from 'zustand'

export type EditConflictReason = 'revision_changed' | 'mtime_changed' | 'external_changed' | 'missing' | 'renamed'
export type EditSessionStatus = 'ready' | 'dirty' | 'saving' | 'conflict' | 'error' | 'missing'

export interface SaveSnapshot {
  canonicalPath: string
  content: string
  draftVersion: number
  expectedRevisionToken: string
}

export interface PersistedEditDraft {
  canonicalPath: string
  displayPath: string
  fileName: string
  original: string
  draft: string
  draftVersion: number
  baseRevisionToken: string
  lastKnownDiskRevisionToken: string | null
  savedAt: number
}

export interface UpdateDraftOptions {
  writerId?: string | null
  recordUndo?: boolean
}

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
  status: EditSessionStatus
  original: string
  draft: string
  draftVersion: number
  writerId: string | null
  dirty: boolean
  saving: boolean
  error: string | null
  baseRevisionToken: string
  lastKnownDiskRevisionToken: string | null
  conflictReason: EditConflictReason | null
  undoStack: string[]
  redoStack: string[]
}

interface EditSessionState {
  sessions: Record<string, EditSession>
  openSession: (input: OpenEditSessionInput) => void
  closeSession: (canonicalPath: string) => void
  updateDraft: (canonicalPath: string, draft: string, options?: UpdateDraftOptions) => void
  undoDraft: (canonicalPath: string) => boolean
  redoDraft: (canonicalPath: string) => boolean
  claimWriter: (canonicalPath: string, writerId: string) => boolean
  releaseWriter: (canonicalPath: string, writerId: string) => void
  createSaveSnapshot: (canonicalPath: string, content?: string) => SaveSnapshot
  setSaving: (canonicalPath: string, saving: boolean) => void
  setError: (canonicalPath: string, error: string | null) => void
  markSaved: (canonicalPath: string, content: string, revisionToken: string, savedDraftVersion?: number) => void
  markConflict: (canonicalPath: string, reason: EditConflictReason, diskRevisionToken?: string) => void
  replaceFromDisk: (canonicalPath: string, content: string, revisionToken: string) => void
  exportPersistedDrafts: () => PersistedEditDraft[]
  restorePersistedDrafts: (drafts: PersistedEditDraft[]) => void
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
          status: 'ready',
          original: input.content,
          draft: input.content,
          draftVersion: 0,
          writerId: null,
          dirty: false,
          saving: false,
          error: null,
          baseRevisionToken: input.revisionToken,
          lastKnownDiskRevisionToken: input.revisionToken,
          conflictReason: null,
          undoStack: [],
          redoStack: [],
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

  updateDraft: (canonicalPath, draft, options = {}) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state
      if (options.writerId && session.writerId && session.writerId !== options.writerId) return state
      if (draft === session.draft) return state

      const dirty = draft !== session.original
      const undoStack = options.recordUndo
        ? [...session.undoStack, session.draft].slice(-100)
        : session.undoStack

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            draft,
            draftVersion: session.draftVersion + 1,
            dirty,
            status: dirty ? 'dirty' : 'ready',
            error: null,
            undoStack,
            redoStack: options.recordUndo ? [] : session.redoStack,
          },
        },
      }
    })
  },

  undoDraft: (canonicalPath) => {
    const session = get().sessions[canonicalPath]
    if (!session || session.undoStack.length === 0) return false
    const previousDraft = session.undoStack[session.undoStack.length - 1]
    const dirty = previousDraft !== session.original

    set(state => {
      const current = state.sessions[canonicalPath]
      if (!current || current.undoStack.length === 0) return state
      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...current,
            draft: previousDraft,
            draftVersion: current.draftVersion + 1,
            dirty,
            status: dirty ? 'dirty' : 'ready',
            error: null,
            undoStack: current.undoStack.slice(0, -1),
            redoStack: [...current.redoStack, current.draft].slice(-100),
          },
        },
      }
    })
    return true
  },

  redoDraft: (canonicalPath) => {
    const session = get().sessions[canonicalPath]
    if (!session || session.redoStack.length === 0) return false
    const nextDraft = session.redoStack[session.redoStack.length - 1]
    const dirty = nextDraft !== session.original

    set(state => {
      const current = state.sessions[canonicalPath]
      if (!current || current.redoStack.length === 0) return state
      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...current,
            draft: nextDraft,
            draftVersion: current.draftVersion + 1,
            dirty,
            status: dirty ? 'dirty' : 'ready',
            error: null,
            undoStack: [...current.undoStack, current.draft].slice(-100),
            redoStack: current.redoStack.slice(0, -1),
          },
        },
      }
    })
    return true
  },

  claimWriter: (canonicalPath, writerId) => {
    const session = get().sessions[canonicalPath]
    if (!session) return false
    if (session.writerId && session.writerId !== writerId) return false

    set(state => {
      const current = state.sessions[canonicalPath]
      if (!current) return state
      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: { ...current, writerId },
        },
      }
    })
    return true
  },

  releaseWriter: (canonicalPath, writerId) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session || session.writerId !== writerId) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: { ...session, writerId: null },
        },
      }
    })
  },

  createSaveSnapshot: (canonicalPath, content) => {
    const session = get().sessions[canonicalPath]
    if (!session) throw new Error('编辑会话不存在')
    return {
      canonicalPath,
      content: content ?? session.draft,
      draftVersion: session.draftVersion,
      expectedRevisionToken: session.baseRevisionToken,
    }
  },

  setSaving: (canonicalPath, saving) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            saving,
            status: saving ? 'saving' : session.dirty ? 'dirty' : 'ready',
          },
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
          [canonicalPath]: {
            ...session,
            error,
            status: error ? 'error' : session.dirty ? 'dirty' : 'ready',
          },
        },
      }
    })
  },

  markSaved: (canonicalPath, content, revisionToken, savedDraftVersion) => {
    set(state => {
      const session = state.sessions[canonicalPath]
      if (!session) return state
      const currentDraft = session.draft
      const savedVersionMatches = savedDraftVersion === undefined || session.draftVersion === savedDraftVersion
      const draftChangedAfterSnapshot = !savedVersionMatches || currentDraft !== content

      return {
        sessions: {
          ...state.sessions,
          [canonicalPath]: {
            ...session,
            original: content,
            draft: draftChangedAfterSnapshot ? currentDraft : content,
            dirty: draftChangedAfterSnapshot,
            status: draftChangedAfterSnapshot ? 'dirty' : 'ready',
            saving: false,
            error: null,
            baseRevisionToken: revisionToken,
            lastKnownDiskRevisionToken: revisionToken,
            conflictReason: null,
            undoStack: draftChangedAfterSnapshot ? session.undoStack : [],
            redoStack: draftChangedAfterSnapshot ? session.redoStack : [],
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
            status: reason === 'missing' || reason === 'renamed' ? 'missing' : 'conflict',
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
            draftVersion: session.draftVersion + 1,
            dirty: false,
            status: 'ready',
            error: null,
            baseRevisionToken: revisionToken,
            lastKnownDiskRevisionToken: revisionToken,
            conflictReason: null,
            undoStack: [],
            redoStack: [],
          },
        },
      }
    })
  },

  exportPersistedDrafts: () => {
    const now = Date.now()
    return Object.values(get().sessions)
      .filter(session => session.dirty && session.draft !== session.original)
      .map(session => ({
        canonicalPath: session.canonicalPath,
        displayPath: session.displayPath,
        fileName: session.fileName,
        original: session.original,
        draft: session.draft,
        draftVersion: session.draftVersion,
        baseRevisionToken: session.baseRevisionToken,
        lastKnownDiskRevisionToken: session.lastKnownDiskRevisionToken,
        savedAt: now,
      }))
  },

  restorePersistedDrafts: (drafts) => {
    set(state => {
      const restoredSessions = drafts.reduce<Record<string, EditSession>>((acc, draft) => {
        if (!draft.canonicalPath || draft.draft === draft.original) return acc
        acc[draft.canonicalPath] = {
          canonicalPath: draft.canonicalPath,
          displayPath: draft.displayPath,
          fileName: draft.fileName,
          status: 'dirty',
          original: draft.original,
          draft: draft.draft,
          draftVersion: Math.max(1, draft.draftVersion),
          writerId: null,
          dirty: true,
          saving: false,
          error: null,
          baseRevisionToken: draft.baseRevisionToken,
          lastKnownDiskRevisionToken: draft.lastKnownDiskRevisionToken,
          conflictReason: null,
          undoStack: [],
          redoStack: [],
        }
        return acc
      }, {})

      return {
        sessions: {
          ...restoredSessions,
          ...state.sessions,
        },
      }
    })
  },

  reset: () => set({ sessions: {} }),
}))
