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

渲染器从 Excalidraw JSON 中读取 `elements`、`appState`、`files`，动态加载 `@excalidraw/excalidraw`，调用官方 `exportToSvg` 生成 SVG。预览中插入 SVG；HTML/PDF 导出中内联 SVG；DOCX 导出中将 SVG 转 PNG 后写入文档。

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

Markdown 初始渲染仍生成普通 `<img>`。本地图片路径处理阶段识别 `.excalidraw` 后缀，将该图片节点替换为 Excalidraw 文件占位节点：

```html
<div
  class="excalidraw-file-placeholder"
  data-excalidraw-src="./diagrams/system.excalidraw"
  data-excalidraw-alt="系统架构草图">
</div>
```

相对路径基于当前 Markdown 文件所在目录解析，并经过主进程已有路径安全校验。

## 渲染架构

新增 `src/renderer/src/utils/excalidrawRenderer.ts`。

职责：

- 解析 Excalidraw JSON。
- 校验输入大小、元素数量和文件体积。
- 规范化 `elements`、`appState`、`files`。
- 动态加载 `@excalidraw/excalidraw`。
- 调用 `exportToSvg(elements, appState, files)`。
- 返回 SVG 字符串、尺寸和警告。

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
  <div class="excalidraw-toggle-bar no-export">
    <button class="excalidraw-action-btn" data-action="toggleCode" title="查看代码">💻</button>
    <button class="excalidraw-action-btn" data-action="downloadSvg" title="下载 SVG">SVG</button>
    <button class="excalidraw-action-btn" data-action="downloadPng" title="下载 PNG">PNG</button>
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
- 下载 SVG。
- 下载 PNG。
- 放大。
- 缩小。
- 适应大小。
- 全屏查看。

## 文件引用读取

`.excalidraw` 文件读取不得在 renderer 进程直接绕过安全边界。

实现策略：

- 复用现有文件读取 IPC 能力，或新增只读 IPC：`fs:readExcalidrawFile`。
- IPC 输入包含当前 Markdown 文件路径和引用路径。
- 主进程解析绝对路径。
- 主进程复用现有路径保护规则，确保文件位于授权目录内。
- 主进程限制文件大小。
- 成功后返回 UTF-8 文本内容。

外部 URL 形式的 `.excalidraw` 文件首版不支持。

## 图片元素

Excalidraw 场景内的图片元素按以下规则处理：

- 如果 JSON 的 `files` 字段包含对应图片数据，直接传给 `exportToSvg`。
- 如果元素引用的图片缺失，继续渲染其他元素，并在 wrapper 上显示轻量警告。
- 不主动联网拉取外部图片。
- 不读取 JSON 外部的伴随图片目录。

## 导出设计

### HTML 和 PDF

在 `src/renderer/src/utils/exportHtml.ts` 中新增 `processExcalidrawInHtml(html)`。

处理流程：

- 扫描 `pre.language-excalidraw`。
- 调用 `renderExcalidrawToSvg`。
- 替换为内联 SVG：

```html
<div class="excalidraw-container" style="width:100%; text-align:center; margin:1.5em 0;">
  <svg role="img" aria-label="Excalidraw 图表"></svg>
</div>
```

- 将 `excalidraw-container` 加入 `makeSvgsResponsiveInContainers()`，保证独立 HTML 和 PDF 等比缩放。
- `.excalidraw` 文件引用导出时解析图片语法或占位节点，读取文件后使用同一渲染器生成 SVG。

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

## 安全限制

默认限制：

- 单个 Excalidraw 代码块或 `.excalidraw` 文件最大 1MB。
- 单个场景最多 2000 个元素。
- `files` 总体积最多 10MB。
- 只接受 JSON 对象。
- 标准格式要求 `type: "excalidraw"` 和 `elements` 数组。
- 缺少 `type` 但存在 `elements` 数组时进入兼容模式，并显示警告。
- 禁止加载远程 URL 图片。
- `.excalidraw` 文件引用必须通过主进程路径安全校验。

错误处理：

- 单个图表失败只替换该图表为错误块。
- 整篇 Markdown 渲染不能被单个 Excalidraw 错误中断。
- 错误消息必须做 HTML 转义。

错误块结构：

```html
<div class="excalidraw-error">
  <div class="error-title">Excalidraw 渲染失败</div>
  <div class="error-message">JSON 格式错误</div>
</div>
```

空场景：

- `elements` 为空时不报错。
- 显示轻量空状态：“Excalidraw 画布为空”。
- 源码仍可查看和复制。

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
- SVG 最大宽度 100%，高度自动。
- 支持全屏。
- 支持横向溢出时滚动。
- 深色和浅色主题下保持可读。

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

`docxChartRenderer` 相关测试：

- `excalidraw` 代码块被识别为图表。
- 成功生成 placeholder 图片。
- 渲染失败时产生 warning，不中断导出。

### E2E

新增 fixture：

```text
e2e/fixtures/test-excalidraw.md
```

覆盖内容：

- 基础矩形和文本。
- 箭头和中文标签。
- 多元素流程图。
- 含 `files` 图片元素。
- `.excalidraw` 文件引用。
- 空画布。
- 错误 JSON。

验收点：

- 打开 fixture 后 `.excalidraw-wrapper` 可见。
- 正常示例内有 SVG。
- 工具栏可切换源码视图。
- 下载 PNG/SVG 按钮不报错。
- HTML 导出包含 `.excalidraw-container` 和 SVG。
- PDF 导出不出现空白占位。
- DOCX 导出中 Excalidraw 被替换成图片。
- 错误样例显示错误块，不影响其他图表。

## 实施顺序

1. 增加 Markdown 语言识别和 DOMPurify 白名单。
2. 增加 Excalidraw renderer 工具模块。
3. 增加预览 hook 和样式。
4. 增加 `.excalidraw` 文件引用读取链路。
5. 接入 HTML/PDF 导出。
6. 接入 DOCX 图表图片管线。
7. 增加 fixture、单元测试和 E2E 测试。

## 待用户确认后的实施计划

本设计确认后，下一步生成详细实施计划，保存到：

```text
docs/superpowers/plans/2026-05-02-excalidraw-rendering.md
```
