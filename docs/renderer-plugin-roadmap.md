# RendererPlugin 统一渲染器与新增图表能力规划

## 目标与边界

在 `md-viewer` 中引入统一 `RendererPlugin` 端到端能力契约，降低新增图表/公式渲染器的重复成本，并按以下顺序扩展：

1. `vega-lite`，再按 spike 结果决定是否同阶段支持原生 `vega`
2. `d2`
3. `bpmn`
4. 按真实文档需求补 `wavedrom`、`structurizr/c4`

本方案以 `md-viewer` 为主仓库；`md-viewer-docx-service` 作为 DOCX full fidelity renderer 的同步消费者。目标不是一次性改完所有 renderer，而是先建立可校验契约，再小步迁移、逐个新增。

## 当前问题

现有能力已覆盖 Mermaid、ECharts、Markmap、Graphviz、PlantUML、DrawIO、Infographic、KaTeX、Excalidraw，但集成点分散：

- Markdown fence 识别：`src/renderer/src/utils/markdownRenderer.ts`
- 预览渲染：`src/renderer/src/components/charts/useXChart.ts`
- HTML/PDF 导出：`src/renderer/src/utils/exportHtml.ts`
- DOCX 客户端预渲染：`src/renderer/src/utils/docxChartRenderer.ts`
- 服务端截图：`src/renderer/src/server-render/ServerRenderApp.tsx`
- DOCX 服务：`md-viewer-docx-service/app/full_fidelity_renderer.py` 与 `app/main.py`

继续逐个手工接入会导致每种 renderer 重复修改 5-7 个位置，且最容易遗漏 `server-render -> screenshot -> docx-service replacement` 链路。

## 设计原则

- `RendererPluginRegistry` 是 md-viewer 内 renderer 能力的单一事实来源。
- `md-viewer` 构建时输出机器可读 manifest，`md-viewer-docx-service` 消费并校验该 manifest。
- 不把所有逻辑塞进一个大 `core.ts`；按 registry、preview、export、docx、server-render 分层。
- 默认离线、本地、确定性渲染；需要网络或 CLI 的 renderer 必须显式启用。
- 正常导出必须输出图片/矢量结果；失败降级可保留源码，但必须在 UI 和导出任务详情中明确告知。
- 每个阶段必须有自动化测试和回归保护，不能靠“手动看起来可用”推进。

## 架构方案

```text
Markdown source
      |
      v
markdownRenderer fence/file-ref normalization
      |
      v
RendererPluginRegistry
      |
      +--> preview adapter
      +--> HTML/PDF export adapter
      +--> DOCX client adapter
      +--> server-render adapter
      +--> renderer manifest
                    |
                    v
          md-viewer-docx-service capability check
          + replacement rules
```

## RendererPlugin 端到端契约

`RendererPlugin` 不应只是前端展示元数据，而要描述从源码识别到导出替换的完整能力。契约分为两层：

- `RendererRuntimePlugin`：前端运行时使用，允许包含函数、DOM 选择器和渲染适配器。
- `RendererManifestEntry`：构建产物写入 JSON，只包含可序列化的能力、策略和替换信息，供 `md-viewer-docx-service` 消费。

