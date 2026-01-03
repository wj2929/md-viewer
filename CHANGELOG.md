# 变更日志

本文档记录 MD Viewer 项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased] - v1.2

### 规划完成
- 📋 **v1.2 实施方案制定与审批**（2026-01-03 18:00-19:00）
  - 创建完整实施方案（V1.2-IMPLEMENTATION-PLAN.md）
  - 调用 4 位专家 Agent 进行审批
    - 架构师评审：有条件通过
    - 前端专家评审：需修改
    - 安全审计师评审：发现高危漏洞
    - 测试专家评审：测试方案不及格
  - 根据审批意见修订方案
    - 右键菜单：React 组件 → Electron Menu
    - 剪贴板：跨应用 → 应用内（v1.3延期）
    - 状态管理：Context → Zustand
    - 虚拟滚动：手动实现 → react-virtuoso
    - 测试覆盖率：70% → 80%
    - 新增阶段 0：安全加固

### 计划新增（v1.2）
- 🎯 **右键上下文菜单**（Electron 原生 Menu）
  - 在 Finder/资源管理器中显示
  - 复制路径 / 复制相对路径
  - 导出 HTML / 导出 PDF（新增）
  - 复制 / 剪切 / 粘贴（应用内）
  - 重命名 / 删除
  - 跨平台菜单文案适配
  - 键盘快捷键支持
- 📋 **应用内剪贴板**（Zustand 状态管理）
  - 文件复制/剪切/粘贴
  - 剪切状态可视化（半透明）
  - 文件夹递归复制
  - 同名冲突处理
- 🔒 **安全加固**（阶段 0 - 开发前必须完成）
  - 路径白名单校验（防止路径穿越）
  - 受保护路径黑名单
  - 启用 Chromium 沙箱（sandbox: true）
- 🚀 **虚拟滚动**（react-virtuoso）
  - 大文件渲染性能优化（10000+ 行）
  - 按标题分段渲染
  - Mermaid 图表懒加载
- 🧪 **测试覆盖率提升**
  - 从 55% 提升到 80%
  - 新增 70+ 测试用例
  - 补充 E2E 测试
- 🎨 **主题切换 UI**
  - 手动切换明暗主题
  - 三档：自动 / 亮色 / 暗色
  - 主题偏好持久化
- 🔄 **手动刷新按钮**（侧边栏）
  - 手动刷新文件树
  - 与自动刷新共存

### 安全问题（待修复）
- 🔴 **路径穿越漏洞**（高危）- 所有 IPC handlers 缺乏路径校验
- 🔴 **沙箱禁用**（高危）- sandbox: false 降低安全性
- 🔴 **剪贴板 API 错误**（阻塞）- clipboard.write({ files }) 不存在

### 技术决策
- 右键菜单：Electron Menu（原生体验）
- 剪贴板：应用内（跨应用延期 v1.3）
- 状态管理：Zustand（避免 Context 重渲染）
- 虚拟滚动：react-virtuoso（成熟稳定）
- 测试覆盖率：80%

### 新增依赖（待安装）
- zustand
- react-virtuoso

---

## [1.1.2] - 2026-01-03 18:30

### 修复
- 🔧 **启用 KaTeX 数学公式** - 之前被注释禁用，现已完全启用
  - 支持行内公式 `$...$`
  - 支持块级公式 `$$...$$`
  - 支持 16 类数学表达式（希腊字母、求和、积分、矩阵等）
- 🔧 **修复 Mermaid 图表渲染** - CSS class 名称不匹配
  - 修复 `mermaid-diagram` → `mermaid-container`
  - 支持 15 种稳定图表类型

### 新增
- 📝 **开源准备**
  - 创建 MIT LICENSE 文件
  - 更新作者信息为 wj2929
  - 更新 README.md 下载链接和联系方式
- 🧪 **扩展测试用例**
  - KaTeX 测试：8 → 50+ 个（16 类公式）
  - Mermaid 测试：5 → 15 种图表类型
  - 移除不稳定的 beta 图表（Quadrant、XY Chart、Sankey、Block）

### Mermaid 支持的图表（15 种）
- 流程图（TD/LR/子图）、时序图、类图、状态图
- 甘特图、饼图、ER图、用户旅程图
- Git图、思维导图、C4 架构图、时间线

