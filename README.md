# MD Viewer

> 跨平台桌面端 Markdown 预览工具，面向本地文档阅读、图表渲染、全文搜索和多格式导出。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI/CD](https://github.com/wj2929/md-viewer/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/wj2929/md-viewer/actions/workflows/ci-cd.yml)
[![Latest Release](https://img.shields.io/github/v/release/wj2929/md-viewer?label=release)](https://github.com/wj2929/md-viewer/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-39-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

MD Viewer 用于浏览本地 Markdown 文档目录。它支持文件树、多标签、搜索、书签、分屏、图表渲染和 HTML / PDF / DOCX 导出，适合知识库、技术文档、会议材料、方案文档和图表密集型 Markdown 文件。

![MD Viewer 欢迎页](docs/images/welcome.png)

## 功能特性

- 本地 Markdown 文件夹浏览，支持文件树、多标签、最近文件和书签。
- 默认预览优先，可切换到 Markdown 编辑模式；段落、标题、引用、列表、表格单元格和普通代码块支持渲染区直接编辑，图表和复杂嵌入通过源码编辑处理。
- 实时预览 Markdown，支持表格、任务列表、代码高亮、数学公式、图片预览和图表密集型文档。
- 支持 Mermaid、ECharts、Markmap、Graphviz、PlantUML、DrawIO、Infographic、KaTeX、Excalidraw、Vega-Lite、D2、BPMN、WaveDrom、C4-PlantUML、Structurizr、Plotly、DBML、AntV G6、Kroki 等图表或公式渲染。
- 支持文件名搜索、全文搜索和页面内搜索。
- 支持多窗口、递归分屏、目录导航、字体大小调节、窗口置顶和全屏阅读。
- 支持按根目录保存文件树折叠状态，重新打开常用目录时保留用户整理过的展开状态。
- 支持文件监听，已打开的 Markdown 被外部编辑器修改后会自动刷新预览。
- 支持 HTML、PDF、DOCX 导出；导出 warning 会说明发生了什么、影响是什么和下一步怎么做。
- 提供面向脚本、CI 和 AI Agent 的命令行能力，可执行打开、预检、导出、截图、图表提取、环境诊断和批量回归。
- 支持右键批量打包下载当前文档中的图表 PNG。
- DOCX 高质量图表导出依赖可选的外部 DOCX 服务。
- 支持 `.excalidraw` 文件和 Markdown 中的相对路径引用，当前仅用于静态预览和导出，不提供 Excalidraw 编辑能力。
- Electron 沙箱、路径校验和 CSP 加固，降低本地文件预览场景的安全风险。

## 下载与安装

请从 [GitHub Releases](https://github.com/wj2929/md-viewer/releases/latest) 下载最新版本。

### macOS

下载 `dmg` 或 `zip` 安装包，支持 Apple Silicon 和 Intel Mac。

如果首次打开时提示“已损坏”“无法验证开发者”或“Apple 无法检查其是否包含恶意软件”，这是未公证开源应用在 macOS 上的常见提示。

请先确认应用来自本项目 Release，并已拖入 `/Applications`，然后执行：

```bash
APP="/Applications/MD Viewer.app"; if [ -d "$APP" ]; then xattr -dr com.apple.quarantine "$APP" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$APP"; xattr -d com.apple.provenance "$APP" 2>/dev/null || true; else echo "未找到 $APP，请先把 MD Viewer.app 拖到 /Applications"; fi
```

如果仍无法打开，可继续执行兜底清理：

```bash
APP="/Applications/MD Viewer.app"; xattr -cr "$APP" 2>/dev/null || sudo xattr -cr "$APP"
```

也可以在“系统设置 -> 隐私与安全性”中选择“仍要打开”。

### Windows

下载 `exe` 或 `zip` 安装包。首次运行时，Windows SmartScreen 可能提示“Windows 已保护你的电脑”，点击“更多信息”后选择“仍要运行”。

### Linux

下载 `AppImage` 或 `deb` 包。AppImage 用户可能需要先安装 FUSE：

```bash
# Ubuntu / Debian
sudo apt install libfuse2

# Fedora
sudo dnf install fuse

# Arch
sudo pacman -S fuse2
```

运行 AppImage：

```bash
chmod +x MD-Viewer-*.AppImage
./MD-Viewer-*.AppImage
```

不安装 FUSE 时，也可以使用提取模式：

```bash
./MD-Viewer-*.AppImage --appimage-extract-and-run
```

## 快速开始

1. 启动 MD Viewer。
2. 点击“打开文件夹”，选择包含 Markdown 文件的目录。
3. 在左侧文件树中点击 `.md` 文件开始预览。
4. 使用 `Cmd+K` / `Ctrl+K` 快速搜索文件。
5. 使用导出菜单将当前文档导出为 HTML、PDF 或 DOCX。

## 命令行与自动化

v2.5.0 起，MD Viewer 提供 CLI 自动化入口。常用命令示例：

```bash
md-viewer capabilities --json
md-viewer inspect README.md --json
md-viewer links README.md --json
md-viewer render README.md --out render.html --json
md-viewer export README.md --format pdf --out README.pdf
md-viewer screenshot README.md --selector ".markdown-body" --out README.png
md-viewer charts list README.md --json
md-viewer batch e2e/local-real-docs.json --out test-results/release-report.json
```

其中 `inspect` 用于分析标题、链接、图片、代码块和图表结构；`links` 用于审计本地 Markdown 链接、锚点和图片资源；`render` 用于诊断图表渲染结果和生成中间 HTML，不替代正式 `export`。

macOS、Windows 和 Linux 用户如果还没有 `md-viewer` 命令，可以先打开应用，在“设置 -> 系统 -> 命令行工具”中安装；也可以用应用完整路径运行 `install-cli --json`。例如 macOS 可执行 `"/Applications/MD Viewer.app/Contents/MacOS/MD Viewer" install-cli --json`，Windows 可执行 `& "C:\Program Files\MD Viewer\MD Viewer.exe" install-cli --json`，Linux AppImage 可执行 `./MD-Viewer-*.AppImage install-cli --json`。

新用户建议先看 [CLI 快速上手](docs/cli-quickstart.md)；完整参数、JSON 契约和 exit code 见 [CLI 使用指南](docs/cli.md)。图形界面说明见 [使用手册的命令行与自动化章节](docs/user-manual.md#10-命令行与自动化)。

## 使用手册

完整的安装、浏览、编辑、搜索定位、图表渲染和导出说明见 [MD Viewer 使用手册](docs/user-manual.md)。跨平台限制和已知问题见 [已知问题](docs/known-issues.md)。

## 支持的图表与公式

| 类型 | Markdown 写法 | 说明 |
| --- | --- | --- |
| Mermaid | <code>```mermaid</code> | 流程图、时序图、类图、状态图、甘特图、饼图、C4、思维导图等 |
| ECharts | <code>```echarts</code> | 使用 ECharts option 渲染交互式图表 |
| Markmap | <code>```markmap</code> | Markdown 风格思维导图 |
| Graphviz | <code>```dot</code> / <code>```graphviz</code> | DOT 有向图、无向图、子图 |
| PlantUML | <code>```plantuml</code> | UML 图，PlantUML 服务地址可配置 |
| DrawIO | <code>```drawio</code> | DrawIO / diagrams.net 图表 |
| Infographic | <code>```infographic</code> | AntV Infographic 信息图 |
| KaTeX | `$...$` / `$$...$$` | 行内公式和块级公式 |
| Excalidraw | <code>```excalidraw</code> / `.excalidraw` 文件 | 静态画板预览和导出 |
| Vega-Lite | <code>```vega-lite</code> | 声明式统计图、分析图和仪表板图表 |
| D2 | <code>```d2</code> | 架构图、流程图和系统关系图 |
| BPMN | <code>```bpmn</code> / `.bpmn` 文件 | 业务流程建模图 |
| WaveDrom | <code>```wavedrom</code> | 数字时序图 |
| C4-PlantUML | <code>```c4</code> / <code>```c4plantuml</code> | C4 架构图 |
| Structurizr | <code>```structurizr</code> | Structurizr DSL 架构模型 |
| Plotly | <code>```plotly</code> | PPT 型复杂图表、统计图和 3D 图表 |
| DBML | <code>```dbml</code> | 数据库 ERD |
| AntV G6 | <code>```antv-g6</code> | 复杂关系、拓扑和知识图谱 |
| Kroki | <code>```kroki</code> / <code>```nomnoml</code> 等 | 长尾图表格式入口 |

Excalidraw 文件也可以通过 Markdown 图片语法引用：

```markdown
![架构图](./diagrams/architecture.excalidraw)
```

BPMN 文件也可以通过 Markdown 图片语法引用：

```markdown
![审批流程](./process.bpmn)
```

## DOCX 导出

MD Viewer 内置 DOCX 导出入口，并支持连接外部 DOCX 服务生成更完整的 Word 文档效果。

- MD Viewer 负责桌面端预览、导出入口、图表渲染和导出请求。
- `md-viewer-docx-service` 负责服务端 DOCX 生成、模板样式、字体处理和部分图表截图注入。
- MD Viewer 本身不提供 HTTP 服务，也不负责 Docker 部署。

如果只需要 HTML / PDF 导出，不需要部署 DOCX 服务。

## 开发环境

### 要求

- Node.js 20.x
- npm
- Git

### 本地运行

```bash
git clone https://github.com/wj2929/md-viewer.git
cd md-viewer
npm ci
npm run dev
```

### 常用命令

```bash
# 开发模式
npm run dev

# 类型检查
npm run typecheck

# ESLint
npm run lint

# 单元测试
npm test -- --run

# E2E 测试
npm run test:e2e

# 构建渲染进程与主进程产物
npm run build

# v2.4 发布门禁
scripts/release-smoke.sh quick
scripts/release-smoke.sh full

# 打包桌面应用
npm run build:mac
npm run build:win
npm run build:linux
```

`npm run build` 会同时产出桌面应用运行所需文件，以及供外部导出服务复用的浏览器渲染产物：

```text
out/renderer/
├── manifest.json
├── server-render.html
└── assets/
```

## 项目结构

```text
md-viewer/
├── src/
│   ├── main/        # Electron 主进程、窗口、菜单、IPC、导出
│   ├── preload/     # 预加载脚本和安全桥接
│   └── renderer/    # React 渲染进程、Markdown 预览、图表渲染
├── resources/       # 图标、DOCX 模板、Lua 过滤器等资源
├── e2e/             # Playwright E2E 测试
├── scripts/         # 发布和检测脚本
├── docs/            # 文档与截图资源
└── package.json
```

## 贡献

欢迎提交 Issue 和 Pull Request。

建议流程：

1. Fork 仓库并创建功能分支。
2. 修改代码或文档。
3. 运行必要检查：`npm run typecheck`、`npm run lint`、`npm test -- --run`。
4. 提交 Pull Request，并说明变更目的、影响范围和验证方式。

对于较大的功能改动，请先创建 Issue 说明背景、方案和预期行为，避免实现方向偏离项目目标。

## 安全

如果你发现安全问题，请不要直接公开漏洞细节。请参考 [SECURITY.md](SECURITY.md) 中的方式报告。

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。

第三方依赖和版权说明见 [NOTICE.md](NOTICE.md)。

## 致谢

MD Viewer 基于以下开源项目构建：

- [Electron](https://electronjs.org/)
- [React](https://react.dev/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [Prism.js](https://prismjs.com/)
- [KaTeX](https://katex.org/)
- [Mermaid](https://mermaid.js.org/)
- [ECharts](https://echarts.apache.org/)
- [Markmap](https://markmap.js.org/)
- [Graphviz](https://graphviz.org/)
- [PlantUML](https://plantuml.com/)
- [Zustand](https://zustand-demo.pmnd.rs/)
- [Fuse.js](https://fusejs.io/)
