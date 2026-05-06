import { expect, test } from '@playwright/test'
import fs from 'fs'
import http from 'http'
import path from 'path'

async function serveOutRenderer(): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve('out/renderer')
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname)
    const filePath = path.join(root, requestPath === '/' ? 'server-render.html' : requestPath)

    if (!filePath.startsWith(root)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const ext = path.extname(filePath)
      const contentType = ext === '.js'
        ? 'text/javascript'
        : ext === '.css'
          ? 'text/css'
          : ext === '.html'
            ? 'text/html'
            : ext === '.wasm'
              ? 'application/wasm'
            : 'application/octet-stream'

      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start static server')

  return {
    url: `http://127.0.0.1:${address.port}/server-render.html`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

test('server render page produces Mermaid result', async ({ page }) => {
  const server = await serveOutRenderer()

  await page.addInitScript(() => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: '# 图表\n\n```mermaid\ngraph TD\nA --> B\n```',
      enabledRenderers: ['mermaid'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  })

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 15000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'mermaid')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page produces KaTeX result', async ({ page }) => {
  const server = await serveOutRenderer()

  await page.addInitScript(() => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: '# 公式\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n\n行内公式 $E=mc^2$',
      enabledRenderers: ['katex'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  })

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 15000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.filter((image: { type: string }) => image.type === 'katex')).toHaveLength(2)
  } finally {
    await server.close()
  }
})

test('server render page produces Excalidraw result from bundle resource', async ({ page }) => {
  const server = await serveOutRenderer()
  const excalidraw = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'md-viewer',
    elements: [
      {
        id: 'rect1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 220,
        height: 100,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: '#a5d8ff',
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
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  })

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: '# 画图\n\n![架构](../diagrams/a.excalidraw)',
      markdownFilePath: 'docs/readme.md',
      resources: [
        {
          path: 'diagrams/a.excalidraw',
          kind: 'text',
          content: source,
          mediaType: 'application/json',
          size: source.length,
        },
      ],
      enabledRenderers: ['excalidraw'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  }, excalidraw)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 15000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'excalidraw')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page produces DrawIO result', async ({ page }) => {
  const server = await serveOutRenderer()
  const drawio = '<mxGraphModel dx="600" dy="400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="400" pageHeight="240" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="60" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="B" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="240" y="60" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" value="" style="endArrow=block;html=1;rounded=0;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>'

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: `# DrawIO\n\n\`\`\`drawio\n${source}\n\`\`\``,
      enabledRenderers: ['drawio'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  }, drawio)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 20000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'drawio')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page produces ECharts result', async ({ page }) => {
  const server = await serveOutRenderer()
  const echartsConfig = `{
    title: { text: '季度收入' },
    tooltip: {},
    xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [120, 200, 150, 260] }]
  }`

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: `# ECharts\n\n\`\`\`echarts\n${source}\n\`\`\``,
      enabledRenderers: ['echarts'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  }, echartsConfig)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 20000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'echarts')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page treats ECharts validation errors as failed blocks', async ({ page }) => {
  const server = await serveOutRenderer()

  await page.addInitScript(() => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: '# ECharts 错误\n\n```echarts\ninvalid json\n```\n\n```echarts\n{\"series\":[{\"type\":\"bar\",\"data\":[1,2]}]}\n```',
      enabledRenderers: ['echarts'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  })

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 20000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toBe('partial')
    expect(result?.stats.totalBlocks).toBe(2)
    expect(result?.stats.renderedBlocks).toBe(1)
    expect(result?.stats.failedBlocks).toBe(1)
    expect(result?.images.filter((image: { type: string }) => image.type === 'echarts')).toHaveLength(1)
  } finally {
    await server.close()
  }
})

test('server render page produces Markmap result', async ({ page }) => {
  const server = await serveOutRenderer()
  const markmap = `# 产品路线图
## 采集
### Markdown
### Bundle
## 渲染
### Mermaid
### ECharts
### Markmap
## 导出
### DOCX`

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: `# Markmap\n\n\`\`\`markmap\n${source}\n\`\`\``,
      enabledRenderers: ['markmap'],
      networkPolicy: 'blocked',
      timeoutMs: 15000,
    }
  }, markmap)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 20000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'markmap')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page produces Graphviz result', async ({ page }) => {
  const server = await serveOutRenderer()
  const graphviz = `digraph G {
    rankdir=LR;
    A [label="输入"];
    B [label="处理"];
    C [label="输出"];
    A -> B -> C;
  }`

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: `# Graphviz\n\n\`\`\`graphviz\n${source}\n\`\`\``,
      enabledRenderers: ['graphviz'],
      networkPolicy: 'blocked',
      timeoutMs: 20000,
    }
  }, graphviz)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 25000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'graphviz')).toBe(true)
  } finally {
    await server.close()
  }
})

test('server render page produces Infographic result', async ({ page }) => {
  const server = await serveOutRenderer()
  const infographic = `infographic list-row-simple-horizontal-arrow
data
  title 产品开发流程
  items
    - label 需求分析
      desc 明确目标和范围
    - label 方案设计
      desc 输出结构和交互
    - label 开发实现
      desc 完成功能闭环`

  await page.addInitScript((source) => {
    window.__MDV_RENDER_INPUT__ = {
      schemaVersion: '1.0',
      markdown: `# Infographic\n\n\`\`\`infographic\n${source}\n\`\`\``,
      enabledRenderers: ['infographic'],
      networkPolicy: 'blocked',
      timeoutMs: 20000,
    }
  }, infographic)

  try {
    await page.goto(server.url)
    await expect.poll(() => page.evaluate(() => window.__MDV_RENDER_DONE__ === true), {
      timeout: 25000,
    }).toBe(true)

    const result = await page.evaluate(() => window.__MDV_RENDER_RESULT__)
    expect(result?.status).toMatch(/success|partial/)
    expect(result?.images.some((image: { type: string }) => image.type === 'infographic')).toBe(true)
  } finally {
    await server.close()
  }
})
