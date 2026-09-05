# Electron 包体审计与 Tauri 2 PoC 方案

> 日期：2026-08-22
> 状态：Electron 审计完成；v2.8 staged package 已实施，最终三平台实测仍待发布门禁

## 1. 结论

1. 当前安装包异常大的首要原因不只是 Electron runtime，而是 `electron-builder` 将全部生产依赖复制进 `app.asar`；大量只在 renderer 中使用、且已经被 Vite 打包进 `out/renderer` 的图表依赖又以原始 `node_modules` 形式重复进入应用。
2. macOS arm64 实测未签名 `.app` 从 681 MiB 中有 415 MiB `app.asar`，其中解包后的 `node_modules` 约 431 MiB；真正由主进程运行时外部引用的依赖闭包约 21 MiB，renderer 产物约 33 MiB。
3. 用仅含主进程实际外部依赖的临时 `package.json` 重打包后，未签名 `.app` 从 681 MiB 降到 318 MiB；arm64 ZIP 为 124,451,725 B，而 v2.7.0 Release ZIP 为 237,055,104 B，减少约 112.6 MB（47.5%）。临时包的 `capabilities --json` 已实际启动成功。该结果只是审计原型，尚未做完整 GUI/导出门禁，不能直接发布。
4. renderer 自身约 31.59 MiB。所谓 17.46 MiB `katex.min-*.js` 实际是 KaTeX、Mermaid、Excalidraw、Vega、Graphviz、D2、WaveDrom、Markmap 等被静态聚合后的共享 chunk；拆动态边界主要改善启动加载与解析，不会显著缩小安装包。
5. v2.8 已按上述根因实施 staged package：构建扫描 main/preload external、按 lockfile 生成运行时闭包，并将打包输入隔离到 `.package-app`。同时已接入中英文 locale 白名单、KaTeX WOFF2 和 packaged verifier；最终结果见下节。
6. Tauri 2 可以迁移，但 PDF、PNG/capturePage 和 CLI headless renderer 是 Go/No-Go 阻断项。当前决定暂缓迁移，继续以 Electron 完整功能为产品主线；PoC 方案仅保留为未来决策参考。

## 2. Electron 包体审计

### 2.1 当前 Release 产物

| 产物 | 大小 |
| --- | ---: |
| Windows Setup | 196.2 MB |
| Windows ZIP | 250.0 MB |
| macOS arm64 ZIP | 226.1 MB |
| macOS arm64 DMG | 233.7 MB |
| macOS x64 ZIP | 230.7 MB |
| macOS x64 DMG | 238.4 MB |
| Linux DEB | 146.0 MB |
| Linux AppImage | 240.0 MB |

来源：GitHub Release v2.7.0 asset API。

### 2.2 macOS arm64 解包实测

按当前 `package.json` 执行：

```bash
npm run build
npx electron-builder --mac --arm64 --dir
```

| 内容 | 大小 |
| --- | ---: |
| `MD Viewer.app` | 681 MiB |
| `Contents/Frameworks` | 262 MiB |
| `Electron Framework` | 261 MiB |
| `Contents/Resources` | 419 MiB |
| `app.asar` | 415 MiB |
| 解开后的 `app.asar/node_modules` | 431 MiB |
| `out` | 33 MiB |

Electron runtime 是固定大头，但当前 `app.asar` 比 Electron Framework 还大，说明项目依赖打包也是核心问题。

### 2.3 根因：renderer 依赖被重复复制

`build.files` 本身只列出：

```json
["out/**/*", "package.json"]
```

这能阻止项目源码、测试、docs 进入包，但 electron-builder 仍会根据根 `dependencies` 自动收集生产依赖。当前大量依赖只在 renderer 中使用，Vite 已经把它们打入 `out/renderer`，electron-builder 又把其原始 npm 目录打进 `app.asar`。

`app.asar/node_modules` 最大项目包括：

