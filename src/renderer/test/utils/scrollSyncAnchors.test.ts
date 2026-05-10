import { describe, expect, it } from 'vitest'
import {
  buildScrollMap,
  collectPreviewAnchors,
  findNearestAnchor,
  findNearestLineByTop,
  getMinimumScrollDelta,
  shouldSkipSmallScroll,
} from '../../src/utils/scrollSyncAnchors'

function setLayout(element: HTMLElement, offsetTop: number, height = 20): void {
  Object.defineProperty(element, 'offsetTop', { configurable: true, value: offsetTop })
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height })
}

describe('scrollSyncAnchors', () => {
  it('collects sorted source-line anchors from the current preview container only', () => {
    const preview = document.createElement('div')
    const outside = document.createElement('p')
    outside.dataset.sourceLine = '2'
    setLayout(outside, 999)
    document.body.appendChild(outside)

    const second = document.createElement('p')
    second.dataset.sourceLine = '5'
    setLayout(second, 120)
    const first = document.createElement('h1')
    first.dataset.sourceLine = '1'
    setLayout(first, 10)
    const invalid = document.createElement('p')
    invalid.dataset.sourceLine = 'not-a-line'
    setLayout(invalid, 40)

    preview.append(second, invalid, first)

    expect(collectPreviewAnchors(preview).map(anchor => ({
      sourceLine: anchor.sourceLine,
      offsetTop: anchor.offsetTop,
      kind: anchor.kind,
    }))).toEqual([
      { sourceLine: 1, offsetTop: 10, kind: 'stable' },
      { sourceLine: 5, offsetTop: 120, kind: 'stable' },
    ])
  })

  it('builds a scrollMap that interpolates missing source lines between anchors', () => {
    const map = buildScrollMap({
      totalLines: 5,
      scrollHeight: 500,
      anchors: [
        { sourceLine: 1, offsetTop: 0, height: 20, kind: 'stable', element: document.createElement('h1') },
        { sourceLine: 5, offsetTop: 400, height: 20, kind: 'stable', element: document.createElement('p') },
      ],
    })

    expect(map.mode).toBe('precise')
    expect(map.lineToTop.slice(1, 6)).toEqual([0, 100, 200, 300, 400])
    expect(map.anchorLines).toEqual([1, 5])
  })

  it('marks the scrollMap approximate when it uses approximate anchors', () => {
    const map = buildScrollMap({
      totalLines: 4,
      scrollHeight: 400,
      anchors: [
        { sourceLine: 1, offsetTop: 0, height: 20, kind: 'stable', element: document.createElement('h1') },
        { sourceLine: 3, offsetTop: 250, height: 80, kind: 'approximate', element: document.createElement('div') },
      ],
    })

    expect(map.mode).toBe('approximate')
  })

  it('falls back to ratio positions when there are no usable anchors', () => {
    const map = buildScrollMap({ totalLines: 4, scrollHeight: 400, anchors: [] })

    expect(map.mode).toBe('ratio')
    expect(map.lineToTop.slice(1, 5)).toEqual([0, 133, 267, 400])
  })

  it('finds the nearest source line for a preview viewport position by binary search', () => {
    const line = findNearestLineByTop([-1, 0, 100, 200, 300, 400], 260)

    expect(line).toBe(4)
  })

  it('finds the nearest anchor when scrollMap is unavailable', () => {
    const anchors = [
      { sourceLine: 2, offsetTop: 40, height: 20, kind: 'stable' as const, element: document.createElement('p') },
      { sourceLine: 8, offsetTop: 240, height: 20, kind: 'stable' as const, element: document.createElement('p') },
    ]

    expect(findNearestAnchor(anchors, 7)?.sourceLine).toBe(8)
  })

  it('uses a relative minimum scroll delta with a pixel floor', () => {
    expect(getMinimumScrollDelta(1000)).toBe(25)
    expect(getMinimumScrollDelta(200)).toBe(16)
    expect(shouldSkipSmallScroll(100, 110, 200)).toBe(true)
    expect(shouldSkipSmallScroll(100, 140, 200)).toBe(false)
  })
})
