import { useEffect, useRef, useMemo, memo, useCallback, forwardRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import debounce from 'lodash.debounce'
import Mark from 'mark.js'

// v1.4.6: 使用统一的渲染器配置
import { createMarkdownRenderer, sanitizeHtml, setupDOMPurifyHooks } from '../utils/markdownRenderer'

// v1.6.0: 图表渲染 hooks（从 VirtualizedMarkdown 提取）
import {
  useMermaidChart,
  useEChartsChart,
  useInfographicChart,
  useMarkmapChart,
  useGraphvizChart,
  useDrawIOChart,
  usePlantUMLChart,
  useExcalidrawChart,
  useVegaLiteChart,
  useD2Chart,
  useBpmnChart,
  useWaveDromChart,
  useStructurizrChart,
  usePlotlyChart,
  useDbmlChart,
  useAntvG6Chart,
  useKrokiChart,
} from './charts'

// v1.4.0: 页面内搜索
import { useFileStore } from '../stores/fileStore'
import { useInPageSearch } from '../hooks/useInPageSearch'
import { InPageSearchBox } from './search'
import { collectExportableChartPngs, countExportableCharts } from '../utils/chartUtils'
import { createEditableBlockDecision, type EditableBlockKind } from '../utils/v24WorkflowContracts'
import { openHelpLink, SOURCE_EDIT_HELP_URL } from '../utils/helpLinks'

/**
 * v1.4.6: 已移除本地的 createMarkdownInstance
 * 改用 markdownRenderer.ts 中的统一配置
 */

interface VirtualizedMarkdownProps {
  content: string
  className?: string
  filePath?: string
  tabId?: string
  leafId?: string | null
  renderDebounceMs?: number
  scrollToLine?: number
  scrollToRatio?: number
  onScrollToLineComplete?: () => void
  onScrollToRatioComplete?: () => void
  highlightKeyword?: string
  onHighlightKeywordComplete?: () => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
  previewEditingEnabled?: boolean
  onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
  onSourceEditRequest?: (target: SourceEditRequest) => void
  onReadPositionChange?: (position: { scrollRatio: number; headingId?: string }) => void
  onMarkdownLinkClick?: (href: string, currentFilePath: string) => void | Promise<void>
}

let lastPreviewChartZipContext: {
  root: HTMLElement
  filePath: string
  tabId?: string
  leafId?: string | null
} | null = null

export interface PreviewBlockEdit {
  sourceLine: number
  sourceEndLine?: number
  originalText: string
  nextText: string
  editKind?: 'block' | 'table-cell' | 'code-block'
  tableCellIndex?: number
}

export interface SourceEditRequest {
  sourceLine: number
  sourceEndLine?: number
}

const CHART_CODE_LANGUAGES = new Set([
  'mermaid',
  'echarts',
  'js',
  'javascript',
  'json',
  'drawio',
  'dio',
  'plantuml',
  'puml',
  'dot',
  'graphviz',
  'markmap',
  'infographic',
  'excalidraw',
  'excalidraw-json',
  'vega-lite',
  'vegalite',
  'd2',
  'bpmn',
  'wavedrom',
  'c4',
  'c4plantuml',
  'structurizr',
  'structurizr-dsl',
  'plotly',
  'plotly-json',
  'dbml',
  'antv-g6',
  'g6',
  'kroki',
  'kroki-pikchr',
  'kroki-nomnoml',
  'kroki-svgbob',
  'kroki-bytefield',
  'kroki-tikz',
  'pikchr',
  'nomnoml',
  'svgbob',
  'bytefield',
  'tikz',
])

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function createHeadingId(text: string, fallbackIndex: number): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || `heading-${fallbackIndex + 1}`
}

function ensureHeadingIds(root: HTMLElement): void {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  const usedIds = new Set<string>()

  headings.forEach((heading, index) => {
    const baseId = heading.id || createHeadingId(heading.textContent || '', index)
    let uniqueId = baseId
    let counter = 1
    while (usedIds.has(uniqueId)) {
      uniqueId = `${baseId}-${counter}`
      counter++
    }
    usedIds.add(uniqueId)
    if (heading.id !== uniqueId) heading.id = uniqueId
  })
}

function findInPageAnchorTarget(root: HTMLElement, href: string): HTMLElement | null {
  const targetId = safeDecodeURIComponent(href.slice(1))
  if (!targetId) return null

  const exactMatch = root.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
  if (exactMatch) return exactMatch

  const normalize = (value: string) => value.replace(/[_-]/g, '').toLowerCase()
  const normalizedTarget = normalize(targetId)
  for (const element of root.querySelectorAll<HTMLElement>('[id]')) {
    if (normalize(element.id) === normalizedTarget) return element
  }

  return null
}

function getEditableBlockKind(element: HTMLElement): EditableBlockKind {
  const tagName = element.tagName.toLowerCase()
  if (tagName === 'pre' && element.dataset.previewReadOnlyReason === 'chart-code') return 'chart'
  if (/^h[1-6]$/.test(tagName)) return 'heading'
  if (tagName === 'p') return 'paragraph'
  if (tagName === 'blockquote') return 'blockquote'
  if (tagName === 'li') return 'list'
  if (tagName === 'td' || tagName === 'th') return 'table-cell'
  if (tagName === 'pre') return 'code'
  return 'unknown'
}

function normalizeRenderedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(value: string): string {
  return normalizeRenderedText(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, '')
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = withoutOuterPipes.split(/(?<!\\)\|/).map(cell => normalizeRenderedText(cell))
  if (cells.length < 2) return null
  if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null
  return cells
}

interface FencedCodeRange {
  startLine: number
  endLine: number
  lang: string
  content: string
}

