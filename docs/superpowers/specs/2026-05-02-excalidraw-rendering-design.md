# Excalidraw Rendering Design

## 背景

MD Viewer 是桌面端 Markdown 预览和导出工具，现有图表能力通过 Markdown 代码块和专用渲染器实现，包括 Mermaid、Graphviz、DrawIO、ECharts、Markmap、PlantUML、Infographic 和 KaTeX。

Excalidraw 的目标接入方式不是编辑，而是把 Excalidraw 场景作为 Markdown 中的只读图表资源渲染出来。首版采用静态 SVG 渲染器方案，预览阶段生成 SVG，导出阶段复用 SVG 或转换为 PNG。

## 目标

- 支持 `excalidraw` 和 `excalidraw-json` fenced code block。
- 支持 Markdown 图片语法引用本地 `.excalidraw` 文件。
- 支持 Excalidraw 场景中的图片元素，前提是图片数据已经包含在 JSON 的 `files` 字段中。
- 预览、HTML、PDF、DOCX 导出都应保留 Excalidraw 渲染结果。
- 不嵌入 Excalidraw 编辑器，不允许编辑、不保存修改、不绑定编辑器快捷键。

## 非目标

- 不提供 Excalidraw 编辑能力。
- 不主动联网加载外部图片或远程 `.excalidraw` 文件。
- 不扫描 `.excalidraw` 外部伴随资源目录。
- 不支持从 `.excalidraw.svg` 或 `.excalidraw.png` metadata 中恢复场景；该能力可后续单独规划。

## 推荐方案

采用静态 SVG 渲染器。

渲染器从 Excalidraw JSON 中读取 `elements`、`appState`、`files`，动态加载 `@excalidraw/excalidraw`，调用官方 `exportToSvg` 生成 SVG。`exportToSvg` 使用对象参数调用，实施时以安装包导出的实际类型为准：

```ts
const svg = await exportToSvg({
  elements,
  appState,
  files,
  exportPadding,
})
```

预览中插入 SVG；HTML/PDF 导出中内联 SVG；DOCX 导出中将 SVG 转 PNG 后写入文档。渲染前应优先使用官方可用的恢复/校验工具，例如 `restoreElements`、`restoreAppState`、`isValidExcalidrawData`，以兼容旧版本 `.excalidraw` 数据并修复绑定关系。

不采用 `<Excalidraw viewModeEnabled />` 方案，因为它本质仍是编辑器组件，会引入工具栏、键盘焦点、CSS、运行状态和导出截图复杂度。

## 输入格式

### 代码块

```md
```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [],
  "appState": {},
  "files": {}
}
```
```

同时兼容：

```md
```excalidraw-json
{
  "type": "excalidraw",
  "version": 2,
  "elements": []
}
```
```

`markdownRenderer.ts` 将上述语言标识输出为 `pre.language-excalidraw`，供后续 hook 扫描。

### 文件引用

```md
![系统架构草图](./diagrams/system.excalidraw)
```

Markdown 初始渲染仍生成普通 `<img>`。本地图片路径处理阶段必须先识别 `.excalidraw` 后缀，将该图片节点替换为 Excalidraw 文件占位节点，并跳过普通 `local-image://` 转换和图片 Lightbox 绑定：

```html
<div
  class="excalidraw-file-placeholder"
  data-excalidraw-src="./diagrams/system.excalidraw"
  data-excalidraw-alt="系统架构草图">
</div>
```

相对路径基于当前 Markdown 文件所在目录解析，并经过主进程已有路径安全校验。

文件引用导出必须依赖当前 Markdown 文件路径。如果没有 `markdownFilePath` 上下文，导出流程不得宣称支持 `.excalidraw` 文件引用，应输出可见错误占位和 warning。

## 渲染上下文

代码块渲染不需要文件路径上下文；`.excalidraw` 文件引用在预览和导出中都需要同一份路径上下文。

新增统一上下文类型：

