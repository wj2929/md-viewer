# D2 Renderer 综合测试

本文档覆盖 D2 的横向流程、分层架构、嵌套容器、中文标签、长链路、扇出/汇聚和大画布场景。

---

## 1. 基础链路

```d2
direction: right

user: 用户
viewer: MD Viewer
plugin: RendererPlugin
exporter: 导出链路
docx: DOCX 服务

user -> viewer: 打开 Markdown
viewer -> plugin: 识别 fence
plugin -> exporter: 生成 SVG/PNG
exporter -> docx: 替换 blockId
```

## 2. 分层架构

```d2
direction: right

ui: 渲染进程 {
  preview: Markdown 预览
  editor: 编辑模式
  settings: 设置面板
}

main: 主进程 {
  ipc: IPC 安全桥
  files: 文件访问
  export: 导出控制
}

service: DOCX 服务 {
  renderer: 图表渲染
  pandoc: Pandoc
}

ui.preview -> main.ipc: 请求导出
ui.settings -> main.ipc: 保存配置
main.ipc -> main.files: 读取文档
main.export -> service.renderer: 渲染图表
service.renderer -> service.pandoc: 生成 DOCX
```

## 3. 宽流程图

```d2
direction: right

open: 打开文件
parse: Markdown 解析
detect: 识别图表块
render: 渲染 SVG
capture: 截图 PNG
replace: 替换占位符
export: 输出文档

open -> parse -> detect -> render -> capture -> replace -> export
```

## 4. 导出任务状态机

```d2
direction: right

idle: 空闲
prepare: 准备资源
render: 渲染图表
convert: 转换文档
success: 成功
failed: 失败

idle -> prepare: 点击导出
prepare -> render: 收集图表
render -> convert: PNG 完成
convert -> success: 写入文件
prepare -> failed: 文件读取失败
render -> failed: 图表渲染失败
convert -> failed: 服务异常
failed -> idle: 关闭提示
success -> idle: 打开下一份文档
```

## 5. 文件树过滤链路

```d2
direction: right

keyboard: 键盘输入
filter: 过滤框
worker: 搜索 Worker
tree: 文件树
tabs: 已打开标签

keyboard -> filter: 中文/英文输入
filter -> worker: 关键词
worker -> tree: 匹配文件
tree -> tabs: 打开文件
filter -> tree: 清空后恢复全部
```

## 6. 多导出格式

```d2
direction: right

markdown: Markdown 源文档
html: HTML 导出
pdf: PDF 导出
docx: DOCX 导出
images: 图表图片
service: 远程 DOCX 服务

markdown -> html: buildExportHtmlContent
markdown -> pdf: printToPDF
markdown -> images: renderChartsForDocx
images -> docx: 替换占位符
docx -> service: HTTP API
```

## 7. RendererPlugin 契约

```d2
direction: right

registry: RendererRegistry
definition: RendererDefinition
preview: Preview Hook
server: Server Render
docx: DOCX Pipeline

registry -> definition: 注册 type/languages
definition -> preview: preview selector
definition -> server: ready selector
definition -> docx: screenshot target
preview -> server: 共享 blockId
server -> docx: 输出 images array
```

## 8. 安全边界

```d2
direction: right

markdown: Markdown 内容
sanitize: SVG Sanitizer
policy: Network Policy
ipc: IPC Path Guard
renderer: 图表渲染器

markdown -> renderer: fence code
renderer -> sanitize: SVG 输出
policy -> renderer: 阻止外部资源
ipc -> renderer: 仅允许本地同目录文件
sanitize -> markdown: 安全 SVG
```

## 9. 扇出与汇聚

```d2
direction: right

source: Markdown
v: Vega-Lite
d: D2
b: BPMN
w: WaveDrom
c: C4
result: 导出图片集合

source -> v
source -> d
source -> b
source -> w
source -> c
v -> result
d -> result
b -> result
w -> result
c -> result
```

## 10. 嵌套服务拓扑