### KaTeX 支持的公式（16 类）
- 行内/块级公式、希腊字母、求和/连乘
- 极限、微分/偏导、积分（单/双/三重/曲线）
- 三角函数、对数/指数、矩阵（多种类型）
- 方程组、括号/定界符、上下标/修饰
- 化学式、特殊符号

---

## [1.1.1] - 2026-01-03 17:00

### 修复
- 🔥 **修复界面卡死 Bug** - React useEffect 依赖陷阱导致文件监听无限重新订阅
  - 使用 `useRef` 存储 tabs 最新值，避免闭包陷阱
  - 依赖数组只包含 `folderPath`，确保只在文件夹切换时重新订阅
- 🚀 **修复大文件夹加载慢问题** - 从数秒降到毫秒级
  - 使用 glob 直接扫描 .md 文件，不遍历无关目录
  - 改为只监听已打开的文件，而非整个目录树
  - 避免 EMFILE 文件描述符耗尽问题
- 🔧 **修复 CSP 阻止 Vite HMR** - 动态 CSP 设置支持开发模式

### 变更
- 新增 `watchFile` API 支持增量文件监听
- 扩展忽略目录列表（node_modules, .git, venv 等）

### 打包产物
- `MD Viewer-1.1.1-arm64.dmg` (138 MB) - macOS 安装包
- `MD Viewer-1.1.1-arm64-mac.zip` (133 MB) - macOS 压缩包

---

## [1.1.0] - 2026-01-03 07:00

### 新增
- ✨ **Mermaid 图表支持** - 在 Markdown 中渲染流程图、时序图等
  - 支持 5+ 种图表类型（流程图、时序图、类图、状态图、甘特图）
  - 明暗主题自适应
  - 错误时保留原始代码显示
- 👀 **实时文件监听** - 外部编辑器修改后自动刷新
  - 文件修改 → 自动刷新已打开标签页
  - 文件添加 → 自动刷新文件树
  - 文件删除 → 自动关闭标签并刷新文件树
  - 递归监听所有子目录
- 🧪 **测试体系扩充** - 125 个单元测试（100% 通过）
  - TabBar: 18 测试 (90%+ 覆盖率)
  - ErrorBoundary: 12 测试 (80%+ 覆盖率)
  - fileCache: 14 测试 (85%+ 覆盖率)
  - App.tsx: 21 集成测试
- 📋 **QA 基础设施**
  - E2E 测试框架 (Playwright)
  - 回归测试清单 (150+ 项)
  - 安全审查报告
  - 性能测试脚本

### 修复
- 修复 XSS 漏洞（禁用 markdown-it html:true）
- 修复测试 mock 配置问题

### 依赖
- mermaid@^11.12.2
- chokidar@^5.0.0
- glob@^13.0.0

### 已知问题
- ⚠️ **此版本有严重 Bug** - 打开文件会导致界面卡死，请使用 v1.1.1

---

## [1.0.0] - 2026-01-02 22:56

### 新增
- ✅ HTML 导出功能（模板字符串 + 内联 CSS + KaTeX 支持）
- ✅ PDF 导出功能（Electron printToPDF API，使用隐藏窗口 + KaTeX 支持）
- ✅ 状态持久化（electron-store v8）
- ✅ 窗口大小和位置记忆
- ✅ 自动恢复最后打开的文件夹
- ✅ 全局错误处理（ErrorBoundary 包裹整个应用）
- ✅ Markdown 渲染错误降级
- ✅ LRU 文件内容缓存（最多 5 个文件）
- ✅ 文件大小限制（5MB）
- ✅ 内容截断保护（10000 行）
- ✅ 导出工具栏 UI
- ✅ electron-builder 打包配置
- ✅ 自定义应用图标（紫色渐变 MD 图标）
- ✅ Electron 国内镜像配置（淘宝源）
- ✅ 共享 Markdown 渲染器（`utils/markdownRenderer.ts`）

### 变更
- 简化实现计划（归档复杂架构设计）
- 降级 electron-store 从 v11 到 v8（兼容性）
- PDF 导出改用隐藏窗口（避免截取应用界面）
- 优化错误提示（友好的用户消息）
- 导出功能使用共享的 markdown-it 配置（包含 KaTeX 和 Prism）

