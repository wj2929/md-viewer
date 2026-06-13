import MarkdownIt from 'markdown-it'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import type { BrowserPageRenderResult, ServerRenderInput } from '../../renderer/src/server-render/contracts'
import { escapeHtml } from './sharedExportWriters'
import type { CliArtifact } from './types'

const MAX_CAPTURE_DIMENSION_PX = 12000

export type HeadlessMarkdownRenderer = (input: ServerRenderInput) => Promise<BrowserPageRenderResult>

export interface MarkdownScreenshotCaptureOptions {
  renderInput: ServerRenderInput
  outputPath: string
  selector?: string
  chartIndex?: number
  viewport?: {
    width: number
    height: number
    scaleFactor: number
  }
}

export interface MarkdownScreenshotCaptureResult {
  artifact: CliArtifact
  renderResult: BrowserPageRenderResult
  target: {
    selector: string
    widthPx: number
    heightPx: number
  }
}

export type MarkdownScreenshotCapture = (
  options: MarkdownScreenshotCaptureOptions,
) => Promise<MarkdownScreenshotCaptureResult>

export const renderMarkdownHeadless: HeadlessMarkdownRenderer = async (input) => {
  try {
    return await renderMarkdownWithServerRenderPage(input)
  } catch (error) {
    const fallback = renderMarkdownFallback(input)
    fallback.warnings.push({
      code: 'FALLBACK_USED',
      severity: 'warning',
      title: '已回退到基础 Markdown 渲染',
      message: error instanceof Error ? error.message : String(error),
      recoverable: true,
      fallback: 'source_code_preserved',
    })
    return fallback
  }
}

async function renderMarkdownWithServerRenderPage(input: ServerRenderInput): Promise<BrowserPageRenderResult> {
  const { renderWindow, wrapperPath } = await createServerRenderWindow(input, {
    width: 1280,
    height: 900,
    scaleFactor: 1,
  })
  const timeoutMs = input.timeoutMs ?? 30000

  try {
    try {
      await renderWindow.loadFile(wrapperPath)
    } finally {
      rm(wrapperPath, { force: true }).catch(() => undefined)
    }

    const result = await waitForRenderResult(renderWindow, timeoutMs)
    if (!result) {
      return buildTimeoutResult(input, timeoutMs)
    }
    return result
  } finally {
    if (!renderWindow.isDestroyed()) {
      renderWindow.destroy()
    }
  }
}

export const captureMarkdownScreenshot: MarkdownScreenshotCapture = async (options) => {
  const viewport = options.viewport ?? {
    width: 1280,
    height: 900,
    scaleFactor: 1,
  }
  const { renderWindow, wrapperPath } = await createServerRenderWindow(options.renderInput, viewport)
  const timeoutMs = options.renderInput.timeoutMs ?? 30000

  try {
    try {
      await renderWindow.loadFile(wrapperPath)
    } finally {
      rm(wrapperPath, { force: true }).catch(() => undefined)
    }

    const renderResult = await waitForRenderResult(renderWindow, timeoutMs)
    if (!renderResult) {
      throw new Error(`headless 渲染超过 ${timeoutMs}ms 未完成`)
    }

    const target = resolveScreenshotTarget(renderResult, options)
    const selector = target.selector
    await scrollElementIntoView(renderWindow, selector)
    const measuredBounds = await getElementCaptureBounds(renderWindow, selector)
    const initialBounds = measuredBounds ? applyPreferredCaptureSize(measuredBounds, target) : null
    if (!initialBounds) {
      throw new Error(`未找到截图目标：${selector}`)
    }
    const deviceScaleFactor = await getDeviceScaleFactor(renderWindow)
    const maxCssCaptureDimension = getMaxCssCaptureDimension(deviceScaleFactor)
    const captureScale = calculateCaptureScale(initialBounds, deviceScaleFactor)
    if (captureScale < 1) {
      renderWindow.webContents.setZoomFactor(viewport.scaleFactor * captureScale)
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    const bounds = constrainCaptureBounds(
      captureScale < 1
        ? applyPreferredCaptureSize(await getElementCaptureBounds(renderWindow, selector) ?? initialBounds, target)
        : initialBounds,
      maxCssCaptureDimension,
    )

    await mkdir(path.dirname(options.outputPath), { recursive: true })
    renderWindow.setContentSize(
      Math.max(viewport.width, Math.ceil(bounds.x + bounds.width + 24)),
      Math.max(viewport.height, Math.ceil(bounds.y + bounds.height + 24)),
    )
    await new Promise(resolve => setTimeout(resolve, 100))

    let image = await renderWindow.webContents.capturePage(bounds)
    let pngBuffer = image.toPNG()
    if (pngBuffer.length < 500) {
      await new Promise(resolve => setTimeout(resolve, 500))
      image = await renderWindow.webContents.capturePage(bounds)
      pngBuffer = image.toPNG()
    }

    if (pngBuffer.length < 500) {
      throw new Error(`截图结果为空：${selector}`)
    }

    await writeFile(options.outputPath, pngBuffer)
    const artifactStat = await stat(options.outputPath)
    return {
      artifact: {
        type: 'png',
        path: options.outputPath,
        bytes: artifactStat.size,
      },
      renderResult,
      target: {
        selector,
        widthPx: bounds.width,
        heightPx: bounds.height,
      },
    }
  } finally {
    if (!renderWindow.isDestroyed()) {
      renderWindow.destroy()
    }
  }
}

export function calculateCaptureScale(bounds: {
  width: number
  height: number
}, deviceScaleFactor = 1): number {
  const maxDimension = Math.max(bounds.width, bounds.height)
  const maxCssDimension = getMaxCssCaptureDimension(deviceScaleFactor)
  if (maxDimension <= maxCssDimension) {
    return 1
  }
  return Math.max(0.1, maxCssDimension / maxDimension)
}

export function constrainCaptureBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}, maxCssDimension = MAX_CAPTURE_DIMENSION_PX): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, Math.min(bounds.width, maxCssDimension)),
    height: Math.max(1, Math.min(bounds.height, maxCssDimension)),
  }
}