```ts
export type RendererType =
  | 'mermaid'
  | 'echarts'
  | 'markmap'
  | 'graphviz'
  | 'plantuml'
  | 'drawio'
  | 'infographic'
  | 'katex'
  | 'excalidraw'
  | 'vega-lite'
  | 'd2'
  | 'bpmn'
  | 'wavedrom'
  | 'c4plantuml'

export type RendererSourceKind = 'fence' | 'inlineMath' | 'blockMath' | 'imageRef' | 'fileResource'

export type RendererTarget = 'preview' | 'html' | 'pdf' | 'docxClient' | 'serverRender' | 'docxService'

export type RendererStatus =
  | 'available'
  | 'dependencyMissing'
  | 'disabled'
  | 'blockedBySecurityPolicy'
  | 'unsupported'

export type RendererState =
  | 'rendering'
  | 'success'
  | 'degraded'
  | 'failed'
  | 'unsupported'
  | 'blockedBySecurityPolicy'
  | 'dependencyMissing'

export type NetworkPolicy = 'offlineOnly' | 'localOnly' | 'explicitRemoteAllowed'

export type ExportFallbackPolicy = 'imageRequired' | 'allowSourceFallbackWithWarning' | 'skipWithWarning'

export type RendererCapabilityState = 'supported' | 'unsupported' | 'optional' | 'disabledByDefault'

export type RendererTargetCapability = {
  state: RendererCapabilityState
  reason?: string
  requires?: Array<'rendererArtifact' | 'docxService' | 'localCli' | 'remoteService' | 'network'>
}

export type RendererValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; userAction?: string }

export type RenderSourceLocator = {
  blockId: string
  sourceKind: RendererSourceKind
  rendererType: RendererType
  canonicalLanguage: string
  sourceIndex: number
  startOffset: number
  endOffset: number
  sourceHash: string
  resolvedPath?: string
}

type RendererBaseDefinition = {
  type: RendererType
  displayName: string
  aliases: string[]
  languages: string[]
  sourceKinds: RendererSourceKind[]
  capabilities: Record<RendererTarget, RendererTargetCapability>
  networkPolicy: NetworkPolicy
  fallbackPolicy: ExportFallbackPolicy
  dependencyLabel?: string
  manifestVersion: string
  userHelp: {
    exampleFence: string
    settingsDescription: string
    failureHints: Record<string, string>
  }
  sanitizePolicy: {
    classes: string[]
    attributes: string[]
    tags?: string[]
  }
  replacement: {
    strategy: 'blockId' | 'imageRefByResolvedPath' | 'mathBlockId'
    fileExtensions?: string[]
  }
}

type RendererRuntimeBase = RendererBaseDefinition & {
  wrapperClassName: string
  errorClassName: string
  previewSelector: string
  readySelector: string
  screenshotTargetSelector: string
  validate?: (source: string, locator: RenderSourceLocator, context: { target: RendererTarget }) => Promise<RendererValidationResult>
}

export type SvgRendererPlugin = RendererRuntimeBase & {
  renderMode: 'svg'
  renderToSvg: (source: string, locator: RenderSourceLocator, context: { target: RendererTarget }) => Promise<string>
}

export type DomRendererPlugin = RendererRuntimeBase & {
  renderMode: 'dom'
  renderToElement: (source: string, locator: RenderSourceLocator, context: { target: RendererTarget }) => Promise<HTMLElement>
}

export type CanvasRendererPlugin = RendererRuntimeBase & {
  renderMode: 'canvas'
  renderToElement: (source: string, locator: RenderSourceLocator, context: { target: RendererTarget }) => Promise<HTMLElement>
}

export type RendererRuntimePlugin = SvgRendererPlugin | DomRendererPlugin | CanvasRendererPlugin

export type RendererManifestEntry = RendererBaseDefinition & {
  renderMode: 'svg' | 'dom' | 'canvas'
  selectors: {
    preview: string
    ready: string
    screenshotTarget: string
  }
}
```

### 契约要求

- `renderToSvg` / `renderToElement` 不再同时可选；必须通过 `renderMode` 使用 tagged union。
- registry 注册时必须校验 `type`、`aliases`、`languages` 无冲突。
- manifest 只能从 `RendererManifestEntry` 生成，不能把 runtime 函数序列化进 JSON。
- `capabilities` 描述静态能力，运行时状态由 dependency check 生成，不能再用单个 boolean 混合表达。
- `blockId` 是跨链路替换主键；`sourceIndex` 只用于排序、诊断和兼容旧逻辑。
- `blockId` 生成规则：`rendererType + sourceKind + canonicalLanguage + startOffset + endOffset + sourceHash`，文件引用额外加入规范化相对路径；它只要求在同一次 normalized markdown 处理链路内稳定，不承诺跨编辑会话不变。
- `preview`、HTML、DOCX client、server-render 与 docx-service replacement 必须传递同一个 `blockId`。
- 所有安全策略必须进入 `validate` 或 `sanitizePolicy`，不能散落在各导出路径。
- `pdf` 视为 HTML 静态导出的下游能力；测试需要覆盖独立 HTML 打开和 PDF 输出。
- `.bpmn`、`.excalidraw` 等文件引用走 `sourceKinds: ['imageRef', 'fileResource']`，不混入普通 fenced renderer。

