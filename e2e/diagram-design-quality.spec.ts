import { createContentSecurityPolicy } from '../src/main/securityPolicy'
import { expect, test } from './fixtures/electron'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixturePath = join(__dirname, 'fixtures/test-diagram-design.md')

const rendererDom = {
  d2: { wrapperClass: 'd2-wrapper', containerClass: 'd2-container' },
  graphviz: { wrapperClass: 'graphviz-wrapper', containerClass: 'graphviz-container' },
  mermaid: { wrapperClass: 'mermaid-wrapper', containerClass: 'mermaid-container' },
  structurizr: { wrapperClass: 'structurizr-wrapper', containerClass: 'structurizr-container' },
  dbml: { wrapperClass: 'dbml-wrapper', containerClass: 'dbml-container' },
  'antv-g6': { wrapperClass: 'antv-g6-wrapper', containerClass: 'antv-g6-container' },
  drawio: { wrapperClass: 'drawio-wrapper', containerClass: 'drawio-container' },
  svg: { wrapperClass: 'svg-wrapper', containerClass: 'svg-container' },
  markmap: { wrapperClass: 'markmap-wrapper', containerClass: 'markmap-container' },
} as const

type RendererLanguage = keyof typeof rendererDom

interface RendererCase {
  id: string
  language: RendererLanguage
}

interface ShowcaseExpectation {
  labels: string[]
  minWidth: number
  minHeight: number
}

const showcases: Partial<Record<string, ShowcaseExpectation>> = {
  'd2-architecture-zoned-flow': {
    labels: ['知识工作者', '图表渲染器', 'DOCX 服务'],
    minWidth: 520,
    minHeight: 180,
  },
  'graphviz-dependency-ranks-cycle': {
    labels: ['Markdown Source', 'Preview SVG', 'Release Gate'],
    minWidth: 520,
    minHeight: 180,
  },
  'mermaid-sequence-alt-refresh': {
    labels: ['MD Viewer', '文档服务', '身份服务'],
    minWidth: 520,
    minHeight: 260,
  },
  'structurizr-c4-context': {
    labels: ['全渠道零售平台', '支付服务商', '遗留订单系统'],
    minWidth: 520,
    minHeight: 180,
  },
  'dbml-db-schema-row-fk': {
    labels: ['tenants', 'documents', 'export_jobs'],
    minWidth: 520,
    minHeight: 240,
  },
  'antv-g6-microservice-runtime-topology': {
    labels: ['API Gateway', 'Checkout', 'Telemetry'],
    minWidth: 520,
    minHeight: 180,
  },
  'drawio-overall-layered-architecture': {
    labels: ['通用智能平台总体技术分层', '智能服务层', '安全与运维'],
    minWidth: 700,
    minHeight: 360,
  },
  'svg-editorial-platform-architecture': {
    labels: ['受控 AI 平台', 'PDP · 策略决策', '隔离沙箱'],
    minWidth: 700,
    minHeight: 420,
  },
  'svg-architecture-tradeoff-decision-canvas': {
    labels: ['架构权衡决策画布', '候选方案逐项比较', '选择 C · 有条件采纳'],
    minWidth: 700,
    minHeight: 420,
  },
  'svg-incident-recovery-multi-plane-storyboard': {
    labels: ['事故恢复多平面故事板', '数据平面', 'G2 · SLO + 观察签字'],
    minWidth: 700,
    minHeight: 440,
  },
  'svg-event-storming-domain-flow': {
    labels: ['领域事件风暴 · 订单履约', '订单已接受', '热点：部分预留'],
    minWidth: 700,
    minHeight: 420,
  },
  'svg-service-blueprint-export-journey': {
    labels: ['异步文档导出 · 服务蓝图', '用户可见线', 'artifactHash · bytes'],
    minWidth: 700,
    minHeight: 440,
  },
  'svg-migration-portfolio-wave-map': {
    labels: ['迁移组合分波地图', 'W0 · 先隔离', '核心可逆切片'],
    minWidth: 700,
    minHeight: 420,
  },
  'svg-team-topology-interaction-map': {
    labels: ['Team Topologies · 交互地图', '内部交付平台团队', 'Facilitating · 有退出日期'],
    minWidth: 700,
    minHeight: 420,
  },
  'svg-capacity-budget-saturation-corridor': {
    labels: ['容量预算与饱和走廊', '900 = 800 + 100', 'ρDB = 0.80'],
    minWidth: 700,
    minHeight: 440,
  },
  'svg-failure-propagation-blast-radius-overlay': {
    labels: ['故障传播与爆炸半径叠层', '共同原因分叉', 'B = {Browse}'],
    minWidth: 700,
    minHeight: 460,
  },
  'svg-state-data-migration-visibility-overlay': {
    labels: ['状态—数据—迁移水位可见性叠层', '旧 epoch 写入拒绝', 'C_final → stop reverse CDC'],
    minWidth: 700,
    minHeight: 480,
  },
  'markmap-system-decomposition': {
    labels: ['Electron 主进程', 'React 渲染进程', '质量保障'],
    minWidth: 520,
    minHeight: 260,
  },
}

