# MD Viewer CLI 使用指南

适用版本：MD Viewer v2.9.0 开发版（尚未发布）。CLI 基础命令自 v2.5.0 起提供；本文的本地媒体和 Wiki 支持等新增行为以 v2.9.0 为准，已发布版本以其对应文档为准。

MD Viewer CLI 面向脚本、CI 和 AI Agent，用于打开 Markdown、导出 HTML/PDF/DOCX、截图、提取图表、检查环境、分析文档结构和批量回归真实文档。

如果你第一次使用 CLI，建议先看 [CLI 快速上手](cli-quickstart.md)。本文档是完整参考，包含参数、JSON 契约和错误码。

## 1. 调用方式

文档中统一使用 `md-viewer` 表示命令入口。注意：macOS“设置 -> 系统 -> 命令行工具”提供的是 Apple 的 Command Line Tools（如 git、clang），**不会自动安装 md-viewer 命令**。MD Viewer CLI 需要通过应用内置命令安装 shim，或使用应用完整路径执行一次安装命令。

macOS：

```bash
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" install-cli --json
```

Windows：

```powershell
& "C:\Program Files\MD Viewer\MD Viewer.exe" install-cli --json
```

Linux：

```bash
./MD-Viewer-*.AppImage install-cli --json
```

如果安装结果提示命令目录不在 `PATH` / `Path`，按 JSON 里的 `actions[]` 提示更新终端配置后重新打开终端。

macOS 示例：

```bash
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" capabilities --json
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" export README.md --format pdf --out README.pdf
```

Windows 示例：

```powershell
& "C:\Program Files\MD Viewer\MD Viewer.exe" capabilities --json
& "C:\Program Files\MD Viewer\MD Viewer.exe" export README.md --format pdf --out README.pdf
```

Linux 示例：

```bash
./MD-Viewer-*.AppImage capabilities --json
./MD-Viewer-*.AppImage export README.md --format pdf --out README.pdf
```

安装命令行工具后，可直接使用：

```bash
md-viewer --help
md-viewer --version
md-viewer capabilities --json
```

如果终端提示 `md-viewer: command not found`，先确认 shim 状态：

```bash
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" install-cli --status --json
```

该检查不会修改系统，会报告 shim 路径、是否由 MD Viewer 生成、目标应用是否存在以及目录是否在当前 `PATH`。如果目录不在 `PATH`，将 `~/.local/bin` 加入 `~/.zshrc` 后重新打开终端；如果目标应用路径失效，应从当前安装位置重新执行 `install-cli`。

## 2. 输出契约

除 `md-viewer help` 的人类模式外，自动化命令输出 JSON。建议脚本和 AI Agent 总是加 `--json`，并读取 `ok`、`summary`、`warnings`、`actions` 和 `artifacts`。

成功结果示例：

```json
{
  "schemaVersion": "1.0",
  "ok": true,
  "command": "export",
  "summary": {
    "format": "pdf",
    "renderedCharts": 3,
    "failedCharts": 0
  },
  "results": {},
  "artifacts": [
    { "type": "pdf", "path": "README.pdf", "bytes": 120000 }
  ],
  "warnings": [],
  "actions": []
}
```

失败结果示例：