## Manifest 与跨仓契约

`md-viewer` 当前 server-render artifact 已输出 `out/renderer/manifest.json`。本方案不新增第二个 manifest 文件，而是将现有 manifest 从 `schemaVersion: "1.0"` 升级到 `2.0`，避免 `md-viewer-docx-service/app/renderer_artifact.py` 读错文件。

```text
out/renderer/manifest.json
```

示例：

```json
{
  "schemaVersion": "2.0",
  "name": "@md-viewer/server-renderer",
  "version": "2.2.0",
  "entryHtml": "server-render.html",
  "assetsDir": "assets",
  "supportedCharts": ["mermaid", "katex", "excalidraw", "drawio", "echarts", "markmap", "graphviz", "infographic", "vega-lite"],
  "minDocxServiceVersion": "0.2.0",
  "renderers": [
    {
      "type": "vega-lite",
      "aliases": ["vegalite"],
      "sourceKinds": ["fence"],
      "capabilities": {
        "preview": { "state": "supported" },
        "html": { "state": "supported" },
        "pdf": { "state": "supported" },
        "docxClient": { "state": "supported" },
        "serverRender": { "state": "supported", "requires": ["rendererArtifact"] },
        "docxService": { "state": "supported", "requires": ["docxService", "rendererArtifact"] }
      },
      "replacement": {
        "strategy": "blockId"
      },
      "networkPolicy": "offlineOnly"
    }
  ]
}
```

`md-viewer-docx-service` 必须：

- 在 `/readyz` 读取并返回 manifest 中的 renderer 能力。
- 校验 manifest schema 版本与自身支持范围。
- 根据 manifest 判断是否可以替换某 renderer，而不是只依赖 Python 端硬编码列表。
- 保留 Python 端 allowlist 作为安全边界，但测试必须验证 allowlist 与 manifest 不冲突。
- 在不支持新 renderer 时返回明确 warning，而不是静默保留源码。

### Manifest 兼容策略

- `schemaVersion` 使用 `major.minor`。major 不一致时 full fidelity renderer 不启用，`/readyz` 返回 503。
- minor 升级只能新增字段；旧服务必须忽略未知字段，并在 `/readyz.rendererWarnings` 中报告。
- `supportedCharts` 保持向后兼容，作为旧服务和诊断 UI 的简化列表；新逻辑以 `renderers[].capabilities` 为准。
- 未知 renderer 不能让整个服务失败；应在该 renderer 出现时返回 `unsupported` warning。
- manifest 中声明 supported、Python allowlist 未允许时，按安全边界处理为 `blockedBySecurityPolicy`，并在 `/readyz` 报告 allowlist mismatch。
- `minDocxServiceVersion` 高于当前服务版本时，full fidelity renderer 不启用，但普通 DOCX 导出必须继续可用。

## 安全与策略执行矩阵

安全策略必须由统一 gateway 执行，而不是各组件自行判断。

| 目标 | 执行位置 | 必须执行 |
|---|---|---|
| `preview` | `RenderPreview` / chart hook 调用 plugin 前 | language 归一、`validate`、DOMPurify hook、网络策略 |
| `html` | `buildExportHtmlContent` 生成静态 HTML 前 | `validate`、sanitize、外部资源拦截、fallback warning |
| `pdf` | PDF 使用导出 HTML 前后 | 复用 HTML 结果，额外校验图表节点存在 |
| `docxClient` | `renderChartsForDocx` 替换源码前 | `blockId` 生成、`validate`、图片输出校验、warning 结构化 |
| `serverRender` | `ServerRenderApp` 渲染与截图前 | manifest capability、enabledRenderers、网络策略、timeout |
| `docxService` | `full_fidelity_renderer.py` / replacement | manifest 兼容、Python allowlist、bundle 路径安全、warning 合并 |

统一 warning schema：

```ts
type RendererWarning = {
  rendererType: RendererType
  blockId: string
  sourceKind: RendererSourceKind
  sourceIndex?: number
  filePath?: string
  target: RendererTarget
  code: string
  reason: string
  fallback: 'imageRendered' | 'sourcePreserved' | 'skipped' | 'blocked'
  userAction?: string
  diagnostics?: Record<string, string | number | boolean>
}
```