| 依赖目录 | 解包大小 |
| --- | ---: |
| `mermaid` | 64 MiB |
| `@terrastruct/d2` | 57 MiB |
| `echarts` | 55 MiB |
| `@excalidraw/excalidraw` | 45 MiB |
| `@antv/*` | 23 MiB 以上 |
| `highlight.js` | 9.1 MiB |
| `cytoscape-fcose` | 9.1 MiB |
| `vega-lite` | 6.1 MiB |
| `jsdom` | 5.4 MiB |
| `bpmn-js` | 5.0 MiB |
| `zod` | 5.4 MiB |

而构建后的 main/preload 只外部引用以下非 Electron 包：

```text
adm-zip
chokidar
docx
electron-store
fs-extra
glob
markdown-it
msedge-tts
```

只安装这 8 个直接运行时依赖后的闭包约 21–28 MiB（不同统计口径包含 symlink/metadata 差异）。

### 2.4 临时瘦身原型实测

只在 `/private/tmp` 创建临时项目，保持 `out` 和 resources 不变，生产 dependencies 只保留上面 8 项后重新打包：

| 指标 | 当前完整依赖 | 最小运行时依赖原型 | 差值 |
| --- | ---: | ---: | ---: |
| 未签名 `.app` | 681 MiB | 318 MiB | -363 MiB（-53.3%） |
| `app.asar` | 415 MiB | 49 MiB | -366 MiB（-88.2%） |
| 解包 `node_modules` | 431 MiB | 21 MiB | -410 MiB |
| arm64 ZIP | 237,055,104 B（Release） | 124,451,725 B | -112,603,379 B（-47.5%） |

验证：最小包实际执行 `MD Viewer capabilities --json` 成功，返回 15 条命令、19 类图表能力。GUI、PDF、图表、TTS、DOCX 和 full-interactive 尚未运行，因此这里只证明主入口及 CLI 基础加载成立。

### 2.5 renderer 审计

| 类型 | 体积 |
| --- | ---: |
| renderer 总计 | 31.59 MiB |
| JavaScript | 30.29 MiB |
| CSS | 0.26 MiB |
| KaTeX 字体 | 1.02 MiB |
| Source map | 0 B |

最大文件：

| 文件 | 大小 | 说明 |
| --- | ---: | --- |
| `katex.min-*.js` | 17.46 MiB | 多种图表库共享 chunk，不是单独 KaTeX |
| `drawio-viewer.min.js` | 2.12 MiB | public 静态资源，运行时按需注入 |
| renderer 主入口 | 1.86 MiB | React/UI/业务入口 |
| Excalidraw 共享 chunk | 1.75 MiB | 图表相关 |
| Mermaid percentages chunk | 1.61 MiB | 图表相关 |

普通入口当前 modulepreload 约 19.58 MiB raw JS/CSS，原因是 `VirtualizedMarkdown.tsx` 与 server renderer 静态聚合全部图表 hooks。

### 2.6 建议优化顺序

#### P0：拆分“构建依赖”和“应用运行时依赖”

目标：electron-builder 只收集 main/preload 的外部依赖，不再复制 renderer-only npm 包。

可选实施方式需先做小分支验证：

- 为可发布应用生成精简 manifest；或
- 将 renderer-only 库迁到不会被 electron-builder 收集的依赖边界，并确认 Vite 完整内联；或
- 通过 electron-builder dependency pruning/files 规则显式排除，但要避免维护脆弱的数百项黑名单。

推荐生成“允许列表式运行时 manifest”，来源由构建产物的 external imports 和人工清单共同控制。不要仅凭一次 grep 永久锁死依赖，因为动态 import 和 CLI 分支可能漏检。

**预计收益：当前 macOS ZIP 约减少 47%，是最高优先级。**

必须验证：

```bash
npm ci
npm run typecheck
npm test -- --run
npm run build
scripts/release-smoke.sh full
scripts/release-smoke.sh full-interactive
```

并分别构建 macOS、Windows、Linux，运行启动、文件监听、全部图表、HTML/PDF/DOCX、TTS、CLI `render/export/screenshot/charts`。

#### P1：清理确定未使用或分类错误依赖

候选：

- 将 `@types/markdown-it`、`@types/prismjs` 移到 devDependencies；
- 核查后移除 `isomorphic-dompurify`、`markdown-it-anchor`、`react-virtuoso`、`swr`、`zod`、`vega-embed` 等当前生产源码未见引用的根依赖；
- `isomorphic-dompurify` 特别值得清理，因为它会带入 jsdom 链。

