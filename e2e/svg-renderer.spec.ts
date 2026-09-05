import { expect, test } from './fixtures/electron'

const safeSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360">',
  '  <rect width="800" height="360" rx="24" fill="#e8f1ff" />',
  '  <text x="48" y="190" font-size="36" fill="#172033">SVG → PNG</text>',
  '</svg>',
].join('')

test('render:svgToPng uses the hidden sandboxed renderer within image budgets', async ({ page, electronApp }) => {
  void electronApp
  const result = await page.evaluate(async ({ svg }) => {
    return window.api.renderSvgToPng(svg, 5000)
  }, { svg: safeSvg })

  expect(result.success, result.error).toBe(true)
  expect(result.data?.length).toBeGreaterThan(1000)
  expect(result.width).toBeGreaterThan(0)
  expect(result.height).toBeGreaterThan(0)
  expect(result.width).toBeLessThanOrEqual(4096)
  expect(result.height).toBeLessThanOrEqual(4096)
  expect((result.width || 0) * (result.height || 0)).toBeLessThanOrEqual(8_000_000)
})

test('render:svgToPng rejects malformed and oversized IPC payloads', async ({ page, electronApp }) => {
  void electronApp
  const [notSvg, oversized] = await page.evaluate(async () => {
    return Promise.all([
      window.api.renderSvgToPng('<div>not svg</div>', 800),
      window.api.renderSvgToPng(`<svg viewBox="0 0 10 10"><desc>${'x'.repeat(2 * 1024 * 1024)}</desc></svg>`, 800),
    ])
  })

  expect(notSvg).toMatchObject({ success: false, error: 'Invalid SVG payload' })
  expect(oversized).toMatchObject({ success: false, error: 'Invalid SVG payload' })
})
