# 更新日志

本文档记录 MD Viewer 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.1.0] - 2026-01-03

### 新增
- ✨ **Mermaid 图表支持** - 支持流程图、时序图、类图、状态图、甘特图等
  - 自动渲染 Markdown 中的 mermaid 代码块
  - 明暗主题自适应
  - 错误时保留原始代码显示
- 👀 **实时文件监听** - 使用 chokidar 监听文件系统变化
  - 文件修改时自动刷新已打开的标签页
  - 文件添加时自动刷新文件树
  - 文件删除时自动关闭对应标签并刷新文件树
- 🔄 **自动刷新功能** - 无需手动重新加载，提升编辑体验

### 改进
- 📝 更新 README 文档，添加 Mermaid 使用说明
- 🧪 完善测试 Mock 策略（Mermaid + window.matchMedia）
- 🎨 优化 Mermaid 图表样式，适配明暗主题

### 技术细节
- 新增依赖：`mermaid@^11.0.0`
- 新增依赖：`chokidar@^4.0.0`
- 更新 preload API 类型定义
- 新增文件监听 IPC handlers

### 测试
- ✅ 所有 60 个单元测试通过
- ✅ Mermaid 渲染测试 Mock
- ✅ 文件监听事件测试准备就绪

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
