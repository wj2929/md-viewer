# MD Viewer 上下文恢复指南

> **用途**: Token 耗尽时快速恢复项目上下文
> **最后更新**: 2026-01-04 10:00 📋 **v1.3 规划完成，待开发**

---

## 🚀 **快速恢复指令**（复制即用）

```bash
# 我是 MD Viewer 项目开发者，对话因token限制中断。
# 当前状态：
# - 版本：v1.2.0（已发布）✅ + v1.2.1（优化完成）✅
# - 下一版本：v1.3.0（规划完成，待开发）📋
# - 当前分支：main
# - 测试：312个（312通过，0失败）✅
# - 安全状态：路径校验 + 沙箱 ✅
# - v1.3 专家审批：4位专家通过（评分 7.0/10）
# 立即执行：
cd /Users/mac/Documents/test/testmd/md-viewer
git log --oneline -10
# 必读文档（按优先级）：
cat ../CONTEXT-RECOVERY.md  # 本文档
cat ../PROGRESS.md          # 最新进度
cat ../V1.3-IMPLEMENTATION-PLAN-REVISED.md  # v1.3 修订版方案
cat ../V1.3-REVIEW-REPORT.md  # v1.3 审批报告
# 常用命令：
npm run dev              # 启动开发模式
npm test                 # 运行渲染进程测试（257 通过）
npx vitest run --config vitest.config.main.ts  # 运行主进程测试（55 通过）
npm run build:mac        # 构建 macOS 应用
```

---

## 📊 **项目快照** (2026-01-04 10:00)

| 项目 | MD Viewer - Markdown 预览器 |
|------|---------------------------|
| 当前版本 | v1.2.0 ✅ **已发布** |
| 优化版本 | v1.2.1 ✅ **完成** |
| **下一版本** | **v1.3.0 📋 规划完成，待开发** |
| 路径 | /Users/mac/Documents/test/testmd/md-viewer |
| 技术栈 | Electron 39 + React 19 + TypeScript 5.9 |
| GitHub | https://github.com/wj2929/md-viewer |
| 当前分支 | `main` |
| 状态 | 📋 **v1.3 规划完成，4 位专家审批通过** |

---

## 📋 **v1.3 规划概览**

### **专家审批结果**
| 专家 | 结果 | 评分 |
|------|------|------|
| 架构师 | 有条件通过 | 7.5/10 |
| 前端专家 | 有条件通过 | 7.5/10 |
| 安全审计师 | 有条件通过 | 6.5/10 |
| 测试专家 | 有条件通过 | 6.5/10 |
| **综合** | **通过** | **7.0/10** |

### **v1.3 阶段划分**
| 阶段 | 功能 | 状态 |
|------|------|------|
| 阶段 0 | 安全加固 + 文件监听修复 | ⏳ 待开发 |
| 阶段 1 | Tab 右键菜单（关闭当前/其他/所有）| ⏳ 待开发 |
| 阶段 2 | Markdown 右键菜单（导出/复制/查找）| ⏳ 待开发 |
| 阶段 3 | 重构剪贴板架构（单一数据源）| ⏳ 待开发 |
| 阶段 4 | 优化虚拟滚动（仅 CSS 调整）| ⏳ 待开发 |
| 阶段 5 | 多文件选择（Cmd+点击、Shift+点击）| ⏳ 待开发 |
| 阶段 6 | 跨应用剪贴板（主进程安全过滤）| ⏳ 待开发 |
| 阶段 7 | 测试覆盖率 70%+ | ⏳ 待开发 |

### **v1.3 关键修订**
1. **安全加固**：扩展 PROTECTED_PATTERNS 到 30+ 条
2. **文件监听**：补充 add/addDir/unlinkDir/rename 事件
3. **剪贴板架构**：单一数据源 + 主进程安全过滤
4. **多选状态**：提升到 App.tsx 层管理
5. **虚拟滚动**：仅 CSS 调整，保留标题分段

---

## ✅ **v1.2.1 完成内容**

| 功能 | 状态 |
|------|------|
| 全局快捷键（10+） | ✅ |
| E2E 测试完善 | ✅ |
| App.tsx 集成测试（28 用例）| ✅ |

### 全局快捷键
| 快捷键 | 功能 |
|--------|------|
| `⌘/Ctrl + O` | 打开文件夹 |
| `⌘/Ctrl + R` | 刷新文件树 |
| `⌘/Ctrl + W` | 关闭当前标签 |
| `⌘/Ctrl + E` | 导出 HTML |
| `⌘/Ctrl + Shift + E` | 导出 PDF |
| `⌘/Ctrl + F` | 聚焦搜索栏 |
| `⌘/Ctrl + Tab` | 下一个标签 |
| `⌘/Ctrl + Shift + Tab` | 上一个标签 |
| `⌘/Ctrl + 1-5` | 切换到指定标签 |

---

## ✅ **v1.2.0 完成状态**

| 阶段 | 内容 | 状态 |
|------|------|------|
| 阶段 0 | 安全加固（路径校验 + 沙箱）| ✅ |
| 阶段 1 | 右键菜单（Electron Menu）| ✅ |
| 阶段 2 | 应用内剪贴板（Zustand）| ✅ |
| 阶段 3 | 测试覆盖率提升 | ✅ |
| 阶段 4 | 虚拟滚动（react-virtuoso）| ✅ |
| 阶段 5 | 主题切换 UI（三档）| ✅ |

