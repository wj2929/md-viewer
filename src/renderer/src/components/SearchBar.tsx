import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import Fuse from 'fuse.js'
import { FileInfo } from './FileTree'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { SearchRequest, SearchResponse, SearchResult } from '../workers/searchWorker'

interface SearchBarProps {
  files: FileInfo[]
  onFileSelect: (file: FileInfo) => void
}

export interface SearchBarHandle {
  focus: () => void
}

interface FileWithContent extends FileInfo {
  content?: string
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

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(({ files, onFileSelect }, ref) => {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename')
  const [filesWithContent, setFilesWithContent] = useState<FileWithContent[]>([])
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const currentSearchIdRef = useRef<number>(0)

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
      loadedPathsRef.current = new Set()
    }
  }, [flatFiles])

  // 当切换到全文搜索模式时，加载所有文件内容
  useEffect(() => {
    if (searchMode === 'content' && filesWithContent.length === 0 && flatFiles.length > 0) {
      const loadAllContents = async (): Promise<void> => {
        setIsLoadingContent(true)
        try {
          const results = await Promise.all(
            flatFiles.map(async (file) => {
              try {
                const content = await window.api.readFile(file.path)
                return { ...file, content }
              } catch (error) {
                console.error(`Failed to read ${file.path}:`, error)
                return { ...file, content: '' }
              }
            })
          )
          setFilesWithContent(results)
          // 更新已加载路径
          loadedPathsRef.current = new Set(flatFiles.map(f => f.path))
        } finally {
          setIsLoadingContent(false)
        }
      }
      loadAllContents()
    }
  }, [searchMode, flatFiles, filesWithContent.length])

  // 初始化 Web Worker
  useEffect(() => {
    // 创建 Worker
    try {
      workerRef.current = new Worker(
        new URL('../workers/searchWorker.ts', import.meta.url),
        { type: 'module' }
      )

      workerRef.current.onmessage = (event: MessageEvent<SearchResponse>) => {
        const { type, id, results, totalCount: count, error } = event.data

        // 忽略过期的搜索结果
        if (id !== currentSearchIdRef.current) {
          return
        }

        if (type === 'result' && results) {
          setSearchResults(results)
          setTotalCount(count || 0)
          setIsSearching(false)
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

      matches.push({
        key: 'content',
        value: content.substring(start, end),
        indices: [[index - start, index - start + queryStr.length - 1]]
      })

      index += queryStr.length
      if (matches.length >= 2) break
    }

    return matches
  }, [])

  // 主线程搜索（Worker 不可用时的备用方案）
  const searchInMainThread = useCallback((queryStr: string): { results: SearchResult[]; totalCount: number } => {
    if (!queryStr.trim()) return { results: [], totalCount: 0 }

    if (searchMode === 'filename') {
      const allResults = filenameFuse.search(queryStr)
      return {
        results: allResults.slice(0, 20).map(r => ({
          file: r.item as FileWithContent,
          matches: []
        })),
        totalCount: allResults.length
      }
    } else {
      if (filesWithContent.length === 0) return { results: [], totalCount: 0 }

      // 性能保护
      const totalSize = filesWithContent.reduce((sum, f) => sum + (f.content?.length || 0), 0)
      if (totalSize > 500 * 1024 * 1024) {
        return {
          results: [{
            file: {
              name: '⚠️ 文件过多（超过 500MB），请使用文件名搜索',
              path: '',
              isDirectory: false
            } as FileWithContent,
            matches: []
          }],
          totalCount: 0
        }
      }

      // 精确匹配
      const lowerQuery = queryStr.toLowerCase()
      const exactMatches = filesWithContent.filter(file =>
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
          results: sortedMatches.slice(0, 20).map(file => ({
            file,
            matches: extractExactMatches(file.content || '', queryStr)
          })),
          totalCount: sortedMatches.length
        }
      }

      // Fuse.js 模糊搜索
      const contentFuse = new Fuse(filesWithContent, {
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
        totalCount: allResults.length
      }
    }
  }, [searchMode, filenameFuse, filesWithContent, extractExactMatches])

  // 触发搜索（使用防抖后的查询值）
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([])
      setTotalCount(0)
      setIsSearching(false)
      return
    }

    // 更新搜索 ID
    const searchId = ++searchIdCounter
    currentSearchIdRef.current = searchId

    // 优先使用 Worker
    if (workerRef.current) {
      setIsSearching(true)

      const filesToSearch = searchMode === 'filename' ? flatFiles : filesWithContent

      const request: SearchRequest = {
        type: 'search',
        id: searchId,
        query: debouncedQuery,
        files: filesToSearch.map(f => ({
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
        const { results, totalCount: count } = searchInMainThread(debouncedQuery)
        if (currentSearchIdRef.current === searchId) {
          setSearchResults(results)
          setTotalCount(count)
          setIsSearching(false)
        }
      }, 0)
    }
  }, [debouncedQuery, searchMode, flatFiles, filesWithContent, searchInMainThread])

  // 点击搜索结果
  const handleResultClick = (file: FileInfo): void => {
    onFileSelect(file)
    setQuery('')
    setSearchResults([])
    setTotalCount(0)
    setIsOpen(false)
  }

  // 键盘快捷键：Cmd/Ctrl + K 打开搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      } else if (e.key === 'Escape') {
        setIsOpen(false)
        setQuery('')
        setSearchResults([])
        setTotalCount(0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  // 提取匹配片段
  const getMatchSnippet = (matches: any[]): string => {
    if (matches.length === 0) return ''
    const match = matches[0]
    if (!match.value) return ''

    const indices = match.indices[0]
    if (!indices) return match.value.slice(0, 100)

    const [start, end] = indices
    const snippetStart = Math.max(0, start - 40)
    const snippetEnd = Math.min(match.value.length, end + 40)

    let snippet = match.value.slice(snippetStart, snippetEnd)
    if (snippetStart > 0) snippet = '...' + snippet
    if (snippetEnd < match.value.length) snippet = snippet + '...'

    return snippet
  }

  return (
    <div className="search-bar">
      <button
        className="search-trigger"
        onClick={() => {
          setIsOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        title="搜索文件 (⌘K)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
        </svg>
        <span>搜索文件...</span>
        <kbd className="shortcut">⌘K</kbd>
      </button>

      {isOpen && (
        <div className="search-overlay">
          <div className="search-modal">
            <div className="search-input-wrapper">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder={searchMode === 'filename' ? '搜索文件名...' : '搜索文件内容...'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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
            </div>

            <div className="search-mode-toggle">
              <button
                className={`mode-btn ${searchMode === 'filename' ? 'active' : ''}`}
                onClick={() => setSearchMode('filename')}
              >
                文件名
              </button>
              <button
                className={`mode-btn ${searchMode === 'content' ? 'active' : ''}`}
                onClick={() => setSearchMode('content')}
                disabled={isLoadingContent}
              >
                {isLoadingContent ? '加载中...' : '全文'}
              </button>
            </div>

            {/* 搜索结果区域 */}
            {(query || searchResults.length > 0) && (
              <div className="search-results">
                {isSearching && searchResults.length === 0 ? (
                  <div className="search-searching">
                    <span className="search-searching-text">搜索中...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <>
                    {/* 结果计数 - 放在列表上方 */}
                    {totalCount > 0 && (
                      <div className="search-result-count">
                        找到 {totalCount} 个结果{totalCount > 20 ? '，显示前 20 个' : ''}
                      </div>
                    )}
                    {searchResults.map(({ file, matches }) => (
                      <div
                        key={file.path}
                        className="search-result-item"
                        onClick={() => handleResultClick(file)}
                      >
                        <span className="result-icon">📄</span>
                        <div className="result-content">
                          <div className="result-name">{file.name}</div>
                          {matches && matches.length > 0 && (
                            <div className="result-snippet">{getMatchSnippet(matches)}</div>
                          )}
                          <div className="result-path">{file.path}</div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : query.trim() && !isSearching ? (
                  <div className="search-no-results">
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
