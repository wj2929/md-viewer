import { useCallback, useMemo } from 'react'
import { Tab } from '../components/TabBar'
import { SplitState, findLeaf } from '../utils/splitTree'
import { createMarkdownRenderer } from '../utils/markdownRenderer'
import { processMermaidInHtml } from '../utils/mermaidRenderer'
import { processEChartsInHtml } from '../utils/echartsRenderer'
import { processInfographicInHtml } from '../utils/infographicRenderer'
import { processMarkmapInHtml } from '../utils/markmapRenderer'
import { processGraphvizInHtml } from '../utils/graphvizRenderer'
import { processDrawioInHtml } from '../utils/drawioRenderer'
import { processPlantUMLInHtml } from '../utils/plantumlRenderer'
import * as echarts from 'echarts'

interface UseExportParams {
  splitState: SplitState
  tabs: Tab[]
  activeTabId: string | null
  folderPath: string | null
  toast: {
    info: (msg: string, options?: { duration?: number }) => string
    close: (id: string) => void
    success: (msg: string, options?: { description?: string; duration?: number; action?: { label: string; onClick: () => void } }) => void
    error: (msg: string) => void
  }
}

interface UseExportReturn {
  handleExportHTML: () => Promise<void>
  handleExportPDF: () => Promise<void>
  handleExportDOCX: (docStyle?: string) => Promise<void>
}