## UX 状态模型

新增 renderer 后，用户需要知道三件事：能不能预览、能不能导出、失败后怎么办。

### 统一状态

| 状态 | 用户文案方向 | 行为 |
|---|---|---|
| `rendering` | 正在渲染图表 | 显示占位骨架或加载提示 |
| `success` | 图表已渲染 | 正常显示 |
| `degraded` | 已导出，但部分图表降级 | 导出任务详情必须保留 warning |
| `failed` | 图表渲染失败 | 显示错误块，源码折叠保留 |
| `unsupported` | 当前版本不支持该图表 | 提供支持列表入口 |
| `blockedBySecurityPolicy` | 已阻止不安全资源 | 说明被阻止原因和恢复方式 |
| `dependencyMissing` | 缺少本地依赖或服务未启用 | 提供设置入口或安装说明 |

### UI 要求

- 设置页增加“图表与导出兼容性”矩阵，按 `预览 / HTML / PDF / DOCX / DOCX 服务` 展示状态。
- 错误块使用面向用户的词：图表类型、预览、导出为图片、需要本地服务、离线可用；不要暴露 renderer/server-render 等内部概念。
- 错误块包含：标题、简短原因、影响范围、源码摘要折叠、复制错误、打开设置、查看示例。
- 导出成功但有降级时，toast 和 `ExportTaskView` 显示“成功但有问题”，不能显示纯成功。
- 导出 warning 结构必须包含：renderer 名称、`blockId`、第几个块或文件引用、失败原因、本次处理结果、建议操作、诊断信息。

## 新增能力优先级

### P1. Vega-Lite / Vega

定位：声明式数据可视化，适合统计图、分析报告和仪表盘文档。

语法：

````markdown
```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "values": [{ "a": "A", "b": 28 }, { "a": "B", "b": 55 }] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "a", "type": "nominal" },
    "y": { "field": "b", "type": "quantitative" }
  }
}
```
````

实施前必须完成 spike：

- 确认 `vega-embed` / `vega-lite + vega` 的 bundle 体积。
- 确认 SVG 或 Canvas 输出稳定性。
- 外部 URL 数据必须在 `validate` 与 Vega loader 两层拦截。
- server-render 中同样禁止外部数据访问。
- `vega-lite` 与原生 `vega` schema 必须分开验证；不能把 `vega` 简单当作 `vega-lite` alias。

验收：

- inline `data.values` 可预览、HTML/PDF/DOCX 导出。
- invalid JSON 显示用户可读错误。
- 外部 URL data 被阻止，并显示 `blockedBySecurityPolicy`。
- DOCX 导出不残留源码块；失败时必须有 warning。
- 第一阶段只承诺 `vega-lite` / `vegalite`；`vega` 只有在 spike 证明 schema dispatch 与导出稳定后才启用。

### P1. D2

定位：现代文本架构图、流程图、网络图。

语法：

````markdown
```d2
api -> service: request
service -> db: query
```
````

实施前必须完成 ADR：

- 选项 A：browser/wasm，本地离线优先。
- 选项 B：本地 CLI，需要打包与依赖检测。
- 选项 C：远程服务，默认关闭，仅私有部署或显式启用。

验收：

- 正常导出必须是图片结果。
- 失败时允许源码降级，但必须显示“已降级保留源码”。
- 设置页能显示 D2 是否可用、为什么不可用、如何启用。

### P1. BPMN

定位：标准业务流程图，适合审批流、业务流、系统集成流程。

语法：

````markdown
```bpmn
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ...>
</bpmn:definitions>
```
````

文件引用：

```markdown
![流程](./process.bpmn)
```

实施前必须完成 spike：

- `bpmn-js` viewer 在 Electron、HTML export、server-render 中是否稳定。
- `.bpmn` 文件引用如何进入现有安全路径解析。
- bundle resource 如何携带 `.bpmn`。
- XML 解析错误和恶意 XML 的安全边界。

验收：

- fenced XML 和 `.bpmn` 相对文件引用都可预览。
- HTML/PDF/DOCX 导出保留流程图。
- XML 错误有用户可读提示。
- 路径越权引用被阻止。

### P2. WaveDrom

定位：数字时序图、协议波形图。适合硬件、通信、协议文档。