```ts
interface ExcalidrawRenderContext {
  markdownFilePath?: string
}
```

需要调整的调用契约：

```ts
useExcalidrawChart(ref, html, {
  markdownFilePath: filePath,
})

buildExportHtmlContent(markdown, {
  markdownFilePath: exportTab.file.path,
})

renderChartsForDocx(markdown, {
  markdownFilePath: exportTab.file.path,
  onProgress,
})
```

文件树右键导出路径也必须传入被导出 Markdown 文件的路径，避免 `.excalidraw` 相对路径在导出中丢失基准目录。

## 渲染架构

新增 `src/renderer/src/utils/excalidrawRenderer.ts`。

职责：

- 解析 Excalidraw JSON。
- 校验输入大小、元素数量和文件体积。
- 使用 Excalidraw 官方恢复/校验工具规范化 `elements`、`appState`、`files`。
- 动态加载 `@excalidraw/excalidraw`。
- 调用对象参数形式的 `exportToSvg`。
- 返回结构化结果。

输出契约：

```ts
type ExcalidrawRenderResult =
  | {
      ok: true
      svg: string
      width: number
      height: number
      warnings: string[]
      sourceKind: 'code-block' | 'file-reference'
      sourceLabel?: string
    }
  | {
      ok: false
      error: string
      warnings: string[]
      sourceKind: 'code-block' | 'file-reference'
      sourceLabel?: string
      rawCode?: string
    }
```

新增 `src/renderer/src/components/charts/useExcalidrawChart.ts`。

职责：

- 扫描 `pre.language-excalidraw`。
- 扫描 `.excalidraw-file-placeholder`。
- 对代码块直接读取文本内容。
- 对文件引用通过安全 IPC 读取 `.excalidraw` 文件内容。
- 调用 `renderExcalidrawToSvg`。
- 替换为现有图表风格的 wrapper 结构。

预览 DOM 结构：

```html
<div class="excalidraw-wrapper" data-excalidraw-code="base64-encoded-json">
  <div class="excalidraw-warning" role="status" hidden></div>
  <div class="excalidraw-toggle-bar no-export" role="toolbar" aria-label="Excalidraw 图表工具栏">
    <button class="excalidraw-action-btn" data-action="toggleCode" title="查看代码" aria-label="查看 Excalidraw 源码">💻</button>
    <button class="excalidraw-action-btn" data-action="zoomIn" title="放大" aria-label="放大 Excalidraw 图表">🔍+</button>
    <button class="excalidraw-action-btn" data-action="zoomOut" title="缩小" aria-label="缩小 Excalidraw 图表">🔍−</button>
    <button class="excalidraw-action-btn" data-action="fit" title="适应大小" aria-label="适应 Excalidraw 图表大小">⊡</button>
    <button class="excalidraw-action-btn" data-action="download" title="下载图片" aria-label="下载 Excalidraw 图片">💾</button>
    <button class="excalidraw-action-btn" data-action="fullscreen" title="全屏查看" aria-label="全屏查看 Excalidraw 图表">⛶</button>
  </div>
  <div class="excalidraw-container" data-view="chart">
    <svg role="img" aria-label="Excalidraw 图表"></svg>
  </div>
  <div class="excalidraw-code-view" data-view="code" style="display:none">
    <pre class="language-json"><code>{ "type": "excalidraw", "elements": [] }</code></pre>
  </div>
</div>
```

交互能力对齐 Mermaid、Graphviz、DrawIO：

- 查看源码。
- 复制源码。
- 下载图片，默认复用现有图表的 PNG 下载行为。
- 放大。
- 缩小。
- 适应大小。
- 全屏查看。

如果后续要增加 SVG 下载，应作为统一图表下载体验升级处理，不让 Excalidraw 单独拥有不同的工具栏模型。

代码视图规则：

- 代码块来源：显示原始 JSON。
- 文件引用来源：顶部显示引用路径和解析后的文件名，主体显示读取到的 JSON。
- 错误状态下仍保留“查看源码/复制源码”能力；文件读取失败时至少显示引用路径。