function findFencedCodeRanges(lines: string[]): FencedCodeRange[] {
  const ranges: FencedCodeRange[] = []
  let index = 0

  while (index < lines.length) {
    const opening = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/)
    if (!opening) {
      index += 1
      continue
    }

    const fence = opening[1]
    const fenceChar = fence[0]
    const lang = (opening[2] || '').toLowerCase()
    let endLine = lines.length - 1

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const closing = lines[cursor].match(/^\s{0,3}(`{3,}|~{3,})\s*$/)
      if (closing && closing[1][0] === fenceChar && closing[1].length >= fence.length) {
        endLine = cursor
        break
      }
    }

    ranges.push({
      startLine: index + 1,
      endLine: endLine + 1,
      lang,
      content: lines.slice(index + 1, endLine).join('\n'),
    })
    index = endLine + 1
  }

  return ranges
}

function resolveLocalMarkdownResource(markdownFilePath: string, src: string): string {
  const decodedSrc = safeDecodeURIComponent(src)
  const dir = markdownFilePath.substring(0, markdownFilePath.lastIndexOf('/'))
  let absolutePath = decodedSrc.startsWith('/') ? decodedSrc : `${dir}/${decodedSrc}`
  const parts = absolutePath.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '..') normalized.pop()
    else if (part !== '.' && part !== '') normalized.push(part)
  }
  absolutePath = `/${normalized.join('/')}`
  return `local-image://${encodeURI(absolutePath)}`
}

function normalizeLocalImageSources(root: HTMLElement, markdownFilePath?: string): void {
  if (!markdownFilePath) return

  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const rawSrc = img.getAttribute('src')
    if (!rawSrc) return
    const src = safeDecodeURIComponent(rawSrc)
    if (
      src.startsWith('local-image://') ||
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('data:') ||
      src.startsWith('blob:')
    ) {
      return
    }
    if (/\.excalidraw(?:[?#].*)?$/i.test(src)) {
      const placeholder = document.createElement('div')
      placeholder.className = 'excalidraw-file-placeholder'
      placeholder.dataset.excalidrawSrc = src.split('#')[0].split('?')[0]
      placeholder.dataset.excalidrawAlt = img.getAttribute('alt') || ''
      img.replaceWith(placeholder)
      return
    }
    if (/\.bpmn(?:[?#].*)?$/i.test(src)) {
      const placeholder = document.createElement('div')
      placeholder.className = 'bpmn-file-placeholder'
      placeholder.dataset.bpmnSrc = src.split('#')[0].split('?')[0]
      placeholder.dataset.bpmnAlt = img.getAttribute('alt') || ''
      img.replaceWith(placeholder)
      return
    }
    img.setAttribute('src', resolveLocalMarkdownResource(markdownFilePath, src))
  })
}

/**
 * Markdown 渲染器
 */
export function VirtualizedMarkdown({ content, className = '', filePath, tabId, leafId = null, renderDebounceMs = 300, scrollToLine, scrollToRatio, onScrollToLineComplete, onScrollToRatioComplete, highlightKeyword, onHighlightKeywordComplete, onImageClick, previewEditingEnabled = false, onPreviewBlockEdit, onSourceEditRequest, onReadPositionChange, onMarkdownLinkClick }: VirtualizedMarkdownProps): JSX.Element {

  // v1.3.7：右键菜单处理（添加书签 + 原有功能）
  const folderPath = useFileStore(state => state.folderPath)
  const showPreviewContextMenu = useCallback((target: HTMLElement, currentTarget: HTMLElement) => {
    if (!filePath) return

    const heading = target.closest('h1, h2, h3, h4, h5, h6')

    // 检测是否有选中文本
    const selection = window.getSelection()
    const selectionText = selection?.toString().trim() || ''
    const hasSelection = selectionText.length > 0
    const sourceElement = target.closest('[data-source-line]') as HTMLElement | null
    const sourceLineValue = sourceElement?.dataset.sourceLine
    const sourceLine = sourceLineValue ? Number(sourceLineValue) : null
    const scrollContainer = (currentTarget.closest('.preview') || currentTarget) as HTMLElement
    const scrollRatio = scrollContainer.scrollHeight > scrollContainer.clientHeight
      ? scrollContainer.scrollTop / Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight)
      : 0
    const chartCount = countExportableCharts(currentTarget)
    lastPreviewChartZipContext = {
      root: currentTarget,
      filePath,
      tabId,
      leafId,
    }

    // 检测右键目标是否为内部 .md 链接
    let linkHref: string | null = null
    const anchor = target.closest('a')
    if (anchor) {
      const href = anchor.getAttribute('href')
      if (href) {
        const decoded = decodeURIComponent(href)
        // 仅对本地 .md 链接提供分屏菜单，排除外部链接和锚点
        if (!decoded.startsWith('http://') && !decoded.startsWith('https://') && !decoded.startsWith('#')) {
          const clean = decoded.split('#')[0].split('?')[0]
          if (clean.endsWith('.md')) {
            linkHref = clean
          }
        }
      }
    }

    // 调用新的预览区域右键菜单（v1.3.7：合并书签功能和原有功能）
    window.api.showPreviewContextMenu({
      filePath,
      tabId,
      leafId,
      headingId: heading?.id || null,
      headingText: heading?.textContent || null,
      headingLevel: heading?.tagName.toLowerCase() || null,
      hasSelection,
      selectionText,
      sourceLine: Number.isFinite(sourceLine) ? sourceLine : null,
      scrollRatio,
      chartCount,
      linkHref,
      basePath: folderPath || null
    }).catch(error => {
      console.error('[VirtualizedMarkdown] Failed to show context menu:', error)
    })
  }, [filePath, folderPath, leafId, tabId])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    showPreviewContextMenu(e.target as HTMLElement, e.currentTarget as HTMLElement)
  }, [showPreviewContextMenu])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
    e.preventDefault()
    showPreviewContextMenu(e.target as HTMLElement, e.currentTarget as HTMLElement)
  }, [showPreviewContextMenu])

  // v1.4.6: 初始化 DOMPurify hooks（仅一次）
  useEffect(() => {
    setupDOMPurifyHooks()

    return () => {
      // 组件卸载时清理 hooks（防止内存泄漏）
      // DOMPurify.removeAllHooks() 已在 setupDOMPurifyHooks 中调用
    }
  }, [])

  // v1.4.6: 使用统一的 markdown-it 渲染器
  const md = useMemo(() => createMarkdownRenderer(), [])

  // v1.5.1: 搜索跳转到指定行
  useEffect(() => {
    if (!scrollToLine || !content) return

    // 延迟执行，确保 DOM 已渲染
    const timer = setTimeout(() => {
      const totalLines = content.split('\n').length
      if (totalLines === 0) return

      // 找到 .preview 滚动容器
      const previewContainer = document.querySelector('.preview')
      if (!previewContainer) return

      // 按行号比例估算滚动位置
      const ratio = Math.max(0, (scrollToLine - 1)) / totalLines
      const targetScroll = ratio * previewContainer.scrollHeight

      previewContainer.scrollTo({
        top: Math.max(0, targetScroll - 100), // 偏移一点，让目标行不在最顶部
        behavior: 'smooth'
      })

      onScrollToLineComplete?.()
    }, 300)

    return () => clearTimeout(timer)
  }, [scrollToLine, content, onScrollToLineComplete])

  useEffect(() => {
    if (typeof scrollToRatio !== 'number' || !content) return

    const timer = setTimeout(() => {
      const previewContainer = document.querySelector('.preview')
      if (!previewContainer) return

      const ratio = Math.max(0, Math.min(1, scrollToRatio))
      const maxScroll = Math.max(0, previewContainer.scrollHeight - previewContainer.clientHeight)
      previewContainer.scrollTo({
        top: maxScroll * ratio,
        behavior: 'auto'
      })
      onScrollToRatioComplete?.()
    }, 300)

    return () => clearTimeout(timer)
  }, [scrollToRatio, content, onScrollToRatioComplete])

  // v1.5.1: 高亮清理 ref
  const highlightCleanupRef = useRef<(() => void) | null>(null)

  // v1.5.1: 搜索跳转后临时高亮关键词
  useEffect(() => {
    if (!highlightKeyword) return

    // 延迟执行，确保滚动完成后再高亮
    const highlightTimer = setTimeout(() => {
      const container = document.querySelector('.preview')
      if (!container) return

      const markInstance = new Mark(container as HTMLElement)
      markInstance.mark(highlightKeyword, {
        className: 'search-temp-highlight',
        separateWordSearch: false,
        caseSensitive: false,
      })

      // 3 秒后自动清除高亮
      const fadeTimer = setTimeout(() => {
        markInstance.unmark()
        onHighlightKeywordComplete?.()
      }, 3000)

      highlightCleanupRef.current = () => {
        clearTimeout(fadeTimer)
        markInstance.unmark()
      }
    }, 500) // 等待滚动动画完成

    return () => {
      clearTimeout(highlightTimer)
      highlightCleanupRef.current?.()
      highlightCleanupRef.current = null
    }
  }, [highlightKeyword, onHighlightKeywordComplete])

  // 直接渲染
  return (
    <NonVirtualizedMarkdown
      content={content}
      md={md}
      className={className}
      filePath={filePath}
      renderDebounceMs={renderDebounceMs}
      onContextMenu={handleContextMenu}
      onPreviewKeyDown={handleKeyDown}
      onImageClick={onImageClick}
      previewEditingEnabled={previewEditingEnabled}
      onPreviewBlockEdit={onPreviewBlockEdit}
      onSourceEditRequest={onSourceEditRequest}
      onReadPositionChange={onReadPositionChange}
      onMarkdownLinkClick={onMarkdownLinkClick}
    />
  )
}