```json
{
  "schemaVersion": "1.0",
  "ok": false,
  "command": "export",
  "code": "DOCX_SERVICE_UNAVAILABLE",
  "message": "无法连接 DOCX 服务",
  "target": "docx-service",
  "summary": {},
  "results": {},
  "artifacts": [],
  "warnings": [],
  "actions": [
    {
      "label": "检查 DOCX 服务",
      "command": "md-viewer doctor --json",
      "target": "docx-service",
      "risk": "safe"
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | CLI 输出契约版本，v2.5.0 为 `1.0`。 |
| `ok` | 命令是否完成目标。 |
| `command` | 实际执行的命令。 |
| `summary` | 摘要指标，供人和 AI 快速判断。 |
| `results` | 结构化详细结果，例如图表、链接、标题。 |
| `artifacts` | 生成文件列表，例如 PDF、DOCX、PNG、ZIP、报告。 |
| `warnings` | 非阻断问题，包含 `code`、`message`、`target`。 |
| `actions` | 建议下一步，包含 `label`、`command`、`target`、`risk`。 |
| `diagnostics` | 环境、服务或依赖诊断上下文。 |

`actions[].risk` 可能为 `safe`、`writes-file`、`network`、`starts-service`、`destructive`。CLI 只输出建议，不会自动执行 `actions[].command`。

## 3. 能力发现

AI Agent 或脚本应先发现当前版本能力，再调用具体命令。

```bash
md-viewer capabilities --json
md-viewer schema --json
md-viewer schema export --json
md-viewer schema result --json
md-viewer help export --json
```

常见调用顺序：

```bash
md-viewer capabilities --json
md-viewer schema export --json
md-viewer preflight report.md --format docx --json
md-viewer export report.md --format docx --docx-style preview --out report.docx
```

## 4. 安装命令行工具

macOS、Windows 和 Linux 支持安装和卸载 `md-viewer` 命令：

```bash
md-viewer install-cli --json
md-viewer uninstall-cli --json
```

如果当前系统还没有 `md-viewer` 命令，可以先用应用完整路径执行安装。

macOS：

```bash
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" install-cli --json
```

Windows：

```powershell
& "C:\Program Files\MD Viewer\MD Viewer.exe" install-cli --json
```

Linux：

```bash
./MD-Viewer-*.AppImage install-cli --json
```

安装器写入的位置：

- macOS：优先 `/usr/local/bin/md-viewer`，无写权限时使用 `~/.local/bin/md-viewer`。
- Windows：`%LOCALAPPDATA%\MD Viewer\bin\md-viewer.cmd`。
- Linux：`~/.local/bin/md-viewer`。

如果目标目录不在 `PATH` / `Path`，CLI 会在 JSON 的 `actions[]` 中给出处理建议。卸载时只删除 MD Viewer 生成的 shim，不会删除同名的外部命令。

## 5. 打开文件或目录

`open` 会打开 GUI，适合从外部工具跳转到 MD Viewer。

```bash
md-viewer open README.md
md-viewer open README.md --line 120
md-viewer open README.md --heading "部署说明"
md-viewer open /path/to/docs
```

说明：

- 文件或目录不存在时返回结构化错误。
- `open` 不是 headless 命令，会进入正常桌面窗口流程。

## 6. 导出文件

### HTML / PDF

```bash
md-viewer export README.md --format html --out README.html
md-viewer export README.md --format pdf --out README.pdf
md-viewer export README.md --format pdf --out README.pdf --timeout-ms 180000
md-viewer export ch1.md ch2.md ch3.md --format pdf --out book.pdf
```

HTML/PDF 走 headless renderer 和共享导出 writer，与 GUI 导出保持一致：含代码高亮样式、markdown 主题样式，并把 `<img>` 和 Wiki 图片引用的本地图片内嵌为 `data:base64`（换机打开不裂图；越界或系统敏感路径的图片保持原样不内嵌）。HTML 中的本地音视频不会 Base64 内嵌，而是保留相对于最终 HTML 的 source、WebVTT track 和 poster 链接；命令不会复制这些 sidecar，单独移动 HTML 会使媒体失效。PDF 将视频降级为 poster 加说明、音频降级为文字卡。复杂图表较多时可加 `--timeout-ms`，单位是毫秒；默认 `120000`。如果返回 `renderStatus: "timeout"`，命令会以失败状态退出；此时可能仍有诊断用产物，但不应作为最终交付文件。

**多文件合并**：传入多个 Markdown 路径时，按命令行顺序合并为一份 HTML、PDF 或 DOCX，文件之间自动插入分页符。HTML/PDF 会分别按每个文件的**自身目录**解析并内嵌本地图片；DOCX 会为各文件的本地图片建立独立资源命名空间，避免同名图片冲突，并要求 DOCX 服务支持 `<!-- pagebreak -->` 硬分页标记。可选 `--title` 指定文档标题（默认取第一个文件名）。`summary.inputs` 会列出全部输入文件，图表统计为各文件累加；任一文件渲染超时或有图表失败，整体以失败状态退出。

### DOCX

```bash
md-viewer export README.md --format docx --docx-style preview --out README.docx
md-viewer export README.md --format docx --docx-style report --docx-service http://127.0.0.1:3179 --out report.docx
```

DOCX 依赖 `md-viewer-docx-service`。本地音视频不会上传到服务：Wiki embed 和原生 `<video>` / `<audio>` 会在发送前转换为普通相对链接，解析或授权失败时转换为说明文字。可用样式：

| 样式 | 说明 |
| --- | --- |
| `preview` | 尽量贴近 MD Viewer 预览效果。 |
| `standard` | 通用标准文档。 |
| `official` | 公文类样式。 |
| `internal` | 内部材料样式。 |
| `report` | 报告类样式。 |

可选参数：

| 参数 | 说明 |
| --- | --- |
| `--docx-service` | DOCX 服务地址，默认 `http://127.0.0.1:3179`。 |
| `--docx-api-key` | DOCX 服务 API Key。 |
| `--embed-font` | 请求 DOCX 服务按需嵌入可用字体。 |