注意：在 P0 允许列表完成后，这些清理对最终安装包的收益会明显变小，主要价值是维护依赖卫生。

#### P2：KaTeX 字体只保留 WOFF2

当前输出 TTF + WOFF + WOFF2。现代 Electron 39 支持 WOFF2，可用裁剪 CSS 只引用 WOFF2。

- 安装体积预计减少约 0.78 MiB；
- 风险低，但需回归 AMS、Fraktur、Caligraphic、Script、粗斜体和 PDF/DOCX 公式。

#### P3：图表 renderer 真正按需加载

将 `VirtualizedMarkdown` 和 server-render 的静态 hooks 聚合改为基于 fence/renderer 类型动态加载。

- 无图表文档首批 JS/CSS 有机会从约 20.5 MB raw 降至约 3 MB 以下；
- renderer 总安装体积基本不变；
- 主要改善冷启动、解析、内存，而不是安装包；
- 风险中高，不能条件调用 React hooks，需先设计稳定的 renderer 调度边界。

#### 不优先

- Source map：当前没有生成，收益为 0。
- DrawIO 外置/首次下载：只能省 2.12 MiB，却会伤害离线和首次使用，性价比低。
- icon 平台化：macOS/Windows 仅省约 31 KiB。
- 盲目裁剪 ECharts 类型：收益较小，兼容风险高。

### 2.7 v2.8 staged package 实施状态

已实施：

- runtime allowlist 固定为 `adm-zip`、`chokidar`、`docx`、`electron-store`、`fs-extra`、`glob`、`markdown-it`、`msedge-tts`，构建扫描与清单双向校验；
- 按 lockfile 递归构造目标平台 runtime closure，并从 `.package-app` 作为独立 appDir 打包，renderer-only 根依赖不再由 electron-builder 重复收集；
- 正式资源、asar 内模块、CLI 入口、Electron locale 和 KaTeX WOFF2 字体由 packaged verifier 检查；
- macOS arm64 现有 staged app 实测为 270,489,903 B，`app.asar` 为 45,691,366 B，包含 20 个 KaTeX WOFF2 字体；runtime closure、locale、asar 和当前尺寸预算均通过；
- 最新代码已使用本机校验通过的 Electron 39.2.7 ZIP 作为 `electronDist` 离线重建：arm64 staged app 为 270,814,207 B，x64 为 276,525,351 B；两者 `app.asar` 均为 45,906,053 B。两架构均包含 20 个 KaTeX WOFF2 字体，并通过 runtime closure、9 个 en/zh locale、asar、尺寸、packaged CLI（HTML/PDF/PNG/图表）和隐藏 TTS GUI smoke；arm64 另完成 DOCX smoke；
- 常规在线打包仍会因本机无法解析 `github.com` 失败；离线 `electronDist` 只用于本次本地验证，不改变 CI 的标准下载链；
- Windows x64 已在 macOS 使用本地 Electron ZIP 交叉构建：unpacked app 为 344,569,591 B，`app.asar` 为 45,906,053 B；PE x64、3 个 en/zh locale pak、20 个 WOFF2、asar 核心入口和尺寸预算通过。Windows 原生 CLI/GUI smoke 仍需 Windows runner 完成；
- macOS x64、Windows x64 已建立审核后的正式尺寸预算；Linux x64 仍需原生 runner 实跑并建立基线。因此本节尚不是 v2.8 最终三平台包体报告。

---

## 3. Tauri 2 PoC 方案

### 3.1 目标与边界

PoC 只回答一个问题：

> 在不捆绑 Chromium、Playwright、Electron 或同量级 sidecar 的前提下，Tauri 2 能否保留 MD Viewer 的核心预览、安全文件边界、PDF/PNG 与 headless CLI？

必做：

