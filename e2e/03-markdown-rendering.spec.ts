import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'

const VISUAL_RESULT_ROOT = process.env.MD_VIEWER_TEST_RESULTS_DIR
  || join(tmpdir(), 'md-viewer-e2e-visual-results')
const EXCALIDRAW_VISUAL_DIR = join(VISUAL_RESULT_ROOT, 'excalidraw-visual')
const CHART_FULLSCREEN_VISUAL_DIR = join(VISUAL_RESULT_ROOT, 'chart-fullscreen-visual')
const RENDERER_FIXTURE_VISUAL_DIR = join(VISUAL_RESULT_ROOT, 'renderer-fixture-visual')
const DIRECT_EXCALIDRAW_SOURCE = `{
  "type": "excalidraw",
  "version": 2,
  "source": "md-viewer-direct-preview-test",
  "elements": [
    {
      "id": "rect-1",
      "type": "rectangle",
      "x": 20,
      "y": 20,
      "width": 180,
      "height": 90,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#d3f9d8",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": { "type": 3 },
      "seed": 1,
      "version": 1,
      "versionNonce": 1,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-1",
      "type": "text",
      "x": 54,
      "y": 50,
      "width": 112,
      "height": 25,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 2,
      "version": 1,
      "versionNonce": 2,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "Direct Preview",
      "fontSize": 20,
      "fontFamily": 5,
      "textAlign": "center",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "Direct Preview",
      "lineHeight": 1.25
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}`

/**
 * E2E 测试 3: Markdown 渲染功能
 * 验证基础 Markdown、代码高亮、数学公式、Mermaid 图表渲染
 */
async function openMarkdownFile(page: Page, filePath: string): Promise<void> {
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), filePath)
}

async function mockPlantUMLFetch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.includes('/plantuml/svg')) {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110"><rect x="4" y="4" width="212" height="102" fill="#f8fbff" stroke="#2f5597"/><text x="24" y="58" font-size="18">C4 fixture mock</text></svg>',
          { status: 200, headers: { 'content-type': 'image/svg+xml' } }
        )
      }
      return originalFetch(input, init)
    }
  })
}

function buildKrokiMockSvg(format: string, source: string): string {
  const escapeSvgText = (value: string) => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
  const sizeByFormat: Record<string, { width: number; height: number }> = {
    nomnoml: { width: 620, height: 240 },
    pikchr: { width: 720, height: 220 },
    svgbob: { width: 680, height: 300 },
    bytefield: { width: 760, height: 220 },
    tikz: { width: 720, height: 300 },
  }
  const { width, height } = sizeByFormat[format] || { width: 620, height: 240 }
  const title = `Kroki ${format} mock`
  const lines = source
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 6)
  const style = format === 'tikz'
    ? '<style>text.kroki-label { font-family: Arial, sans-serif; font-size: 8px; }</style>'
    : format === 'svgbob'
      ? '<style>rect.kroki-box { shape-rendering: crispEdges; } line.kroki-line { shape-rendering: crispEdges; stroke-linecap: square; }</style>'
      : ''
  const titleFontSize = format === 'tikz' ? 8 : 22
  const lineFontSize = format === 'tikz' ? 7 : 16
  const lineSvg = lines.map((line, index) => {
    const y = 104 + index * 24
    return `<text class="kroki-label" x="40" y="${y}" font-size="${lineFontSize}" fill="#344054">${escapeSvgText(line.slice(0, 72))}</text>`
  }).join('')
  const cards = Array.from({ length: Math.max(3, Math.min(7, lines.length + 1)) }, (_item, index) => {
    const x = 36 + index * Math.max(78, Math.floor((width - 120) / 7))
    const y = height - 76 - (index % 2) * 28
    return `<rect x="${x}" y="${y}" width="66" height="38" rx="8" fill="#e8f2ff" stroke="#2f5597"/>`
  }).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvgText(title)}">`,
    style,
    '<rect x="8" y="8" width="' + (width - 16) + '" height="' + (height - 16) + '" rx="14" fill="#f8fbff" stroke="#2f5597"/>',
    `<text class="kroki-label" x="36" y="52" font-size="${titleFontSize}" font-weight="700" fill="#172033">${escapeSvgText(title)}</text>`,
    '<line class="kroki-line" x1="40" y1="72" x2="' + (width - 40) + '" y2="72" stroke="#d0d7e2" stroke-width="2"/>',
    lineSvg,
    cards,
    '</svg>',
  ].join('')
}

async function mockKrokiFetch(page: Page, electronApp?: ElectronApplication): Promise<void> {
  const mockFactorySource = buildKrokiMockSvg.toString()
  if (electronApp) {
    await electronApp.evaluate(({ ipcMain }, source) => {
      const buildMockSvg = (0, eval)(`(${source})`) as (format: string, krokiSource: string) => string
      ipcMain.removeHandler('render:krokiSvg')
      ipcMain.handle('render:krokiSvg', async (_event, payload: { format?: string; source?: string }) => ({
        ok: true,
        svg: buildMockSvg(String(payload?.format || 'nomnoml'), String(payload?.source || '')),
      }))
    }, mockFactorySource)
  }

  await page.evaluate((source) => {
    const buildMockSvg = (0, eval)(`(${source})`) as (format: string, krokiSource: string) => string
    const mockedRenderKrokiSvg = async (payload: { format?: string; source?: string }) => ({
      ok: true,
      svg: buildMockSvg(String(payload?.format || 'nomnoml'), String(payload?.source || '')),
    })
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.includes('kroki.io')) {
        const format = url.split('/').slice(-2, -1)[0] || 'kroki'
        return new Response(
          buildMockSvg(format, typeof init?.body === 'string' ? init.body : ''),
          { status: 200, headers: { 'content-type': 'image/svg+xml' } }
        )
      }
      return originalFetch(input, init)
    }
    try {
      Object.defineProperty(window.api, 'renderKrokiSvg', {
        configurable: true,
        value: mockedRenderKrokiSvg,
      })
    } catch {
      window.api.renderKrokiSvg = mockedRenderKrokiSvg
    }
  }, mockFactorySource)
}

interface RendererToolbarFixture {
  name: string
  wrapper: string
  container: string
  button: string
  back: string
  downloadPrefix: string
  copySample: string
}

interface RendererToolbarState {
  buttonCount: number
  backCount: number
  closeButtonCount: number
  closeButtonVisible: boolean
  closeButtonWidth: number
  closeButtonHeight: number
  fullscreenActionCount: number
  sourceActionCount: number
  backVisible: boolean
  copyVisible: boolean
  chartVisible: boolean
  codeVisible: boolean
  fullscreen: boolean
  wrapperWidth: number
  wrapperHeight: number
  svgWidth: number
  svgHeight: number
  codePaddingTop: number
  codeBackground: string
  zoomLevel: string
  zoomedWrapper: boolean
  fullscreenParentIsBody: boolean
  toggleBackground: string
  toggleBottomGap: number
  toggleCenterOffset: number
  toggleBorderRadius: number
  togglePaddingTop: number
  togglePaddingRight: number
  togglePaddingBottom: number
  togglePaddingLeft: number
  toggleWhiteSpace: string
  actionButtonWidth: number
  actionButtonHeight: number
  actionImageCount: number
  actionImageWidth: number
  actionImageFilter: string
  actionText: string
}

interface ChartDownloadRecord {
  download: string
  hrefPrefix: string
  href?: string
}

interface ChartFullscreenCase {
  name: string
  id: string
  wrapper: string
  container: string
  button: string
  ready: string
}

type ChartDownloadSpyWindow = Window & {
  __chartDownloadClicks?: ChartDownloadRecord[]
  __chartDownloadHookInstalled?: boolean
  __chartOriginalAnchorClick?: typeof HTMLAnchorElement.prototype.click
}

type ChartClipboardSpyWindow = Window & {
  __chartClipboardWrites?: string[]
}

async function installChartDownloadSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as ChartDownloadSpyWindow
    targetWindow.__chartDownloadClicks = []
    if (targetWindow.__chartDownloadHookInstalled) return

    const originalClick = HTMLAnchorElement.prototype.click
    targetWindow.__chartOriginalAnchorClick = originalClick
    HTMLAnchorElement.prototype.click = function interceptedAnchorClick() {
      if (this.download && this.href.startsWith('data:image/png')) {
        targetWindow.__chartDownloadClicks?.push({
          download: this.download,
          hrefPrefix: this.href.slice(0, 32),
          href: this.href,
        })
        return
      }
      return originalClick.call(this)
    }
    targetWindow.__chartDownloadHookInstalled = true
  })
}

async function getChartDownloadRecords(page: Page): Promise<ChartDownloadRecord[]> {
  return page.evaluate(() => {
    const targetWindow = window as ChartDownloadSpyWindow
    return targetWindow.__chartDownloadClicks ?? []
  })
}

async function getLatestChartDownloadImageMetrics(page: Page): Promise<{
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  xOffsetRatio: number
  yOffsetRatio: number
} | null> {
  return page.evaluate(async () => {
    const record = ((window as ChartDownloadSpyWindow).__chartDownloadClicks ?? []).at(-1)
    if (!record?.href) return null

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image()
      candidate.onload = () => resolve(candidate)
      candidate.onerror = () => reject(new Error('download image failed to load'))
      candidate.src = record.href!
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const whiteThreshold = 250
    let minX = canvas.width
    let minY = canvas.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4
        const alpha = imageData.data[offset + 3]
        const isContent = alpha > 0
          && (
            imageData.data[offset] < whiteThreshold
            || imageData.data[offset + 1] < whiteThreshold
            || imageData.data[offset + 2] < whiteThreshold
          )
        if (!isContent) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (maxX < minX || maxY < minY) return null

    const left = minX
    const right = canvas.width - maxX - 1
    const top = minY
    const bottom = canvas.height - maxY - 1
    return {
      width: canvas.width,
      height: canvas.height,
      left,
      right,
      top,
      bottom,
      xOffsetRatio: Math.abs(left - right) / canvas.width,
      yOffsetRatio: Math.abs(top - bottom) / canvas.height,
    }
  })
}

async function installChartClipboardSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as ChartClipboardSpyWindow
    targetWindow.__chartClipboardWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          targetWindow.__chartClipboardWrites?.push(text)
        },
      },
    })
  })
}

async function getChartClipboardWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const targetWindow = window as ChartClipboardSpyWindow
    return targetWindow.__chartClipboardWrites ?? []
  })
}

async function getRendererToolbarState(page: Page, fixture: RendererToolbarFixture): Promise<RendererToolbarState> {
  return page.evaluate(({ wrapper, container, button, back }) => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const box = htmlElement.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }

    const fullscreenWrapperEl = document.querySelector(`${wrapper}.chart-fullscreen`) as HTMLElement | null
    const wrapperEl = fullscreenWrapperEl ?? document.querySelector(wrapper) as HTMLElement | null
    const containerEl = wrapperEl?.querySelector(container) as HTMLElement | null
    const codeEl = wrapperEl?.querySelector('[data-view="code"]') as HTMLElement | null
    const codePre = codeEl?.querySelector('pre') as HTMLElement | null
    const svg = containerEl?.querySelector('svg') as SVGSVGElement | null
    const closeButton = wrapperEl?.querySelector('.chart-lightbox-close') as HTMLElement | null
    const toggleBar = wrapperEl?.querySelector('[class*="-toggle-bar"]') as HTMLElement | null
    const wrapperBox = wrapperEl?.getBoundingClientRect()
    const svgBox = svg?.getBoundingClientRect()
    const closeBox = closeButton?.getBoundingClientRect()
    const toggleBox = toggleBar?.getBoundingClientRect()
    const toggleStyle = toggleBar ? getComputedStyle(toggleBar) : null
    const firstActionButton = wrapperEl?.querySelector(button) as HTMLElement | null
    const firstActionButtonBox = firstActionButton?.getBoundingClientRect()
    const firstActionImage = firstActionButton?.querySelector('img') as HTMLImageElement | null
    const firstActionImageBox = firstActionImage?.getBoundingClientRect()
    const codePreStyle = codePre ? getComputedStyle(codePre) : null

    return {
      buttonCount: wrapperEl?.querySelectorAll(button).length ?? 0,
      backCount: wrapperEl?.querySelectorAll(back).length ?? 0,
      closeButtonCount: wrapperEl?.querySelectorAll('.chart-lightbox-close').length ?? 0,
      closeButtonVisible: isVisible(closeButton),
      closeButtonWidth: closeBox?.width ?? 0,
      closeButtonHeight: closeBox?.height ?? 0,
      fullscreenActionCount: wrapperEl?.querySelectorAll(`${button}[data-action="fullscreen"]`).length ?? 0,
      sourceActionCount: wrapperEl?.querySelectorAll(`${button}[data-action="toggleCode"]`).length ?? 0,
      backVisible: isVisible(wrapperEl?.querySelector(back) ?? null),
      copyVisible: isVisible(codeEl?.querySelector('.copy-btn') ?? null),
      chartVisible: isVisible(containerEl),
      codeVisible: isVisible(codeEl),
      fullscreen: Boolean(fullscreenWrapperEl) || (document.fullscreenElement?.matches(wrapper) ?? false),
      wrapperWidth: wrapperBox?.width ?? 0,
      wrapperHeight: wrapperBox?.height ?? 0,
      svgWidth: svgBox?.width ?? 0,
      svgHeight: svgBox?.height ?? 0,
      codePaddingTop: codePreStyle ? Number.parseFloat(codePreStyle.paddingTop) : 0,
      codeBackground: codePreStyle?.backgroundColor ?? '',
      zoomLevel: containerEl?.dataset.zoomLevel ?? '',
      zoomedWrapper: wrapperEl?.classList.contains('zoomed-wrapper') ?? false,
      fullscreenParentIsBody: fullscreenWrapperEl?.parentElement === document.body,
      toggleBackground: toggleStyle?.backgroundColor ?? '',
      toggleBottomGap: toggleBox ? window.innerHeight - toggleBox.bottom : -1,
      toggleCenterOffset: toggleBox ? Math.abs((toggleBox.left + toggleBox.width / 2) - window.innerWidth / 2) : -1,
      toggleBorderRadius: toggleStyle ? Number.parseFloat(toggleStyle.borderRadius) : 0,
      togglePaddingTop: toggleStyle ? Number.parseFloat(toggleStyle.paddingTop) : 0,
      togglePaddingRight: toggleStyle ? Number.parseFloat(toggleStyle.paddingRight) : 0,
      togglePaddingBottom: toggleStyle ? Number.parseFloat(toggleStyle.paddingBottom) : 0,
      togglePaddingLeft: toggleStyle ? Number.parseFloat(toggleStyle.paddingLeft) : 0,
      toggleWhiteSpace: toggleStyle?.whiteSpace ?? '',
      actionButtonWidth: firstActionButtonBox?.width ?? 0,
      actionButtonHeight: firstActionButtonBox?.height ?? 0,
      actionImageCount: wrapperEl?.querySelectorAll(`${button} img`).length ?? 0,
      actionImageWidth: firstActionImageBox?.width ?? 0,
      actionImageFilter: firstActionImage ? getComputedStyle(firstActionImage).filter : '',
      actionText: firstActionButton?.textContent?.trim() ?? '',
    }
  }, fixture)
}