/**
 * 非虚拟滚动渲染（小文件）
 * v1.4.0: 集成页面内搜索功能
 * v1.4.3: 添加防抖优化，避免频繁渲染
 */
const NonVirtualizedMarkdown = memo(function NonVirtualizedMarkdown({
  content,
  md,
  className,
  filePath,
  renderDebounceMs,
  onContextMenu,
  onPreviewKeyDown,
  onImageClick,
  previewEditingEnabled,
  onPreviewBlockEdit,
  onSourceEditRequest,
  onReadPositionChange,
  onMarkdownLinkClick
}: {
  content: string
  md: MarkdownIt
  className: string
  filePath?: string
  renderDebounceMs: number
  onContextMenu?: (e: React.MouseEvent) => void
  onPreviewKeyDown?: (e: React.KeyboardEvent) => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
  previewEditingEnabled: boolean
  onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
  onSourceEditRequest?: (target: SourceEditRequest) => void
  onReadPositionChange?: (position: { scrollRatio: number; headingId?: string }) => void
  onMarkdownLinkClick?: (href: string, currentFilePath: string) => void | Promise<void>
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // v1.4.3: 防抖状态 - 延迟渲染以提升性能
  const [debouncedContent, setDebouncedContent] = useState(content)
  const [renderVersion, setRenderVersion] = useState(0)

  // v1.4.3: 防抖更新内容，快速编辑草稿预览可传入更短延迟
  useEffect(() => {
    const debouncedUpdate = debounce(() => {
      setDebouncedContent(content)
    }, renderDebounceMs)

    debouncedUpdate()

    return () => {
      debouncedUpdate.cancel()
    }
  }, [content, renderDebounceMs])

  useEffect(() => {
    if (content === debouncedContent) setRenderVersion(version => version + 1)
  }, [content, debouncedContent])

  useEffect(() => {
    if (!filePath || !window.api?.onExportChartsZipFromPreview || !window.api?.exportChartsZip) return

    return window.api.onExportChartsZipFromPreview(async (request) => {
      const root = containerRef.current
      const context = lastPreviewChartZipContext
      if (!root || !context || context.root !== root || context.filePath !== request.filePath) return
      if (request.tabId && context.tabId && request.tabId !== context.tabId) return
      if (request.leafId && context.leafId && request.leafId !== context.leafId) return

      try {
        const images = await collectExportableChartPngs(root)
        if (images.length === 0) {
          console.warn('[VirtualizedMarkdown] 当前预览区没有可导出的 SVG 图表')
          return
        }

        const result = await window.api.exportChartsZip({
          markdownFilePath: request.filePath,
          images,
        })
        if (result?.filePath) {
          window.api.showItemInFolder?.(result.filePath).catch(error => {
            console.warn('[VirtualizedMarkdown] 无法在文件夹中显示图表 ZIP:', error)
          })
        } else if (result?.error) {
          console.error('[VirtualizedMarkdown] 图表 ZIP 导出失败:', result.error)
        }
      } catch (error) {
        console.error('[VirtualizedMarkdown] 图表 ZIP 导出失败:', error)
      }
    })
  }, [filePath])

  useEffect(() => {
    if (!onReadPositionChange) return
    const root = containerRef.current
    if (!root) return
    const scrollContainer = (root.closest('.preview') || root.parentElement) as HTMLElement | null
    if (!scrollContainer) return

    const report = debounce(() => {
      const maxScroll = Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight)
      const scrollRatio = Math.max(0, Math.min(1, scrollContainer.scrollTop / maxScroll))
      const containerTop = scrollContainer.getBoundingClientRect().top
      const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
      const activeHeading = headings
        .map(heading => ({ heading, top: heading.getBoundingClientRect().top - containerTop }))
        .filter(item => item.top <= scrollContainer.clientHeight * 0.35)
        .sort((a, b) => b.top - a.top)[0]?.heading

      onReadPositionChange({
        scrollRatio,
        ...(activeHeading?.id ? { headingId: activeHeading.id } : {}),
      })
    }, 500)

    scrollContainer.addEventListener('scroll', report, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', report)
      report.cancel()
    }
  }, [onReadPositionChange, renderVersion])

  // v1.4.0: 页面内搜索
  const search = useInPageSearch(containerRef, debouncedContent.length)

  // v1.4.0: 监听 IPC 事件（从右键菜单触发页面内搜索）
  useEffect(() => {
    if (!window.api.onOpenInPageSearch) return

    const unsubscribe = window.api.onOpenInPageSearch(() => {
      search.setVisible(true)
    })

    return unsubscribe
  }, [search.setVisible])

  // v1.4.0: 监听 Cmd+Shift+F 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+F / Ctrl+Shift+F: 切换页面内搜索
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        e.stopPropagation()
        search.setVisible(!search.isVisible)
      }
      // Cmd+G / Ctrl+G: 下一个匹配（搜索框打开时）
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'g' && search.isVisible) {
        e.preventDefault()
        e.stopPropagation()
        search.goNext()
      }
      // Cmd+Shift+G / Ctrl+Shift+G: 上一个匹配（搜索框打开时）
      else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g' && search.isVisible) {
        e.preventDefault()
        e.stopPropagation()
        search.goPrev()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [search.isVisible, search.goNext, search.goPrev, search.setVisible])

  // v1.4.0: 关闭搜索框时清除高亮
  const handleSearchClose = useCallback(() => {
    search.clear()
    search.setVisible(false)
  }, [search.clear, search.setVisible])

  const html = useMemo(() => {
    if (!debouncedContent || debouncedContent.trim().length === 0) {
      return '<p class="placeholder">文件内容为空</p>'
    }

    if (debouncedContent.length > 500000) {
      return `
        <div class="content-warning">
          <p><strong>文件过大，无法渲染</strong></p>
          <p>文件大小: ${(debouncedContent.length / 1024).toFixed(2)} KB，最大支持: 500 KB</p>
        </div>
      `
    }

    const lines = debouncedContent.split('\n')
    if (lines.length > 10000) {
      const truncated = lines.slice(0, 10000).join('\n')
      const rawHtml = md.render(truncated)
      const sanitizedHtml = sanitizeHtml(rawHtml)  // ✅ XSS 防护
      return `
        ${sanitizedHtml}
        <div class="content-warning">
          <p><strong>内容过长，已截断显示</strong></p>
          <p>完整内容共 ${lines.length} 行，当前仅显示前 10000 行。</p>
        </div>
      `
    }

    const rawHtml = md.render(debouncedContent)
    return sanitizeHtml(rawHtml)  // ✅ XSS 防护
  }, [md, debouncedContent])

  // 注意：Mermaid 渲染、标题 ID、锚点点击逻辑已移到 MarkdownContent 组件中

  return (
    <>
      {/* v1.4.0: 页面内搜索框 */}
      <InPageSearchBox
        visible={search.isVisible}
        query={search.query}
        onQueryChange={search.setQuery}
        currentIndex={search.currentIndex}
        totalCount={search.totalCount}
        onNext={search.goNext}
        onPrev={search.goPrev}
        onClose={handleSearchClose}
        caseSensitive={search.caseSensitive}
        onToggleCaseSensitive={search.toggleCaseSensitive}
        searchHistory={search.searchHistory}
        onSelectHistory={search.onSelectHistory}
        onRemoveHistory={search.onRemoveHistory}
        onClearHistory={search.onClearHistory}
      />

      {/* Markdown 内容 - 使用 MarkdownContent 子组件避免重渲染覆盖 mark.js 高亮 */}
      <MarkdownContent
        ref={containerRef}
        html={html}
        className={className}
        filePath={filePath}
        sourceContent={debouncedContent}
        renderVersion={renderVersion}
        onContextMenu={onContextMenu}
        onKeyDown={onPreviewKeyDown}
        onImageClick={onImageClick}
        previewEditingEnabled={previewEditingEnabled}
        onPreviewBlockEdit={onPreviewBlockEdit}
        onSourceEditRequest={onSourceEditRequest}
        onMarkdownLinkClick={onMarkdownLinkClick}
      />
    </>
  )
})

