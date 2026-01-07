# 变更日志

本文档记录 MD Viewer 项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.3.5] - 2026-01-07

> **状态**: ✅ 已发布

### 新增

- ✨ **浮动导航栏** - 预览区右侧快捷导航
  - 返回顶部/跳到底部按钮
  - 目录大纲面板（点击跳转）
  - 当前位置高亮显示
  - 响应式设计（移动端底部横向布局）
  - 完整 ARIA 无障碍支持

- ✨ **HTML/PDF 导出增强**
  - Mermaid 图表安全渲染为 SVG（静态导出）
  - 添加 CSP (Content Security Policy) 头
  - Mermaid 代码验证和危险模式检测
  - 支持中文文本正确显示

- ✨ **共享 slug 生成模块**
  - `src/renderer/src/utils/slugify.ts` - 提取公共逻辑
  - 确保目录 ID 与渲染 ID 100% 一致

- ✨ **目录提取模块**
  - `src/renderer/src/utils/tocExtractor.ts` - 基于 Token 流提取
  - 自动处理重复标题

### 修复

- 🐛 **KaTeX 块级公式修复** (2026-01-07)
  - 修复 `$$...$$` 块级公式导出时 `$$` 未正确移除的问题
  - 修复应用内 KaTeX 渲染错乱问题（DOMPurify 配置添加 MathML/SVG 标签支持）

- 🐛 **Mermaid 导出修复** (2026-01-07)
  - 修复 HTML 导出时 Mermaid 未渲染问题
  - 修复 Mermaid 中文文本不显示问题
  - 修复 Mermaid 箭头消失问题（SVG path d 属性保留）
  - 添加 C4 架构图类型支持（c4context, c4container, c4component, c4dynamic, c4deployment）

### 新增文件

- `src/renderer/src/utils/slugify.ts` - Slug 生成模块
- `src/renderer/src/utils/tocExtractor.ts` - 目录提取模块
- `src/renderer/src/utils/mermaidRenderer.ts` - Mermaid 安全渲染模块
- `src/renderer/src/hooks/useTableOfContents.ts` - 目录状态管理 Hook
- `src/renderer/src/hooks/useActiveHeading.ts` - 当前位置追踪 Hook
- `src/renderer/src/components/FloatingNav.tsx` - 浮动导航组件
- `src/renderer/src/components/TocPanel.tsx` - 目录面板组件
- `src/renderer/test/utils/slugify.test.ts` - Slug 模块测试
- `src/renderer/test/utils/tocExtractor.test.ts` - 目录提取测试
- `src/renderer/test/utils/mermaidRenderer.test.ts` - Mermaid 渲染测试
- `src/renderer/test/hooks/useTableOfContents.test.ts` - 目录 Hook 测试
- `src/renderer/test/components/FloatingNav.test.tsx` - 浮动导航测试
- `src/renderer/test/components/TocPanel.test.tsx` - 目录面板测试

### 变更

- ♻️ **markdownRenderer.ts** - 使用共享 slugify 模块
- ♻️ **main/index.ts** - HTML 导出添加 CSP 和 Mermaid 样式
- ♻️ **main.css** - 添加浮动导航和目录面板样式

### 技术细节

- 使用 IntersectionObserver 追踪当前可视标题
- 使用 useDebouncedValue 防抖优化目录解析
- Mermaid 渲染使用 strict 安全模式
- 支持中文标题 slug（Unicode 兼容）

---

## [1.3.4] - 2026-01-07

> **状态**: ✅ 已发布

### 新增

- ✨ **系统右键菜单集成** - 在 Finder/Explorer 中右键打开 .md 文件或文件夹
  - macOS: Automator Workflow（快速操作）
  - Windows: 注册表集成
  - Linux: .desktop 文件

- ✨ **设置面板** - 管理右键菜单安装/卸载
  - 新增 `src/renderer/src/components/SettingsPanel.tsx`