async function getD2FullscreenRegressionState(page: Page, d2Index: string): Promise<{
  viewportWidth: number
  viewportHeight: number
  originalInMarkdown: boolean
  originalVisible: boolean
  originalSvgVisible: boolean
  fullscreenVisible: boolean
  fullscreenSvgWidth: number
  fullscreenSvgHeight: number
  bodyDirectD2Count: number
}> {
  return page.evaluate((index) => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const box = htmlElement.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }

    const original = document.querySelector(`.markdown-body .d2-wrapper[data-d2-index="${index}"]`) as HTMLElement | null
    const originalSvg = original?.querySelector('.d2-container svg') as SVGSVGElement | null
    const fullscreen = document.querySelector('.d2-wrapper.chart-fullscreen') as HTMLElement | null
    const fullscreenSvg = fullscreen?.querySelector('.d2-container svg') as SVGSVGElement | null
    const fullscreenSvgBox = fullscreenSvg?.getBoundingClientRect()

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      originalInMarkdown: Boolean(original),
      originalVisible: isVisible(original),
      originalSvgVisible: isVisible(originalSvg),
      fullscreenVisible: isVisible(fullscreen),
      fullscreenSvgWidth: fullscreenSvgBox?.width ?? 0,
      fullscreenSvgHeight: fullscreenSvgBox?.height ?? 0,
      bodyDirectD2Count: Array.from(document.body.children).filter((element) => element.classList.contains('d2-wrapper')).length,
    }
  }, d2Index)
}

async function getD2FullscreenToolbarState(page: Page): Promise<{
  visible: boolean
  buttonCount: number
  closeButtonCount: number
  closeButtonVisible: boolean
  fullscreenActionCount: number
  sourceActionCount: number
  chartVisible: boolean
  codeVisible: boolean
  togglePointerEvents: string
  toggleBackground: string
  toggleBottomGap: number
  toggleCenterOffset: number
  svgWidth: number
  svgHeight: number
  zoomLevel: string
  zoomedWrapper: boolean
  toggleBorderRadius: number
  togglePaddingTop: number
  togglePaddingRight: number
  togglePaddingBottom: number
  togglePaddingLeft: number
  toggleWhiteSpace: string
  actionButtonWidth: number
  actionButtonHeight: number
  actionImageCount: number
  actionImageWidth: number
  actionImageFilter: string
  actionText: string
}> {
  return page.evaluate(() => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const box = htmlElement.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }

    const wrapper = document.querySelector('.d2-wrapper.chart-fullscreen') as HTMLElement | null
    const toggleBar = wrapper?.querySelector('.d2-toggle-bar') as HTMLElement | null
    const chart = wrapper?.querySelector('.d2-container') as HTMLElement | null
    const code = wrapper?.querySelector('.d2-code-view') as HTMLElement | null
    const svg = chart?.querySelector(':scope > svg') as SVGSVGElement | null
    const svgBox = svg?.getBoundingClientRect()
    const toggleBox = toggleBar?.getBoundingClientRect()
    const toggleStyle = toggleBar ? getComputedStyle(toggleBar) : null
    const firstActionButton = wrapper?.querySelector('.d2-action-btn') as HTMLElement | null
    const firstActionButtonBox = firstActionButton?.getBoundingClientRect()
    const firstActionImage = firstActionButton?.querySelector('img') as HTMLImageElement | null
    const firstActionImageBox = firstActionImage?.getBoundingClientRect()

    return {
      visible: isVisible(wrapper),
      buttonCount: wrapper?.querySelectorAll('.d2-action-btn').length ?? 0,
      closeButtonCount: wrapper?.querySelectorAll('.chart-lightbox-close').length ?? 0,
      closeButtonVisible: isVisible(wrapper?.querySelector('.chart-lightbox-close') ?? null),
      fullscreenActionCount: wrapper?.querySelectorAll('.d2-action-btn[data-action="fullscreen"]').length ?? 0,
      sourceActionCount: wrapper?.querySelectorAll('.d2-action-btn[data-action="toggleCode"]').length ?? 0,
      chartVisible: isVisible(chart),
      codeVisible: isVisible(code),
      togglePointerEvents: toggleBar ? getComputedStyle(toggleBar).pointerEvents : '',
      toggleBackground: toggleBar ? getComputedStyle(toggleBar).backgroundColor : '',
      toggleBottomGap: toggleBox ? window.innerHeight - toggleBox.bottom : -1,
      toggleCenterOffset: toggleBox ? Math.abs((toggleBox.left + toggleBox.width / 2) - window.innerWidth / 2) : -1,
      svgWidth: svgBox?.width ?? 0,
      svgHeight: svgBox?.height ?? 0,
      zoomLevel: chart?.dataset.zoomLevel ?? '',
      zoomedWrapper: wrapper?.classList.contains('zoomed-wrapper') ?? false,
      toggleBorderRadius: toggleStyle ? Number.parseFloat(toggleStyle.borderRadius) : 0,
      togglePaddingTop: toggleStyle ? Number.parseFloat(toggleStyle.paddingTop) : 0,
      togglePaddingRight: toggleStyle ? Number.parseFloat(toggleStyle.paddingRight) : 0,
      togglePaddingBottom: toggleStyle ? Number.parseFloat(toggleStyle.paddingBottom) : 0,
      togglePaddingLeft: toggleStyle ? Number.parseFloat(toggleStyle.paddingLeft) : 0,
      toggleWhiteSpace: toggleStyle?.whiteSpace ?? '',
      actionButtonWidth: firstActionButtonBox?.width ?? 0,
      actionButtonHeight: firstActionButtonBox?.height ?? 0,
      actionImageCount: wrapper?.querySelectorAll('.d2-action-btn img').length ?? 0,
      actionImageWidth: firstActionImageBox?.width ?? 0,
      actionImageFilter: firstActionImage ? getComputedStyle(firstActionImage).filter : '',
      actionText: firstActionButton?.textContent?.trim() ?? '',
    }
  })
}

async function getMarkmapFullscreenContentState(page: Page): Promise<{
  visible: boolean
  contentClientWidth: number
  contentClientHeight: number
  svgWidth: number
  svgHeight: number
  groupWidth: number
  groupHeight: number
  groupTransform: string
  toolbarButtonCount: number
  toolbarText: string
}> {
  return page.evaluate(() => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const box = htmlElement.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }

    const wrapper = document.querySelector('.markmap-wrapper.chart-fullscreen') as HTMLElement | null
    const container = wrapper?.querySelector('.markmap-container') as HTMLElement | null
    const svg = container?.querySelector('svg') as SVGSVGElement | null
    const group = svg?.querySelector('g') as SVGGElement | null
    const svgBox = svg?.getBoundingClientRect()
    const groupBox = group?.getBoundingClientRect()

    return {
      visible: isVisible(wrapper),
      contentClientWidth: container?.clientWidth ?? 0,
      contentClientHeight: container?.clientHeight ?? 0,
      svgWidth: svgBox?.width ?? 0,
      svgHeight: svgBox?.height ?? 0,
      groupWidth: groupBox?.width ?? 0,
      groupHeight: groupBox?.height ?? 0,
      groupTransform: group?.getAttribute('transform') ?? '',
      toolbarButtonCount: wrapper?.querySelectorAll('.markmap-action-btn').length ?? 0,
      toolbarText: wrapper?.querySelector('.markmap-toggle-bar')?.textContent?.trim() ?? '',
    }
  })
}

async function getChartFullscreenVisualState(page: Page, chart: ChartFullscreenCase): Promise<{
  visible: boolean
  chartVisible: boolean
  svgVisible: boolean
  svgWidth: number
  svgHeight: number
  contentLeftGap: number
  contentRightGap: number
  contentTopGap: number
  contentBottomGap: number
  closeCount: number
  closeVisible: boolean
  closeTopGap: number
  closeRightGap: number
  toolbarButtonCount: number
  toolbarImageCount: number
  toolbarBackground: string
  toolbarBottomGap: number
  toolbarCenterOffset: number
  toolbarBorderRadius: number
  toolbarPaddingTop: number
  toolbarPaddingRight: number
  toolbarPaddingBottom: number
  toolbarPaddingLeft: number
  toolbarText: string
  toolbarImageWidth: number
  toolbarImageFilter: string
  fullscreenClientWidth: number
  fullscreenScrollWidth: number
  fullscreenClientHeight: number
  fullscreenScrollHeight: number
  contentClientWidth: number
  contentScrollWidth: number
  contentOverflowX: string
  contentHorizontalOverflow: boolean
  horizontalOverflow: boolean
}> {
  return page.evaluate(({ wrapper, container, button }) => {
    const isVisible = (element: Element | null): boolean => {
      if (!element) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      const box = htmlElement.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }

    const fullscreen = document.querySelector(`${wrapper}.chart-fullscreen`) as HTMLElement | null
    const chartContainer = fullscreen?.querySelector(container) as HTMLElement | null
    const svg = chartContainer?.querySelector('svg') as SVGSVGElement | null
    const close = fullscreen?.querySelector('.chart-lightbox-close') as HTMLElement | null
    const toolbar = fullscreen?.querySelector('[class*="-toggle-bar"]') as HTMLElement | null
    const firstImage = toolbar?.querySelector(`${button} img`) as HTMLImageElement | null
    const contentBox = chartContainer?.getBoundingClientRect()
    const closeBox = close?.getBoundingClientRect()
    const toolbarBox = toolbar?.getBoundingClientRect()
    const svgBox = svg?.getBoundingClientRect()
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null
    const contentStyle = chartContainer ? getComputedStyle(chartContainer) : null
    const firstImageBox = firstImage?.getBoundingClientRect()

    return {
      visible: isVisible(fullscreen),
      chartVisible: isVisible(chartContainer),
      svgVisible: isVisible(svg),
      svgWidth: svgBox?.width ?? 0,
      svgHeight: svgBox?.height ?? 0,
      contentLeftGap: contentBox?.left ?? -1,
      contentRightGap: contentBox ? window.innerWidth - contentBox.right : -1,
      contentTopGap: contentBox?.top ?? -1,
      contentBottomGap: contentBox ? window.innerHeight - contentBox.bottom : -1,
      closeCount: fullscreen?.querySelectorAll('.chart-lightbox-close').length ?? 0,
      closeVisible: isVisible(close),
      closeTopGap: closeBox?.top ?? -1,
      closeRightGap: closeBox ? window.innerWidth - closeBox.right : -1,
      toolbarButtonCount: toolbar?.querySelectorAll(button).length ?? 0,
      toolbarImageCount: toolbar?.querySelectorAll(`${button} img`).length ?? 0,
      toolbarBackground: toolbarStyle?.backgroundColor ?? '',
      toolbarBottomGap: toolbarBox ? window.innerHeight - toolbarBox.bottom : -1,
      toolbarCenterOffset: toolbarBox ? Math.abs((toolbarBox.left + toolbarBox.width / 2) - window.innerWidth / 2) : -1,
      toolbarBorderRadius: toolbarStyle ? Number.parseFloat(toolbarStyle.borderRadius) : 0,
      toolbarPaddingTop: toolbarStyle ? Number.parseFloat(toolbarStyle.paddingTop) : 0,
      toolbarPaddingRight: toolbarStyle ? Number.parseFloat(toolbarStyle.paddingRight) : 0,
      toolbarPaddingBottom: toolbarStyle ? Number.parseFloat(toolbarStyle.paddingBottom) : 0,
      toolbarPaddingLeft: toolbarStyle ? Number.parseFloat(toolbarStyle.paddingLeft) : 0,
      toolbarText: toolbar?.textContent?.trim() ?? '',
      toolbarImageWidth: firstImageBox?.width ?? 0,
      toolbarImageFilter: firstImage ? getComputedStyle(firstImage).filter : '',
      fullscreenClientWidth: fullscreen?.clientWidth ?? 0,
      fullscreenScrollWidth: fullscreen?.scrollWidth ?? 0,
      fullscreenClientHeight: fullscreen?.clientHeight ?? 0,
      fullscreenScrollHeight: fullscreen?.scrollHeight ?? 0,
      contentClientWidth: chartContainer?.clientWidth ?? 0,
      contentScrollWidth: chartContainer?.scrollWidth ?? 0,
      contentOverflowX: contentStyle?.overflowX ?? '',
      contentHorizontalOverflow: chartContainer ? chartContainer.scrollWidth > chartContainer.clientWidth + 1 : false,
      horizontalOverflow: fullscreen ? fullscreen.scrollWidth > fullscreen.clientWidth + 1 : false,
    }
  }, chart)
}