export function getMaxCssCaptureDimension(deviceScaleFactor: number): number {
  const safeScaleFactor = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1
  return Math.max(1, Math.floor(MAX_CAPTURE_DIMENSION_PX / safeScaleFactor))
}

export function applyPreferredCaptureSize(
  bounds: { x: number; y: number; width: number; height: number },
  preferred: { widthPx?: number; heightPx?: number },
): { x: number; y: number; width: number; height: number } {
  const padding = 48
  return {
    x: bounds.x,
    y: bounds.y,
    width: preferred.widthPx && preferred.widthPx > 0 ? preferred.widthPx + padding : bounds.width,
    height: preferred.heightPx && preferred.heightPx > 0 ? preferred.heightPx + padding : bounds.height,
  }
}

async function createServerRenderWindow(
  input: ServerRenderInput,
  viewport: { width: number; height: number; scaleFactor: number },
): Promise<{ renderWindow: BrowserWindow; wrapperPath: string }> {
  if (!app.isReady()) {
    await app.whenReady()
  }

  const renderWindow = new BrowserWindow({
    show: false,
    width: viewport.width,
    height: viewport.height,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  renderWindow.webContents.setZoomFactor(viewport.scaleFactor)

  const wrapperPath = await createServerRenderWrapper(input)
  return { renderWindow, wrapperPath }
}

async function createServerRenderWrapper(input: ServerRenderInput): Promise<string> {
  const rendererRoot = join(__dirname, '../renderer')
  const serverRenderHtml = await readFile(join(rendererRoot, 'server-render.html'), 'utf8')
  const assetTags = extractAssetTags(serverRenderHtml)
  const wrapperPath = join(tmpdir(), `md-viewer-server-render-${process.pid}-${Date.now()}.html`)
  await writeFile(wrapperPath, `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MD Viewer CLI Server Render</title>
    <base href="${pathToFileURL(`${rendererRoot}/`).href}">
    <script>
      window.__MDV_RENDER_INPUT__ = ${JSON.stringify(input).replace(/</g, '\\u003c')};
      window.sessionStorage.setItem('__MDV_RENDER_INPUT__', JSON.stringify(window.__MDV_RENDER_INPUT__));
      window.__MDV_RENDER_DONE__ = false;
      window.__MDV_RENDER_RESULT__ = undefined;
    </script>
    ${assetTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`, 'utf8')
  return wrapperPath
}

function extractAssetTags(serverRenderHtml: string): string {
  const tags = Array.from(serverRenderHtml.matchAll(/<(?:script|link)\b[^>]*(?:><\/script>|>)/gi))
    .map(match => match[0])
    .filter(tag => /serverRender-|katex-/i.test(tag))
    .map(tag => tag.replace(/"\.\/assets\//g, '"assets/'))

  if (tags.length === 0) {
    throw new Error(`无法从 server-render.html 提取渲染资源：${escapeHtml(serverRenderHtml.slice(0, 120))}`)
  }

  return tags.join('\n    ')
}

async function waitForRenderResult(
  renderWindow: BrowserWindow,
  timeoutMs: number,
): Promise<BrowserPageRenderResult | null> {
  const startedAt = Date.now()
  const pollingDeadlineMs = timeoutMs + 1500
  while (Date.now() - startedAt < pollingDeadlineMs) {
    const result = await renderWindow.webContents.executeJavaScript(`
      window.__MDV_RENDER_DONE__ === true ? window.__MDV_RENDER_RESULT__ : null
    `)
    if (result) {
      return result as BrowserPageRenderResult
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return null
}

function resolveScreenshotTarget(
  renderResult: BrowserPageRenderResult,
  options: MarkdownScreenshotCaptureOptions,
): { selector: string; widthPx?: number; heightPx?: number } {
  if (options.chartIndex) {
    const image = renderResult.images[options.chartIndex - 1]
    if (!image) {
      throw new Error(`未找到第 ${options.chartIndex} 个图表`)
    }
    return {
      selector: image.selector,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
    }
  }
  return { selector: options.selector || '.markdown-body' }
}

async function getElementCaptureBounds(
  renderWindow: BrowserWindow,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const serializedSelector = JSON.stringify(selector)
  const raw = await renderWindow.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector(${serializedSelector});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
      const paddingY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        scrollWidth: el.scrollWidth || 0,
        scrollHeight: el.scrollHeight || 0,
        paddingX,
        paddingY
      };
    })()
  `)
  return raw ? normalizeElementCaptureBounds(raw) : null
}

async function getDeviceScaleFactor(renderWindow: BrowserWindow): Promise<number> {
  const raw = await renderWindow.webContents.executeJavaScript('window.devicePixelRatio || 1')
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1
}

async function scrollElementIntoView(renderWindow: BrowserWindow, selector: string): Promise<void> {
  const serializedSelector = JSON.stringify(selector)
  await renderWindow.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector(${serializedSelector});
      if (!el) return false;
      el.scrollIntoView({ block: 'start', inline: 'nearest' });
      return true;
    })()
  `)
  await new Promise(resolve => setTimeout(resolve, 100))
}

export function normalizeElementCaptureBounds(raw: {
  left: number
  top: number
  width: number
  height: number
  scrollWidth: number
  scrollHeight: number
  paddingX: number
  paddingY: number
}): { x: number; y: number; width: number; height: number } {
  const width = raw.width > 0 ? raw.width : raw.scrollWidth
  const height = raw.height > 0 ? raw.height : raw.scrollHeight
  return {
    x: Math.max(0, Math.floor(raw.left)),
    y: Math.max(0, Math.floor(raw.top)),
    width: Math.ceil(Math.max(width, 1) + Math.min(raw.paddingX, 48)),
    height: Math.ceil(Math.max(height, 1) + Math.min(raw.paddingY, 48)),
  }
}

function renderMarkdownFallback(input: ServerRenderInput): BrowserPageRenderResult {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true })
  const startedAt = Date.now()
  return {
    schemaVersion: '1.0',
    ok: true,
    status: 'success',
    html: md.render(input.markdown),
    images: [],
    stats: {
      totalBlocks: 0,
      renderedBlocks: 0,
      failedBlocks: 0,
      durationMs: Date.now() - startedAt,
    },
    warnings: [],
  }
}

function buildTimeoutResult(input: ServerRenderInput, timeoutMs: number): BrowserPageRenderResult {
  const fallback = renderMarkdownFallback(input)
  return {
    ...fallback,
    ok: false,
    status: 'timeout',
    stats: {
      ...fallback.stats,
      failedBlocks: fallback.stats.totalBlocks,
      durationMs: timeoutMs,
    },
    warnings: [
      {
        code: 'RENDER_TIMEOUT',
        severity: 'error',
        title: '渲染超时',
        message: `headless 渲染超过 ${timeoutMs}ms 未完成`,
        recoverable: true,
        fallback: 'source_code_preserved',
      },
    ],
  }
}