```d2
direction: right

desktop: 桌面应用 {
  renderer: React Renderer {
    preview: Preview Pane
    toolbar: Toolbar
  }
  main: Electron Main {
    ipc: IPC Handlers
    menu: Native Menu
  }
}

external: 外部能力 {
  docx: DOCX Service
  plantuml: PlantUML Server
}

desktop.renderer.preview -> desktop.main.ipc: readFile/export
desktop.main.ipc -> external.docx: exportDOCX
desktop.renderer.preview -> external.plantuml: c4plantuml
```

## 11. 低分辨率布局风险

```d2
direction: right

small: 小窗口
sidebar: 文件树
tabs: 标签栏
preview: 预览区
toolbar: 浮动操作

small -> sidebar: 宽度受限
small -> tabs: 标签挤压
small -> preview: 图表缩放
small -> toolbar: 避免遮挡
sidebar -> preview: 可折叠
toolbar -> preview: 悬浮但不覆盖正文
```

## 12. 长文档渲染管线

```d2
direction: right

watch: 文件监听
cache: 内容缓存
markdown: Markdown Renderer
virtual: VirtualizedMarkdown
charts: 图表 Hooks
toc: 目录
scroll: 滚动同步

watch -> cache: 文件变化
cache -> markdown: 获取内容
markdown -> virtual: HTML
virtual -> charts: 渲染图表
virtual -> toc: 提取标题
charts -> scroll: 尺寸稳定后同步
toc -> scroll: 跳转锚点
```

## 13. 序列交互

```d2
shape: sequence_diagram

用户 -> 渲染进程: 打开 test-d2.md
渲染进程 -> MarkdownRenderer: 生成 HTML
MarkdownRenderer -> D2Hook: 保留 language-d2
D2Hook -> D2Renderer: renderD2ToSvg
D2Renderer -> 渲染进程: 返回 SVG
```

## 14. 插件状态流转

```d2
direction: right

disabled: 禁用
queued: 待渲染
rendering: 渲染中
ready: 已完成
error: 错误

disabled -> queued: 启用插件
queued -> rendering: 进入视口
rendering -> ready: SVG 成功
rendering -> error: 解析失败
error -> queued: 修改源码后重试
ready -> queued: 文档刷新
```

## 15. 资源边界

```d2
direction: right

local: 本地 Markdown
assets: 同目录资源
blocked: 外部 URL
guard: Resource Guard
renderer: RendererPlugin

local -> guard: 相对路径
assets -> guard: .bpmn 文件
blocked -> guard: http 链接
guard -> renderer: 允许
guard -> blocked: 拒绝
```

## 16. 文档导出泳道替代图

```d2
direction: right

app: MD Viewer {
  collect: 收集图表
  html: 生成 HTML
  pdf: 打印 PDF
}

service: DOCX Service {
  full: full 渲染
  pandoc: pandoc 转换
  download: 写回文件
}

app.collect -> app.html
app.collect -> app.pdf
app.collect -> service.full
service.full -> service.pandoc -> service.download
```

## 17. 失败隔离

```d2
direction: right

page: Markdown 页面
ok1: Vega-Lite 成功
bad: D2 失败
ok2: BPMN 成功
summary: 导出汇总

page -> ok1
page -> bad
page -> ok2
ok1 -> summary: image
bad -> summary: error placeholder
ok2 -> summary: image
```

## 18. 文件树过滤结构

```d2
direction: down

root: 项目根目录 {
  docs: docs {
    plan: RendererPlugin 规划文档
    edit: Markdown 编辑设计
  }
  fixtures: e2e fixtures {
    vega: Vega-Lite fixture
    d2file: D2 fixture
    bpmn: BPMN fixture
  }
  src: src renderer {
    hooks: chart hooks
    tests: renderer tests
  }
}

root.docs.plan -> root.fixtures.vega: 规划落地
root.src.hooks -> root.src.tests: 覆盖验证
```

## 19. 预览编辑协作

```d2
direction: right

preview: 预览模式
edit: 编辑模式
rendered: 渲染区编辑
source: 源码编辑
dirty: 未保存
saved: 已保存

preview -> edit: 切换编辑
edit -> rendered: 点击段落
edit -> source: 打开源码
rendered -> dirty: 内容变化
source -> dirty: 内容变化
dirty -> saved: 保存
dirty -> preview: 放弃编辑
```