## 7. 导出前检查与环境诊断

`preflight` 检查单个文档对某个格式的导出风险：

```bash
md-viewer preflight README.md --format pdf --json
md-viewer preflight README.md --format docx --docx-service http://127.0.0.1:3179 --json
```

`doctor` 检查运行时基础信息和可选 DOCX 服务健康状态：

```bash
md-viewer doctor --json
md-viewer doctor --docx-service http://127.0.0.1:3179 --json
md-viewer doctor --bundle diagnostics.zip --json
```

`--bundle` 生成只保存到指定位置的脱敏诊断 ZIP。ZIP 不含 Markdown 正文、文件名、绝对路径、搜索词、语音文本、API Key、argv 或环境变量，也不会自动上传。

建议在 DOCX 导出失败时先运行：

```bash
md-viewer doctor --json
```

## 8. 截图

```bash
md-viewer screenshot README.md --out README.png
md-viewer screenshot README.md --selector ".markdown-body" --out README-body.png
md-viewer screenshot README.md --chart 3 --out chart-03.png
```

可选参数：

| 参数 | 说明 |
| --- | --- |
| `--selector` | 截取 CSS selector 对应区域。 |
| `--chart` | 截取第 N 个图表。 |
| `--width` / `--height` | 设置视口宽高。 |
| `--theme` | `light` 或 `dark`。 |
| `--scale` | 设备缩放倍率。 |
| `--timeout-ms` | headless 渲染超时，单位毫秒，默认 `120000`。 |

## 9. 图表列表与导出

```bash
md-viewer charts list README.md --json
md-viewer charts export README.md --out README-charts.zip
md-viewer charts export README.md --out-dir README-charts
md-viewer charts export README.md --out README-charts.zip --timeout-ms 180000
```

`charts list` 返回图表类型、序号、selector、尺寸和源码定位。`charts export` 可输出 ZIP 或目录，适合后续放入 PPT、Word 或制品库。

## 10. 文档分析

`inspect` 输出标题、图片、链接、代码块和图表结构：

```bash
md-viewer inspect README.md --json
```

`links` 聚焦链接健康：

```bash
md-viewer links README.md --json
```

当前会检查标准与 Wiki 形式的本地 Markdown 链接、页内锚点、跨文件标题与受支持的 `#^block-id`、图片及音视频资源和外链分类。Wiki 文件名先按当前目录解析，再接受当前 CLI 根目录内唯一 basename；多个候选会报告 `WIKI_LINK_AMBIGUOUS`，不会任意选择。命令不会默认联网验证外链可访问性。

CLI 不隐式向上发现工作区、不读取 GUI profile，也不为了别名递归读取全树 frontmatter。普通裸 Wiki 名称没有命中文件时，结果带 `checkStatus: "alias-not-checked"`，不设置 `exists`，不计入确定的缺失文件；明确 `.md` 路径与嵌入卡片仍按原规则检查。`links` 的 `status: "ok"` 只代表未发现确定错误，仍须查看这类未检查项；JSON 成功封装和退出码规则不变。

块 ID 大小写敏感，重复块以 `ambiguous: true` 标明，不能视为可唯一定位。检查同页或已经按文件名解析出的文档，不追踪 GUI 未保存草稿。完整 HTML 渲染器提供同页块锚点；基本 Markdown fallback 不承诺等价支持，不扩展跨文件别名导出、PDF 内链或 DOCX Word 书签。

`render` 做诊断渲染，可选写出中间 HTML：

```bash
md-viewer render README.md --json
md-viewer render README.md --out render.html --json
```

`render` 用于排查图表渲染数量、失败 warning 和图表 selector，不替代正式 `export html/pdf/docx`。

`diff` 比较两个 Markdown 文件的语义结构，而不是逐字节或像素比较：

```bash
md-viewer diff before.md after.md --json
md-viewer diff before.md after.md --fail-on-change --json
```

