export const SYNC_THROTTLE_MS = 100
export const SYNC_IGNORE_MS = 140
export const COMPOSITION_RESUME_DELAY_MS = 250
export const MIN_SCROLL_DELTA_RATIO = 0.025
export const MIN_SCROLL_DELTA_PX = 16
export const MAX_ANCHORS = 3000
export const MAX_LINES_FOR_ANCHOR_SYNC = 10000
export const DEFAULT_TOP_RATIO = 0.372

export type ScrollAnchorKind = 'stable' | 'approximate'
export type ScrollMapMode = 'precise' | 'approximate' | 'ratio'

export interface ScrollAnchor {
  sourceLine: number
  offsetTop: number
  height: number
  element: HTMLElement
  kind: ScrollAnchorKind
}

export interface ScrollMap {
  lineToTop: number[]
  anchorLines: number[]
  totalLines: number
  scrollHeight: number
  mode: ScrollMapMode
}

const stableAnchorTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'BLOCKQUOTE'])
const approximateAnchorTags = new Set(['DIV', 'UL', 'OL', 'FIGURE', 'IMG'])

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getSourceLine(element: Element): number | null {
  const value = element.getAttribute('data-source-line')
  if (!value) return null
  const line = Number(value)
  return Number.isFinite(line) && line > 0 ? Math.floor(line) : null
}

function getAnchorKind(element: HTMLElement): ScrollAnchorKind | null {
  if (stableAnchorTags.has(element.tagName)) return 'stable'
  if (approximateAnchorTags.has(element.tagName)) return 'approximate'
  return null
}

function getOffsetTopWithin(element: HTMLElement, container: HTMLElement): number {
  let current: HTMLElement | null = element
  let top = 0
  while (current && current !== container) {
    top += current.offsetTop || 0
    current = current.offsetParent as HTMLElement | null
  }
  if (current === container) return top
  return element.offsetTop || 0
}

export function collectPreviewAnchors(previewElement: HTMLElement): ScrollAnchor[] {
  const seen = new Set<number>()
  const anchors: ScrollAnchor[] = []
  const elements = Array.from(previewElement.querySelectorAll<HTMLElement>('[data-source-line]'))

  for (const element of elements) {
    const sourceLine = getSourceLine(element)
    if (!sourceLine || seen.has(sourceLine)) continue

    const kind = getAnchorKind(element)
    if (!kind) continue

    seen.add(sourceLine)
    anchors.push({
      sourceLine,
      offsetTop: Math.round(getOffsetTopWithin(element, previewElement)),
      height: element.offsetHeight || 0,
      element,
      kind,
    })
  }

  return anchors.sort((a, b) => a.sourceLine - b.sourceLine)
}

export function buildScrollMap({
  totalLines,
  scrollHeight,
  anchors,
}: {
  totalLines: number
  scrollHeight: number
  anchors: ScrollAnchor[]
}): ScrollMap {
  const safeTotalLines = Math.max(1, Math.floor(totalLines))
  const safeScrollHeight = Math.max(0, Math.round(scrollHeight))
  const lineToTop = Array(safeTotalLines + 1).fill(-1)
  const usableAnchors = anchors
    .filter(anchor => anchor.sourceLine >= 1 && anchor.sourceLine <= safeTotalLines)
    .sort((a, b) => a.sourceLine - b.sourceLine)
    .slice(0, MAX_ANCHORS)
  const hasApproximateAnchor = usableAnchors.some(anchor => anchor.kind === 'approximate')
  const knownLines = new Set<number>()

  lineToTop[1] = 0
  knownLines.add(1)

  for (const anchor of usableAnchors) {
    if (knownLines.has(anchor.sourceLine)) continue
    lineToTop[anchor.sourceLine] = Math.max(0, Math.round(anchor.offsetTop))
    knownLines.add(anchor.sourceLine)
  }

  if (!knownLines.has(safeTotalLines)) {
    lineToTop[safeTotalLines] = safeScrollHeight
    knownLines.add(safeTotalLines)
  }

  const anchorLines = Array.from(knownLines).sort((a, b) => a - b)
  for (let index = 0; index < anchorLines.length - 1; index++) {
    const previousLine = anchorLines[index]
    const nextLine = anchorLines[index + 1]
    const previousTop = lineToTop[previousLine]
    const nextTop = lineToTop[nextLine]

    for (let line = previousLine + 1; line < nextLine; line++) {
      lineToTop[line] = Math.round(
        (nextTop * (line - previousLine) + previousTop * (nextLine - line)) /
        Math.max(1, nextLine - previousLine)
      )
    }
  }

  if (usableAnchors.length === 0) {
    for (let line = 1; line <= safeTotalLines; line++) {
      lineToTop[line] = Math.round(((line - 1) / Math.max(1, safeTotalLines - 1)) * safeScrollHeight)
    }
  }

  return {
    lineToTop,
    anchorLines: usableAnchors.map(anchor => anchor.sourceLine),
    totalLines: safeTotalLines,
    scrollHeight: safeScrollHeight,
    mode: usableAnchors.length === 0 ? 'ratio' : hasApproximateAnchor ? 'approximate' : 'precise',
  }
}

export function findNearestLineByTop(lineToTop: number[], targetTop: number): number {
  const lastLine = lineToTop.length - 1
  if (lastLine <= 1) return 1
  if (targetTop <= lineToTop[1]) return 1
  if (targetTop >= lineToTop[lastLine]) return lastLine

  let low = 1
  let high = lastLine
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const middleTop = lineToTop[middle]
    if (middleTop === targetTop) return middle
    if (middleTop < targetTop) low = middle + 1
    else high = middle - 1
  }

  const before = clamp(high, 1, lastLine)
  const after = clamp(low, 1, lastLine)
  return Math.abs(lineToTop[before] - targetTop) <= Math.abs(lineToTop[after] - targetTop)
    ? before
    : after
}

export function findNearestAnchor(anchors: ScrollAnchor[], sourceLine: number): ScrollAnchor | null {
  if (anchors.length === 0) return null
  return anchors.reduce((nearest, anchor) =>
    Math.abs(anchor.sourceLine - sourceLine) < Math.abs(nearest.sourceLine - sourceLine)
      ? anchor
      : nearest
  )
}

export function getMinimumScrollDelta(clientHeight: number): number {
  return Math.max(MIN_SCROLL_DELTA_PX, Math.round(clientHeight * MIN_SCROLL_DELTA_RATIO))
}

export function shouldSkipSmallScroll(currentTop: number, targetTop: number, clientHeight: number): boolean {
  return Math.abs(targetTop - currentTop) < getMinimumScrollDelta(clientHeight)
}

export function clampScrollTop(targetTop: number, scrollHeight: number, clientHeight: number): number {
  return clamp(Math.round(targetTop), 0, Math.max(0, scrollHeight - clientHeight))
}

export function getScrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
  return clamp(scrollTop / maxScrollTop, 0, 1)
}