## 20. 多窗口打开

```d2
direction: right

os: 操作系统
assoc: 文件关联
app: MD Viewer
winA: 窗口 A
winB: 窗口 B

os -> assoc: 双击 .md
assoc -> app: open-file
app -> winA: 已有窗口打开
app -> winB: 新窗口打开
winA -> winB: 独立标签和滚动状态
```

## 21. 设置依赖图

```d2
direction: right

settings: 设置面板
rendererSwitch: 图表开关
network: 网络策略
docx: DOCX 服务地址
preview: 预览 Hook
server: 服务端渲染

settings -> rendererSwitch
settings -> network
settings -> docx
rendererSwitch -> preview
rendererSwitch -> server
network -> preview
docx -> server
```

## 22. 大图缩放交互

```d2
direction: right

chart: 大型图表
toolbar: 图表工具栏
zoomIn: 放大
zoomOut: 缩小
fit: 适应宽度
download: 下载 SVG

chart -> toolbar: hover
toolbar -> zoomIn
toolbar -> zoomOut
toolbar -> fit
toolbar -> download
zoomIn -> chart: transform
fit -> chart: reset
```

## 23. 回归测试矩阵

```d2
direction: right

unit: Vitest 单测
e2e: Electron E2E
server: Server Render Smoke
fixture: Fixture Coverage
release: 发布前验证

fixture -> unit: 示例数量和结构
unit -> server: 渲染 API
server -> e2e: 页面结果
e2e -> release: 真实窗口
```

## 24. RendererPlugin 扩展顺序

```d2
direction: right

vega: Vega-Lite
d2: D2
bpmn: BPMN
wavedrom: WaveDrom
c4: C4PlantUML
future: 后续插件

vega -> d2: 第一批
d2 -> bpmn: 第二批
bpmn -> wavedrom: 第三批
wavedrom -> c4: 第四批
c4 -> future: 按真实文档需求
```

## 25. ER 数据模型

```d2
direction: right

users: 用户表 {
  shape: sql_table
  id: int primary key
  name: varchar
  role: varchar
}

documents: 文档表 {
  shape: sql_table
  id: int primary key
  owner_id: int
  path: varchar
}

exports: 导出任务表 {
  shape: sql_table
  id: int primary key
  document_id: int
  format: varchar
  status: varchar
}

users.id -> documents.owner_id
documents.id -> exports.document_id
```

## 26. Kubernetes 简化拓扑

```d2
direction: down

cluster: Kubernetes 集群 {
  control: Control Plane {
    api: API Server
    scheduler: Scheduler
    controller: Controller Manager
    etcd: etcd
  }
  node1: Worker Node A {
    kubelet1: kubelet
    pod1: md-viewer-web
    pod2: renderer-worker
  }
  node2: Worker Node B {
    kubelet2: kubelet
    pod3: docx-service
    pod4: redis
  }
}

control.api -> control.etcd
control.scheduler -> node1.kubelet1
control.scheduler -> node2.kubelet2
node1.pod2 -> node2.pod3: HTTP
```

## 27. 复杂审批 DAG

```d2
direction: down

start: 开始
submit: 提交材料
dept: 部门审核
finance: 财务审核
legal: 法务审核
vp: VP 终审
archive: 归档
reject: 驳回
end: 结束

start -> submit -> dept
dept -> finance: 预算相关
dept -> legal: 合同相关
finance -> vp
legal -> vp
dept -> reject: 材料缺失
vp -> archive: 通过
vp -> reject: 不通过
archive -> end
reject -> end
```

## 28. 超宽并发渲染链路

```d2
direction: right

s0: 打开文档
s1: 解析 Markdown
s2: 识别代码块
s3: 分发 RendererPlugin
s4: 渲染 SVG
s5: 等待尺寸稳定
s6: 截图 PNG
s7: 替换占位符
s8: 生成导出文件
s9: 写入磁盘
s10: 通知用户

s0 -> s1 -> s2 -> s3 -> s4 -> s5 -> s6 -> s7 -> s8 -> s9 -> s10
```