export function useExport({ splitState, tabs, activeTabId, folderPath, toast }: UseExportParams): UseExportReturn {
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

  // 导出前禁用 ECharts 动画，确保 SVG 是最终状态
  async function prepareEChartsForExport(markdownBody: Element): Promise<() => void> {
    const instances: echarts.ECharts[] = []
    markdownBody.querySelectorAll('.echarts-container').forEach((container) => {
      const instance = echarts.getInstanceByDom(container as HTMLElement)
      if (instance) {
        instances.push(instance)
        instance.setOption({ animation: false })
      }
    })
    // 等待无动画重绘完成
    await new Promise((resolve) => setTimeout(resolve, 50))
    // 返回恢复函数
    return () => {
      instances.forEach((inst) => {
        try {
          inst.setOption({ animation: true })
        } catch {
          /* ignore disposed */
        }
      })
    }
  }

  // 导出 HTML
  const handleExportHTML = useCallback(async () => {
    // 分屏模式下取活跃面板的 tab，否则取全局 activeTab
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    let loadingId: string | undefined
    try {
      let htmlContent: string
      // 分屏模式下 previewRef 为 null，fallback 到活跃面板的 .markdown-body
      const markdownBody = document.querySelector('.split-leaf-panel.active .markdown-body')
      if (markdownBody) {
        const restoreECharts = await prepareEChartsForExport(markdownBody)
        const clone = markdownBody.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.copy-button, .line-numbers-wrapper, .no-export').forEach(el => el.remove())
        clone.querySelectorAll('.echarts-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        // Infographic: 导出时只显示信息图，隐藏代码
        clone.querySelectorAll('.infographic-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        const originalSvgs = markdownBody.querySelectorAll('.echarts-container svg')
        const svgBboxes: { x: number; y: number; width: number; height: number }[] = []
        originalSvgs.forEach((svg) => {
          try {
            const svgEl = svg as SVGSVGElement
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            Array.from(svgEl.children).forEach((child) => {
              try {
                const el = child as SVGGraphicsElement
                if (el.getAttribute('visibility') === 'hidden' || el.getAttribute('display') === 'none') return
                const bbox = el.getBBox()
                minX = Math.min(minX, bbox.x); minY = Math.min(minY, bbox.y)
                maxX = Math.max(maxX, bbox.x + bbox.width); maxY = Math.max(maxY, bbox.y + bbox.height)
              } catch { /* ignore */ }
            })
            if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
              svgBboxes.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
            } else { svgBboxes.push({ x: 0, y: 0, width: 600, height: 400 }) }
          } catch { svgBboxes.push({ x: 0, y: 0, width: 600, height: 400 }) }
        })
        const clonedContainers = clone.querySelectorAll('.echarts-container')
        clonedContainers.forEach((container, index) => {
          const svg = container.querySelector('svg')
          if (!svg) return
          const bbox = svgBboxes[index]
          if (bbox) {
            const padding = 10
            svg.setAttribute('viewBox', `${Math.max(0, bbox.x - padding)} ${Math.max(0, bbox.y - padding)} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`)
          }
          svg.removeAttribute('width'); svg.removeAttribute('height')
          svg.style.cssText = 'width: 100%; height: auto; display: block;'
          const innerDiv = svg.parentElement
          if (innerDiv && innerDiv !== container) { container.appendChild(svg); innerDiv.remove() }
          const el = container as HTMLElement
          el.removeAttribute('_echarts_instance_'); el.removeAttribute('data-echarts-index')
          el.style.cssText = 'width: 100%;'
        })
        htmlContent = clone.innerHTML
        restoreECharts()
      } else {
        const md = createMarkdownRenderer()
        htmlContent = md.render(exportTab.content)
        htmlContent = await processMermaidInHtml(htmlContent)
        htmlContent = await processEChartsInHtml(htmlContent)
        htmlContent = await processInfographicInHtml(htmlContent)
        htmlContent = await processMarkmapInHtml(htmlContent)
        htmlContent = await processGraphvizInHtml(htmlContent)
        htmlContent = await processDrawioInHtml(htmlContent)
        htmlContent = await processPlantUMLInHtml(htmlContent)
      }
      loadingId = toast.info('正在导出 HTML...', { duration: 60000 })
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
  }, [activeTab, splitState, tabs, toast])

  // 导出 PDF
  const handleExportPDF = useCallback(async () => {
    // 分屏模式下取活跃面板的 tab，否则取全局 activeTab
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    let loadingId: string | undefined
    try {
      let htmlContent: string
      // 分屏模式下 previewRef 为 null，fallback 到活跃面板的 .markdown-body
      const markdownBody = document.querySelector('.split-leaf-panel.active .markdown-body')
      if (markdownBody) {
        const restoreECharts = await prepareEChartsForExport(markdownBody)
        const clone = markdownBody.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.copy-button, .line-numbers-wrapper, .no-export').forEach(el => el.remove())
        clone.querySelectorAll('.echarts-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        // Infographic: 导出时只显示信息图，隐藏代码
        clone.querySelectorAll('.infographic-wrapper').forEach(wrapper => {
          const chartView = wrapper.querySelector('[data-view="chart"]') as HTMLElement
          const codeView = wrapper.querySelector('[data-view="code"]') as HTMLElement
          if (chartView) chartView.style.display = ''
          if (codeView) codeView.style.display = 'none'
        })
        const originalSvgs = markdownBody.querySelectorAll('.echarts-container svg')
        const svgBboxes: { x: number; y: number; width: number; height: number }[] = []
        originalSvgs.forEach((svg) => {
          try {
            const svgEl = svg as SVGSVGElement
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            Array.from(svgEl.children).forEach((child) => {
              try {
                const el = child as SVGGraphicsElement
                if (el.getAttribute('visibility') === 'hidden' || el.getAttribute('display') === 'none') return
                const bbox = el.getBBox()
                minX = Math.min(minX, bbox.x); minY = Math.min(minY, bbox.y)
                maxX = Math.max(maxX, bbox.x + bbox.width); maxY = Math.max(maxY, bbox.y + bbox.height)
              } catch { /* ignore */ }
            })
            if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
              svgBboxes.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
            } else { svgBboxes.push({ x: 0, y: 0, width: 600, height: 400 }) }
          } catch { svgBboxes.push({ x: 0, y: 0, width: 600, height: 400 }) }
        })
        const clonedContainers = clone.querySelectorAll('.echarts-container')
        clonedContainers.forEach((container, index) => {
          const svg = container.querySelector('svg')
          if (!svg) return
          const bbox = svgBboxes[index]
          if (bbox) {
            const padding = 10
            svg.setAttribute('viewBox', `${Math.max(0, bbox.x - padding)} ${Math.max(0, bbox.y - padding)} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`)
          }
          svg.removeAttribute('width'); svg.removeAttribute('height')
          svg.style.cssText = 'width: 100%; height: auto; display: block;'
          const innerDiv = svg.parentElement
          if (innerDiv && innerDiv !== container) { container.appendChild(svg); innerDiv.remove() }
          const el = container as HTMLElement
          el.removeAttribute('_echarts_instance_'); el.removeAttribute('data-echarts-index')
          el.style.cssText = 'width: 100%;'
        })
        htmlContent = clone.innerHTML
        restoreECharts()
      } else {
        const md = createMarkdownRenderer()
        htmlContent = md.render(exportTab.content)
        htmlContent = await processMermaidInHtml(htmlContent)
        htmlContent = await processEChartsInHtml(htmlContent)
        htmlContent = await processInfographicInHtml(htmlContent)
        htmlContent = await processMarkmapInHtml(htmlContent)
        htmlContent = await processGraphvizInHtml(htmlContent)
        htmlContent = await processDrawioInHtml(htmlContent)
        htmlContent = await processPlantUMLInHtml(htmlContent)
      }
      loadingId = toast.info('正在导出 PDF...', { duration: 60000 })
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
  }, [activeTab, splitState, tabs, toast])

  // 导出 DOCX
  const handleExportDOCX = useCallback(async (docStyle?: string) => {
    // 分屏模式下取活跃面板的 tab，否则取全局 activeTab
    const exportTab = splitState.root && splitState.activeLeafId
      ? tabs.find(t => t.id === findLeaf(splitState.root, splitState.activeLeafId)?.tabId) || activeTab
      : activeTab
    if (!exportTab) return
    let loadingId: string | undefined
    try {
      let htmlContent: string
      // 分屏模式下 previewRef 为 null，fallback 到活跃面板的 .markdown-body
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
        // Infographic: 导出时只显示信息图，隐藏代码
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
          let viewBox = svg.getAttribute('viewBox')
          let vbWidth: number, vbHeight: number
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
        const md = createMarkdownRenderer()
        htmlContent = md.render(exportTab.content)
      }
      loadingId = toast.info('正在导出 Word...', { duration: 60000 })
      const result = await window.api.exportDOCX(htmlContent, exportTab.file.name, folderPath || '', exportTab.content, docStyle)
      toast.close(loadingId)
      if (result) {
        const { filePath, warnings, usedPandoc } = result
        if (usedPandoc) {
          const styleLabel = docStyle === 'gongwen' ? '公文格式' : 'Pandoc 高质量'
          const message = warnings && warnings.length > 0
            ? `Word 已导出（${styleLabel}）（${warnings.length} 个警告）`
            : `Word 已导出（${styleLabel}）`
          toast.success(message, {
            action: { label: '点击查看', onClick: async () => { try { await window.api.showItemInFolder(filePath) } catch (error) { console.error('Failed to show item:', error) } } }
          })
        } else {
          const pandocPromptChoice = localStorage.getItem('pandoc-prompt-choice')
          if (pandocPromptChoice === 'never') {
            toast.success('导出成功', {
              action: { label: '点击查看', onClick: async () => { try { await window.api.showItemInFolder(filePath) } catch (error) { console.error('Failed to show item:', error) } } }
            })
          } else {
            toast.success('导出成功', {
              description: '安装 Pandoc 可支持数学公式和复杂表格',
              duration: 10000,
              action: { label: '查看安装指南', onClick: async () => { try { await window.api.openExternal('https://pandoc.org/installing.html') } catch (error) { console.error('Failed to open external URL:', error); toast.error('无法打开链接') } } }
            })
          }
        }
      }
    } catch (error) {
      if (loadingId) toast.close(loadingId)
      console.error('导出 DOCX 失败:', error)
      toast.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [activeTab, splitState, tabs, folderPath, toast])

  return {
    handleExportHTML,
    handleExportPDF,
    handleExportDOCX
  }
}
