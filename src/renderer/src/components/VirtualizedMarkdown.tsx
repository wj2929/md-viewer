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
} from './charts'

// v1.4.0: 页面内搜索
import { useFileStore } from '../stores/fileStore'
import { useInPageSearch } from '../hooks/useInPageSearch'
import { InPageSearchBox } from './search'

/**
 * v1.4.6: 已移除本地的 createMarkdownInstance
 * 改用 markdownRenderer.ts 中的统一配置
 */

interface VirtualizedMarkdownProps {
  content: string
  className?: string
  filePath?: string
  scrollToLine?: number
  onScrollToLineComplete?: () => void
  highlightKeyword?: string
  onHighlightKeywordComplete?: () => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
}

/**
 * Markdown 渲染器
 */
export function VirtualizedMarkdown({ content, className = '', filePath, scrollToLine, onScrollToLineComplete, highlightKeyword, onHighlightKeywordComplete, onImageClick }: VirtualizedMarkdownProps): JSX.Element {

  // v1.3.7：右键菜单处理（添加书签 + 原有功能）
  const folderPath = useFileStore(state => state.folderPath)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!filePath) return

    // 判断右键点击的元素
    const target = e.target as HTMLElement
    const heading = target.closest('h1, h2, h3, h4, h5, h6')

    // 检测是否有选中文本
    const selection = window.getSelection()
    const hasSelection = selection !== null && selection.toString().trim().length > 0

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
      headingId: heading?.id || null,
      headingText: heading?.textContent || null,
      headingLevel: heading?.tagName.toLowerCase() || null,
      hasSelection,
      linkHref,
      basePath: folderPath || null
    }).catch(error => {
      console.error('[VirtualizedMarkdown] Failed to show context menu:', error)
    })
  }, [filePath, folderPath])

  // 统一的链接点击处理（覆盖虚拟滚动和非虚拟滚动路径）
  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href) return

    // 锚点链接：页内跳转
    if (href.startsWith('#')) {
      e.preventDefault()
      const targetId = decodeURIComponent(href.slice(1))
      // 精确匹配
      let targetElement = document.getElementById(targetId)
      // fallback：normalize 后模糊匹配（容忍下划线等 slug 差异）
      if (!targetElement) {
        const normalize = (s: string) => s.replace(/[_]/g, '').toLowerCase()
        const normalizedTarget = normalize(targetId)
        const headings = document.querySelectorAll('[id]')
        for (const el of headings) {
          if (normalize(el.id) === normalizedTarget) {
            targetElement = el as HTMLElement
            break
          }
        }
      }
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      return
    }

    // 外部链接：系统浏览器打开
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault()
      window.api.openExternal(href)
      return
    }

    // v1.5.1: 本地 .md 链接：通过 IPC 打开
    const decodedHref = decodeURIComponent(href)
    if (decodedHref.endsWith('.md') || /\.md[#?]/.test(decodedHref)) {
      e.preventDefault()
      const cleanHref = decodedHref.split('#')[0].split('?')[0]
      if (filePath) {
        window.api.openMdLink(filePath, cleanHref)
      }
      return
    }

    // 其他链接：阻止默认导航，防止白屏
    e.preventDefault()
  }, [filePath])

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
      onContextMenu={handleContextMenu}
      onImageClick={onImageClick}
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
  onContextMenu,
  onImageClick
}: {
  content: string
  md: MarkdownIt
  className: string
  filePath?: string
  onContextMenu?: (e: React.MouseEvent) => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // v1.4.3: 防抖状态 - 延迟渲染以提升性能
  const [debouncedContent, setDebouncedContent] = useState(content)

  // v1.4.3: 防抖更新内容（300ms 延迟）
  useEffect(() => {
    const debouncedUpdate = debounce(() => {
      setDebouncedContent(content)
    }, 300)

    debouncedUpdate()

    return () => {
      debouncedUpdate.cancel()
    }
  }, [content])

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
        onContextMenu={onContextMenu}
        onImageClick={onImageClick}
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
    onContextMenu?: (e: React.MouseEvent) => void
    onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
  }>(function MarkdownContent({ html, className, filePath, onContextMenu, onImageClick }, ref) {
    const internalRef = useRef<HTMLDivElement>(null)
    const combinedRef = (ref as React.RefObject<HTMLDivElement>) || internalRef

    // 只在 html 变化时更新 DOM
    useEffect(() => {
      if (combinedRef.current) {
        combinedRef.current.innerHTML = html
      }
    }, [html])

    // 本地图片路径转换：将相对路径转为 local-image:// 协议
    useEffect(() => {
      if (!combinedRef.current || !filePath) return

      const images = combinedRef.current.querySelectorAll('img')
      images.forEach((img) => {
        const src = img.getAttribute('src')
        if (!src) return
        // 跳过已处理的、网络图片、data URI、blob
        if (
          src.startsWith('local-image://') ||
          src.startsWith('http://') ||
          src.startsWith('https://') ||
          src.startsWith('data:') ||
          src.startsWith('blob:')
        ) {
          return
        }
        // 基于当前 Markdown 文件所在目录解析相对路径
        const dir = filePath.substring(0, filePath.lastIndexOf('/'))
        let absolutePath: string
        if (src.startsWith('/')) {
          absolutePath = src
        } else {
          absolutePath = dir + '/' + src
        }
        // 路径规范化（处理 ../ 和 ./）
        const parts = absolutePath.split('/')
        const normalized: string[] = []
        for (const part of parts) {
          if (part === '..') normalized.pop()
          else if (part !== '.' && part !== '') normalized.push(part)
        }
        absolutePath = '/' + normalized.join('/')
        img.setAttribute('src', `local-image://${absolutePath}`)
      })
    }, [html, filePath])

    // v1.6.0: 图表渲染 hooks（从 VirtualizedMarkdown 提取到独立模块）
    useMermaidChart(combinedRef, html)
    useEChartsChart(combinedRef, html)
    useInfographicChart(combinedRef, html)
    useMarkmapChart(combinedRef, html)
    useGraphvizChart(combinedRef, html)
    useDrawIOChart(combinedRef, html)
    usePlantUMLChart(combinedRef, html)

    // 为标题添加 id 属性
    useEffect(() => {
      if (!combinedRef.current) return

      const headings = combinedRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
      const usedIds = new Set<string>()

      headings.forEach((heading) => {
        if (heading.id) return

        const text = heading.textContent || ''
        let slug = text
          .toLowerCase()
          .trim()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')

        let uniqueSlug = slug
        let counter = 1
        while (usedIds.has(uniqueSlug)) {
          uniqueSlug = `${slug}-${counter}`
          counter++
        }
        usedIds.add(uniqueSlug)
        heading.id = uniqueSlug
      })
    }, [html])

    // 处理锚点链接点击
    useEffect(() => {
      if (!combinedRef.current) return

      const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement

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
          const targetId = decodeURIComponent(href.slice(1))
          // 精确匹配
          let targetElement = document.getElementById(targetId)
          // fallback：normalize 后模糊匹配（容忍下划线等 slug 差异）
          if (!targetElement) {
            const normalize = (s: string) => s.replace(/[_]/g, '').toLowerCase()
            const normalizedTarget = normalize(targetId)
            const headings = document.querySelectorAll('[id]')
            for (const el of headings) {
              if (normalize(el.id) === normalizedTarget) {
                targetElement = el as HTMLElement
                break
              }
            }
          }
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

        // 3. v1.5.1: 本地 .md 链接：通过 IPC 打开
        const decodedHref = decodeURIComponent(href)
        if (decodedHref.endsWith('.md') || /\.md[#?]/.test(decodedHref)) {
          e.preventDefault()
          const cleanHref = decodedHref.split('#')[0].split('?')[0]
          if (filePath) {
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
    }, [html, filePath, onImageClick])

    // v1.5.2: 为普通代码块添加复制按钮
    useEffect(() => {
      if (!combinedRef.current) return

      // 查找所有 pre > code 代码块，排除 Mermaid 和 ECharts（它们有自己的复制按钮）
      const codeBlocks = combinedRef.current.querySelectorAll('pre:not(.language-mermaid):not(.language-echarts):not(.language-markmap):not(.language-graphviz):not(.language-drawio):not(.language-plantuml)')

      codeBlocks.forEach((pre) => {
        // 跳过已经有复制按钮的代码块
        if (pre.querySelector('.copy-btn')) return
        // 跳过 ECharts/Infographic/Markmap/Graphviz 代码视图中的代码块（已有复制按钮）
        if (pre.closest('.echarts-code-view') || pre.closest('.infographic-code-view') || pre.closest('.markmap-code-view') || pre.closest('.graphviz-code-view') || pre.closest('.drawio-code-view') || pre.closest('.mermaid-code-view') || pre.closest('.plantuml-code-view')) return

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
        } else if (target.closest('.plantuml-code-view')) {
          // PlantUML 代码视图：从 wrapper 的 data-plantuml-code 获取
          const wrapper = target.closest('.plantuml-wrapper')
          const base64Code = wrapper?.getAttribute('data-plantuml-code')
          if (base64Code) {
            try {
              textToCopy = decodeURIComponent(escape(atob(base64Code)))
            } catch {
              textToCopy = ''
            }
          }
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
      />
    )
  }),
  // 自定义比较函数：只有 html 变化时才重渲染
  (prevProps, nextProps) => prevProps.html === nextProps.html && prevProps.className === nextProps.className
)

export default memo(VirtualizedMarkdown)