## 29. 超深错误回溯

```d2
direction: down

ui: 用户界面
hook: React Hook
renderer: 渲染器
sanitizer: SVG 清理
server: 服务端渲染
docx: DOCX 生成
fs: 文件系统
toast: 错误提示

ui -> hook
hook -> renderer
renderer -> sanitizer
sanitizer -> server
server -> docx
docx -> fs
fs -> toast: 写入失败
toast -> ui: 显示原因
```

## 30. 多级嵌套容器

```d2
direction: right

workspace: 工作区 {
  app: md-viewer {
    renderer: renderer process {
      charts: chart hooks {
        vega: VegaLite
        d2plugin: D2
        bpmn: BPMN
      }
    }
    main: main process {
      ipc: IPC
      export: Export
    }
  }
}

workspace.app.renderer.charts.d2plugin -> workspace.app.main.ipc
workspace.app.main.ipc -> workspace.app.main.export
```

## 31. 菱形决策树

```d2
direction: down

input: Markdown 输入
hasCharts: 是否包含图表 { shape: diamond }
enabled: 渲染器是否启用 { shape: diamond }
safe: 内容是否安全 { shape: diamond }
render: 渲染图表
source: 保留源码
blocked: 显示错误

input -> hasCharts
hasCharts -> enabled: 是
hasCharts -> source: 否
enabled -> safe: 是
enabled -> source: 否
safe -> render: 是
safe -> blocked: 否
```

## 32. 工具栏操作矩阵

```d2
direction: right

toolbar: 图表工具栏
zoomIn: 放大
zoomOut: 缩小
fit: 适应
copy: 复制源码
download: 下载
fullscreen: 全屏
chart: 图表容器
code: 源码视图

toolbar -> zoomIn -> chart
toolbar -> zoomOut -> chart
toolbar -> fit -> chart
toolbar -> copy -> code
toolbar -> download -> chart
toolbar -> fullscreen -> chart
```

## 33. 多格式导出扇入

```d2
direction: right

md: Markdown
htmlPre: HTML 预处理
chartPng: 图表 PNG
htmlOut: HTML 文件
pdfOut: PDF 文件
docxOut: DOCX 文件
done: 结果汇总

md -> htmlPre
md -> chartPng
htmlPre -> htmlOut
htmlPre -> pdfOut
htmlPre -> docxOut
chartPng -> docxOut
htmlOut -> done
pdfOut -> done
docxOut -> done
```

## 34. 文件关联跨平台

```d2
direction: right

mac: macOS Finder
win: Windows Explorer
linux: Linux Desktop
argv: 启动参数
openFile: open-file 事件
app: MD Viewer
preview: 预览窗口

mac -> openFile
win -> argv
linux -> argv
openFile -> app
argv -> app
app -> preview
```

## 35. 资源清理生命周期

```d2
direction: right

mount: 组件挂载
render: 开始渲染
worker: Worker 运行
abort: AbortController
unmount: 组件卸载
cleanup: 释放资源

mount -> render -> worker
render -> abort
unmount -> abort: 取消请求
abort -> cleanup
worker -> cleanup: terminate
```

## 36. 多来源 fixture 组合

```d2
direction: down

fixtures: e2e fixtures {
  graphviz: Graphviz 复杂参考
  plantuml: PlantUML 复杂参考
  drawio: DrawIO 复杂参考
  plugins: 新 RendererPlugin {
    vega: Vega-Lite
    d2case: D2
    bpmncases: BPMN
    wave: WaveDrom
    c4case: C4PlantUML
  }
}

fixtures.graphviz -> fixtures.plugins.d2case: 复杂度参考
fixtures.plantuml -> fixtures.plugins.c4case: 语法参考
fixtures.drawio -> fixtures.plugins.bpmncases: 流程图参考
```

## 37. 大量节点星型

