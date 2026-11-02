import { useEffect, useMemo, useRef, useState } from 'react'
import { useFolderSearchSettingsStore } from '../stores/folderSearchSettingsStore'
import {
  matchFolderHistoryPinyin,
  parseFolderPinyinQuery,
  type FolderNamePinyinIndex,
  type FolderSearchItem,
} from '../utils/folderHistorySearch'

let modulePromise: Promise<typeof import('../utils/folderNamePinyin')> | null = null

function loadPinyin(): Promise<typeof import('../utils/folderNamePinyin')> {
  if (!modulePromise) {
    modulePromise = import('../utils/folderNamePinyin').catch(error => {
      modulePromise = null
      throw error
    })
  }
  return modulePromise
}

export function useFolderHistorySearch<T extends FolderSearchItem>({
  open, query, history, directMatches, composing,
}: {
  open: boolean
  query: string
  history: T[]
  directMatches: T[]
  composing: boolean
}): {
  settings: ReturnType<typeof useFolderSearchSettingsStore.getState>
  enabled: boolean
  pinyin: T[]
  loading: boolean
  error: string | null
  showHint: boolean
} {
  const settings = useFolderSearchSettingsStore()
  const enabled = settings.hydration === 'ready' && settings.enabled && !settings.saving
  const parsed = useMemo(() => parseFolderPinyinQuery(query), [query])
  const key = useMemo(() => ({ open, enabled, query, history, directMatches, composing, revision: settings.revision }),
    [open, enabled, query, history, directMatches, composing, settings.revision])
  const eligible = open && enabled && !composing && parsed !== null && history.some(item => /\p{Script=Han}/u.test(item.name))
  const cache = useRef(new Map<string, FolderNamePinyinIndex>())
  const failed = useRef(false)
  const [result, setResult] = useState<{ key: typeof key; pinyin: T[]; error: string | null } | null>(null)

  useEffect(() => {
    if (!open) return
    return settings.load()
  }, [open, settings.load])

  useEffect(() => {
    if (!open) failed.current = false
    const names = new Set(history.map(item => item.name))
    for (const name of cache.current.keys()) {
      if (!names.has(name)) cache.current.delete(name)
    }
  }, [open, history])

  useEffect(() => {
    if (!eligible || !parsed) return
    let active = true
    if (failed.current) {
      setResult({ key, pinyin: [], error: '拼音补充暂不可用，仍可按名称或路径搜索' })
      return
    }
    void loadPinyin().then(({ indexFolderName }) => {
      if (!active) return
      for (const item of history) {
        if (!cache.current.has(item.name)) cache.current.set(item.name, indexFolderName(item.name))
      }
      const pinyin = matchFolderHistoryPinyin(history, directMatches, parsed, cache.current)
      setResult({ key, pinyin, error: null })
    }).catch(() => {
      if (!active) return
      failed.current = true
      setResult({ key, pinyin: [], error: '拼音补充暂不可用，仍可按名称或路径搜索' })
    })
    return () => { active = false }
  }, [eligible, key, parsed, history, directMatches])

  const current = eligible && result?.key === key ? result : null
  const pinyin = current?.pinyin ?? []
  const loading = eligible && current === null
  const error = current?.error ?? null
  const showHint = open && enabled && !composing && !loading && !error && directMatches.length === 0 && pinyin.length === 0
    && /^[a-zü ']+$/i.test(query.trim())
  return { settings, enabled, pinyin, loading, error, showHint }
}
