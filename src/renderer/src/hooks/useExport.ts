import { useCallback, useMemo, useRef } from 'react'
import { Tab } from '../components/TabBar'
import { SplitState, findLeaf } from '../utils/splitTree'
import { buildExportHtmlContent } from '../utils/exportHtml'
import { renderChartsForDocx } from '../utils/docxChartRenderer'
import { useExportTaskStore } from '../stores/exportTaskStore'
import { createExportGuard } from '../utils/exportGuard'
import { useEditSessionStore } from '../stores/editSessionStore'

interface UseExportParams {
  splitState: SplitState
  tabs: Tab[]
  activeTabId: string | null
  folderPath: string | null
  toast: {
    info: (msg: string, options?: { duration?: number; progress?: { current: number; total: number; label?: string; cancelable?: boolean; onCancel?: () => void } }) => string
    close: (id: string) => void
    update: (id: string, updates: { message?: string; description?: string; progress?: { current: number; total: number; label?: string; cancelable?: boolean; onCancel?: () => void }; action?: { label: string; onClick: () => void }; actions?: { label: string; onClick: () => void }[] }) => void
    success: (msg: string, options?: { description?: string; duration?: number; action?: { label: string; onClick: () => void }; actions?: { label: string; onClick: () => void }[] }) => void
    error: (msg: string) => void
  }
  saveBeforeExport?: (canonicalPath: string) => Promise<boolean | void>
}

interface UseExportReturn {
  handleExportHTML: () => Promise<void>
  handleExportPDF: () => Promise<void>
  handleExportDOCX: (docStyle?: string) => Promise<void>
}

function getExportContent(tab: Tab): string {
  const session = Object.values(useEditSessionStore.getState().sessions).find(item =>
    item.displayPath === tab.file.path || item.canonicalPath === tab.file.path
  )
  return session?.draft ?? tab.content
}

export function waitForExportFeedbackPaint(): Promise<void> {
  return new Promise(resolve => {
    const scheduleAfterPaint = () => setTimeout(resolve, 0)
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => scheduleAfterPaint())
    } else {
      scheduleAfterPaint()
    }
  })
}