实施要求：

- 使用本地 JS 渲染，不引入远程资源。
- 输入大小有限制，超大输入给出错误块。
- 导出链路复用 registry。

### P2. Structurizr / C4

建议路线：

1. 先支持 `c4plantuml` / `c4` fence alias，复用 PlantUML。
2. 在 D2 或 BPMN 阶段提前调研 Structurizr DSL 原生渲染，不等后续阶段才发现不可行。

注意：`c4plantuml` 继承 PlantUML 的网络/服务限制；如果 PlantUML 走远程服务，UI 必须显示该依赖。

## 分阶段实施计划

### Phase 0：契约、registry、manifest

目标：不新增图表类型，先建立单一事实来源。

改动：

- 新增 `src/renderer/src/renderers/types.ts`
- 新增 `src/renderer/src/renderers/registry.ts`
- 新增 `src/renderer/src/renderers/manifest.ts`
- 新增 `src/renderer/src/renderers/sourceIdentity.ts`，统一生成 `blockId` 与 source locator。
- 新增 `src/renderer/src/renderers/securityGateway.ts`，统一执行 validate、sanitize 与网络策略。
- 将现有 renderer 元数据注册进 registry。
- 构建或测试阶段升级生成 `out/renderer/manifest.json`。
- `markdownRenderer.ts` 的 special fence 判断改为读取 registry。
- `ServerRenderApp.tsx` 的统计、enabledRenderers、selector 读取 registry。

门禁：

- 旧图表预览和导出行为不变。
- registry 检测 type/alias/language 冲突。
- manifest 与 registry 一致。
- 同一次 normalized markdown 处理链路中多个同类型图表的 `blockId` 稳定，且不依赖渲染顺序。
- `sourceIndex` 变化不影响 replacement；只影响排序与诊断显示。
- 安全 gateway 在 preview、HTML、DOCX client、server-render 均被调用。
- `md-viewer-docx-service` 能读取 manifest 并在 `/readyz` 返回。

### Phase 0.5：技术 spike 与 ADR

目标：先验证高风险依赖，避免后续阶段被外部运行时卡住。

必须输出：

- ADR：D2 runtime 选型。
- ADR：BPMN 文件引用与 bundle resource 处理。
- Spike 记录：Vega-Lite 外部数据拦截和导出稳定性。
- Spike 记录：Structurizr DSL 是否值得原生支持，并作为 Phase 6 输入。

### Phase 1：迁移代表性旧 renderer

目标：验证 registry 不是纸面设计。

顺序：

1. 迁移 Mermaid 或 Graphviz，代表纯 SVG。
2. 迁移 DrawIO 或 Excalidraw，代表 DOM/fallback/文件引用。

暂不一次性迁移所有 renderer。两个代表通过后，再批量迁移其余旧 renderer。

门禁：

- 预览、HTML、PDF、DOCX client、server-render、docx-service 全链路通过。
- 导出 warning 结构化显示。
- 旧测试不回归。

### Phase 2：Vega-Lite

目标：完成第一个新插件，验证新 renderer 接入流程。

改动：

- 新增 Vega-Lite 插件。
- 支持 `vega-lite`、`vegalite`。
- 原生 `vega` 作为 Phase 2.1 候选，只有在 spike 通过后再启用。
- 增加 example fixture，并更新 `test-all-charts.md`。
- 同步 renderer manifest 和 docx-service replacement。

门禁：

- inline data 正常。
- 外部 URL data 被阻止。
- 预览/HTML/PDF/DOCX/DOCX 服务全链路通过。

### Phase 3：D2

目标：按 Phase 0.5 ADR 结果落地 D2。

如果 ADR 结论是远程或 CLI 才可用，则 D2 作为 optional renderer，不默认启用。

门禁：

- 依赖缺失时 UI 明确提示。
- 导出降级有 warning。
- 设置页可看到 D2 状态。

### Phase 4：BPMN

目标：支持 fenced BPMN XML 和 `.bpmn` 文件引用。

门禁：

- fenced BPMN 可预览。
- `.bpmn` 相对文件引用可预览。
- bundle `.bpmn` 可进入 DOCX service。
- XML 错误、路径越权、超大 XML 有测试。

### Phase 5：WaveDrom 与 C4