比较 front matter、标题、段落、链接、图片、代码块和图表块；默认忽略 BOM、CRLF/LF 与行尾空格。默认检测到差异仍返回成功；使用 `--fail-on-change` 时返回 `DIFF_FOUND` 和 exit code 4。仅接受 Markdown 文件，不接受 `.excalidraw`。

`watch` 以只读 JSONL 流监听 Markdown 文件或目录：

```bash
md-viewer watch README.md --jsonl
md-viewer watch docs --jsonl --max-events 10
md-viewer watch docs --jsonl --timeout 30000
```

stdout 每行都是可独立 `JSON.parse` 的对象，事件包括 `initial`、`ready`、`added`、`changed`、`removed`、`renamed`、`error` 和 `stopped`。`renamed` 是启发式提示并携带 `inferred: true`；原始 `removed/added` 事件仍保留。支持 `SIGINT`、`SIGTERM`、`--max-events` 和 `--timeout` 正常结束。日志只写 stderr，不创建工作区索引或 GUI 业务设置。

以上 `inspect`、`render`、`links`、`diff`、`watch` 当前均为 experimental，机器调用前应通过 `capabilities --json` 确认稳定性字段。

## 11. 批量回归

`batch` 用于 fixture 或真实文档批量回归。

```bash
md-viewer batch e2e/local-real-docs.json --out /tmp/md-viewer-release-report.json --artifacts-dir /tmp/md-viewer-cli-artifacts
```

配置示例：

```json
{
  "documents": [
    {
      "path": "e2e/fixtures/test-all-charts.md",
      "exports": ["html", "pdf", "docx"],
      "screenshots": ["page", "charts"],
      "expectCharts": true,
      "tags": ["fixture", "chart-heavy"],
      "timeoutMs": 180000
    }
  ]
}
```

可选参数：

| 参数 | 说明 |
| --- | --- |
| `--out` | JSON 报告路径。 |
| `--report-md` | Markdown 报告路径。 |
| `--artifacts-dir` | 批量导出、截图和图表产物目录。 |
| `--fail-fast` | 首个失败后停止。 |

建议：

- 私有真实文档清单使用 `e2e/local-real-docs.json`，不要提交。
- 产物优先放 `/tmp` 或 `test-results/cli-*`。
- 真实文档路径、内网服务地址和 API Key 不要写入公开 Issue 或 Release。

## 12. Exit Code

| Code | 含义 |
| --- | --- |
| `0` | 成功。 |
| `1` | 普通失败。 |
| `2` | 参数错误。 |
| `3` | 输入文件不存在或不可读。 |
| `4` | 使用 `diff --fail-on-change` 检测到语义差异，或导出/诊断依赖不可用（以结果 `code` 区分）。 |
| `5` | 渲染失败。 |
| `6` | 输出路径不可写。 |
| `7` | 批量任务部分失败。 |
| `8` | 质量检查未通过。 |

## 13. AI Agent 调用建议

推荐流程：

1. 如果系统没有 `md-viewer` 命令，先用应用完整路径执行 `install-cli --json`，或直接用应用完整路径调用后续命令。
2. 运行 `capabilities --json`，确认命令和图表能力。
3. 运行 `schema <command> --json`，确认参数和输出契约。
4. 写文件前先运行 `preflight` 或 `inspect`。
5. 执行 `export`、`screenshot`、`charts export` 或 `batch`。
6. 解析 `ok`、`warnings`、`actions`、`artifacts`。
7. 只有在用户允许时，才执行 `actions[].command` 中可能写文件、启动服务或联网的动作。

## 14. 当前限制

- `links` 默认不联网检查外链。
- CLI 的本地资源授权根是每个源 Markdown 所在目录，比 GUI 中已打开的工作区范围更严格；Wiki basename 查找、HTML 链接型媒体导出和 DOCX 媒体降级都不会越出此根目录。
- HTML 音视频导出不是自包含文件，不复制媒体、字幕或 poster sidecar；PDF/DOCX 仅保留静态说明、poster 或普通链接。
- `render` 是诊断命令，不保证输出 HTML 适合作为最终交付文件。
- DOCX 导出依赖 `md-viewer-docx-service`，服务版本、字体和 renderer artifact 会影响结果。
- `watch`、`diff` 已提供 experimental 契约；`serve`、`mcp`、`completion` 尚未产品化，属于后续版本范围。
