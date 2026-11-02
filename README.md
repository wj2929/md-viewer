# MD Viewer

> 跨平台桌面端 Markdown 预览工具，面向本地文档阅读、图表渲染、全文搜索和多格式导出。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI/CD](https://github.com/wj2929/md-viewer/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/wj2929/md-viewer/actions/workflows/ci-cd.yml)
[![Latest Release](https://img.shields.io/github/v/release/wj2929/md-viewer?label=release)](https://github.com/wj2929/md-viewer/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-39-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

MD Viewer 用于浏览本地 Markdown 文档目录。它支持文件树、多标签、搜索、书签、分屏、图表渲染和 HTML / PDF / DOCX 导出，适合知识库、技术文档、会议材料、方案文档和图表密集型 Markdown 文件。

> 当前源码为 **v2.9.0 开发版，尚未发布**。本文功能说明对应当前源码；已发布版本及可下载产物以 GitHub Releases 为准。

![MD Viewer 欢迎页](docs/images/welcome.png)

## 功能特性

- 本地 Markdown 文件夹浏览，支持文件树、多标签、最近文件和书签；文件较多时可在悬停预览卡片中查看最多 500 个字符的正文摘要，并用六种背景色标记重点文档。
- 支持窗口内工作区、多窗口拆分与合并、应用重启后的窗口恢复，以及文件树右键“在新窗口中打开”。
- 支持 Markdown 正文语音朗读，提供系统离线声、Edge 免费语音、OpenAI 兼容服务和 Azure；支持逐句高亮、阅读跟随、睡眠定时，以及同一 OpenAI 服务下的多个“模型 + 音色”声音方案。
- 默认预览优先，可切换到 Markdown 编辑模式；段落、标题、引用、列表、表格单元格和普通代码块支持渲染区直接编辑，图表和复杂嵌入通过源码编辑处理。
- 实时预览 Markdown，支持表格、任务列表、代码高亮、数学公式、图片预览和图表密集型文档。
- 支持 Mermaid、ECharts、Markmap、Graphviz、PlantUML、DrawIO、Infographic、KaTeX、Excalidraw、Vega-Lite、D2、BPMN、WaveDrom、C4-PlantUML、Structurizr、Plotly、DBML、AntV G6、受限 SVG、Kroki 等 20 类图表或公式渲染。
- “设置 → 图表”提供“模板库 / 离线示例 / 渲染服务”三个任务入口；模板可搜索、真实预览并查看 HTML、PDF、DOCX 格式支持，欢迎页可一键准备并打开随应用安装的离线示例。内容版本 `2.9.0-r1` 包含 21 个快速入门模板、129 个设计核心案例和 885 个从 renderer 专项 fixture 明确筛选的正例，共 1,014 个案例；根目录、设计参考、专项分类和 renderer 页面提供分层使用说明、选型提示、稳定案例 ID、返回/分页导航、联网与导出边界及失败排查。负例与压力输入不进入用户包。专项案例默认每个 renderer 一个 Markdown，仅对隐藏性能实测超限的重型 renderer 固定分页。PlantUML、C4-PlantUML、Kroki 默认自动渲染，可在图表设置中关闭；关闭后每篇文档只确认一次。也可单独导出 ZIP 用于分享或备份。
- 支持文件名搜索、全文搜索和页面内搜索。
- 最近文件、最近文件夹及“移动到…”的最近目录搜索可启用名称拼音补充，默认关闭；输入至少3个字母可匹配名称开头的拼音，允许末音节未完成，完整音节匹配优先。原文结果优先，拼音候选独立分组并可展开全部。三个入口共用同一 profile 内持久保存的开关；最近文件只匹配文件名拼音，不扩展到祖先路径、正文、文件树或全局文件搜索。
- 支持递归分屏、目录导航、字体大小调节、窗口置顶和全屏阅读。
- 支持按根目录保存文件树折叠状态，重新打开常用目录时保留用户整理过的展开状态。
- 目录树过滤框旁可快捷切换名称、自然数字名称、文件类型、修改时间和大小排序，也可在“设置 → 浏览”调整；全局记忆并同步所有窗口。默认仍为文件夹优先、名称升序；每层文件夹与文件分别排序。文件夹时间取内部树内文档最近修改时间，大小取文档总字节数，包含折叠子目录，不随过滤变化；不统计目录树之外的 CSV、PDF、媒体等文件。
- 支持文件监听，已打开的 Markdown 被外部编辑器修改后会自动刷新预览。
- 支持 HTML、PDF、DOCX 导出；导出 warning 会说明发生了什么、影响是什么和下一步怎么做。
- 提供面向脚本、CI 和 AI Agent 的命令行能力，可执行打开、预检、导出、截图、图表提取、环境诊断和批量回归。
- “设置 → 系统 → 诊断与日志”可记录文件夹扫描、文件读取、索引和预览渲染的脱敏阶段耗时；日志目录及 10/25/50 MiB、7/14/30 天保留规则可配置，并可主动导出诊断 ZIP。应用不会自动上传日志。
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

## 本地附件与本次来源返回

- JSON、TXT、LOG、CSV、YAML/YML，以及 SQL、TSV、JSONL、常见配置、标记文本、源码、样式与脚本，可在独立只读弹窗查看、查找和复制，不占 Markdown 标签，不执行或保存。HTML/SVG 附件只显示源码；JSON 保留保真格式化/原文切换；JSONL/NDJSON 默认逐条展开、空行分隔，可切回原文，不合并成数组。展开视图仅用于阅读，复制原始单行记录请切换“原文”。仅支持严格 UTF-8，读取上限 5 MiB；未知/无后缀文件先显示卡片，明确点击“按文本查看”后才试读。
- SQL、JSON/JSONL/NDJSON、YAML/YML、XML、HTML/HTM/SVG 支持默认开启、可关闭的语法高亮；HTML/SVG 仍只显示源码。超过高亮预算时完整显示纯文本，查找和复制照常可用。高亮与格式化独立；SQL 默认原文，可主动进行有限的标准 SQL 格式化并切回原文，不执行或写回文件，不可靠结构或超预算时保留原文。
- 普通链接支持合法 `../` 和本机绝对文件路径，明确路径 Wiki 也可点击阅读未打开目录中的 Markdown/文本。外部 Markdown 留在原工作区，标为“外部只读 · 临时”，可继续点击、返回和手动刷新；不授权父目录、不自动扫描、索引或监听，不能编辑、保存、固定、加书签或整文档导出。
- PDF、指定 Office 文档及常见图片/音视频保留卡片分流；系统打开仍限旧名单与原工作区授权，并经默认取消的原生确认。新增文本后缀不获系统执行资格。自动图片/媒体/图表和 Wiki 嵌入不扩权，`file://`、网络路径及受保护路径仍拒绝。
- 从普通/Wiki Markdown 链接打开文档后，阅读区右侧浮动导航最上方显示`↶`＋“返回”；连续 A→B→C 可逐级返回原链接位置，不关闭目标标签。重复链接按实际点击处区分；内容变化时回退到标题/阅读比例。普通/全文阅读/工作台对照预览位置统一，分屏各自独立；仅编辑模式保留工具区入口，没有来源时不显示。
- 来源链仅保存在当前窗口的工作区/面板内存中，最多50节点，不进入设置、诊断日志或重启会话。手工从文件树等入口进入不伪造来源。同窗口切工作区再切回可保留临时标签并复验；重启、根替换或跨窗口转移不携带外部临时标签，请从来源链接重新打开。

完整操作及限制见[使用手册](docs/user-manual.md#本地附件与本次来源返回)。SQL／跨目录增量的[最终验证与安装记录](docs/linked-text-cross-root-validation.md)已完成，**2026-10-12 21:45按用户授权安装，原配置、密钥及会话保留，未发布**；旧附件／来源入口版的历史记录见[验证与安装](docs/local-attachments-navigation-validation.md)。

## 本地媒体与 Wiki 链接

MD Viewer 支持相对于当前 Markdown 的 HTML `<video>` / `<audio>`，以及常用 Obsidian Wiki 语法：

```markdown
[[Note]]
[[docs/Design#安全边界|设计说明]]
![[images/architecture.png|640x360]]
![[videos/demo.webm|640x360]]
![[audio/meeting.mp3|会议录音]]
```

- Wiki 文档链接支持相对位置、工作区路径、标题和显示名；图片、音频和视频嵌入会经过工作区授权后加载，不开放 `file://`。BPMN 与 Excalidraw Wiki 嵌入复用现有静态图表 renderer；文档及其他附件嵌入显示为可导航资源卡，不递归展开正文。
- HTML 媒体支持最多 4 个 `<source>` 和 4 条本地 WebVTT `<track>`，并支持 `#t=start,end` 时间片段。容器在白名单内不代表当前操作系统一定具备对应 codec，无法解码时会安全降级。
- HTML 导出保留指向原媒体、字幕和 poster 的相对链接，不复制 sidecar，因此不是自包含文件；PDF 使用 poster 或文字卡静态降级，DOCX 使用普通链接或说明文字。
- 普通 Wiki 文档链接支持已保存的 frontmatter `aliases`，文件名优先、别名后备；别名不明确或索引不完整时不会猜测。支持 `[[Note#^block-id]]`、`[[#^block-id]]` 与普通 Markdown 块链接，按实际显示内容定位，未保存的目标草稿优先。
- Markdown 正文、章节或块的内容嵌入，以及 PDF / Office / Canvas 的内联渲染仍不支持；文档嵌入卡片不使用别名。CLI 不默认扫描全树别名，同页静态 HTML 块锚点由完整渲染器提供。

完整语法、格式和大小限制见[使用手册](docs/user-manual.md#本地媒体与-wiki-链接)。

## 命令行与自动化

v2.5.0 起，MD Viewer 提供 CLI 自动化入口。常用命令示例：

```bash
md-viewer capabilities --json
md-viewer inspect README.md --json
md-viewer links README.md --json
md-viewer render README.md --out render.html --json
md-viewer export README.md --format pdf --out README.pdf
md-viewer export ch1.md ch2.md ch3.md --format pdf --out book.pdf
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
| KaTeX | `$...$` / `\(...\)`（行内），`$$...$$` / `\[...\]`（块级） | 行内公式和块级公式 |
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
| SVG（受限） | <code>```svg</code> | 安全、自包含的静态矢量图 |
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

# 本地发布门禁
scripts/release-smoke.sh quick
scripts/release-smoke.sh full
# 正式发布前：包含可见窗口交互 E2E
scripts/release-smoke.sh full-interactive

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