/**
 * Markdown 内容渲染组件
 * 独立出来避免父组件状态变化导致 innerHTML 被重置
 */
const MarkdownContent = memo(
  forwardRef<HTMLDivElement, {
    html: string
    className: string
    filePath?: string
    sourceContent: string
    renderVersion: number
    onContextMenu?: (e: React.MouseEvent) => void
    onKeyDown?: (e: React.KeyboardEvent) => void
    onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
    previewEditingEnabled: boolean
    onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
    onSourceEditRequest?: (target: SourceEditRequest) => void
    onMarkdownLinkClick?: (href: string, currentFilePath: string) => void | Promise<void>
  }>(function MarkdownContent({ html, className, filePath, sourceContent, renderVersion, onContextMenu, onKeyDown, onImageClick, previewEditingEnabled, onPreviewBlockEdit, onSourceEditRequest, onMarkdownLinkClick }, ref) {
    const internalRef = useRef<HTMLDivElement>(null)
    const combinedRef = (ref as React.RefObject<HTMLDivElement>) || internalRef
    const skippedFocusedRenderRef = useRef(false)
    const allowDeferredRenderBlockRef = useRef<HTMLElement | null>(null)
    const previewInputCommitTimerRef = useRef<number | null>(null)
    const pendingPreviewEditRef = useRef<{ block: HTMLElement; edit: PreviewBlockEdit } | null>(null)
    const [deferredRenderVersion, setDeferredRenderVersion] = useState(0)
    const chartRenderKey = useMemo(
      () => `${deferredRenderVersion}:${html}:${sourceContent}`,
      [deferredRenderVersion, html, sourceContent]
    )

    // 只在 html 变化时更新 DOM
    useEffect(() => {
      if (combinedRef.current) {
        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const activeEditableBlock = activeElement?.closest('.markdown-preview-editable-block') as HTMLElement | null
        const activeBlockBelongsToPreview = activeEditableBlock && combinedRef.current.contains(activeEditableBlock)
        const composingBlock = combinedRef.current.querySelector('.markdown-preview-editable-block[data-preview-composing="true"]')
        const allowedDeferredBlock = allowDeferredRenderBlockRef.current
        const activeBlockIsCleanDeferredBlock = Boolean(
          allowedDeferredBlock &&
          activeEditableBlock === allowedDeferredBlock &&
          normalizeRenderedText(activeEditableBlock.textContent || '') === (activeEditableBlock.dataset.previewOriginalText || '')
        )
        const hasBlockingActiveBlock = activeBlockBelongsToPreview && !activeBlockIsCleanDeferredBlock

        if (previewEditingEnabled && (hasBlockingActiveBlock || composingBlock)) {
          skippedFocusedRenderRef.current = true
          return
        }

        allowDeferredRenderBlockRef.current = null
        combinedRef.current.innerHTML = html
        ensureHeadingIds(combinedRef.current)
        normalizeLocalImageSources(combinedRef.current, filePath)
        const sourceLines = sourceContent.split('\n')
        const fencedCodeRanges = findFencedCodeRanges(sourceLines)
        const elements = combinedRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,blockquote,table,li')
        let searchFrom = 0
        elements.forEach((element) => {
          const text = (element.textContent || '').trim()
          if (!text) return
          const firstLine = text.split('\n').find(line => line.trim().length > 0)?.trim()
          if (!firstLine) return
          const normalizedFirstLine = normalizeForMatch(firstLine).slice(0, 40)
          if (!normalizedFirstLine) return
          const foundIndex = sourceLines.findIndex((line, index) => {
            if (index < searchFrom) return false
            return normalizeForMatch(line).includes(normalizedFirstLine)
          })
          if (foundIndex >= 0) {
            ;(element as HTMLElement).dataset.sourceLine = String(foundIndex + 1)
            searchFrom = foundIndex
          }
        })

        let tableSearchFrom = 0
        combinedRef.current.querySelectorAll('tr').forEach((row) => {
          const cells = Array.from(row.querySelectorAll<HTMLElement>('th,td'))
          if (cells.length === 0) return
          const renderedCells = cells.map(cell => normalizeForMatch(cell.textContent || ''))
          const foundIndex = sourceLines.findIndex((line, index) => {
            if (index < tableSearchFrom) return false
            const markdownCells = parseMarkdownTableRow(line)
            if (!markdownCells || markdownCells.length < renderedCells.length) return false
            return renderedCells.every((cell, cellIndex) => normalizeForMatch(markdownCells[cellIndex]) === cell)
          })
          if (foundIndex < 0) return
          row.dataset.sourceLine = String(foundIndex + 1)
          cells.forEach((cell, cellIndex) => {
            cell.dataset.sourceLine = String(foundIndex + 1)
            cell.dataset.previewEditKind = 'table-cell'
            cell.dataset.tableCellIndex = String(cellIndex)
          })
          tableSearchFrom = foundIndex + 1
        })

        let codeRangeIndex = 0
        combinedRef.current.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
          const range = fencedCodeRanges[codeRangeIndex]
          codeRangeIndex += 1
          if (!range) return
          pre.dataset.sourceLine = String(range.startLine)
          pre.dataset.sourceEndLine = String(range.endLine)
          pre.dataset.previewEditKind = 'code-block'
          if (CHART_CODE_LANGUAGES.has(range.lang)) {
            pre.dataset.previewReadOnlyReason = 'chart-code'
          }
        })

        combinedRef.current.querySelectorAll('.markdown-preview-source-only-hint').forEach(hint => hint.remove())

        const editableElements = combinedRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,td,th,pre')
        editableElements.forEach((element) => {
          const editableElement = element as HTMLElement
          const sourceLine = editableElement.dataset.sourceLine
          const sourceLineNumber = sourceLine ? Number(sourceLine) : NaN
          const sourceEndLine = editableElement.dataset.sourceEndLine ? Number(editableElement.dataset.sourceEndLine) : sourceLineNumber
          const decision = Number.isFinite(sourceLineNumber)
            ? createEditableBlockDecision({
              blockId: `${getEditableBlockKind(editableElement)}:${sourceLine}`,
              kind: getEditableBlockKind(editableElement),
              sourceRange: {
                startLine: sourceLineNumber,
                endLine: Number.isFinite(sourceEndLine) ? sourceEndLine : sourceLineNumber,
              },
              reason: editableElement.dataset.previewReadOnlyReason,
            })
            : null
          if (decision && decision.directEdit !== 'supported') {
            editableElement.dataset.previewReadOnlyReason = editableElement.dataset.previewReadOnlyReason || 'source-only'
          }
          const isReadOnlyPreviewBlock = Boolean(editableElement.dataset.previewReadOnlyReason) || decision?.directEdit === 'unsupported'
          if (!previewEditingEnabled || !sourceLine || !onPreviewBlockEdit || isReadOnlyPreviewBlock) {
            editableElement.removeAttribute('contenteditable')
            editableElement.removeAttribute('spellcheck')
            editableElement.classList.remove('markdown-preview-editable-block')
            delete editableElement.dataset.previewOriginalText
            if (previewEditingEnabled && sourceLine && isReadOnlyPreviewBlock && onSourceEditRequest) {
              editableElement.classList.add('markdown-preview-source-only-block')
              editableElement.setAttribute('tabindex', '0')
              editableElement.setAttribute('aria-label', `第 ${sourceLine} 行需要在源码中编辑`)
              const hint = document.createElement(editableElement.tagName === 'LI' || editableElement.tagName === 'TD' || editableElement.tagName === 'TH' ? 'span' : 'div')
              hint.className = 'markdown-preview-source-only-hint no-export'
              hint.setAttribute('role', 'note')
              hint.setAttribute('contenteditable', 'false')
              hint.hidden = true
              hint.innerHTML = '<span>该内容需要在源码中编辑</span>'
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'markdown-preview-source-edit-btn'
              button.textContent = '在源码中编辑'
              button.dataset.sourceLine = sourceLine
              if (editableElement.dataset.sourceEndLine) button.dataset.sourceEndLine = editableElement.dataset.sourceEndLine
              hint.appendChild(button)
              const helpButton = document.createElement('button')
              helpButton.type = 'button'
              helpButton.className = 'markdown-preview-source-help-btn'
              helpButton.textContent = '查看源码编辑说明'
              hint.appendChild(helpButton)
              if (editableElement.tagName === 'LI' || editableElement.tagName === 'TD' || editableElement.tagName === 'TH') {
                editableElement.appendChild(hint)
              } else {
                editableElement.insertAdjacentElement('afterend', hint)
              }
            } else {
              editableElement.classList.remove('markdown-preview-source-only-block')
              editableElement.removeAttribute('tabindex')
              editableElement.removeAttribute('aria-label')
            }
            return
          }
          editableElement.classList.remove('markdown-preview-source-only-block')
          editableElement.removeAttribute('tabindex')
          editableElement.setAttribute('contenteditable', 'true')
          editableElement.setAttribute('spellcheck', 'true')
          editableElement.setAttribute('aria-label', `编辑第 ${sourceLine} 行渲染内容`)
          editableElement.classList.add('markdown-preview-editable-block')
          editableElement.dataset.previewOriginalText = normalizeRenderedText(editableElement.textContent || '')
        })
      }
    }, [deferredRenderVersion, filePath, html, onPreviewBlockEdit, onSourceEditRequest, previewEditingEnabled, sourceContent])

    useEffect(() => {
      const container = combinedRef.current
      if (!container || !onSourceEditRequest) return

      const getSourceOnlyHintForBlock = (block: HTMLElement): HTMLElement | null => {
        const inlineHint = block.querySelector<HTMLElement>(':scope > .markdown-preview-source-only-hint')
        if (inlineHint) return inlineHint
        const nextElement = block.nextElementSibling as HTMLElement | null
        return nextElement?.classList.contains('markdown-preview-source-only-hint') ? nextElement : null
      }

      const hideSourceOnlyHints = (except?: HTMLElement | null) => {
        container.querySelectorAll<HTMLElement>('.markdown-preview-source-only-hint').forEach(hint => {
          if (hint !== except) hint.hidden = true
        })
        container.querySelectorAll<HTMLElement>('.markdown-preview-source-only-block.is-source-hint-active').forEach(block => {
          const hint = getSourceOnlyHintForBlock(block)
          if (hint !== except) block.classList.remove('is-source-hint-active')
        })
      }

      const showSourceOnlyHint = (block: HTMLElement | null) => {
        if (!block || !container.contains(block)) return
        const hint = getSourceOnlyHintForBlock(block)
        if (!hint) return
        hideSourceOnlyHints(hint)
        hint.hidden = false
        block.classList.add('is-source-hint-active')
      }

      const handleSourceBlockFocusIn = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null
        showSourceOnlyHint(target?.closest<HTMLElement>('.markdown-preview-source-only-block') || null)
      }

      const handleSourceBlockMouseOver = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null
        showSourceOnlyHint(target?.closest<HTMLElement>('.markdown-preview-source-only-block') || null)
      }

      const handleSourceBlockKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        const block = target?.closest<HTMLElement>('.markdown-preview-source-only-block') || null
        if (!block) return
        if (event.key === 'Escape') {
          const hint = getSourceOnlyHintForBlock(block)
          if (hint) hint.hidden = true
          block.classList.remove('is-source-hint-active')
          block.blur()
        }
      }

      const handleSourceEditClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null
        const button = target?.closest<HTMLButtonElement>('.markdown-preview-source-edit-btn')
        if (!button || !container.contains(button)) return
        const sourceLine = Number(button.dataset.sourceLine)
        const sourceEndLine = button.dataset.sourceEndLine ? Number(button.dataset.sourceEndLine) : sourceLine
        if (!Number.isFinite(sourceLine)) return
        event.preventDefault()
        event.stopPropagation()
        onSourceEditRequest({
          sourceLine,
          ...(Number.isFinite(sourceEndLine) ? { sourceEndLine } : {}),
        })
      }

      const handleSourceHelpClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null
        const button = target?.closest<HTMLButtonElement>('.markdown-preview-source-help-btn')
        if (!button || !container.contains(button)) return
        event.preventDefault()
        event.stopPropagation()
        openHelpLink(SOURCE_EDIT_HELP_URL)
      }

      container.addEventListener('focusin', handleSourceBlockFocusIn)
      container.addEventListener('mouseover', handleSourceBlockMouseOver)
      container.addEventListener('keydown', handleSourceBlockKeyDown)
      container.addEventListener('click', handleSourceEditClick)
      container.addEventListener('click', handleSourceHelpClick)
      return () => {
        container.removeEventListener('focusin', handleSourceBlockFocusIn)
        container.removeEventListener('mouseover', handleSourceBlockMouseOver)
        container.removeEventListener('keydown', handleSourceBlockKeyDown)
        container.removeEventListener('click', handleSourceEditClick)
        container.removeEventListener('click', handleSourceHelpClick)
      }
    }, [combinedRef, onSourceEditRequest])

    useEffect(() => {
      const container = combinedRef.current
      if (!container || !previewEditingEnabled || !onPreviewBlockEdit) return

      const flushSkippedFocusedRender = (block: HTMLElement) => {
        if (!skippedFocusedRenderRef.current) return
        skippedFocusedRenderRef.current = false
        allowDeferredRenderBlockRef.current = block
        setDeferredRenderVersion(version => version + 1)
      }

      const buildPreviewEdit = (block: HTMLElement): PreviewBlockEdit | null => {
        const sourceLine = Number(block.dataset.sourceLine)
        if (!Number.isFinite(sourceLine)) return null
        const sourceEndLine = block.dataset.sourceEndLine ? Number(block.dataset.sourceEndLine) : undefined
        const tableCellIndex = block.dataset.tableCellIndex ? Number(block.dataset.tableCellIndex) : undefined
        const originalText = block.dataset.previewOriginalText || ''
        const nextText = normalizeRenderedText(block.textContent || '')
        if (nextText === originalText) return null

        const edit: PreviewBlockEdit = {
          sourceLine,
          originalText,
          nextText,
        }
        if (Number.isFinite(sourceEndLine)) edit.sourceEndLine = sourceEndLine
        if (block.dataset.previewEditKind) edit.editKind = block.dataset.previewEditKind as PreviewBlockEdit['editKind']
        if (Number.isFinite(tableCellIndex)) edit.tableCellIndex = tableCellIndex
        return edit
      }

      const clearPendingPreviewInputTimer = () => {
        if (previewInputCommitTimerRef.current !== null) {
          window.clearTimeout(previewInputCommitTimerRef.current)
          previewInputCommitTimerRef.current = null
        }
      }

      const commitPendingPreviewInput = (): boolean => {
        const pending = pendingPreviewEditRef.current
        if (!pending) return false
        clearPendingPreviewInputTimer()
        pendingPreviewEditRef.current = null
        pending.block.dataset.previewOriginalText = pending.edit.nextText
        onPreviewBlockEdit(pending.edit)
        return true
      }

      const handleInput = (event: Event) => {
        const target = event.target as HTMLElement | null
        const block = target?.closest('.markdown-preview-editable-block') as HTMLElement | null
        if (!block || !container.contains(block)) return

        const edit = buildPreviewEdit(block)
        if (!edit) return
        pendingPreviewEditRef.current = { block, edit }
        clearPendingPreviewInputTimer()
        previewInputCommitTimerRef.current = window.setTimeout(() => {
          commitPendingPreviewInput()
        }, 160)
      }

      const handleBlur = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null
        const block = target?.closest('.markdown-preview-editable-block') as HTMLElement | null
        if (!block || !container.contains(block)) return

        if (pendingPreviewEditRef.current?.block === block) {
          commitPendingPreviewInput()
          flushSkippedFocusedRender(block)
          return
        }

        const edit = buildPreviewEdit(block)
        if (!edit) {
          flushSkippedFocusedRender(block)
          return
        }
        block.dataset.previewOriginalText = edit.nextText
        allowDeferredRenderBlockRef.current = block
        onPreviewBlockEdit(edit)
      }

      const handleCompositionStart = (event: CompositionEvent) => {
        const target = event.target as HTMLElement | null
        const block = target?.closest('.markdown-preview-editable-block') as HTMLElement | null
        if (block && container.contains(block)) block.dataset.previewComposing = 'true'
      }

      const handleCompositionEnd = (event: CompositionEvent) => {
        const target = event.target as HTMLElement | null
        const block = target?.closest('.markdown-preview-editable-block') as HTMLElement | null
        if (block && container.contains(block)) delete block.dataset.previewComposing
      }

      container.addEventListener('input', handleInput, true)
      container.addEventListener('blur', handleBlur, true)
      container.addEventListener('compositionstart', handleCompositionStart, true)
      container.addEventListener('compositionend', handleCompositionEnd, true)
      return () => {
        commitPendingPreviewInput()
        container.removeEventListener('input', handleInput, true)
        container.removeEventListener('blur', handleBlur, true)
        container.removeEventListener('compositionstart', handleCompositionStart, true)
        container.removeEventListener('compositionend', handleCompositionEnd, true)
      }
    }, [combinedRef, onPreviewBlockEdit, previewEditingEnabled])

    // v1.6.0: 图表渲染 hooks（从 VirtualizedMarkdown 提取到独立模块）
    useMermaidChart(combinedRef, chartRenderKey)
    useEChartsChart(combinedRef, chartRenderKey)
    useInfographicChart(combinedRef, chartRenderKey)
    useMarkmapChart(combinedRef, chartRenderKey)
    useGraphvizChart(combinedRef, chartRenderKey)
    useDrawIOChart(combinedRef, chartRenderKey)
    usePlantUMLChart(combinedRef, chartRenderKey)
    useExcalidrawChart(combinedRef, chartRenderKey, { markdownFilePath: filePath })
    useVegaLiteChart(combinedRef, chartRenderKey)
    useD2Chart(combinedRef, chartRenderKey)
    useBpmnChart(combinedRef, chartRenderKey, { markdownFilePath: filePath })
    useWaveDromChart(combinedRef, chartRenderKey)
    useStructurizrChart(combinedRef, chartRenderKey)
    usePlotlyChart(combinedRef, chartRenderKey)
    useDbmlChart(combinedRef, chartRenderKey)
    useAntvG6Chart(combinedRef, chartRenderKey)
    useKrokiChart(combinedRef, chartRenderKey)

    // 处理锚点链接点击
    useEffect(() => {
      if (!combinedRef.current) return

      const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement

        if (previewEditingEnabled && target.closest('.markdown-preview-editable-block')) {
          return
        }

        // v1.5.1: 图片点击 → Lightbox
        const img = target.tagName === 'IMG' ? target : target.closest('img')
        if (img && onImageClick) {
          // 不拦截链接内的图片（让链接逻辑处理）
          if (!img.closest('a')) {
            e.preventDefault()
            const allImages = Array.from(combinedRef.current!.querySelectorAll('img'))
            const srcs = allImages.map(i => i.getAttribute('src') || '')
            const index = allImages.indexOf(img as HTMLImageElement)
            onImageClick({
              src: (img as HTMLImageElement).getAttribute('src') || '',
              alt: (img as HTMLImageElement).getAttribute('alt') || '',
              images: srcs,
              currentIndex: Math.max(0, index)
            })
            return
          }
        }

        const anchor = target.closest('a')
        if (!anchor) return

        const href = anchor.getAttribute('href')
        if (!href) return

        // 1. 锚点链接：页内跳转
        if (href.startsWith('#')) {
          e.preventDefault()
          const targetElement = findInPageAnchorTarget(combinedRef.current, href)
          if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          return
        }

        // 2. 外部链接：系统浏览器打开
        if (href.startsWith('http://') || href.startsWith('https://')) {
          e.preventDefault()
          window.api.openExternal(href)
          return
        }

        // 3. v1.5.1: 本地 .md 链接：优先交给上层统一导航，兼容旧调用路径
        const decodedHref = safeDecodeURIComponent(href)
        if (decodedHref.endsWith('.md') || /\.md[#?]/.test(decodedHref)) {
          e.preventDefault()
          if (filePath) {
            if (onMarkdownLinkClick) {
              void onMarkdownLinkClick(decodedHref, filePath)
              return
            }
            const cleanHref = decodedHref.split('#')[0].split('?')[0]
            window.api.openMdLink(filePath, cleanHref).then((result) => {
              if (result && !result.success) {
                // 通过自定义事件通知 App 显示 Toast
                window.dispatchEvent(new CustomEvent('md-link-error', {
                  detail: { error: result.error || '文件不存在' }
                }))
              }
            }).catch(() => {
              window.dispatchEvent(new CustomEvent('md-link-error', {
                detail: { error: '链接跳转失败' }
              }))
            })
          }
          return
        }

        // 4. 其他链接（相对路径等）：阻止默认导航，防止白屏
        e.preventDefault()
      }

      combinedRef.current.addEventListener('click', handleClick)
      return () => combinedRef.current?.removeEventListener('click', handleClick)
    }, [html, filePath, onImageClick, previewEditingEnabled, onMarkdownLinkClick])

    // v1.5.2: 为普通代码块添加复制按钮
    useEffect(() => {
      if (!combinedRef.current) return

      // 查找所有 pre > code 代码块，排除 Mermaid 和 ECharts（它们有自己的复制按钮）
      const codeBlocks = combinedRef.current.querySelectorAll('pre:not(.language-mermaid):not(.language-echarts):not(.language-markmap):not(.language-graphviz):not(.language-drawio):not(.language-plantuml):not(.language-excalidraw):not(.language-vega-lite):not(.language-d2):not(.language-bpmn):not(.language-wavedrom):not(.language-structurizr):not(.language-plotly):not(.language-dbml):not(.language-antv-g6):not(.language-kroki)')

      codeBlocks.forEach((pre) => {
        // 跳过已经有复制按钮的代码块
        if (pre.querySelector('.copy-btn')) return
        // 跳过图表代码视图中的代码块（已有复制按钮）
        if (pre.closest('.echarts-code-view') || pre.closest('.infographic-code-view') || pre.closest('.markmap-code-view') || pre.closest('.graphviz-code-view') || pre.closest('.vega-lite-code-view') || pre.closest('.d2-code-view') || pre.closest('.bpmn-code-view') || pre.closest('.wavedrom-code-view') || pre.closest('.structurizr-code-view') || pre.closest('.plotly-code-view') || pre.closest('.dbml-code-view') || pre.closest('.antv-g6-code-view') || pre.closest('.kroki-code-view') || pre.closest('.drawio-code-view') || pre.closest('.mermaid-code-view') || pre.closest('.plantuml-code-view') || pre.closest('.excalidraw-code-view')) return

        const code = pre.querySelector('code')
        if (!code) return

        // 设置 pre 为相对定位以支持绝对定位的按钮
        ;(pre as HTMLElement).style.position = 'relative'

        // 创建复制按钮
        const copyBtn = document.createElement('button')
        copyBtn.className = 'copy-btn no-export'
        copyBtn.textContent = '复制'
        copyBtn.title = '复制代码'

        pre.appendChild(copyBtn)
      })
    }, [html])

    // v1.5.2: 统一处理所有复制按钮的点击事件（事件委托）
    useEffect(() => {
      if (!combinedRef.current) return

      const handleCopyClick = async (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (!target.classList.contains('copy-btn')) return

        e.preventDefault()
        e.stopPropagation()

        let textToCopy = ''

        // 判断复制按钮所在的容器类型
        const mermaidCodeView = target.closest('.mermaid-code-view')
        const echartsCodeView = target.closest('.echarts-code-view')
        const markmapCodeView = target.closest('.markmap-code-view')
        const graphvizCodeView = target.closest('.graphviz-code-view')
        const preBlock = target.closest('pre')
        const decodeChartCode = (wrapper: Element | null, attribute: string): string => {
          const base64Code = wrapper?.getAttribute(attribute)
          if (!base64Code) return ''
          try {
            return decodeURIComponent(escape(atob(base64Code)))
          } catch {
            return ''
          }
        }

        if (mermaidCodeView) {
          // Mermaid 代码视图：从 wrapper 的 data-mermaid-code 获取
          const wrapper = mermaidCodeView.closest('.mermaid-wrapper')
          const base64Code = wrapper?.getAttribute('data-mermaid-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (echartsCodeView) {
          // ECharts 代码视图：从 wrapper 的 data-echarts-config 获取
          const wrapper = echartsCodeView.closest('.echarts-wrapper')
          const base64Config = wrapper?.getAttribute('data-echarts-config')
          if (base64Config) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Config)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (markmapCodeView) {
          // Markmap 代码视图：从 wrapper 的 data-markmap-code 获取
          const wrapper = markmapCodeView.closest('.markmap-wrapper')
          const base64Code = wrapper?.getAttribute('data-markmap-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (graphvizCodeView) {
          // Graphviz 代码视图：从 wrapper 的 data-graphviz-code 获取
          const wrapper = graphvizCodeView.closest('.graphviz-wrapper')
          const base64Code = wrapper?.getAttribute('data-graphviz-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (target.closest('.vega-lite-code-view')) {
          textToCopy = decodeChartCode(target.closest('.vega-lite-wrapper'), 'data-vega-lite-code')
        } else if (target.closest('.d2-code-view')) {
          textToCopy = decodeChartCode(target.closest('.d2-wrapper'), 'data-d2-code')
        } else if (target.closest('.bpmn-code-view')) {
          textToCopy = decodeChartCode(target.closest('.bpmn-wrapper'), 'data-bpmn-code')
        } else if (target.closest('.wavedrom-code-view')) {
          textToCopy = decodeChartCode(target.closest('.wavedrom-wrapper'), 'data-wavedrom-code')
        } else if (target.closest('.structurizr-code-view')) {
          textToCopy = decodeChartCode(target.closest('.structurizr-wrapper'), 'data-structurizr-code')
        } else if (target.closest('.plotly-code-view')) {
          textToCopy = decodeChartCode(target.closest('.plotly-wrapper'), 'data-plotly-code')
        } else if (target.closest('.dbml-code-view')) {
          textToCopy = decodeChartCode(target.closest('.dbml-wrapper'), 'data-dbml-code')
        } else if (target.closest('.antv-g6-code-view')) {
          textToCopy = decodeChartCode(target.closest('.antv-g6-wrapper'), 'data-antv-g6-code')
        } else if (target.closest('.kroki-code-view')) {
          textToCopy = decodeChartCode(target.closest('.kroki-wrapper'), 'data-kroki-code')
        } else if (target.closest('.drawio-code-view')) {
          // DrawIO 代码视图：从 wrapper 的 data-drawio-code 获取
          const wrapper = target.closest('.drawio-wrapper')
          const base64Code = wrapper?.getAttribute('data-drawio-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (target.closest('.excalidraw-code-view')) {
          // Excalidraw 代码视图：从 wrapper 的 data-excalidraw-code 获取
          const wrapper = target.closest('.excalidraw-wrapper')
          const base64Code = wrapper?.getAttribute('data-excalidraw-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
        } else if (target.closest('.plantuml-code-view')) {
          // PlantUML 代码视图：从 wrapper 的 data-plantuml-code 获取
          textToCopy = decodeChartCode(target.closest('.plantuml-wrapper, .c4plantuml-wrapper'), 'data-plantuml-code')
        } else if (preBlock) {
          // 普通代码块：获取 code 元素的纯文本内容
          const code = preBlock.querySelector('code')
          textToCopy = code?.textContent || preBlock.textContent || ''
        }

        if (!textToCopy) return

        try {
          await navigator.clipboard.writeText(textToCopy)
          target.textContent = '已复制'
          target.classList.add('copied')
          setTimeout(() => {
            target.textContent = '复制'
            target.classList.remove('copied')
          }, 2000)
        } catch (err) {
          console.error('复制失败:', err)
          target.textContent = '失败'
          setTimeout(() => {
            target.textContent = '复制'
          }, 2000)
        }
      }

      combinedRef.current.addEventListener('click', handleCopyClick)
      return () => combinedRef.current?.removeEventListener('click', handleCopyClick)
    }, [html])

    return (
      <div
        ref={combinedRef}
        className={`markdown-body ${className}`}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        tabIndex={onContextMenu ? 0 : undefined}
        aria-label={onContextMenu ? 'Markdown 预览区' : undefined}
      />
    )
  }),
  // 自定义比较函数：只有 html 变化时才重渲染
  (prevProps, nextProps) =>
    prevProps.html === nextProps.html &&
    prevProps.className === nextProps.className &&
    prevProps.filePath === nextProps.filePath &&
    prevProps.sourceContent === nextProps.sourceContent &&
    prevProps.previewEditingEnabled === nextProps.previewEditingEnabled &&
    prevProps.onImageClick === nextProps.onImageClick &&
    prevProps.onPreviewBlockEdit === nextProps.onPreviewBlockEdit &&
    prevProps.onSourceEditRequest === nextProps.onSourceEditRequest &&
    prevProps.onMarkdownLinkClick === nextProps.onMarkdownLinkClick
)

export default memo(VirtualizedMarkdown)