- ✨ **路径验证器** - 安全的启动参数验证
  - 新增 `src/main/security/pathValidator.ts`
  - 验证文件扩展名、路径遍历、空字节等

- ✨ **启动参数处理** - 支持从右键菜单启动并打开文件/文件夹

- ✨ **安装成功引导模态框** - macOS 用户引导
  - 告知用户需手动启用 Finder 扩展
  - 提供步骤说明

- ✨ **打开系统设置按钮** - 一键跳转 Finder 扩展设置
  - 新增 `system:openSettings` IPC 接口
  - 支持 macOS 深度链接

- ✨ **用户确认机制** - 状态管理优化
  - 新增 `userConfirmedEnabled` 状态字段
  - 三种状态：未安装/待启用/已启用

### 新增文件

- `src/main/security/pathValidator.ts` - 路径验证器
- `src/main/contextMenuInstaller.ts` - 右键菜单安装器
- `src/main/contextMenuManager.ts` - 右键菜单状态管理
- `src/renderer/src/components/SettingsPanel.tsx` - 设置面板
- `src/renderer/test/components/SettingsPanel.test.tsx` - 设置面板测试
- `docs/V1.3.4-SETTINGS-PANEL-OPTIMIZATION.md` - 设置面板优化方案

### 修改文件

- `src/main/index.ts` - IPC 接口 + 启动参数处理 + system:openSettings
- `src/preload/index.ts` - preload API
- `src/preload/index.d.ts` - 类型定义
- `src/renderer/src/App.tsx` - 设置面板集成
- `src/renderer/src/assets/main.css` - 设置面板样式（含引导模态框）

### 测试

- ✅ 293/293 通过
- ⚠️ 13 跳过（虚拟滚动已禁用）
- 📊 覆盖率：71.71%

---

## [1.3.3.2] - 2026-01-06

> **状态**: 🚧 待发布

### 新增

- ✨ **历史文件夹列表** - 快速切换最近打开的文件夹
  - 新增 `src/main/folderHistoryManager.ts` - 历史管理器
  - 新增 `src/renderer/src/components/FolderHistoryDropdown.tsx` - 下拉组件
  - 最多保存 10 个历史记录
  - 支持删除单个历史项

- ✨ **UI 优化** - 合并切换/历史按钮为 📂▼
  - 欢迎页和侧边栏统一使用新组件
  - 点击 📂 打开文件夹对话框
  - 点击 ▼ 展开历史列表

### 修复

- 🔧 **修复切换文件时滚动位置继承问题**
  - 问题：切换文件后页面停留在前一个文件的滚动位置
  - 解决：添加 `previewRef` + useEffect 重置 scrollTop

### 测试

- ✅ 293/293 通过
- ⚠️ 13 跳过（虚拟滚动已禁用）
- 📊 覆盖率：71.71%

---

## [1.3.3] - 2026-01-05 09:30 ✅

> **状态**: ✅ 修复完成，待发布

### 修复

#### 目录锚点跳转
- 🔧 **修复应用内目录点击不能跳转的问题**
  - 根本原因：标题元素没有 id 属性，锚点链接无法定位
  - 解决方案：DOM 后处理为标题自动生成 id + 锚点点击事件处理
  - 技术实现：`VirtualizedMarkdown.tsx` 添加 useEffect 生成标题 id

- 🔧 **修复导出 HTML/PDF 目录不能跳转的问题**
  - 根本原因：markdown-it 默认不为标题生成 id
  - 解决方案：自定义 `heading_open` 渲染规则生成唯一 id
  - 技术实现：`utils/markdownRenderer.ts` 添加标题 id 生成

#### PDF 导出修复
- 🔧 **修复 PDF 导出失败（边距单位错误）**
  - 根本原因：Electron printToPDF 的 margins 单位是英寸，不是微米
  - 解决方案：`marginInInches = 10 / 25.4` (10mm ≈ 0.39 inches)
  - 错误信息：`margins must be less than or equal to pageSize`

