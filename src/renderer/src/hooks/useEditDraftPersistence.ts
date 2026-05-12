import { useEffect } from 'react'
import { useEditSessionStore } from '../stores/editSessionStore'
import { loadPersistedEditDrafts, savePersistedEditDrafts } from '../utils/editDraftPersistence'

export function useEditDraftPersistence(): void {
  useEffect(() => {
    useEditSessionStore.getState().restorePersistedDrafts(loadPersistedEditDrafts())

    return useEditSessionStore.subscribe((state) => {
      try {
        savePersistedEditDrafts(state.exportPersistedDrafts())
      } catch (error) {
        console.error('Failed to persist Markdown edit drafts:', error)
      }
    })
  }, [])
}