function expectDrawIOLikeFullscreenVisualState(
  state: Awaited<ReturnType<typeof getChartFullscreenVisualState>>,
  label: string
): void {
  expect(state.visible, `${label} 应进入全屏层`).toBe(true)
  expect(state.chartVisible, `${label} 全屏图表容器应可见`).toBe(true)
  expect(state.svgVisible, `${label} 全屏 SVG 应可见`).toBe(true)
  expect(state.svgWidth, `${label} 全屏 SVG 不应为空或过小`).toBeGreaterThan(80)
  expect(state.svgHeight, `${label} 全屏 SVG 不应为空或过小`).toBeGreaterThan(60)
  expect(state.horizontalOverflow, `${label} 全屏层不应出现水平滚动条`).toBe(false)
  expect(state.fullscreenScrollWidth - state.fullscreenClientWidth, `${label} 全屏层 scrollWidth 不应超过 clientWidth`).toBeLessThanOrEqual(1)
  expect(state.contentOverflowX, `${label} 全屏内容容器默认不应启用横向滚动条`).toBe('hidden')
  expect(state.contentHorizontalOverflow, `${label} 全屏内容容器不应被 SVG 撑出横向溢出`).toBe(false)
  expect(state.contentScrollWidth - state.contentClientWidth, `${label} 全屏内容容器 scrollWidth 不应超过 clientWidth`).toBeLessThanOrEqual(1)
  expect(Math.abs(state.contentLeftGap - state.contentRightGap), `${label} 全屏内容左右边距应一致`).toBeLessThanOrEqual(4)
  expect(Math.abs(state.contentTopGap - state.contentBottomGap), `${label} 全屏内容上下边距应一致`).toBeLessThanOrEqual(4)
  expect(state.closeCount, `${label} 全屏层应只有一个右上角关闭按钮`).toBe(1)
  expect(state.closeVisible, `${label} 全屏右上角关闭按钮应可见`).toBe(true)
  expect(state.closeTopGap, `${label} 全屏关闭按钮不应贴顶`).toBeGreaterThanOrEqual(16)
  expect(state.closeTopGap, `${label} 全屏关闭按钮不应离内容过远`).toBeLessThanOrEqual(32)
  expect(state.closeRightGap, `${label} 全屏关闭按钮不应贴右边缘`).toBeGreaterThanOrEqual(16)
  expect(state.closeRightGap, `${label} 全屏关闭按钮不应离内容过远`).toBeLessThanOrEqual(32)
  expect(state.toolbarButtonCount, `${label} 全屏工具条应保留四个按钮`).toBe(4)
  expect(state.toolbarImageCount, `${label} 全屏工具条应使用 DrawIO 原生 img 图标结构`).toBe(4)
  expect(state.toolbarBackground, `${label} 全屏工具条应使用 DrawIO 黑色背景`).toBe('rgb(0, 0, 0)')
  expect(state.toolbarBottomGap, `${label} 全屏工具条应固定在底部 60px`).toBeGreaterThanOrEqual(58)
  expect(state.toolbarBottomGap, `${label} 全屏工具条应固定在底部 60px`).toBeLessThanOrEqual(62)
  expect(state.toolbarCenterOffset, `${label} 全屏工具条应水平居中`).toBeLessThan(2)
  expect(state.toolbarBorderRadius, `${label} 全屏工具条圆角应为 DrawIO 16px`).toBe(16)
  expect(state.toolbarPaddingTop, `${label} 全屏工具条上内边距应对齐 DrawIO`).toBe(10)
  expect(state.toolbarPaddingRight, `${label} 全屏工具条右内边距应对齐 DrawIO`).toBe(10)
  expect(state.toolbarPaddingBottom, `${label} 全屏工具条下内边距应对齐 DrawIO`).toBe(8)
  expect(state.toolbarPaddingLeft, `${label} 全屏工具条左内边距应对齐 DrawIO`).toBe(10)
  expect(state.toolbarText, `${label} 全屏工具条不应显示 emoji 文本`).toBe('')
  expect(state.toolbarImageWidth, `${label} 全屏工具条图标宽度应对齐 DrawIO 36px`).toBe(36)
  expect(state.toolbarImageFilter, `${label} 全屏工具条图标应使用 DrawIO 反色滤镜`).toContain('invert')
}

function expectDrawIOLikeFullscreenToolbar(state: RendererToolbarState, label: string): void {
  expect(state.buttonCount, `${label} 全屏底部工具栏应只保留四个操作按钮`).toBe(4)
  expect(state.fullscreenActionCount, `${label} 全屏层不应再显示第二个全屏/退出入口`).toBe(0)
  expect(state.sourceActionCount, `${label} 全屏层不应显示源码按钮`).toBe(0)
  expect(state.toggleBackground, `${label} 全屏工具栏应使用 DrawIO 原生黑色背景`).toBe('rgb(0, 0, 0)')
  expect(state.toggleBottomGap, `${label} 全屏工具栏应与 DrawIO 一样固定在底部 60px`).toBeGreaterThanOrEqual(58)
  expect(state.toggleBottomGap, `${label} 全屏工具栏应与 DrawIO 一样固定在底部 60px`).toBeLessThanOrEqual(62)
  expect(state.toggleCenterOffset, `${label} 全屏工具栏应水平居中`).toBeLessThan(2)
  expect(state.toggleBorderRadius, `${label} 全屏工具栏圆角应对齐 DrawIO 16px`).toBe(16)
  expect(state.togglePaddingTop, `${label} 全屏工具栏上内边距应对齐 DrawIO`).toBe(10)
  expect(state.togglePaddingRight, `${label} 全屏工具栏右内边距应对齐 DrawIO`).toBe(10)
  expect(state.togglePaddingBottom, `${label} 全屏工具栏下内边距应对齐 DrawIO`).toBe(8)
  expect(state.togglePaddingLeft, `${label} 全屏工具栏左内边距应对齐 DrawIO`).toBe(10)
  expect(state.toggleWhiteSpace, `${label} 全屏工具栏应禁止按钮换行`).toBe('nowrap')
  expect(state.actionButtonWidth, `${label} 全屏工具栏按钮宽度应接近 DrawIO 36px 图标加左右留白`).toBeGreaterThanOrEqual(48)
  expect(state.actionButtonWidth, `${label} 全屏工具栏按钮宽度应接近 DrawIO 36px 图标加左右留白`).toBeLessThanOrEqual(56)
  expect(state.actionButtonHeight, `${label} 全屏工具栏按钮高度应接近 DrawIO 36px 图标高度`).toBeGreaterThanOrEqual(34)
  expect(state.actionButtonHeight, `${label} 全屏工具栏按钮高度应接近 DrawIO 36px 图标高度`).toBeLessThanOrEqual(42)
  expect(state.actionImageCount, `${label} 全屏工具栏应使用 DrawIO 原生 img 图标结构`).toBe(4)
  expect(state.actionImageWidth, `${label} 全屏工具栏图标宽度应对齐 DrawIO 36px`).toBe(36)
  expect(state.actionImageFilter, `${label} 全屏工具栏图标应使用 DrawIO 反色滤镜`).toContain('invert')
  expect(state.actionText, `${label} 全屏工具栏按钮不应显示 emoji 文本`).toBe('')
}

function expectDrawIOLikeD2FullscreenToolbar(state: Awaited<ReturnType<typeof getD2FullscreenToolbarState>>): void {
  expect(state.buttonCount, 'D2 全屏层底部工具栏应保留 4 个操作按钮').toBe(4)
  expect(state.fullscreenActionCount, 'D2 全屏层底部工具栏不应显示第二个关闭入口').toBe(0)
  expect(state.sourceActionCount, 'D2 全屏层底部工具栏不应显示源码按钮').toBe(0)
  expect(state.toggleBackground, 'D2 全屏工具栏应使用 DrawIO 原生黑色背景').toBe('rgb(0, 0, 0)')
  expect(state.toggleBottomGap, 'D2 全屏工具栏应与 DrawIO 一样固定在底部 60px').toBeGreaterThanOrEqual(58)
  expect(state.toggleBottomGap, 'D2 全屏工具栏应与 DrawIO 一样固定在底部 60px').toBeLessThanOrEqual(62)
  expect(state.toggleCenterOffset, 'D2 全屏工具栏应水平居中').toBeLessThan(2)
  expect(state.toggleBorderRadius, 'D2 全屏工具栏圆角应对齐 DrawIO 16px').toBe(16)
  expect(state.togglePaddingTop, 'D2 全屏工具栏上内边距应对齐 DrawIO').toBe(10)
  expect(state.togglePaddingRight, 'D2 全屏工具栏右内边距应对齐 DrawIO').toBe(10)
  expect(state.togglePaddingBottom, 'D2 全屏工具栏下内边距应对齐 DrawIO').toBe(8)
  expect(state.togglePaddingLeft, 'D2 全屏工具栏左内边距应对齐 DrawIO').toBe(10)
  expect(state.toggleWhiteSpace, 'D2 全屏工具栏应禁止按钮换行').toBe('nowrap')
  expect(state.actionButtonWidth, 'D2 全屏工具栏按钮宽度应接近 DrawIO 36px 图标加左右留白').toBeGreaterThanOrEqual(48)
  expect(state.actionButtonWidth, 'D2 全屏工具栏按钮宽度应接近 DrawIO 36px 图标加左右留白').toBeLessThanOrEqual(56)
  expect(state.actionButtonHeight, 'D2 全屏工具栏按钮高度应接近 DrawIO 36px 图标高度').toBeGreaterThanOrEqual(34)
  expect(state.actionButtonHeight, 'D2 全屏工具栏按钮高度应接近 DrawIO 36px 图标高度').toBeLessThanOrEqual(42)
  expect(state.actionImageCount, 'D2 全屏工具栏应使用 DrawIO 原生 img 图标结构').toBe(4)
  expect(state.actionImageWidth, 'D2 全屏工具栏图标宽度应对齐 DrawIO 36px').toBe(36)
  expect(state.actionImageFilter, 'D2 全屏工具栏图标应使用 DrawIO 反色滤镜').toContain('invert')
  expect(state.actionText, 'D2 全屏工具栏按钮不应显示 emoji 文本').toBe('')
}

function createAllChartFullscreenFixture(): string {
  const bpmnXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">',
    '  <bpmn:process id="Process_1" isExecutable="false"><bpmn:startEvent id="StartEvent_1" /><bpmn:task id="Task_1" /><bpmn:endEvent id="EndEvent_1" /><bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" /><bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1" /></bpmn:process>',
    '  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">',
    '    <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="120" y="120" width="36" height="36" /></bpmndi:BPMNShape>',
    '    <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="220" y="98" width="100" height="80" /></bpmndi:BPMNShape>',
    '    <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="390" y="120" width="36" height="36" /></bpmndi:BPMNShape>',
    '  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>',
    '</bpmn:definitions>',
  ].join('\n')

  const excalidrawJson = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'fullscreen-matrix',
    elements: [
      {
        id: 'box',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 360,
        height: 160,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: '#d3f9d8',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      },
      {
        id: 'text',
        type: 'text',
        x: 76,
        y: 58,
        width: 208,
        height: 35,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 2,
        version: 1,
        versionNonce: 2,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        fontSize: 28,
        fontFamily: 5,
        text: 'Fullscreen Matrix',
        originalText: 'Fullscreen Matrix',
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: null,
        lineHeight: 1.25,
      },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  })

  return [
    '# 全图表全屏矩阵',
    '',
    '```mermaid',
    'graph LR',
    '  A[Client] --> B[API]',
    '  B --> C[(DB)]',
    '```',
    '',
    '```echarts',
    '{"xAxis":{"type":"category","data":["A","B","C"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[12,20,15]}]}',
    '```',
    '',
    '```markmap',
    '# Root',
    '## Renderer',
    '- Mermaid',
    '- ECharts',
    '- Markmap',
    '## Export',
    '- HTML',
    '- PDF',
    '```',
    '',
    '```graphviz',
    'digraph G { rankdir=LR; A -> B -> C; A -> C; }',
    '```',
    '',
    '```infographic',
    'infographic list-row-circular-progress',
    'data',
    '  title Fullscreen',
    '  lists',
    '    - label Render',
    '      value 86',
    '    - label Export',
    '      value 73',
    '```',
    '',
    '```excalidraw',
    excalidrawJson,
    '```',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: hello',
    '@enduml',
    '```',
    '',
    '```vega-lite',
    '{"data":{"values":[{"name":"A","value":28},{"name":"B","value":55}]},"mark":"bar","encoding":{"x":{"field":"name","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}',
    '```',
    '',
    '```d2',
    'reader -> renderer -> fullscreen',
    'renderer -> toolbar',
    '```',
    '',
    '```bpmn',
    bpmnXml,
    '```',
    '',
    '```wavedrom',
    "{ signal: [{ name: 'clk', wave: 'p..P' }, { name: 'data', wave: 'x.3x', data: ['valid'] }] }",
    '```',
    '',
    '```c4plantuml',
    '@startuml',
    'Person(user, "User")',
    'System(app, "MD Viewer")',
    'Rel(user, app, "views")',
    '@enduml',
    '```',
    '',
    '```structurizr',
    'workspace "Fullscreen Structurizr" {',
    '  model {',
    '    user = person "User"',
    '    app = softwareSystem "MD Viewer" { renderer = container "RendererPlugin" }',
    '    user -> app "views"',
    '  }',
    '}',
    '```',
    '',
    '```plotly',
    '{"data":[{"type":"bar","name":"Coverage","x":["A","B","C"],"y":[18,24,31]},{"type":"scatter3d","name":"3D","x":[1,2,3],"y":[2,1,3],"z":[4,2,5]}],"layout":{"title":"Fullscreen Plotly","width":760,"height":420}}',
    '```',
    '',
    '```dbml',
    'Table users { id int [pk] org_id int }',
    'Table orgs { id int [pk] name varchar }',
    'Ref: users.org_id > orgs.id',
    '```',
    '',
    '```antv-g6',
    '{"title":"Fullscreen G6","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"}],"edges":[{"source":"a","target":"b"},{"source":"b","target":"c"}]}',
    '```',
    '',
    '```nomnoml',
    '[Fullscreen] -> [Kroki]',
    '[Kroki] -> [SVG]',
    '```',
  ].join('\n')
}