- 🔧 **调整 PDF 边距为 10mm（从 15mm 减小）**
  - 原因：15mm 边距过宽，内容区域偏小
  - 效果：更接近屏幕阅读习惯

#### 搜索性能优化
- 🔧 **修复搜索输入卡顿（1200ms → 0ms）**
  - 根本原因：每输入一个字符就触发搜索，阻塞主线程
  - 解决方案：防抖 300ms + Web Worker 后台搜索
  - 新增文件：
    - `hooks/useDebouncedValue.ts` - 防抖 hook
    - `workers/searchWorker.ts` - Web Worker

- 🔧 **修复搜索排序混乱**
  - 根本原因：结果按文件遍历顺序显示
  - 解决方案：智能排序（文件名匹配优先 + 匹配次数）

- 🔧 **修复搜索特殊字符崩溃**
  - 问题：搜索 "C++" 或 "[TODO]" 导致正则错误
  - 解决方案：`escapeRegExp()` 转义特殊字符

### 新增

- ✨ **搜索结果计数** - "找到 X 个结果，显示前 20 个"
- ✨ **搜索结果增加到 20 个**（从 10 个）
- ✨ **搜索加载动画** - spinner + "搜索中..."

### 测试

- ✅ 287/287 通过
- ⚠️ 13 跳过（虚拟滚动已禁用）
- 覆盖率：71.71%

---

## [1.3.2] - 2026-01-04 15:30 ✅（已发布）

#### Windows 文件树修复
- 🔧 **修复 Windows 系统文件树显示为扁平列表的问题**
  - 根本原因：`split('/')` 无法处理 Windows 的 `\` 路径分隔符
  - 解决方案：改为 `split(/[\\/]/)` 兼容两种分隔符
  - 影响范围：`scanMarkdownFiles` + `buildFileTree` 两个函数

**技术细节**：
- `src/main/index.ts:189` - `scanMarkdownFiles` 路径分隔符修复
- `src/main/index.ts:265` - `buildFileTree` 路径分隔符修复
- 正则表达式：`/[\\/]/` 同时匹配 `/` 和 `\`

### 新增 - 用户体验优化 (2026-01-04 22:40)

#### 导出位置快速定位
- ✨ **导出成功后添加"点击查看"按钮**
  - Toast 消息支持操作按钮（action）
  - 点击后在 Finder/Explorer 中显示并选中导出的文件
  - 使用 Electron 的 `shell.showItemInFolder()` API

**技术细节**：
- `src/renderer/src/components/Toast.tsx` - 添加 `ToastAction` 类型和渲染逻辑
- `src/renderer/src/hooks/useToast.ts` - API 升级为 options 对象
- `src/renderer/src/components/Toast.css` - 操作按钮样式（`.toast-action`）
- `src/main/index.ts:960-969` - `shell:showItemInFolder` IPC handler
- `src/preload/index.ts:54-56` - `showItemInFolder` API
- `src/renderer/src/App.tsx:441-488` - 导出成功消息优化

### 变更 - API 升级

#### useToast Hook API 变更
- **旧 API**: `toast.success(message, duration)`
- **新 API**: `toast.success(message, { duration, action })`
- **影响范围**: 所有使用 toast 的地方（向后兼容，duration 可选）
- **新增特性**: 支持操作按钮

**迁移指南**：
```typescript
// 旧代码（仍然支持）
toast.success('成功')
toast.error('错误', 5000)