```d2
direction: right

center: RendererRegistry
n1: Mermaid
n2: ECharts
n3: Markmap
n4: Graphviz
n5: PlantUML
n6: DrawIO
n7: Vega-Lite
n8: D2
n9: BPMN
n10: WaveDrom
n11: C4PlantUML

center -> n1
center -> n2
center -> n3
center -> n4
center -> n5
center -> n6
center -> n7
center -> n8
center -> n9
center -> n10
center -> n11
```

## 38. 双向同步滚动

```d2
direction: right

editor: 源码编辑器
preview: 预览区
map: 行号映射
anchor: 标题锚点
throttle: 节流器

editor -> map: 光标行
map -> preview: 滚动到段落
preview -> anchor: 当前标题
anchor -> editor: 定位源码
editor -> throttle
preview -> throttle
throttle -> map: 防抖更新
```

## 39. 安全失败闭环

```d2
direction: down

source: 用户输入
validate: 验证
sanitize: 清理 SVG
policy: 网络策略
error: 错误 UI
render: 正常渲染

source -> validate
validate -> sanitize: 合法
validate -> error: 非法
sanitize -> policy
policy -> render: 允许
policy -> error: 阻止
error -> source: 用户修改
```

## 40. 发布前验证流水线

```d2
direction: right

fixtures: Fixture 扩充
unit: Vitest
typecheck: TypeScript
lint: ESLint
build: Build
server: Server Render E2E
electron: Electron E2E
release: Release

fixtures -> unit -> typecheck -> lint -> build -> server -> electron -> release
```

## 41. 复杂微服务拓扑

```d2
direction: right

edge: 边缘层 {
  cdn: CDN
  waf: WAF
  lb: 负载均衡
}

app: 应用层 {
  gateway: API Gateway
  auth: Auth Service
  docs: Document Service
  export: Export Service
  renderer: Renderer Worker
  notify: Notification Service
}

data: 数据层 {
  pg: PostgreSQL
  redis: Redis
  object: Object Storage
  queue: Message Queue
}

edge.cdn -> edge.waf -> edge.lb -> app.gateway
app.gateway -> app.auth
app.gateway -> app.docs
app.docs -> data.pg
app.docs -> data.object
app.docs -> app.export
app.export -> data.queue
data.queue -> app.renderer
app.renderer -> data.object
app.export -> app.notify
app.notify -> data.redis

observability: 可观测性 {
  metrics: Metrics
  traces: Traces
  logs: Logs
  alert: Alertmanager
}

policies: 策略控制 {
  quota: 导出限流
  circuit: 熔断
  retry: 重试队列
  audit: 审计事件
}

app.gateway -> policies.quota: request budget
app.export -> policies.circuit: dependency health
app.export -> policies.retry: failed job
app.auth -> policies.audit: login event
app.docs -> policies.audit: document event
app.renderer -> observability.metrics
app.renderer -> observability.traces
app.export -> observability.logs
observability.metrics -> observability.alert
observability.logs -> observability.alert
policies.retry -> data.queue: replay
policies.audit -> data.pg: append only
```

## 42. 大型 ER 与审计模型

```d2
direction: right

users: users {
  shape: sql_table
  id: bigint pk
  name: varchar
  email: varchar
  status: varchar
}
workspaces: workspaces {
  shape: sql_table
  id: bigint pk
  owner_id: bigint fk
  name: varchar
}
documents: documents {
  shape: sql_table
  id: bigint pk
  workspace_id: bigint fk
  path: varchar
  checksum: varchar
}
render_jobs: render_jobs {
  shape: sql_table
  id: bigint pk
  document_id: bigint fk
  renderer: varchar
  status: varchar
}
exports: exports {
  shape: sql_table
  id: bigint pk
  document_id: bigint fk
  job_id: bigint fk
  format: varchar
}
audit_logs: audit_logs {
  shape: sql_table
  id: bigint pk
  actor_id: bigint fk
  target_id: bigint
  action: varchar
}

users.id -> workspaces.owner_id
workspaces.id -> documents.workspace_id
documents.id -> render_jobs.document_id
documents.id -> exports.document_id
render_jobs.id -> exports.job_id
users.id -> audit_logs.actor_id
documents.id -> audit_logs.target_id
```

## 43. 跨平台启动路径矩阵

