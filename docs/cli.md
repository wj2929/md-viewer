# MD Viewer CLI 使用指南

适用版本：MD Viewer v2.5.0 及以上。

MD Viewer CLI 面向脚本、CI 和 AI Agent，用于打开 Markdown、导出 HTML/PDF/DOCX、截图、提取图表、检查环境、分析文档结构和批量回归真实文档。

如果你第一次使用 CLI，建议先看 [CLI 快速上手](cli-quickstart.md)。本文档是完整参考，包含参数、JSON 契约和错误码。

## 1. 调用方式

文档中统一使用 `md-viewer` 表示命令入口。macOS、Windows 和 Linux 用户都可以在“设置 -> 系统 -> 命令行工具”中安装该命令，也可以先用应用完整路径执行一次安装命令。

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
md-viewer capabilities --json
```

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
```

HTML/PDF 走 headless renderer 和共享导出 writer，目标是与 GUI 导出保持一致。复杂图表较多时可加 `--timeout-ms`，单位是毫秒；默认 `120000`。如果返回 `renderStatus: "timeout"`，命令会以失败状态退出；此时可能仍有诊断用产物，但不应作为最终交付文件。

### DOCX

```bash
md-viewer export README.md --format docx --docx-style preview --out README.docx
md-viewer export README.md --format docx --docx-style report --docx-service http://127.0.0.1:3179 --out report.docx
```

DOCX 依赖 `md-viewer-docx-service`。可用样式：

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

`doctor` 检查当前环境和服务：

```bash
md-viewer doctor --json
md-viewer doctor --docx-service http://127.0.0.1:3179 --json
```

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

当前会检查本地 Markdown 链接、页内锚点、跨文件锚点、图片资源和外链分类；不会默认联网验证外链可访问性。

`render` 做诊断渲染，可选写出中间 HTML：

```bash
md-viewer render README.md --json
md-viewer render README.md --out render.html --json
```

`render` 用于排查图表渲染数量、失败 warning 和图表 selector，不替代正式 `export html/pdf/docx`。

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
| `4` | 导出或诊断依赖不可用。 |
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
- `render` 是诊断命令，不保证输出 HTML 适合作为最终交付文件。
- DOCX 导出依赖 `md-viewer-docx-service`，服务版本、字体和 renderer artifact 会影响结果。
- `watch`、`serve`、`diff`、`mcp`、`completion` 尚未产品化，属于后续版本范围。
