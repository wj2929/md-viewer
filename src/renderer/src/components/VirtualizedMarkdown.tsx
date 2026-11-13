import { useEffect, useRef, useMemo, memo, useCallback, forwardRef, useState, useId } from 'react'
import MarkdownIt from 'markdown-it'
import debounce from 'lodash.debounce'
import Mark from 'mark.js'
import { useReadPosition } from '../hooks/useReadPosition'

// v1.4.6: 使用统一的渲染器配置
import { createMarkdownRenderer, setupDOMPurifyHooks } from '../utils/markdownRenderer'
import { useMarkdownRender } from '../hooks/useMarkdownRender'
import {
  decodeLocalImageMarker,
  decodeLocalMediaMarker,
} from '../utils/localMediaMarkup'
import {
  LOCAL_ATTACHMENT_TEXT_EXTENSIONS,
  LOCAL_IMAGE_MARKER_ATTRIBUTE,
  LOCAL_MEDIA_MARKER_ATTRIBUTE,
  WIKI_LINK_MARKER_ATTRIBUTE,
  decodeLocalResourceMarker,
} from '../../../shared/localMedia'
import type { ParsedWikiReference } from '../../../shared/markdown/obsidianSyntax'
import { isBareWikiDocumentName } from '../../../shared/markdown/wikiDocumentNames'
import { BLOCK_ANCHOR_PREFIX, inspectMarkdownBlock } from '../../../shared/markdown/blocks'
import { annotateLinkOccurrences, captureLinkView, locateLinkView, locateMarkdownBlock, previewRevision, SINGLE_NAVIGATION_LEAF, type PreviewLinkContext, type LinkPositionRequest } from '../utils/linkNavigation'

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
  useRestrictedSvgChart,
  useKrokiChart,
} from './charts'
import type { RemoteChartPolicy } from './charts/remoteChartConsent'
import {
  longTaskSummary,
  recordFileTerminal,
  recordPostRenderSnapshot,
  recordPreviewSummary,
  recordPreviewState,
  type RendererFileDiagnosticOperation,
} from '../utils/diagnostics'

// v1.4.0: 页面内搜索
import { useFileStore } from '../stores/fileStore'
import { useTabStore } from '../stores/tabStore'
import { remoteChartDocumentKey, useRemoteChartSettingsStore } from '../stores/remoteChartSettingsStore'
import { useInPageSearch } from '../hooks/useInPageSearch'
import { InPageSearchBox } from './search'
import { LargeDocumentPreview } from './LargeDocumentPreview'
import { collectExportableChartPngs, countExportableCharts } from '../utils/chartUtils'
import { createEditableBlockDecision, type EditableBlockKind } from '../utils/v24WorkflowContracts'
import { openHelpLink, SOURCE_EDIT_HELP_URL } from '../utils/helpLinks'
import {
  classifyMarkdownTarget,
  createHeadingIdAllocator,
  markdownAnchorMatches,
  safeDecodeURIComponent,
  splitMarkdownTarget,
} from '../../../shared/markdown/semantics'

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
  isActive?: boolean
  renderDebounceMs?: number
  scrollToLine?: number
  scrollToRatio?: number
  initialScrollRatio?: number
  onScrollToLineComplete?: () => void
  onScrollToRatioComplete?: () => void
  highlightKeyword?: string
  onHighlightKeywordComplete?: () => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
  previewEditingEnabled?: boolean
  onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
  onSourceEditRequest?: (target: SourceEditRequest) => void
  onReadPositionChange?: (position: { scrollRatio: number; headingId?: string }) => void
  onMarkdownLinkClick?: (href: string, currentFilePath: string, context?: PreviewLinkContext) => void | Promise<void>
  onAttachmentLinkClick?: (href: string, currentFilePath: string, context: PreviewLinkContext) => void
  linkPositionRequest?: LinkPositionRequest
  remoteChartPolicy?: RemoteChartPolicy
  diagnosticOperation?: RendererFileDiagnosticOperation
  diagnosticPanelKind?: 'main' | 'split' | 'editor'
}

interface MarkdownRenderDiagnostics {
  debounceDelayMs: number
  markdownRenderMs: number
  sanitizeMs: number
}