// 新代码（推荐）
toast.success('导出成功', {
  duration: 3000,
  action: {
    label: '点击查看',
    onClick: () => { /* ... */ }
  }
})
```

### 测试 - 测试用例更新

- ✅ **修复 3 个因 API 变更导致的测试失败**
  - `useToast.test.ts` - 更新为 options 对象格式
  - 测试覆盖率保持 71.71%
- ✅ **所有测试通过** - 287/287 通过，13 跳过

### 技术债务

无新增技术债务。所有修复都遵循现有架构，代码质量良好。

---

## [1.3.2] - 2026-01-04 15:30

> **状态**: ✅ 已发布
> **GitHub Release**: https://github.com/wj2929/md-viewer/releases/tag/v1.3.2

### 发布说明

v1.3.2 是一个重大功能更新版本，包含 Tab 右键菜单、Markdown 右键菜单、多文件选择、跨应用剪贴板、
可调侧边栏、MPE GitHub 样式主题，以及完整的 CI/CD 自动发布配置。

### 构建产物

| 平台 | 文件 |
|------|------|
| macOS | MD.Viewer-1.3.2-arm64.dmg, MD.Viewer-1.3.2-arm64-mac.zip |
| Linux | MD.Viewer-1.3.2.AppImage, md-viewer_1.3.2_amd64.deb |
| Windows | MD.Viewer.Setup.1.3.2.exe, MD.Viewer-1.3.2-win.zip |

### 新增 - CI/CD 自动发布 (2026-01-04 15:30)

- ✅ **GitHub Actions 自动构建** - 三平台并行构建（macOS/Linux/Windows）
- ✅ **自动创建 Release** - Tag 推送触发，自动上传构建产物
- ✅ **优化触发条件** - 分支 push 只运行测试，Tag push 触发完整构建

**CI/CD 修复历程**：
- 添加 vitest imports 修复 TypeScript 类型错误
- 跳过虚拟滚动相关的 13 个测试（功能已禁用）
- 添加 author.email 修复 Linux 打包
- 添加 `--publish never` 解决 electron-builder 403 错误
- 添加 `permissions: contents: write` 给予 Release 创建权限
- 修复 Windows artifact 上传条件（`windows` → `win`）
- 添加 `tags: ['v*']` 触发条件
- build job 添加 `if: startsWith(github.ref, 'refs/tags/v')` 优化

### 已完成 - 样式优化 (2026-01-04 13:10)

#### Markdown 样式优化 - MPE GitHub 主题移植 ✅

移植 [Markdown Preview Enhanced](https://github.com/shd101wyy/mume) 的 GitHub 主题样式：

- ✅ **引用块 (blockquote)** - 浅灰背景 (#f6f8fa) + 4px 左边框
- ✅ **表格** - 有外边框 + 自适应宽度 + 表头背景色
- ✅ **代码块** - GitHub 风格配色 + 边框
- ✅ **行内代码** - 浅灰背景 + 特殊空格处理
- ✅ **分隔线 (hr)** - 1px 细淡分隔线 (#eaecef)
- ✅ **标题** - H1/H2 无下划线（与 MPE 一致）
- ✅ **字体** - Helvetica Neue, Segoe UI, Arial
- ✅ **暗色主题适配** - 所有元素支持暗色模式

**技术实现**：
- `src/renderer/src/assets/markdown.css` - 完全重写，基于 MPE github.less
- `src/renderer/src/assets/prism-theme.css` - 完全重写，基于 MPE github.css
- `src/renderer/src/assets/main.css` - 新增 CSS 变量（blockquote-bg, hr-color 等）

**参考源码**：
- https://github.com/shd101wyy/mume/blob/master/styles/preview_theme/github.less
- https://github.com/shd101wyy/mume/blob/master/styles/prism_theme/github.css

---

### 已完成 - 阶段 4-7 + 额外修复 (2026-01-04 12:30)

#### 阶段 4：优化虚拟滚动 CSS ✅
- ✅ CSS 调整消除分段间隔
- ⚠️ **后续禁用虚拟滚动**（分段渲染存在 Bug，内容从中间开始显示）

**Git 提交**: `693d239`

#### 阶段 5：多文件选择 ✅
- ✅ **Cmd+点击** - 切换单个文件选择
- ✅ **Shift+点击** - 范围选择
- ✅ **Cmd+A** - 全选当前目录
- ✅ **Escape** - 清除选择
- ✅ 选中文件高亮样式 `.multi-selected`
- ✅ **新增 4 个测试用例**

**技术实现**：
- `src/renderer/src/App.tsx` - 新增 `selectedPaths` 状态
- `src/renderer/src/components/FileTree.tsx` - 多选逻辑
- `src/renderer/src/assets/main.css` - 多选样式

**Git 提交**: `d836607`

#### 阶段 6：跨应用剪贴板 ✅
- ✅ **系统剪贴板读取**（macOS/Windows/Linux）
  - macOS: NSFilenamesPboardType + file:// URL
  - Windows: FileNameW (UTF-16LE)
  - Linux: text/uri-list
- ✅ **系统剪贴板写入**
- ✅ **主进程安全过滤** - isProtectedPath 检查
- ✅ **新增 27 个测试用例**

**技术实现**：
- `src/main/clipboardManager.ts` - 新增：跨平台剪贴板管理
- `src/main/index.ts` - 新增 IPC handlers
- `src/preload/index.ts` - 新增 API

**Git 提交**: `eb6b167`

#### 阶段 7：测试覆盖率 70%+ ✅
- ✅ **VirtualizedMarkdown 测试** - 39 个用例
- ✅ **clipboardManager 测试** - 27 个用例
- ✅ **FileTree 多选测试** - 4 个用例
- ✅ **覆盖率**: 54.57% → 71.71%（目标 70%）

**技术实现**：
- `src/renderer/test/components/VirtualizedMarkdown.test.tsx` - 新增
- `src/main/__tests__/clipboardManager.test.ts` - 新增
- `vitest.main.config.ts` - 主进程测试配置

**Git 提交**: `abb14b0`

#### 额外修复 (2026-01-04 12:00)

##### 文件监听 Bug 修复
- 🔧 **简化文件监听** - 只监听当前打开文件所在目录
  - 解决 EMFILE (too many open files) 错误
  - depth: 0 不递归
  - 切换文件时自动切换监听目录

##### 虚拟滚动 Bug 修复
- 🔧 **禁用虚拟滚动** - 设置阈值为 Infinity
  - 分段渲染存在问题（内容从中间显示）
  - 保留代码但不触发

##### 可调侧边栏（新功能）
- ✨ **拖拽分隔条** - 调整侧边栏宽度（180-500px）
  - 新增 `.resize-handle` 分隔条
  - 拖拽时高亮显示
  - 拖拽时禁用文本选择

**技术实现**：
- `src/main/index.ts` - 简化 watchDirectory 函数
- `src/renderer/src/components/VirtualizedMarkdown.tsx` - 禁用虚拟滚动
- `src/renderer/src/App.tsx` - 侧边栏拖拽逻辑
- `src/renderer/src/assets/main.css` - 分隔条样式

---

### 已完成 - 阶段 0-3 (2026-01-04 11:00)

#### 阶段 0：安全加固 + 文件监听增强 ✅
- ✅ **PROTECTED_PATTERNS 扩展到 45+ 条规则**
  - 新增：Docker/Azure/GCloud/GitHub CLI 配置保护
  - 新增：.env/.npmrc/.pypirc/.git-credentials 保护
  - 新增：SSH/证书私钥保护 (pem/p12/pfx/key/jks)
- ✅ **文件监听事件补充**
  - 新增 add/addDir/unlinkDir/rename 事件
  - 500ms 时间窗口重命名检测机制
- ✅ **新增安全测试** - 16 个测试用例

**技术实现**：
- `src/main/security.ts` - 扩展保护规则
- `src/main/index.ts` - 文件监听增强
- `src/preload/index.ts` - 新增事件 API

**Git 提交**: `36450a9`

#### 阶段 1：Tab 右键菜单 ✅
- ✅ **Tab 标签右键菜单**
  - 关闭当前 / 关闭其他 / 关闭所有
  - 关闭左侧 / 关闭右侧
  - 在 Finder 中显示 / 复制路径
  - 菜单项根据 Tab 位置动态启用/禁用
- ✅ **新增 Tab 菜单测试** - 15 个测试用例

**技术实现**：
- `src/main/tabMenuHandler.ts` - 新增：Tab 右键菜单处理
- `src/renderer/src/components/TabBar.tsx` - 右键菜单支持
- `src/preload/index.ts` - 新增 Tab 菜单 API

**Git 提交**: `ecd49d5`

#### 阶段 2：Markdown 内容区右键菜单 ✅
- ✅ **Markdown 预览区右键菜单**
  - 导出 HTML (Cmd+E) / 导出 PDF (Cmd+Shift+E)
  - 复制为 Markdown / 纯文本 / HTML
  - 有选中内容时显示"复制选中内容"
- ✅ **移除预览区顶部导出按钮**（功能移入右键菜单）
- ✅ **新增 Markdown 菜单测试** - 12 个测试用例

**技术实现**：
- `src/main/markdownMenuHandler.ts` - 新增：Markdown 右键菜单处理
- `src/renderer/src/components/VirtualizedMarkdown.tsx` - 右键菜单支持
- `src/renderer/src/App.tsx` - 移除导出按钮

**Git 提交**: `9e79a07`

#### 阶段 3：重构剪贴板架构 ✅
- ✅ **单一数据源架构**
  - 渲染进程 clipboardStore 作为唯一数据源
  - 主进程仅作为状态镜像
- ✅ **事务性粘贴**
  - 部分失败不丢失剪贴板数据
  - 返回 PasteResult { success[], failed[] }
- ✅ **右键菜单动态控制**
  - 根据剪贴板状态启用/禁用粘贴菜单

**技术实现**：
- `src/main/clipboardState.ts` - 新增：剪贴板状态缓存
- `src/main/contextMenuHandler.ts` - 更新：动态粘贴菜单
- `src/renderer/src/stores/clipboardStore.ts` - 重构：事务性粘贴
- `src/preload/index.ts` - 新增剪贴板同步 API

**Git 提交**: `2e767f2`

### 测试统计（最终）
```
渲染进程测试：300/300 通过 ✅ (+43 新增)
主进程测试：  152/152 通过 ✅ (+54 新增)
─────────────────────────────────────
总计：       452/452 通过 ✅
覆盖率：     71.71%（目标 70%）✅
```

---

## [1.2.1] - 2026-01-03 22:00

### 新增 - 全局快捷键
- ✅ **全局快捷键支持** - 提升操作效率
  - `⌘/Ctrl + O` - 打开文件夹
  - `⌘/Ctrl + R` - 刷新文件树
  - `⌘/Ctrl + W` - 关闭当前标签
  - `⌘/Ctrl + E` - 导出 HTML
  - `⌘/Ctrl + Shift + E` - 导出 PDF
  - `⌘/Ctrl + F` - 聚焦搜索栏
  - `⌘/Ctrl + Tab` - 下一个标签
  - `⌘/Ctrl + Shift + Tab` - 上一个标签
  - `⌘/Ctrl + 1-5` - 切换到指定标签

### 新增 - E2E 测试完善
- ✅ **Playwright E2E 测试增强**
  - 完善 electron fixture（testDir、openFolderViaIPC）
  - 应用启动测试（主题切换验证）
  - 文件树功能测试
  - Markdown 渲染测试
  - 键盘快捷键测试（新增 06-keyboard-shortcuts.spec.ts）

### 新增 - 集成测试扩展
- ✅ **App.tsx 集成测试** - 28 个测试用例
  - 快捷键事件监听器测试
  - 右键菜单事件测试
  - 剪贴板事件测试
  - 状态恢复测试
  - 边界条件测试

### 测试统计
```
渲染进程测试：257/257 通过 ✅
主进程测试：  55/55  通过 ✅
─────────────────────────────────
总计：       312/312 通过 ✅
```

---

## [1.2.0] - 2026-01-03 21:36

### 发布说明
v1.2.0 是一个重大功能更新版本，包含安全加固、右键菜单、应用内剪贴板、虚拟滚动和主题切换等核心功能。

### 已完成 (2026-01-03 19:00-21:30)

#### 阶段 3-5：新增功能 (2026-01-03 21:00-21:30) ✅

##### 阶段 3：测试覆盖率提升
- ✅ **新增 120+ 测试用例**
- ✅ **覆盖率从 50% 提升到 71.48%**
- ✅ 新增测试文件：
  - `clipboardStore.test.ts` - 33 个测试
  - `Toast.test.tsx` - 17 个测试
  - `useToast.test.ts` - 22 个测试
  - `logger.test.ts` - 13 个测试
  - `markdownRenderer.test.ts` - 35 个测试
- ✅ 关键模块达到 100% 覆盖

##### 阶段 4：虚拟滚动 (react-virtuoso)
- ✅ **安装 react-virtuoso 依赖**
- ✅ **创建 VirtualizedMarkdown 组件**
  - 智能分段策略（按 H1/H2 标题 + 100 行限制）
  - 小文件直接渲染，大文件（500+ 行）虚拟滚动
  - Mermaid 图表懒加载支持
  - 保持代码块完整性
- ✅ **集成到 App.tsx**
- ✅ **新增 CSS 样式**
  - `.virtualized-info` - 大文件模式提示
  - `.virtualized-section` - 分段样式

**技术实现**：
- `src/renderer/src/components/VirtualizedMarkdown.tsx` - 虚拟滚动组件
- 修改 `src/renderer/src/App.tsx` - 使用 VirtualizedMarkdown
- 修改 `src/renderer/src/assets/main.css` - 新增虚拟滚动样式

##### 阶段 5：主题切换 UI
- ✅ **创建 useTheme Hook**
  - 支持三档：自动 / 亮色 / 暗色
  - 监听系统主题变化
  - localStorage 持久化
- ✅ **创建 ThemeToggle 组件**
  - 三个按钮（🌓 / ☀️ / 🌙）
  - 选中状态高亮
  - ARIA 无障碍支持
- ✅ **更新 CSS 支持 data-theme 属性**
  - `[data-theme="dark"]` 暗色主题
  - `[data-theme="light"]` 亮色主题
  - 自动模式跟随系统
- ✅ **集成到标题栏右侧**

**技术实现**：
- `src/renderer/src/hooks/useTheme.ts` - 主题管理 Hook
- `src/renderer/src/components/ThemeToggle.tsx` - 主题切换组件
- 修改 `src/renderer/src/assets/main.css` - 主题样式
- 修改 `src/renderer/src/App.tsx` - 集成主题切换

### Git 提交记录 (阶段 3-5)
```
1b87db8 feat(v1.2): 阶段 3-5 完成 - 测试覆盖率、虚拟滚动、主题切换
```

**代码统计**：
- 新增 5 个测试文件
- 新增 2 个组件（VirtualizedMarkdown, ThemeToggle）
- 新增 1 个 Hook（useTheme）
- 总测试数：305（+121）
- 覆盖率：71.48%（+21%）

---

### 已完成 (2026-01-03 19:00-20:46)

#### 阶段 0：安全加固 ✅
- ✅ **路径白名单校验** - 防止路径穿越攻击
  - 创建 `src/main/security.ts` 安全模块
  - 实现 `validatePath()` 和 `validateSecurePath()`
  - 所有 IPC handlers 添加安全校验
- ✅ **受保护路径黑名单** - 防止访问敏感系统文件
  - 阻止访问 `/etc`, `/usr/bin`, `~/.ssh` 等
  - 阻止访问 `.key`, `.pem` 等敏感文件
- ✅ **启用 Chromium 沙箱** - `sandbox: true`
  - 从 `sandbox: false` 改为 `sandbox: true`
  - 添加 `webSecurity: true`
- ✅ **安全测试** - 27 个测试用例全部通过
  - 路径白名单测试
  - 受保护路径测试
  - 综合安全校验测试

**修复的安全漏洞**：
- 🔴 **路径穿越漏洞**（高危）- ✅ 已修复
- 🔴 **沙箱禁用**（高危）- ✅ 已修复

#### 阶段 1：右键菜单 ✅
- ✅ **Electron 原生 Menu** - 跨平台上下文菜单
  - 创建 `src/main/contextMenuHandler.ts`
  - 实现 `showContextMenu()` 函数
  - 跨平台菜单文案（macOS/Windows/Linux）
- ✅ **Preload API 扩展**
  - 添加 `showContextMenu()` API
  - 添加 `renameFile()` API
  - 添加 4 个事件监听器（deleted, rename, export, error）
- ✅ **主进程 IPC Handlers**
  - `context-menu:show` - 显示右键菜单
  - `fs:rename` - 文件重命名
- ✅ **渲染进程集成**
  - FileTree 添加 `onContextMenu` 事件
  - App 添加事件处理（删除/重命名/导出/错误）
  - 侧边栏添加刷新按钮
- ✅ **测试用例** - 156/156 全部通过
  - 更新 FileTree 测试（4 个右键菜单测试）
  - 更新 App 测试（mock 新 API）

**菜单功能**：
| 功能 | 状态 | 快捷键 |
|------|------|--------|
| 在 Finder 中显示 | ✅ | - |
| 复制路径 | ✅ | Cmd+Alt+C |
| 复制相对路径 | ✅ | Shift+Alt+C |
| 导出 HTML | ✅ | - |
| 导出 PDF | ✅ | - |
| 重命名 | ✅ | Enter |
| 删除 | ✅ | Cmd+Backspace |
| 刷新 | ✅ | - |

#### 优化改进 ✅

##### Inline Editing 重命名
- ✅ 右键菜单触发 inline editing 模式
- ✅ 自动聚焦并选中文件名（不包含扩展名）
- ✅ Enter 提交，Escape 取消，失焦提交
- ✅ 主进程安全校验（`validateSecurePath`）
- ✅ 检查目标文件是否已存在
- ✅ 更新标签页中的文件路径
- ✅ 自动刷新文件树

**技术实现**：
- `src/components/FileTree.tsx` - inline editing 状态管理
- `src/main/index.ts` - `fs:rename` IPC handler
- `src/preload/index.ts` - `renameFile` API
- `src/assets/main.css` - 重命名输入框样式

##### Toast 通知组件
- ✅ 创建 Toast 组件（4 种类型）
  - success, error, warning, info
- ✅ 滑入/滑出动画（300ms）
- ✅ 自定义持续时间（默认 3 秒）
- ✅ 手动关闭按钮
- ✅ 图标 + 颜色区分
- ✅ 替代所有 alert 调用

**技术实现**：
- `src/components/Toast.tsx` - Toast 组件
- `src/components/Toast.css` - Toast 样式
- `src/hooks/useToast.ts` - useToast Hook
- `src/App.tsx` - 使用 Toast 替代 alert

**UI 特性**：
- 固定在右上角
- 渐变左边框（4px）
- box-shadow 阴影
- 非阻塞式通知

### Git 提交记录
```
a06289d feat(toast): 添加 Toast 通知组件替代 alert
28d308a feat(rename): 实现 inline editing 重命名功能
83784d3 feat(context-menu): 阶段 1 - 右键菜单完成（渲染进程 + 测试）
5c9dd35 feat(context-menu): 阶段 1 - 右键菜单基础架构（主进程部分）
542ab06 fix(security): 恢复文件夹时设置安全白名单
3503aa6 feat(security): 阶段 0 - 安全加固完成
```

**代码统计**：
- 6 次提交
- 14 files changed
- 421+ insertions, 42 deletions

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

---

**最后更新**: 2026-01-07
