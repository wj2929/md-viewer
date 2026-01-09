# MD Viewer - Claude 项目指令

> **用途**：为 AI 助手（Claude Code、Cursor 等）提供项目上下文和开发规范
> **最后更新**：2026-01-09

---

## 📋 项目概览

**项目名称**：MD Viewer
**类型**：Electron 桌面应用（Markdown 预览器）
**当前版本**：v1.3.7
**技术栈**：Electron 39 + React 19 + TypeScript 5.9 + Vite 7
**GitHub**：https://github.com/wj2929/md-viewer

---

## 🎯 核心功能

- 文件树浏览 + 多标签预览
- 标签页固定 + 书签系统（v1.3.6+）
- 最近文件快速访问（v1.3.6+）
- 右键添加书签（v1.3.7+）
- Markdown 渲染（GitHub 风格）
- 代码高亮 + 数学公式 + Mermaid 图表
- 实时文件监听 + 自动刷新
- 导出 HTML/PDF（支持 Mermaid）
- 模糊搜索 + 全文搜索

---

## 🚨 **重要！发布检查规则**

### **在标记为"已发布"之前，必须运行发布检查脚本：**

```bash
# 方式 1：npm script
npm run release:check

# 方式 2：直接运行
./scripts/release-check.sh
```

### **检查脚本验证：**
- ✅ package.json 版本号与 Git tag 匹配
- ✅ 工作区干净（无未提交修改）
- ✅ 本地与远程同步
- ✅ GitHub Release 已发布（非 Draft）
- ✅ Git tag 已推送到远程

### **只有所有检查通过后，才能：**
1. 在 `PROGRESS.md` 标记"已发布"
2. 更新 `CONTEXT-RECOVERY.md` 快速恢复指令
3. 告诉用户"发布完成"

### **为什么需要这个规则？**

在 v1.3.7 发布时，曾出现严重问题：
- ❌ package.json 版本号未更新（停留在 1.3.5）
- ❌ GitHub Release 是 Draft 状态（未发布）
- ❌ 提交未推送到远程

导致用户无法看到最新版本。创建自动检查脚本防止再次发生。

