# 更新日志

本文档记录 MD Viewer 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.1.1] - 2026-01-03 (开发中)

**状态**: ⏳ **开发中 - 性能优化**

### 修复
- 🔧 **修复界面卡死问题** - useEffect 依赖陷阱导致的无限重订阅
  - 使用 `useRef` 存储 tabs 最新值
  - 依赖数组只包含 `folderPath`
- 🔧 **修复 CSP 策略** - 动态设置开发/生产模式 CSP
- 🔧 **修复外部图片加载** - 允许 HTTPS 图片（shields.io 徽章）

### 性能优化 (进行中)
- ⚡ **glob 扫描** - 直接找 .md 文件，不遍历 node_modules 等目录
- ⚡ **按需监听** - 只监听已打开的文件，而非整个目录
- ⚡ **新增 watchFile API** - 打开文件时添加到监听列表

### 技术细节
- 新增依赖：`glob@latest`
- 修改文件：App.tsx, index.ts, index.html, preload

---

## [1.1.0] - 2026-01-03 🚨 YANKED

**状态**: ✅ **已修复** (见 1.1.1)

本版本的界面卡死问题已在 1.1.1 中修复。

### 🚨 已修复的问题
- 🔴 **阻塞性Bug**: 打开md文件后界面永久卡住 → **已修复**
- **根本原因**: useEffect 依赖数组包含 `tabs`，导致每次打开文件都重新订阅监听
- **修复时间**: 2026-01-03 14:20-14:40

### 🔍 调试过程（2026-01-03）

#### 已排除的原因
- ❌ KaTeX数学公式（完全禁用后仍卡）
- ❌ Prism代码高亮（完全禁用后仍卡）
- ❌ Mermaid图表（完全禁用后仍卡）
- ❌ Markdown渲染（改为纯文本后仍卡）
- ❌ React无限循环（修复所有依赖问题后仍卡）
- ❌ React.StrictMode（禁用后仍卡）

#### 已实施的修复尝试
1. 移除 `useMemo` 里的 `setState` (MarkdownRenderer.tsx:185)
2. 移除 `useEffect` 依赖中的 `tabs` (App.tsx:143)
3. 移除 `handleFileSelect` 依赖中的 `tabs` (App.tsx:216)
4. 使用 `useMemo` 缓存 `activeTab` (App.tsx:224)
5. 添加 `React.memo` 包裹 MarkdownRenderer (MarkdownRenderer.tsx:312)
6. 禁用 React.StrictMode (main.tsx:12)
7. 完全禁用所有渲染功能（只显示纯文本）
8. 添加详细的性能日志追踪

#### 当前怀疑
- 文件监听事件订阅可能导致无限循环
- DOM渲染后的某个异步操作阻塞主线程
- Electron IPC通信问题

### ✅ 已完成的工作
- ✅ 修复所有测试问题 (125/125通过)
- ✅ 修复XSS安全漏洞 (html:false)
- ✅ 修复文件监听EMFILE错误
- ✅ 优化chokidar配置
- ✅ 添加65个新单元测试
- ✅ 创建完整的QA体系文档

### 技术细节
- 测试框架：Vitest 4.0.16
- 测试通过率：100% (125/125)
- 预期覆盖率：60-70%
- 打包大小：137 MB (DMG)

**建议**: 等待v1.1.1修复版本

---

## [1.1.0-alpha] - 2026-01-03 (未发布)

### 新增功能
- ✨ **Mermaid 图表支持** - 支持流程图、时序图、类图、状态图、甘特图等
  - 自动渲染 Markdown 中的 mermaid 代码块
  - 明暗主题自适应
  - 错误时保留原始代码显示
- 👀 **实时文件监听** - 使用 chokidar 监听文件系统变化
  - 文件修改时自动刷新已打开的标签页
  - 文件添加时自动刷新文件树
  - 文件删除时自动关闭对应标签并刷新文件树
- 🔄 **自动刷新功能** - 无需手动重新加载，提升编辑体验

### 测试体系扩充
- ✅ **新增 65 个单元测试** - 测试总数从 60 → 125 (+108%)
  - TabBar: 18 测试（100% 通过，90%+ 覆盖率）
  - ErrorBoundary: 12 测试（100% 通过，80%+ 覆盖率）
  - fileCache: 14 测试（100% 通过，85%+ 覆盖率）
  - App.tsx: 21 测试（100% 通过）
