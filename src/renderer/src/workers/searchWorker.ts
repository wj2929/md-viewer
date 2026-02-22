/**
 * 搜索 Web Worker
 *
 * 在后台线程执行搜索，避免阻塞主线程 UI
 *
 * 功能：
 * 1. 精确匹配优先（100% 准确，速度快）
 * 2. 智能排序（文件名匹配优先 + 匹配次数排序）
 * 3. Fuse.js 模糊搜索后备
 * 4. 支持搜索中断（新搜索自动取消旧搜索）
 * 5. 返回总匹配数（用于 UI 显示）
 *
 * 未来优化点（v2.0）：
 * - 用匹配密度（次数/文件长度）代替匹配次数，避免长文件 bias
 * - 记录用户点击行为，学习排序偏好
 * - 考虑匹配位置权重（标题 > 正文）
 */

import Fuse, { FuseResult, IFuseOptions } from 'fuse.js'

// 类型定义
interface FileWithContent {
  name: string
  path: string
  isDirectory: boolean
  content?: string
}

interface SearchMatch {
  key: string
  value: string
  indices: [number, number][]
  lineNumber?: number     // v1.5.1: 匹配所在行号
}

interface SearchResult {
  file: FileWithContent
  matches: SearchMatch[]
  score?: number
}

interface SearchRequest {
  type: 'search'
  id: number  // 请求 ID，用于取消过期请求
  query: string
  files: FileWithContent[]
  searchMode: 'filename' | 'content'
}

interface SearchResponse {
  type: 'result' | 'error'
  id: number
  results?: SearchResult[]
  totalCount?: number  // 总匹配数
  error?: string
  searchTime?: number
}

// 当前搜索 ID（用于取消过期请求）
let currentSearchId = 0

/**
 * 转义正则表达式特殊字符
 * 避免搜索 "C++" 或 "[TODO]" 等关键词时崩溃
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 统计字符串中关键词出现的次数
 */
function countMatches(content: string, query: string): number {
  if (!content || !query) return 0
  const escapedQuery = escapeRegExp(query)
  const regex = new RegExp(escapedQuery, 'gi')
  const matches = content.match(regex)
  return matches ? matches.length : 0
}

/**
 * 提取精确匹配的上下文（v1.5.1: 增加行号，每文件最多5个匹配）
 */
function extractExactMatches(content: string, query: string): SearchMatch[] {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matches: SearchMatch[] = []
  let index = 0

  while ((index = lowerContent.indexOf(lowerQuery, index)) !== -1) {
    const start = Math.max(0, index - 40)
    const end = Math.min(content.length, index + query.length + 40)

    // v1.5.1: 计算行号（从1开始）
    let lineNumber = 1
    for (let i = 0; i < index; i++) {
      if (content[i] === '\n') lineNumber++
    }

    matches.push({
      key: 'content',
      value: content.substring(start, end),
      indices: [[index - start, index - start + query.length - 1]],
      lineNumber
    })

    index += query.length
    if (matches.length >= 5) break  // v1.5.1: 每文件最多5个匹配
  }

  return matches
}

/**
 * 对精确匹配结果进行智能排序
 *
 * 排序优先级：
 * 1. 文件名包含关键词 → 排最前
 * 2. 匹配次数多 → 次优先
 * 3. 文件路径顺序 → 兜底
 */
function sortExactMatches(
  files: FileWithContent[],
  query: string
): FileWithContent[] {
  const lowerQuery = query.toLowerCase()

  return files
    .map(file => ({
      file,
      nameMatch: file.name.toLowerCase().includes(lowerQuery),
      matchCount: countMatches(file.content || '', query)
    }))
    .sort((a, b) => {
      // 1. 文件名匹配优先
      if (a.nameMatch && !b.nameMatch) return -1
      if (!a.nameMatch && b.nameMatch) return 1
      // 2. 匹配次数多的优先
      return b.matchCount - a.matchCount
    })
    .map(item => item.file)
}

/**
 * 执行文件名搜索
 */