1. 最小 React/Vite 预览壳；
2. 复杂图表预览；
3. 本地图片、BPMN、Excalidraw 相对资源；
4. 两窗口、两授权根、workspace epoch 隔离；
5. Rust watcher；
6. 系统 TTS 和 mock 网络 TTS、取消与 keyring；
7. HTML、PNG、PDF；
8. CLI `render/export/screenshot/charts`；
9. 三平台性能、RSS、包体和视觉对比。

不做：

- 完整编辑器、菜单、会话恢复；
- 全部工作区合并/拆分；
- 完整 DOCX 服务迁移；
- Electron API 兼容层；
- 预先引入 Chromium sidecar。

### 3.2 目录建议

PoC 应在独立分支下新增 `tauri-poc/`，不直接改生产 Electron 壳：

```text
tauri-poc/
├── package.json
├── vite.config.ts
├── src/
│   ├── renderer/
│   │   ├── PocApp.tsx
│   │   ├── markdown/
│   │   ├── charts/
│   │   └── native/
│   └── shared/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/desktop.json
│   └── src/
│       ├── commands/{workspace,file,asset,watcher,tts,export}.rs
│       ├── domain/{authorization,workspace_registry,asset_token}.rs
│       ├── infra/{fs,notify,keychain,asset_protocol,render_backend}.rs
│       └── cli/
├── fixtures/{charts,assets,security,watcher,tts}/
├── tests/{rust,e2e,baselines}/
└── scripts/{measure,compare-pdf,platform-matrix}/
```

### 3.3 安全架构

renderer 不直接获得通用 FS、shell、process、keychain capability。前端只调用业务 commands：

- `workspace_open_root`
- `workspace_open_file`
- `workspace_write_file`
- `workspace_create_window`
- `asset_issue_url`
- `watch_subscribe` / `watch_unsubscribe`
- `tts_synthesize` / `tts_cancel`
- `export_html`
- `render_png`
- `export_pdf`
- `diagnostics_collect`

Rust 状态模型保持现有语义：

```text
WindowLabel
  → WorkspaceId
  → { canonicalRoot, lifecycleEpoch }
```

每次读写都验证：

1. command 的发起窗口 label；
2. workspace 是否属于该窗口；
3. epoch 是否最新；
4. canonical path 是否仍在 root；
5. 是否命中受保护路径。

Tauri capability 只作为外层静态白名单，不能替代现有运行时鉴权。禁止给 renderer 开 `$HOME/**` 或广泛 `fs:default`。

本地图片继续采用 capability token，不退化成裸 `file://`：

```text
asset_issue_url(markdownPath, relativeAsset)
→ Rust canonicalize + root/扩展名/10MB 校验
→ token 绑定 window + workspace + epoch + TTL
→ 自定义 asset protocol 读取
```

必须拒绝 `..`、绝对路径、symlink/junction 越界、过期 token、跨窗口 token、query/hash、非 GET 和受保护文件。

### 3.4 Fixtures

| Fixture | 内容 |
| --- | --- |
| `all-charts.md` | 复用现有全图表 fixture，覆盖 Mermaid/ECharts/Markmap/Graphviz/DrawIO/Vega/D2/BPMN/WaveDrom/Plotly/AntV G6 |
| `chart-stress.md` | 至少 25 个 ECharts/Graphviz，验证异步完成和内存 |
| `remote-diagrams.md` | PlantUML/Kroki mock 成功与网络失败 |
| `local-image.md` | PNG/JPG/SVG、BPMN、Excalidraw、嵌套相对路径 |
| `root-a/root-b` | 双窗口跨根越权、旧 epoch、symlink/junction 逃逸 |
| `atomic-replace.md` | 连写、rename、删除、编辑器原子保存 |
| `chinese-long-text.md` | 系统 TTS、分段、暂停、取消 |

### 3.5 三平台矩阵

| 平台 | 引擎 | 必测重点 |
| --- | --- | --- |
| macOS 13+ arm64/x64 | WKWebView | Canvas/SVG、字体、Keychain、系统 TTS、PNG/PDF、签名后资源 |
| Windows 10/11 x64 | WebView2 | runtime 差异、Canvas、Credential Manager、rename、PDF |
| Ubuntu 22.04/24.04 x64 | WebKitGTK | WASM、字体、Secret Service、inotify、AppImage/deb、无桌面 CLI |