- ✅ **测试通过率: 100%** (125/125 全部通过)
- ✅ **E2E 测试框架** - Playwright 配置完成
- ✅ **质量保证体系** - 回归测试清单、覆盖率分析、安全审查、性能测试

### 安全修复
- 🔒 **修复 XSS 漏洞** - 禁用 markdown-it html:true 配置
- 🔒 **代码结构优化** - 所有函数定义顺序正确

### 技术细节
- 新增依赖：`mermaid@^11.0.0`、`chokidar@^4.0.0`
- 测试框架：Vitest 4.0.16 + @testing-library/react 16.3.1
- E2E 框架：Playwright 1.57.0
- 更新 preload API 类型定义
- 新增文件监听 IPC handlers

### 文档
- 📚 新增测试总结文档 (TEST_SUMMARY.md)
- 📚 新增安全审查报告 (SECURITY_AUDIT.md)
- 📚 新增 QA 指南 (QA_GUIDE.md)
- 📚 新增回归测试清单 (REGRESSION_TEST_CHECKLIST.md)

---

## [1.0.0] - 2026-01-02

### 新增
- 📁 **文件树浏览** - 递归显示文件夹中的所有 Markdown 文件
- 📑 **多标签预览** - 同时打开多个文件，自由切换
- 🎨 **Markdown 渲染** - 支持标题、列表、表格、引用等完整语法
- 💻 **代码高亮** - 支持 15+ 编程语言 (Prism.js VSCode Dark+ 主题)
  - JavaScript, TypeScript, JSX, TSX
  - Python, Java, Go, Rust
  - Bash, JSON, YAML, CSS, Markdown
- 📐 **数学公式** - KaTeX 渲染 LaTeX 公式
  - 行内公式 `$...$`
  - 块级公式 `$$...$$`
- 🔍 **文件名搜索** - Fuse.js 模糊搜索
  - 快捷键 `⌘K` / `Ctrl+K`
  - 实时搜索结果
  - 最多显示 10 个结果
- 📝 **全文搜索** - 搜索所有 Markdown 文件内容
  - 显示匹配片段（上下文 40 字符）
  - 高亮匹配关键词
- 💾 **导出功能**
  - HTML 导出（内联 CSS + KaTeX 支持）
  - PDF 导出（Electron printToPDF API）
- 🔄 **状态持久化** - electron-store v8
  - 窗口大小和位置记忆
  - 自动恢复最后打开的文件夹
- 🛡️ **错误处理**
  - ErrorBoundary 全局错误捕获
  - 友好的错误提示界面
  - Markdown 渲染错误降级
- ⚡ **性能优化**
  - LRU 文件内容缓存（最多 5 个文件）
  - 文件大小限制（主进程 5MB，渲染器 10000 行）
- 🌓 **主题支持** - 自动跟随系统明暗主题

### 技术栈
- Electron 39.2.7
- React 19.2.3
- TypeScript 5.9.3
- Vite 7.3.0
- markdown-it 14.1.0
- Prism.js 1.30.0
- KaTeX 0.16.27
- Fuse.js 7.1.0
- electron-store 8.2.0

### 测试
- 🧪 **60 个单元测试** (100% 通过率)
  - FileTree: 100% 覆盖率
  - MarkdownRenderer: 85.57% 覆盖率
  - SearchBar: 84.76% 覆盖率
- 🤖 **CI/CD 自动化**
  - GitHub Actions 跨平台测试
  - 自动化测试和覆盖率报告
  - 自动化打包 (macOS/Linux/Windows)

### 打包
- macOS: `MD Viewer-1.0.0-arm64.dmg` (109 MB)
- Windows: 待发布
- Linux: 待发布

### 文档
- ✅ README.md - 项目说明和使用指南
- ✅ TESTING_GUIDE.md - 测试编写指南
- ✅ TEST_REPORT.md - 测试覆盖率报告

---

## 版本号规则

- **主版本号 (Major)**: 重大架构变更或不兼容的 API 修改
- **次版本号 (Minor)**: 新增功能（向后兼容）
- **修订号 (Patch)**: Bug 修复和小改进

---

## 类型说明

- **新增**: 新功能
- **改进**: 现有功能的优化
- **修复**: Bug 修复
- **移除**: 已移除的功能
- **废弃**: 即将移除的功能
- **安全**: 安全相关修复
- **技术细节**: 技术实现细节
- **文档**: 文档更新

---

**维护者**: Claude Code + User
**最后更新**: 2026-01-03
