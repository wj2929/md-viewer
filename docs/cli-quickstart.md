# MD Viewer CLI 快速上手

适用版本：MD Viewer v2.5.0 及以上。

CLI 让你不用手动点界面，也能让 MD Viewer 打开 Markdown、导出 PDF/DOCX、截图、导出图表、检查 DOCX 服务和批量测试文档。

## 1. 先跑通第一条命令

如果系统里已经有 `md-viewer` 命令，先运行：

```bash
md-viewer capabilities --json
```

能看到 JSON 输出，就说明 CLI 可以用了。

如果提示找不到 `md-viewer`，可以先直接用应用路径。

macOS：

```bash
"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" capabilities --json
```

Windows：

```powershell
& "C:\Program Files\MD Viewer\MD Viewer.exe" capabilities --json
```

Linux：

```bash
./MD-Viewer-*.AppImage capabilities --json
```

如果你希望以后直接使用 `md-viewer` 命令，可以任选一种方式安装命令行工具：

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

也可以打开 MD Viewer，在“设置 -> 系统 -> 命令行工具”中安装。

安装后重新打开终端，再运行：

```bash
md-viewer capabilities --json
```

后文统一写 `md-viewer`。如果你没有安装命令行工具，就把 `md-viewer` 替换成上面的完整应用路径。Windows 安装后如提示目录不在 `Path`，按 JSON 里的 `actions[]` 提示添加后重新打开 PowerShell 或 CMD。

## 2. 我想导出 PDF

```bash
md-viewer export report.md --format pdf --out report.pdf
```

成功后会生成 `report.pdf`，JSON 里的 `artifacts[]` 会列出文件路径和大小。

复杂图表很多时可以放宽 headless 渲染时间：

```bash
md-viewer export report.md --format pdf --out report.pdf --timeout-ms 180000
```

## 3. 我想导出 HTML

```bash
md-viewer export report.md --format html --out report.html
```

HTML 适合发给别人用浏览器打开，或作为自动化检查的中间结果。

## 4. 我想导出 DOCX

DOCX 需要先启动 `md-viewer-docx-service`。如果服务已在 `http://127.0.0.1:3179` 运行：

```bash
md-viewer export report.md --format docx --docx-style preview --out report.docx
```

常用样式：

```bash
md-viewer export report.md --format docx --docx-style standard --out report.docx
md-viewer export report.md --format docx --docx-style official --out report.docx
md-viewer export report.md --format docx --docx-style report --out report.docx
```

## 5. DOCX 服务连不上怎么办

先检查服务：

```bash
md-viewer doctor --json
```

也可以只检查某个文档是否适合导出 DOCX：

```bash
md-viewer preflight report.md --format docx --json
```

如果你是本地源码开发，可以在另一个终端启动服务。下面路径是本仓库开发环境示例；Release 用户请按 `md-viewer-docx-service` 文档或 Docker 方式启动服务。

```bash
cd /Users/mac/Documents/test/testmd/md-viewer-docx-service
MDV_RENDER_ARTIFACT_DIR=/Users/mac/Documents/test/testmd/md-viewer/out/renderer \
MDV_RENDER_CLI=/Users/mac/Documents/test/testmd/md-viewer-docx-service/renderers/mdv-renderer-cli.mjs \
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 3179
```

服务启动后，确认：

```bash
curl http://127.0.0.1:3179/healthz
curl http://127.0.0.1:3179/readyz
```

`healthz` 表示服务能连接；`readyz` 表示完整图表渲染能力是否可用。

## 6. 我想截图

截图整个页面：

```bash
md-viewer screenshot report.md --out report.png
```

只截图正文区域：

```bash
md-viewer screenshot report.md --selector ".markdown-body" --out report-body.png
```

截图第 3 个图表：

```bash
md-viewer screenshot report.md --chart 3 --out chart-03.png
```

## 7. 我想导出图表

先列出文档里的图表：

```bash
md-viewer charts list report.md --json
```

导出为文件夹：

```bash
md-viewer charts export report.md --out-dir report-charts
```

导出为 ZIP：

```bash
md-viewer charts export report.md --out report-charts.zip
```

如果文档包含大量图表，可同样加 `--timeout-ms 180000`。

## 8. 我想检查文档问题

查看文档结构、图片、链接、代码块和图表：

```bash
md-viewer inspect report.md --json
```

只检查链接和图片资源：

```bash
md-viewer links report.md --json
```

诊断图表渲染结果：

```bash
md-viewer render report.md --out render.html --json
```

注意：`render` 是诊断命令，不是最终导出。正式交付请用 `export`。

## 9. 我想批量测试多个 Markdown

创建一个本地配置文件，例如 `e2e/local-real-docs.json`：

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

执行批量回归：

```bash
md-viewer batch e2e/local-real-docs.json --out /tmp/md-viewer-report.json --artifacts-dir /tmp/md-viewer-artifacts
```

建议把真实私有文档配置和导出产物放在 `/tmp` 或 git 忽略目录，避免提交本地路径。

## 10. 给 AI Agent 使用

你可以把下面这段发给 AI：

```text
请使用 MD Viewer CLI 处理这个 Markdown。如果系统里没有 md-viewer 命令，先用应用完整路径执行 install-cli --json 安装命令行工具，或直接用应用完整路径调用。先运行 capabilities 和 schema 确认可用命令；导出前先 preflight；如果需要 DOCX，先 doctor 检查服务；执行命令后解析 JSON 里的 ok、warnings、actions 和 artifacts。不要自动执行 destructive 或 starts-service 风险动作，除非我明确同意。
```

AI 常用命令顺序：

```bash
md-viewer capabilities --json
md-viewer schema export --json
md-viewer preflight report.md --format docx --json
md-viewer export report.md --format docx --docx-style preview --out report.docx
```

## 11. 下一步看哪里

- 完整参数、JSON 契约和 exit code：见 [CLI 使用指南](cli.md)。
- 图形界面完整说明：见 [MD Viewer 使用手册](user-manual.md)。