加载状态：

- 首次动态加载 Excalidraw 渲染包时显示“正在渲染 Excalidraw”。
- 文件引用显示“正在读取 ./path/file.excalidraw”。
- 加载占位应设置稳定最小高度，减少渲染完成后的页面跳动。

## 文件引用读取

`.excalidraw` 文件读取不得在 renderer 进程直接绕过安全边界。

实现策略：

- 新增只读 IPC：`fs:readExcalidrawFile`，不要复用通用 `fs:readFile`。
- IPC 输入包含当前 Markdown 文件路径和引用路径。
- 主进程解析绝对路径。
- 主进程复用现有路径保护规则，确保文件位于授权目录内。
- 主进程限制文件大小。
- 成功后返回 UTF-8 文本内容和解析后的真实路径。

IPC 契约：

```ts
readExcalidrawFile(payload: {
  markdownFilePath: string
  refPath: string
}): Promise<{
  content: string
  resolvedPath: string
}>
```

主进程规则：

- `markdownFilePath` 必须通过 `validateSecurePath`。
- `refPath` 禁止 URL。
- `refPath` 可以是相对路径；绝对路径必须仍在授权目录内。
- 使用 `path.resolve(dirname(markdownFilePath), refPath)` 解析目标路径。
- 使用 `fs.realpath` 后再次校验未逃逸授权目录。
- 只允许 `.excalidraw` 扩展名。
- 目标必须是普通文件。
- 文件最大 1MB。
- 按 UTF-8 读取。

外部 URL 形式的 `.excalidraw` 文件首版不支持。

## 图片元素

Excalidraw 场景内的图片元素按以下规则处理：

- 如果 JSON 的 `files` 字段包含对应图片数据，直接传给 `exportToSvg`。
- 如果元素引用的图片缺失，继续渲染其他元素，并在 wrapper 上显示轻量警告。
- 不主动联网拉取外部图片。
- 不读取 JSON 外部的伴随图片目录。

## 导出设计

### HTML 和 PDF

在 `src/renderer/src/utils/exportHtml.ts` 中新增 `processExcalidrawInHtml(html, context)`。

处理流程：

- 扫描 `pre.language-excalidraw`。
- 扫描 Markdown 渲染后的 `.excalidraw` 图片引用或占位节点。
- 调用 `renderExcalidrawToSvg`。
- 替换为内联 SVG：

```html
<div class="excalidraw-container" style="width:100%; text-align:center; margin:1.5em 0;">
  <svg role="img" aria-label="Excalidraw 图表"></svg>
</div>
```

- 将 `excalidraw-container` 加入 `makeSvgsResponsiveInContainers()`，保证独立 HTML 和 PDF 等比缩放。
- `.excalidraw` 文件引用导出时必须使用 `buildExportHtmlContent(markdown, { markdownFilePath })` 提供的路径上下文读取文件，再使用同一渲染器生成 SVG。
- 如果文件引用导出失败，导出内容中保留可见错误块，不输出空白。

### DOCX

在 `src/renderer/src/utils/docxChartRenderer.ts` 中扩展现有图表管线。

调整点：

- `ChartType` 增加 `excalidraw`。
- `CHART_LANGS` 增加 `excalidraw` 和 `excalidraw-json`。
- `CONTAINER_CLASS_MAP` 增加 `excalidraw: 'excalidraw-container'`。
- `renderChartCodeToPng()` 增加 Excalidraw 分支，优先调用 `renderExcalidrawToSvg`。
- 复用现有 `svgToPng()`，包括 safe padding、`foreignObject` 检测、canvas 转 PNG、BrowserWindow 截图 fallback、白边裁剪。
- 渲染器失败时，从预览 DOM 中抓取 `.excalidraw-container svg` 作为 fallback。
- 额外扫描 Markdown 图片语法中的 `.excalidraw` 引用，读取文件内容后转 PNG，并将原图片引用替换成 DOCX 图片占位符。

