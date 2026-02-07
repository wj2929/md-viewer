# MD Viewer - Claude 项目指令

> **用途**：为 AI 助手（Claude Code、Cursor 等）提供项目上下文和开发规范
> **最后更新**：2026-02-07

---

## 📋 项目概览

**项目名称**：MD Viewer
**类型**：Electron 桌面应用（Markdown 预览器）
**当前版本**：v1.4.7 已发布 | v1.5.0 开发中
**技术栈**：Electron 39 + React 19 + TypeScript 5.9 + Vite 7
**GitHub**：https://github.com/wj2929/md-viewer

---

## 🎯 核心功能

- 文件树浏览 + 多标签预览
- 标签页固定 + 书签系统（v1.3.6+）
- 最近文件快速访问（v1.3.6+）
- 右键添加书签（v1.3.7+）
- **页面内搜索**（v1.4.0+）- Cmd+Shift+F
- **窗口置顶**（v1.4.2+）- Cmd+Option+T
- **字体大小调节**（v1.4.2+）- Cmd+/-/0
- **打印功能**（v1.4.2+）- Cmd+P
- **全屏查看**（v1.4.3+）- Cmd+F11
- **目录自动滚动**（v1.4.4+）- 自动定位当前章节
- **性能优化**（v1.4.5+）- 全屏轮询优化
- **导出 HTML 所见即所得**（v1.4.7+）- 与预览 100% 一致
- **ECharts 图表支持**（v1.5.0+）- echarts/js/json 代码块智能检测渲染
- **导出 KaTeX CSS + CDN 降级**（v1.5.0+）- 国内 CDN 优先
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

---

## 📁 项目结构

```
md-viewer/
├── src/
│   ├── main/              # 主进程（Electron）
│   │   ├── index.ts       # 主进程入口 + IPC handlers
│   │   ├── appDataManager.ts  # 数据持久化（书签、固定标签等）
│   │   ├── contextMenuHandler.ts  # 文件树右键菜单
│   │   └── shortcuts.ts   # 快捷键注册
│   ├── preload/           # 预加载脚本（IPC 桥接）
│   │   └── index.ts       # API 定义
│   └── renderer/          # 渲染进程（React）
│       └── src/
│           ├── App.tsx    # **核心组件**（统一状态管理）
│           ├── stores/    # Zustand 状态管理（v1.4.2+）
│           │   ├── windowStore.ts  # 窗口状态（置顶）
│           │   ├── uiStore.ts      # UI 状态（字体大小）
│           │   └── index.ts        # 统一导出
│           ├── components/
│           │   ├── VirtualizedMarkdown.tsx  # Markdown 渲染
│           │   ├── NavigationBar.tsx  # 导航栏（含置顶按钮）
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
git commit -m "feat(v1.4.2): 窗口置顶 + 字体调节 + 打印功能"
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
# ✅ 474 通过
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

### **外部文档**（在项目上级目录）
| 文件 | 说明 |
|------|------|
| `../PROGRESS.md` | **进度追踪**（最新状态 + 发布检查清单）|
| `../CONTEXT-RECOVERY.md` | **上下文恢复指南**（Token 耗尽时使用）|

---

## 🔑 关键架构决策

### **v1.4.2 状态管理（Zustand）**

```typescript
// stores/windowStore.ts - 窗口置顶状态
const { isAlwaysOnTop, toggleAlwaysOnTop } = useWindowStore()

// stores/uiStore.ts - 字体大小
const { fontSize, increaseFontSize, decreaseFontSize, resetFontSize } = useUIStore()

// App.tsx 统一初始化
useEffect(() => {
  initWindowStore()
  applyCSSVariable()
}, [])
```

### **v1.3.6 混合方案架构**

```
Header（全局导航）
├── NavigationBar（Logo + 路径 + 搜索 + 置顶按钮 + 设置 + 主题）
├── TabBar（当前打开的文件标签，无标签时隐藏）
└── BookmarkBar（收藏的文件书签，默认折叠，点击展开）

MainLayout（三列布局）
├── Sidebar（左侧文件树）
├── ContentArea（中间 Markdown 预览）
└── BookmarkPanel（右侧书签面板，支持拖拽排序）
```

### **右键菜单系统（v1.4.2）**

所有菜单项统一使用 emoji 图标：
- **预览区右键**：书签、搜索、导出、打印、字体、复制、快捷键帮助
- **文件树右键**：Finder、书签、复制路径、复制/剪切/粘贴、导出、重命名、删除

---

## 🚀 常用命令

```bash
# 开发
npm run dev              # 启动开发模式（热重载）

# 测试
npm test -- --run        # 运行所有测试
npm run typecheck        # 类型检查

# 构建
npm run build            # 构建应用
npm run build:mac        # 打包 macOS 版本

# 发布检查 ✅
npm run release:check    # 验证发布条件

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
| v1.3.7 | 2026-01-09 下午 | 书签增强（右键添加）|
| v1.4.0 | 2026-01-10 | 页面内搜索 + 右键菜单增强 |
| v1.4.1 | 2026-01-10 | Intel Mac 支持 |
| v1.4.2 | 2026-01-10 | 窗口置顶 + 字体调节 + 打印 + 架构升级 |
| v1.4.3 | 2026-01-10 | 全屏查看 + macOS 原生全屏 + Bug 修复 |
| v1.4.4 | 2026-01-11 | 目录自动滚动 + XSS 防护 |
| v1.4.5 | 2026-01-12 | 性能优化：全屏轮询修复 |
| v1.4.6 | 2026-01-14 | Markdown 渲染修复 + 安全增强 |
| **v1.4.7** | **2026-01-30** | **导出 HTML 所见即所得 + 文件监听修复** |
| **v1.5.0** | **开发中** | **ECharts 图表支持 + KaTeX CDN 降级 + UI 增强** |

---

## 🎯 快捷键一览

| 快捷键 | 功能 | 版本 |
|--------|------|------|
| `Cmd+Shift+F` | 页面内搜索 | v1.4.0 |
| `Cmd+G` | 下一个匹配 | v1.4.0 |
| `Cmd+Shift+G` | 上一个匹配 | v1.4.0 |
| `Cmd+Option+T` | 窗口置顶切换 | v1.4.2 |
| `Cmd++` | 放大字体 | v1.4.2 |
| `Cmd+-` | 缩小字体 | v1.4.2 |
| `Cmd+0` | 重置字体 | v1.4.2 |
| `Cmd+P` | 打印 | v1.4.2 |
| `Cmd+F11` | 全屏查看 | v1.4.3 |
| `ESC` | 退出全屏 | v1.4.3 |

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
1. 先读取项目上级目录的 `PROGRESS.md` 了解最新状态
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

**最后更新**：2026-02-07