function searchByFilename(
  files: FileWithContent[],
  query: string
): { results: SearchResult[]; totalCount: number } {
  const fuseOptions: IFuseOptions<FileWithContent> = {
    keys: ['name', 'path'],
    threshold: 0.3,
    distance: 100,
    minMatchCharLength: 2
  }

  const fuse = new Fuse(files, fuseOptions)
  const allResults = fuse.search(query)
  const totalCount = allResults.length

  const results = allResults.slice(0, 60).map((r: FuseResult<FileWithContent>) => ({
    file: r.item,
    matches: [],
    score: r.score
  }))

  return { results, totalCount }
}

/**
 * 执行全文搜索
 */
function searchByContent(
  files: FileWithContent[],
  query: string
): { results: SearchResult[]; totalCount: number } {
  // 性能保护：检查总文件大小
  const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0)
  const totalSizeMB = totalSize / 1024 / 1024

  if (totalSizeMB > 500) {
    return {
      results: [{
        file: {
          name: '⚠️ 文件过多（超过 500MB），请使用文件名搜索',
          path: '',
          isDirectory: false
        },
        matches: []
      }],
      totalCount: 0
    }
  }

  const lowerQuery = query.toLowerCase()

  // 先尝试精确匹配（性能更快，准确率 100%）
  const exactMatches = files.filter(file =>
    file.content?.toLowerCase().includes(lowerQuery)
  )

  if (exactMatches.length > 0) {
    // 对精确匹配结果进行智能排序
    const sortedMatches = sortExactMatches(exactMatches, query)
    const totalCount = sortedMatches.length

    const results = sortedMatches.slice(0, 60).map(file => ({
      file,
      matches: extractExactMatches(file.content || '', query)
    }))

    return { results, totalCount }
  }

  // 没有精确匹配，使用 Fuse.js 模糊搜索
  const fuseOptions: IFuseOptions<FileWithContent> = {
    keys: ['name', 'path', 'content'],
    threshold: 0.2,
    distance: 500,
    minMatchCharLength: 2,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
    useExtendedSearch: false
  }

  const fuse = new Fuse(files, fuseOptions)
  const allResults = fuse.search(query)
  const totalCount = allResults.length

  const results = allResults.slice(0, 20).map((r: FuseResult<FileWithContent>) => ({
    file: r.item,
    matches: (r.matches?.filter(m => m.key === 'content').slice(0, 2) || []).map(m => ({
      key: m.key || 'content',
      value: m.value || '',
      indices: m.indices as [number, number][]
    })),
    score: r.score
  }))

  return { results, totalCount }
}

/**
 * 处理搜索请求
 */
function handleSearch(request: SearchRequest): void {
  const { id, query, files, searchMode } = request
  const startTime = performance.now()

  // 检查是否已被取消
  if (id !== currentSearchId) {
    return  // 忽略过期请求
  }

  try {
    if (!query.trim()) {
      self.postMessage({
        type: 'result',
        id,
        results: [],
        totalCount: 0,
        searchTime: 0
      } as SearchResponse)
      return
    }

    let results: SearchResult[]
    let totalCount: number

    if (searchMode === 'filename') {
      const searchResult = searchByFilename(files, query)
      results = searchResult.results
      totalCount = searchResult.totalCount
    } else {
      const searchResult = searchByContent(files, query)
      results = searchResult.results
      totalCount = searchResult.totalCount
    }

    // 再次检查是否已被取消
    if (id !== currentSearchId) {
      return
    }

    const searchTime = performance.now() - startTime

    self.postMessage({
      type: 'result',
      id,
      results,
      totalCount,
      searchTime
    } as SearchResponse)
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as SearchResponse)
  }
}

// 监听主线程消息
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const { type, id } = event.data

  if (type === 'search') {
    // 更新当前搜索 ID（自动取消之前的搜索）
    currentSearchId = id
    handleSearch(event.data)
  }
}

// 导出类型供主线程使用
export type { SearchRequest, SearchResponse, SearchResult, FileWithContent }
