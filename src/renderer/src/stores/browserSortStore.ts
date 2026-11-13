import { create } from 'zustand'
import { DEFAULT_FILE_TREE_SORT, normalizeFileTreeSort, type FileTreeSort, type FileTreeSortSnapshot } from '../../../shared/fileTreeSort'

interface BrowserSortState {
  value: FileTreeSort
  revision: number
  ready: boolean
  saving: boolean
  error: string | null
  localChange: number
  connect: () => () => void
  reload: () => Promise<void>
  save: (value: FileTreeSort) => Promise<boolean>
}

let users = 0
let unsubscribe: (() => void) | undefined
let connection = 0

export const useBrowserSortStore = create<BrowserSortState>((set, get) => {
  const accept = (snapshot: FileTreeSortSnapshot): void => {
    if (snapshot.revision < get().revision) return
    set({ value: normalizeFileTreeSort(snapshot.value), revision: snapshot.revision, ready: true })
  }
  return {
    value: { ...DEFAULT_FILE_TREE_SORT }, revision: -1, ready: false, saving: false, error: null, localChange: 0,
    connect: () => {
      users++
      if (users === 1) {
        connection++
        unsubscribe = window.api.onBrowserSortChanged?.(snapshot => accept(snapshot))
        void get().reload()
      }
      return () => {
        users--
        if (users === 0) {
          connection++
          unsubscribe?.()
          unsubscribe = undefined
        }
      }
    },
    reload: async () => {
      if (!window.api.getBrowserSort) return
      const current = connection
      try {
        const snapshot = await window.api.getBrowserSort()
        if (current !== connection) return
        accept(snapshot)
        set({ error: null })
      } catch {
        if (current === connection) set({ error: '排序设置读取失败，请重试' })
      }
    },
    save: async value => {
      if (!get().ready || get().saving) return false
      set({ saving: true, error: null })
      try {
        await window.api.updateAppSettings({ browserSort: value })
        accept(await window.api.getBrowserSort())
        const confirmed = get().value
        const matches = confirmed.by === value.by && confirmed.direction === value.direction
        set(state => ({ saving: false, error: matches ? null : '排序设置未确认，请重试', localChange: state.localChange + (matches ? 1 : 0) }))
        return matches
      } catch {
        // 不回滚到旧快照：期间可能已收到其它窗口的成功提交。
        set({ saving: false, error: '排序设置未确认，请重试' })
        return false
      }
    },
  }
})
