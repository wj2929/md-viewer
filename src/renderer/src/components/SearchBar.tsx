import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, ReactNode } from 'react'
import Fuse from 'fuse.js'
import { FileInfo } from './FileTree'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useSearchHistoryStore } from '../stores'
import type { SearchRequest, SearchResponse, SearchResult } from '../workers/searchWorker'
import { applySearchInputLimits, createOpenDocumentCommand, type OpenDocumentCommand } from '../utils/v24WorkflowContracts'

interface SearchBarProps {
  files: FileInfo[]
  folderPath: string | null
  onFileSelect: (file: FileInfo, scrollToLine?: number, highlightKeyword?: string) => void
  onExternalFileOpen: (filePath: string) => void
  onOpenDocumentCommand?: (command: OpenDocumentCommand, file: FileInfo) => void
}

export interface SearchBarHandle {
  focus: () => void
}

interface FileWithContent extends FileInfo {
  content?: string
}

function isImeComposingEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.key === 'Process' || e.key === 'Unidentified' || e.keyCode === 229
}

// 跨平台路径前缀判断（兼容 Windows '\' 和 Unix '/'）
const isSubPath = (child: string, parent: string): boolean =>
  child.startsWith(parent + '/') || child.startsWith(parent + '\\')

function fairAllocate(
  rawResults: SearchResult[],
  folderPath: string | null,
  recentPaths: Set<string>,
  maxTotal = 20,
  minPerGroup = 3
): SearchResult[] {
  if (rawResults.length <= maxTotal) return rawResults

  const buckets: Record<string, SearchResult[]> = {
    current: [], recentFiles: [], recentFolders: []
  }
  for (const r of rawResults) {
    if (folderPath && isSubPath(r.file.path, folderPath)) buckets.current.push(r)
    else if (recentPaths.has(r.file.path)) buckets.recentFiles.push(r)
    else buckets.recentFolders.push(r)
  }

  const nonEmpty = Object.values(buckets).filter(b => b.length > 0)
  if (nonEmpty.length <= 1) return rawResults.slice(0, maxTotal)

  const seen = new Set<string>()
  const selected: SearchResult[] = []
  for (const items of nonEmpty) {
    const take = Math.min(items.length, minPerGroup)
    for (let i = 0; i < take; i++) {
      if (!seen.has(items[i].file.path)) {
        seen.add(items[i].file.path)
        selected.push(items[i])
      }
    }
  }

  for (const r of rawResults) {
    if (selected.length >= maxTotal) break
    if (!seen.has(r.file.path)) {
      seen.add(r.file.path)
      selected.push(r)
    }
  }

  return selected
}

// Worker 实例（模块级别，避免重复创建）
let searchIdCounter = 0

/**
 * 转义正则表达式特殊字符（主线程备用）
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 统计字符串中关键词出现的次数（主线程备用）
 */