**详细文档**：
- [scripts/README.md](scripts/README.md) - 脚本详细说明
- [README.md](README.md#发布流程) - 完整发布流程

---

## 📁 项目结构

```
md-viewer/
├── src/
│   ├── main/              # 主进程（Electron）
│   │   ├── index.ts       # 主进程入口 + IPC handlers
│   │   ├── appDataManager.ts  # 数据持久化（书签、固定标签等）
│   │   └── contextMenuHandler.ts  # 右键菜单
│   ├── preload/           # 预加载脚本（IPC 桥接）
│   │   └── index.ts       # API 定义
│   └── renderer/          # 渲染进程（React）
│       └── src/
│           ├── App.tsx    # **核心组件**（书签数据统一管理）
│           ├── components/
│           │   ├── VirtualizedMarkdown.tsx  # Markdown 渲染
│           │   ├── BookmarkBar.tsx    # 顶部书签栏
│           │   ├── BookmarkPanel.tsx  # 右侧书签面板
│           │   ├── TabBar.tsx         # 标签栏
│           │   └── FileTree.tsx       # 文件树
│           └── assets/    # 样式文件
├── scripts/               # 自动化脚本
│   ├── release-check.sh   # 发布验证脚本 ✅
│   └── README.md          # 脚本说明文档
├── package.json           # 项目配置 + npm scripts
├── CHANGELOG.md           # 变更日志
└── README.md              # 项目主文档
```

---

## 🛠️ 开发规范

### **代码提交规范**

使用 Conventional Commits：

```bash
# 类型
feat:     新功能
fix:      Bug 修复
docs:     文档更新
chore:    构建/工具配置
refactor: 代码重构
test:     测试相关
perf:     性能优化

# 示例
git commit -m "feat(v1.3.7): 添加右键添加书签功能"
git commit -m "fix(v1.3.7): 修复 Menu 未导入的问题"
git commit -m "docs(v1.3.7): 更新 README 添加发布流程"
```

**重要**：commit message 中**不要**包含：
- ❌ `🤖 Generated with Claude Code`
- ❌ `Co-Authored-By: Claude ...`
- ❌ 任何暴露 AI 辅助开发的标识

### **测试规范**

```bash
# 运行所有测试
npm test -- --run

# 预期结果
# ✅ 381+ 通过
# ✅ 0 失败
# ✅ 13 跳过（虚拟滚动已禁用）
```

### **Git 提交前检查**

```bash
# 1. 运行测试
npm test -- --run

# 2. 类型检查
npm run typecheck

# 3. 确保工作区干净
git status
```

---

## 📚 关键文档位置

### **项目内文档**
| 文件 | 说明 |
|------|------|
| `README.md` | 项目主文档 + 发布流程 |
| `CHANGELOG.md` | 变更日志 |
| `scripts/README.md` | 脚本使用说明 |
| `package.json` | 版本号 + npm scripts |

### **外部文档**（在 `/Users/mac/Documents/test/testmd/`）
| 文件 | 说明 |
|------|------|
| `PROGRESS.md` | **进度追踪**（最新状态 + 发布检查清单）|
| `CONTEXT-RECOVERY.md` | **上下文恢复指南**（Token 耗尽时使用）|
| `V1.3.7-BOOKMARK-ENHANCEMENT.md` | v1.3.7 实现方案 |
| `V1.3.6-HYBRID-ARCHITECTURE.md` | v1.3.6 架构设计 |

---

## 🔑 关键架构决策

### **v1.3.6 混合方案架构**

```
Header（全局导航）
├── NavigationBar（Logo + 路径 + 搜索 + 设置 + 主题）
├── TabBar（当前打开的文件标签，无标签时隐藏）
└── BookmarkBar（收藏的文件书签，默认折叠，点击展开）

MainLayout（三列布局）
├── Sidebar（左侧文件树）
├── ContentArea（中间 Markdown 预览）
└── BookmarkPanel（右侧书签面板，支持拖拽排序）
```

### **书签数据管理**

**重要**：书签数据在 `App.tsx` 统一管理，避免重复加载！

```typescript
// App.tsx
const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

// BookmarkBar 和 BookmarkPanel 通过 props 接收
<BookmarkBar bookmarks={bookmarks} />
<BookmarkPanel bookmarks={bookmarks} onBookmarksChange={loadBookmarks} />
```

### **右键菜单系统（v1.3.7）**

- **Markdown 页面右键**：检测标题，支持添加标题书签和文件书签
- **文件树右键**：右键 .md 文件直接添加书签（无需打开）
- **合并原有功能**：导出 HTML/PDF + 复制功能

---

## 🚀 常用命令

```bash
# 开发
npm run dev              # 启动开发模式（热重载）

# 测试
npm test -- --run        # 运行所有测试
npm run test:ui          # 测试 UI
npm run test:coverage    # 覆盖率报告

# 构建
npm run build            # 构建应用
npm run build:mac        # 打包 macOS 版本
npm run build:win        # 打包 Windows 版本
npm run build:linux      # 打包 Linux 版本

# 发布检查 ✅
npm run release:check    # 验证发布条件

# Git
git status               # 查看状态
git log --oneline -10    # 查看最近 10 次提交

# GitHub
gh release list          # 查看 releases
gh run list              # 查看 CI 状态
```

---

## 📊 版本历史

| 版本 | 发布日期 | 主要功能 |
|------|---------|---------|
| v1.3.5 | 2026-01-08 | 基础功能 |
| v1.3.6 | 2026-01-09 上午 | 混合方案架构 + 书签系统 |
| **v1.3.7** | **2026-01-09 下午** | **书签增强（右键添加）+ 发布修复** |
| v1.4.0 | 计划中 | 页面内搜索 + 编辑器模式 |

---

## 🎯 下一步计划（v1.4.0）

- 📋 页面内搜索（Cmd+F）
- ✏️ 编辑器模式（CodeMirror 源码编辑）
- 🖼️ 图片粘贴功能

---

## ⚠️ 重要提醒

### **安全约束**
- 文件必须在 `allowedBasePath` 内
- 使用相对路径存储（防止路径遍历）
- 书签最多保存 100 条（LRU 清理）
- 每文件夹最多 15 个固定标签

### **已知问题**
1. **大文件渲染可能卡顿** - 已添加 10000 行截断保护
2. **虚拟滚动暂时禁用** - 分段渲染存在兼容问题，后续版本修复

---

## 🤝 与 AI 协作建议

### **每次对话开始时**
1. 先读取 `/Users/mac/Documents/test/testmd/PROGRESS.md` 了解最新状态
2. 如果 Token 耗尽恢复对话，使用 `CONTEXT-RECOVERY.md` 中的快速恢复指令

### **完成任务后**
1. 运行测试确保无回归
2. 更新相关文档（PROGRESS.md、CONTEXT-RECOVERY.md）
3. 如果是发布，**必须运行** `npm run release:check`

### **提交代码前**
1. 检查 commit message 格式
2. 确保不包含 AI 辅助开发标识
3. 运行 `git status` 确认无误

---

**最后更新**：2026-01-09 by Claude Sonnet 4.5