test.describe('Markdown 渲染测试', () => {
  test('应该正确渲染基础 Markdown 语法', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证标题渲染
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 2')

    // 验证粗体和斜体
    await expect(page.locator('.markdown-body strong')).toHaveText('Bold')
    await expect(page.locator('.markdown-body em')).toHaveText('italic')

    // 验证列表
    const listItems = page.locator('.markdown-body ul li')
    await expect(listItems).toHaveCount(2)
  })

  test('应该正确渲染代码块并高亮', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'code.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 验证代码块存在
    const codeBlock = page.locator('pre code')
    await expect(codeBlock).toBeVisible()

    // 验证代码高亮（Prism.js 应该添加了语言类）
    const preElement = page.locator('pre.language-javascript, pre:has(code.language-javascript)')
    await expect(preElement).toBeVisible()
  })

  test('应该正确渲染 KaTeX 数学公式', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'math.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 等待 KaTeX 渲染
    await page.waitForTimeout(1000)

    // 验证 KaTeX 渲染（行内公式）
    const inlineFormula = page.locator('.katex')
    await expect(inlineFormula.first()).toBeVisible()

    // 验证块级公式
    const blockFormula = page.locator('.katex-display')
    await expect(blockFormula).toBeVisible()
  })

  test('应该正确渲染 Mermaid 图表', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'mermaid.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    // 等待 Mermaid 渲染完成（可能需要更长时间）
    await page.waitForTimeout(3000)

    // 验证 Mermaid 容器或 SVG 存在
    const mermaidContainer = page.locator('.mermaid-container, .mermaid, svg[id^="mermaid"]')
    await expect(mermaidContainer.first()).toBeVisible()
  })

  test('Excalidraw fixture 应覆盖代码块、文件引用和警告渲染', async ({ page, electronApp, testDir }) => {
    test.setTimeout(120000)
    const fixturePath = join(__dirname, 'fixtures/test-excalidraw.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await expect(page.locator('.excalidraw-wrapper')).toHaveCount(64, { timeout: 90000 })
    await expect(page.locator('.excalidraw-container svg')).toHaveCount(64, { timeout: 90000 })
    await expect(page.locator('.excalidraw-error')).toHaveCount(0)
    await expect(page.locator('.excalidraw-warning')).toHaveCount(3)
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-kind="code-block"] .excalidraw-container svg').first()).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="基础流程"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="带查询参数"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="网关扇出"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="电商平台架构"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="较大但均衡"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="绑定文本容器"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Frame 元素"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="箭头头部集合"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Sequence 生命线"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="Class Diagram"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="ER Diagram"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="小元素网格"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 高级序列图"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML Salt 线框"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 链接类图"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper[data-excalidraw-source-label="PlantUML 复杂导出序列"] .excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-warning')).toContainText([
      '图片资源缺失',
      '空画布',
      '兼容模式',
    ])
    const basicFlowBox = await page.locator('.excalidraw-wrapper[data-excalidraw-source-label="基础流程"] .excalidraw-container svg').boundingBox()
    expect(basicFlowBox?.width ?? 0).toBeLessThan(900)
    mkdirSync(EXCALIDRAW_VISUAL_DIR, { recursive: true })
    const visualTargets = [
      { label: '基础流程', file: 'basic-flow.png' },
      { label: 'Unicode 与长文本', file: 'text-unicode.png' },
      { label: '较大但均衡', file: 'large-balanced-graph.png' },
      { label: '箭头头部集合', file: 'arrowhead-gallery.png' },
      { label: '纵向长流程', file: 'tall-flow.png' },
      { label: '横向宽画布', file: 'wide-canvas.png' },
      { label: 'PlantUML 高级序列图', file: 'plantuml-sequence-advanced.png' },
      { label: 'PlantUML Salt 线框', file: 'plantuml-salt-wireframe.png' },
      { label: 'PlantUML 复杂导出序列', file: 'plantuml-export-sequence.png' },
    ]
    for (const target of visualTargets) {
      const wrapper = page.locator(`.excalidraw-wrapper[data-excalidraw-source-label="${target.label}"]`).first()
      const box = await wrapper.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThan(160)
      expect(box?.height ?? 0).toBeGreaterThan(60)
      const screenshot = await wrapper.screenshot({
        path: join(EXCALIDRAW_VISUAL_DIR, target.file),
      })
      expect(screenshot.byteLength).toBeGreaterThan(2000)
    }
    await expect(page.locator('.excalidraw-action-btn[data-action="toggleCode"]').first()).toBeVisible()
    await expect(page.locator('.markdown-body')).not.toContainText('缺少 Markdown 文件路径')
    await expect(page.locator('.markdown-body')).not.toContainText('当前环境不支持读取 Excalidraw 文件')
  })

  test('Excalidraw 错误 fixture 应覆盖坏文件降级渲染', async ({ page }) => {
    const fixturePath = join(__dirname, 'fixtures/test-excalidraw-errors.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await expect(page.locator('.excalidraw-wrapper')).toHaveCount(5, { timeout: 30000 })
    await expect(page.locator('.excalidraw-container svg')).toHaveCount(0)
    await expect(page.locator('.excalidraw-error')).toHaveCount(5)
    await expect(page.locator('.excalidraw-error')).toContainText([
      'Excalidraw JSON 格式错误',
      'Excalidraw JSON 缺少 elements 数组',
      'Excalidraw 内容必须是 JSON 对象',
      'Excalidraw 元素超过 2000 个，未渲染',
      '文件不存在',
    ])
    await expect(page.locator('.markdown-body')).not.toContainText('Error invoking remote method')
    await expect(page.locator('.markdown-body')).not.toContainText('ENOENT')
  })

  test('文件树应显示 .excalidraw 文件并可直接只读预览', async ({ page, electronApp, testDir }) => {
    const directPath = join(testDir, 'direct-preview.excalidraw')
    writeFileSync(directPath, DIRECT_EXCALIDRAW_SOURCE, 'utf8')

    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await expect(page.locator('.tab', { hasText: 'test1.md' })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1', { timeout: 10000 })
    await page.waitForSelector('.file-tree', { timeout: 10000 })

    const row = page.locator('.file-tree-row.file', { hasText: 'direct-preview.excalidraw' })
    await expect(row).toBeVisible()
    await row.click()

    await expect(page.locator('.tab', { hasText: 'direct-preview.excalidraw' })).toBeVisible()
    await expect(page.locator('.excalidraw-wrapper')).toHaveCount(1, { timeout: 15000 })
    await expect(page.locator('.excalidraw-container svg')).toBeVisible()
    await expect(page.locator('.excalidraw-action-btn[data-action="toggleCode"]')).toBeVisible()
    await expect(page.locator('.floating-nav')).toHaveCount(0)
  })

  test('重复打开同一路径时应该从磁盘刷新 Markdown 内容', async ({ page, electronApp, testDir }) => {
    const markdownPath = join(testDir, 'cache-refresh.md')
    writeFileSync(markdownPath, '# 旧内容\n\n第一次打开', 'utf8')

    await openMarkdownFile(page, markdownPath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.markdown-body h1')).toHaveText('旧内容')

    writeFileSync(markdownPath, '# 新内容\n\n第二次打开', 'utf8')
    await openMarkdownFile(page, markdownPath)

    await expect(page.locator('.markdown-body h1')).toHaveText('新内容', { timeout: 10000 })
    await expect(page.locator('.markdown-body')).toContainText('第二次打开')
  })

  test('DrawIO 应渲染基础图和 dio 别名，并拦截破损 XML', async ({ page, electronApp, testDir }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const fixturePath = join(__dirname, 'fixtures/test-drawio-smoke.md')
    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    await expect(page.locator('.drawio-wrapper')).toHaveCount(2, { timeout: 15000 })
    await expect(page.locator('.drawio-error')).toHaveCount(1)
    await expect(page.locator('.drawio-error')).toContainText('XML 格式错误')
    await page.waitForFunction(() =>
      document.querySelectorAll('.drawio-container[data-drawio-ready="true"]').length === 2
    )
    const renderedSvgs = page.locator('.drawio-container svg')
    await expect(renderedSvgs.first()).toBeVisible()
    const firstBox = await renderedSvgs.nth(0).boundingBox()
    const secondBox = await renderedSvgs.nth(1).boundingBox()
    expect(firstBox?.width ?? 0).toBeGreaterThan(100)
    expect(firstBox?.height ?? 0).toBeGreaterThan(50)
    expect(secondBox?.width ?? 0).toBeGreaterThan(80)
    expect(secondBox?.height ?? 0).toBeGreaterThan(40)

    expect(consoleErrors.filter(message =>
      message.includes('createViewerForElement') || message.includes('Not a diagram file')
    )).toEqual([])
  })

  test('DrawIO lightbox 应提供可点击的右上角关闭按钮', async ({ page }) => {
    await openMarkdownFile(page, join(__dirname, 'fixtures/test-drawio-smoke.md'))
    await page.waitForSelector('.drawio-container[data-drawio-ready="true"]', { timeout: 60000 })

    const wrapper = page.locator('.drawio-wrapper').first()
    await wrapper.scrollIntoViewIfNeeded()
    await wrapper.hover()
    await wrapper.locator('.drawio-action-btn[data-action="lightbox"]').click({ force: true })

    await expect(page.locator('.geDiagramContainer')).toBeVisible({ timeout: 10000 })
    const closeButton = page.locator('.drawio-lightbox-close')
    await expect(closeButton, 'DrawIO lightbox 应只显示一个右上角关闭按钮').toHaveCount(1)
    await expect(closeButton, 'DrawIO lightbox 应显示右上角关闭按钮').toBeVisible()
    await expect(
      page.locator('.drawio-lightbox-native-close-hidden'),
      'DrawIO 原生 X 不应残留在 DOM 中遮挡代理按钮'
    ).toHaveCount(0)
    await expect(
      closeButton.locator('img'),
      'DrawIO 关闭按钮不应包含内部 img，避免图标本体吞掉点击事件'
    ).toHaveCount(0)
    const nativeToolbarCloseCount = await page.evaluate(() =>
      Array.from(document.body.children)
        .filter((element) => {
          const style = element.getAttribute('style') || ''
          return style.includes('position: fixed') && style.includes('bottom: 60px')
        })
        .flatMap((toolbar) => Array.from(toolbar.querySelectorAll<HTMLElement>('[title]')))
        .filter((element) => /^(Close|关闭)/i.test(element.getAttribute('title') || ''))
        .length
    )
    expect(nativeToolbarCloseCount, 'DrawIO 全屏底部工具栏不应再提供第二个关闭入口').toBe(0)

    await page.evaluate(() => {
      const lateNativeClose = document.createElement('img')
      lateNativeClose.className = 'geAdaptiveAsset'
      lateNativeClose.setAttribute('border', '0')
      lateNativeClose.style.position = 'fixed'
      lateNativeClose.style.top = '32px'
      lateNativeClose.style.right = '32px'
      lateNativeClose.style.cursor = 'pointer'
      lateNativeClose.style.zIndex = '999'
      lateNativeClose.style.width = '26px'
      lateNativeClose.style.height = '26px'
      document.body.appendChild(lateNativeClose)
    })
    await expect(
      page.locator('body > img.geAdaptiveAsset'),
      'DrawIO 晚插入的原生 X 应被代理按钮接管并移除'
    ).toHaveCount(0)
    await expect(closeButton, '接管晚插入原生 X 后仍应只保留一个代理关闭按钮').toHaveCount(1)

    const closeBox = await closeButton.boundingBox()
    expect(closeBox?.width ?? 0, 'DrawIO lightbox 关闭按钮应提供足够大的点击区域').toBeGreaterThanOrEqual(34)
    expect(closeBox?.height ?? 0, 'DrawIO lightbox 关闭按钮应提供足够大的点击区域').toBeGreaterThanOrEqual(34)

    const visualClosePoint = await page.evaluate(() => {
      const close = document.querySelector('.drawio-lightbox-close')
      const rect = close?.getBoundingClientRect()
      return {
        x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2
      }
    })
    const hitInfo = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return {
        className: hit instanceof Element ? hit.closest('.drawio-lightbox-close')?.className ?? '' : '',
        cursor: hit instanceof HTMLElement ? getComputedStyle(hit).cursor : ''
      }
    }, visualClosePoint)
    expect(String(hitInfo.className), '鼠标悬停在右上角视觉关闭点时应命中关闭按钮').toContain('drawio-lightbox-close')
    expect(hitInfo.cursor, '鼠标悬停在右上角视觉关闭点时应显示手势').toBe('pointer')

    await page.evaluate(({ x, y }) => {
      const drawioContainer = document.querySelector('.geDiagramContainer')
      if (!drawioContainer) throw new Error('DrawIO lightbox container not found')
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        const EventClass = type === 'pointerdown' && window.PointerEvent ? window.PointerEvent : window.MouseEvent
        drawioContainer.dispatchEvent(new EventClass(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }))
      }
    }, visualClosePoint)
    await expect(page.locator('.geDiagramContainer'), '点击 DrawIO lightbox 关闭按钮后应关闭覆盖层').toHaveCount(0)
    await expect(page.locator('.drawio-lightbox-close'), '关闭 DrawIO lightbox 后应移除代理关闭按钮').toHaveCount(0)
    await expect.poll(
      async () => page.evaluate(() =>
        Array.from(document.body.children).filter((element) => {
          const style = element.getAttribute('style') || ''
          return style.includes('position: fixed') && style.includes('z-index: 999')
        }).length
      ),
      { message: '关闭 DrawIO lightbox 后应移除 DrawIO 固定定位覆盖节点' }
    ).toBe(0)
    await expect.poll(
      async () => page.evaluate(() => document.body.style.overflow),
      { message: '关闭 DrawIO lightbox 后应恢复页面滚动状态' }
    ).toBe('')
  })

  test('DrawIO lightbox 按 Esc 应一次关闭全部全屏覆盖层', async ({ page }) => {
    await openMarkdownFile(page, join(__dirname, 'fixtures/test-drawio-smoke.md'))
    await page.waitForSelector('.drawio-container[data-drawio-ready="true"]', { timeout: 60000 })

    const wrapper = page.locator('.drawio-wrapper').first()
    await wrapper.scrollIntoViewIfNeeded()
    await wrapper.hover()
    await wrapper.locator('.drawio-action-btn[data-action="lightbox"]').click({ force: true })

    await expect(page.locator('.geDiagramContainer')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.drawio-lightbox-close')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.geDiagramContainer'), 'Esc 后 DrawIO lightbox 主容器应被移除').toHaveCount(0)
    await expect(page.locator('.drawio-lightbox-close'), 'Esc 后 DrawIO 代理关闭按钮应被移除').toHaveCount(0)
    await expect.poll(
      async () => page.evaluate(() =>
        Array.from(document.body.children).filter((element) => {
          const style = element.getAttribute('style') || ''
          return style.includes('position: fixed') && style.includes('z-index: 999')
        }).length
      ),
      { message: 'Esc 后不应残留 DrawIO 固定定位覆盖节点' }
    ).toBe(0)
    await expect.poll(
      async () => page.evaluate(() => document.body.style.overflow),
      { message: 'Esc 后应恢复页面滚动状态' }
    ).toBe('')
  })

  test('所有 SVG 图表全屏后应无水平滚动、图表可见且工具条统一', async ({ page, electronApp, testDir }) => {
    test.setTimeout(240000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })
    })
    await page.waitForTimeout(300)
    await mockPlantUMLFetch(page)
    await mockKrokiFetch(page, electronApp)
    mkdirSync(CHART_FULLSCREEN_VISUAL_DIR, { recursive: true })

    const fixturePath = join(testDir, 'all-chart-fullscreen.md')
    writeFileSync(fixturePath, createAllChartFullscreenFixture(), 'utf8')
    const charts: ChartFullscreenCase[] = [
      { name: 'Mermaid', id: 'mermaid', wrapper: '.mermaid-wrapper', container: '.mermaid-container', button: '.mermaid-action-btn', ready: '.mermaid-wrapper .mermaid-container svg' },
      { name: 'ECharts', id: 'echarts', wrapper: '.echarts-wrapper', container: '.echarts-container', button: '.echarts-action-btn', ready: '.echarts-wrapper .echarts-container svg' },
      { name: 'Markmap', id: 'markmap', wrapper: '.markmap-wrapper', container: '.markmap-container', button: '.markmap-action-btn', ready: '.markmap-wrapper .markmap-container svg' },
      { name: 'Graphviz', id: 'graphviz', wrapper: '.graphviz-wrapper', container: '.graphviz-container', button: '.graphviz-action-btn', ready: '.graphviz-wrapper .graphviz-container svg' },
      { name: 'Infographic', id: 'infographic', wrapper: '.infographic-wrapper', container: '.infographic-container', button: '.infographic-action-btn', ready: '.infographic-wrapper .infographic-container svg' },
      { name: 'Excalidraw', id: 'excalidraw', wrapper: '.excalidraw-wrapper', container: '.excalidraw-container', button: '.excalidraw-action-btn', ready: '.excalidraw-wrapper .excalidraw-container svg' },
      { name: 'PlantUML', id: 'plantuml', wrapper: '.plantuml-wrapper', container: '.plantuml-container', button: '.plantuml-action-btn', ready: '.plantuml-wrapper .plantuml-container svg' },
      { name: 'Vega-Lite', id: 'vega-lite', wrapper: '.vega-lite-wrapper', container: '.vega-lite-container', button: '.vega-lite-action-btn', ready: '.vega-lite-wrapper .vega-lite-container svg' },
      { name: 'D2', id: 'd2', wrapper: '.d2-wrapper', container: '.d2-container', button: '.d2-action-btn', ready: '.d2-wrapper .d2-container svg' },
      { name: 'BPMN', id: 'bpmn', wrapper: '.bpmn-wrapper', container: '.bpmn-container', button: '.bpmn-action-btn', ready: '.bpmn-wrapper .bpmn-container svg' },
      { name: 'WaveDrom', id: 'wavedrom', wrapper: '.wavedrom-wrapper', container: '.wavedrom-container', button: '.wavedrom-action-btn', ready: '.wavedrom-wrapper .wavedrom-container svg' },
      { name: 'C4PlantUML', id: 'c4plantuml', wrapper: '.c4plantuml-wrapper', container: '.plantuml-container', button: '.plantuml-action-btn', ready: '.c4plantuml-wrapper .plantuml-container svg' },
      { name: 'Structurizr', id: 'structurizr', wrapper: '.structurizr-wrapper', container: '.structurizr-container', button: '.structurizr-action-btn', ready: '.structurizr-wrapper .structurizr-container svg' },
      { name: 'Plotly', id: 'plotly', wrapper: '.plotly-wrapper', container: '.plotly-container', button: '.plotly-action-btn', ready: '.plotly-wrapper .plotly-container svg' },
      { name: 'DBML', id: 'dbml', wrapper: '.dbml-wrapper', container: '.dbml-container', button: '.dbml-action-btn', ready: '.dbml-wrapper .dbml-container svg' },
      { name: 'AntV G6', id: 'antv-g6', wrapper: '.antv-g6-wrapper', container: '.antv-g6-container', button: '.antv-g6-action-btn', ready: '.antv-g6-wrapper .antv-g6-container svg' },
      { name: 'Kroki', id: 'kroki', wrapper: '.kroki-wrapper', container: '.kroki-container', button: '.kroki-action-btn', ready: '.kroki-wrapper .kroki-container svg' },
    ]

    await openMarkdownFile(page, fixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    for (const chart of charts) {
      await expect(page.locator(chart.ready).first(), `${chart.name} 应完成渲染`).toBeVisible({ timeout: 90000 })
      const target = page.locator(chart.wrapper).first()
      await target.scrollIntoViewIfNeeded()
      await target.hover()
      await target.locator(`${chart.button}[data-action="fullscreen"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getChartFullscreenVisualState(page, chart)).visible,
        { message: `${chart.name} 应进入全屏层` }
      ).toBe(true)

      const state = await getChartFullscreenVisualState(page, chart)
      expectDrawIOLikeFullscreenVisualState(state, chart.name)
      const screenshot = await page.locator(`${chart.wrapper}.chart-fullscreen`).screenshot({
        path: join(CHART_FULLSCREEN_VISUAL_DIR, `${chart.id}-fullscreen.png`),
      })
      expect(screenshot.byteLength, `${chart.name} 全屏截图不应为空`).toBeGreaterThan(2000)

      await page.keyboard.press('Escape')
      await expect.poll(
        async () => (await getChartFullscreenVisualState(page, chart)).visible,
        { message: `${chart.name} Esc 应退出全屏层` }
      ).toBe(false)
    }
  })

  test('Markmap 大型 fixture 全屏后应重新适配可视区域', async ({ page, electronApp }) => {
    test.setTimeout(120000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })
    })
    await page.waitForTimeout(300)

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-markmap.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.markmap-wrapper')).toHaveCount(22, { timeout: 90000 })

    const target = page.locator('.markmap-wrapper').nth(1)
    await target.scrollIntoViewIfNeeded()
    await target.hover()
    await target.locator('.markmap-action-btn[data-action="fullscreen"]').click({ force: true })
    await expect.poll(
      async () => (await getMarkmapFullscreenContentState(page)).visible,
      { message: 'Markmap 应进入公共全屏层' }
    ).toBe(true)

    await expect.poll(
      async () => {
        const state = await getMarkmapFullscreenContentState(page)
        return Math.max(
          state.groupWidth / Math.max(state.contentClientWidth, 1),
          state.groupHeight / Math.max(state.contentClientHeight, 1),
        )
      },
      { message: '大型 Markmap 全屏后应按自身宽高比充分展开' }
    ).toBeGreaterThan(0.7)

    const state = await getMarkmapFullscreenContentState(page)
    expect(state.svgWidth / Math.max(state.contentClientWidth, 1), 'Markmap 全屏 SVG 应充分占用内容面板宽度').toBeGreaterThan(0.7)
    expect(state.svgHeight / Math.max(state.contentClientHeight, 1), 'Markmap 全屏 SVG 应充分占用内容面板高度').toBeGreaterThan(0.65)
    expect(state.groupWidth / Math.max(state.contentClientWidth, 1), '高窄 Markmap 全屏内容宽度仍应可读').toBeGreaterThan(0.25)
    expect(state.groupHeight / Math.max(state.contentClientHeight, 1), 'Markmap 全屏内容高度不应过小').toBeGreaterThan(0.65)
    expect(state.toolbarButtonCount, 'Markmap 全屏工具条应保留四个按钮').toBe(4)
    expect(state.toolbarText, 'Markmap 全屏工具条不应显示 emoji 文本').toBe('')

    await page.locator('.markmap-wrapper.chart-fullscreen .chart-lightbox-close').click({ force: true })
    await expect.poll(
      async () => (await getMarkmapFullscreenContentState(page)).visible,
      { message: 'Markmap 关闭按钮应退出全屏层' }
    ).toBe(false)
  })

  test('RendererPlugin 综合 fixture 应在真实预览中渲染', async ({ page, electronApp }) => {
    test.setTimeout(300000)
    await mockPlantUMLFetch(page)
    await mockKrokiFetch(page, electronApp)

    const fixtures = [
      {
        file: 'test-vega-lite.md',
        countSelector: '.vega-lite-wrapper',
        renderSelector: '.vega-lite-wrapper .vega-lite-container svg',
        errorSelector: '.vega-lite-error',
        expected: 50,
      },
      {
        file: 'test-d2.md',
        countSelector: '.d2-wrapper',
        renderSelector: '.d2-wrapper .d2-container svg',
        errorSelector: '.d2-error',
        expected: 50,
      },
      {
        file: 'test-bpmn.md',
        countSelector: '.bpmn-wrapper',
        renderSelector: '.bpmn-wrapper .bpmn-container svg',
        errorSelector: '.bpmn-error',
        expected: 44,
      },
      {
        file: 'test-wavedrom.md',
        countSelector: '.wavedrom-wrapper',
        renderSelector: '.wavedrom-wrapper .wavedrom-container svg',
        errorSelector: '.wavedrom-error',
        expected: 46,
      },
      {
        file: 'test-c4plantuml.md',
        countSelector: '.c4plantuml-wrapper',
        renderSelector: '.c4plantuml-wrapper .plantuml-container svg',
        errorSelector: '.c4plantuml-wrapper .plantuml-error, .c4plantuml-error',
        expected: 50,
      },
      {
        file: 'test-structurizr.md',
        countSelector: '.structurizr-wrapper',
        renderSelector: '.structurizr-wrapper .structurizr-container svg',
        errorSelector: '.structurizr-error',
        expected: 24,
      },
      {
        file: 'test-plotly.md',
        countSelector: '.plotly-wrapper',
        renderSelector: '.plotly-wrapper .plotly-container svg',
        errorSelector: '.plotly-error',
        expected: 24,
      },
      {
        file: 'test-dbml.md',
        countSelector: '.dbml-wrapper',
        renderSelector: '.dbml-wrapper .dbml-container svg',
        errorSelector: '.dbml-error',
        expected: 24,
      },
      {
        file: 'test-antv-g6.md',
        countSelector: '.antv-g6-wrapper',
        renderSelector: '.antv-g6-wrapper .antv-g6-container svg',
        errorSelector: '.antv-g6-error',
        expected: 24,
      },
      {
        file: 'test-kroki.md',
        countSelector: '.kroki-wrapper',
        renderSelector: '.kroki-wrapper .kroki-container svg',
        errorSelector: '.kroki-error',
        expected: 24,
      },
    ]

    for (const fixture of fixtures) {
      await openMarkdownFile(page, join(__dirname, `fixtures/${fixture.file}`))
      await page.waitForSelector('.markdown-body', { timeout: 10000 })
      await expect(page.locator(fixture.countSelector), fixture.file).toHaveCount(fixture.expected, { timeout: 120000 })
      await expect(page.locator(fixture.errorSelector), fixture.file).toHaveCount(0)
      await expect(page.locator(fixture.renderSelector).first(), fixture.file).toBeVisible()

      const firstBox = await page.locator(fixture.renderSelector).first().boundingBox()
      expect(firstBox?.width ?? 0, `${fixture.file} first rendered width`).toBeGreaterThan(20)
      expect(firstBox?.height ?? 0, `${fixture.file} first rendered height`).toBeGreaterThan(8)
    }
  })

  test('Kroki fixture 关键图表排版应保持可读留白', async ({ page, electronApp }) => {
    test.setTimeout(180000)
    mkdirSync(RENDERER_FIXTURE_VISUAL_DIR, { recursive: true })

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1280, height: 1000 })
    })
    await page.waitForTimeout(300)
    await mockKrokiFetch(page, electronApp)
    await openMarkdownFile(page, join(__dirname, 'fixtures/test-kroki.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    await expect(page.locator('.kroki-wrapper')).toHaveCount(24, { timeout: 120000 })
    await expect(page.locator('.kroki-error')).toHaveCount(0)

    const cases = [
      { index: 3, name: 'pikchr-timeline', minWidth: 520, minHeight: 36 },
      { index: 6, name: 'svgbob-network', minWidth: 220, minHeight: 90 },
      { index: 7, name: 'svgbob-flow', minWidth: 260, minHeight: 44 },
      { index: 10, name: 'tikz-simple-flow', minWidth: 240, minHeight: 24 },
      { index: 11, name: 'tikz-architecture', minWidth: 260, minHeight: 70 },
      { index: 17, name: 'svgbob-service-network', minWidth: 320, minHeight: 160 },
      { index: 18, name: 'svgbob-batch-topology', minWidth: 340, minHeight: 100 },
      { index: 19, name: 'svgbob-data-lineage', minWidth: 280, minHeight: 100 },
      { index: 22, name: 'tikz-layered-architecture', minWidth: 360, minHeight: 120 },
      { index: 23, name: 'tikz-release-flow', minWidth: 360, minHeight: 34 },
    ]

    for (const item of cases) {
      const wrapper = page.locator(`.kroki-wrapper[data-kroki-index="${item.index}"]`).first()
      await expect(wrapper.locator('.kroki-container svg')).toBeVisible({ timeout: 120000 })
      await wrapper.scrollIntoViewIfNeeded()

      const metrics = await wrapper.evaluate((element) => {
        const wrapperEl = element as HTMLElement
        const container = wrapperEl.querySelector('.kroki-container') as HTMLElement | null
        const svg = wrapperEl.querySelector('.kroki-container svg') as SVGSVGElement | null
        const firstText = svg?.querySelector('text') as SVGTextElement | null
        const svgBox = svg?.getBoundingClientRect()
        return {
          svgWidth: svgBox?.width ?? 0,
          svgHeight: svgBox?.height ?? 0,
          svgStyleCount: svg?.querySelectorAll('style').length ?? 0,
          svgRectCount: svg?.querySelectorAll('rect').length ?? 0,
          svgPathCount: svg?.querySelectorAll('path').length ?? 0,
          svgTextCount: svg?.querySelectorAll('text').length ?? 0,
          firstTextFontSize: firstText ? Number.parseFloat(getComputedStyle(firstText).fontSize) : 0,
          textWithFontPresentationCount: Array.from(svg?.querySelectorAll('text') ?? [])
            .filter(text => text.hasAttribute('font-size') || text instanceof SVGElement && text.style.fontSize).length,
          containerHorizontalOverflow: container ? container.scrollWidth - container.clientWidth : 0,
          wrapperHorizontalOverflow: wrapperEl.scrollWidth - wrapperEl.clientWidth,
        }
      })

      expect(metrics.svgWidth, `${item.name} SVG 宽度应可读`).toBeGreaterThan(item.minWidth)
      expect(metrics.svgHeight, `${item.name} SVG 高度应可读`).toBeGreaterThan(item.minHeight)
      if (item.name.startsWith('tikz-')) {
        expect(metrics.svgStyleCount, `${item.name} 应保留 Kroki TikZ 内嵌字体样式`).toBeGreaterThan(0)
        expect(metrics.textWithFontPresentationCount, `${item.name} 应给文本节点补充字体属性兜底`).toBeGreaterThan(0)
        expect(metrics.firstTextFontSize, `${item.name} 字体不应退回浏览器默认 16px`).toBeGreaterThan(0)
        expect(metrics.firstTextFontSize, `${item.name} 字体不应退回浏览器默认 16px`).toBeLessThan(10)
      }
      if (item.name.startsWith('svgbob-')) {
        expect(metrics.svgStyleCount, `${item.name} 应保留 SvgBob 内嵌线条样式`).toBeGreaterThan(0)
        expect(metrics.svgRectCount, `${item.name} 应渲染为清晰方框`).toBeGreaterThanOrEqual(metrics.svgTextCount)
        expect(metrics.svgPathCount, `${item.name} 不应使用易出现断裂顶盖的路径盒子`).toBe(0)
      }
      expect(metrics.containerHorizontalOverflow, `${item.name} 容器不应因 padding 产生横向滚动`).toBeLessThanOrEqual(2)
      expect(metrics.wrapperHorizontalOverflow, `${item.name} wrapper 不应因 padding 产生横向滚动`).toBeLessThanOrEqual(2)

      const screenshot = await wrapper.screenshot({
        path: join(RENDERER_FIXTURE_VISUAL_DIR, `kroki-${item.name}.png`),
      })
      expect(screenshot.byteLength, `${item.name} 视觉截图不应为空`).toBeGreaterThan(3000)
    }
  })

  test('Structurizr 复杂分组图不应被 viewBox 裁切', async ({ page }) => {
    test.setTimeout(120000)
    mkdirSync(RENDERER_FIXTURE_VISUAL_DIR, { recursive: true })

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-structurizr.md'))
    await page.waitForSelector('.markdown-body', { timeout: 10000 })
    const wrapper = page.locator('.structurizr-wrapper[data-structurizr-index="14"]').first()
    await expect(wrapper.locator('.structurizr-container svg')).toBeVisible({ timeout: 90000 })
    await wrapper.scrollIntoViewIfNeeded()

    const state = await wrapper.evaluate((element) => {
      const svg = element.querySelector('svg') as SVGSVGElement | null
      if (!svg) return null
      const viewBox = svg.viewBox.baseVal
      const bbox = svg.getBBox()
      const rect = svg.getBoundingClientRect()
      return {
        viewBoxX: viewBox.x,
        viewBoxY: viewBox.y,
        viewBoxRight: viewBox.x + viewBox.width,
        viewBoxBottom: viewBox.y + viewBox.height,
        bboxX: bbox.x,
        bboxY: bbox.y,
        bboxRight: bbox.x + bbox.width,
        bboxBottom: bbox.y + bbox.height,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
      }
    })

    expect(state).not.toBeNull()
    expect(state!.bboxX, 'Structurizr 内容左侧不应超出 viewBox').toBeGreaterThanOrEqual(state!.viewBoxX - 1)
    expect(state!.bboxY, 'Structurizr 内容顶部不应超出 viewBox').toBeGreaterThanOrEqual(state!.viewBoxY - 1)
    expect(state!.bboxRight, 'Structurizr 内容右侧不应超出 viewBox').toBeLessThanOrEqual(state!.viewBoxRight + 1)
    expect(state!.bboxBottom, 'Structurizr 内容底部不应超出 viewBox').toBeLessThanOrEqual(state!.viewBoxBottom + 1)
    expect(state!.renderedWidth).toBeGreaterThan(300)
    expect(state!.renderedHeight).toBeGreaterThan(180)

    const screenshot = await wrapper.screenshot({
      path: join(RENDERER_FIXTURE_VISUAL_DIR, 'structurizr-data-lake-governance.png'),
    })
    expect(screenshot.byteLength).toBeGreaterThan(3000)
  })

  test('RendererPlugin 工具栏应支持源码、缩放、下载和可读全屏', async ({ page, electronApp, testDir }) => {
    test.setTimeout(240000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1200, height: 1000 })
    })
    await page.waitForTimeout(300)
    await mockPlantUMLFetch(page)
    await mockKrokiFetch(page, electronApp)
    await installChartDownloadSpy(page)
    await installChartClipboardSpy(page)

    const toolbarFixturePath = join(testDir, 'renderer-toolbar.md')
    writeFileSync(toolbarFixturePath, [
      '# RendererPlugin 工具栏测试',
      '',
      '```vega-lite',
      '{"data":{"values":[{"name":"A","value":28},{"name":"B","value":55}]},"mark":"bar","encoding":{"x":{"field":"name","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}',
      '```',
      '',
      '```d2',
      'reader -> renderer -> toolbar',
      '```',
      '',
      '```bpmn',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">',
      '  <bpmn:process id="Process_1" isExecutable="false"><bpmn:startEvent id="StartEvent_1" /></bpmn:process>',
      '  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1"><bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="156" y="81" width="36" height="36" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>',
      '</bpmn:definitions>',
      '```',
      '',
      '```wavedrom',
      "{ signal: [{ name: 'clk', wave: 'p..P' }, { name: 'data', wave: 'x.3x', data: ['valid'] }] }",
      '```',
      '',
      '```c4plantuml',
      '@startuml',
      'Person(user, "User")',
      'System(app, "MD Viewer")',
      'Rel(user, app, "views")',
      '@enduml',
      '```',
      '',
      '```structurizr',
      'workspace "Toolbar Structurizr" {',
      '  model {',
      '    user = person "User"',
      '    app = softwareSystem "MD Viewer"',
      '    user -> app "views"',
      '  }',
      '}',
      '```',
      '',
      '```plotly',
      '{"data":[{"type":"bar","name":"Toolbar","x":["A","B"],"y":[1,2]}],"layout":{"title":"Toolbar Plotly"}}',
      '```',
      '',
      '```dbml',
      'Table users { id int [pk] org_id int }',
      'Table orgs { id int [pk] name varchar }',
      'Ref: users.org_id > orgs.id',
      '```',
      '',
      '```antv-g6',
      '{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"source":"a","target":"b","label":"link"}]}',
      '```',
      '',
      '```nomnoml',
      '[Toolbar] -> [Kroki]',
      '```',
    ].join('\n'))

    const fixtures = [
      {
        name: 'Vega-Lite',
        wrapper: '.vega-lite-wrapper',
        container: '.vega-lite-container',
        button: '.vega-lite-action-btn',
        back: '.vega-lite-back-btn',
        downloadPrefix: 'vega-lite-',
        copySample: '"mark":"bar"',
      },
      {
        name: 'D2',
        wrapper: '.d2-wrapper',
        container: '.d2-container',
        button: '.d2-action-btn',
        back: '.d2-back-btn',
        downloadPrefix: 'd2-',
        copySample: 'reader -> renderer -> toolbar',
      },
      {
        name: 'BPMN',
        wrapper: '.bpmn-wrapper',
        container: '.bpmn-container',
        button: '.bpmn-action-btn',
        back: '.bpmn-back-btn',
        downloadPrefix: 'bpmn-',
        copySample: '<bpmn:definitions',
      },
      {
        name: 'WaveDrom',
        wrapper: '.wavedrom-wrapper',
        container: '.wavedrom-container',
        button: '.wavedrom-action-btn',
        back: '.wavedrom-back-btn',
        downloadPrefix: 'wavedrom-',
        copySample: 'signal',
      },
      {
        name: 'C4PlantUML',
        wrapper: '.c4plantuml-wrapper',
        container: '.plantuml-container',
        button: '.plantuml-action-btn',
        back: '.plantuml-back-btn',
        downloadPrefix: 'plantuml-',
        copySample: 'Person(user, "User")',
      },
      {
        name: 'Structurizr',
        wrapper: '.structurizr-wrapper',
        container: '.structurizr-container',
        button: '.structurizr-action-btn',
        back: '.structurizr-back-btn',
        downloadPrefix: 'structurizr-',
        copySample: 'Toolbar Structurizr',
      },
      {
        name: 'Plotly',
        wrapper: '.plotly-wrapper',
        container: '.plotly-container',
        button: '.plotly-action-btn',
        back: '.plotly-back-btn',
        downloadPrefix: 'plotly-',
        copySample: '"type":"bar"',
      },
      {
        name: 'DBML',
        wrapper: '.dbml-wrapper',
        container: '.dbml-container',
        button: '.dbml-action-btn',
        back: '.dbml-back-btn',
        downloadPrefix: 'dbml-',
        copySample: 'Table users',
      },
      {
        name: 'AntV G6',
        wrapper: '.antv-g6-wrapper',
        container: '.antv-g6-container',
        button: '.antv-g6-action-btn',
        back: '.antv-g6-back-btn',
        downloadPrefix: 'antv-g6-',
        copySample: '"nodes"',
      },
      {
        name: 'Kroki',
        wrapper: '.kroki-wrapper',
        container: '.kroki-container',
        button: '.kroki-action-btn',
        back: '.kroki-back-btn',
        downloadPrefix: 'kroki-',
        copySample: '[Toolbar] -> [Kroki]',
      },
    ] satisfies RendererToolbarFixture[]

    await openMarkdownFile(page, toolbarFixturePath)
    await page.waitForSelector('.markdown-body', { timeout: 10000 })

    for (const fixture of fixtures) {
      await expect(page.locator(fixture.wrapper), fixture.name).toHaveCount(1, { timeout: 90000 })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).buttonCount,
        { message: `${fixture.name} 应显示 6 个工具栏按钮` }
      ).toBe(6)

      const baseState = await getRendererToolbarState(page, fixture)
      expect(baseState.chartVisible, `${fixture.name} 初始应显示图表`).toBe(true)
      expect(baseState.codeVisible, `${fixture.name} 初始不应显示源码`).toBe(false)
      expect(baseState.svgWidth, `${fixture.name} 初始 SVG 宽度`).toBeGreaterThan(20)
      expect(baseState.svgHeight, `${fixture.name} 初始 SVG 高度`).toBeGreaterThan(8)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="toggleCode"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).codeVisible,
        { message: `${fixture.name} 点击源码按钮后应显示源码视图` }
      ).toBe(true)
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).chartVisible,
        { message: `${fixture.name} 源码视图下应隐藏图表视图` }
      ).toBe(false)
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).backCount,
        { message: `${fixture.name} 源码视图应提供返回图表按钮` }
      ).toBe(1)
      await page.locator(`${fixture.wrapper} [data-view="code"]`).first().hover()
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).backVisible,
        { message: `${fixture.name} 源码视图 hover 后应显示返回图表按钮` }
      ).toBe(true)
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).copyVisible,
        { message: `${fixture.name} 源码视图 hover 后应显示复制按钮` }
      ).toBe(true)
      const codeState = await getRendererToolbarState(page, fixture)
      expect(codeState.codePaddingTop, `${fixture.name} 源码视图应预留工具按钮空间`).toBeGreaterThanOrEqual(40)
      const clipboardCount = (await getChartClipboardWrites(page)).length
      await page.locator(`${fixture.wrapper} [data-view="code"] .copy-btn`).first().click({ force: true })
      await expect.poll(
        async () => (await getChartClipboardWrites(page)).length,
        { message: `${fixture.name} 源码视图复制按钮应写入剪贴板` }
      ).toBe(clipboardCount + 1)
      expect((await getChartClipboardWrites(page)).at(-1), `${fixture.name} 源码复制内容`).toContain(fixture.copySample)

      await page.locator(`${fixture.wrapper} ${fixture.back}`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).chartVisible,
        { message: `${fixture.name} 点击返回后应恢复图表视图` }
      ).toBe(true)
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).codeVisible,
        { message: `${fixture.name} 返回图表后应隐藏源码视图` }
      ).toBe(false)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="zoomIn"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).svgWidth,
        { message: `${fixture.name} 放大按钮应放大图表` }
      ).toBeGreaterThan(baseState.svgWidth * 1.08)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="fit"]`).first().click({ force: true })
      await expect.poll(
        async () => Math.abs((await getRendererToolbarState(page, fixture)).svgWidth - baseState.svgWidth),
        { message: `${fixture.name} 适应大小应恢复初始宽度` }
      ).toBeLessThan(6)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="zoomOut"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).svgWidth,
        { message: `${fixture.name} 缩小按钮应缩小图表` }
      ).toBeLessThan(baseState.svgWidth * 0.95)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="fullscreen"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).fullscreen,
        { message: `${fixture.name} 全屏按钮应进入全屏` }
      ).toBe(true)
      const fullscreenMetrics = await getRendererToolbarState(page, fixture)
      const readableRatio = Math.max(
        fullscreenMetrics.svgWidth / Math.max(fullscreenMetrics.wrapperWidth, 1),
        fullscreenMetrics.svgHeight / Math.max(fullscreenMetrics.wrapperHeight, 1),
      )
      const fullscreenWidthRatio = fullscreenMetrics.svgWidth / Math.max(fullscreenMetrics.wrapperWidth, 1)
      const fullscreenHeightRatio = fullscreenMetrics.svgHeight / Math.max(fullscreenMetrics.wrapperHeight, 1)
      expect(fullscreenMetrics.wrapperWidth, `${fixture.name} 全屏 wrapper 宽度`).toBeGreaterThan(500)
      expect(fullscreenMetrics.wrapperHeight, `${fixture.name} 全屏 wrapper 高度`).toBeGreaterThan(450)
      expect(fullscreenMetrics.fullscreenParentIsBody, `${fixture.name} 全屏节点应脱离预览虚拟滚动容器`).toBe(true)
      expect(fullscreenMetrics.closeButtonCount, `${fixture.name} 全屏层应只有一个右上角关闭按钮`).toBe(1)
      expect(fullscreenMetrics.closeButtonVisible, `${fixture.name} 全屏关闭按钮应可见`).toBe(true)
      expect(fullscreenMetrics.closeButtonWidth, `${fixture.name} 全屏关闭按钮应有足够点击宽度`).toBeGreaterThanOrEqual(44)
      expect(fullscreenMetrics.closeButtonHeight, `${fixture.name} 全屏关闭按钮应有足够点击高度`).toBeGreaterThanOrEqual(44)
      expectDrawIOLikeFullscreenToolbar(fullscreenMetrics, fixture.name)
      expect(readableRatio, `${fixture.name} 全屏图表应清晰可读`).toBeGreaterThan(0.28)
      expect(fullscreenWidthRatio, `${fixture.name} 全屏图表不应横向过度放大`).toBeLessThan(0.88)
      expect(fullscreenHeightRatio, `${fixture.name} 全屏图表不应纵向过度放大`).toBeLessThan(0.87)
      expect(
        Math.min(fullscreenMetrics.svgWidth, fullscreenMetrics.svgHeight),
        `${fixture.name} 全屏图表短边不应过小`
      ).toBeGreaterThan(100)

      await page.locator(`${fixture.wrapper}.chart-fullscreen .chart-lightbox-close`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).fullscreen,
        { message: `${fixture.name} 右上角关闭按钮应退出全屏` }
      ).toBe(false)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="fit"]`).first().click({ force: true })
      await expect.poll(
        async () => Math.abs((await getRendererToolbarState(page, fixture)).svgWidth - baseState.svgWidth),
        { message: `${fixture.name} 退出全屏后适应大小仍应可用` }
      ).toBeLessThan(6)

      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="fullscreen"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).fullscreen,
        { message: `${fixture.name} 应可再次进入全屏` }
      ).toBe(true)
      await page.keyboard.press('Escape')
      await expect.poll(
        async () => (await getRendererToolbarState(page, fixture)).fullscreen,
        { message: `${fixture.name} Esc 应退出全屏` }
      ).toBe(false)

      const downloadCount = (await getChartDownloadRecords(page)).length
      await page.locator(fixture.wrapper).first().hover()
      await page.locator(`${fixture.wrapper} ${fixture.button}[data-action="download"]`).first().click({ force: true })
      await expect.poll(
        async () => (await getChartDownloadRecords(page)).length,
        { message: `${fixture.name} 下载按钮应触发 PNG 下载` }
      ).toBe(downloadCount + 1)
      const downloads = await getChartDownloadRecords(page)
      expect(downloads.at(-1)?.download, `${fixture.name} 下载文件名`).toMatch(new RegExp(`^${fixture.downloadPrefix}\\d+\\.png$`))
      expect(downloads.at(-1)?.hrefPrefix, `${fixture.name} 下载内容应为 PNG data URL`).toMatch(/^data:image\/png;base64,iVBORw0K/)
    }
  })

  test('BPMN 下载图片在布局尺寸不可用时应保持 viewBox 比例', async ({ page, electronApp }) => {
    test.setTimeout(90000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1200, height: 900 })
    })
    await page.waitForTimeout(300)
    await installChartDownloadSpy(page)

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-bpmn.md'))
    const target = page.locator('.bpmn-wrapper').first()
    await expect(target.locator('.bpmn-container svg')).toBeVisible({ timeout: 60000 })

    await page.evaluate(() => {
      SVGElement.prototype.getBBox = function forcedUnavailableBBox() {
        throw new Error('forced unavailable bbox')
      }
    })

    await target.scrollIntoViewIfNeeded()
    await target.hover()
    await target.locator('.bpmn-action-btn[data-action="download"]').click({ force: true })
    await expect.poll(
      async () => (await getChartDownloadRecords(page)).length,
      { message: 'BPMN 下载按钮应生成 PNG data URL' }
    ).toBe(1)

    const imageSize = await page.evaluate(async () => {
      const record = ((window as ChartDownloadSpyWindow).__chartDownloadClicks ?? []).at(-1)
      if (!record?.href) return null
      return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('download image failed to load'))
        image.src = record.href!
      })
    })

    expect(imageSize).not.toBeNull()
    expect(imageSize!.width, 'BPMN fallback 下载宽度应来自 viewBox，而不是默认 800x600').toBeGreaterThan(900)
    expect(imageSize!.height, 'BPMN fallback 下载高度不应退回默认 600x2').toBeLessThan(500)
    expect(
      imageSize!.width / imageSize!.height,
      'BPMN fallback 下载应保持横向流程图比例，不应被拉成 4:3'
    ).toBeGreaterThan(2.3)
  })

  test('all-charts PNG 下载应避免异常超宽和明显偏移', async ({ page, electronApp }) => {
    test.setTimeout(180000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1400, height: 1000 })
    })
    await page.waitForTimeout(300)
    await mockPlantUMLFetch(page)
    await mockKrokiFetch(page, electronApp)
    await installChartDownloadSpy(page)

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-all-charts.md'))

    const downloadAndMeasure = async (wrapperSelector: string, buttonSelector: string, index = 0) => {
      const before = (await getChartDownloadRecords(page)).length
      const wrapper = page.locator(wrapperSelector).nth(index)
      await expect(wrapper.locator('svg')).toBeVisible({ timeout: 90000 })
      await wrapper.scrollIntoViewIfNeeded()
      await wrapper.hover()
      await wrapper.locator(buttonSelector).click({ force: true })
      await expect.poll(
        async () => (await getChartDownloadRecords(page)).length,
        { message: `${wrapperSelector} 应触发 PNG 下载` }
      ).toBe(before + 1)
      const metrics = await getLatestChartDownloadImageMetrics(page)
      expect(metrics, `${wrapperSelector} 下载 PNG 应可解析像素边界`).not.toBeNull()
      return metrics!
    }

    const mermaidGantt = await downloadAndMeasure('.mermaid-wrapper', '.mermaid-action-btn[data-action="download"]', 5)
    expect(mermaidGantt.width, 'Mermaid 甘特图导出宽度不应来自异常 getBBox').toBeLessThan(3000)
    expect(mermaidGantt.width / mermaidGantt.height, 'Mermaid 甘特图导出比例不应异常拉宽').toBeLessThan(6)

    const dbml = await downloadAndMeasure('.dbml-wrapper', '.dbml-action-btn[data-action="download"]')
    expect(dbml.xOffsetRatio, 'DBML 导出内容不应明显偏左或偏右').toBeLessThan(0.18)
    expect(dbml.yOffsetRatio, 'DBML 导出内容不应明显偏上或偏下').toBeLessThan(0.18)

    const antvG6 = await downloadAndMeasure('.antv-g6-wrapper', '.antv-g6-action-btn[data-action="download"]')
    expect(antvG6.xOffsetRatio, 'AntV G6 导出内容不应明显偏左或偏右').toBeLessThan(0.18)
    expect(antvG6.yOffsetRatio, 'AntV G6 导出内容不应明显偏上或偏下').toBeLessThan(0.18)
  })

  test('ECharts 全屏工具栏应复用 DrawIO 底部工具条样式', async ({ page, electronApp, testDir }) => {
    test.setTimeout(120000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1400, height: 1000 })
    })
    await page.waitForTimeout(300)
    await installChartDownloadSpy(page)

    const fixturePath = join(testDir, 'echarts-drawio-toolbar.md')
    writeFileSync(fixturePath, [
      '# ECharts DrawIO 工具栏样式',
      '',
      '```echarts',
      JSON.stringify({
        title: { text: 'RendererPlugin 覆盖率' },
        tooltip: {},
        legend: { data: ['通过', '失败'] },
        xAxis: { type: 'category', data: ['Mermaid', 'ECharts', 'Graphviz', 'D2', 'BPMN'] },
        yAxis: { type: 'value' },
        series: [
          { name: '通过', type: 'bar', data: [12, 18, 15, 22, 20] },
          { name: '失败', type: 'line', data: [1, 0, 2, 1, 0] },
        ],
      }),
      '```',
    ].join('\n'))

    const fixture = {
      name: 'ECharts',
      wrapper: '.echarts-wrapper',
      container: '.echarts-container',
      button: '.echarts-action-btn',
      back: '.echarts-back-btn',
      downloadPrefix: 'echarts-',
      copySample: '"series"',
    } satisfies RendererToolbarFixture

    await openMarkdownFile(page, fixturePath)
    await expect(page.locator('.echarts-wrapper .echarts-container svg')).toBeVisible({ timeout: 60000 })
    await expect.poll(
      async () => (await getRendererToolbarState(page, fixture)).buttonCount,
      { message: 'ECharts 普通视图应提供源码、缩放、下载和全屏 6 个按钮' }
    ).toBe(6)

    const baseState = await getRendererToolbarState(page, fixture)
    await page.locator('.echarts-wrapper').first().hover()
    await page.locator('.echarts-action-btn[data-action="fullscreen"]').first().click({ force: true })
    await expect.poll(
      async () => (await getRendererToolbarState(page, fixture)).fullscreen,
      { message: 'ECharts 应进入公共 chart-fullscreen 全屏层' }
    ).toBe(true)

    const fullscreenState = await getRendererToolbarState(page, fixture)
    expect(fullscreenState.fullscreenParentIsBody, 'ECharts 全屏节点应脱离预览虚拟滚动容器').toBe(true)
    expect(fullscreenState.closeButtonCount, 'ECharts 全屏层应只有一个右上角关闭按钮').toBe(1)
    expect(fullscreenState.closeButtonVisible, 'ECharts 全屏关闭按钮应可见').toBe(true)
    expectDrawIOLikeFullscreenToolbar(fullscreenState, 'ECharts')

    await page.locator('.echarts-wrapper.chart-fullscreen .echarts-action-btn[data-action="zoomIn"]').click({ force: true })
    await expect.poll(
      async () => (await getRendererToolbarState(page, fixture)).svgWidth,
      { message: 'ECharts 全屏放大按钮应改变可见图表宽度' }
    ).toBeGreaterThan(fullscreenState.svgWidth * 1.08)

    await page.locator('.echarts-wrapper.chart-fullscreen .echarts-action-btn[data-action="fit"]').click({ force: true })
    await expect.poll(
      async () => Math.abs((await getRendererToolbarState(page, fixture)).svgWidth - fullscreenState.svgWidth),
      { message: 'ECharts 全屏适应大小应恢复初始全屏宽度' }
    ).toBeLessThan(8)

    const downloadCount = (await getChartDownloadRecords(page)).length
    await page.locator('.echarts-wrapper.chart-fullscreen .echarts-action-btn[data-action="download"]').click({ force: true })
    await expect.poll(
      async () => (await getChartDownloadRecords(page)).length,
      { message: 'ECharts 全屏下载按钮应触发 PNG 下载' }
    ).toBe(downloadCount + 1)

    await page.locator('.echarts-wrapper.chart-fullscreen .chart-lightbox-close').click({ force: true })
    await expect.poll(
      async () => (await getRendererToolbarState(page, fixture)).fullscreen,
      { message: 'ECharts 右上角关闭按钮应退出全屏' }
    ).toBe(false)

    await page.locator('.echarts-wrapper').first().hover()
    await page.locator('.echarts-action-btn[data-action="fit"]').first().click({ force: true })
    await expect.poll(
      async () => Math.abs((await getRendererToolbarState(page, fixture)).svgWidth - baseState.svgWidth),
      { message: 'ECharts 退出全屏后适应大小仍应可用' }
    ).toBeLessThan(8)
  })

  test('D2 全屏应放大宽图且退出后保留原图', async ({ page, electronApp }) => {
    test.setTimeout(180000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 2048, height: 1200 })
    })
    await page.waitForTimeout(300)

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-d2.md'))
    const target = page.locator('.d2-wrapper[data-d2-index="3"]')
    await expect(target.locator('.d2-container > svg')).toBeVisible({ timeout: 120000 })
    await target.scrollIntoViewIfNeeded()
    await target.hover()

    const before = await getD2FullscreenRegressionState(page, '3')
    expect(before.originalInMarkdown, 'D2 原图初始应在 Markdown 正文中').toBe(true)
    expect(before.originalSvgVisible, 'D2 原图初始 SVG 应可见').toBe(true)

    await target.locator('.d2-action-btn[data-action="fullscreen"]').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenRegressionState(page, '3')).fullscreenVisible,
      { message: 'D2 应进入全屏' }
    ).toBe(true)

    const fullscreen = await getD2FullscreenRegressionState(page, '3')
    expect(fullscreen.originalInMarkdown, 'D2 进入全屏后原图仍应保留在 Markdown 正文中').toBe(true)
    expect(fullscreen.originalSvgVisible, 'D2 进入全屏后原图 SVG 不应被移走').toBe(true)
    expect(
      fullscreen.fullscreenSvgWidth / Math.max(fullscreen.viewportWidth, 1),
      'D2 宽图全屏不应过小'
    ).toBeGreaterThan(0.84)

    await page.locator('.d2-wrapper.chart-fullscreen .chart-lightbox-close').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenRegressionState(page, '3')).fullscreenVisible,
      { message: 'D2 应退出全屏' }
    ).toBe(false)

    const after = await getD2FullscreenRegressionState(page, '3')
    expect(after.originalInMarkdown, 'D2 退出全屏后原图应回到 Markdown 正文中').toBe(true)
    expect(after.originalVisible, 'D2 退出全屏后原图容器应可见').toBe(true)
    expect(after.originalSvgVisible, 'D2 退出全屏后 SVG 应可见').toBe(true)
    expect(after.bodyDirectD2Count, 'D2 退出全屏后不应残留 body 直挂图表').toBe(0)
  })

  test('D2 真实 fixture 全屏工具栏应全部可用', async ({ page, electronApp }) => {
    test.setTimeout(180000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 2048, height: 1200 })
    })
    await page.waitForTimeout(300)
    await installChartDownloadSpy(page)

    await openMarkdownFile(page, join(__dirname, 'fixtures/test-d2.md'))
    const target = page.locator('.d2-wrapper[data-d2-index="3"]')
    await expect(target.locator('.d2-container > svg')).toBeVisible({ timeout: 120000 })
    await target.scrollIntoViewIfNeeded()
    await target.hover()

    await target.locator('.d2-action-btn[data-action="fullscreen"]').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenToolbarState(page)).visible,
      { message: 'D2 真实 fixture 应进入全屏层' }
    ).toBe(true)

    const initial = await getD2FullscreenToolbarState(page)
    expect(initial.closeButtonCount, 'D2 全屏层应显示一个右上角关闭按钮').toBe(1)
    expect(initial.closeButtonVisible, 'D2 全屏层右上角关闭按钮应可见').toBe(true)
    expectDrawIOLikeD2FullscreenToolbar(initial)
    expect(initial.togglePointerEvents, 'D2 全屏工具栏应可点击').toBe('auto')
    expect(initial.chartVisible, 'D2 全屏初始应显示图表').toBe(true)
    expect(initial.codeVisible, 'D2 全屏初始不应显示源码').toBe(false)

    await page.locator('.d2-wrapper.chart-fullscreen .d2-action-btn[data-action="zoomIn"]').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenToolbarState(page)).svgWidth,
      { message: 'D2 全屏放大按钮应改变可见图表宽度' }
    ).toBeGreaterThan(initial.svgWidth * 1.08)
    const zoomed = await getD2FullscreenToolbarState(page)
    expect(zoomed.zoomLevel, 'D2 全屏放大后应记录缩放级别').toBe('120')
    expect(zoomed.zoomedWrapper, 'D2 全屏放大后 wrapper 应进入 zoomed 状态').toBe(true)

    await page.locator('.d2-wrapper.chart-fullscreen .d2-action-btn[data-action="zoomOut"]').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenToolbarState(page)).svgWidth,
      { message: 'D2 全屏缩小按钮应回落图表宽度' }
    ).toBeLessThan(zoomed.svgWidth * 0.95)

    await page.locator('.d2-wrapper.chart-fullscreen .d2-action-btn[data-action="fit"]').click({ force: true })
    await expect.poll(
      async () => Math.abs((await getD2FullscreenToolbarState(page)).svgWidth - initial.svgWidth),
      { message: 'D2 全屏适应大小应恢复初始全屏宽度' }
    ).toBeLessThan(8)
    expect((await getD2FullscreenToolbarState(page)).zoomedWrapper, 'D2 全屏适应大小后应退出 zoomed 状态').toBe(false)

    const downloadCount = (await getChartDownloadRecords(page)).length
    await page.locator('.d2-wrapper.chart-fullscreen .d2-action-btn[data-action="download"]').click({ force: true })
    await expect.poll(
      async () => (await getChartDownloadRecords(page)).length,
      { message: 'D2 全屏下载按钮应触发 PNG 下载' }
    ).toBe(downloadCount + 1)

    await page.locator('.d2-wrapper.chart-fullscreen .chart-lightbox-close').click({ force: true })
    await expect.poll(
      async () => (await getD2FullscreenToolbarState(page)).visible,
      { message: 'D2 全屏退出按钮应关闭全屏层' }
    ).toBe(false)
  })

  test('D2 宽图全屏尺寸应适配小屏和大屏', async ({ page, electronApp }) => {
    test.setTimeout(240000)

    const cases = [
      { name: '小窗口', width: 900, height: 720, minRatio: 0.76, maxRatio: 0.91 },
      { name: '大窗口', width: 3200, height: 1400, minRatio: 0.76, maxRatio: 0.91 },
    ]

    for (const size of cases) {
      await electronApp.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0]?.setBounds(bounds)
      }, { x: 0, y: 0, width: size.width, height: size.height })
      await page.waitForTimeout(300)
      await openMarkdownFile(page, join(__dirname, 'fixtures/test-d2.md'))
      const target = page.locator('.d2-wrapper[data-d2-index="3"]')
      await target.waitFor({ state: 'attached', timeout: 120000 })
      await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center' }))
      await page.waitForTimeout(300)
      await expect(target.locator('.d2-container > svg')).toBeVisible({ timeout: 120000 })
      await target.hover()

      await target.locator('.d2-action-btn[data-action="fullscreen"]').click({ force: true })
      await expect.poll(
        async () => (await getD2FullscreenRegressionState(page, '3')).fullscreenVisible,
        { message: `${size.name} 下 D2 应进入全屏` }
      ).toBe(true)

      const state = await getD2FullscreenRegressionState(page, '3')
      const widthRatio = state.fullscreenSvgWidth / Math.max(state.viewportWidth, 1)
      expect(widthRatio, `${size.name} 下 D2 宽图全屏不应过小`).toBeGreaterThan(size.minRatio)
      expect(widthRatio, `${size.name} 下 D2 宽图全屏不应过度贴边`).toBeLessThan(size.maxRatio)
      expect(state.fullscreenSvgHeight, `${size.name} 下 D2 宽图全屏高度应可见`).toBeGreaterThan(60)

      await page.locator('.d2-wrapper.chart-fullscreen .chart-lightbox-close').click({ force: true })
      await expect.poll(
        async () => (await getD2FullscreenRegressionState(page, '3')).fullscreenVisible,
        { message: `${size.name} 下 D2 应退出全屏` }
      ).toBe(false)
    }
  })

  test('普通比例大图全屏不应被固定宽度上限截断', async ({ page, electronApp, testDir }) => {
    test.setTimeout(180000)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 3200, height: 1400 })
    })
    await page.waitForTimeout(300)

    const largeChartPath = join(testDir, 'large-balanced-chart.md')
    writeFileSync(largeChartPath, [
      '# 普通比例大图',
      '',
      '```vega-lite',
      JSON.stringify({
        width: 1600,
        height: 900,
        data: {
          values: Array.from({ length: 12 }, (_, index) => ({
            category: `C${index + 1}`,
            value: 20 + index * 7,
          })),
        },
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      }),
      '```',
    ].join('\n'))

    const fixture = {
      name: 'Vega-Lite large balanced chart',
      wrapper: '.vega-lite-wrapper',
      container: '.vega-lite-container',
      button: '.vega-lite-action-btn',
      back: '.vega-lite-back-btn',
      downloadPrefix: 'vega-lite-',
      copySample: '"height":900',
    } satisfies RendererToolbarFixture

    await openMarkdownFile(page, largeChartPath)
    await expect(page.locator('.vega-lite-wrapper .vega-lite-container > svg')).toBeVisible({ timeout: 90000 })
    await page.locator('.vega-lite-wrapper').hover()
    await page.locator('.vega-lite-action-btn[data-action="fullscreen"]').click({ force: true })
    await expect.poll(
      async () => (await getRendererToolbarState(page, fixture)).fullscreen,
      { message: '普通比例大图应进入全屏' }
    ).toBe(true)

    const state = await getRendererToolbarState(page, fixture)
    const widthRatio = state.svgWidth / Math.max(state.wrapperWidth, 1)
    expect(state.svgWidth, '普通比例大图在大屏全屏不应被 1280px 固定上限截断').toBeGreaterThan(1500)
    expect(widthRatio, '普通比例大图在大屏全屏不应贴满屏幕').toBeLessThan(0.86)
    expect(widthRatio, '普通比例大图在大屏全屏应随视口放大').toBeGreaterThan(0.5)
  })

  test('标签栏应该显示打开的文件', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 验证标签存在
    const tab = page.locator('.tab:has-text("test1.md")')
    await expect(tab).toBeVisible()

    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForTimeout(500)

    // 验证两个标签
    await expect(page.locator('.tab')).toHaveCount(2)
  })

  test('点击标签应该切换预览', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.markdown-body', { timeout: 5000 })

    await openMarkdownFile(page, join(testDir, 'test2.md'))
    await page.waitForTimeout(500)

    // 验证当前显示 test2
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 2')

    // 点击 test1 标签
    await page.click('.tab:has-text("test1.md")')
    await page.waitForTimeout(300)

    // 验证切换到 test1
    await expect(page.locator('.markdown-body h1')).toHaveText('Test 1')
  })

  test('关闭标签按钮应该关闭标签', async ({ page, electronApp, testDir }) => {
    await openMarkdownFile(page, join(testDir, 'test1.md'))
    await page.waitForSelector('.tab', { timeout: 5000 })

    // 找到关闭按钮并点击
    const closeBtn = page.locator('.tab:has-text("test1.md") .tab-close, .tab:has-text("test1.md") .close-btn')
    if (await closeBtn.isVisible()) {
      await closeBtn.click()

      // 等待关闭
      await page.waitForTimeout(300)

      // 验证标签已关闭
      await expect(page.locator('.tab:has-text("test1.md")')).not.toBeVisible()
    }
  })
})