```d2
direction: down

mac: macOS {
  finder: Finder 右键打开
  openFile: open-file event
  quarantine: xattr 解除隔离
}
windows: Windows {
  explorer: Explorer Open With
  argv: process argv
  registry: file association
}
linux: Linux {
  desktop: desktop entry
  mime: MIME database
  argv2: process argv
}
app: MD Viewer {
  normalize: 路径归一化
  guard: 安全检查
  preview: 打开预览
}

mac.finder -> mac.openFile -> app.normalize
mac.quarantine -> mac.finder
windows.explorer -> windows.argv -> app.normalize
windows.registry -> windows.explorer
linux.desktop -> linux.mime -> linux.argv2 -> app.normalize
app.normalize -> app.guard -> app.preview

packaging: 安装与关联 {
  dmg: macOS DMG
  zip: macOS ZIP
  nsis: Windows Installer
  appImage: Linux AppImage
  desktopFile: Linux desktop file
}

handoff: 启动移交 {
  singleInstance: single-instance lock
  pendingFile: pending open file
  recentList: 最近文件
  telemetryOff: 本地优先
}

packaging.dmg -> mac.finder: 注册打开方式
packaging.zip -> mac.quarantine: 首次打开提示
packaging.nsis -> windows.registry: 写入关联
packaging.desktopFile -> linux.mime: update database
app.guard -> handoff.singleInstance
handoff.singleInstance -> handoff.pendingFile: 已有窗口
handoff.pendingFile -> app.preview: focus and open
app.preview -> handoff.recentList: 记录历史
handoff.telemetryOff -> app.guard: 不上传路径
```

## 44. 渲染器失败传播图

```d2
direction: right

input: Markdown 输入
registry: RendererRegistry
vega: Vega-Lite
d2case: D2
bpmn: BPMN
wave: WaveDrom
c4: C4PlantUML
collector: Result Collector
ui: 预览 UI
export: 导出 UI
log: 日志

input -> registry
registry -> vega
registry -> d2case
registry -> bpmn
registry -> wave
registry -> c4
vega -> collector: image
d2case -> collector: image
bpmn -> collector: error
wave -> collector: image
c4 -> collector: blocked
collector -> ui
collector -> export
collector -> log
ui -> input: 用户修改后重试

fallback: 降级策略 {
  inlineError: 内联错误块
  keepSource: 保留源码
  retryButton: 重试按钮
  copyAction: 复制错误
}

supervisor: 渲染监督 {
  timeout: 超时控制
  concurrency: 并发限制
  sandbox: 沙箱策略
  cacheKey: 缓存键
}

registry -> supervisor.timeout
registry -> supervisor.concurrency
supervisor.sandbox -> vega: no remote data
supervisor.sandbox -> d2case: local layout
supervisor.cacheKey -> collector: 命中复用
bpmn -> fallback.inlineError
c4 -> fallback.keepSource
fallback.inlineError -> ui
fallback.keepSource -> export
fallback.retryButton -> registry
fallback.copyAction -> log
log -> supervisor.timeout: 统计慢图
```

## 45. 多级缓存一致性

```d2
direction: right

fs: 文件系统
watcher: 文件监听
memory: 内存缓存
markdown: Markdown AST
html: HTML 缓存
charts: 图表缓存
tabs: 标签页状态
preview: 预览
export: 导出

fs -> watcher: change event
watcher -> memory: invalidate
memory -> markdown: parse
markdown -> html: render
html -> charts: detect fences
charts -> preview: SVG
html -> export: HTML/PDF
charts -> export: PNG
tabs -> preview: active file
preview -> memory: request content
export -> memory: request content

keys: 缓存键 {
  filePath: 文件路径
  mtime: 修改时间
  rendererVersion: 渲染器版本
  optionsHash: 选项哈希
}

invalidator: 失效总线 {
  fileChanged: 文件变化
  settingsChanged: 设置变化
  rendererChanged: 插件变化
  manualRefresh: 手动刷新
}

memory -> keys.filePath
memory -> keys.mtime
charts -> keys.rendererVersion
export -> keys.optionsHash
invalidator.fileChanged -> memory: drop AST
invalidator.settingsChanged -> html: drop theme
invalidator.rendererChanged -> charts: drop SVG
invalidator.manualRefresh -> watcher: rescan
preview -> invalidator.manualRefresh
export -> invalidator.settingsChanged: export profile
```