目标：按真实文档需求补行业专用能力。

顺序：

1. `wavedrom`
2. `c4plantuml` alias

### Phase 6：架构、数据和长尾图表

目标：补齐技术文档和汇报材料中高频的建模、统计和关系图能力。

范围：

1. `structurizr`：支持 Structurizr DSL 的离线架构模型预览、导出和全屏查看。
2. `plotly`：支持内联 Plotly JSON，覆盖柱状、折线/散点、饼图、热力图和 3D 散点等 PPT/分析常见图表。
3. `dbml`：支持 DBML 表结构和 `Ref` 关系，生成数据库 ERD。
4. `antv-g6`：支持内联 `nodes`/`edges`/`combos` JSON，生成复杂关系、拓扑和知识图谱。
5. `kroki`：作为长尾兼容层，先接入 `nomnoml`、`pikchr`、`svgbob`、`bytefield`、`tikz`；默认通过显式远程策略控制。

验收要求：

- 每个 renderer 都必须接入 `RendererPlugin` manifest、Markdown fence 归一、预览 hook、HTML/PDF 导出、DOCX client 预渲染和 server-render。
- 每个 renderer 都必须在 `e2e/fixtures/` 下有独立复杂 fixture，并加入 `test-all-charts.md`。
- 全屏体验必须复用 DrawIO 风格：右上角关闭、底部黑色四按钮工具条、Esc 退出、无水平滚动条。
- Kroki 相关 E2E 必须 mock 网络请求，避免测试依赖真实外网。
- 当前阶段先保证确定性 SVG 输出；后续如引入完整 Plotly.js 或 AntV G6 runtime，应补充 bundle 体积、离线能力和导出一致性评估。

## md-viewer-docx-service 同步清单

新增或迁移 renderer 时，需要同步：

- `app/full_fidelity_renderer.py` 的 `RenderedImage.type`
- supported block regex 和 timeout 统计逻辑
- default `enabledRenderers`
- `app/main.py` 的 replacement 逻辑
- `app/renderer_artifact.py` 对 manifest schema 和 supported renderers 的校验
- `/readyz` 的 `rendererSupportedCharts`
- `README.md` 和 `renderers/README.md` 支持矩阵
- `tests/test_convert_source.py` 的 replacement/injection/partial warning 用例

目标状态：Python 端仍保留 allowlist，但具体能力来自 artifact manifest，减少硬编码遗漏。

### 自动一致性校验

- `app/renderer_artifact.py` 解析 `renderers[]`，输出完整 capability，而不只输出 `supportedCharts`。
- 启动时比较 `manifest renderers` 与 Python allowlist：
  - manifest 有、allowlist 无：`/readyz.rendererWarnings` 报告，实际渲染时返回 `blockedBySecurityPolicy`。
  - allowlist 有、manifest 无：`/readyz.rendererWarnings` 报告，不能默默启用。
  - schema major 不兼容：full fidelity renderer 503，普通 `/convert` 降级继续可用。
- replacement 逻辑优先按 `blockId` 匹配；旧 `sourceIndex` 只作为 `schemaVersion: 1.x` artifact 的兼容路径。
- `X-Convert-Warnings` 与响应体 warning 使用同一 `RendererWarning` 字段，避免客户端和服务端文案不一致。

## 测试策略

这次改动很大，测试必须覆盖迁移保护、端到端导出和失败状态。

### CI 分层

- PR 必跑：registry 单测、manifest schema、source identity、关键 preview 测试、`renderChartsForDocx` replacement 测试。
- 合并前必跑：HTML/PDF 导出、server-render E2E、docx-service `/readyz` 与 `/convert-source`。
- 发布前必跑：真实文档抽样、全 renderer fixture、性能基线、跨平台打包 smoke。
- 外部依赖 spike 测试不进入默认 PR 阻断，但进入对应 Phase 的合并门禁。

### 迁移保护测试

在改 registry 前先补齐：

- 每个现有特殊 fence 的 HTML 输出快照。
- alias 归一测试：`dot -> graphviz`、`puml -> plantuml`、`dio -> drawio`、`excalidraw-json -> excalidraw`。
- DOMPurify allowlist 测试，确保旧图表 class/attr 不被清理。
- 同一文档多同类图表的 `blockId` 快照，确保增删前文后不会错误替换到其他块。