const layoutBounds: Partial<Record<string, { minRatio: number; maxRatio: number }>> = {
  'd2-layered-system': { minRatio: 0.65, maxRatio: 3 },
  'd2-observability': { minRatio: 0.65, maxRatio: 3 },
  'd2-ai-rag-pipeline': { minRatio: 0.65, maxRatio: 3 },
  'graphviz-compiler-pipeline': { minRatio: 0.55, maxRatio: 2.5 },
  'graphviz-release-gates': { minRatio: 0.55, maxRatio: 2.5 },
  'mermaid-cicd-progressive-delivery': { minRatio: 0.5, maxRatio: 2.5 },
  'mermaid-file-authorization-boundary': { minRatio: 0.5, maxRatio: 2.5 },
  'mermaid-circuit-breaker-fallback': { minRatio: 0.8, maxRatio: 3 },
}

function readRendererCases(): RendererCase[] {
  const markdown = readFileSync(fixturePath, 'utf-8')
  return [...markdown.matchAll(/<div\s+id="md-case-([^"]+)"\s*><\/div>\s*```([a-z0-9-]+)\b/gi)]
    .map(match => {
      const language = match[2].toLowerCase()
      if (!(language in rendererDom)) throw new Error(`Unsupported diagram reference language: ${language}`)
      return { id: match[1], language: language as RendererLanguage }
    })
}

function rendererCase(page: Page, caseId: string) {
  return page.locator(`#md-case-${caseId}`).locator('xpath=following-sibling::*[1]')
}

