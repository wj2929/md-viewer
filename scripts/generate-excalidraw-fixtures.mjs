import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const fixtureDir = join(repoRoot, 'e2e/fixtures')
const excalidrawDir = join(fixtureDir, 'excalidraw')

mkdirSync(excalidrawDir, { recursive: true })

let seed = 1000

function base(id, type, x, y, width, height, overrides = {}) {
  seed += 1
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  }
}

function rect(id, x, y, width, height, label, options = {}) {
  const {
    fill = '#e8f4ff',
    stroke = '#1e1e1e',
    groupIds = [],
    strokeStyle = 'solid',
    strokeWidth = 2,
    opacity = 100,
    roughness = 1,
    round = true,
    link = null,
    frameId = null,
    locked = false,
    deleted = false,
    fontSize = 20,
  } = options
  const shape = base(id, 'rectangle', x, y, width, height, {
    strokeColor: stroke,
    backgroundColor: fill,
    strokeStyle,
    strokeWidth,
    opacity,
    roughness,
    groupIds,
    frameId,
    roundness: round ? { type: 3 } : null,
    link,
    locked,
    isDeleted: deleted,
  })
  return label ? [shape, text(`${id}-label`, x + 14, y + height / 2 - fontSize * 0.65, label, {
    width: width - 28,
    fontSize,
    align: 'center',
    groupIds,
    frameId,
    deleted,
  })] : [shape]
}