interface MarkdownDomDiagnostics {
  domPopulateMs: number
  sourceMappingMs: number
  editableAnnotationMs: number
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

const REMOTE_CHART_FENCE = /^\s{0,3}(?:`{3,}|~{3,})\s*(?:plantuml|puml|c4|c4plantuml|kroki(?:-[a-z0-9-]+)?|pikchr|nomnoml|svgbob|bytefield|tikz)\b/gim

function countRemoteChartBlocks(content: string): number {
  return content.match(REMOTE_CHART_FENCE)?.length ?? 0
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
  'svg',
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

function ensureHeadingIds(root: HTMLElement): void {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  const allocateHeadingId = createHeadingIdAllocator()

  headings.forEach((heading) => {
    const id = allocateHeadingId(heading.textContent || '')
    if (heading.id !== id) heading.id = id
  })
}

function findInPageAnchorTarget(root: HTMLElement, href: string): HTMLElement | null {
  const targetId = safeDecodeURIComponent(href.slice(1))
  if (!targetId) return null

  const exactMatch = root.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
  if (exactMatch) return exactMatch

  for (const element of root.querySelectorAll<HTMLElement>('[id]')) {
    if (markdownAnchorMatches(element.id, targetId)) return element
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

function normalizeLocalImageSources(root: HTMLElement, markdownFilePath?: string): void {
  if (!markdownFilePath) return

  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const encodedMarker = img.getAttribute(LOCAL_IMAGE_MARKER_ATTRIBUTE)
    if (encodedMarker) {
      const marker = decodeLocalImageMarker(encodedMarker)
      img.removeAttribute(LOCAL_IMAGE_MARKER_ATTRIBUTE)
      img.removeAttribute('src')
      if (!marker || !window.api.issueLocalImageUrl) return
      img.alt = marker.alt
      if (marker.dimensions) {
        img.width = marker.dimensions.width
        if (marker.dimensions.height) img.height = marker.dimensions.height
      }
      void window.api.issueLocalImageUrl(
        markdownFilePath,
        marker.ref,
        marker.resolutionKind,
      ).then((url) => {
        if (img.isConnected) img.setAttribute('src', url)
      }).catch(() => {
        // 无法签发 capability 时保持图片为空。
      })
      return
    }

    const rawSrc = img.getAttribute('src')
    if (!rawSrc) return
    const src = safeDecodeURIComponent(rawSrc)
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('blob:')) {
      return
    }
    if (src.startsWith('local-image:') || src.startsWith('/') || !window.api.issueLocalImageUrl) {
      img.removeAttribute('src')
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
    const requestedSrc = src
    img.removeAttribute('src')
    void window.api.issueLocalImageUrl(markdownFilePath, requestedSrc)
      .then((url) => {
        if (img.isConnected) img.setAttribute('src', url)
      })
      .catch(() => {
        // 无法签发 capability 时保持图片为空，绝不降级回裸绝对路径。
      })
  })
}

const localMediaCleanups = new WeakMap<HTMLElement, Array<() => void>>()
const LOCAL_MEDIA_NETWORK_ERROR = 2
const LOCAL_MEDIA_DECODE_ERROR = 3
const localMediaInstanceSeed = (() => {
  const values = new Uint32Array(1)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values)
  } else {
    values[0] = Date.now()
  }
  return values[0] % 10_000_000
})()
let localMediaInstanceCounter = 0

function instanceScopedMediaUrl(capabilityUrl: string): string {
  localMediaInstanceCounter = (localMediaInstanceCounter % 999) + 1
  const instance = localMediaInstanceSeed * 1_000 + localMediaInstanceCounter
  return `${capabilityUrl}?instance=${instance}`
}

function localMediaDocumentName(markdownFilePath?: string): string | undefined {
  return markdownFilePath?.split(/[\\/]/).pop()
}

function logLocalMedia(message: string, details: Record<string, unknown> = {}): void {
  console.info(`[LocalMedia] ${message}`, details)
}

function logLocalMediaError(message: string, details: Record<string, unknown> = {}): void {
  console.error(`[LocalMedia] ${message}`, details)
}

function cleanupLocalMedia(root: HTMLElement): void {
  for (const cleanup of localMediaCleanups.get(root) ?? []) cleanup()
  localMediaCleanups.delete(root)
}

function hydrateLocalMedia(root: HTMLElement, markdownFilePath?: string): void {
  cleanupLocalMedia(root)
  if (!markdownFilePath || !window.api.issueLocalMediaUrl) return
  const cleanups: Array<() => void> = []
  localMediaCleanups.set(root, cleanups)

  root.querySelectorAll<HTMLElement>(`[${LOCAL_MEDIA_MARKER_ATTRIBUTE}]`).forEach((placeholder) => {
    const encoded = placeholder.getAttribute(LOCAL_MEDIA_MARKER_ATTRIBUTE) || ''
    const marker = decodeLocalMediaMarker(encoded)
    placeholder.removeAttribute(LOCAL_MEDIA_MARKER_ATTRIBUTE)
    logLocalMedia('hydrate:marker', {
      document: localMediaDocumentName(markdownFilePath),
      kind: marker?.kind ?? null,
      resolutionKind: marker?.resolutionKind ?? null,
      sources: marker?.sources.map(source => source.ref) ?? [],
      tracks: marker?.tracks.length ?? 0,
    })
    if (!marker || marker.sources.length === 0) {
      renderLocalMediaFallback(placeholder, marker?.label || '本地媒体', '无法解析本地媒体')
      return
    }

    const media = document.createElement(marker.kind)
    media.className = 'local-media-player'
    media.controls = marker.controls
    media.preload = marker.preload
    media.muted = marker.muted
    if (marker.kind === 'video' && media instanceof HTMLVideoElement) {
      media.playsInline = marker.playsInline
    }
    if (marker.label) media.setAttribute('aria-label', marker.label)
    if (marker.dimensions && media instanceof HTMLVideoElement) {
      media.width = marker.dimensions.width
      if (marker.dimensions.height) media.height = marker.dimensions.height
    }
    if (marker.fullWidth) media.style.width = '100%'

    const sourceElements = marker.sources.map((source) => {
      const sourceElement = document.createElement('source')
      sourceElement.type = source.mimeType
      return {
        source,
        sourceElement,
        capabilityUrl: null as string | null,
      }
    })

    let disposed = false
    let networkRetryAttempted = false
    const revokeUrls: string[] = []
    const fallback = (): void => {
      logLocalMediaError('media:error', {
        document: localMediaDocumentName(markdownFilePath),
        kind: marker.kind,
        readyState: media.readyState,
        networkState: media.networkState,
        errorCode: media.error?.code ?? null,
        errorMessage: media.error?.message ?? null,
        currentSrc: media.currentSrc || null,
        networkRetryAttempted,
      })
      if (
        !disposed
        && media.isConnected
        && media.error?.code === LOCAL_MEDIA_NETWORK_ERROR
        && !networkRetryAttempted
        && sourceElements.some(source => source.capabilityUrl)
      ) {
        networkRetryAttempted = true
        for (const source of sourceElements) {
          if (source.capabilityUrl) {
            source.sourceElement.src = instanceScopedMediaUrl(source.capabilityUrl)
          }
        }
        logLocalMedia('media:retry', {
          document: localMediaDocumentName(markdownFilePath),
          kind: marker.kind,
          reason: 'MEDIA_ERR_NETWORK',
        })
        media.load()
        return
      }
      if (!disposed && media.isConnected && media.error) {
        renderLocalMediaFallback(media, marker.label || marker.sources[0].ref, '无法加载或播放本地媒体，文件可能无法读取或格式不受支持')
      }
    }
    media.addEventListener('error', fallback)
    cleanups.push(() => {
      disposed = true
      media.removeEventListener('error', fallback)
      media.pause()
      // Cancel resource selection before releasing subtitle URLs still in use.
      media.removeAttribute('src')
      for (const element of media.querySelectorAll('source, track')) {
        if (element instanceof HTMLTrackElement) element.track.mode = 'disabled'
        element.removeAttribute('src')
        element.remove()
      }
      media.load()
      for (const url of revokeUrls) URL.revokeObjectURL(url)
    })

    const sourceRequests = sourceElements.map(async (sourceEntry) => {
      const { source, sourceElement } = sourceEntry
      logLocalMedia('capability:request', {
        document: localMediaDocumentName(markdownFilePath),
        kind: marker.kind,
        resolutionKind: marker.resolutionKind,
        ref: source.ref,
      })
      try {
        const url = await window.api.issueLocalMediaUrl(
          markdownFilePath,
          source.ref,
          marker.kind,
          marker.resolutionKind,
        )
        sourceEntry.capabilityUrl = url
        const scopedUrl = instanceScopedMediaUrl(url)
        logLocalMedia('capability:success', {
          document: localMediaDocumentName(markdownFilePath),
          ref: source.ref,
          instance: scopedUrl.split('instance=')[1] ?? null,
        })
        if (!disposed && placeholder.isConnected) sourceElement.src = scopedUrl
      } catch (error) {
        logLocalMediaError('capability:failure', {
          document: localMediaDocumentName(markdownFilePath),
          ref: source.ref,
          error: error instanceof Error ? error.message : String(error),
        })
        sourceElement.remove()
      }
    })

    let posterDataUrl: string | null = null
    const posterRequest = marker.kind === 'video' && marker.poster && window.api.readLocalAssetBase64
      ? window.api.readLocalAssetBase64({
          markdownFilePath,
          refPath: marker.poster,
          resolutionKind: marker.resolutionKind,
        })
        .then((image) => {
          if (!disposed && placeholder.isConnected) {
            posterDataUrl = `data:${image.mimeType};base64,${image.base64}`
          }
        })
        .catch(() => undefined)
      : Promise.resolve()

    const trackRequests = marker.tracks.map(async (track) => {
      try {
        const vtt = await window.api.readLocalWebVtt(
          markdownFilePath,
          track.ref,
          marker.resolutionKind,
        )
        if (disposed || !placeholder.isConnected) return
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        revokeUrls.push(url)
        const trackElement = document.createElement('track')
        trackElement.src = url
        trackElement.kind = track.kind
        if (track.srclang) trackElement.srclang = track.srclang
        if (track.label) trackElement.label = track.label
        trackElement.default = track.default === true
        media.appendChild(trackElement)
      } catch {
        // 字幕失败不阻断音视频本体。
      }
    })

    void Promise.all([...sourceRequests, posterRequest, ...trackRequests]).then(() => {
      if (disposed || !placeholder.isConnected) return
      for (const { sourceElement } of [...sourceElements].reverse()) {
        if (sourceElement.src) media.insertBefore(sourceElement, media.firstChild)
      }
      if (media.querySelectorAll('source[src]').length === 0) {
        logLocalMediaError('source:none', {
          document: localMediaDocumentName(markdownFilePath),
          kind: marker.kind,
          refs: marker.sources.map(source => source.ref),
        })
        renderLocalMediaFallback(placeholder, marker.label || marker.sources[0].ref, '无法访问本地媒体，请确认文件存在且可读取')
        return
      }
      logLocalMedia('source:attached', {
        document: localMediaDocumentName(markdownFilePath),
        kind: marker.kind,
        sourceCount: media.querySelectorAll('source[src]').length,
      })
      const time = marker.sources.find(source => source.time)?.time
      if (time?.start !== undefined) {
        const seekToStart = (): void => {
          if (Number.isFinite(media.duration)) media.currentTime = Math.min(time.start!, media.duration)
        }
        if (media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) seekToStart()
        else {
          media.addEventListener('canplay', seekToStart, { once: true })
          cleanups.push(() => media.removeEventListener('canplay', seekToStart))
        }
      }
      if (time?.end !== undefined) {
        const stopAtEnd = (): void => {
          if (media.currentTime >= time.end!) media.pause()
        }
        media.addEventListener('timeupdate', stopAtEnd)
        cleanups.push(() => media.removeEventListener('timeupdate', stopAtEnd))
      }
      if (posterDataUrl && media instanceof HTMLVideoElement) {
        const applyPoster = (): void => {
          if (!disposed && posterDataUrl) media.poster = posterDataUrl
        }
        media.addEventListener('loadedmetadata', applyPoster, { once: true })
        cleanups.push(() => media.removeEventListener('loadedmetadata', applyPoster))
      }
      placeholder.replaceWith(media)
      media.addEventListener('loadedmetadata', () => {
        logLocalMedia('media:loadedmetadata', {
          document: localMediaDocumentName(markdownFilePath),
          readyState: media.readyState,
          networkState: media.networkState,
          duration: media.duration,
        })
      }, { once: true })
      media.addEventListener('stalled', () => {
        logLocalMediaError('media:stalled', {
          document: localMediaDocumentName(markdownFilePath),
          readyState: media.readyState,
          networkState: media.networkState,
          currentSrc: media.currentSrc || null,
        })
      }, { once: true })
      media.load()
      if (marker.kind === 'audio') {
        const retryTimer = window.setTimeout(() => {
          if (
            !disposed
            && media.isConnected
            && media.readyState === HTMLMediaElement.HAVE_NOTHING
            && media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
          ) {
            // Chromium 可能延后结束 custom scheme 音频的首次资源选择；
            // 仅在确认无可用 source 后重试一次，不干扰正常加载。
            media.load()
          }
        }, 1000)
        cleanups.push(() => window.clearTimeout(retryTimer))
      }
      const failureTimer = window.setTimeout(() => {
        if (
          !disposed
          && media.isConnected
          && media.readyState === HTMLMediaElement.HAVE_NOTHING
          && media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
        ) {
          renderLocalMediaFallback(media, marker.label || marker.sources[0].ref, '无法加载或播放本地媒体，文件可能无法读取或格式不受支持')
        }
      }, 5000)
      const clearFailureTimer = (): void => window.clearTimeout(failureTimer)
      media.addEventListener('loadedmetadata', clearFailureTimer, { once: true })
      cleanups.push(() => {
        window.clearTimeout(failureTimer)
        media.removeEventListener('loadedmetadata', clearFailureTimer)
      })
    })
  })
}

function renderLocalMediaFallback(target: Element, label: string, reason: string): void {
  const media = target instanceof HTMLMediaElement ? target : null
  if (media?.error?.code === LOCAL_MEDIA_NETWORK_ERROR) {
    reason = '本地媒体读取失败，请确认文件存在且可读取'
  } else if (media?.error?.code === LOCAL_MEDIA_DECODE_ERROR) {
    reason = '本地媒体解码失败，文件可能损坏或编码不受支持'
  }
  const resourceEntry = media?.currentSrc
    ? performance.getEntriesByName(media.currentSrc).at(-1) as PerformanceResourceTiming | undefined
    : undefined
  logLocalMediaError('fallback', {
    label,
    reason,
    readyState: media?.readyState ?? null,
    networkState: media?.networkState ?? null,
    errorCode: media?.error?.code ?? null,
    errorMessage: media?.error?.message ?? null,
    currentSrc: media?.currentSrc || null,
    resourceTransferSize: resourceEntry?.transferSize ?? null,
    resourceEncodedBodySize: resourceEntry?.encodedBodySize ?? null,
    resourceDecodedBodySize: resourceEntry?.decodedBodySize ?? null,
  })
  const fallback = document.createElement('span')
  fallback.className = 'local-media-fallback'
  fallback.setAttribute('role', 'note')
  fallback.textContent = `${reason}：${label}。可尝试使用支持该格式的系统播放器打开原文件。`
  target.replaceWith(fallback)
}

/**
 * Markdown 渲染器
 */
export function VirtualizedMarkdown(props: VirtualizedMarkdownProps): JSX.Element {
  const identity = useRef<{ filePath?: string; operationId?: string; id: string } | null>(null)
  const operationId = props.diagnosticOperation?.context.operationId
  if (!identity.current || identity.current.filePath !== props.filePath || identity.current.operationId !== operationId) {
    identity.current = { filePath: props.filePath, operationId, id: `preview_${crypto.randomUUID()}` }
  }
  const diagnosticPreviewId = identity.current.id
  return (
    <LargeDocumentPreview content={props.content} filePath={props.filePath}
      diagnosticPreviewId={diagnosticPreviewId} diagnosticOperation={props.diagnosticOperation} diagnosticPanelKind={props.diagnosticPanelKind}>
      <MarkdownPreview {...props} diagnosticPreviewId={diagnosticPreviewId} />
    </LargeDocumentPreview>
  )
}

function MarkdownPreview({ content, isActive = true, className = '', filePath, tabId, leafId = null, renderDebounceMs = 300, scrollToLine, scrollToRatio, initialScrollRatio, onScrollToLineComplete, onScrollToRatioComplete, highlightKeyword, onHighlightKeywordComplete, onImageClick, previewEditingEnabled = false, onPreviewBlockEdit, onSourceEditRequest, onReadPositionChange, onMarkdownLinkClick, onAttachmentLinkClick, linkPositionRequest, remoteChartPolicy, diagnosticOperation, diagnosticPanelKind = 'main', diagnosticPreviewId }: VirtualizedMarkdownProps & { diagnosticPreviewId: string }): JSX.Element {
  const markdownRootRef = useRef<HTMLDivElement>(null)
  const localDocumentId = useId()
  const [contentReadyVersion, setContentReadyVersion] = useState(0)
  const onContentReady = useCallback(() => setContentReadyVersion(version => version + 1), [])
  const documentKey = useMemo(
    () => remoteChartDocumentKey(filePath, tabId) ?? `preview:${localDocumentId}`,
    [filePath, localDocumentId, tabId],
  )
  const hydration = useRemoteChartSettingsStore(state => state.hydration)
  const autoRenderRemoteCharts = useRemoteChartSettingsStore(state => state.autoRenderRemoteCharts)
  const documentApproved = useRemoteChartSettingsStore(state => Boolean(state.approvedDocuments[documentKey]))
  const hydrateRemoteChartSettings = useRemoteChartSettingsStore(state => state.hydrate)
  const approveRemoteChartDocument = useRemoteChartSettingsStore(state => state.approveDocument)
  const remoteChartCount = useMemo(() => countRemoteChartBlocks(content), [content])
  const effectiveRemoteChartPolicy: RemoteChartPolicy = remoteChartPolicy ?? (
    hydration === 'loading'
      ? 'prompt'
      : autoRenderRemoteCharts || documentApproved ? 'allow' : 'prompt'
  )
  const showRemoteChartPrompt = remoteChartPolicy === undefined
    && hydration !== 'loading'
    && effectiveRemoteChartPolicy === 'prompt'
    && remoteChartCount > 0

  useEffect(() => {
    if (remoteChartPolicy === undefined) void hydrateRemoteChartSettings()
  }, [hydrateRemoteChartSettings, remoteChartPolicy])
  const resolvePreviewContainer = useCallback(() => (
    markdownRootRef.current?.closest('.preview') as HTMLElement | null
  ), [])

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
      const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href')
      if (href) {
        const target = splitMarkdownTarget(href)
        if (classifyMarkdownTarget(href) === 'markdown') {
          linkHref = target.decodedPath
        }
      }
    }

    // 调用新的预览区域右键菜单（v1.3.7：合并书签功能和原有功能）
    window.api.showPreviewContextMenu({
      ...(useTabStore.getState().tabs.some(tab => tab.id === tabId && tab.linkedReadOnly) ? { readOnly: true } : {}),
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
      const lines = content.split('\n')
      const previewContainer = resolvePreviewContainer()
      const root = markdownRootRef.current
      if (!previewContainer || !root) return

      let target: HTMLElement | undefined
      let targetLine = 0
      for (const element of root.querySelectorAll<HTMLElement>('[data-source-line]')) {
        const line = Number(element.dataset.sourceLine)
        if (line > targetLine && line <= scrollToLine) {
          target = element
          targetLine = line
        }
      }
      let targetRect = target?.getBoundingClientRect()
      if (target && highlightKeyword) {
        const needle = highlightKeyword.toLowerCase()
        const beforeLine = lines.slice(targetLine - 1, scrollToLine - 1).join('\n').toLowerCase()
        let occurrence = 0
        for (let offset = beforeLine.indexOf(needle); offset >= 0; offset = beforeLine.indexOf(needle, offset + needle.length)) occurrence++
        const text = (target.textContent || '').toLowerCase()
        let from = text.indexOf(needle)
        for (let index = 0; index < occurrence && from >= 0; index++) from = text.indexOf(needle, from + needle.length)
        if (from >= 0) {
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
          const range = document.createRange()
          let offset = 0
          let started = false
          while (walker.nextNode()) {
            const node = walker.currentNode
            const end = offset + (node.textContent?.length ?? 0)
            if (!started && from < end) {
              range.setStart(node, from - offset)
              started = true
            }
            if (started && from + needle.length <= end) {
              range.setEnd(node, from + needle.length - offset)
              const rect = range.getBoundingClientRect()
              if (rect.height > 0) targetRect = rect
              break
            }
            offset = end
          }
        }
      }
      const targetScroll = targetRect
        ? previewContainer.scrollTop + targetRect.top - previewContainer.getBoundingClientRect().top
        : Math.max(0, scrollToLine - 1) / lines.length * previewContainer.scrollHeight
      previewContainer.scrollTo({ top: Math.max(0, targetScroll - 100), behavior: 'auto' })

      onScrollToLineComplete?.()
    }, 300)

    return () => clearTimeout(timer)
  }, [scrollToLine, content, highlightKeyword, onScrollToLineComplete, resolvePreviewContainer, contentReadyVersion])

  useEffect(() => {
    if (typeof scrollToRatio !== 'number' || !content) return

    const timer = setTimeout(() => {
      const previewContainer = resolvePreviewContainer()
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
  }, [scrollToRatio, content, onScrollToRatioComplete, resolvePreviewContainer, contentReadyVersion])

  // v1.5.1: 高亮清理 ref
  const highlightCleanupRef = useRef<(() => void) | null>(null)

  // v1.5.1: 搜索跳转后临时高亮关键词
  useEffect(() => {
    if (!highlightKeyword) return

    // 延迟执行，确保滚动完成后再高亮
    const highlightTimer = setTimeout(() => {
      const container = markdownRootRef.current
      if (!container) return

      const markInstance = new Mark(container)
      markInstance.mark(highlightKeyword, {
        className: 'search-temp-highlight',
        separateWordSearch: false,
        caseSensitive: false,
      })

      // 3 秒后自动清除高亮
      const fadeTimer = setTimeout(() => {
        markInstance.unmark({ className: 'search-temp-highlight' })
        onHighlightKeywordComplete?.()
      }, 3000)

      highlightCleanupRef.current = () => {
        clearTimeout(fadeTimer)
        markInstance.unmark({ className: 'search-temp-highlight' })
      }
    }, 500) // 等待滚动动画完成

    return () => {
      clearTimeout(highlightTimer)
      highlightCleanupRef.current?.()
      highlightCleanupRef.current = null
    }
  }, [highlightKeyword, onHighlightKeywordComplete, resolvePreviewContainer, contentReadyVersion])

  // 直接渲染
  return (
    <>
      {showRemoteChartPrompt && (
        <div className="remote-chart-document-consent no-export" role="note">
          <div>
            <strong>本篇包含 {remoteChartCount} 个联网图表</strong>
            <span>PlantUML、C4-PlantUML 或 Kroki 源码尚未发送。确认后将渲染本篇全部联网图表。</span>
          </div>
          <button type="button" onClick={() => approveRemoteChartDocument(documentKey)}>
            渲染本篇 {remoteChartCount} 个联网图表
          </button>
        </div>
      )}
      <NonVirtualizedMarkdown
        key={filePath ?? localDocumentId}
        content={content}
        md={md}
        className={className}
        filePath={filePath}
        tabId={tabId}
        leafId={leafId ?? SINGLE_NAVIGATION_LEAF}
        isActive={isActive}
        renderDebounceMs={renderDebounceMs}
        onContextMenu={handleContextMenu}
        onPreviewKeyDown={handleKeyDown}
        onImageClick={onImageClick}
        previewEditingEnabled={previewEditingEnabled}
        onPreviewBlockEdit={onPreviewBlockEdit}
        onSourceEditRequest={onSourceEditRequest}
        rootRef={markdownRootRef}
        onContentReady={onContentReady}
        onReadPositionChange={onReadPositionChange}
        initialScrollRatio={scrollToLine !== undefined || scrollToRatio !== undefined || linkPositionRequest ? undefined : initialScrollRatio}
        onMarkdownLinkClick={onMarkdownLinkClick}
        onAttachmentLinkClick={onAttachmentLinkClick}
        linkPositionRequest={linkPositionRequest}
        remoteChartPolicy={effectiveRemoteChartPolicy}
        diagnosticOperation={diagnosticOperation}
        diagnosticPanelKind={diagnosticPanelKind}
        diagnosticPreviewId={diagnosticPreviewId}
      />
    </>
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
  tabId,
  leafId,
  isActive,
  renderDebounceMs,
  onContextMenu,
  onPreviewKeyDown,
  onImageClick,
  previewEditingEnabled,
  onPreviewBlockEdit,
  onSourceEditRequest,
  rootRef,
  onContentReady,
  onReadPositionChange,
  initialScrollRatio,
  onMarkdownLinkClick,
  onAttachmentLinkClick,
  linkPositionRequest,
  remoteChartPolicy,
  diagnosticOperation,
  diagnosticPanelKind,
  diagnosticPreviewId,
}: {
  content: string
  md: MarkdownIt
  className: string
  filePath?: string
  tabId?: string
  leafId: string
  isActive: boolean
  renderDebounceMs: number
  onContextMenu?: (e: React.MouseEvent) => void
  onPreviewKeyDown?: (e: React.KeyboardEvent) => void
  onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
  previewEditingEnabled: boolean
  onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
  onSourceEditRequest?: (target: SourceEditRequest) => void
  rootRef?: React.RefObject<HTMLDivElement | null>
  onContentReady: () => void
  initialScrollRatio?: number
  onReadPositionChange?: (position: { scrollRatio: number; headingId?: string }) => void
  onMarkdownLinkClick?: (href: string, currentFilePath: string, context?: PreviewLinkContext) => void | Promise<void>
  onAttachmentLinkClick?: (href: string, currentFilePath: string, context: PreviewLinkContext) => void
  linkPositionRequest?: LinkPositionRequest
  remoteChartPolicy?: RemoteChartPolicy
  diagnosticOperation?: RendererFileDiagnosticOperation
  diagnosticPanelKind: 'main' | 'split' | 'editor'
  diagnosticPreviewId: string
}) {
  const internalContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = rootRef ?? internalContainerRef

  // v1.4.3: 防抖状态 - 延迟渲染以提升性能
  const [debouncedContent, setDebouncedContent] = useState(content)
  const [renderVersion, setRenderVersion] = useState(0)
  const contentObservedRef = useRef({ value: content, at: performance.now() })
  const renderDiagnosticsRef = useRef<MarkdownRenderDiagnostics>({
    debounceDelayMs: 0,
    markdownRenderMs: 0,
    sanitizeMs: 0,
  })
  if (contentObservedRef.current.value !== content) {
    contentObservedRef.current = { value: content, at: performance.now() }
  }

  const rendered = useMarkdownRender(md, debouncedContent)
  const renderPending = rendered?.source !== debouncedContent

  useEffect(() => {
    if (!renderPending && debouncedContent.length >= 100_000) onContentReady()
  }, [renderPending, rendered, debouncedContent, onContentReady])

  // v1.4.3: 防抖更新内容，快速编辑草稿预览可传入更短延迟
  useEffect(() => {
    const debouncedUpdate = debounce(() => {
      renderDiagnosticsRef.current.debounceDelayMs = performance.now() - contentObservedRef.current.at
      setDebouncedContent(content)
    }, renderDebounceMs)

    debouncedUpdate()

    return () => {
      debouncedUpdate.cancel()
    }
  }, [content, renderDebounceMs])

  useEffect(() => {
    if (content === debouncedContent && !renderPending) setRenderVersion(version => version + 1)
  }, [content, debouncedContent, renderPending])

  useEffect(() => {
    if (!filePath || !window.api?.onExportChartsZipFromPreview || !window.api?.exportChartsZip) return

    return window.api.onExportChartsZipFromPreview(async (request) => {
      const root = containerRef.current
      const context = lastPreviewChartZipContext
      if (!root || !context || context.root !== root || context.filePath !== request.filePath) return
      if (request.tabId && context.tabId && request.tabId !== context.tabId) return
      if (request.leafId && context.leafId && request.leafId !== context.leafId) return
      if (useTabStore.getState().tabs.some(tab => tab.id === context.tabId && tab.linkedReadOnly)) {
        window.dispatchEvent(new CustomEvent('md-link-error', { detail: { error: '外部临时文档仅供只读查看，不能导出图表。' } }))
        return
      }

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

  useReadPosition({ rootRef: containerRef, filePath, initialScrollRatio, isActive, renderVersion,
    onChange: onReadPositionChange })

  // v1.4.0: 页面内搜索
  const search = useInPageSearch(containerRef, debouncedContent.length, rendered?.source ?? '')

  // v1.4.0: 监听 IPC 事件（从右键菜单触发页面内搜索）
  useEffect(() => {
    if (!isActive || !window.api.onOpenInPageSearch) return

    const unsubscribe = window.api.onOpenInPageSearch(() => {
      if (!document.querySelector('.local-attachment-dialog')) search.setVisible(true)
    })

    return unsubscribe
  }, [isActive, search.setVisible])

  // v1.4.0: 监听 Cmd+Shift+F 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive || e.isComposing || document.querySelector('.local-attachment-dialog')) return
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
  }, [isActive, search.isVisible, search.goNext, search.goPrev, search.setVisible])

  // v1.4.0: 关闭搜索框时清除高亮
  const handleSearchClose = useCallback(() => {
    search.clear()
    search.setVisible(false)
  }, [search.clear, search.setVisible])

  if (rendered) {
    renderDiagnosticsRef.current.markdownRenderMs = rendered.markdownRenderMs
    renderDiagnosticsRef.current.sanitizeMs = rendered.sanitizeMs
  }
  const html = rendered?.html

  if (html === undefined) return <div className="markdown-render-pending" role="status">正在渲染文档…</div>

  // 注意：Mermaid 渲染、标题 ID、锚点点击逻辑已移到 MarkdownContent 组件中

  return (
    <>
      {/* v1.4.0: 页面内搜索框 */}
      <InPageSearchBox
        visible={isActive && search.isVisible}
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
        tabId={tabId}
        leafId={leafId}
        sourceContent={rendered!.source}
        renderPending={renderPending}
        renderVersion={renderVersion}
        onContextMenu={onContextMenu}
        onKeyDown={onPreviewKeyDown}
        onImageClick={onImageClick}
        previewEditingEnabled={previewEditingEnabled}
        onPreviewBlockEdit={onPreviewBlockEdit}
        onSourceEditRequest={onSourceEditRequest}
        onMarkdownLinkClick={onMarkdownLinkClick}
        onAttachmentLinkClick={onAttachmentLinkClick}
        linkPositionRequest={linkPositionRequest}
        remoteChartPolicy={remoteChartPolicy}
        diagnosticOperation={diagnosticOperation}
        diagnosticPanelKind={diagnosticPanelKind}
        diagnosticPreviewId={diagnosticPreviewId}
        renderDiagnosticsRef={renderDiagnosticsRef}
      />
    </>
  )
})

function schedulePreviewDiagnostics(input: {
  root: HTMLElement
  operation?: RendererFileDiagnosticOperation
  isCurrent: () => boolean
  panelKind: 'main' | 'split' | 'editor'
  previewInstanceId: string
  sourceContent: string
  render: MarkdownRenderDiagnostics
  dom: MarkdownDomDiagnostics
}): () => void {
  const { root, operation } = input
  const scheduledAt = performance.now()
  let firstFrame = 0
  let secondFrame = 0
  let postTimer = 0
  let coreRecorded = false
  let postRecorded = false
  const observeVisibility = () => {
    if (!coreRecorded && document.visibilityState === 'hidden' && root.isConnected && input.isCurrent()) {
      recordPreviewState(input.previewInstanceId, 'awaiting-visibility', operation?.context, input.panelKind)
    }
  }
  document.addEventListener('visibilitychange', observeVisibility)
  observeVisibility()

  firstFrame = requestAnimationFrame(firstTimestamp => {
    secondFrame = requestAnimationFrame(secondTimestamp => {
      if (!root.isConnected) {
        if (operation) recordFileTerminal(operation, 'superseded')
        return
      }
      coreRecorded = true
      if (input.isCurrent()) recordPreviewState(input.previewInstanceId, 'preview-core-ready', operation?.context, input.panelKind)
      if (operation) {
        const coreReadyMs = performance.now() - operation.startedMonotonicMs
        const maxRafLagMs = Math.max(
          0,
          firstTimestamp - scheduledAt - 16.7,
          secondTimestamp - firstTimestamp - 16.7,
        )
        const counts = previewElementCounts(root)
        recordPreviewSummary(operation.context.operationId, {
          source: operation.context.source,
          panelKind: input.panelKind,
          previewInstanceId: input.previewInstanceId,
          debounceDelayMs: input.render.debounceDelayMs,
          markdownRenderMs: input.render.markdownRenderMs,
          sanitizeMs: input.render.sanitizeMs,
          domPopulateMs: input.dom.domPopulateMs,
          sourceMappingMs: input.dom.sourceMappingMs,
          editableAnnotationMs: input.dom.editableAnnotationMs,
          coreReadyMs,
          maxRafLagMs,
          lineCountBucket: diagnosticLineCountBucket(input.sourceContent),
          ...counts,
          ...longTaskSummary(operation.startedMonotonicMs),
        })
        recordFileTerminal(operation, 'success', {
          panelKind: input.panelKind,
          previewInstanceId: input.previewInstanceId,
          coreReadyMs,
          maxRafLagMs,
        })
      }

      postTimer = window.setTimeout(() => {
        if (!root.isConnected) return
        postRecorded = true
        if (input.isCurrent()) recordPreviewState(input.previewInstanceId, 'preview-ready', operation?.context, input.panelKind)
        if (!operation) return
        recordPostRenderSnapshot(operation.context.operationId, {
          source: operation.context.source,
          panelKind: input.panelKind,
          previewInstanceId: input.previewInstanceId,
          postRenderMs: performance.now() - operation.startedMonotonicMs,
          ...previewElementCounts(root),
          ...longTaskSummary(operation.startedMonotonicMs),
        }, 'observed')
      }, 5000)
    })
  })

  return () => {
    document.removeEventListener('visibilitychange', observeVisibility)
    if (firstFrame) cancelAnimationFrame(firstFrame)
    if (secondFrame) cancelAnimationFrame(secondFrame)
    if (postTimer) window.clearTimeout(postTimer)
    if (!operation) return
    if (!coreRecorded) {
      recordFileTerminal(operation, 'superseded')
    } else if (!postRecorded) {
      recordPostRenderSnapshot(operation.context.operationId, {
        source: operation.context.source,
        panelKind: input.panelKind,
        previewInstanceId: input.previewInstanceId,
        postRenderMs: performance.now() - operation.startedMonotonicMs,
        ...previewElementCounts(root),
        ...longTaskSummary(operation.startedMonotonicMs),
      }, 'superseded')
    }
  }
}

function previewElementCounts(root: HTMLElement) {
  const renderedChartCount = countExportableCharts(root)
  const chartCount = root.querySelectorAll('pre[data-preview-read-only-reason="chart-code"]').length
    + renderedChartCount
  return {
    domNodeCount: root.querySelectorAll('*').length,
    codeBlockCount: root.querySelectorAll('pre').length,
    tableCount: root.querySelectorAll('table').length,
    chartCount,
    pendingChartCount: Math.max(0, chartCount - renderedChartCount),
    renderedChartCount,
    failedChartCount: root.querySelectorAll('[data-chart-error], .chart-error, .mermaid-error').length,
    imageCount: root.querySelectorAll('img').length,
    mediaCount: root.querySelectorAll('video, audio').length,
    documentVisible: document.visibilityState === 'visible',
  }
}

function diagnosticLineCountBucket(content: string): string {
  const lineCount = content ? content.split('\n').length : 0
  if (lineCount <= 100) return '0-100'
  if (lineCount <= 500) return '101-500'
  if (lineCount <= 2000) return '501-2000'
  if (lineCount <= 10000) return '2001-10000'
  return '10000+'
}

/**
 * Markdown 内容渲染组件
 * 独立出来避免父组件状态变化导致 innerHTML 被重置
 */
const MarkdownContent = memo(
  forwardRef<HTMLDivElement, {
    html: string
    className: string
    filePath?: string
    tabId?: string
    leafId: string
    sourceContent: string
    renderPending: boolean
    renderVersion: number
    onContextMenu?: (e: React.MouseEvent) => void
    onKeyDown?: (e: React.KeyboardEvent) => void
    onImageClick?: (data: { src: string; alt: string; images: string[]; currentIndex: number }) => void
    previewEditingEnabled: boolean
    onPreviewBlockEdit?: (edit: PreviewBlockEdit) => void
    onSourceEditRequest?: (target: SourceEditRequest) => void
    onMarkdownLinkClick?: (href: string, currentFilePath: string, context?: PreviewLinkContext) => void | Promise<void>
  onAttachmentLinkClick?: (href: string, currentFilePath: string, context: PreviewLinkContext) => void
  linkPositionRequest?: LinkPositionRequest
    remoteChartPolicy?: RemoteChartPolicy
    diagnosticOperation?: RendererFileDiagnosticOperation
    diagnosticPanelKind: 'main' | 'split' | 'editor'
    diagnosticPreviewId: string
    renderDiagnosticsRef: React.RefObject<MarkdownRenderDiagnostics>
  }>(function MarkdownContent({ html, className, filePath, tabId, leafId, sourceContent, renderPending, renderVersion, onContextMenu, onKeyDown, onImageClick, previewEditingEnabled, onPreviewBlockEdit, onSourceEditRequest, onMarkdownLinkClick, onAttachmentLinkClick, linkPositionRequest, remoteChartPolicy = 'prompt', diagnosticOperation, diagnosticPanelKind, diagnosticPreviewId, renderDiagnosticsRef }, ref) {
    const internalRef = useRef<HTMLDivElement>(null)
    const combinedRef = (ref as React.RefObject<HTMLDivElement>) || internalRef
    const revision = useMemo(() => previewRevision(sourceContent), [sourceContent])
    const committedPreviewRef = useRef({ filePath, tabId, leafId, revision, sourceContent })
    const committedBlocksRef = useRef(new Map<string, HTMLElement>())
    const restoredRequestRef = useRef<string | null>(null)
    const domDiagnosticsRef = useRef<MarkdownDomDiagnostics>({
      domPopulateMs: 0,
      sourceMappingMs: 0,
      editableAnnotationMs: 0,
    })
    const skippedFocusedRenderRef = useRef(false)
    const allowDeferredRenderBlockRef = useRef<HTMLElement | null>(null)
    const previewInputCommitTimerRef = useRef<number | null>(null)
    const pendingPreviewEditRef = useRef<{ block: HTMLElement; edit: PreviewBlockEdit } | null>(null)
    const [deferredRenderVersion, setDeferredRenderVersion] = useState(0)
    const chartRenderKey = useMemo(
      () => `${deferredRenderVersion}:${html}:${sourceContent}`,
      [deferredRenderVersion, html, sourceContent]
    )

    const hasPreviewBlockEdit = Boolean(onPreviewBlockEdit)
    const hasSourceEditRequest = Boolean(onSourceEditRequest)
    const diagnosticContextRef = useRef({ diagnosticOperation, diagnosticPanelKind, diagnosticPreviewId })
    useEffect(() => {
      diagnosticContextRef.current = { diagnosticOperation, diagnosticPanelKind, diagnosticPreviewId }
    }, [diagnosticOperation, diagnosticPanelKind, diagnosticPreviewId])

    // 标注只依赖编辑能力是否存在；回调身份变化不能重建正文并丢失滚动。
    useEffect(() => {
      if (combinedRef.current && !renderPending) {
        const domStarted = performance.now()
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
          combinedRef.current.dataset.renderPending = 'true'
          return
        }

        allowDeferredRenderBlockRef.current = null
        const contentRoot = document.createElement('div')
        contentRoot.innerHTML = html
        ensureHeadingIds(contentRoot)
        annotateLinkOccurrences(contentRoot)
        const domPopulateMs = performance.now() - domStarted
        const sourceMappingStarted = performance.now()
        const sourceLines = sourceContent.split('\n')
        const normalizedSourceLines = sourceLines.map(normalizeForMatch)
        const fencedCodeRanges = findFencedCodeRanges(sourceLines)
        const elements = contentRoot.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,blockquote,table,li')
        let searchFrom = 0
        elements.forEach((element) => {
          const text = (element.textContent || '').trim()
          if (!text) return
          const firstLine = text.split('\n').find(line => line.trim().length > 0)?.trim()
          if (!firstLine) return
          const normalizedFirstLine = normalizeForMatch(firstLine).slice(0, 40)
          if (!normalizedFirstLine) return
          let foundIndex = -1
          for (let index = searchFrom; index < sourceLines.length; index += 1) {
            if (normalizedSourceLines[index].includes(normalizedFirstLine)) {
              foundIndex = index
              break
            }
          }
          if (foundIndex >= 0) {
            ;(element as HTMLElement).dataset.sourceLine = String(foundIndex + 1)
            searchFrom = foundIndex
          }
        })

        let tableSearchFrom = 0
        const renderedRows = contentRoot.querySelectorAll('tr')
        const sourceTableRows = renderedRows.length > 0
          ? sourceLines.map(line => parseMarkdownTableRow(line)?.map(normalizeForMatch) ?? null)
          : []
        renderedRows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll<HTMLElement>('th,td'))
          if (cells.length === 0) return
          const renderedCells = cells.map(cell => normalizeForMatch(cell.textContent || ''))
          let foundIndex = -1
          for (let index = tableSearchFrom; index < sourceLines.length; index += 1) {
            const markdownCells = sourceTableRows[index]
            if (!markdownCells || markdownCells.length < renderedCells.length) continue
            if (renderedCells.every((cell, cellIndex) => markdownCells[cellIndex] === cell)) {
              foundIndex = index
              break
            }
          }
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
        contentRoot.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
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

        const sourceMappingMs = performance.now() - sourceMappingStarted
        const editableStarted = performance.now()
        contentRoot.querySelectorAll('.markdown-preview-source-only-hint').forEach(hint => hint.remove())

        const editableElements = contentRoot.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,td,th,pre')
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
          if (!previewEditingEnabled || !sourceLine || !hasPreviewBlockEdit || isReadOnlyPreviewBlock) {
            editableElement.removeAttribute('contenteditable')
            editableElement.removeAttribute('spellcheck')
            editableElement.classList.remove('markdown-preview-editable-block')
            delete editableElement.dataset.previewOriginalText
            if (previewEditingEnabled && sourceLine && isReadOnlyPreviewBlock && hasSourceEditRequest) {
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
        // 编辑属性在离线 DOM 上准备好，再一次挂入正文，避免逐块更新活动编辑宿主。
        const fragment = document.createDocumentFragment()
        while (contentRoot.firstChild) fragment.appendChild(contentRoot.firstChild)
        cleanupLocalMedia(combinedRef.current)
        combinedRef.current.replaceChildren(fragment)
        delete combinedRef.current.dataset.renderPending
        committedPreviewRef.current = { filePath, tabId, leafId, revision, sourceContent }
        committedBlocksRef.current = new Map(Array.from(combinedRef.current.querySelectorAll<HTMLElement>('[id]'))
          .filter(element => element.id.startsWith(BLOCK_ANCHOR_PREFIX))
          .map(element => [element.id.slice(BLOCK_ANCHOR_PREFIX.length), element]))
        normalizeLocalImageSources(combinedRef.current, filePath)
        hydrateLocalMedia(combinedRef.current, filePath)
        domDiagnosticsRef.current = {
          domPopulateMs,
          sourceMappingMs,
          editableAnnotationMs: performance.now() - editableStarted,
        }
        const diagnostic = diagnosticContextRef.current
        recordPreviewState(diagnostic.diagnosticPreviewId, 'dom-committed', diagnostic.diagnosticOperation?.context, diagnostic.diagnosticPanelKind)
      }
    }, [deferredRenderVersion, filePath, tabId, leafId, revision, html, hasPreviewBlockEdit, hasSourceEditRequest, previewEditingEnabled, sourceContent, renderPending])

    useEffect(() => {
      const root = combinedRef.current
      if (!root || renderPending || root.dataset.renderPending) return
      return schedulePreviewDiagnostics({
        root,
        operation: diagnosticOperation,
        isCurrent: () => committedPreviewRef.current.sourceContent === sourceContent && committedPreviewRef.current.filePath === filePath,
        panelKind: diagnosticPanelKind,
        previewInstanceId: diagnosticPreviewId,
        sourceContent,
        render: renderDiagnosticsRef.current,
        dom: domDiagnosticsRef.current,
      })
    }, [combinedRef, diagnosticOperation, diagnosticPanelKind, diagnosticPreviewId, deferredRenderVersion, filePath, html, renderDiagnosticsRef, sourceContent, renderPending])

    useEffect(() => {
      const root = combinedRef.current
      return () => {
        if (root) cleanupLocalMedia(root)
      }
    }, [combinedRef])

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
    usePlantUMLChart(combinedRef, chartRenderKey, true, undefined, remoteChartPolicy)
    useExcalidrawChart(combinedRef, chartRenderKey, { markdownFilePath: filePath })
    useVegaLiteChart(combinedRef, chartRenderKey)
    useD2Chart(combinedRef, chartRenderKey)
    useBpmnChart(combinedRef, chartRenderKey, { markdownFilePath: filePath })
    useWaveDromChart(combinedRef, chartRenderKey)
    useStructurizrChart(combinedRef, chartRenderKey)
    usePlotlyChart(combinedRef, chartRenderKey)
    useDbmlChart(combinedRef, chartRenderKey)
    useAntvG6Chart(combinedRef, chartRenderKey)
    useRestrictedSvgChart(combinedRef, chartRenderKey)
    useKrokiChart(combinedRef, chartRenderKey, true, remoteChartPolicy)

    useEffect(() => {
      const root = combinedRef.current
      const request = linkPositionRequest
      if (!root || !request?.block || !request.isCurrent() || restoredRequestRef.current === request.id) return
      const block = request.block
      let disposed = false
      let positioned = false
      const timers: number[] = []
      const finish = (status: Parameters<LinkPositionRequest['onComplete']>[0]) => {
        if (disposed) return
        disposed = true
        restoredRequestRef.current = request.id
        request.onComplete(status)
      }
      const cancel = () => finish('cancelled')
      const key = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel()
      }
      const scroller = (root.closest('.preview') ?? root.parentElement ?? root) as HTMLElement
      scroller.addEventListener('wheel', cancel, { passive: true })
      scroller.addEventListener('touchstart', cancel, { passive: true })
      scroller.addEventListener('pointerdown', cancel)
      scroller.addEventListener('keydown', key)
      const attempt = () => {
        if (disposed) return
        if (!root.isConnected || !request.isCurrent()) { finish('cancelled'); return }
        if (performance.now() > block.deadline) { finish('unavailable'); return }
        const preview = committedPreviewRef.current
        if (preview.filePath !== request.filePath || preview.sourceContent !== block.source) {
          timers.push(window.setTimeout(attempt, 50))
          return
        }
        const target = committedBlocksRef.current.get(block.id)
        if (!target || !locateMarkdownBlock(root, target)) { finish('unavailable'); return }
        if (!positioned && request.canFocus()) {
          target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true })
        }
        if (!positioned) {
          positioned = true
          timers.push(window.setTimeout(attempt, 150), window.setTimeout(() => {
            attempt()
            if (!disposed && committedPreviewRef.current.sourceContent === block.source) finish('positioned')
          }, 500))
        }
      }
      attempt()
      return () => {
        disposed = true
        timers.forEach(timer => window.clearTimeout(timer))
        scroller.removeEventListener('wheel', cancel)
        scroller.removeEventListener('touchstart', cancel)
        scroller.removeEventListener('pointerdown', cancel)
        scroller.removeEventListener('keydown', key)
      }
    }, [linkPositionRequest, html, sourceContent, deferredRenderVersion])

    useEffect(() => {
      const root = combinedRef.current
      const request = linkPositionRequest
      if (request?.block) return
      if (!root || !request || request.filePath !== committedPreviewRef.current.filePath ||
        !request.isCurrent() || restoredRequestRef.current === request.id) return
      restoredRequestRef.current = request.id
      let stopped = false
      const timers: number[] = []
      const stop = () => { stopped = true; request.onComplete() }
      const stopForKey = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop()
      }
      const scroller = (root.closest('.preview') ?? root.parentElement ?? root) as HTMLElement
      scroller.addEventListener('wheel', stop, { passive: true })
      scroller.addEventListener('touchstart', stop, { passive: true })
      scroller.addEventListener('pointerdown', stop)
      scroller.addEventListener('keydown', stopForKey)
      const started = performance.now()
      void committedPreviewRef.current.revision.then(hash => {
        for (const delay of [0, 150, 500]) timers.push(window.setTimeout(() => {
          if (stopped || !root.isConnected || !request.isCurrent() || performance.now() - started > 1000) {
            if (delay === 500) request.onComplete()
            return
          }
          const target = locateLinkView(root, request.position, hash)
          if (delay === 0 && request.canFocus()) {
            if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }) }
            else root.focus({ preventScroll: true })
          }
          if (delay === 500) request.onComplete()
        }, delay))
      })
      return () => {
        stopped = true
        timers.forEach(timer => window.clearTimeout(timer))
        scroller.removeEventListener('wheel', stop)
        scroller.removeEventListener('touchstart', stop)
        scroller.removeEventListener('pointerdown', stop)
        scroller.removeEventListener('keydown', stopForKey)
        request.onComplete()
      }
    }, [linkPositionRequest, html, sourceContent])

    // 处理锚点链接点击
    useEffect(() => {
      if (!combinedRef.current) return

      const navigateBlock = (id: string) => {
        const root = combinedRef.current
        if (!root || committedPreviewRef.current.filePath !== filePath) return
        const status = inspectMarkdownBlock(committedPreviewRef.current.sourceContent, id)
        const target = committedBlocksRef.current.get(id)
        if (status === 'found' && target && locateMarkdownBlock(root, target)) return
        window.dispatchEvent(new CustomEvent('md-link-error', { detail: {
          error: status === 'ambiguous' ? `块 ID ^${id} 重复，无法确定位置。` : `未找到块 ^${id}（当前显示内容）。`,
        } }))
      }
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

        const preview = committedPreviewRef.current
        const context: PreviewLinkContext | undefined = preview.filePath && preview.filePath === filePath && combinedRef.current ? {
          ...preview, filePath: preview.filePath, position: captureLinkView(combinedRef.current, anchor), anchor,
        } : undefined
        const wikiMarker = anchor.getAttribute(WIKI_LINK_MARKER_ATTRIBUTE)
        if (wikiMarker) {
          e.preventDefault()
          const wiki = decodeLocalResourceMarker<ParsedWikiReference>(wikiMarker)
          if (!wiki || !filePath) return
          if (!wiki.path && wiki.fragmentKind === 'block' && wiki.fragment) {
            navigateBlock(wiki.fragment.slice(1))
            return
          }
          if (!wiki.path && wiki.fragmentKind === 'heading' && wiki.fragment) {
            const targetElement = findInPageAnchorTarget(combinedRef.current, `#${wiki.fragment}`)
            targetElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
          }
          if ((wiki.resourceKind === 'markdown' || (!wiki.isEmbed && isBareWikiDocumentName(wiki.path))) && onMarkdownLinkClick) {
            void onMarkdownLinkClick(`wiki:${encodeURIComponent(wiki.rawTarget)}`, filePath,
              context ? { ...context, wikiEmbed: wiki.isEmbed } : undefined)
            return
          }
          const extension = wiki.path.match(/\.[^./\\]+$/)?.[0].toLowerCase() ?? ''
          if (!wiki.isEmbed && wiki.path && context && onAttachmentLinkClick &&
            (LOCAL_ATTACHMENT_TEXT_EXTENSIONS.has(extension) || wiki.resourceKind === 'attachment')) {
            onAttachmentLinkClick(`wiki:${encodeURIComponent(wiki.rawTarget)}`, filePath, context)
            return
          }
          if (wiki.path && window.api.revealLocalResource) {
            void window.api.revealLocalResource(filePath, wiki.path, 'workspace-wiki').catch((error) => {
              window.dispatchEvent(new CustomEvent('md-link-error', {
                detail: { error: error instanceof Error ? error.message : '无法定位本地资源' }
              }))
            })
            return
          }
          window.dispatchEvent(new CustomEvent('md-link-error', {
            detail: { error: '该嵌入以安全资源卡显示，当前不在预览中展开' }
          }))
          return
        }

        const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href')
        if (!href) return

        // 1. 锚点链接：页内跳转
        if (href.startsWith('#')) {
          e.preventDefault()
          let fragment: string
          try { fragment = decodeURIComponent(href.slice(1)) } catch { return }
          if (fragment.startsWith('^') || fragment.startsWith(BLOCK_ANCHOR_PREFIX)) {
            navigateBlock(fragment.startsWith('^') ? fragment.slice(1) : fragment.slice(BLOCK_ANCHOR_PREFIX.length))
            return
          }
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

        // 3. v1.5.1: 本地 Markdown 链接：优先交给上层统一导航，兼容旧调用路径
        const markdownTarget = splitMarkdownTarget(href)
        if (classifyMarkdownTarget(href) === 'markdown') {
          e.preventDefault()
          if (filePath) {
            if (onMarkdownLinkClick) {
              void onMarkdownLinkClick(href, filePath, context)
              return
            }
            window.api.openMdLink(filePath, markdownTarget.decodedPath).then((result) => {
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

        // 本地附件交给受限查看器；始终禁止BrowserWindow默认导航。
        e.preventDefault()
        if (filePath && context && onAttachmentLinkClick) onAttachmentLinkClick(href, filePath, context)
        else window.dispatchEvent(new CustomEvent('md-link-error', { detail: { error: '此附件链接暂不支持查看' } }))
      }

      combinedRef.current.addEventListener('click', handleClick)
      return () => combinedRef.current?.removeEventListener('click', handleClick)
    }, [html, filePath, onImageClick, previewEditingEnabled, onMarkdownLinkClick, onAttachmentLinkClick])

    // v1.5.2: 为普通代码块添加复制按钮
    useEffect(() => {
      if (!combinedRef.current) return

      // 查找所有 pre > code 代码块，排除 Mermaid 和 ECharts（它们有自己的复制按钮）
      const codeBlocks = combinedRef.current.querySelectorAll('pre:not(.language-mermaid):not(.language-echarts):not(.language-markmap):not(.language-graphviz):not(.language-drawio):not(.language-plantuml):not(.language-excalidraw):not(.language-vega-lite):not(.language-d2):not(.language-bpmn):not(.language-wavedrom):not(.language-structurizr):not(.language-plotly):not(.language-dbml):not(.language-antv-g6):not(.language-svg):not(.language-kroki)')

      codeBlocks.forEach((pre) => {
        // 跳过已经有复制按钮的代码块
        if (pre.querySelector('.copy-btn')) return
        // 跳过图表代码视图中的代码块（已有复制按钮）
        if (pre.closest('.echarts-code-view') || pre.closest('.infographic-code-view') || pre.closest('.markmap-code-view') || pre.closest('.graphviz-code-view') || pre.closest('.vega-lite-code-view') || pre.closest('.d2-code-view') || pre.closest('.bpmn-code-view') || pre.closest('.wavedrom-code-view') || pre.closest('.structurizr-code-view') || pre.closest('.plotly-code-view') || pre.closest('.dbml-code-view') || pre.closest('.antv-g6-code-view') || pre.closest('.svg-code-view') || pre.closest('.kroki-code-view') || pre.closest('.drawio-code-view') || pre.closest('.mermaid-code-view') || pre.closest('.plantuml-code-view') || pre.closest('.excalidraw-code-view')) return

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
        } else if (target.closest('.svg-code-view')) {
          textToCopy = decodeChartCode(target.closest('.svg-wrapper'), 'data-svg-code')
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
        data-render-pending={renderPending ? 'true' : undefined}
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
    prevProps.renderPending === nextProps.renderPending &&
    prevProps.previewEditingEnabled === nextProps.previewEditingEnabled &&
    prevProps.onImageClick === nextProps.onImageClick &&
    prevProps.onPreviewBlockEdit === nextProps.onPreviewBlockEdit &&
    prevProps.onSourceEditRequest === nextProps.onSourceEditRequest &&
    prevProps.onMarkdownLinkClick === nextProps.onMarkdownLinkClick &&
    prevProps.onAttachmentLinkClick === nextProps.onAttachmentLinkClick &&
    prevProps.linkPositionRequest === nextProps.linkPositionRequest &&
    prevProps.tabId === nextProps.tabId && prevProps.leafId === nextProps.leafId &&
    prevProps.remoteChartPolicy === nextProps.remoteChartPolicy
)

export default memo(VirtualizedMarkdown)