DOCX 三条路径处理要求：

- 远程 DOCX：`renderChartsForDocx(markdown, { markdownFilePath })` 将代码块和 `.excalidraw` 图片引用都替换为图片占位符，并通过 `remoteImages` 提供 PNG。
- 本地 docx 库：复用同一份 `modifiedMarkdown` 和 `ChartImage[]`。
- Pandoc：HTML 阶段必须已把 `.excalidraw` 转为内联 SVG 或 data URI 图片；不能把原始 `.excalidraw` 路径交给 Pandoc。

导出反馈：

- Excalidraw 导出失败应写入现有导出 warning 集合。
- 远程 DOCX 任务面板应显示当前处理类型 `excalidraw`。
- 导出后的文档中必须保留错误占位，避免用户只看到空白。
- 使用 DOM fallback 或 BrowserWindow fallback 时记录 warning，便于排查导出质量。

## 安全限制

默认限制：

- 单个 Excalidraw 代码块或 `.excalidraw` 文件最大 1MB。
- 单个场景最多 2000 个元素。
- `files` 总体积最多 10MB。
- 单页最多渲染 20 个 Excalidraw 图表。
- Excalidraw 渲染并发上限为 1，按顺序处理，避免多个 `exportToSvg` 同时阻塞 UI。
- 只接受 JSON 对象。
- 标准格式要求 `type: "excalidraw"` 和 `elements` 数组。
- 缺少 `type` 但存在 `elements` 数组时进入兼容模式，并显示警告。
- 禁止加载远程 URL 图片。
- `.excalidraw` 文件引用必须通过主进程路径安全校验。
- 渲染 SVG 时禁用或跳过 embeddable 元素渲染，避免外部嵌入内容执行或联网。
- `files` 只允许 `data:image/*` 类图片数据，限制 MIME 类型和总大小。
- 导出前对 SVG 做最小清理：移除事件属性、外链 URL、未知 `foreignObject`，保留官方 SVG 基本结构。
- DOCX PNG 转换必须限制最大输出像素，防止大画布转 canvas 导致内存暴涨。
- 渲染器可按内容 hash 缓存 SVG，预览与导出复用结果，减少重复渲染成本。

错误处理：

- 单个图表失败只替换该图表为错误块。
- 整篇 Markdown 渲染不能被单个 Excalidraw 错误中断。
- 错误消息必须做 HTML 转义。
- 错误文案应区分路径错误、权限错误、文件过大、JSON 格式错误、缺少 `elements`、图片资源缺失。

错误块结构：

```html
<div class="excalidraw-error" role="alert">
  <div class="error-title">Excalidraw 渲染失败</div>
  <div class="error-message">JSON 格式错误</div>
  <button class="excalidraw-action-btn no-export" data-action="toggleCode" aria-label="查看 Excalidraw 源码">查看源码</button>
</div>
```

空场景：

- `elements` 为空时不报错。
- 显示轻量空状态：“Excalidraw 画布为空”。
- 文件引用来源显示文件名，例如：“system.excalidraw 画布为空”。
- 源码仍可查看和复制。

部分成功：

- 缺失图片、兼容模式、部分元素跳过时，在图表上方显示非阻断 warning。
- warning 文案应说明影响，例如：“有 3 个图片资源缺失，已渲染其余元素”。
- warning 是否进入导出文档应保持一致；默认保留轻量 warning，避免导出结果误导用户。

## 样式

新增样式应复用现有图表模式：

- `.excalidraw-wrapper`
- `.excalidraw-toggle-bar`
- `.excalidraw-action-btn`
- `.excalidraw-container`
- `.excalidraw-code-view`
- `.excalidraw-back-btn`
- `.excalidraw-error`

样式行为：