function countMatches(content: string, query: string): number {
  if (!content || !query) return 0
  const escapedQuery = escapeRegExp(query)
  const regex = new RegExp(escapedQuery, 'gi')
  const matches = content.match(regex)
  return matches ? matches.length : 0
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(({ files, folderPath, onFileSelect, onExternalFileOpen, onOpenDocumentCommand }, ref) => {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  // 分组折叠状态（session 级持久化，不随 isOpen 重置）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename')
  const [searchScope, setSearchScope] = useState<'all' | 'currentFolder'>('all')
  const [filesWithContent, setFilesWithContent] = useState<FileWithContent[]>([])
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [searchWarning, setSearchWarning] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const currentSearchIdRef = useRef<number>(0)
  const contentLoadWarningRef = useRef<string | null>(null)

  // 外部数据源状态
  const [recentFilesList, setRecentFilesList] = useState<FileInfo[]>([])
  const [recentFolderFiles, setRecentFolderFiles] = useState<FileInfo[]>([])
  const [isLoadingExternal, setIsLoadingExternal] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState('')
  const loadRequestIdRef = useRef(0)

  // 防抖查询值 - 300ms 延迟
  const debouncedQuery = useDebouncedValue(query, 300)

  // 暴露 focus 方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => {
      setIsOpen(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }))

  // 展平文件树，只包含文件（不包含目录）
  const flatFiles = useMemo(() => {
    const result: FileInfo[] = []

    const flatten = (items: FileInfo[]): void => {
      for (const item of items) {
        if (item.isDirectory && item.children) {
          flatten(item.children)
        } else if (!item.isDirectory) {
          result.push(item)
        }
      }
    }

    flatten(files)
    return result
  }, [files])

  // 展平文件树的通用辅助函数
  const flattenTree = (items: FileInfo[]): FileInfo[] => {
    const out: FileInfo[] = []
    const walk = (list: FileInfo[]): void => {
      for (const item of list) {
        if (item.isDirectory && item.children) walk(item.children)
        else if (!item.isDirectory) out.push(item)
      }
    }
    walk(items)
    return out
  }

  // scope 切换处理
  const handleScopeChange = useCallback((scope: 'all' | 'currentFolder') => {
    setSearchScope(scope)
    setFilesWithContent([])
    setSearchResults([])
    setTotalCount(0)
    contentLoadWarningRef.current = null
    setSearchWarning(null)
    setSelectedIndex(-1)
  }, [])

  // 加载外部数据源（最近文件 + 最近文件夹）
  useEffect(() => {
    if (!isOpen) return
    const requestId = ++loadRequestIdRef.current

    if (searchScope === 'currentFolder') {
      setRecentFilesList([])
      setRecentFolderFiles([])
      setIsLoadingExternal(false)
      return
    }

    const load = async (): Promise<void> => {
      setIsLoadingExternal(true)
      try {
        const currentPaths = new Set(flatFiles.map(f => f.path))

        // 加载最近文件
        const recentFiles = await window.api.getRecentFiles()
        if (requestId !== loadRequestIdRef.current) return
        setRecentFilesList(
          recentFiles
            .map((f: { name: string; path: string }) => ({ name: f.name, path: f.path, isDirectory: false }))
            .filter((f: FileInfo) => !currentPaths.has(f.path))
        )

        // 加载最近文件夹
        const folders = await window.api.getFolderHistory()
        if (requestId !== loadRequestIdRef.current) return
        const top5 = folders
          .filter((f: { path: string }) => f.path !== folderPath)
          .slice(0, 5)

        const allFolderFiles: FileInfo[] = []
        for (let i = 0; i < top5.length; i++) {
          setLoadingProgress(`扫描文件夹 ${i + 1}/${top5.length}...`)
          try {
            const tree = await window.api.searchReadDir(top5[i].path)
            if (requestId !== loadRequestIdRef.current) return
            allFolderFiles.push(...flattenTree(tree).slice(0, 500))
          } catch { /* 文件夹不存在，跳过 */ }
        }
        if (requestId !== loadRequestIdRef.current) return

        // 去重：排除当前文件夹和最近文件中已有的
        const existingPaths = new Set([
          ...currentPaths,
          ...recentFiles.map((f: { path: string }) => f.path)
        ])
        setRecentFolderFiles(allFolderFiles.filter(f => !existingPaths.has(f.path)))
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setIsLoadingExternal(false)
          setLoadingProgress('')
        }
      }
    }
    load()
  }, [isOpen, folderPath, searchScope])

  // 用于追踪已加载内容的文件路径集合
  const loadedPathsRef = useRef<Set<string>>(new Set())

  // 当文件列表变化时，重置已加载状态
  useEffect(() => {
    const currentPaths = new Set(flatFiles.map(f => f.path))
    const loadedPaths = loadedPathsRef.current

    // 检查是否有新文件或文件被删除
    const hasNewFiles = flatFiles.some(f => !loadedPaths.has(f.path))
    const hasRemovedFiles = Array.from(loadedPaths).some(p => !currentPaths.has(p))

    if (hasNewFiles || hasRemovedFiles) {
      // 文件列表变化，需要重新加载
      setFilesWithContent([])
      contentLoadWarningRef.current = null
      loadedPathsRef.current = new Set()
    }
  }, [flatFiles])

  // 内容加载 loadId 防竞态
  const contentLoadIdRef = useRef(0)

  // 当切换到全文搜索模式时，加载所有文件内容（含外部文件）
  useEffect(() => {
    if (searchMode === 'filename') {
      contentLoadWarningRef.current = null
    }
    if (searchMode === 'content' && filesWithContent.length === 0) {
      const filesToLoad = searchScope === 'currentFolder'
        ? flatFiles
        : [...flatFiles, ...recentFilesList, ...recentFolderFiles]
      if (filesToLoad.length === 0) return
      const limitedFilesToLoad = applySearchInputLimits(filesToLoad)
      contentLoadWarningRef.current = limitedFilesToLoad.degradedReason || null
      setSearchWarning(limitedFilesToLoad.degradedReason || null)
      const loadId = ++contentLoadIdRef.current
      const loadAllContents = async (): Promise<void> => {
        setIsLoadingContent(true)
        try {
          const currentPaths = new Set(flatFiles.map(f => f.path))
          const results = await Promise.all(
            limitedFilesToLoad.files.map(async (file) => {
              try {
                const content = currentPaths.has(file.path)
                  ? await window.api.readFile(file.path)
                  : await window.api.searchReadFile(file.path)
                return { ...file, content }
              } catch {
                return { ...file, content: '' }
              }
            })
          )
          if (contentLoadIdRef.current !== loadId) return
          setFilesWithContent(results)
          loadedPathsRef.current = new Set(limitedFilesToLoad.files.map(f => f.path))
        } finally {
          if (contentLoadIdRef.current === loadId) {
            setIsLoadingContent(false)
          }
        }
      }
      loadAllContents()
    }
  }, [searchMode, flatFiles, recentFilesList, recentFolderFiles, filesWithContent.length, searchScope])

  // 初始化 Web Worker
  useEffect(() => {
    // 创建 Worker
    try {
      workerRef.current = new Worker(
        new URL('../workers/searchWorker.ts', import.meta.url),
        { type: 'module' }
      )

      workerRef.current.onmessage = (event: MessageEvent<SearchResponse>) => {
        const { type, id, results, totalCount: count, error, degradedReason } = event.data

        // 忽略过期的搜索结果
        if (id !== currentSearchIdRef.current) {
          return
        }

        if (type === 'result' && results) {
          setSearchResults(results)
          setTotalCount(count || 0)
          setSearchWarning(degradedReason || contentLoadWarningRef.current || null)
          setIsSearching(false)
          // v1.5.1: content 模式下自动展开所有文件
          setExpandedFiles(new Set(results.map((r: SearchResult) => r.file.path)))
          setSelectedIndex(-1)
        } else if (type === 'error') {
          console.error('Search worker error:', error)
          setIsSearching(false)
        }
      }

      workerRef.current.onerror = (error) => {
        console.error('Search worker crashed:', error)
        setIsSearching(false)
      }
    } catch (error) {
      console.warn('Web Worker not supported, will use main thread:', error)
    }

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  // 配置 Fuse.js 模糊搜索 - 文件名（主线程备用）
  // v1.4.3: 优化搜索准确性 - 放宽阈值，增加路径搜索
  const filenameFuse = useMemo(() => {
    return new Fuse(flatFiles, {
      keys: ['name', 'path'],
      threshold: 0.4,          // ✅ v1.4.3: 放宽阈值（0.3 → 0.4）
      distance: 100,           // ✅ 增加搜索距离
      minMatchCharLength: 2    // ✅ 最小匹配长度
    })
  }, [flatFiles])

  // 提取精确匹配的上下文（主线程备用）
  const extractExactMatches = useCallback((content: string, queryStr: string): any[] => {
    const lowerContent = content.toLowerCase()
    const lowerQuery = queryStr.toLowerCase()
    const matches: any[] = []
    let index = 0

    while ((index = lowerContent.indexOf(lowerQuery, index)) !== -1) {
      const start = Math.max(0, index - 40)
      const end = Math.min(content.length, index + queryStr.length + 40)

      // v1.5.1: 计算行号
      let lineNumber = 1
      for (let i = 0; i < index; i++) {
        if (content[i] === '\n') lineNumber++
      }

      matches.push({
        key: 'content',
        value: content.substring(start, end),
        indices: [[index - start, index - start + queryStr.length - 1]],
        lineNumber
      })

      index += queryStr.length
      if (matches.length >= 5) break  // v1.5.1: 每文件最多5个匹配
    }

    return matches
  }, [])

  // 主线程搜索（Worker 不可用时的备用方案）
  const searchInMainThread = useCallback((queryStr: string): { results: SearchResult[]; totalCount: number; degradedReason?: string } => {
    if (!queryStr.trim()) return { results: [], totalCount: 0 }

    if (searchMode === 'filename') {
      const limitedFiles = applySearchInputLimits(flatFiles)
      const fuse = limitedFiles.degradedReason
        ? new Fuse(limitedFiles.files, {
          keys: ['name', 'path'],
          threshold: 0.4,
          distance: 100,
          minMatchCharLength: 2
        })
        : filenameFuse
      const allResults = fuse.search(queryStr)
      return {
        results: allResults.slice(0, 60).map(r => ({
          file: r.item as FileWithContent,
          matches: []
        })),
        totalCount: allResults.length,
        degradedReason: limitedFiles.degradedReason
      }
    } else {
      if (filesWithContent.length === 0) return { results: [], totalCount: 0 }

      const limitedFiles = applySearchInputLimits(filesWithContent)

      // 精确匹配
      const lowerQuery = queryStr.toLowerCase()
      const exactMatches = limitedFiles.files.filter(file =>
        file.content?.toLowerCase().includes(lowerQuery)
      )

      if (exactMatches.length > 0) {
        // 智能排序：文件名匹配优先 + 匹配次数排序
        const sortedMatches = exactMatches
          .map(file => ({
            file,
            nameMatch: file.name.toLowerCase().includes(lowerQuery),
            matchCount: countMatches(file.content || '', queryStr)
          }))
          .sort((a, b) => {
            if (a.nameMatch && !b.nameMatch) return -1
            if (!a.nameMatch && b.nameMatch) return 1
            return b.matchCount - a.matchCount
          })
          .map(item => item.file)

        return {
          results: sortedMatches.slice(0, 60).map(file => ({
            file,
            matches: extractExactMatches(file.content || '', queryStr)
          })),
          totalCount: sortedMatches.length,
          degradedReason: limitedFiles.degradedReason || contentLoadWarningRef.current || undefined
        }
      }

      // Fuse.js 模糊搜索
      const contentFuse = new Fuse(limitedFiles.files, {
        keys: ['name', 'path', 'content'],
        threshold: 0.2,
        distance: 500,
        minMatchCharLength: 2,
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true,
        useExtendedSearch: false
      })

      const allResults = contentFuse.search(queryStr)
      return {
        results: allResults.slice(0, 20).map(r => ({
          file: r.item,
          matches: r.matches?.filter(m => m.key === 'content').slice(0, 2).map(m => ({
            key: m.key || 'content',
            value: m.value || '',
            indices: m.indices as [number, number][]
          })) || []
        })),
        totalCount: allResults.length,
        degradedReason: limitedFiles.degradedReason || contentLoadWarningRef.current || undefined
      }
    }
  }, [searchMode, filenameFuse, flatFiles, filesWithContent, extractExactMatches])

  // 触发搜索（使用防抖后的查询值）
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([])
      setTotalCount(0)
      setSearchWarning(null)
      setIsSearching(false)
      return
    }

    // 更新搜索 ID
    const searchId = ++searchIdCounter
    currentSearchIdRef.current = searchId

    // 优先使用 Worker
    if (workerRef.current) {
      setIsSearching(true)

      const allFiles = searchMode === 'filename'
        ? searchScope === 'currentFolder'
          ? flatFiles
          : [...flatFiles, ...recentFilesList, ...recentFolderFiles]
        : filesWithContent
      const limitedFiles = applySearchInputLimits(allFiles)
      setSearchWarning(limitedFiles.degradedReason || contentLoadWarningRef.current || null)

      const request: SearchRequest = {
        type: 'search',
        id: searchId,
        query: debouncedQuery,
        files: limitedFiles.files.map(f => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory,
          content: (f as FileWithContent).content
        })),
        searchMode
      }

      workerRef.current.postMessage(request)
    } else {
      // Worker 不可用，使用主线程（会卡顿，但作为降级方案）
      setIsSearching(true)
      // 使用 setTimeout 避免完全阻塞
      setTimeout(() => {
        const { results, totalCount: count, degradedReason } = searchInMainThread(debouncedQuery)
        if (currentSearchIdRef.current === searchId) {
          setSearchResults(results)
          setTotalCount(count)
          setSearchWarning(degradedReason || null)
          setIsSearching(false)
          setExpandedFiles(new Set(results.map(r => r.file.path)))
          setSelectedIndex(-1)
        }
      }, 0)
    }
  }, [debouncedQuery, searchMode, flatFiles, recentFilesList, recentFolderFiles, filesWithContent, searchInMainThread, searchScope])

  // v1.5.1: 展开/折叠状态（按文件路径）
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  // v1.5.1: 键盘导航索引
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const resultListRef = useRef<HTMLDivElement>(null)
  // 搜索历史键盘导航索引
  const [historySelectedIndex, setHistorySelectedIndex] = useState(-1)

  // 点击搜索结果
  const handleResultClick = (file: FileInfo, lineNumber?: number): void => {
    const keyword = debouncedQuery.trim() || query.trim()
    if (keyword) {
      useSearchHistoryStore.getState().addSearchBarHistory(keyword)
    }
    const isInternal = folderPath && isSubPath(file.path, folderPath)
    if (isInternal) {
      const command = createOpenDocumentCommand({
        source: 'search',
        filePath: file.path,
        canonicalPath: file.path,
        target: lineNumber
          ? { kind: 'match', lineNumber, highlightText: keyword }
          : { kind: 'top', highlightText: keyword },
        preserveFilter: true,
      })
      if (onOpenDocumentCommand) {
        onOpenDocumentCommand(command, file)
      } else {
        onFileSelect(file, lineNumber, debouncedQuery.trim() || undefined)
      }
    } else {
      onExternalFileOpen(file.path)
    }
    setQuery('')
    setSearchResults([])
    setTotalCount(0)
    setIsOpen(false)
    setExpandedFiles(new Set())
    setSelectedIndex(-1)
  }

  // v1.5.1: 切换文件展开/折叠
  const toggleFileExpand = (filePath: string): void => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  // 切换分组折叠
  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // 搜索结果分组（公平分配后再分组）
  const groupedResults = useMemo(() => {
    const recentPaths = new Set(recentFilesList.map(f => f.path))
    const allocated = searchScope === 'currentFolder'
      ? searchResults.slice(0, 20)
      : fairAllocate(searchResults, folderPath, recentPaths)

    const groups: { current: SearchResult[]; recentFiles: SearchResult[]; recentFolders: SearchResult[] } = {
      current: [], recentFiles: [], recentFolders: []
    }
    for (const result of allocated) {
      if (folderPath && isSubPath(result.file.path, folderPath)) {
        groups.current.push(result)
      } else if (recentPaths.has(result.file.path)) {
        groups.recentFiles.push(result)
      } else {
        groups.recentFolders.push(result)
      }
    }
    return groups
  }, [searchResults, recentFilesList, folderPath, searchScope])

  // 分组后的有序结果（用于键盘导航）
  const orderedResults = useMemo(() => [
    ...groupedResults.current,
    ...groupedResults.recentFiles,
    ...groupedResults.recentFolders
  ], [groupedResults])

  // v1.5.1: 构建扁平化的导航列表（用于键盘导航）
  const flatNavItems = useMemo(() => {
    const items: Array<{ file: FileInfo; lineNumber?: number; type: 'file' | 'match' }> = []
    // 当前范围下忽略折叠
    const collapsedPaths = new Set<string>()
    if (searchScope !== 'currentFolder' && collapsedGroups.size > 0) {
      const groupMap = { current: groupedResults.current, recentFiles: groupedResults.recentFiles, recentFolders: groupedResults.recentFolders }
      for (const [key, results] of Object.entries(groupMap)) {
        if (collapsedGroups.has(key)) {
          results.forEach(r => collapsedPaths.add(r.file.path))
        }
      }
    }
    for (const { file, matches } of orderedResults) {
      if (collapsedPaths.has(file.path)) continue
      items.push({ file, type: 'file' })
      if (searchMode === 'content' && matches && matches.length > 0 && expandedFiles.has(file.path)) {
        for (const match of matches) {
          items.push({ file, lineNumber: (match as any).lineNumber, type: 'match' })
        }
      }
    }
    return items
  }, [orderedResults, expandedFiles, searchMode, collapsedGroups, groupedResults, searchScope])

  // 读取搜索历史
  const searchBarHistory = useSearchHistoryStore(s => s.searchBarHistory)
  const removeSearchBarHistory = useSearchHistoryStore(s => s.removeSearchBarHistory)
  const clearSearchBarHistory = useSearchHistoryStore(s => s.clearSearchBarHistory)
  const showHistory = !query.trim() && searchBarHistory.length > 0

  // 点击历史项：填入搜索框并触发搜索
  const handleHistorySelect = useCallback((keyword: string) => {
    setQuery(keyword)
    setHistorySelectedIndex(-1)
    setIsSearching(true)
    // 聚焦回输入框
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  // 键盘快捷键：Cmd/Ctrl + K 打开搜索 + 上下箭头导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isImeComposingEvent(e)) return

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      } else if (e.key === 'Escape') {
        setIsOpen(false)
        setQuery('')
        setSearchResults([])
        setTotalCount(0)
        setExpandedFiles(new Set())
        setSelectedIndex(-1)
        setHistorySelectedIndex(-1)
      } else if (isOpen && showHistory) {
        // 历史列表导航
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHistorySelectedIndex(prev => Math.min(prev + 1, searchBarHistory.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHistorySelectedIndex(prev => Math.max(prev - 1, -1))
        } else if (e.key === 'Enter' && historySelectedIndex >= 0 && historySelectedIndex < searchBarHistory.length) {
          e.preventDefault()
          handleHistorySelect(searchBarHistory[historySelectedIndex])
        }
      } else if (isOpen && e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, flatNavItems.length - 1))
      } else if (isOpen && e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (isOpen && e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < flatNavItems.length) {
        e.preventDefault()
        const item = flatNavItems[selectedIndex]
        if (item.type === 'file') {
          // 如果是文件行，在 content 模式下展开/折叠，否则直接打开
          if (searchMode === 'content' && searchResults.find(r => r.file.path === item.file.path)?.matches?.length) {
            toggleFileExpand(item.file.path)
          } else {
            handleResultClick(item.file)
          }
        } else {
          handleResultClick(item.file, item.lineNumber)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selectedIndex, flatNavItems, searchMode, searchResults, showHistory, searchBarHistory, historySelectedIndex, handleHistorySelect])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('.search-bar')) {
        setIsOpen(false)
      }
    }

    setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => document.removeEventListener('click', handleClickOutside)
  }, [isOpen])

  // v1.5.1: 提取匹配片段（返回 JSX 带高亮）
  const getMatchSnippet = (match: any): ReactNode => {
    if (!match.value) return null

    const indices = match.indices[0]
    if (!indices) return match.value.slice(0, 100)

    const [start, end] = indices
    const snippetStart = Math.max(0, start - 40)
    const snippetEnd = Math.min(match.value.length, end + 40)

    const before = match.value.slice(snippetStart, start)
    const highlighted = match.value.slice(start, end + 1)
    const after = match.value.slice(end + 1, snippetEnd)

    return (
      <>
        {snippetStart > 0 && '...'}
        {before}
        <mark className="search-highlight">{highlighted}</mark>
        {after}
        {snippetEnd < match.value.length && '...'}
      </>
    )
  }

  return (
    <div className="search-bar">
      <button
        className="search-trigger"
        onClick={() => {
          setIsOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        title={`搜索文件 (${window.api?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
        </svg>
        <span>搜索文件...</span>
        <kbd className="shortcut">{window.api?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>

      {isOpen && (
        <div className="search-overlay">
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="search-input-wrapper">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder={searchScope === 'currentFolder' ? '搜索当前文件夹...' : (searchMode === 'filename' ? '搜索文件名...' : '搜索文件内容...')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setHistorySelectedIndex(-1)
                }}
                autoFocus
              />
              {/* 搜索中状态指示器 */}
              {isSearching && (
                <span className="search-loading-indicator" title="搜索中...">
                  <svg className="search-spinner" width="14" height="14" viewBox="0 0 14 14">
                    <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.8s" repeatCount="indefinite"/>
                    </circle>
                  </svg>
                </span>
              )}
              {query && !isSearching && (
                <button
                  className="search-clear"
                  onClick={() => {
                    setQuery('')
                    setSearchResults([])
                    setTotalCount(0)
                  }}
                  aria-label="清空搜索"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              {/* 搜索范围切换：文件夹图标 */}
              <div className="search-scope-wrapper">
                <button
                  className={`search-scope-toggle ${searchScope === 'currentFolder' ? 'active' : ''}`}
                  onClick={() => handleScopeChange(searchScope === 'currentFolder' ? 'all' : 'currentFolder')}
                  disabled={!folderPath}
                  aria-pressed={searchScope === 'currentFolder'}
                  aria-label={searchScope === 'currentFolder' ? '仅搜索当前文件夹' : '搜索全部数据源'}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4c0-.6.4-1 1-1h3.2c.4 0 .8.2 1 .5l.6.8c.2.3.6.5 1 .5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4z"/>
                  </svg>
                </button>
                <span className="search-scope-tooltip">
                  {searchScope === 'currentFolder'
                    ? '🔍 仅当前文件夹 · 点击切换为搜索全部'
                    : '🌐 搜索全部（当前文件夹 + 最近文件 + 最近文件夹）· 点击切换为仅当前文件夹'}
                </span>
              </div>
            </div>

            <div className="search-mode-toggle">
              <button
                className={`mode-btn ${searchMode === 'filename' ? 'active' : ''}`}
                onClick={() => setSearchMode('filename')}
                aria-pressed={searchMode === 'filename'}
              >
                文件名
              </button>
              <button
                className={`mode-btn ${searchMode === 'content' ? 'active' : ''}`}
                onClick={() => setSearchMode('content')}
                disabled={isLoadingContent}
                aria-pressed={searchMode === 'content'}
              >
                {isLoadingContent ? '加载中...' : '全文'}
              </button>
            </div>

            {/* 搜索历史区域（输入为空时显示） */}
            {showHistory && (
              <div className="search-results">
                <div className="search-history-header">
                  <span>最近搜索</span>
                  <button
                    className="search-history-clear-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearSearchBarHistory()
                    }}
                  >
                    清空
                  </button>
                </div>
                {searchBarHistory.map((keyword, idx) => (
                  <div
                    key={keyword}
                    className={`search-history-item ${historySelectedIndex === idx ? 'selected' : ''}`}
                    onClick={() => handleHistorySelect(keyword)}
                  >
                    <span className="search-history-icon">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="6.5" />
                        <polyline points="8 4.5 8 8 10.5 9.5" />
                      </svg>
                    </span>
                    <span className="search-history-keyword">{keyword}</span>
                    <button
                      className="search-history-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSearchBarHistory(keyword)
                      }}
                      aria-label={`删除 ${keyword}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 无历史且无输入时的提示 */}
            {!query.trim() && searchBarHistory.length === 0 && (
              <div className="search-results">
                <div className="search-no-results">
                  <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" className="search-no-results-icon">
                    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
                  </svg>
                  <p>输入关键词搜索文件</p>
                </div>
              </div>
            )}

            {/* 搜索结果区域 */}
            {query.trim() && (
              <div className="search-results" ref={resultListRef}>
                {isSearching && searchResults.length === 0 ? (
                  <div className="search-searching">
                    <span className="search-searching-text">搜索中...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <>
                    {/* 结果计数 */}
                    {totalCount > 0 && (() => {
                      const displayedCount = searchScope === 'currentFolder'
                        ? groupedResults.current.length
                        : groupedResults.current.length + groupedResults.recentFiles.length + groupedResults.recentFolders.length
                      return (
                        <div className="search-result-count">
                          找到 {totalCount} 个{searchMode === 'content' ? '文件' : '结果'}{totalCount > displayedCount ? `，显示前 ${displayedCount} 个` : ''}
                          {searchMode === 'content' && (() => {
                            const totalMatches = searchResults.reduce((sum, r) => sum + (r.matches?.length || 0), 0)
                            return totalMatches > 0 ? `（${totalMatches} 处匹配）` : ''
                          })()}
                          {isLoadingExternal && <span className="search-loading-progress"> · {loadingProgress}</span>}
                        </div>
                      )
                    })()}
                    {searchWarning && (
                      <div className="search-degraded" role="status">
                        {searchWarning}
                      </div>
                    )}
                    {/* 渲染搜索结果 */}
                    {(() => {
                      const renderResultItem = ({ file, matches }: SearchResult) => {
                        const isExpanded = expandedFiles.has(file.path)
                        const hasMatches = searchMode === 'content' && matches && matches.length > 0
                        const fileNavIndex = flatNavItems.findIndex(item => item.type === 'file' && item.file.path === file.path)
                        const isExternal = !folderPath || !isSubPath(file.path, folderPath)

                        return (
                          <div key={file.path} className="search-result-group">
                            <div
                              className={`search-result-item ${selectedIndex === fileNavIndex ? 'selected' : ''}`}
                              onClick={() => {
                                if (hasMatches) {
                                  toggleFileExpand(file.path)
                                } else {
                                  handleResultClick(file)
                                }
                              }}
                            >
                              <span className="result-icon">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path fillRule="evenodd" d="M4 1h5.586L13 4.414V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 1v3h3L9 2zM4 2v12h8V6H9a1 1 0 0 1-1-1V2H4z"/>
                                </svg>
                              </span>
                              <div className="result-content">
                                <div className="result-name">{file.name}</div>
                                {!hasMatches && matches && matches.length > 0 && (
                                  <div className="result-snippet">{getMatchSnippet(matches[0])}</div>
                                )}
                                <div className="result-path">
                                  {file.path}
                                  {isExternal && (
                                    <span className="search-result-source">
                                      {file.path.split('/').slice(-2, -1)[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {hasMatches && (
                                <span className="result-expand-toggle">
                                  {isExpanded ? '▼' : '▶'} {matches.length}
                                </span>
                              )}
                            </div>
                            {hasMatches && isExpanded && (
                              <div className="search-match-lines">
                                {matches.map((match: any, idx: number) => {
                                  const actualNavIndex = fileNavIndex + 1 + idx
                                  return (
                                    <div
                                      key={`${file.path}-L${match.lineNumber || 0}-${idx}`}
                                      className={`search-match-line ${selectedIndex === actualNavIndex ? 'selected' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleResultClick(file, match.lineNumber)
                                      }}
                                    >
                                      <span className="match-line-number">L{match.lineNumber || '?'}</span>
                                      <span className="match-line-snippet">{getMatchSnippet(match)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      }

                      return searchScope === 'currentFolder'
                        ? groupedResults.current.map(result => renderResultItem(result))
                        : ([
                            { key: 'current', label: '📂 当前文件夹', items: groupedResults.current },
                            { key: 'recentFiles', label: '🕐 最近文件', items: groupedResults.recentFiles },
                            { key: 'recentFolders', label: '📁 最近文件夹', items: groupedResults.recentFolders },
                          ] as const).map(group => group.items.length > 0 && (
                            <div key={group.key}>
                              <div
                                className="search-group-header"
                                onClick={() => toggleGroupCollapse(group.key)}
                              >
                                <span className="search-group-toggle">{collapsedGroups.has(group.key) ? '▶' : '▼'}</span>
                                {group.label}
                                <span className="search-group-count">{group.items.length}</span>
                              </div>
                              {!collapsedGroups.has(group.key) && group.items.map(result => renderResultItem(result))}
                            </div>
                          ))
                    })()}
                  </>
                ) : query.trim() && !isSearching ? (
                  <div className="search-no-results">
                    {searchWarning && (
                      <div className="search-degraded" role="status">
                        {searchWarning}
                      </div>
                    )}
                    <p>没有找到匹配的{searchMode === 'filename' ? '文件' : '内容'}</p>
                  </div>
                ) : null}
              </div>
            )}

            <div className="search-footer">
              <div className="search-hint">
                <kbd>↑↓</kbd> 导航
                <kbd>Enter</kbd> 打开
                <kbd>Esc</kbd> 关闭
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

SearchBar.displayName = 'SearchBar'