test('AI 架构图参考库的全部正例应真实渲染并保持受控布局', async ({ page, electronApp }, testInfo) => {
  test.setTimeout(600000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1280, height: 900 })
  })

  const cases = readRendererCases()
  expect(cases).toHaveLength(93)
  expect(new Set(cases.map(item => item.id)).size).toBe(cases.length)

  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fixturePath)
  await page.waitForSelector('.markdown-body', { timeout: 10000 })

  for (const item of cases) {
    const marker = page.locator(`#md-case-${item.id}`)
    await expect(marker, `${item.id} marker`).toHaveCount(1)

    const config = rendererDom[item.language]
    const wrapper = rendererCase(page, item.id)
    await expect(wrapper, `${item.id} wrapper`).toHaveClass(new RegExp(`\\b${config.wrapperClass}\\b`), { timeout: 240000 })
    await expect(wrapper.locator(`.${config.containerClass} svg`).first(), `${item.id} SVG`).toBeVisible({ timeout: 240000 })
    await wrapper.scrollIntoViewIfNeeded()

    const metrics = await wrapper.evaluate((element, containerClass) => {
      const wrapperEl = element as HTMLElement
      const container = wrapperEl.querySelector(`.${containerClass}`) as HTMLElement | null
      const svg = container?.querySelector('svg') as SVGSVGElement | null
      const svgBox = svg?.getBoundingClientRect()
      const viewBox = svg?.viewBox.baseVal
      return {
        width: svgBox?.width ?? 0,
        height: svgBox?.height ?? 0,
        ratio: svgBox?.height ? svgBox.width / svgBox.height : 0,
        viewBoxWidth: viewBox?.width ?? 0,
        viewBoxHeight: viewBox?.height ?? 0,
        wrapperOverflow: wrapperEl.scrollWidth - wrapperEl.clientWidth,
        containerOverflow: container ? container.scrollWidth - container.clientWidth : 0,
        forbidden: svg?.querySelectorAll('script, iframe, object, embed').length ?? 0,
        text: (wrapperEl.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }
    }, config.containerClass)

    expect(Number.isFinite(metrics.width), `${item.id} SVG 宽度应有限`).toBe(true)
    expect(Number.isFinite(metrics.height), `${item.id} SVG 高度应有限`).toBe(true)
    expect(metrics.width, `${item.id} SVG 应具有可见宽度`).toBeGreaterThan(80)
    expect(metrics.height, `${item.id} SVG 应具有可见高度`).toBeGreaterThan(40)
    if (item.language !== 'markmap' && item.language !== 'drawio') {
      expect(metrics.viewBoxWidth, `${item.id} viewBox 宽度`).toBeGreaterThan(0)
      expect(metrics.viewBoxHeight, `${item.id} viewBox 高度`).toBeGreaterThan(0)
    }
    expect(
      metrics.wrapperOverflow > 2 && metrics.containerOverflow > 2,
      `${item.id} 不应产生 wrapper/container 双重横向滚动`,
    ).toBe(false)
    expect(metrics.forbidden, `${item.id} SVG 不应含危险嵌入元素`).toBe(0)

    const bounds = layoutBounds[item.id]
    if (bounds) {
      expect(metrics.ratio, `${item.id} 宽高比下限`).toBeGreaterThan(bounds.minRatio)
      expect(metrics.ratio, `${item.id} 宽高比上限`).toBeLessThan(bounds.maxRatio)
    }

    const showcase = showcases[item.id]
    if (showcase) {
      expect(metrics.width, `${item.id} showcase 宽度`).toBeGreaterThan(showcase.minWidth)
      expect(metrics.height, `${item.id} showcase 高度`).toBeGreaterThan(showcase.minHeight)
      expect(metrics.ratio, `${item.id} showcase 宽高比下限`).toBeGreaterThan(0.2)
      expect(metrics.ratio, `${item.id} showcase 宽高比上限`).toBeLessThan(12)
      for (const label of showcase.labels) {
        expect(metrics.text, `${item.id} 应保留关键标签 ${label}`).toContain(label)
      }
      await testInfo.attach(`${item.id}.png`, {
        body: await wrapper.screenshot(),
        contentType: 'image/png',
      })
    }
  }

  for (const language of Object.keys(rendererDom) as RendererLanguage[]) {
    await expect(page.locator(`.${language}-error`), `${language} 不应出现渲染错误`).toHaveCount(0)
  }

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow, '参考库不应撑宽整个页面').toBeLessThanOrEqual(2)
})

test('打包环境使用的生产 CSP 应允许 D2 Blob Worker', async ({ page, electronApp }) => {
  test.setTimeout(180000)
  const policy = createContentSecurityPolicy(false)
  const cspWorkerErrors: string[] = []
  page.on('console', message => {
    const text = message.text()
    if (/worker|content security policy/i.test(text)) cspWorkerErrors.push(text)
  })

  await electronApp.evaluate(({ BrowserWindow }, productionPolicy) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('Electron window not found')
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [productionPolicy],
        },
      })
    })
    win.webContents.reload()
  }, policy)

  await page.waitForSelector('body', { timeout: 30000 })
  await page.waitForFunction(() => typeof window.api?.testOpenMarkdownFile === 'function', undefined, { timeout: 30000 })
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fixturePath)

  const wrapper = rendererCase(page, 'd2-architecture-zoned-flow')
  await expect(wrapper).toHaveClass(/\bd2-wrapper\b/, { timeout: 120000 })
  await expect(wrapper.locator('.d2-container > svg').first()).toBeVisible({ timeout: 120000 })
  expect(cspWorkerErrors.filter(message => /violates|blocked|encountered an error/i.test(message))).toEqual([])
})
