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
  renderedOnly?: boolean
}

const showcases: Partial<Record<string, ShowcaseExpectation>> = {
  'svg-task-queue-worker-capacity': {
    labels: ['等待队列 4 / 4', '并发占用 1 / 1', '调度器', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-upload-quarantine-processing': {
    labels: ['输入校验', '授权下载', '元数据存储', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'graphviz-plugin-required-optional-failure': {
    labels: ['PDF 引擎', '本地降级', '插件管理器', '架构主视图'],
    minWidth: 500,
    minHeight: 180,
    renderedOnly: true,
  },
  'graphviz-task-cancel-dependency-cleanup': {
    labels: ['退出已确认', '回收未完成', '任务协调器', '架构主视图'],
    minWidth: 500,
    minHeight: 180,
    renderedOnly: true,
  },
  'graphviz-search-index-publication-gates': {
    labels: ['原子发布 g12', '复核 revision', '查询服务', 'CURRENT', '架构主视图'],
    minWidth: 500,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-file-import-field-provenance': {
    labels: ['未知', 'L2', '辅助·数据来源'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-notification-preferences-delivery': {
    labels: ['邮件：已退订', '有限重试', '通知分发器', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-rolling-upgrade-connection-drain': {
    labels: ['已有连接继续', '才停止 v1', '负载入口', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-backup-restore-validation': {
    labels: ['禁止开放写入', '只读功能验证', '待恢复数据库', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'drawio-artifact-approved-blocked-paths': {
    labels: ['阻断：', '发布身份门禁', '制品存储', '部署代理', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-api-allow-deny-policy-traces': {
    labels: ['首次分歧', '未执行', '辅助·请求判定'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-file-service-residual-risk': {
    labels: ['最终剩余风险', '风险归零', '受保护文件存储', '架构主视图'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-file-sharing-permission-matrix': {
    labels: ['未定义', '管理员', '辅助·授权矩阵'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-request-latency-stage-breakdown': {
    labels: ['执行 220ms', '等待 180ms', '辅助·性能'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-service-monthly-cost-bridge': {
    labels: ['26000', '总量落到零基线', '辅助·成本'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'svg-upload-incident-cause-evidence': {
    labels: ['待证', '磁盘满', '辅助·复盘'],
    minWidth: 700,
    minHeight: 180,
    renderedOnly: true,
  },
  'graphviz-requirements-design-test-evidence-traceability': {
    labels: ['需求—设计—测试—证据', '签名', '发布基线'],
    minWidth: 520,
    minHeight: 180,
  },
  'drawio-hybrid-network-landing-zone': {
    labels: ['本地数据中心', 'Transit Hub', '生产 Spoke'],
    minWidth: 700,
    minHeight: 360,
  },
  'drawio-incident-command-escalation': {
    labels: ['信号与分级', '指挥与处置', '沟通与治理'],
    minWidth: 700,
    minHeight: 360,
  },
  'drawio-migration-cutover-command-center': {
    labels: ['切换前准备', '指挥中心', '执行与验收'],
    minWidth: 700,
    minHeight: 360,
  },
  'svg-solution-assumptions-evidence-ledger': {
    labels: ['方案范围、假设与证据账本', '验证证据 / 新鲜度', '状态'],
    minWidth: 700,
    minHeight: 400,
  },
  'svg-accessible-architecture-reading-order': {
    labels: ['可访问架构图 · 编号蛇形阅读路径', 'DOM 顺序', '读屏'],
    minWidth: 700,
    minHeight: 400,
  },
  'svg-identity-lifecycle-governance': {
    labels: ['身份生命周期 · 时间轴 / 状态门 / 撤销证据', '权威事件', '撤销'],
    minWidth: 700,
    minHeight: 400,
  },
  'svg-key-rotation-break-glass': {
    labels: ['密钥治理 · 正常轮换 vs Break-glass', '计划轮换轨', '共享证据链'],
    minWidth: 700,
    minHeight: 400,
  },
  'svg-tenant-isolation-invariants': {
    labels: ['租户隔离不变式 · 嵌套边界 / 控制探针 / 证据面板', '共享控制面', 'Tenant A · Cell 01'],
    minWidth: 700,
    minHeight: 400,
  },
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
  'graphviz-search-index-publication-gates': { minRatio: 1.2, maxRatio: 2.2 },
  'graphviz-task-cancel-dependency-cleanup': { minRatio: 1, maxRatio: 2 },
  'graphviz-plugin-required-optional-failure': { minRatio: 1.3, maxRatio: 2.4 },
  'd2-stateful-shard-rebalance': { minRatio: 0.65, maxRatio: 2.2 },
  'graphviz-critical-path-deadline-dag': { minRatio: 0.55, maxRatio: 2.2 },
  'graphviz-dependency-impact-cut-set': { minRatio: 0.45, maxRatio: 2.2 },
  'graphviz-stream-partition-rebalance': { minRatio: 0.55, maxRatio: 2.2 },
  'graphviz-requirements-design-test-evidence-traceability': { minRatio: 0.5, maxRatio: 2.2 },
  'graphviz-decommission-wave-dependency-dag': { minRatio: 0.55, maxRatio: 2.2 },
  'd2-layered-system': { minRatio: 0.45, maxRatio: 3 },
  'd2-observability': { minRatio: 0.5, maxRatio: 3 },
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

function selectRendererCases(cases: RendererCase[]): RendererCase[] {
  const requested = process.env.MD_VIEWER_DIAGRAM_CASES
  if (requested === undefined) return cases
  if (!requested.trim()) throw new Error('MD_VIEWER_DIAGRAM_CASES must list one or more case IDs')

  const requestedIds = requested.split(',').map(id => id.trim())
  if (requestedIds.some(id => !/^[-a-z0-9]+$/.test(id))) {
    throw new Error('MD_VIEWER_DIAGRAM_CASES contains an invalid case ID')
  }
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('MD_VIEWER_DIAGRAM_CASES contains duplicate case IDs')
  }

  const known = new Map(cases.map(item => [item.id, item]))
  return requestedIds.map(id => {
    const item = known.get(id)
    if (!item) throw new Error(`MD_VIEWER_DIAGRAM_CASES requests unknown case: ${id}`)
    return item
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

  const allCases = readRendererCases()
  expect(allCases).toHaveLength(129)
  expect(new Set(allCases.map(item => item.id)).size).toBe(allCases.length)
  const cases = selectRendererCases(allCases)

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
        svgText: (svg?.textContent ?? '').replace(/\s+/g, ' ').trim(),
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

    if (item.language === 'd2') {
      const viewBoxRatio = metrics.viewBoxWidth / metrics.viewBoxHeight
      expect(Math.abs(metrics.ratio - viewBoxRatio), `${item.id} 不应因高度限制发生比例失真`).toBeLessThan(0.05)
    }

    const bounds = layoutBounds[item.id]
    if (bounds) {
      expect(metrics.ratio, `${item.id} 宽高比下限`).toBeGreaterThan(bounds.minRatio)
      expect(metrics.ratio, `${item.id} 宽高比上限`).toBeLessThan(bounds.maxRatio)
    }

    if (item.id === 'svg-service-monthly-cost-bridge') {
      const geometry = await wrapper.locator(`.${config.containerClass} svg`).first().evaluate(root => {
        const scale = root.getBoundingClientRect().width / (root as SVGSVGElement).viewBox.baseVal.width
        return [20000, 6000, -2000, 3000, -1000, 26000].map((value, index) => {
          const rect = root.querySelector(`[id$="r6-cost-bar-${index}"]`)!
          const carry = root.querySelector(`[id$="r6-cost-carry-${index}"]`)
          return { value, height: rect.getBoundingClientRect().height / scale, carryY: carry ? Number(carry.getAttribute('y1')) : null }
        })
      })
      for (const [index, bar] of geometry.entries()) {
        expect(bar.height, '成本柱真实显示高度与金额比例').toBeCloseTo(Math.abs(bar.value) * 400 / 30000, 1)
        if (bar.carryY !== null) expect(bar.carryY).toBeCloseTo(560 - [20000, 26000, 24000, 27000, 26000][index] * 400 / 30000, 2)
      }
    }

    const showcase = showcases[item.id]
    if (showcase) {
      expect(metrics.width, `${item.id} showcase 宽度`).toBeGreaterThan(showcase.minWidth)
      expect(metrics.height, `${item.id} showcase 高度`).toBeGreaterThan(showcase.minHeight)
      expect(metrics.ratio, `${item.id} showcase 宽高比下限`).toBeGreaterThan(0.2)
      expect(metrics.ratio, `${item.id} showcase 宽高比上限`).toBeLessThan(12)
      for (const label of showcase.labels) {
        expect(showcase.renderedOnly ? metrics.svgText : metrics.text, `${item.id} 应保留关键标签 ${label}`).toContain(label)
      }
    }
    if (showcase || process.env.MD_VIEWER_DIAGRAM_CASES !== undefined) {
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

  const reloaded = page.waitForEvent('domcontentloaded')
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

  await reloaded
  await expect(page.locator('.app')).toBeVisible()
  await page.waitForSelector('body', { timeout: 30000 })
  await page.waitForFunction(() => typeof window.api?.testOpenMarkdownFile === 'function', undefined, { timeout: 30000 })
  await page.evaluate(path => window.api.testOpenMarkdownFile?.(path), fixturePath)

  const wrapper = rendererCase(page, 'd2-architecture-zoned-flow')
  await expect(wrapper).toHaveClass(/\bd2-wrapper\b/, { timeout: 120000 })
  await expect(wrapper.locator('.d2-container > svg').first()).toBeVisible({ timeout: 120000 })
  expect(cspWorkerErrors.filter(message => /violates|blocked|encountered an error/i.test(message))).toEqual([])
})
