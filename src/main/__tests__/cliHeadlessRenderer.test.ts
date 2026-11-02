import { describe, expect, it } from 'vitest'
import {
  applyPreferredCaptureSize,
  calculateCaptureScale,
  constrainCaptureBounds,
  normalizeElementCaptureBounds,
  renderMarkdownFallback,
} from '../cli/headlessRenderer'

describe('headlessRenderer fallback safety', () => {
  it('escapes raw HTML instead of emitting active markup', () => {
    const result = renderMarkdownFallback({
      schemaVersion: '1.0',
      markdown: '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>',
    })

    expect(result.html).toContain('&lt;img src=x onerror=')
    expect(result.html).toContain('alert(1)')
    expect(result.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(result.html).not.toContain('<script>')
    expect(result.html).not.toContain('<img')
  })
})

describe('headlessRenderer screenshot bounds', () => {
  it('calculates a proportional scale for oversized capture targets', () => {
    expect(calculateCaptureScale({
      width: 2624,
      height: 18496,
    })).toBeCloseTo(12000 / 18496, 4)
  })

  it('accounts for device pixel ratio when calculating capture scale', () => {
    expect(calculateCaptureScale({
      width: 2624,
      height: 18496,
    }, 2)).toBeCloseTo(6000 / 18496, 4)
  })

  it('caps oversized capture bounds below Chromium texture limits', () => {
    expect(constrainCaptureBounds({
      x: 10,
      y: 20,
      width: 2624,
      height: 18496,
    })).toEqual({
      x: 10,
      y: 20,
      width: 2624,
      height: 12000,
    })
  })

  it('caps capture bounds in CSS pixels for retina displays', () => {
    expect(constrainCaptureBounds({
      x: 10,
      y: 20,
      width: 2624,
      height: 18496,
    }, 6000)).toEqual({
      x: 10,
      y: 20,
      width: 2624,
      height: 6000,
    })
  })

  it('keeps capture bounds at least one pixel', () => {
    expect(constrainCaptureBounds({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('prefers scaled client rect dimensions over unscaled scroll dimensions', () => {
    expect(normalizeElementCaptureBounds({
      left: 0,
      top: 0,
      width: 1702,
      height: 12000,
      scrollWidth: 2574,
      scrollHeight: 18484,
      paddingX: 0,
      paddingY: 0,
    })).toEqual({
      x: 0,
      y: 0,
      width: 1702,
      height: 12000,
    })
  })

  it('uses renderer chart dimensions when DOM bounds are inflated', () => {
    expect(applyPreferredCaptureSize(
      {
        x: 0,
        y: 100,
        width: 2624,
        height: 18496,
      },
      {
        widthPx: 1246,
        heightPx: 601,
      },
    )).toEqual({
      x: 0,
      y: 100,
      width: 1294,
      height: 649,
    })
  })
})