- 工具栏悬停显示。
- 工具栏在 `focus-within` 时也必须显示，保证键盘用户可操作。
- SVG 最大宽度 100%，高度自动。
- 支持全屏。
- 支持横向溢出时滚动。
- 深色和浅色主题下保持可读。
- 错误块使用 `role="alert"`。
- 警告条使用 `role="status"`。
- SVG 的 `aria-label` 优先使用 Markdown 图片 alt、文件名或邻近标题，不固定为同一文案。

## UX 状态规范

必须定义并实现以下状态：

- 渲染中：显示稳定占位和当前动作。
- 文件读取失败：显示引用路径、失败原因和查看源码/复制路径入口。
- 文件内容失败：区分空文件、非 JSON、缺少 `elements`、不是 Excalidraw 场景。
- 限制命中：显示命中的限制值，例如“文件超过 1MB，未渲染”。
- 部分成功：显示缺失图片或兼容模式 warning。
- 复制成功/失败：按钮文案临时反馈，与现有图表复制行为一致。
- 下载成功/失败：复用现有下载反馈；失败时显示错误提示。
- 全屏：支持键盘退出，不依赖鼠标。
- 导出失败：进入现有 toast 或导出任务面板 warning，并在导出文档中保留错误占位。

## 测试策略

### 单元测试

`markdownRenderer.test.ts`：

- `excalidraw` 代码块输出 `pre.language-excalidraw`。
- `excalidraw-json` 代码块归一为 `pre.language-excalidraw`。

`excalidrawRenderer.test.ts`：

- 合法 Excalidraw JSON 能生成 SVG。
- 非 JSON 返回明确错误。
- 缺少 `elements` 返回明确错误。
- 空 `elements` 返回空状态。
- 超过大小限制时拒绝渲染。
- 缺失图片文件时返回警告但不整体失败。
- `exportToSvg` 使用对象参数调用。
- 兼容模式会返回 warning。

`fileHandlers` 相关测试：

- `fs:readExcalidrawFile` 只能读取 `.excalidraw`。
- 相对路径基于 Markdown 文件目录解析。
- 路径越界、符号链接逃逸、超过 1MB、目录路径都会失败。

`docxChartRenderer` 相关测试：

- `excalidraw` 代码块被识别为图表。
- 成功生成 placeholder 图片。
- 渲染失败时产生 warning，不中断导出。
- `.excalidraw` 图片引用在提供 `markdownFilePath` 时能生成 placeholder 图片。
- 缺少 `markdownFilePath` 时文件引用生成 warning 和错误占位。

### E2E

新增 fixture 文件：

```text
e2e/fixtures/test-excalidraw.md
e2e/fixtures/excalidraw/basic-flow.excalidraw
e2e/fixtures/excalidraw/embedded-image.excalidraw
e2e/fixtures/excalidraw/empty.excalidraw
e2e/fixtures/excalidraw/invalid-json.excalidraw
```

`test-excalidraw.md` 应仿照 `test-mermaid.md`、`test-graphviz.md`、`test-drawio.md` 的组织方式，作为人工预览、自动化截图和导出回归共用的综合测试文档。它不只放最小样例，还要覆盖正常、复杂、错误、边界和跨图表对比场景。

建议渲染用例：

