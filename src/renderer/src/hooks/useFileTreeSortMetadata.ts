import { useEffect, useMemo, useRef, useState } from 'react'
import { FILE_TREE_METADATA_BATCH_SIZE, type FileTreeMetadataMap, type FileTreeMetadataResult } from '../../../shared/fileTreeSort'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useFileStore } from '../stores/fileStore'
import { getActiveWorkspaceLifecycleKey, isActiveWorkspaceLifecycleKey } from '../utils/workspaceOperationContext'
import { type SortableTreeItem, fileTreeMetadataPaths } from '../utils/fileTreeSort'

// 目录加载/收起侧栏会卸载树；旧系统IO完成前，新树仍共享本窗口的单批次闸门。
let pendingRead: Promise<FileTreeMetadataResult[]> | null = null

type Session = {
  key: string
  cache: FileTreeMetadataMap
  versions: Map<string, number>
  loaded: Map<string, number>
  dirty: boolean
  error: string | null
}

export function useFileTreeSortMetadata(items: SortableTreeItem[], basePath: string, enabled: boolean) {
  const workspaceKey = useWorkspaceStore(state => {
    const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId)
    return `${workspace?.id}:${workspace?.lifecycleEpoch}:${workspace?.primaryRoot}`
  })
  const refresh = useFileStore(state => state.treeMetadataRefresh)
  const key = `${workspaceKey}:${basePath}`
  const session = useRef<Session>({ key, cache: {}, versions: new Map(), loaded: new Map(), dirty: true, error: null })
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const active = useRef(enabled)
  const [tick, setTick] = useState(0)
  const [data, setData] = useState<{ key: string; pathsKey: string; value: FileTreeMetadataMap }>({ key, pathsKey: '', value: {} })
  const required = useMemo(() => fileTreeMetadataPaths(items), [items])
  const requiredKey = JSON.stringify(required)
  const allPaths = useMemo(() => new Set(required), [required])
  const demand = useRef({ key, allPaths })
  demand.current = { key, allPaths }
  active.current = enabled

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (session.current.key === key) return
    session.current = { key, cache: {}, versions: new Map(), loaded: new Map(), dirty: true, error: null }
    setData({ key, pathsKey: '', value: {} })
  }, [key])

  useEffect(() => {
    const current = session.current
    for (const path of current.versions.keys()) if (!allPaths.has(path)) {
      current.versions.delete(path)
      current.loaded.delete(path)
      delete current.cache[path]
      current.dirty = true
    }
  }, [allPaths, key])

  useEffect(() => {
    const current = session.current
    if (!current.versions.size) return
    for (const path of current.versions.keys()) current.versions.set(path, (current.versions.get(path) ?? 0) + 1)
    current.dirty = true
    current.error = null
    setTick(value => value + 1)
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      // 名称/类型模式不订阅属性变更；再次进入属性模式时重新确认缓存。
      const current = session.current
      current.loaded.clear()
      for (const path of current.versions.keys()) current.versions.set(path, (current.versions.get(path) ?? 0) + 1)
      current.dirty = true
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const invalidate = (event: { workspaceId: string; lifecycleEpoch: number }, paths: Array<string | undefined>) => {
      const lifecycle = getActiveWorkspaceLifecycleKey()
      if (!lifecycle || lifecycle.primaryRoot !== basePath || lifecycle.workspaceId !== event.workspaceId || lifecycle.lifecycleEpoch !== event.lifecycleEpoch) return
      const current = session.current
      const root = basePath.replace(/[\\/]+$/, '') + '/'
      let changed = false
      for (const file of paths) {
        const normalized = file?.replace(/\\/g, '/')
        if (!normalized?.startsWith(root.replace(/\\/g, '/'))) continue
        const relative = normalized.slice(root.length)
        if (!demand.current.allPaths.has(relative)) continue
        current.versions.set(relative, (current.versions.get(relative) ?? 0) + 1)
        current.dirty = true
        changed = true
      }
      if (changed && !timer) timer = setTimeout(() => { timer = undefined; setTick(value => value + 1) }, 100)
    }
    const cleanups = [
      window.api.onFileChanged?.(event => invalidate(event, [event.path])),
      window.api.onFileAdded?.(event => invalidate(event, [event.path])),
      window.api.onFileRemoved?.(event => invalidate(event, [event.path])),
      window.api.onFileRenamed?.(event => invalidate(event, [event.oldPath, event.newPath])),
    ]
    return () => { if (timer) clearTimeout(timer); cleanups.forEach(cleanup => cleanup?.()) }
  }, [basePath, key, enabled])

  useEffect(() => {
    if (!enabled || inFlight.current || !window.api.getFileTreeMetadata) return
    if (pendingRead) {
      let cancelled = false
      const wake = () => { if (!cancelled) setTick(value => value + 1) }
      void pendingRead.then(wake, wake)
      return () => { cancelled = true }
    }
    const current = session.current
    const lifecycle = getActiveWorkspaceLifecycleKey()
    if (current.key !== key || current.error || !lifecycle || lifecycle.primaryRoot !== basePath) return
    const paths = required.filter(path => current.loaded.get(path) !== (current.versions.get(path) ?? 0)).slice(0, FILE_TREE_METADATA_BATCH_SIZE)
    if (!paths.length) {
      // Publish only a complete, current snapshot, never a partially accumulated folder total.
      if (current.dirty || data.key !== key || data.pathsKey !== requiredKey) {
        current.dirty = false
        setData({ key, pathsKey: requiredKey, value: Object.fromEntries(required.map(path => [path, current.cache[path]])) })
      }
      return
    }
    const versions = paths.map(path => current.versions.get(path) ?? 0)
    paths.forEach((path, index) => current.versions.set(path, versions[index]))
    current.dirty = true
    inFlight.current = true
    const request = window.api.getFileTreeMetadata(paths, lifecycle)
    pendingRead = request
    void request.then(results => {
      if (!mounted.current || session.current !== current || !active.current || !isActiveWorkspaceLifecycleKey(lifecycle) || demand.current.key !== key) return
      const returned = new Map(results.map(result => [result.relativePath, result.value]))
      paths.forEach((path, index) => {
        if (!demand.current.allPaths.has(path) || current.versions.get(path) !== versions[index]) return
        const value = returned.get(path)
        current.cache[path] = value && Number.isFinite(value.mtimeMs) && Number.isSafeInteger(value.size) && value.size >= 0 ? value : null
        current.loaded.set(path, versions[index])
      })
    }).catch(() => {
      if (mounted.current && session.current === current && active.current && isActiveWorkspaceLifecycleKey(lifecycle)
        && paths.some((path, index) => demand.current.allPaths.has(path) && current.versions.get(path) === versions[index])) {
        current.error = '文档属性读取失败，文件夹统计未完成，请重试'
      }
    }).finally(() => {
      if (pendingRead === request) pendingRead = null
      inFlight.current = false
      if (mounted.current) setTick(value => value + 1)
    })
  }, [enabled, key, basePath, requiredKey, required, tick, data])

  const current = session.current
  const value = data.key === key ? data.value : {}
  const pending = required.some(path => current.loaded.get(path) !== (current.versions.get(path) ?? 0))
  const ready = current.key === key && data.key === key && data.pathsKey === requiredKey && !current.dirty && !pending
  const error = enabled && current.key === key ? current.error : null
  const loading = enabled && !error && !ready
  const failed = enabled && ready && required.some(path => value[path] === null)
  const retry = () => {
    current.error = null
    current.dirty = true
    for (const path of required) if (current.cache[path] === null) current.loaded.delete(path)
    setTick(value => value + 1)
  }
  return { metadata: value, ready, scopeKey: key, loading, error: error || (failed ? '部分文档属性读取失败，相关文件夹无法完整统计' : null), retry }
}