---

## 📁 **关键文件位置**

```
项目根目录: /Users/mac/Documents/test/testmd/md-viewer/

核心文档（testmd 目录）:
├── PROGRESS.md                        # 主进度追踪
├── CONTEXT-RECOVERY.md                # 本文档
├── V1.3-IMPLEMENTATION-PLAN.md        # v1.3 原方案
├── V1.3-IMPLEMENTATION-PLAN-REVISED.md # v1.3 修订版方案 ⭐
└── V1.3-REVIEW-REPORT.md              # v1.3 审批报告

项目内文档（md-viewer 目录）:
├── CHANGELOG.md                       # 变更日志
├── PROGRESS.md                        # 项目进度（同步）
└── CONTEXT-RECOVERY.md                # 恢复指南（同步）

v1.3 需要修改的核心文件:
├── src/main/security.ts               # 扩展 PROTECTED_PATTERNS
├── src/main/index.ts                  # 文件监听 + IPC
├── src/main/tabMenuHandler.ts         # 新增：Tab 右键菜单
├── src/main/markdownMenuHandler.ts    # 新增：Markdown 右键菜单
├── src/main/clipboardManager.ts       # 新增：跨平台剪贴板
├── src/renderer/src/App.tsx           # 多选状态 + 事件监听
├── src/renderer/src/components/FileTree.tsx  # 多选交互
├── src/renderer/src/components/TabBar.tsx    # 右键菜单
├── src/renderer/src/stores/clipboardStore.ts # 重构
└── src/preload/index.ts               # 新增 API
```

---

## 💾 **Git 状态**

```bash
# 当前分支
git branch
# * main

# 最新提交:
fe494d2 docs: 更新项目文档 (v1.2.0 发布 + v1.2.1 优化)
326b826 feat(v1.2.1): 全局快捷键 + E2E测试 + 集成测试扩展
f7a3c0b chore: bump version to 1.2.0

# 标签
v1.2.0   # 最新发布版本
v1.1.2   # 上一个稳定版本
```

---

## 🛠️ **下一步行动**

### **v1.3 开发（待开始）**
1. 创建开发分支：`git checkout -b feature/v1.3`
2. 按阶段顺序开发（阶段 0 → 阶段 7）
3. 每阶段完成后提交并运行测试
4. 全部完成后合并到 main

### **v1.3 开发顺序**
```
阶段 0（安全+监听）→ 阶段 1（Tab菜单）→ 阶段 2（Markdown菜单）
→ 阶段 3（剪贴板重构）→ 阶段 4（虚拟滚动）→ 阶段 5（多选）
→ 阶段 6（跨应用剪贴板）→ 阶段 7（测试）
```

---

## 🔍 **常用命令**

```bash
# 开发模式
npm run dev

# 运行测试
npm test                 # 渲染进程测试（257 通过）
npx vitest run --config vitest.config.main.ts  # 主进程测试（55 通过）
npm run test:coverage    # 覆盖率报告

# 编译打包
npm run build
npm run build:mac

# Git
git status
git log --oneline -10
git checkout -b feature/v1.3  # 创建 v1.3 开发分支
```

---

## 📊 **测试状态**

```bash
渲染进程测试：257/257 通过 ✅
主进程测试：  55/55  通过 ✅
─────────────────────────────────
总计：       312/312 通过 ✅
覆盖率：     58.46%（v1.3 目标：70%+）
```

---

## 📋 **版本历史**

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v1.0.0 | 2026-01-02 | 首次发布 |
| v1.1.0 | 2026-01-03 | Mermaid + 文件监听 |
| v1.1.1 | 2026-01-03 | Bug 修复 |
| v1.1.2 | 2026-01-03 | KaTeX/Mermaid 修复 |
| v1.2.0 | 2026-01-03 | 安全+右键+剪贴板+虚拟滚动+主题 |
| v1.2.1 | 2026-01-03 | 快捷键+E2E+测试扩展 |
| **v1.3.0** | **规划中** | **Tab菜单+Markdown菜单+多选+跨应用剪贴板** |

---

## 🎯 **v1.3 功能预览**

| 功能 | 描述 | 阶段 |
|------|------|------|
| 安全加固 | PROTECTED_PATTERNS 30+ 条 | 阶段 0 |
| 文件监听 | add/rename 事件支持 | 阶段 0 |
| Tab 右键菜单 | 关闭当前/其他/所有/左侧/右侧 | 阶段 1 |
| Markdown 右键菜单 | 导出/复制/查找/打印 | 阶段 2 |
| 剪贴板重构 | 单一数据源 + 事务性 | 阶段 3 |
| 虚拟滚动优化 | CSS 调整消除间隔 | 阶段 4 |
| 多文件选择 | Cmd+点击、Shift+点击 | 阶段 5 |
| 跨应用剪贴板 | Finder ↔ MD Viewer | 阶段 6 |
| 测试覆盖率 | 70% → 80% | 阶段 7 |

---

## 📦 **构建产物**

```
dist/MD Viewer-1.2.0-arm64.dmg      138 MB
dist/MD Viewer-1.2.0-arm64-mac.zip  133 MB
```

---

**最后更新**: 2026-01-04 10:00
**维护者**: wj2929
**状态**: 📋 **v1.3 规划完成，4 位专家审批通过（评分 7.0/10）**
