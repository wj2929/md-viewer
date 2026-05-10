import { test, expect } from './fixtures/electron'

test.describe('SVG 转 PNG 导出截图', () => {
  test('不应把临时渲染窗口的滚动条截入 PNG', async ({ page }) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="1200" viewBox="0 0 240 1200">
        <rect width="240" height="1200" fill="#ffffff"/>
        <rect x="24" y="24" width="192" height="1152" fill="#f6f8fa" stroke="#0969da" stroke-width="2"/>
        <text x="120" y="80" text-anchor="middle" font-size="24" fill="#24292f">DrawIO-like tall diagram</text>
      </svg>
    `

    const result = await page.evaluate(async svg => window.api.renderSvgToPng(svg, 240), svg)

    expect(result.success, result.error).toBe(true)
    expect(result.data).toBeTruthy()

    const edgeStats = await page.evaluate(async base64 => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()

      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建 Canvas 2D 上下文')

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const strip = 14
      const margin = 24

      const isNotWhite = (x: number, y: number): boolean => {
        const i = (y * canvas.width + x) * 4
        return imageData[i + 3] > 0 && (
          imageData[i] < 248 ||
          imageData[i + 1] < 248 ||
          imageData[i + 2] < 248
        )
      }

      let rightNonWhite = 0
      let rightTotal = 0
      for (let x = canvas.width - strip; x < canvas.width; x += 1) {
        for (let y = margin; y < canvas.height - margin; y += 1) {
          rightTotal += 1
          if (isNotWhite(x, y)) rightNonWhite += 1
        }
      }

      let bottomNonWhite = 0
      let bottomTotal = 0
      for (let y = canvas.height - strip; y < canvas.height; y += 1) {
        for (let x = margin; x < canvas.width - margin; x += 1) {
          bottomTotal += 1
          if (isNotWhite(x, y)) bottomNonWhite += 1
        }
      }

      return {
        width: canvas.width,
        height: canvas.height,
        rightNonWhiteRatio: rightNonWhite / rightTotal,
        bottomNonWhiteRatio: bottomNonWhite / bottomTotal,
      }
    }, result.data!)

    expect(edgeStats.width).toBeGreaterThanOrEqual(240)
    expect(edgeStats.height).toBeGreaterThan(1000)
    expect(edgeStats.rightNonWhiteRatio, '右侧边缘不应出现滚动条轨道或滑块').toBeLessThan(0.01)
    expect(edgeStats.bottomNonWhiteRatio, '底部边缘不应出现滚动条轨道或滑块').toBeLessThan(0.01)
  })
})