export function useExport({ splitState, tabs, activeTabId, folderPath, toast, saveBeforeExport }: UseExportParams): UseExportReturn {
  const cancelledRef = useRef(false)
  const exportGuard = useMemo(() => createExportGuard({ toast, saveBeforeExport }), [toast, saveBeforeExport])

  // 计算当前活动标签
  // 分屏模式：通过 splitState 找到活跃叶子面板的 tab
  // 非分屏模式：直接通过 activeTabId 查找
  const activeTab = useMemo(() => {
    if (splitState.root && splitState.activeLeafId) {
      const activeLeaf = findLeaf(splitState.root, splitState.activeLeafId)
      if (activeLeaf) {
        return tabs.find(t => t.id === activeLeaf.tabId)
      }
    }
    // 非分屏模式 fallback
    if (activeTabId) {
      return tabs.find(t => t.id === activeTabId)
    }
    return undefined
  }, [splitState, tabs, activeTabId])

  // 导出 HTML：统一使用 buildExportHtmlContent（和文件树右键路径共享）
  const handleExportHTML = useCallback(async () => {
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    if (!(await exportGuard(exportTab.file.path))) return
    const exportContent = getExportContent(exportTab)
    let loadingId: string | undefined
    try {
      loadingId = toast.info('正在导出 HTML...', { duration: 60000 })
      await waitForExportFeedbackPaint()
      const htmlContent = await buildExportHtmlContent(exportContent, { markdownFilePath: exportTab.file.path })
      const filePath = await window.api.exportHTML(htmlContent, exportTab.file.name)
      toast.close(loadingId)
      if (filePath) {
        toast.success(`HTML 已导出`, {
          action: { label: '点击查看', onClick: async () => { try { await window.api.showItemInFolder(filePath) } catch (error) { console.error('Failed to show item:', error) } } }
        })
      }
    } catch (error) {
      if (loadingId) toast.close(loadingId)
      console.error('导出 HTML 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, exportGuard, splitState, tabs, toast])

  // 导出 PDF：和 HTML 共用 buildExportHtmlContent
  const handleExportPDF = useCallback(async () => {
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    if (!(await exportGuard(exportTab.file.path))) return
    const exportContent = getExportContent(exportTab)
    let loadingId: string | undefined
    try {
      loadingId = toast.info('正在导出 PDF...', { duration: 60000 })
      await waitForExportFeedbackPaint()
      const htmlContent = await buildExportHtmlContent(exportContent, { markdownFilePath: exportTab.file.path })
      const filePath = await window.api.exportPDF(htmlContent, exportTab.file.name)
      toast.close(loadingId)
      if (filePath) {
        toast.success(`PDF 已导出`, {
          action: { label: '点击查看', onClick: async () => { try { await window.api.showItemInFolder(filePath) } catch (error) { console.error('Failed to show item:', error) } } }
        })
      }
    } catch (error) {
      if (loadingId) toast.close(loadingId)
      console.error('导出 PDF 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, exportGuard, splitState, tabs, toast])

  // 导出 DOCX
  const handleExportDOCX = useCallback(async (docStyle?: string) => {
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    if (!(await exportGuard(exportTab.file.path))) return
    const exportContent = getExportContent(exportTab)
    let loadingId: string | undefined
    try {
      let markdownForExport = exportContent
      let remoteImages: Array<{ id: string; pngBase64: string; widthCm?: number }> | undefined
      let chartWarnings: string[] = []
      const store = useExportTaskStore.getState()
      let useRemotePath = false
      let shouldRenderCharts = false

      try {
        const settings = await window.api.getAppSettings()
        shouldRenderCharts = Boolean(
          settings.docxExport?.remoteEnabled && settings.docxExport?.serverUrl
        ) || Boolean(settings.docxExport?.localFallbackEnabled)

        if (settings.docxExport?.remoteEnabled && settings.docxExport?.serverUrl) {
          useRemotePath = true
        }
      } catch (settingsErr) {
        console.warn('[DOCX] Failed to read export settings, using offline export path:', settingsErr)
      }

      if (useRemotePath) {
        if (store.status !== 'idle') return
        store.startExport(exportTab.file.name)
        cancelledRef.current = false
      } else {
        loadingId = toast.info('正在生成 Word 文档...', { duration: 120000 })
      }
      await waitForExportFeedbackPaint()

      let htmlContent: string
      const markdownBody = document.querySelector('.split-leaf-panel.active .markdown-body')
      if (markdownBody) {
        const clone = markdownBody.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.copy-button, .line-numbers-wrapper, .no-export').forEach(el => el.remove())
        clone.querySelectorAll('.echarts-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        clone.querySelectorAll('.infographic-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        const clonedContainers = clone.querySelectorAll('.echarts-container')
        clonedContainers.forEach((container) => {
          const svg = container.querySelector('svg')
          if (!svg) return
          let vbWidth: number, vbHeight: number
          const viewBox = svg.getAttribute('viewBox')
          if (viewBox) {
            const parts = viewBox.split(/\s+/)
            if (parts.length === 4) { vbWidth = parseFloat(parts[2]); vbHeight = parseFloat(parts[3]) }
            else { vbWidth = 600; vbHeight = 400 }
          } else {
            const bgRect = svg.querySelector('rect')
            if (bgRect) { vbWidth = parseFloat(bgRect.getAttribute('width') || '600'); vbHeight = parseFloat(bgRect.getAttribute('height') || '400') }
            else { vbWidth = parseFloat(svg.getAttribute('width') || '600'); vbHeight = parseFloat(svg.getAttribute('height') || '400') }
            svg.setAttribute('viewBox', `0 0 ${vbWidth} ${vbHeight}`)
          }
          const exportWidth = 624
          const aspectRatio = vbHeight / vbWidth
          const exportHeight = Math.round(exportWidth * aspectRatio)
          svg.setAttribute('width', String(exportWidth)); svg.setAttribute('height', String(exportHeight))
          svg.style.cssText = 'display: block;'
          const innerDiv = svg.parentElement
          if (innerDiv && innerDiv !== container) { container.appendChild(svg); innerDiv.remove() }
          const el = container as HTMLElement
          el.removeAttribute('_echarts_instance_'); el.removeAttribute('data-echarts-index')
          el.style.cssText = ''
        })
        const mermaidContainers = clone.querySelectorAll('.mermaid-container')
        mermaidContainers.forEach((container) => {
          const svg = container.querySelector('svg')
          if (!svg) return
          const mViewBox = svg.getAttribute('viewBox')
          if (mViewBox) {
            const parts = mViewBox.split(/\s+/)
            if (parts.length === 4) {
              const vbW = parseFloat(parts[2]); const vbH = parseFloat(parts[3])
              const expW = 624; const ar = vbH / vbW
              svg.setAttribute('width', String(expW)); svg.setAttribute('height', String(Math.round(expW * ar)))
              svg.style.cssText = 'display: block;'
            }
          } else { svg.setAttribute('width', '624'); svg.setAttribute('height', '400'); svg.style.cssText = 'display: block;' }
        })
        const codeBlocks = clone.querySelectorAll('pre')
        const codeBlockPromises: Promise<void>[] = []
        const isAsciiArt = (text: string): boolean => {
          const lines = text.split('\n').filter(l => l.trim())
          if (lines.length < 3) return false
          if (/[┌┐└┘├┤┬┴┼─│┃┏┓┗┛┣┫┳┻╋━┠┨┯┷┿╂]/.test(text)) return true
          let borderLines = 0; let pipeLines = 0
          for (const line of lines) {
            const trimmed = line.trim()
            if (/^[+][=\-]+[+]$/.test(trimmed) && trimmed.length > 5) borderLines++
            if (/^\|.+\|$/.test(trimmed) && trimmed.length > 3) pipeLines++
          }
          if (borderLines >= 2 && pipeLines >= 2) return true
          const hasCheckbox = /\[[✓✗xX ]\]/.test(text)
          const hasRadio = /\([•●○ ]\)/.test(text)
          const hasSlider = /\|[=○●]+\|/.test(text)
          if ((hasCheckbox || hasRadio || hasSlider) && pipeLines >= 3) return true
          return false
        }
        const shouldConvertToImage = (pre: Element, text: string): boolean => {
          const code = pre.querySelector('code')
          const allClasses = (pre.className || '') + ' ' + (code?.className || '')
          const langMatch = allClasses.match(/language-(\w+)/)
          if (langMatch) {
            const lang = langMatch[1].toLowerCase()
            if (!['plaintext', 'text', 'ascii', ''].includes(lang)) return false
          }
          return isAsciiArt(text)
        }
        codeBlocks.forEach((pre) => {
          const code = pre.querySelector('code')
          if (!code) return
          const text = code.textContent || ''
          if (shouldConvertToImage(pre, text)) {
            const promise = (async () => {
              try {
                const result = await window.api.renderCodeBlockToPng(text)
                if (result.success && result.data) {
                  if (result.data.length < 200) return
                  const img = document.createElement('img')
                  img.src = `data:image/png;base64,${result.data}`
                  img.alt = 'ASCII Art'
                  img.style.cssText = 'display: block; max-width: 100%;'
                  if (result.width && result.height) { img.width = result.width; img.height = result.height }
                  pre.replaceWith(img)
                }
              } catch { /* 失败时保留原始代码块 */ }
            })()
            codeBlockPromises.push(promise)
          }
        })
        if (codeBlockPromises.length > 0) await Promise.all(codeBlockPromises)
        htmlContent = clone.innerHTML
      } else {
        htmlContent = await buildExportHtmlContent(exportContent, { markdownFilePath: exportTab.file.path })
      }

      try {
        if (shouldRenderCharts) {
          const chartResult = await renderChartsForDocx(exportContent, {
            markdownFilePath: exportTab.file.path,
            onProgress: useRemotePath
              ? (current, total, type) => {
                  if (cancelledRef.current) return
                  useExportTaskStore.getState().updateChartProgress(current, total, type)
                }
              : undefined,
          })
          if (cancelledRef.current) {
            useExportTaskStore.getState().close()
            return
          }
          markdownForExport = chartResult.modifiedMarkdown
          remoteImages = chartResult.images
          chartWarnings = chartResult.warnings
        }
      } catch (chartErr) {
        console.warn('[DOCX] Chart rendering failed, exporting without charts:', chartErr)
        chartWarnings.push(`图表渲染失败: ${chartErr instanceof Error ? chartErr.message : String(chartErr)}`)
      }

      if (useRemotePath) {
        useExportTaskStore.getState().setGenerating()
      }

      const result = await window.api.exportDOCX(htmlContent, exportTab.file.name, folderPath || '', markdownForExport, docStyle, remoteImages) as any

      if (loadingId) toast.close(loadingId)

      if (result?.error) {
        const detail = result.error
        useExportTaskStore.getState().setError(detail.message, detail)
        return
      }

      if (result) {
        const { filePath, usedPandoc, usedRemote, imagesFailed } = result
        const warnings = [...(result.warnings || []), ...chartWarnings]
        const openFolder = { label: '打开位置', onClick: async () => { try { await window.api.showItemInFolder(filePath) } catch (e) { console.error('Failed to show item:', e) } } }

        if (usedRemote && useRemotePath) {
          useExportTaskStore.getState().setDone(filePath, imagesFailed || 0, warnings)
        } else if (usedPandoc) {
          const styleLabel = docStyle === 'gongwen' ? '公文格式' : 'Pandoc'
          const hasRemoteFallbackWarning = warnings?.some(w => w.startsWith('远程服务失败'))
          if (hasRemoteFallbackWarning) {
            toast.success('Word 已导出（DOCX 服务暂时不可用，本次使用离线模式，图表显示为代码文本）', { action: openFolder })
          } else {
            const message = warnings && warnings.length > 0
              ? `Word 已导出（${styleLabel}，${warnings.length} 个警告）`
              : `Word 已导出（${styleLabel}）`
            toast.success(message, { action: openFolder })
          }
        } else {
          const hasRemoteFallbackWarning = warnings?.some(w => w.startsWith('远程服务失败'))
          if (hasRemoteFallbackWarning) {
            toast.success('Word 已导出（DOCX 服务暂时不可用，本次使用离线模式，图表显示为代码文本）', { action: openFolder })
          } else {
            toast.success('Word 已导出（离线模式）', {
              description: '图表和线框图显示为代码文本',
              action: openFolder
            })
          }
        }
      }
    } catch (error) {
      if (loadingId) toast.close(loadingId)
      console.error('导出 DOCX 失败:', error)
      const errMsg = error instanceof Error ? error.message : '未知错误'
      if (useExportTaskStore.getState().status !== 'idle') {
        useExportTaskStore.getState().setError(`导出失败：${errMsg}`)
      } else {
        toast.error(`导出失败：${errMsg}`)
      }
    }
  }, [activeTab, exportGuard, splitState, tabs, folderPath, toast])

  return {
    handleExportHTML,
    handleExportPDF,
    handleExportDOCX
  }
}
