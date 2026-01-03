import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Fuse from 'fuse.js'
import { FileInfo } from './FileTree'

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

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(({ files, onFileSelect }, ref) => {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename')
  const [filesWithContent, setFilesWithContent] = useState<FileWithContent[]>([])
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

    const flatten = (items: FileInfo[]) => {
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

  // 当切换到全文搜索模式时，加载所有文件内容
  useEffect(() => {
    if (searchMode === 'content' && filesWithContent.length === 0) {
      const loadAllContents = async () => {
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
        } finally {
          setIsLoadingContent(false)
        }
      }
      loadAllContents()
    }
  }, [searchMode, flatFiles, filesWithContent.length])

  // 配置 Fuse.js 模糊搜索 - 文件名
  const filenameFuse = useMemo(() => {
    return new Fuse(flatFiles, {
      keys: ['name', 'path'],
      threshold: 0.3,
      distance: 100,
      minMatchCharLength: 2
    })
  }, [flatFiles])

  // 配置 Fuse.js 模糊搜索 - 全文
  const contentFuse = useMemo(() => {
    if (filesWithContent.length === 0) return null
    return new Fuse(filesWithContent, {
      keys: ['name', 'path', 'content'],
      threshold: 0.4,
      distance: 200,
      minMatchCharLength: 3,
      includeScore: true,
      includeMatches: true
    })
  }, [filesWithContent])

  // 搜索结果
  const searchResults = useMemo(() => {
    if (!query.trim()) return []

    if (searchMode === 'filename') {
      const results = filenameFuse.search(query)
      return results.slice(0, 10).map(r => ({
        file: r.item,
        matches: []
      }))
    } else {
      if (!contentFuse) return []
      const results = contentFuse.search(query)
      return results.slice(0, 10).map(r => ({
        file: r.item,
        matches: r.matches?.filter(m => m.key === 'content').slice(0, 2) || []
      }))
    }
  }, [query, searchMode, filenameFuse, contentFuse])

  // 点击搜索结果
  const handleResultClick = (file: FileInfo) => {
    onFileSelect(file)
    setQuery('')
    setIsOpen(false)
  }

  // 键盘快捷键：Cmd/Ctrl + K 打开搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      } else if (e.key === 'Escape') {
        setIsOpen(false)
        setQuery('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
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
              {query && (
                <button
                  className="search-clear"
                  onClick={() => setQuery('')}
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

            {query && (
              <div className="search-results">
                {searchResults.length > 0 ? (
                  searchResults.map(({ file, matches }) => (
                    <div
                      key={file.path}
                      className="search-result-item"
                      onClick={() => handleResultClick(file)}
                    >
                      <span className="result-icon">📄</span>
                      <div className="result-content">
                        <div className="result-name">{file.name}</div>
                        {matches.length > 0 && (
                          <div className="result-snippet">{getMatchSnippet(matches)}</div>
                        )}
                        <div className="result-path">{file.path}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="search-no-results">
                    <p>没有找到匹配的{searchMode === 'filename' ? '文件' : '内容'}</p>
                  </div>
                )}
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
