import { beforeAll, describe, expect, it, vi } from 'vitest'
import { processEChartsInHtml, renderEChartsToSvg } from '../../src/utils/echartsRenderer'

describe('renderEChartsToSvg export layout', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return Number.parseFloat((this as HTMLElement).style.width) || 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return Number.parseFloat((this as HTMLElement).style.height) || 0
      },
    })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      measureText: (text: string) => ({ width: text.length * 8 }),
    })) as unknown as HTMLCanvasElement['getContext']
  })

  it('uses a wide export canvas so pie labels do not collide before scaling', async () => {
    const svg = await renderEChartsToSvg(`{
      "title": { "text": "存储容量分布（按 StorageClass）", "left": "center" },
      "tooltip": { "trigger": "item", "formatter": "{b}: {c} Gi ({d}%)" },
      "legend": { "orient": "vertical", "left": "left", "top": "middle" },
      "series": [{
        "name": "存储容量",
        "type": "pie",
        "radius": ["35%", "65%"],
        "center": ["55%", "50%"],
        "itemStyle": { "borderRadius": 8, "borderColor": "#fff", "borderWidth": 2 },
        "label": { "formatter": "{b}\\n{c} Gi" },
        "data": [
          { "value": 248, "name": "EVS 普通IO" },
          { "value": 370, "name": "EVS ESSD" },
          { "value": 205, "name": "EVS SAS拓扑" },
          { "value": 1520, "name": "SFS NAS (废弃)", "itemStyle": { "opacity": 0.4 } },
          { "value": 2, "name": "OBS 对象存储" },
          { "value": 1, "name": "SFS 文件共享" },
          { "value": 500, "name": "SFS Turbo" }
        ]
      }]
    }`, 'export-layout-test')

    const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    expect(viewBox).not.toBeNull()
    expect(Number(viewBox![1])).toBeGreaterThanOrEqual(900)
    expect(Number(viewBox![2])).toBeGreaterThanOrEqual(560)
  })

  it('处理超过 20 个 ECharts 代码块时不应残留源码', async () => {
    const blocks = Array.from({ length: 27 }, (_, index) => [
      '<pre class="language-echarts"><code class="language-echarts">',
      `{ "title": { "text": "Chart ${index}" }, "series": [{ "type": "gauge", "data": [{ "value": ${index}, "name": "覆盖率" }] }] }`,
      '</code></pre>',
    ].join('')).join('\n')

    const result = await processEChartsInHtml(blocks)

    expect((result.match(/echarts-container/g) || [])).toHaveLength(27)
    expect(result).not.toContain('language-echarts')
    expect(result).not.toContain('<pre')
    expect(result).not.toContain('"type": "gauge"')
  })
})