## 46. 嵌套工作区治理

```d2
direction: down

org: 组织空间 {
  teamA: 研发中心 {
    project1: 保利威专项 {
      docs: 方案文档
      report: 费用分析报告
      charts: 图表样例
    }
    project2: 教学平台 {
      docs2: 需求说明
      tests: 测试报告
    }
  }
  teamB: 运维中心 {
    runbook: 运维手册
    incident: 故障复盘
  }
}

org.teamA.project1.docs -> org.teamA.project1.report
org.teamA.project1.report -> org.teamA.project1.charts
org.teamA.project2.docs2 -> org.teamA.project2.tests
org.teamB.runbook -> org.teamB.incident
org.teamA.project1.report -> org.teamB.incident: 导出证据

policy: 治理策略 {
  retention: 保留期限
  permission: 权限模型
  naming: 命名规范
  backup: 备份策略
}

review: 评审动作 {
  arch: 架构评审
  ux: 交互评审
  qa: 测试评审
  release: 发布检查
}

org.teamA.project1.docs -> policy.naming: 文档模板
org.teamA.project1.report -> policy.retention: 项目归档
org.teamA.project2.tests -> policy.permission: 测试可见性
org.teamB.incident -> policy.backup: 证据备份
policy.permission -> review.arch
policy.naming -> review.ux
policy.retention -> review.qa
review.arch -> org.teamA.project1.report: 修改建议
review.qa -> org.teamA.project2.tests: 回归结论
review.release -> org.teamB.runbook: 运维确认
```

## 47. 测试金字塔到发布门禁

```d2
direction: down

unit: Unit Tests {
  renderer: Renderer 单测
  parser: Markdown 解析
  security: 安全策略
}
integration: Integration Tests {
  docx: DOCX 图表替换
  exportHtml: HTML 导出
  fileRef: 本地文件引用
}
e2e: E2E Tests {
  electron: Electron 真实预览
  server: Server Render
  fixtures: 复杂 fixture
}
release: Release Gate {
  changelog: CHANGELOG
  tag: Git Tag
  assets: 安装包
}

unit.renderer -> integration.docx
unit.parser -> integration.exportHtml
unit.security -> integration.fileRef
integration.docx -> e2e.server
integration.exportHtml -> e2e.electron
integration.fileRef -> e2e.fixtures
e2e.server -> release.changelog
e2e.electron -> release.tag
e2e.fixtures -> release.assets

quality: Quality Gate {
  coverage: 覆盖率阈值
  accessibility: 可访问性抽检
  screenshots: 截图对比
  fixtures: fixture 复杂度
}

artifacts: Artifacts {
  junit: 测试报告
  htmlReport: HTML 报告
  traceZip: Playwright Trace
  releaseNotes: Release Notes
}

unit.renderer -> quality.coverage
integration.exportHtml -> quality.screenshots
e2e.electron -> quality.accessibility
e2e.fixtures -> quality.fixtures
quality.coverage -> artifacts.junit
quality.screenshots -> artifacts.htmlReport
quality.accessibility -> artifacts.traceZip
quality.fixtures -> artifacts.releaseNotes
artifacts.releaseNotes -> release.changelog
artifacts.traceZip -> release.assets: 失败时附加
```

## 48. 并发导出调度