### 修复
- 修复 electron-store 导入错误
- 修复 PDF 导出边距错误
- 修复 PDF 导出包含应用界面的问题
- 修复大文件导致应用卡顿的问题
- 修复 ErrorBoundary 组件未使用的问题
- 修复导出功能缺少 KaTeX 数学公式支持的问题
- 修复打包配置中图标文件缺失的问题

### 打包产物
- `MD Viewer-1.0.0-arm64.dmg` (109 MB) - macOS 安装包
- `MD Viewer-1.0.0-arm64-mac.zip` (106 MB) - macOS 压缩包

---

## [0.5.0] - 2026-01-02 19:00

### 新增
- 文件名搜索功能（Fuse.js 模糊匹配）
- 快捷键 `⌘K` / `Ctrl+K` 打开搜索
- 搜索模态框
- ESC 关闭搜索

### 变更
- 侧边栏添加搜索框
- 优化搜索 UI/UX

---

## [0.4.0] - 2026-01-02 18:30

### 新增
- 多标签系统
- 标签页组件 (TabBar)
- 标签切换功能
- 关闭标签功能
- 智能标签切换（关闭时自动切换到相邻标签）
- 防止重复打开同一文件

### 变更
- App.tsx 重构，使用标签状态管理
- 优化标签 UI（关闭按钮仅悬停显示）

---

## [0.3.0] - 2026-01-02 17:30

### 新增
- Markdown 渲染功能 (markdown-it)
- 代码高亮 (Prism.js)
  - 支持 JavaScript, TypeScript, JSX, TSX
  - 支持 Python, Java, Go, Rust
  - 支持 Bash, JSON, YAML, CSS, Markdown
- 数学公式渲染 (KaTeX)
  - 行内公式：`$...$`
  - 块级公式：`$$...$$`
- VSCode Dark+ 代码高亮主题
- Markdown 样式（GitHub 风格）
- 明暗主题自适应

### 新增组件
- `MarkdownRenderer.tsx` - Markdown 渲染器
- `markdown.css` - Markdown 样式
- `prism-theme.css` - 代码高亮主题

---

## [0.2.0] - 2026-01-02 16:00

### 新增
- 文件树组件 (FileTree)
- 递归显示文件夹和 Markdown 文件
- 文件夹展开/折叠功能
- 文件选择功能
- 选中文件高亮
- 文件夹对话框

### 新增 IPC
- `dialog:openFolder` - 打开文件夹对话框
- `fs:readDir` - 递归读取目录
- `fs:readFile` - 读取文件内容

### 新增组件
- `FileTree.tsx` - 文件树组件

### 变更
- App.tsx 添加文件夹状态管理
- 主进程添加文件系统 IPC handlers

---

## [0.1.0] - 2026-01-02 14:00

### 新增
- 项目初始化
- Electron + React + TypeScript 脚手架
- 基础目录结构（main/renderer/preload）
- TypeScript 严格模式配置
- Vite 热重载开发环境
- macOS 原生标题栏样式
- 明暗主题 CSS 变量

### 技术栈
- Electron 39.2.7
- React 19.2.3
- TypeScript 5.9.3
- Vite 7.3.0
- electron-vite 5.0.0

### 新增文件
- `src/main/index.ts` - 主进程入口
- `src/preload/index.ts` - 预加载脚本
- `src/renderer/src/App.tsx` - 主应用组件
- `src/renderer/src/main.tsx` - React 入口
- `src/renderer/src/assets/main.css` - 主样式
- `electron.vite.config.ts` - Vite 配置
- `tsconfig.json` - TypeScript 配置

---

## 版本说明

### 版本号规则
- **主版本号**：重大架构变更或不兼容的 API 修改
- **次版本号**：新增功能（向后兼容）
- **修订号**：bug 修复和小改进

### 里程碑对应版本
- **M1 项目初始化** → v0.1.0
- **M2 文件系统** → v0.2.0
- **M3 Markdown 渲染** → v0.3.0
- **M4 多标签系统** → v0.4.0
- **M5 搜索 + 导出** → v0.5.0
- **M6 状态持久化 + 打包** → v1.0.0 (正式版)
- **M7 测试 + v1.1 新功能** → v1.1.0
- **M8 Bug 修复 + 性能优化** → v1.1.1

---

## 类型说明

- **新增**: 新功能
- **变更**: 现有功能的变更
- **废弃**: 即将移除的功能
- **移除**: 已移除的功能
- **修复**: Bug 修复
- **安全**: 安全相关修复