三平台均运行 debug 和 release bundle，并记录 WebView 版本、DPR、字体、图表失败类型、包体、RSS 和耗时。

### 3.6 量化通过门槛

| 指标 | 门槛 |
| --- | --- |
| 核心图表预览 | 三平台 100% 成功 |
| HTML/PDF 源码或 placeholder 残留 | 0 |
| PDF | `%PDF`、页数非零、可提取标题/正文、图表不空白/不裁切 |
| 视觉回归 | 核心 fixture SSIM ≥ 0.98，且无空白、裁切、重叠 |
| 本地资源安全负例 | 越权、软链、旧 epoch、过期 token 100% 拒绝 |
| Watcher | 100 次原子替换零漏报，P95 ≤ 500 ms |
| TTS | cancel 后无后续音频；key 不进 JS/DOM/log |
| CLI | `render/export/screenshot/charts` 无人工交互，稳定 JSON |
| 冷启动 | 不比 Electron 慢超过 10% |
| 全图表首次完成 | 不比 Electron 慢超过 15% |
| PDF/PNG 导出 | 不比 Electron 慢超过 20% |
| idle RSS | 比 Electron 至少低 20% |
| 安装包 | 比优化后的 Electron 基线至少低 30% |
| Chromium sidecar | 0 |

注意：Tauri 必须与**完成 P0 瘦身后的 Electron 包体**比较，而不是拿当前误带 400 MiB node_modules 的产物作假基线。

### 3.7 Go / No-Go

全部满足才 Go：

- 三平台核心图表预览、HTML、PDF、PNG、CLI 都通过；
- PDF/PNG/CLI 无可见窗口、无人值守、不依赖系统 Chrome；
- 不捆绑 Chromium/Playwright/Electron sidecar；
- 安全负例全部拒绝；
- watcher、TTS、性能、RSS、包体达到门槛；
- GUI 与 CLI 共用同一 render backend/输出契约。

任一项成立即 No-Go：

- PDF/截图必须依赖 Chromium sidecar；
- CLI 只能启动可见窗口或需要人工操作；
- 任一平台核心图表稳定空白、截断、WASM 失败或无法导出；
- 为实现工作区访问不得不给 renderer 广泛 FS scope；
- Linux WebKitGTK 无法稳定完成图表、密钥存储或导出；
- 相较已瘦身 Electron，包体/RSS/启动没有显著优势。

### 3.8 10 个工作日安排

| 日程 | 任务 | 交付 |
| --- | --- | --- |
| Day 1 | Tauri 壳、最小 React preview、capability schema | 两窗口加载 fixture，renderer 无通用 FS |
| Day 2 | Rust workspace registry、root/epoch、读写 | 跨窗/旧 epoch/软链测试 |
| Day 3 | asset token protocol | 本地资源成功及所有越权负例 |
| Day 4 | Mermaid/ECharts/Graphviz/DrawIO | 四类图表预览矩阵 |
| Day 5 | BPMN/Vega/Plotly/AntV/远端 mock | `all-charts.md` 结果矩阵 |
| Day 6 | Rust notify watcher | 100 次原子写统计 |
| Day 7 | 系统 TTS、mock 网络 TTS、取消、keyring | 密钥与取消测试 |
| Day 8 | HTML/PNG/PDF | 第一轮 Go/No-Go；导出失败立即止损 |
| Day 9 | CLI 共用 render backend | 四类 CLI 无 GUI JSON 测试 |
| Day 10 | 三平台 release、视觉/性能/包体/RSS | 最终决策报告 |

**强制止损：Day 8 结束仍不能在不带 Chromium 的条件下稳定完成无人值守 PDF、PNG 和 CLI 渲染，就停止 PoC。**

## 4. 建议下一步

1. 先实施 Electron P0 依赖允许列表，在独立分支跑完整门禁，建立真实“瘦身后 Electron 基线”。
2. 再建立 `tauri-poc/`，按上面的 10 日限时方案执行。
3. 两项都完成后再决定是否全量迁移；不要用当前 200+ MB 的错误打包状态作为迁移投资依据。