```d2
direction: right

queue: Export Queue
scheduler: Scheduler
job1: HTML Job
job2: PDF Job
job3: DOCX Job
renderPool: Renderer Pool {
  worker1: Worker 1
  worker2: Worker 2
  worker3: Worker 3
}
result: Result Store
progress: Progress UI
error: Error UI

queue -> scheduler
scheduler -> job1
scheduler -> job2
scheduler -> job3
job1 -> renderPool.worker1
job2 -> renderPool.worker2
job3 -> renderPool.worker3
renderPool.worker1 -> result
renderPool.worker2 -> result
renderPool.worker3 -> result
result -> progress
job2 -> error: printToPDF failed
error -> scheduler: retry once

priority: Priority Lane {
  interactive: 用户手动导出
  batch: 批量导出
  background: 后台预渲染
}

control: Control Plane {
  cancel: 取消任务
  pause: 暂停队列
  resume: 恢复队列
  backoff: 指数退避
}

metrics: Export Metrics {
  duration: 耗时
  chartCount: 图表数量
  failureRate: 失败率
}

priority.interactive -> scheduler: high
priority.batch -> scheduler: normal
priority.background -> scheduler: low
control.cancel -> job1
control.pause -> queue
control.resume -> scheduler
control.backoff -> error
job1 -> metrics.duration
job2 -> metrics.failureRate
job3 -> metrics.chartCount
metrics.failureRate -> control.backoff
progress -> control.cancel: 用户取消
```

## 49. 图表安全决策树

```d2
direction: down

source: 图表源码
sizeCheck: 大小检查 { shape: diamond }
syntaxCheck: 语法检查 { shape: diamond }
networkCheck: 网络策略 { shape: diamond }
fileCheck: 文件引用检查 { shape: diamond }
sanitize: SVG 清理
render: 渲染成功
blocked: 阻止渲染
error: 错误占位

source -> sizeCheck
sizeCheck -> syntaxCheck: 小于上限
sizeCheck -> blocked: 过大
syntaxCheck -> networkCheck: 语法通过
syntaxCheck -> error: 语法失败
networkCheck -> fileCheck: 本地或允许
networkCheck -> blocked: 远程禁止
fileCheck -> sanitize: 同目录
fileCheck -> blocked: 越权路径
sanitize -> render
blocked -> error
error -> source: 修正后重试

policy: 安全策略 {
  allowlist: 渲染器白名单
  csp: Content Security Policy
  quarantine: 隔离未知 SVG
  audit: 安全审计
}

files: 文件边界 {
  sameDir: 同目录资源
  parentDir: 父目录访问
  absolutePath: 绝对路径
  symlink: 符号链接
}

source -> policy.allowlist: language id
policy.allowlist -> sizeCheck
sanitize -> policy.csp: 去除脚本
policy.csp -> policy.quarantine: 仍含风险
policy.quarantine -> blocked
fileCheck -> files.sameDir: allow
fileCheck -> files.parentDir: deny
fileCheck -> files.absolutePath: deny
fileCheck -> files.symlink: resolve
files.sameDir -> render
files.parentDir -> policy.audit
files.absolutePath -> policy.audit
policy.audit -> error: 展示原因
```

## 50. 长链路端到端追踪

```d2
direction: right

click: 用户点击导出
state: 前端状态机
ipc: IPC 调用
main: 主进程导出器
html: HTML 构建
chart: 图表截图
service: DOCX 服务
browser: Headless Browser
pandoc: Pandoc
write: 写入文件
notify: 完成通知

click -> state: start
state -> ipc: export request
ipc -> main: validate path
main -> html: buildExportHtmlContent
main -> chart: renderChartsForDocx
chart -> browser: screenshot
main -> service: send payload
service -> browser: render full page
service -> pandoc: convert
pandoc -> write: docx bytes
write -> notify: success
notify -> state: finish

trace: Trace Context {
  requestId: request id
  fileHash: file hash
  exportFormat: export format
  rendererCount: renderer count
}

failure: Failure Branch {
  serviceDown: DOCX 服务不可用
  chartTimeout: 图表截图超时
  permissionDenied: 写入权限失败
  rollback: 清理临时文件
}

click -> trace.requestId
main -> trace.fileHash
main -> trace.exportFormat
chart -> trace.rendererCount
service -> failure.serviceDown: connection refused
chart -> failure.chartTimeout: timeout
write -> failure.permissionDenied: EACCES
failure.serviceDown -> notify: show service error
failure.chartTimeout -> notify: show chart error
failure.permissionDenied -> failure.rollback
failure.rollback -> notify: show file error
trace.requestId -> notify: correlate
```