function diamond(id, x, y, width, height, label, options = {}) {
  const shape = base(id, 'diamond', x, y, width, height, {
    strokeColor: options.stroke ?? '#1e1e1e',
    backgroundColor: options.fill ?? '#fff2cc',
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
  return [shape, text(`${id}-label`, x + width * 0.18, y + height / 2 - 13, label, {
    width: width * 0.64,
    fontSize: options.fontSize ?? 18,
    align: 'center',
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })]
}

function ellipse(id, x, y, width, height, label, options = {}) {
  const shape = base(id, 'ellipse', x, y, width, height, {
    strokeColor: options.stroke ?? '#1e1e1e',
    backgroundColor: options.fill ?? '#f3f0ff',
    strokeStyle: options.strokeStyle ?? 'solid',
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
  return [shape, text(`${id}-label`, x + width * 0.16, y + height / 2 - 13, label, {
    width: width * 0.68,
    fontSize: options.fontSize ?? 18,
    align: 'center',
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })]
}

function text(id, x, y, value, options = {}) {
  const fontSize = options.fontSize ?? 20
  const width = options.width ?? Math.max(80, Math.max(...String(value).split('\n').map(line => line.length)) * fontSize * 0.62)
  const lines = String(value).split('\n').length
  const element = base(id, 'text', x, y, width, lines * fontSize * 1.25, {
    strokeColor: options.color ?? '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    fontSize,
    fontFamily: options.fontFamily ?? 5,
    text: value,
    originalText: value,
    textAlign: options.align ?? 'left',
    verticalAlign: options.verticalAlign ?? 'middle',
    containerId: options.containerId ?? null,
    lineHeight: 1.25,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
    isDeleted: options.deleted ?? false,
    autoResize: options.autoResize ?? true,
  })
  Object.defineProperty(element, Symbol.iterator, {
    enumerable: false,
    value: function* iterator() {
      yield element
    },
  })
  return element
}

function arrow(id, x, y, dx, dy, options = {}) {
  return base(id, 'arrow', x, y, dx, dy, {
    strokeColor: options.stroke ?? '#495057',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? 'solid',
    roughness: options.roughness ?? 1,
    points: [[0, 0], [dx, dy]],
    startBinding: options.startBinding ?? null,
    endBinding: options.endBinding ?? null,
    startArrowhead: options.startArrowhead ?? null,
    endArrowhead: options.endArrowhead ?? 'arrow',
    elbowed: false,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
}

function line(id, x, y, dx, dy, options = {}) {
  return base(id, 'line', x, y, dx, dy, {
    strokeColor: options.stroke ?? '#868e96',
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? 'solid',
    points: [[0, 0], [dx, dy]],
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
}

function image(id, x, y, width, height, fileId, options = {}) {
  return base(id, 'image', x, y, width, height, {
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    roughness: 0,
    status: 'saved',
    fileId,
    scale: [1, 1],
    crop: null,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
}

function groupBox(id, x, y, width, height, label, options = {}) {
  return [
    ...rect(id, x, y, width, height, null, {
      fill: options.fill ?? 'transparent',
      stroke: options.stroke ?? '#adb5bd',
      strokeStyle: options.strokeStyle ?? 'dashed',
      strokeWidth: options.strokeWidth ?? 2,
      roughness: options.roughness ?? 1,
      round: true,
      groupIds: options.groupIds ?? [],
    }),
    text(`${id}-title`, x + 16, y + 12, label, {
      width: width - 32,
      fontSize: options.fontSize ?? 18,
      color: options.color ?? '#495057',
      groupIds: options.groupIds ?? [],
    }),
  ]
}

function frame(id, x, y, width, height, name, options = {}) {
  return base(id, 'frame', x, y, width, height, {
    strokeColor: options.stroke ?? '#868e96',
    backgroundColor: options.fill ?? 'transparent',
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? 'solid',
    roughness: options.roughness ?? 0,
    roundness: null,
    name,
  })
}

function freedraw(id, x, y, points, options = {}) {
  const maxX = Math.max(...points.map(point => point[0]), 1)
  const maxY = Math.max(...points.map(point => point[1]), 1)
  return base(id, 'freedraw', x, y, maxX, maxY, {
    strokeColor: options.stroke ?? '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: options.strokeWidth ?? 2,
    roughness: options.roughness ?? 1,
    points,
    pressures: options.pressures ?? points.map(() => 0.5),
    simulatePressure: options.simulatePressure ?? true,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
}

function polyArrow(id, x, y, points, options = {}) {
  const maxX = Math.max(...points.map(point => point[0]), 1)
  const maxY = Math.max(...points.map(point => point[1]), 1)
  return base(id, 'arrow', x, y, maxX, maxY, {
    strokeColor: options.stroke ?? '#495057',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: options.strokeWidth ?? 2,
    strokeStyle: options.strokeStyle ?? 'solid',
    points,
    startBinding: options.startBinding ?? null,
    endBinding: options.endBinding ?? null,
    startArrowhead: options.startArrowhead ?? null,
    endArrowhead: options.endArrowhead ?? 'arrow',
    elbowed: options.elbowed ?? false,
    fixedSegments: options.fixedSegments ?? null,
    groupIds: options.groupIds ?? [],
    frameId: options.frameId ?? null,
  })
}

function doc(elements, options = {}) {
  return {
    type: options.type ?? 'excalidraw',
    version: 2,
    source: 'md-viewer-excalidraw-fixture',
    elements,
    appState: {
      viewBackgroundColor: options.background ?? '#ffffff',
      ...(options.customData ? { customData: options.customData } : {}),
    },
    files: options.files ?? {},
  }
}

function writeJson(name, data) {
  writeFileSync(join(excalidrawDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function createBasicFlow() {
  return doc([
    ...rect('start-box', 0, 0, 150, 72, '开始', { fill: '#d5e8d4', fontSize: 24 }),
    ...rect('load-box', 205, 0, 150, 72, '读取文件', { fill: '#dae8fc', fontSize: 24 }),
    ...rect('render-box', 410, 0, 150, 72, '静态渲染', { fill: '#ffe6cc', fontSize: 24 }),
    arrow('a-start-load', 150, 36, 55, 0),
    arrow('a-load-render', 355, 36, 55, 0),
  ])
}

function createSequenceFlow() {
  return doc([
    ...rect('client', 0, 0, 130, 70, 'Markdown', { fill: '#f8cecc' }),
    ...rect('renderer', 190, 0, 150, 70, 'Excalidraw', { fill: '#d5e8d4' }),
    ...rect('svg', 400, 0, 130, 70, 'SVG', { fill: '#fff2cc' }),
    arrow('seq-1', 130, 35, 60, 0, { stroke: '#c92a2a' }),
    arrow('seq-2', 340, 35, 60, 0, { stroke: '#2b8a3e' }),
  ])
}

function createGatewayFanout() {
  const group = 'gateway-fanout'
  return doc([
    ...text('title', 0, -70, 'MCP 风格：网关扇出架构', { fontSize: 28, width: 520 }),
    ...rect('client', 0, 60, 150, 70, 'Web / Mobile', { fill: '#e7f5ff', stroke: '#1971c2', groupIds: [group] }),
    ...rect('gateway', 230, 0, 150, 240, 'API Gateway', { fill: '#e5dbff', stroke: '#6741d9', groupIds: [group] }),
    ...rect('auth', 480, -10, 150, 62, 'Auth Service', { fill: '#d3f9d8', stroke: '#2b8a3e', groupIds: [group] }),
    ...rect('users', 480, 76, 150, 62, 'User Service', { fill: '#d0ebff', stroke: '#1864ab', groupIds: [group] }),
    ...rect('orders', 480, 162, 150, 62, 'Order Service', { fill: '#fff3bf', stroke: '#e67700', groupIds: [group] }),
    ...rect('payments', 480, 248, 150, 62, 'Payment Service', { fill: '#ffe3e3', stroke: '#c92a2a', groupIds: [group] }),
    arrow('a-client-gateway', 150, 95, 80, 25, { groupIds: [group] }),
    arrow('a-gateway-auth', 380, 40, 100, -20, { groupIds: [group] }),
    arrow('a-gateway-users', 380, 100, 100, 6, { groupIds: [group] }),
    arrow('a-gateway-orders', 380, 150, 100, 42, { groupIds: [group] }),
    arrow('a-gateway-payments', 380, 205, 100, 75, { groupIds: [group] }),
  ], {
    customData: {
      excalidraw_mcp: {
        pattern: 'gateway fan-out',
        nodes: ['client', 'gateway', 'auth', 'users', 'orders', 'payments'],
        direction: 'LR',
      },
    },
  })
}

function createEcommercePlatform() {
  return doc([
    ...text('title', 0, -90, '电商平台架构：组件类型样式覆盖', { fontSize: 28, width: 720 }),
    ...rect('browser', 0, 60, 140, 70, 'Browser', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('cdn', 200, 60, 130, 70, 'CloudFront\nCDN', { fill: '#fff9db', stroke: '#f08c00', fontSize: 18 }),
    ...rect('api', 390, 20, 150, 150, 'Nginx\nGateway', { fill: '#e5dbff', stroke: '#6741d9' }),
    ...rect('catalog', 610, -40, 150, 62, 'Catalog', { fill: '#d0ebff', stroke: '#1864ab' }),
    ...rect('cart', 610, 46, 150, 62, 'Cart', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('checkout', 610, 132, 150, 62, 'Checkout', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('postgres', 830, -36, 150, 62, 'PostgreSQL', { fill: '#dbe4ff', stroke: '#364fc7' }),
    ...rect('redis', 830, 50, 150, 62, 'Redis Cache', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('kafka', 830, 136, 150, 62, 'Kafka Events', { fill: '#ffe8cc', stroke: '#d9480f' }),
    arrow('a1', 140, 95, 60, 0),
    arrow('a2', 330, 95, 60, 0),
    arrow('a3', 540, 70, 70, -80),
    arrow('a4', 540, 95, 70, -18),
    arrow('a5', 540, 120, 70, 42),
    arrow('a6', 760, -9, 70, 4),
    arrow('a7', 760, 77, 70, 4, { strokeStyle: 'dashed' }),
    arrow('a8', 760, 163, 70, 4, { stroke: '#d9480f', strokeWidth: 3 }),
  ], {
    customData: {
      excalidraw_mcp: {
        pattern: 'layered architecture',
        component_types: ['cdn', 'nginx', 'postgresql', 'redis', 'kafka'],
        direction: 'LR',
      },
    },
  })
}

function createPaymentDecisionFlow() {
  return doc([
    ...text('title', 0, -90, '支付流程：菱形决策和错误分支', { fontSize: 28, width: 680 }),
    ...rect('submit', 0, 40, 150, 64, '提交订单', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('reserve', 220, 40, 150, 64, '锁定库存', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...diamond('risk', 440, 18, 150, 108, '风控通过?', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('charge', 680, -20, 150, 64, '扣款', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('reject', 680, 118, 150, 64, '拒绝支付', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('event', 910, -20, 150, 64, '发送事件', { fill: '#ffe8cc', stroke: '#d9480f' }),
    arrow('p1', 150, 72, 70, 0),
    arrow('p2', 370, 72, 70, 0),
    arrow('p3', 590, 60, 90, -48, { stroke: '#2b8a3e' }),
    text('yes-label', 610, 18, '是', { fontSize: 16, color: '#2b8a3e' }),
    arrow('p4', 590, 88, 90, 60, { stroke: '#c92a2a', strokeStyle: 'dashed' }),
    text('no-label', 610, 112, '否', { fontSize: 16, color: '#c92a2a' }),
    arrow('p5', 830, 12, 80, 0),
  ])
}

function createDataPipeline() {
  return doc([
    ...text('title', 0, -80, '数据管道：线性流 + 单次 fork/merge', { fontSize: 28, width: 760 }),
    ...rect('source', 0, 70, 145, 64, 'Raw Events', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('ingest', 210, 70, 145, 64, 'Ingest', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('clean', 420, 70, 145, 64, 'Normalize', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('batch', 650, 0, 145, 64, 'Batch ETL', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('stream', 650, 140, 145, 64, 'Stream Jobs', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('warehouse', 900, 70, 165, 64, 'Warehouse', { fill: '#dbe4ff', stroke: '#364fc7' }),
    arrow('d1', 145, 102, 65, 0),
    arrow('d2', 355, 102, 65, 0),
    arrow('d3', 565, 90, 85, -58),
    arrow('d4', 565, 114, 85, 58),
    arrow('d5', 795, 32, 105, 70),
    arrow('d6', 795, 172, 105, -70),
  ])
}

function createLayeredArchitecture() {
  return doc([
    ...text('title', 0, -80, '分层架构：边界框、缓存、数据库', { fontSize: 28, width: 760 }),
    ...groupBox('edge-layer', -20, 10, 210, 210, 'Edge Layer', { fill: '#f8f9fa' }),
    ...groupBox('service-layer', 250, 10, 350, 210, 'Service Layer', { fill: '#f8f9fa' }),
    ...groupBox('data-layer', 670, 10, 300, 210, 'Data Layer', { fill: '#f8f9fa' }),
    ...rect('lb', 20, 95, 130, 60, 'Load Balancer', { fill: '#e5dbff', stroke: '#6741d9' }),
    ...rect('svc-a', 290, 55, 120, 54, 'API', { fill: '#d0ebff', stroke: '#1864ab' }),
    ...rect('svc-b', 430, 55, 120, 54, 'Worker', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('svc-c', 360, 142, 120, 54, 'Scheduler', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('cache', 710, 55, 110, 54, 'Redis', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('db', 835, 112, 110, 54, 'Postgres', { fill: '#dbe4ff', stroke: '#364fc7' }),
    arrow('l1', 150, 125, 140, -42),
    arrow('l2', 150, 125, 210, 44),
    arrow('l3', 550, 82, 160, 0, { strokeStyle: 'dashed' }),
    arrow('l4', 480, 170, 355, -30),
  ])
}

function createHubFanout() {
  return doc([
    ...text('title', 0, -80, 'Hub 节点：3-5 个扇出目标', { fontSize: 28, width: 620 }),
    ...rect('events', 0, 100, 145, 64, 'Event Bus', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('hub', 235, 20, 145, 230, 'Kafka Topic', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('billing', 470, 0, 145, 56, 'Billing', { fill: '#d0ebff', stroke: '#1864ab' }),
    ...rect('email', 470, 76, 145, 56, 'Email', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('audit', 470, 152, 145, 56, 'Audit Log', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('search', 470, 228, 145, 56, 'Search Index', { fill: '#c3fae8', stroke: '#087f5b' }),
    arrow('h0', 145, 132, 90, 0, { strokeWidth: 3 }),
    arrow('h1', 380, 64, 90, -36),
    arrow('h2', 380, 105, 90, -1),
    arrow('h3', 380, 151, 90, 29),
    arrow('h4', 380, 200, 90, 56),
  ])
}

function createDisconnectedMonitoring() {
  return doc([
    ...text('title', 0, -90, '断开子图：主业务与监控栈并列', { fontSize: 28, width: 760 }),
    ...rect('client', 0, 0, 130, 60, 'Client', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('api', 200, 0, 130, 60, 'API', { fill: '#d0ebff', stroke: '#1864ab' }),
    ...rect('db', 400, 0, 130, 60, 'DB', { fill: '#dbe4ff', stroke: '#364fc7' }),
    ...rect('prom', 0, 160, 130, 60, 'Prometheus', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('grafana', 200, 160, 130, 60, 'Grafana', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('alert', 400, 160, 130, 60, 'Alerting', { fill: '#f3f0ff', stroke: '#6741d9' }),
    arrow('m1', 130, 30, 70, 0),
    arrow('m2', 330, 30, 70, 0),
    arrow('m3', 130, 190, 70, 0, { strokeStyle: 'dotted' }),
    arrow('m4', 330, 190, 70, 0, { strokeStyle: 'dotted' }),
  ])
}

function createStateMachine() {
  return doc([
    ...text('title', 0, -80, '状态机：圆形节点与回环路径', { fontSize: 28, width: 640 }),
    ...ellipse('draft', 0, 80, 130, 64, 'Draft', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...ellipse('review', 210, 80, 130, 64, 'Review', { fill: '#fff3bf', stroke: '#e67700' }),
    ...ellipse('approved', 420, 20, 150, 64, 'Approved', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...ellipse('rejected', 420, 150, 150, 64, 'Rejected', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('s1', 130, 112, 80, 0),
    arrow('s2', 340, 100, 80, -48, { stroke: '#2b8a3e' }),
    arrow('s3', 340, 125, 80, 58, { stroke: '#c92a2a', strokeStyle: 'dashed' }),
    arrow('s4', 420, 182, -290, -62, { strokeStyle: 'dotted' }),
  ])
}

function createDecisionTree() {
  return doc([
    ...text('title', 0, -80, '决策树：TD 方向布局样本', { fontSize: 28, width: 640 }),
    ...diamond('root', 260, 0, 150, 94, '请求有效?', { fill: '#fff3bf', stroke: '#e67700' }),
    ...diamond('auth', 80, 150, 150, 94, '已登录?', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...diamond('quota', 440, 150, 150, 94, '额度足够?', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('deny', 0, 310, 130, 58, '拒绝', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('login', 180, 310, 130, 58, '登录', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('queue', 390, 310, 130, 58, '排队', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('accept', 570, 310, 130, 58, '接受', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    arrow('t1', 300, 94, -135, 56),
    arrow('t2', 370, 94, 135, 56),
    arrow('t3', 130, 244, -65, 66, { stroke: '#c92a2a' }),
    arrow('t4', 185, 244, 60, 66),
    arrow('t5', 500, 244, -45, 66, { strokeStyle: 'dashed' }),
    arrow('t6', 550, 244, 85, 66, { stroke: '#2b8a3e' }),
  ])
}

function createShapesGallery() {
  return doc([
    ...text('title', 0, -80, '形状库：rectangle / diamond / ellipse / arrow / line', { fontSize: 26, width: 820 }),
    ...rect('rect', 0, 30, 150, 70, 'Rectangle', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...diamond('diamond', 220, 18, 150, 94, 'Diamond', { fill: '#fff3bf', stroke: '#e67700' }),
    ...ellipse('ellipse', 460, 30, 150, 70, 'Ellipse', { fill: '#f3f0ff', stroke: '#6741d9' }),
    line('line', 30, 180, 220, 0, { stroke: '#495057', strokeWidth: 4 }),
    arrow('arrow', 330, 180, 220, 0, { stroke: '#2b8a3e', strokeWidth: 4 }),
    text('line-label', 72, 198, 'line', { fontSize: 18, width: 120, align: 'center' }),
    text('arrow-label', 380, 198, 'arrow', { fontSize: 18, width: 120, align: 'center' }),
  ])
}

function createStyleGallery() {
  return doc([
    ...text('title', 0, -80, '样式库：线型、透明度、粗糙度', { fontSize: 28, width: 680 }),
    ...rect('solid', 0, 20, 150, 70, 'solid', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('dashed', 210, 20, 150, 70, 'dashed', { fill: '#fff3bf', stroke: '#e67700', strokeStyle: 'dashed' }),
    ...rect('dotted', 420, 20, 150, 70, 'dotted', { fill: '#ffe3e3', stroke: '#c92a2a', strokeStyle: 'dotted' }),
    ...rect('opacity', 0, 140, 150, 70, 'opacity 45%', { fill: '#d3f9d8', stroke: '#2b8a3e', opacity: 45 }),
    ...rect('rough', 210, 140, 150, 70, 'roughness 2', { fill: '#f3f0ff', stroke: '#6741d9', roughness: 2 }),
    ...rect('thick', 420, 140, 150, 70, 'thick border', { fill: '#e7f5ff', stroke: '#1864ab', strokeWidth: 5 }),
  ])
}

function createTextUnicode() {
  return doc([
    ...text('title', 0, -80, '文本：多行、中文、Unicode、长标签', { fontSize: 28, width: 780 }),
    ...rect('multi', 0, 20, 220, 110, '多行文本\n第二行\nthird line', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...rect('unicode', 280, 20, 240, 110, '中文 / 日本語 / 한글\nπ ≈ 3.14159 / λ / ∑', { fill: '#fff3bf', stroke: '#e67700', fontSize: 17 }),
    ...rect('long', 580, 20, 300, 120, '很长的节点名称\n用于观察 SVG 尺寸\n和文字换行边界', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
  ])
}

function createNegativeCoordinates() {
  return doc([
    ...text('title', -260, -150, '负坐标：自动 viewBox 边界', { fontSize: 28, width: 520 }),
    ...rect('left', -260, -40, 150, 70, 'x < 0', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('center', 0, 0, 150, 70, 'origin', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('bottom', 260, 110, 150, 70, 'positive', { fill: '#fff3bf', stroke: '#e67700' }),
    arrow('n1', -110, -5, 110, 40),
    arrow('n2', 150, 35, 110, 110),
  ])
}

function createRotatedElements() {
  const r1 = rect('rot1', 0, 40, 150, 70, '15°', { fill: '#e7f5ff', stroke: '#1971c2' })
  r1[0].angle = Math.PI / 12
  r1[1].angle = Math.PI / 12
  const r2 = rect('rot2', 240, 40, 150, 70, '45°', { fill: '#fff3bf', stroke: '#e67700' })
  r2[0].angle = Math.PI / 4
  r2[1].angle = Math.PI / 4
  const r3 = rect('rot3', 480, 40, 150, 70, '-20°', { fill: '#d3f9d8', stroke: '#2b8a3e' })
  r3[0].angle = -Math.PI / 9
  r3[1].angle = -Math.PI / 9
  return doc([
    ...text('title', 0, -80, '旋转元素：非零 angle', { fontSize: 28, width: 620 }),
    ...r1,
    ...r2,
    ...r3,
  ])
}

function createDeletedElements() {
  return doc([
    ...text('title', 0, -80, '删除元素：isDeleted 应被忽略', { fontSize: 28, width: 640 }),
    ...rect('visible', 0, 40, 170, 70, '可见元素', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('deleted', 240, 40, 170, 70, '已删除元素', { fill: '#ffe3e3', stroke: '#c92a2a', deleted: true }),
    arrow('delete-arrow', 170, 75, 70, 0, { strokeStyle: 'dashed' }),
  ])
}

function createLargeBalancedGraph() {
  const layers = [
    [['c1', 'Client A'], ['c2', 'Client B']],
    [['gw', 'Gateway']],
    [['s1', 'Auth'], ['s2', 'Catalog'], ['s3', 'Order'], ['s4', 'Payment']],
    [['d1', 'Users DB'], ['d2', 'Products DB'], ['d3', 'Orders DB'], ['q1', 'Event Bus']],
    [['w1', 'Email'], ['w2', 'Search'], ['w3', 'Audit']],
  ]
  const nodeCount = layers.reduce((count, layer) => count + layer.length, 0)
  const elements = [
    ...text('title', 0, -90, `较大但均衡：${nodeCount} 节点、主数据流`, { fontSize: 28, width: 760 }),
  ]
  const fills = ['#e7f5ff', '#e5dbff', '#d3f9d8', '#fff3bf', '#ffe8cc']
  const nodes = new Map()
  layers.forEach((layer, li) => {
    layer.forEach(([id, label], ni) => {
      const x = li * 210
      const y = ni * 86 + (4 - layer.length) * 24
      const width = 145
      const height = 58
      nodes.set(id, { x, y, width, height })
      elements.push(...rect(id, x, y, width, height, label, {
        fill: fills[li],
        stroke: ['#1971c2', '#6741d9', '#2b8a3e', '#e67700', '#d9480f'][li],
        fontSize: 18,
      }))
    })
  })
  const arrowBetween = (id, fromId, toId) => {
    const from = nodes.get(fromId)
    const to = nodes.get(toId)
    const x = from.x + from.width
    const y = from.y + from.height / 2
    const endX = to.x
    const endY = to.y + to.height / 2

    return arrow(id, x, y, endX - x, endY - y)
  }
  const arrows = [
    ['a1', 'c1', 'gw'], ['a2', 'c2', 'gw'],
    ['a3', 'gw', 's1'], ['a4', 'gw', 's2'], ['a5', 'gw', 's3'], ['a6', 'gw', 's4'],
    ['a7', 's1', 'd1'], ['a8', 's2', 'd2'], ['a9', 's3', 'd3'], ['a10', 's4', 'q1'],
    ['a11', 'd1', 'w1'], ['a12', 'd2', 'w2'], ['a13', 'd3', 'w3'],
  ]
  arrows.forEach(([id, fromId, toId]) => elements.push(arrowBetween(id, fromId, toId)))
  return doc(elements)
}

function createDarkBackground() {
  return doc([
    ...text('title', 0, -80, '深色背景 appState', { fontSize: 28, width: 520, color: '#f8f9fa' }),
    ...rect('panel', 0, 30, 220, 100, 'Dark Canvas', { fill: '#343a40', stroke: '#ced4da', fontSize: 22 }),
    ...rect('metric', 300, 30, 180, 100, 'Metric\n99.95%', { fill: '#1864ab', stroke: '#a5d8ff', fontSize: 22 }),
    arrow('dark-a', 220, 80, 80, 0, { stroke: '#f8f9fa', strokeWidth: 3 }),
  ], { background: '#212529' })
}

function createCompatibleNoType() {
  const data = doc([
    ...text('title', 0, -80, '兼容模式：缺少 type 字段但有 elements', { fontSize: 28, width: 720 }),
    ...rect('compat', 0, 40, 260, 80, '按兼容模式渲染', { fill: '#fff3bf', stroke: '#e67700' }),
  ], { type: undefined })
  delete data.type
  return data
}

function createEmbeddedImage() {
  return doc([
    image('image-1', 0, 0, 64, 64, 'file-1'),
    ...rect('image-caption', 92, 0, 180, 64, '内嵌 dataURL 图片', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
  ], {
    files: {
      'file-1': {
        id: 'file-1',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        created: 1,
        lastRetrieved: 1,
      },
    },
  })
}

function createMissingImage() {
  return doc([
    image('missing-image', 0, 0, 96, 72, 'missing-file'),
    text('missing-label', 120, 18, '缺失图片资源', { fontSize: 24, width: 180 }),
  ])
}

function createBoundTextContainers() {
  const card = rect('bound-card', 0, 0, 260, 120, null, { fill: '#e7f5ff', stroke: '#1971c2' })[0]
  const status = rect('status-card', 340, 0, 260, 120, null, { fill: '#d3f9d8', stroke: '#2b8a3e' })[0]
  card.boundElements = [{ id: 'bound-card-text', type: 'text' }]
  status.boundElements = [{ id: 'status-card-text', type: 'text' }]

  return doc([
    ...text('title', 0, -80, '绑定文本：containerId / boundElements', { fontSize: 28, width: 720 }),
    card,
    text('bound-card-text', 28, 34, '文本绑定到容器\n自动居中', {
      width: 204,
      fontSize: 22,
      align: 'center',
      containerId: 'bound-card',
      autoResize: false,
    }),
    status,
    text('status-card-text', 368, 34, '另一个容器\n用于回归测试', {
      width: 204,
      fontSize: 22,
      align: 'center',
      containerId: 'status-card',
      autoResize: false,
    }),
    arrow('bound-arrow', 260, 60, 80, 0),
  ])
}

function createArrowBindings() {
  const producer = rect('producer', 0, 40, 160, 72, 'Producer', { fill: '#e7f5ff', stroke: '#1971c2' })
  const queue = rect('queue', 290, 40, 170, 72, 'Queue', { fill: '#ffe8cc', stroke: '#d9480f' })
  const consumer = rect('consumer', 600, 40, 160, 72, 'Consumer', { fill: '#d3f9d8', stroke: '#2b8a3e' })
  producer[0].boundElements = [{ id: 'bind-a', type: 'arrow' }]
  queue[0].boundElements = [{ id: 'bind-a', type: 'arrow' }, { id: 'bind-b', type: 'arrow' }]
  consumer[0].boundElements = [{ id: 'bind-b', type: 'arrow' }]

  return doc([
    ...text('title', 0, -70, '箭头绑定：startBinding / endBinding', { fontSize: 28, width: 720 }),
    ...producer,
    ...queue,
    ...consumer,
    arrow('bind-a', 160, 76, 130, 0, {
      startBinding: { elementId: 'producer', focus: 0, gap: 8, fixedPoint: [1, 0.5] },
      endBinding: { elementId: 'queue', focus: 0, gap: 8, fixedPoint: [0, 0.5] },
    }),
    arrow('bind-b', 460, 76, 140, 0, {
      startBinding: { elementId: 'queue', focus: 0, gap: 8, fixedPoint: [1, 0.5] },
      endBinding: { elementId: 'consumer', focus: 0, gap: 8, fixedPoint: [0, 0.5] },
    }),
  ])
}

function createFrameLayout() {
  return doc([
    frame('checkout-frame', -30, -30, 760, 280, 'Checkout Slice', { stroke: '#6741d9' }),
    ...text('title', 0, -95, 'Frame：元素归属 frameId', { fontSize: 28, width: 620 }),
    ...rect('cart', 20, 60, 140, 62, 'Cart', { fill: '#e7f5ff', stroke: '#1971c2', frameId: 'checkout-frame' }),
    ...rect('pricing', 220, 60, 140, 62, 'Pricing', { fill: '#fff3bf', stroke: '#e67700', frameId: 'checkout-frame' }),
    ...rect('payment', 420, 60, 140, 62, 'Payment', { fill: '#ffe3e3', stroke: '#c92a2a', frameId: 'checkout-frame' }),
    ...rect('receipt', 220, 170, 140, 62, 'Receipt', { fill: '#d3f9d8', stroke: '#2b8a3e', frameId: 'checkout-frame' }),
    arrow('frame-a', 160, 91, 60, 0, { frameId: 'checkout-frame' }),
    arrow('frame-b', 360, 91, 60, 0, { frameId: 'checkout-frame' }),
    arrow('frame-c', 490, 122, -200, 48, { frameId: 'checkout-frame', strokeStyle: 'dashed' }),
  ])
}

function createFreeDrawSketch() {
  return doc([
    ...text('title', 0, -80, '手绘线条：freedraw points / pressures', { fontSize: 28, width: 700 }),
    ...rect('note', 0, 20, 280, 120, '草图标注区域', { fill: '#fff9db', stroke: '#f08c00' }),
    freedraw('stroke-1', 28, 48, [[0, 40], [30, 18], [70, 34], [110, 10], [150, 40], [205, 20]], { stroke: '#c92a2a', strokeWidth: 4 }),
    freedraw('stroke-2', 330, 35, [[0, 15], [24, 60], [60, 44], [92, 84], [130, 40], [176, 74], [220, 22]], { stroke: '#1971c2', strokeWidth: 3 }),
    ...text('caption', 330, 140, '用于确认自由绘制元素不会破坏 SVG 导出', { fontSize: 18, width: 420, color: '#495057' }),
  ])
}

function createPolylineArrows() {
  return doc([
    ...text('title', 0, -80, '多段箭头：折线 points', { fontSize: 28, width: 560 }),
    ...rect('source', 0, 30, 140, 60, 'Source', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('middle', 260, 150, 150, 60, 'Middle', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('target', 540, 30, 140, 60, 'Target', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    polyArrow('poly-a', 140, 60, [[0, 0], [80, 0], [80, 120], [120, 120]], { stroke: '#495057' }),
    polyArrow('poly-b', 410, 180, [[0, 0], [90, 0], [90, -120], [130, -120]], { stroke: '#2b8a3e', strokeStyle: 'dashed' }),
  ])
}

function createArrowheadGallery() {
  const heads = ['arrow', 'bar', 'circle', 'circle_outline', 'triangle', 'triangle_outline', 'diamond', 'diamond_outline', 'cardinality_one', 'cardinality_many', 'cardinality_one_or_many', 'cardinality_zero_or_many']
  const elements = [
    ...text('title', 0, -80, '箭头头部：官方 Arrowhead 类型覆盖', { fontSize: 28, width: 760 }),
  ]
  heads.forEach((head, index) => {
    const row = Math.floor(index / 4)
    const col = index % 4
    const x = col * 230
    const y = row * 78 + 20
    elements.push(arrow(`head-${head}`, x, y, 145, 0, { endArrowhead: head, strokeWidth: 3 }))
    elements.push(text(`head-${head}-label`, x, y + 18, head, { fontSize: 16, width: 190, color: '#495057' }))
  })
  return doc(elements)
}

function createMermaidFlowchartShapes() {
  return doc([
    ...text('title', 0, -80, 'Mermaid 转换风格：常见 flowchart 形状', { fontSize: 28, width: 780 }),
    ...rect('round', 0, 30, 145, 64, 'Round', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('subroutine', 210, 30, 145, 64, 'Subroutine', { fill: '#fff3bf', stroke: '#e67700', round: false }),
    line('subroutine-l', 226, 30, 0, 64, { stroke: '#e67700' }),
    line('subroutine-r', 339, 30, 0, 64, { stroke: '#e67700' }),
    ...ellipse('circle', 430, 18, 88, 88, 'Circle', { fill: '#f3f0ff', stroke: '#6741d9', fontSize: 15 }),
    ...diamond('rhombus', 600, 8, 150, 104, 'Rhombus', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('mf-1', 145, 62, 65, 0),
    arrow('mf-2', 355, 62, 75, 0),
    arrow('mf-3', 518, 62, 82, 0),
  ])
}

function createSequenceLifelines() {
  const actors = [
    ['user', 'User', 0],
    ['api', 'API', 230],
    ['db', 'DB', 460],
  ]
  const elements = [
    ...text('title', 0, -80, 'Sequence 风格：生命线、激活条、返回线', { fontSize: 28, width: 760 }),
  ]
  actors.forEach(([id, label, x]) => {
    elements.push(...rect(`${id}-head`, x, 0, 120, 54, label, { fill: '#e7f5ff', stroke: '#1971c2' }))
    elements.push(line(`${id}-life`, x + 60, 54, 0, 300, { stroke: '#adb5bd', strokeStyle: 'dashed' }))
  })
  elements.push(
    ...rect('api-activation', 282, 92, 16, 148, null, { fill: '#d0ebff', stroke: '#1864ab', round: false }),
    ...rect('db-activation', 512, 148, 16, 72, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    arrow('seq-call-1', 60, 108, 222, 0),
    text('seq-call-1-label', 112, 82, 'request()', { fontSize: 16, width: 120 }),
    arrow('seq-call-2', 298, 164, 214, 0),
    text('seq-call-2-label', 350, 138, 'query', { fontSize: 16, width: 90 }),
    arrow('seq-return-1', 512, 210, -214, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    text('seq-return-1-label', 360, 218, 'rows', { fontSize: 16, width: 80 }),
    arrow('seq-return-2', 282, 250, -222, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    ...rect('seq-note', 86, 288, 260, 58, 'note over User/API', { fill: '#fff9db', stroke: '#f08c00', fontSize: 17 })
  )
  return doc(elements)
}

function createClassDiagram() {
  return doc([
    ...text('title', 0, -80, 'Class Diagram：分隔线、成员、继承箭头', { fontSize: 28, width: 760 }),
    ...rect('order-class', 0, 20, 220, 180, null, { fill: '#f8f9fa', stroke: '#495057', round: false }),
    text('order-title', 20, 34, 'Order', { fontSize: 22, width: 180, align: 'center' }),
    line('order-sep-1', 0, 72, 220, 0),
    text('order-fields', 18, 86, '+ id: string\n+ total: Money', { fontSize: 16, width: 184 }),
    line('order-sep-2', 0, 130, 220, 0),
    text('order-methods', 18, 144, '+ submit()\n+ cancel()', { fontSize: 16, width: 184 }),
    ...rect('paid-class', 360, 20, 220, 140, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false }),
    text('paid-title', 380, 34, 'PaidOrder', { fontSize: 22, width: 180, align: 'center' }),
    line('paid-sep-1', 360, 72, 220, 0),
    text('paid-fields', 378, 88, '+ paidAt: Date\n+ receiptId: string', { fontSize: 16, width: 184 }),
    arrow('class-inherit', 360, 90, -140, 0, { startArrowhead: 'triangle_outline', endArrowhead: null }),
  ])
}

function createERDiagram() {
  return doc([
    ...text('title', 0, -80, 'ER Diagram：实体、关系、基数箭头', { fontSize: 28, width: 760 }),
    ...rect('customer', 0, 40, 180, 110, 'Customer\nPK id\nemail', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...diamond('places', 260, 48, 130, 94, 'places', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('order', 470, 40, 180, 110, 'Order\nPK id\nFK customer_id', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 18 }),
    ...rect('line', 760, 40, 180, 110, 'OrderLine\nPK id\nsku', { fill: '#ffe8cc', stroke: '#d9480f', fontSize: 18 }),
    arrow('er-a', 180, 95, 80, 0, { endArrowhead: 'cardinality_many' }),
    arrow('er-b', 390, 95, 80, 0, { endArrowhead: 'cardinality_one' }),
    arrow('er-c', 650, 95, 110, 0, { endArrowhead: 'cardinality_one_or_many' }),
  ])
}

function createStateComposite() {
  return doc([
    ...text('title', 0, -90, 'State Diagram：复合状态、开始/结束节点', { fontSize: 28, width: 760 }),
    frame('state-frame', 150, -10, 430, 245, 'Processing', { stroke: '#6741d9' }),
    base('state-start', 'ellipse', 0, 75, 28, 28, { strokeColor: '#1e1e1e', backgroundColor: '#1e1e1e' }),
    ...ellipse('queued', 170, 60, 120, 58, 'Queued', { fill: '#e7f5ff', stroke: '#1971c2', frameId: 'state-frame' }),
    ...ellipse('running', 400, 60, 120, 58, 'Running', { fill: '#fff3bf', stroke: '#e67700', frameId: 'state-frame' }),
    ...ellipse('failed', 285, 160, 120, 58, 'Failed', { fill: '#ffe3e3', stroke: '#c92a2a', frameId: 'state-frame' }),
    base('state-end', 'ellipse', 700, 75, 28, 28, { strokeColor: '#1e1e1e', backgroundColor: '#ffffff', strokeWidth: 4 }),
    arrow('st-a', 28, 89, 142, 0),
    arrow('st-b', 290, 89, 110, 0, { frameId: 'state-frame' }),
    arrow('st-c', 520, 89, 180, 0),
    arrow('st-d', 460, 118, -115, 42, { stroke: '#c92a2a', strokeStyle: 'dashed', frameId: 'state-frame' }),
  ])
}

function createSubgraphClusters() {
  return doc([
    ...text('title', 0, -90, 'Subgraph：集群边界和跨集群连接', { fontSize: 28, width: 760 }),
    ...groupBox('frontend-cluster', -20, 0, 330, 210, 'Frontend Cluster', { fill: '#f8f9fa', stroke: '#1971c2' }),
    ...groupBox('backend-cluster', 390, 0, 360, 210, 'Backend Cluster', { fill: '#f8f9fa', stroke: '#2b8a3e' }),
    ...rect('web', 20, 72, 120, 56, 'Web', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('mobile', 165, 72, 120, 56, 'Mobile', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('api', 430, 54, 120, 56, 'API', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('worker', 590, 54, 120, 56, 'Worker', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('cache', 510, 138, 120, 56, 'Cache', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('sg-a', 140, 100, 290, -18),
    arrow('sg-b', 285, 100, 145, -18),
    arrow('sg-c', 550, 82, 40, 0),
    arrow('sg-d', 490, 110, 80, 28, { strokeStyle: 'dashed' }),
  ])
}

function createSwimlaneProcess() {
  return doc([
    ...text('title', 0, -90, '泳道流程：业务 / 系统 / 外部服务', { fontSize: 28, width: 760 }),
    ...groupBox('lane-business', -20, 0, 880, 95, 'Business', { fill: '#f8f9fa', stroke: '#adb5bd' }),
    ...groupBox('lane-system', -20, 115, 880, 95, 'System', { fill: '#f8f9fa', stroke: '#adb5bd' }),
    ...groupBox('lane-external', -20, 230, 880, 95, 'External', { fill: '#f8f9fa', stroke: '#adb5bd' }),
    ...rect('sw-request', 120, 28, 130, 48, '申请', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...rect('sw-validate', 300, 143, 130, 48, '校验', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 18 }),
    ...rect('sw-pay', 480, 258, 130, 48, '支付网关', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 18 }),
    ...rect('sw-confirm', 660, 143, 130, 48, '确认', { fill: '#fff3bf', stroke: '#e67700', fontSize: 18 }),
    arrow('sw-a', 250, 52, 50, 115),
    arrow('sw-b', 430, 167, 50, 115),
    arrow('sw-c', 610, 282, 50, -115),
  ])
}

function createTimeline() {
  const elements = [
    ...text('title', 0, -80, '时间线：里程碑和注释', { fontSize: 28, width: 620 }),
    line('timeline-axis', 0, 120, 820, 0, { stroke: '#495057', strokeWidth: 4 }),
  ]
  ;[
    ['plan', 'Plan', 80, '#e7f5ff', '#1971c2'],
    ['build', 'Build', 280, '#d3f9d8', '#2b8a3e'],
    ['test', 'Test', 480, '#fff3bf', '#e67700'],
    ['ship', 'Ship', 680, '#ffe3e3', '#c92a2a'],
  ].forEach(([id, label, x, fill, stroke]) => {
    elements.push(line(`${id}-tick`, x, 96, 0, 48, { stroke, strokeWidth: 3 }))
    elements.push(...rect(`${id}-box`, x - 55, 20, 110, 54, label, { fill, stroke, fontSize: 18 }))
  })
  return doc(elements)
}

function createNetworkTopology() {
  return doc([
    ...text('title', 0, -80, '网络拓扑：区域、路由器、服务节点', { fontSize: 28, width: 760 }),
    ...ellipse('internet', 0, 80, 140, 70, 'Internet', { fill: '#f3f0ff', stroke: '#6741d9' }),
    ...rect('edge-router', 220, 80, 145, 70, 'Edge Router', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('core-router', 445, 80, 145, 70, 'Core Router', { fill: '#e5dbff', stroke: '#6741d9' }),
    ...rect('svc-a', 700, 0, 140, 58, 'Service A', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('svc-b', 700, 92, 140, 58, 'Service B', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('svc-c', 700, 184, 140, 58, 'Service C', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('net-a', 140, 115, 80, 0),
    arrow('net-b', 365, 115, 80, 0),
    arrow('net-c', 590, 110, 110, -82),
    arrow('net-d', 590, 115, 110, 6),
    arrow('net-e', 590, 120, 110, 92),
  ])
}

function createMindMap() {
  return doc([
    ...text('title', 0, -100, '思维导图：中心节点和放射分支', { fontSize: 28, width: 680 }),
    ...ellipse('root', 300, 95, 160, 80, 'Excalidraw\nRendering', { fill: '#e5dbff', stroke: '#6741d9', fontSize: 18 }),
    ...rect('shape', 0, 0, 150, 58, 'Shapes', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('style', 0, 190, 150, 58, 'Styles', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('files', 610, 0, 150, 58, 'Files', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('errors', 610, 190, 150, 58, 'Errors', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('mm-a', 300, 122, -150, -93, { startArrowhead: null, endArrowhead: 'arrow' }),
    arrow('mm-b', 300, 148, -150, 71),
    arrow('mm-c', 460, 122, 150, -93),
    arrow('mm-d', 460, 148, 150, 71),
  ])
}

function createKanbanBoard() {
  return doc([
    ...text('title', 0, -80, '看板：列布局和卡片', { fontSize: 28, width: 520 }),
    ...groupBox('todo-lane', 0, 0, 220, 300, 'To Do', { fill: '#f8f9fa', stroke: '#1971c2' }),
    ...groupBox('doing-lane', 260, 0, 220, 300, 'Doing', { fill: '#f8f9fa', stroke: '#e67700' }),
    ...groupBox('done-lane', 520, 0, 220, 300, 'Done', { fill: '#f8f9fa', stroke: '#2b8a3e' }),
    ...rect('todo-card-1', 24, 64, 172, 56, '解析 .excalidraw', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 17 }),
    ...rect('todo-card-2', 24, 142, 172, 56, '缺失文件错误', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 17 }),
    ...rect('doing-card-1', 284, 64, 172, 56, 'SVG 导出', { fill: '#fff3bf', stroke: '#e67700', fontSize: 17 }),
    ...rect('done-card-1', 544, 64, 172, 56, '代码块渲染', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
  ])
}

function createDatabaseReplication() {
  return doc([
    ...text('title', 0, -80, '数据库复制：主从、读写路径', { fontSize: 28, width: 700 }),
    ...rect('app', 0, 95, 140, 64, 'App', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('primary', 240, 70, 160, 90, 'Primary DB\nwrites', { fill: '#dbe4ff', stroke: '#364fc7', fontSize: 18 }),
    ...rect('replica-a', 520, 0, 160, 70, 'Replica A', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('replica-b', 520, 105, 160, 70, 'Replica B', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('analytics', 520, 210, 160, 70, 'Analytics', { fill: '#fff3bf', stroke: '#e67700' }),
    arrow('db-write', 140, 127, 100, -12, { strokeWidth: 3 }),
    arrow('db-rep-a', 400, 95, 120, -60, { strokeStyle: 'dashed' }),
    arrow('db-rep-b', 400, 115, 120, 25, { strokeStyle: 'dashed' }),
    arrow('db-rep-c', 400, 135, 120, 110, { strokeStyle: 'dashed' }),
  ])
}

function createEventSourcing() {
  return doc([
    ...text('title', 0, -80, '事件溯源：Command / Event Store / Projections', { fontSize: 28, width: 820 }),
    ...rect('cmd', 0, 80, 150, 64, 'Command', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('aggregate', 230, 80, 150, 64, 'Aggregate', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('event-store', 460, 80, 170, 64, 'Event Store', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('projection-a', 720, 20, 150, 58, 'Read Model A', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('projection-b', 720, 132, 150, 58, 'Read Model B', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    arrow('es-a', 150, 112, 80, 0),
    arrow('es-b', 380, 112, 80, 0),
    arrow('es-c', 630, 100, 90, -50, { strokeStyle: 'dashed' }),
    arrow('es-d', 630, 124, 90, 38, { strokeStyle: 'dashed' }),
  ])
}

function createDenseAnnotations() {
  return doc([
    ...text('title', 0, -80, '注释密集：便签、锁定、链接字段', { fontSize: 28, width: 720 }),
    ...rect('core', 260, 90, 160, 72, '核心节点', { fill: '#e5dbff', stroke: '#6741d9', locked: true }),
    ...rect('note-a', 0, 20, 190, 80, '风险：输入过大', { fill: '#fff9db', stroke: '#f08c00', fontSize: 17 }),
    ...rect('note-b', 0, 160, 190, 80, '处理：降级错误', { fill: '#fff9db', stroke: '#f08c00', fontSize: 17 }),
    ...rect('note-c', 500, 20, 220, 80, '链接字段会被 SVG 清理检查', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 16, link: 'https://example.invalid' }),
    ...rect('note-d', 500, 160, 220, 80, '源码视图仍可查看原 JSON', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 16 }),
    arrow('ann-a', 190, 60, 70, 66, { strokeStyle: 'dashed' }),
    arrow('ann-b', 190, 200, 70, -74, { strokeStyle: 'dashed' }),
    arrow('ann-c', 420, 126, 80, -66, { strokeStyle: 'dashed' }),
    arrow('ann-d', 420, 126, 80, 74, { strokeStyle: 'dashed' }),
  ])
}

function createTinyElements() {
  const elements = [
    ...text('title', 0, -80, '小元素网格：极小尺寸仍应保留 viewBox', { fontSize: 28, width: 760 }),
  ]
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const id = `tiny-${row}-${col}`
      elements.push(base(id, 'rectangle', col * 42, row * 32, 22, 14, {
        strokeColor: row % 2 === 0 ? '#1971c2' : '#2b8a3e',
        backgroundColor: col % 2 === 0 ? '#e7f5ff' : '#d3f9d8',
        strokeWidth: 1,
        roundness: { type: 3 },
      }))
    }
  }
  return doc(elements)
}

function createTallFlow() {
  const elements = [
    ...text('title', 0, -90, '纵向长流程：高 viewBox 和滚动区域', { fontSize: 28, width: 660 }),
  ]
  const labels = ['入口', '校验', '解析', '加载资源', '布局', '导出 SVG', '清理 SVG', '挂载 DOM', '工具栏', '完成']
  labels.forEach((label, index) => {
    const y = index * 105
    elements.push(...rect(`tall-${index}`, 0, y, 180, 58, label, {
      fill: index % 2 === 0 ? '#e7f5ff' : '#d3f9d8',
      stroke: index % 2 === 0 ? '#1971c2' : '#2b8a3e',
      fontSize: 18,
    }))
    if (index < labels.length - 1) {
      elements.push(arrow(`tall-a-${index}`, 90, y + 58, 0, 47))
    }
  })
  return doc(elements)
}

function createWideCanvas() {
  return doc([
    ...text('title', 0, -80, '横向宽画布：适配容器宽度', { fontSize: 28, width: 700 }),
    ...rect('wide-a', 0, 40, 160, 64, 'West', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('wide-b', 420, 40, 160, 64, 'Center', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('wide-c', 840, 40, 160, 64, 'East', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('wide-d', 1260, 40, 160, 64, 'Far Edge', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    arrow('wide-a-b', 160, 72, 260, 0),
    arrow('wide-b-c', 580, 72, 260, 0),
    arrow('wide-c-d', 1000, 72, 260, 0),
  ])
}

function createGroupedElements() {
  const groupA = 'group-a'
  const groupB = 'group-b'
  return doc([
    ...text('title', 0, -80, '分组元素：groupIds 覆盖', { fontSize: 28, width: 620 }),
    ...rect('group-a-box', 0, 40, 260, 120, null, { fill: '#e7f5ff', stroke: '#1971c2', groupIds: [groupA] }),
    text('group-a-text', 38, 78, 'Group A\n整体移动语义', { fontSize: 22, width: 184, align: 'center', groupIds: [groupA] }),
    ...rect('group-b-box', 390, 40, 260, 120, null, { fill: '#d3f9d8', stroke: '#2b8a3e', groupIds: [groupB] }),
    text('group-b-text', 428, 78, 'Group B\n渲染保持独立', { fontSize: 22, width: 184, align: 'center', groupIds: [groupB] }),
    arrow('group-arrow', 260, 100, 130, 0),
  ])
}

function createPlantUMLSequenceAdvanced() {
  const participants = [
    ['user', 'User', 0, '#e7f5ff', '#1971c2'],
    ['frontend', 'Frontend\nReact App', 220, '#d3f9d8', '#2b8a3e'],
    ['backend', 'Backend\nElectron Main', 470, '#fff3bf', '#e67700'],
    ['fs', 'File System', 720, '#f1f3f5', '#495057'],
  ]
  const elements = []
  participants.forEach(([id, label, x, fill, stroke]) => {
    elements.push(...rect(`${id}-head`, x, 0, 150, 58, label, { fill, stroke, fontSize: 17 }))
    elements.push(line(`${id}-life`, x + 75, 58, 0, 430, { stroke: '#adb5bd', strokeStyle: 'dashed' }))
  })
  elements.push(
    ...rect('frontend-activation', 287, 92, 16, 296, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    ...rect('backend-activation', 537, 142, 16, 120, null, { fill: '#fff3bf', stroke: '#e67700', round: false }),
    ...rect('fs-activation', 787, 186, 16, 64, null, { fill: '#f1f3f5', stroke: '#495057', round: false }),
    arrow('seq-open', 75, 108, 212, 0),
    text('seq-open-label', 120, 82, '打开 Markdown 文件', { fontSize: 15, width: 170 }),
    arrow('seq-ipc', 303, 158, 234, 0),
    text('seq-ipc-label', 344, 132, 'IPC: readFile(path)', { fontSize: 15, width: 160 }),
    arrow('seq-fs', 553, 202, 234, 0),
    text('seq-fs-label', 612, 176, 'fs.readFile()', { fontSize: 15, width: 120 }),
    arrow('seq-fs-return', 787, 244, -234, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    text('seq-fs-return-label', 620, 252, 'fileContent', { fontSize: 15, width: 120 }),
    arrow('seq-ipc-return', 537, 284, -234, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    text('seq-ipc-return-label', 356, 292, 'markdown content', { fontSize: 15, width: 150 }),
    ...groupBox('render-group', 210, 320, 430, 142, '渲染流程', { fill: '#f8f9fa', stroke: '#868e96' }),
    arrow('seq-self-1', 303, 370, 96, 0, { endArrowhead: 'bar' }),
    text('seq-self-1-label', 420, 348, 'markdown-it 解析', { fontSize: 15, width: 150 }),
    arrow('seq-self-2', 303, 414, 96, 0, { endArrowhead: 'bar' }),
    text('seq-self-2-label', 420, 392, '图表渲染', { fontSize: 15, width: 120 }),
    ...rect('seq-note', 650, 342, 230, 74, 'note right of Frontend\n文件变更自动刷新', { fill: '#fff9db', stroke: '#f08c00', fontSize: 16 }),
    arrow('seq-show', 287, 468, -212, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    text('seq-show-label', 130, 476, '显示预览', { fontSize: 15, width: 100 })
  )
  return doc(elements)
}

function createPlantUMLClassRenderers() {
  const elements = [
    ...rect('renderable', 0, 20, 230, 128, null, { fill: '#f8f9fa', stroke: '#495057', round: false }),
    text('renderable-title', 18, 34, '<<interface>>\nRenderable<T>', { fontSize: 20, width: 194, align: 'center' }),
    line('renderable-sep', 0, 92, 230, 0),
    text('renderable-methods', 18, 104, '+ render(data: T): string\n+ validate(data: T): boolean', { fontSize: 14, width: 196 }),
    ...rect('base-renderer', 330, 0, 250, 182, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false }),
    text('base-title', 350, 16, '<<abstract>>\nBaseRenderer', { fontSize: 20, width: 210, align: 'center' }),
    line('base-sep-1', 330, 76, 250, 0, { stroke: '#1971c2' }),
    text('base-fields', 350, 88, '# cache: Map<string,string>', { fontSize: 14, width: 210 }),
    line('base-sep-2', 330, 120, 250, 0, { stroke: '#1971c2' }),
    text('base-methods', 350, 132, '+ render(code): Promise<string>\n# getCacheKey(code): string', { fontSize: 14, width: 210 }),
    ...rect('mermaid', 720, -30, 230, 92, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    text('mermaid-title', 740, -14, 'MermaidRenderer', { fontSize: 19, width: 190, align: 'center' }),
    line('mermaid-sep', 720, 24, 230, 0, { stroke: '#2b8a3e' }),
    text('mermaid-methods', 740, 38, '+ render(code)', { fontSize: 14, width: 190 }),
    ...rect('echarts', 720, 96, 230, 112, null, { fill: '#fff3bf', stroke: '#e67700', round: false }),
    text('echarts-title', 740, 112, 'EChartsRenderer', { fontSize: 19, width: 190, align: 'center' }),
    line('echarts-sep', 720, 150, 230, 0, { stroke: '#e67700' }),
    text('echarts-methods', 740, 164, '- options\n+ setTheme(theme)', { fontSize: 14, width: 190 }),
    ...rect('plantuml', 720, 246, 250, 132, null, { fill: '#ffe3e3', stroke: '#c92a2a', round: false }),
    text('plantuml-title', 740, 262, 'PlantUMLRenderer', { fontSize: 19, width: 210, align: 'center' }),
    line('plantuml-sep', 720, 300, 250, 0, { stroke: '#c92a2a' }),
    text('plantuml-methods', 740, 314, '- serverUrl\n- timeout\n- encode(code)', { fontSize: 14, width: 210 }),
    arrow('class-realize', 230, 84, 100, 0, { strokeStyle: 'dashed', endArrowhead: 'triangle_outline' }),
    arrow('class-mermaid', 580, 72, 140, -52, { endArrowhead: 'triangle_outline' }),
    arrow('class-echarts', 580, 92, 140, 60, { endArrowhead: 'triangle_outline' }),
    arrow('class-plantuml', 580, 112, 140, 200, { endArrowhead: 'triangle_outline' }),
    ...rect('class-note', 330, 230, 300, 80, 'note bottom of PlantUMLRenderer\n唯一需要网络的渲染器', { fill: '#fff9db', stroke: '#f08c00', fontSize: 16 })
  ]
  return doc(elements)
}

function createPlantUMLUseCase() {
  return doc([
    ...ellipse('actor-user-head', 0, 42, 42, 42, '', { fill: '#ffffff', stroke: '#1e1e1e' }),
    line('actor-user-body', 21, 84, 0, 72),
    line('actor-user-arms', -10, 112, 62, 0),
    line('actor-user-left-leg', 21, 156, -28, 48),
    line('actor-user-right-leg', 21, 156, 28, 48),
    text('actor-user-label', -30, 216, 'User', { fontSize: 18, width: 100, align: 'center' }),
    ...ellipse('actor-admin-head', 820, 42, 42, 42, '', { fill: '#ffffff', stroke: '#1e1e1e' }),
    line('actor-admin-body', 841, 84, 0, 72),
    line('actor-admin-arms', 810, 112, 62, 0),
    line('actor-admin-left-leg', 841, 156, -28, 48),
    line('actor-admin-right-leg', 841, 156, 28, 48),
    text('actor-admin-label', 790, 216, 'Admin', { fontSize: 18, width: 100, align: 'center' }),
    ...groupBox('system', 170, 0, 560, 270, 'MD Viewer', { fill: '#f8f9fa', stroke: '#868e96' }),
    ...ellipse('open-file', 235, 52, 150, 56, '打开文件', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...ellipse('preview', 490, 52, 170, 56, '预览 Markdown', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
    ...ellipse('export-pdf', 235, 158, 150, 56, '导出 PDF', { fill: '#fff3bf', stroke: '#e67700', fontSize: 18 }),
    ...ellipse('settings', 490, 158, 170, 56, '管理设置', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 18 }),
    ...ellipse('render-chart', 360, 235, 170, 56, '渲染图表', { fill: '#e5dbff', stroke: '#6741d9', fontSize: 18 }),
    line('uc-user-open', 42, 120, 193, -40),
    line('uc-user-preview', 42, 120, 448, -40),
    line('uc-user-export', 42, 120, 193, 66),
    line('uc-admin-settings', 820, 120, -160, 66),
    arrow('uc-include', 310, 214, 135, 40, { strokeStyle: 'dashed' }),
    text('uc-include-label', 380, 220, 'include', { fontSize: 14, width: 80, color: '#6741d9' })
  ])
}

function createPlantUMLComponentPackages() {
  return doc([
    ...groupBox('frontend-package', -20, 0, 430, 310, '前端', { fill: '#f8f9fa', stroke: '#1971c2' }),
    ...rect('react-app', 30, 64, 160, 56, 'React App', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('md-renderer', 230, 28, 150, 56, 'Markdown\nRenderer', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
    ...rect('chart-renderers', 230, 120, 150, 56, 'Chart\nRenderers', { fill: '#fff3bf', stroke: '#e67700', fontSize: 17 }),
    ...rect('plantuml-renderer', 70, 218, 150, 56, 'PlantUML\nRenderer', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 17 }),
    ...rect('mermaid-renderer', 250, 218, 140, 56, 'Mermaid\nRenderer', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
    ...groupBox('backend-package', 500, 0, 340, 230, '后端', { fill: '#f8f9fa', stroke: '#d9480f' }),
    ...rect('electron-main', 550, 64, 150, 56, 'Electron Main', { fill: '#ffe8cc', stroke: '#d9480f' }),
    ...rect('file-system', 550, 148, 150, 56, 'File System', { fill: '#f1f3f5', stroke: '#495057' }),
    ...rect('export-engine', 720, 106, 96, 56, 'Export\nEngine', { fill: '#e5dbff', stroke: '#6741d9', fontSize: 16 }),
    arrow('cmp-a', 190, 92, 40, -36),
    arrow('cmp-b', 190, 92, 40, 56),
    arrow('cmp-c', 305, 176, -150, 42),
    arrow('cmp-d', 305, 176, 15, 42),
    arrow('cmp-ipc', 410, 92, 140, 0, { strokeStyle: 'dashed' }),
    text('cmp-ipc-label', 440, 62, 'IPC', { fontSize: 15, width: 80 }),
    arrow('cmp-fs', 625, 120, 0, 28),
    arrow('cmp-export', 700, 92, 45, 28)
  ])
}

function createPlantUMLObjectGraph() {
  return doc([
    ...rect('app-object', 0, 20, 230, 140, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false }),
    text('app-object-title', 20, 34, 'App.tsx', { fontSize: 21, width: 190, align: 'center' }),
    line('app-object-sep', 0, 72, 230, 0, { stroke: '#1971c2' }),
    text('app-object-fields', 20, 88, 'state = "loaded"\ntheme = "dark"\nfontSize = 16', { fontSize: 16, width: 190 }),
    ...rect('vm-object', 320, 20, 250, 140, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    text('vm-object-title', 340, 34, 'VirtualizedMarkdown', { fontSize: 21, width: 210, align: 'center' }),
    line('vm-object-sep', 320, 72, 250, 0, { stroke: '#2b8a3e' }),
    text('vm-object-fields', 340, 88, 'content = "# Hello"\nisRendering = false', { fontSize: 16, width: 210 }),
    ...rect('pr-object', 660, 20, 250, 140, null, { fill: '#ffe3e3', stroke: '#c92a2a', round: false }),
    text('pr-object-title', 680, 34, 'PlantUMLRenderer', { fontSize: 21, width: 210, align: 'center' }),
    line('pr-object-sep', 660, 72, 250, 0, { stroke: '#c92a2a' }),
    text('pr-object-fields', 680, 88, 'serverUrl = "https://..."\ncache = "Map(3)"\ntimeout = 8000', { fontSize: 16, width: 210 }),
    arrow('obj-contains', 230, 90, 90, 0, { endArrowhead: 'diamond' }),
    text('obj-contains-label', 246, 62, 'contains', { fontSize: 15, width: 80 }),
    arrow('obj-uses', 570, 90, 90, 0),
    text('obj-uses-label', 596, 62, 'uses', { fontSize: 15, width: 60 })
  ])
}

function createPlantUMLDeployment() {
  return doc([
    ...groupBox('user-computer', -20, 0, 610, 330, '用户电脑', { fill: '#f8f9fa', stroke: '#1971c2' }),
    ...groupBox('app-artifact', 30, 58, 500, 170, 'MD Viewer.app', { fill: '#ffffff', stroke: '#868e96' }),
    ...rect('main-process', 62, 120, 130, 58, 'Main\nProcess', { fill: '#fff3bf', stroke: '#e67700', fontSize: 17 }),
    ...rect('renderer-process', 222, 120, 130, 58, 'Renderer\nProcess', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 17 }),
    ...rect('preload-script', 382, 120, 120, 58, 'Preload\nScript', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 17 }),
    ...rect('app-data', 62, 258, 150, 58, 'AppData', { fill: '#dbe4ff', stroke: '#364fc7' }),
    ...groupBox('internet-cloud', 690, 36, 310, 210, 'Internet', { fill: '#f8f9fa', stroke: '#6741d9' }),
    ...rect('plantuml-server', 760, 120, 170, 64, 'PlantUML\nServer', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 18 }),
    arrow('dep-main-data', 127, 178, 10, 80),
    arrow('dep-render-preload', 352, 149, 30, 0),
    arrow('dep-preload-main', 382, 160, -190, 0, { strokeStyle: 'dashed' }),
    arrow('dep-http', 352, 120, 408, 32, { strokeStyle: 'dashed' }),
    text('dep-http-label', 520, 92, 'HTTP GET/POST', { fontSize: 15, width: 120 })
  ])
}

function createPlantUMLTimingDiagram() {
  const rows = [
    ['watch', '文件监听', 0, '#e7f5ff', '#1971c2'],
    ['render', '渲染引擎', 90, '#d3f9d8', '#2b8a3e'],
    ['ui', 'UI 状态', 180, '#fff3bf', '#e67700'],
  ]
  const elements = [
    line('timing-axis', 160, 280, 680, 0, { stroke: '#495057', strokeWidth: 3 }),
  ]
  rows.forEach(([id, label, y, fill, stroke]) => {
    elements.push(...rect(`${id}-label`, 0, y + 20, 130, 46, label, { fill, stroke, fontSize: 17 }))
    elements.push(line(`${id}-base`, 160, y + 44, 680, 0, { stroke: '#dee2e6' }))
  })
  ;[
    ['t0', '0', 160],
    ['t100', '100', 270],
    ['t200', '200', 380],
    ['t500', '500', 600],
    ['t700', '700', 760],
  ].forEach(([id, label, x]) => {
    elements.push(line(id, x, 12, 0, 268, { stroke: '#e9ecef' }))
    elements.push(text(`${id}-label`, x - 20, 292, label, { fontSize: 14, width: 55, align: 'center', color: '#495057' }))
  })
  elements.push(
    polyArrow('watch-state', 160, 44, [[0, 0], [110, 0], [110, -24], [220, -24], [220, 0], [440, 0], [440, -24], [600, -24], [600, 0], [680, 0]], { stroke: '#1971c2', endArrowhead: null }),
    polyArrow('render-state', 160, 134, [[0, 0], [220, 0], [220, -24], [440, -24], [440, 0], [600, 0], [600, -24], [680, -24]], { stroke: '#2b8a3e', endArrowhead: null }),
    polyArrow('ui-state', 160, 224, [[0, 0], [220, 0], [220, -24], [440, -24], [440, 0], [600, 0], [600, -24], [680, -24]], { stroke: '#e67700', endArrowhead: null }),
    text('watch-note', 272, -4, '检测到变更', { fontSize: 14, width: 110 }),
    text('render-note', 402, 82, 'Rendering', { fontSize: 14, width: 100 }),
    text('ui-note', 402, 172, 'Loading', { fontSize: 14, width: 90 })
  )
  return doc(elements)
}

function createPlantUMLGanttPlan() {
  const tasks = [
    ['renderer', 'plantumlRenderer.ts', 0, 2, '#e7f5ff', '#1971c2'],
    ['markdown', 'markdownRenderer 修改', 2, 1, '#d3f9d8', '#2b8a3e'],
    ['css', 'CSS 样式', 3, 1, '#fff3bf', '#e67700'],
    ['virtualized', 'VirtualizedMarkdown 集成', 2, 2, '#e5dbff', '#6741d9'],
    ['tests', '测试编写', 4, 2, '#ffe3e3', '#c92a2a'],
    ['poc', 'DOCX POC 脚本', 4, 1, '#f1f3f5', '#495057'],
    ['decision', '评估决策', 5, 1, '#ffe8cc', '#d9480f'],
  ]
  const elements = [
    ...rect('gantt-header', 180, 0, 660, 44, 'MD Viewer v1.5.5 开发计划', { fill: '#f8f9fa', stroke: '#868e96', fontSize: 18 }),
  ]
  for (let day = 0; day <= 6; day += 1) {
    elements.push(line(`gantt-day-${day}`, 180 + day * 110, 44, 0, 360, { stroke: '#e9ecef' }))
    if (day < 6) {
      elements.push(text(`gantt-day-${day}-label`, 205 + day * 110, 54, `Day ${day + 1}`, { fontSize: 14, width: 70, align: 'center' }))
    }
  }
  tasks.forEach(([id, label, start, duration, fill, stroke], index) => {
    const y = 95 + index * 42
    elements.push(text(`${id}-label`, 0, y + 8, label, { fontSize: 15, width: 165 }))
    elements.push(...rect(`${id}-bar`, 180 + start * 110, y, duration * 110 - 12, 28, '', { fill, stroke, fontSize: 1 }))
  })
  return doc(elements)
}

function createPlantUMLWBS() {
  return doc([
    ...rect('wbs-root', 320, 0, 170, 58, 'PlantUML 集成', { fill: '#e5dbff', stroke: '#6741d9', fontSize: 18 }),
    ...rect('wbs-core', 0, 130, 160, 54, '核心渲染', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...rect('wbs-detect', 210, 130, 160, 54, '代码块检测', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 18 }),
    ...rect('wbs-ui', 420, 130, 160, 54, 'UI 集成', { fill: '#fff3bf', stroke: '#e67700', fontSize: 18 }),
    ...rect('wbs-tests', 630, 130, 160, 54, '测试', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 18 }),
    ...rect('wbs-core-a', 0, 235, 160, 48, 'renderer.ts', { fill: '#f8f9fa', stroke: '#1971c2', fontSize: 16 }),
    ...rect('wbs-core-b', 0, 302, 160, 48, 'SVG 缓存', { fill: '#f8f9fa', stroke: '#1971c2', fontSize: 16 }),
    ...rect('wbs-ui-a', 420, 235, 160, 48, '工具栏', { fill: '#f8f9fa', stroke: '#e67700', fontSize: 16 }),
    ...rect('wbs-test-a', 630, 235, 160, 48, 'E2E fixture', { fill: '#f8f9fa', stroke: '#c92a2a', fontSize: 16 }),
    arrow('wbs-a', 405, 58, -325, 72),
    arrow('wbs-b', 405, 58, -115, 72),
    arrow('wbs-c', 405, 58, 95, 72),
    arrow('wbs-d', 405, 58, 305, 72),
    arrow('wbs-e', 80, 184, 0, 51),
    arrow('wbs-f', 80, 184, 0, 118),
    arrow('wbs-g', 500, 184, 0, 51),
    arrow('wbs-h', 710, 184, 0, 51)
  ])
}

function createPlantUMLConfigData() {
  return doc([
    ...rect('json-panel', 0, 0, 380, 320, null, { fill: '#f8f9fa', stroke: '#1971c2', round: false }),
    text('json-title', 20, 18, 'JSON', { fontSize: 22, width: 340, align: 'center', color: '#1971c2' }),
    line('json-sep', 0, 60, 380, 0, { stroke: '#1971c2' }),
    text('json-content', 24, 82, '{\n  "app": "MD Viewer",\n  "version": "1.5.5",\n  "charts": [\n    "Mermaid",\n    "PlantUML",\n    "Graphviz",\n    "DrawIO"\n  ],\n  "theme": "auto"\n}', { fontSize: 16, width: 320 }),
    ...rect('yaml-panel', 460, 0, 380, 320, null, { fill: '#f8f9fa', stroke: '#2b8a3e', round: false }),
    text('yaml-title', 480, 18, 'YAML', { fontSize: 22, width: 340, align: 'center', color: '#2b8a3e' }),
    line('yaml-sep', 460, 60, 380, 0, { stroke: '#2b8a3e' }),
    text('yaml-content', 484, 82, 'app: MD Viewer\nversion: "1.5.5"\nelectron: 39\nfeatures:\n  - markdown_preview\n  - chart_rendering\n  - export_pdf\ncharts:\n  plantuml: remote\n  excalidraw: local', { fontSize: 16, width: 320 }),
    arrow('config-compare', 380, 160, 80, 0, { strokeStyle: 'dashed' })
  ])
}

function createPlantUMLSaltWireframe() {
  return doc([
    ...rect('dialog', 0, 0, 560, 430, null, { fill: '#ffffff', stroke: '#495057', round: true }),
    ...rect('tab-active', 20, 20, 120, 42, '通用', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 18 }),
    ...rect('tab-about', 140, 20, 120, 42, '关于', { fill: '#f1f3f5', stroke: '#adb5bd', fontSize: 18 }),
    text('salt-theme-label', 40, 96, '主题:', { fontSize: 18, width: 100 }),
    ...rect('salt-theme-select', 190, 88, 210, 40, '自动', { fill: '#f8f9fa', stroke: '#868e96', fontSize: 17 }),
    text('salt-font-label', 40, 150, '字体大小:', { fontSize: 18, width: 120 }),
    ...rect('salt-font-input', 190, 142, 210, 40, '16', { fill: '#ffffff', stroke: '#868e96', fontSize: 17 }),
    text('salt-server-label', 40, 204, 'PlantUML 服务器:', { fontSize: 18, width: 150 }),
    ...rect('salt-server-input', 190, 196, 300, 40, 'https://plantuml.com/...', { fill: '#ffffff', stroke: '#868e96', fontSize: 15 }),
    ...rect('salt-test-button', 390, 250, 100, 40, '测试连接', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 16 }),
    text('salt-checks', 40, 260, '[x] 启用文件监听\n[ ] 启用自动保存\n[x] 显示行号', { fontSize: 18, width: 240 }),
    line('salt-footer-line', 0, 348, 560, 0, { stroke: '#dee2e6' }),
    ...rect('salt-ok', 300, 366, 100, 40, '确定', { fill: '#d3f9d8', stroke: '#2b8a3e', fontSize: 18 }),
    ...rect('salt-cancel', 420, 366, 100, 40, '取消', { fill: '#f1f3f5', stroke: '#868e96', fontSize: 18 })
  ])
}

function createPlantUMLCreoleNote() {
  return doc([
    ...rect('note-panel', 0, 0, 700, 430, null, { fill: '#fff9db', stroke: '#f08c00', round: true }),
    text('note-heading', 28, 24, '标题级别 1\n标题级别 2\n标题级别 3', { fontSize: 24, width: 300 }),
    text('note-style', 360, 32, '粗体文本 / 斜体文本 / 下划线\n删除线 / 等宽字体\n红色文本 / 黄色背景 / 大号文本', { fontSize: 18, width: 300 }),
    line('note-sep-a', 24, 138, 652, 0, { stroke: '#f08c00' }),
    text('note-list', 32, 166, '* 无序列表项 1\n* 无序列表项 2\n  * 嵌套项 2.1\n# 有序列表项 1\n# 有序列表项 2', { fontSize: 18, width: 280 }),
    ...rect('note-table', 360, 158, 290, 130, null, { fill: '#ffffff', stroke: '#f08c00', round: false }),
    line('note-table-row-1', 360, 198, 290, 0, { stroke: '#f08c00' }),
    line('note-table-row-2', 360, 238, 290, 0, { stroke: '#f08c00' }),
    line('note-table-col-1', 456, 158, 0, 130, { stroke: '#f08c00' }),
    line('note-table-col-2', 552, 158, 0, 130, { stroke: '#f08c00' }),
    text('note-table-text', 376, 172, '表头1     表头2     表头3\n单元格1   单元格2   单元格3\nA         B         C', { fontSize: 15, width: 258 }),
    line('note-sep-b', 24, 320, 652, 0, { stroke: '#f08c00' }),
    ...rect('note-color-red', 32, 346, 140, 42, '红色文本', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 18 }),
    ...rect('note-color-yellow', 208, 346, 160, 42, '黄色背景', { fill: '#fff3bf', stroke: '#e67700', fontSize: 18 }),
    ...rect('note-color-large', 404, 338, 190, 58, '大号文本', { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 24 })
  ])
}

function createPlantUMLHyperlinks() {
  return doc([
    ...rect('controller', 0, 20, 230, 128, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false, link: 'https://example.com/docs/controller' }),
    text('controller-title', 20, 36, 'Controller', { fontSize: 22, width: 190, align: 'center' }),
    line('controller-sep', 0, 78, 230, 0, { stroke: '#1971c2' }),
    text('controller-methods', 20, 96, '+ handle(): void', { fontSize: 16, width: 190 }),
    ...rect('service', 320, 20, 230, 128, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false, link: 'https://example.com/docs/service' }),
    text('service-title', 340, 36, 'Service', { fontSize: 22, width: 190, align: 'center' }),
    line('service-sep', 320, 78, 230, 0, { stroke: '#2b8a3e' }),
    text('service-methods', 340, 96, '+ process(): Result', { fontSize: 16, width: 190 }),
    ...rect('repository', 640, 20, 250, 148, null, { fill: '#fff3bf', stroke: '#e67700', round: false, link: 'https://example.com/docs/repo' }),
    text('repository-title', 660, 36, 'Repository', { fontSize: 22, width: 210, align: 'center' }),
    line('repository-sep', 640, 78, 250, 0, { stroke: '#e67700' }),
    text('repository-methods', 660, 96, '+ find(): Entity\n+ save(entity): void', { fontSize: 16, width: 210 }),
    arrow('link-a', 230, 84, 90, 0),
    arrow('link-b', 550, 84, 90, 0),
    ...rect('link-note', 0, 230, 360, 88, '点击类名可跳转到文档\nhttps://example.com', { fill: '#fff9db', stroke: '#f08c00', fontSize: 17, link: 'https://example.com' }),
    arrow('link-note-arrow', 180, 230, -40, -82, { strokeStyle: 'dashed' })
  ])
}

function createPlantUMLStereotypes() {
  return doc([
    ...rect('user-controller', 0, 20, 260, 180, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false }),
    text('user-controller-title', 20, 34, 'UserController\n<<Controller>> <<REST>>', { fontSize: 20, width: 220, align: 'center' }),
    line('user-controller-sep', 0, 92, 260, 0, { stroke: '#1971c2' }),
    text('user-controller-methods', 20, 108, '+ getUser(id): User\n+ createUser(data): User\n+ deleteUser(id): void', { fontSize: 15, width: 220 }),
    ...rect('user-service', 340, 20, 250, 162, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    text('user-service-title', 360, 34, 'UserService\n<<Service>>', { fontSize: 20, width: 210, align: 'center' }),
    line('user-service-sep', 340, 92, 250, 0, { stroke: '#2b8a3e' }),
    text('user-service-methods', 360, 108, '+ findById(id): User\n+ create(data): User\n+ delete(id): void', { fontSize: 15, width: 210 }),
    ...rect('user-repository', 670, 20, 280, 182, null, { fill: '#fff3bf', stroke: '#e67700', round: false }),
    text('user-repository-title', 690, 34, 'UserRepository\n<<Repository>> <<JPA>>', { fontSize: 20, width: 240, align: 'center' }),
    line('user-repository-sep', 670, 92, 280, 0, { stroke: '#e67700' }),
    text('user-repository-methods', 690, 108, '+ findById(id): Optional<User>\n+ save(user): User\n+ deleteById(id): void', { fontSize: 15, width: 240 }),
    arrow('stereo-a', 260, 105, 80, 0),
    arrow('stereo-b', 590, 105, 80, 0)
  ])
}

function createPlantUMLGradientLayers() {
  return doc([
    ...groupBox('input-layer', -20, 0, 230, 160, '输入层', { fill: '#e7f5ff', stroke: '#1971c2' }),
    ...rect('input-file', 25, 70, 150, 54, 'Markdown 文件', { fill: '#d0ebff', stroke: '#1971c2', fontSize: 17 }),
    ...groupBox('process-layer', 270, 0, 300, 230, '处理层', { fill: '#d3f9d8', stroke: '#2b8a3e' }),
    ...rect('parse', 312, 60, 200, 48, 'markdown-it 解析', { fill: '#d8f5a2', stroke: '#2b8a3e', fontSize: 17 }),
    ...rect('highlight', 312, 124, 200, 48, '代码高亮', { fill: '#d8f5a2', stroke: '#2b8a3e', fontSize: 17 }),
    ...rect('detect', 312, 188, 200, 48, '图表检测', { fill: '#d8f5a2', stroke: '#2b8a3e', fontSize: 17 }),
    ...groupBox('render-layer', 650, 0, 350, 300, '渲染层', { fill: '#fff3bf', stroke: '#e67700' }),
    ...rect('mermaid-layer', 700, 54, 120, 44, 'Mermaid', { fill: '#fff9db', stroke: '#e67700', fontSize: 16 }),
    ...rect('echarts-layer', 840, 54, 120, 44, 'ECharts', { fill: '#fff9db', stroke: '#e67700', fontSize: 16 }),
    ...rect('plantuml-layer', 700, 122, 120, 44, 'PlantUML', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 16 }),
    ...rect('graphviz-layer', 840, 122, 120, 44, 'Graphviz', { fill: '#fff9db', stroke: '#e67700', fontSize: 16 }),
    ...rect('drawio-layer', 770, 190, 120, 44, 'DrawIO', { fill: '#fff9db', stroke: '#e67700', fontSize: 16 }),
    ...groupBox('output-layer', 1080, 0, 260, 230, '输出层', { fill: '#ffe3e3', stroke: '#c92a2a' }),
    ...rect('out-preview', 1125, 60, 170, 46, 'HTML 预览', { fill: '#fff5f5', stroke: '#c92a2a', fontSize: 16 }),
    ...rect('out-pdf', 1125, 126, 170, 46, 'PDF 导出', { fill: '#fff5f5', stroke: '#c92a2a', fontSize: 16 }),
    ...rect('out-html', 1125, 192, 170, 46, 'HTML 导出', { fill: '#fff5f5', stroke: '#c92a2a', fontSize: 16 }),
    arrow('grad-a', 175, 97, 137, -13),
    arrow('grad-b', 512, 212, 188, -136),
    arrow('grad-c', 512, 212, 188, -68),
    arrow('grad-d', 512, 212, 188, -24, { stroke: '#c92a2a' }),
    arrow('grad-e', 960, 144, 165, -61),
    arrow('grad-f', 1210, 106, 0, 20),
    arrow('grad-g', 1210, 172, 0, 20),
    ...rect('grad-legend', 1080, 270, 260, 74, '图例：粉色 = 需要网络\n绿色 = 本地处理', { fill: '#ffffff', stroke: '#868e96', fontSize: 16 })
  ])
}

function createPlantUMLExportSequence() {
  const actors = [
    ['user', 'User', 0],
    ['app', 'App.tsx', 210],
    ['engine', 'ExportEngine', 430],
    ['plantuml', 'PlantUMLRenderer', 680],
    ['fs', 'FileSystem', 950],
  ]
  const elements = []
  actors.forEach(([id, label, x]) => {
    elements.push(...rect(`${id}-head`, x, 0, 150, 54, label, { fill: '#e7f5ff', stroke: '#1971c2', fontSize: 17 }))
    elements.push(line(`${id}-life`, x + 75, 54, 0, 610, { stroke: '#adb5bd', strokeStyle: 'dashed' }))
  })
  elements.push(
    ...rect('app-active', 278, 82, 16, 500, null, { fill: '#e7f5ff', stroke: '#1971c2', round: false }),
    ...rect('plantuml-loop', 748, 322, 16, 70, null, { fill: '#ffe3e3', stroke: '#c92a2a', round: false }),
    ...rect('engine-active', 498, 440, 16, 96, null, { fill: '#d3f9d8', stroke: '#2b8a3e', round: false }),
    arrow('export-start', 75, 98, 203, 0),
    text('export-start-label', 112, 72, '点击导出 HTML', { fontSize: 15, width: 140 }),
    arrow('export-clone', 294, 146, 95, 0, { endArrowhead: 'bar' }),
    text('export-clone-label', 310, 120, '克隆 DOM', { fontSize: 15, width: 90 }),
    ...groupBox('export-ref', 230, 182, 650, 74, 'ref over App, PlantUMLRenderer：图表渲染流程', { fill: '#f8f9fa', stroke: '#868e96' }),
    ...groupBox('export-loop', 228, 272, 650, 140, 'loop 每个 PlantUML 代码块', { fill: '#f8f9fa', stroke: '#6741d9' }),
    arrow('export-call', 294, 324, 454, 0),
    text('export-call-label', 390, 298, 'processPlantUMLInHtml(html)', { fontSize: 15, width: 230 }),
    ...groupBox('export-alt', 520, 348, 320, 104, 'alt 缓存 / 网络 / 超时', { fill: '#ffffff', stroke: '#c92a2a' }),
    text('export-alt-text', 540, 378, '缓存命中 -> SVG\n超时 -> 错误提示\n网络错误 -> 降级代码块', { fontSize: 15, width: 260 }),
    arrow('export-generate', 294, 474, 204, 0),
    text('export-generate-label', 330, 448, 'generateHTML(content)', { fontSize: 15, width: 190 }),
    arrow('export-write', 514, 506, 511, 0),
    text('export-write-label', 660, 480, 'writeFile(path, html)', { fontSize: 15, width: 180 }),
    arrow('export-done-engine', 1025, 530, -511, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    arrow('export-done-app', 498, 558, -204, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    arrow('export-done-user', 278, 596, -203, 0, { strokeStyle: 'dashed', startArrowhead: 'arrow', endArrowhead: null }),
    text('export-done-label', 112, 604, '导出完成通知', { fontSize: 15, width: 130 }),
    ...rect('export-break', 0, 644, 360, 58, 'break：用户取消 -> 已取消', { fill: '#ffe3e3', stroke: '#c92a2a', fontSize: 17 })
  )
  return doc(elements)
}

function createArrayRootError() {
  return [
    { type: 'excalidraw', elements: [] },
  ]
}

function createTooManyElementsError() {
  return doc(Array.from({ length: 2001 }, (_, index) => ({
    id: `too-many-${index}`,
    type: 'rectangle',
  })))
}

const validFixtureCases = [
  { file: 'basic-flow.excalidraw', title: '基础文件引用', alt: '基础流程', data: createBasicFlow() },
  { file: 'sequence-flow.excalidraw', title: '带查询参数的文件引用', alt: '带查询参数', data: createSequenceFlow(), suffix: '?raw=1#demo' },
  { file: 'embedded-image.excalidraw', title: '内嵌图片资源', alt: '内嵌图片', data: createEmbeddedImage() },
  { file: 'missing-image.excalidraw', title: '缺失图片资源警告', alt: '缺失图片资源', data: createMissingImage() },
  { file: 'empty.excalidraw', title: '空画布警告', alt: '空画布', data: doc([]) },
  { file: 'gateway-fanout.excalidraw', title: 'MCP 风格：网关扇出', alt: '网关扇出', data: createGatewayFanout() },
  { file: 'ecommerce-platform.excalidraw', title: 'MCP 风格：电商平台架构', alt: '电商平台架构', data: createEcommercePlatform() },
  { file: 'payment-decision-flow.excalidraw', title: '支付决策流程', alt: '支付决策流程', data: createPaymentDecisionFlow() },
  { file: 'data-pipeline.excalidraw', title: '数据管道', alt: '数据管道', data: createDataPipeline() },
  { file: 'layered-architecture.excalidraw', title: '分层架构', alt: '分层架构', data: createLayeredArchitecture() },
  { file: 'hub-fanout.excalidraw', title: 'Hub 扇出', alt: 'Hub 扇出', data: createHubFanout() },
  { file: 'disconnected-monitoring.excalidraw', title: '断开子图', alt: '断开子图', data: createDisconnectedMonitoring() },
  { file: 'state-machine.excalidraw', title: '状态机', alt: '状态机', data: createStateMachine() },
  { file: 'decision-tree.excalidraw', title: '决策树', alt: '决策树', data: createDecisionTree() },
  { file: 'shapes-gallery.excalidraw', title: '形状库', alt: '形状库', data: createShapesGallery() },
  { file: 'style-gallery.excalidraw', title: '样式库', alt: '样式库', data: createStyleGallery() },
  { file: 'text-unicode.excalidraw', title: 'Unicode 与长文本', alt: 'Unicode 与长文本', data: createTextUnicode() },
  { file: 'negative-coordinates.excalidraw', title: '负坐标', alt: '负坐标', data: createNegativeCoordinates() },
  { file: 'rotated-elements.excalidraw', title: '旋转元素', alt: '旋转元素', data: createRotatedElements() },
  { file: 'deleted-elements.excalidraw', title: '删除元素', alt: '删除元素', data: createDeletedElements() },
  { file: 'large-balanced-graph.excalidraw', title: '较大但均衡的架构图', alt: '较大但均衡', data: createLargeBalancedGraph() },
  { file: 'dark-background.excalidraw', title: '深色背景', alt: '深色背景', data: createDarkBackground() },
  { file: 'compatible-no-type.excalidraw', title: '兼容模式警告', alt: '兼容模式', data: createCompatibleNoType() },
  { file: 'bound-text-containers.excalidraw', title: '绑定文本容器', alt: '绑定文本容器', data: createBoundTextContainers() },
  { file: 'arrow-bindings.excalidraw', title: '箭头绑定', alt: '箭头绑定', data: createArrowBindings() },
  { file: 'frame-layout.excalidraw', title: 'Frame 元素', alt: 'Frame 元素', data: createFrameLayout() },
  { file: 'freedraw-sketch.excalidraw', title: '自由绘制线条', alt: '自由绘制线条', data: createFreeDrawSketch() },
  { file: 'polyline-arrows.excalidraw', title: '多段箭头', alt: '多段箭头', data: createPolylineArrows() },
  { file: 'arrowhead-gallery.excalidraw', title: '箭头头部集合', alt: '箭头头部集合', data: createArrowheadGallery() },
  { file: 'mermaid-flowchart-shapes.excalidraw', title: 'Mermaid flowchart 形状', alt: 'Mermaid flowchart 形状', data: createMermaidFlowchartShapes() },
  { file: 'sequence-lifelines.excalidraw', title: 'Sequence 生命线', alt: 'Sequence 生命线', data: createSequenceLifelines() },
  { file: 'class-diagram.excalidraw', title: 'Class Diagram', alt: 'Class Diagram', data: createClassDiagram() },
  { file: 'er-diagram.excalidraw', title: 'ER Diagram', alt: 'ER Diagram', data: createERDiagram() },
  { file: 'state-composite.excalidraw', title: '复合状态图', alt: '复合状态图', data: createStateComposite() },
  { file: 'subgraph-clusters.excalidraw', title: 'Subgraph 集群', alt: 'Subgraph 集群', data: createSubgraphClusters() },
  { file: 'swimlane-process.excalidraw', title: '泳道流程', alt: '泳道流程', data: createSwimlaneProcess() },
  { file: 'timeline.excalidraw', title: '时间线', alt: '时间线', data: createTimeline() },
  { file: 'network-topology.excalidraw', title: '网络拓扑', alt: '网络拓扑', data: createNetworkTopology() },
  { file: 'mind-map.excalidraw', title: '思维导图', alt: '思维导图', data: createMindMap() },
  { file: 'kanban-board.excalidraw', title: '看板布局', alt: '看板布局', data: createKanbanBoard() },
  { file: 'database-replication.excalidraw', title: '数据库复制', alt: '数据库复制', data: createDatabaseReplication() },
  { file: 'event-sourcing.excalidraw', title: '事件溯源', alt: '事件溯源', data: createEventSourcing() },
  { file: 'dense-annotations.excalidraw', title: '密集注释', alt: '密集注释', data: createDenseAnnotations() },
  { file: 'tiny-elements.excalidraw', title: '小元素网格', alt: '小元素网格', data: createTinyElements() },
  { file: 'tall-flow.excalidraw', title: '纵向长流程', alt: '纵向长流程', data: createTallFlow() },
  { file: 'wide-canvas.excalidraw', title: '横向宽画布', alt: '横向宽画布', data: createWideCanvas() },
  { file: 'grouped-elements.excalidraw', title: '分组元素', alt: '分组元素', data: createGroupedElements() },
  { file: 'plantuml-sequence-advanced.excalidraw', title: 'PlantUML 迁移：高级序列图', alt: 'PlantUML 高级序列图', data: createPlantUMLSequenceAdvanced() },
  { file: 'plantuml-class-renderers.excalidraw', title: 'PlantUML 迁移：渲染器类图', alt: 'PlantUML 渲染器类图', data: createPlantUMLClassRenderers() },
  { file: 'plantuml-use-case.excalidraw', title: 'PlantUML 迁移：用例图', alt: 'PlantUML 用例图', data: createPlantUMLUseCase() },
  { file: 'plantuml-component-packages.excalidraw', title: 'PlantUML 迁移：组件图', alt: 'PlantUML 组件图', data: createPlantUMLComponentPackages() },
  { file: 'plantuml-object-graph.excalidraw', title: 'PlantUML 迁移：对象图', alt: 'PlantUML 对象图', data: createPlantUMLObjectGraph() },
  { file: 'plantuml-deployment.excalidraw', title: 'PlantUML 迁移：部署图', alt: 'PlantUML 部署图', data: createPlantUMLDeployment() },
  { file: 'plantuml-timing-diagram.excalidraw', title: 'PlantUML 迁移：Timing Diagram', alt: 'PlantUML Timing Diagram', data: createPlantUMLTimingDiagram() },
  { file: 'plantuml-gantt-plan.excalidraw', title: 'PlantUML 迁移：甘特图', alt: 'PlantUML 甘特图', data: createPlantUMLGanttPlan() },
  { file: 'plantuml-wbs.excalidraw', title: 'PlantUML 迁移：WBS', alt: 'PlantUML WBS', data: createPlantUMLWBS() },
  { file: 'plantuml-config-data.excalidraw', title: 'PlantUML 迁移：JSON/YAML 数据', alt: 'PlantUML JSON YAML 数据', data: createPlantUMLConfigData() },
  { file: 'plantuml-salt-wireframe.excalidraw', title: 'PlantUML 迁移：Salt 线框', alt: 'PlantUML Salt 线框', data: createPlantUMLSaltWireframe() },
  { file: 'plantuml-creole-note.excalidraw', title: 'PlantUML 迁移：Creole 富文本', alt: 'PlantUML Creole 富文本', data: createPlantUMLCreoleNote() },
  { file: 'plantuml-hyperlinks.excalidraw', title: 'PlantUML 迁移：链接类图', alt: 'PlantUML 链接类图', data: createPlantUMLHyperlinks() },
  { file: 'plantuml-stereotypes.excalidraw', title: 'PlantUML 迁移：Stereotypes', alt: 'PlantUML Stereotypes', data: createPlantUMLStereotypes() },
  { file: 'plantuml-gradient-layers.excalidraw', title: 'PlantUML 迁移：颜色分层图', alt: 'PlantUML 颜色分层图', data: createPlantUMLGradientLayers() },
  { file: 'plantuml-export-sequence.excalidraw', title: 'PlantUML 迁移：复杂导出序列', alt: 'PlantUML 复杂导出序列', data: createPlantUMLExportSequence() },
]

const errorFixtureCases = [
  { file: 'invalid-json.excalidraw', title: '错误文件：JSON 格式错误', alt: '错误 JSON', raw: '{ invalid excalidraw json\n' },
  {
    file: 'missing-elements.excalidraw',
    title: '错误文件：缺少 elements',
    alt: '缺少 elements',
    data: {
      type: 'excalidraw',
      version: 2,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    },
  },
  { file: 'array-root.excalidraw', title: '错误文件：根节点是数组', alt: '根节点数组', data: createArrayRootError() },
  { file: 'too-many-elements.excalidraw', title: '错误文件：元素数量超限', alt: '元素数量超限', data: createTooManyElementsError() },
]

for (const fixture of validFixtureCases) {
  writeJson(fixture.file, fixture.data)
}

for (const fixture of errorFixtureCases) {
  if ('raw' in fixture) {
    writeFileSync(join(excalidrawDir, fixture.file), fixture.raw, 'utf8')
  } else {
    writeJson(fixture.file, fixture.data)
  }
}

const codeBlockDoc = doc([
  ...rect('code-card', 0, 0, 420, 160, null, { fill: '#e8f4ff' }),
  text('code-title', 86, 38, '代码块渲染', { width: 248, fontSize: 36, align: 'center' }),
  text('code-note', 103, 100, 'Markdown fenced block', { width: 214, fontSize: 20, align: 'center', color: '#4b5563' }),
])

const allReferenceCases = [
  ...validFixtureCases,
  ...errorFixtureCases,
  { file: 'missing.excalidraw', title: '错误文件：文件不存在', alt: '缺失文件', missingOnly: true },
]

const referenceSections = allReferenceCases.map((fixture, index) => `## ${index + 2}. ${fixture.title}

![${fixture.alt}](./excalidraw/${fixture.file}${fixture.suffix ?? ''})`).join('\n\n')

const markdown = `# Excalidraw 渲染测试

本文档集中覆盖 Excalidraw 渲染器的正常路径、架构图样式、复杂布局、边界条件和错误降级。
用例参考了 Excalidraw 官方 JSON 结构、Excalidraw Architect MCP 的图拓扑建议、mermaid-to-excalidraw 的转换覆盖，以及本项目已有 Mermaid / Graphviz / DrawIO fixture 的组织方式。

## 1. 基础代码块

\`\`\`excalidraw
${JSON.stringify(codeBlockDoc, null, 2)}
\`\`\`

${referenceSections}

## ${allReferenceCases.length + 2}. 与 Mermaid 对比

\`\`\`mermaid
graph TD
  A[开始] --> B[处理] --> C[结束]
\`\`\`
`

writeFileSync(join(fixtureDir, 'test-excalidraw.md'), markdown, 'utf8')

console.log(`Generated ${validFixtureCases.length + errorFixtureCases.length} .excalidraw fixture files`)