### Registry 单元测试

- type/alias/language 冲突时 fail-fast。
- 每个 plugin 至少有一个 render mode。
- `capabilities` 与 render mode 不矛盾。
- manifest 输出与 registry 内容一致。
- 安全策略字段不能为空。
- runtime plugin 与 manifest entry 字段一致，函数字段不会出现在 manifest JSON 中。

### Preview 测试

- 正常渲染。
- 语法错误。
- 重复块顺序。
- 依赖缺失。
- 被安全策略阻止。
- 错误块可访问性：`role="alert"`、源码折叠、复制错误按钮。

### HTML/PDF 导出测试

- 导出的 HTML 独立打开后图表可见。
- PDF 从导出 HTML 生成时图表可见。
- 导出失败时 HTML 中有错误块，不静默丢图。

### DOCX client 测试

- `renderChartsForDocx` 生成 `mdv__chart__` 占位。
- 占位数量、`blockId` 和 source locator 正确。
- 多个同类型块 replacement 不依赖 `sourceIndex`。
- 渲染失败时返回结构化 warning。
- 正常路径不保留源码块。
- 降级路径保留源码块时 warning 明确说明。

### Server-render E2E

- `__MDV_RENDER_RESULT__` 包含正确 type、selector、`blockId`、sourceIndex、width/height。
- 只启用部分 renderers 时，未启用类型返回 unsupported 或保留代码。
- timeout/partial/failed 统计准确。
- 多个同类型块顺序稳定。

### md-viewer-docx-service 测试

- `/readyz` 返回 manifest renderers。
- 不兼容 manifest schema 返回 503。
- `/convert-source` 注入新 renderer 图片。
- replacement 不残留源码块。
- unsupported renderer 返回 warning。
- allowlist 与 manifest 不一致时 `/readyz.rendererWarnings` 可见。
- schema 1.x artifact 仍可走 sourceIndex 兼容路径。
- bundle `.bpmn` 路径越权被阻止。

### 安全测试

- Vega-Lite 外部 URL data 被阻止。
- BPMN 恶意 XML 不执行脚本。
- D2 远程服务未启用时不发请求。
- 超大输入被限制。
- 相对路径不能跳出 bundle/root。

### 性能与真实文档测试

- `e2e/fixtures/test-all-charts.md` 覆盖所有 renderer。
- 从真实技术方案文档抽样导出 HTML/PDF/DOCX。
- 记录批量图表渲染耗时、失败数、warning 数。
- 新增 renderer 不应明显拖慢无图表 Markdown 的预览。

## UX 验收标准

- 用户打开设置页，不阅读文档也能知道每种图表支持哪些导出格式。
- 未支持或未启用 renderer 的 fence 不会静默当普通代码误导用户。
- 远程服务关闭时，用户能看到为什么不可用和如何启用。
- 导出成功但有降级时，任务详情不会快速消失，用户能定位受影响图表。
- 错误原因分类一致：语法错误、依赖缺失、远程禁用、网络失败、安全策略阻止、不支持导出。
- 离线环境下打开含 Vega-Lite/D2/BPMN/WaveDrom 的文档，用户能区分“可离线渲染”“需配置后渲染”“已安全阻止外部资源”。

## Git 注意事项

- 不要执行 `git add docs/`。
- 本方案只建议跟踪 `docs/renderer-plugin-roadmap.md`。
- `docs/` 中已有大量历史/内部文档被 `.gitignore` 排除，不应误提交。
- 实施前先用 `git status --short -- docs` 和 `git ls-files docs` 确认待提交范围。

## 推荐验收命令

`md-viewer`：

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run test:e2e -- e2e/server-render-mermaid-smoke.spec.ts
```

`md-viewer-docx-service`：

```bash
PYTHONPATH=. pytest -q
```

## 参考资料

- Vega-Lite 文档：<https://vega.github.io/vega-lite/docs/>
- D2 文档：<https://d2lang.com/>
- bpmn-js 文档：<https://bpmn.io/toolkit/bpmn-js/>
- WaveDrom 文档：<https://wavedrom.com/>
- Structurizr DSL 文档：<https://docs.structurizr.com/dsl>