| 编号 | 用例 | 输入方式 | 验收重点 |
| --- | --- | --- | --- |
| 1 | 基础矩形和文本 | `excalidraw` 代码块 | 能生成 SVG，中文文本可见 |
| 2 | 箭头连接流程 | `excalidraw` 代码块 | 箭头、端点、标签位置正确 |
| 3 | 多形状组合 | `excalidraw` 代码块 | 矩形、菱形、椭圆、线条正常 |
| 4 | 手绘风格与样式 | `excalidraw` 代码块 | stroke、background、roughness、opacity 生效 |
| 5 | 分组和层级 | `excalidraw` 代码块 | groupIds、z-index、遮挡关系正确 |
| 6 | Frame 或容器类画布 | `excalidraw` 代码块 | 视口尺寸和留白合理 |
| 7 | 中文长文本 | `excalidraw` 代码块 | 多行、长文本、标点不丢失 |
| 8 | Unicode 字符 | `excalidraw` 代码块 | 数学符号、箭头符号、少量 emoji 不破坏渲染 |
| 9 | 含 `files` 图片元素 | `excalidraw` 代码块 | 内嵌图片可显示 |
| 10 | 缺失图片资源 | `excalidraw` 代码块 | 其余元素继续渲染，并显示 warning |
| 11 | 本地 `.excalidraw` 引用 | Markdown 图片语法 | `![alt](./excalidraw/basic-flow.excalidraw)` 可渲染 |
| 12 | 文件引用的 alt 文案 | Markdown 图片语法 | SVG `aria-label` 优先使用 alt |
| 13 | 空画布 | 文件引用和代码块各一例 | 显示空状态，不报错 |
| 14 | 错误 JSON | 代码块 | 显示错误块，可查看源码 |
| 15 | 非 Excalidraw JSON | 代码块 | 明确提示缺少 `elements` 或类型错误 |
| 16 | 文件不存在 | Markdown 图片语法 | 显示引用路径和读取失败原因 |
| 17 | 扩展名不允许 | Markdown 图片语法 | `.json` 或远程 URL 不走 Excalidraw 读取 |
| 18 | 同页多图 | 混合代码块和文件引用 | 多个图表独立渲染，互不污染工具栏状态 |
| 19 | 与 Mermaid 对比 | 同一流程双格式 | Excalidraw 和 Mermaid 均正常渲染 |
| 20 | 与 Graphviz 对比 | 同一有向图双格式 | Excalidraw 和 Graphviz 均正常渲染 |
| 21 | 与 DrawIO 对比 | 同一流程双格式 | Excalidraw 和 DrawIO 均正常渲染 |
| 22 | 大画布说明用例 | 小型模拟或说明段落 | 验证滚动、fit、导出尺寸限制 |

独立 `.excalidraw` 文件要求：

- `basic-flow.excalidraw`：真实有效 Excalidraw JSON，包含矩形、菱形、箭头、中文文本。
- `embedded-image.excalidraw`：包含一个很小的 base64 图片，验证 `files` 图片链路。
- `empty.excalidraw`：`elements: []`，验证空状态。
- `invalid-json.excalidraw`：故意无效 JSON，验证文件内容错误。
- 如需验证文件不存在和越界路径，不创建真实文件，只在 `test-excalidraw.md` 中引用不存在路径。

验收点：

- 打开 fixture 后 `.excalidraw-wrapper` 可见。
- 正常示例内有 SVG。
- 工具栏可切换源码视图。
- 下载图片按钮不报错。
- HTML 导出包含 `.excalidraw-container` 和 SVG。
- PDF 导出不出现空白占位。
- DOCX 导出中 Excalidraw 被替换成图片。
- 错误样例显示错误块，不影响其他图表。
- 文件引用失败时显示具体路径和原因。
- 缺失图片时显示 warning。
- 工具栏按钮可键盘聚焦，`focus-within` 时可见。

## 实施顺序

1. 增加 Markdown 语言识别和 DOMPurify 白名单。
2. 增加渲染上下文类型，并调整 HTML/PDF/DOCX 导出调用点传入 `markdownFilePath`。
3. 增加专用 `fs:readExcalidrawFile` IPC 和安全测试。
4. 增加 Excalidraw renderer 工具模块。
5. 增加预览 hook、加载/错误/警告状态和样式。
6. 接入 `.excalidraw` 文件引用预览。
7. 接入 HTML/PDF 导出。
8. 接入 DOCX 图表图片管线。
9. 增加 fixture、单元测试和 E2E 测试。

## 待用户确认后的实施计划

本设计确认后，下一步生成详细实施计划，保存到：

```text
docs/superpowers/plans/2026-05-02-excalidraw-rendering.md
```
