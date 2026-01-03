# MD Viewer 上下文恢复指南

> **用途**: Token 耗尽时快速恢复项目上下文
> **最后更新**: 2026-01-03 20:55 ✅ **v1.2 阶段 0-2 完成**

---

## 🚀 **快速恢复指令**（复制即用）

```bash
# 我是 MD Viewer 项目开发者，对话因token限制中断。
# 当前状态：
# - 版本：v1.1.1（已发布）✅
# - 开发分支：feature/v1.2-security-hardening
# - v1.2 阶段 0：安全加固 ✅ **完成**
# - v1.2 阶段 1：右键菜单 ✅ **完成 100%**
# - v1.2 阶段 2：应用内剪贴板 ✅ **完成 100%**
# - 测试：184个（184通过，0失败）✅
# - 安全状态：路径校验 + 沙箱 ✅
# 立即执行：
cd /Users/mac/Documents/test/testmd/md-viewer
git checkout feature/v1.2-security-hardening
git log --oneline -10
# 必读文档：
cat ../CONTEXT-RECOVERY.md  # 本文档
cat ../PROGRESS.md          # 最新进度
cat V1.2-IMPLEMENTATION-PLAN.md  # v1.2 实施方案（阶段划分、任务清单）
# 下一步任务：
# 1. 发布 v1.2-beta.1（阶段 0-2 已完成）
# 2. 继续阶段 3-5：测试覆盖率、虚拟滚动、主题 UI
# 常用命令：
npm run dev              # 启动开发模式
npm test                 # 运行渲染进程测试（129 通过）
npx vitest run --config vitest.config.main.ts  # 运行主进程测试（55 通过）
```

---

## 📊 **项目快照** (2026-01-03 20:55)

| 项目 | MD Viewer - Markdown 预览器 |
|------|---------------------------|
| 版本 | v1.1.2 ✅ |
| 路径 | /Users/mac/Documents/test/testmd/md-viewer |
| 技术栈 | Electron 39 + React 19 + TypeScript 5.9 |
| GitHub | https://github.com/wj2929/md-viewer |
| 开发分支 | `feature/v1.2-security-hardening` |
| 状态 | ✅ **v1.2 阶段 0-2 完成** |

---

## ✅ **当前状态**

| 指标 | 状态 |
|------|------|
| 版本 | v1.1.2 ✅ |
| 开发分支 | `feature/v1.2-security-hardening` |
| 测试通过 | **184/184 (100%)** ✅ |
| 覆盖率 | 55.16% (组件 83.51%) ✅ |
| **阶段 0** | ✅ **安全加固完成** |
| **阶段 1** | ✅ **右键菜单 100% 完成** |
| **阶段 2** | ✅ **应用内剪贴板 100% 完成** |

---

## 🆕 **最新会话完成的工作** (2026-01-03 20:15-20:50)

### 阶段 2：应用内剪贴板 ✅ **100% 完成**

#### 已完成功能
| 功能 | 状态 | 说明 |
|------|------|------|
| Zustand 状态管理 | ✅ | clipboardStore.ts |
| 复制文件/文件夹 | ✅ | 支持多选 |
| 剪切文件/文件夹 | ✅ | 视觉反馈（半透明 + 删除线）|
| 粘贴到目标目录 | ✅ | 智能冲突处理 |
| IPC 文件操作 | ✅ | copyFile, copyDir, moveFile |
| 主进程测试 | ✅ | contextMenuHandler 28 用例 |

#### 提交记录
```
c647075 docs: 更新项目文档（PROGRESS, CONTEXT-RECOVERY, CHANGELOG）
e2c3a91 test: 修复阶段 2 后的测试失败（剪贴板菜单启用）
b15fc42 test: 修复 App.test.tsx 中的 API mock
78cd4db fix: 修复 clipboardStore 的 path-browserify 导入问题
0ad2a3d feat(clipboard): 阶段 2 - 应用内剪贴板完成
```

### 阶段 1：右键菜单 ✅ **100% 完成**

#### 已完成功能
| 功能 | 状态 | 说明 |
|------|------|------|
| 在 Finder 中显示 | ✅ | 跨平台菜单文案 |
| 复制路径 | ✅ | 支持快捷键 Cmd+Alt+C |
| 复制相对路径 | ✅ | 支持快捷键 Shift+Alt+C |
| 导出 HTML | ✅ | 右键未打开的文件 |
| 导出 PDF | ✅ | 右键未打开的文件 |
| **重命名** | ✅ | **Inline Editing** |
| 删除 | ✅ | 移到回收站 (Cmd+Backspace) |
| 刷新按钮 | ✅ | 侧边栏手动刷新 |

#### 提交记录
```
a06289d feat(toast): 添加 Toast 通知组件替代 alert
28d308a feat(rename): 实现 inline editing 重命名功能
83784d3 feat(context-menu): 阶段 1 - 右键菜单完成（渲染进程 + 测试）
5c9dd35 feat(context-menu): 阶段 1 - 右键菜单基础架构（主进程部分）
```

---

### 优化项 ✅ **已完成**

#### 1. Inline Editing 重命名
- ✅ 右键菜单点击"重命名"触发
- ✅ 自动聚焦并选中文件名（不包含扩展名）
- ✅ Enter 提交，Escape 取消，失焦提交
- ✅ 主进程安全校验
- ✅ 检查目标文件是否已存在
- ✅ 更新标签页中的文件路径

#### 2. Toast 通知组件
- ✅ 4 种类型：success, error, warning, info
- ✅ 滑入/滑出动画（300ms）
- ✅ 自定义持续时间（默认 3秒）
- ✅ 手动关闭按钮
- ✅ 图标 + 颜色区分
- ✅ 替代所有 alert 调用

---

## 📁 **关键文件位置**

```
项目根目录: /Users/mac/Documents/test/testmd/md-viewer/

核心文档:
├── ../PROGRESS.md          # 主进度追踪
├── ../CONTEXT-RECOVERY.md  # 本文档
├── ../CHANGELOG.md         # 变更日志
└── V1.2-IMPLEMENTATION-PLAN.md  # v1.2 实施方案

v1.2 阶段 0-2 新增文件:
├── src/main/security.ts                        # [新增] 安全模块
├── src/main/contextMenuHandler.ts              # [新增] 右键菜单处理器
├── src/main/__tests__/security.test.ts         # [新增] 安全测试（27 用例）
├── src/main/__tests__/contextMenuHandler.test.ts # [新增] 菜单测试（28 用例）
├── vitest.config.main.ts                       # [新增] 主进程测试配置
├── src/renderer/src/stores/clipboardStore.ts   # [新增] 剪贴板状态管理
├── src/components/Toast.tsx                    # [新增] Toast 组件
├── src/components/Toast.css                    # [新增] Toast 样式
├── src/hooks/useToast.ts                       # [新增] Toast Hook
├── src/main/index.ts                           # [修改] 添加文件操作 IPC
├── src/preload/index.ts                        # [修改] 添加新 API
├── src/preload/index.d.ts                      # [修改] 类型定义
├── src/components/FileTree.tsx                 # [修改] 右键菜单 + 重命名 + 剪切状态
├── src/App.tsx                                 # [修改] Toast + 剪贴板事件
└── src/assets/main.css                         # [修改] 刷新按钮 + 剪切样式
```

---

## 🚀 **v1.2 开发进度**

```
阶段 0：安全加固 ✅ 100% 完成
    ├── ✅ 创建 security.ts
    ├── ✅ 路径白名单校验
    ├── ✅ 受保护路径黑名单
    ├── ✅ 启用沙箱模式
    └── ✅ 安全测试 (27/27)
    ↓
阶段 1：右键菜单 ✅ 100% 完成
    ├── ✅ contextMenuHandler.ts (主进程)
    ├── ✅ Preload API 扩展
    ├── ✅ FileTree 右键事件
    ├── ✅ App 事件处理
    ├── ✅ 刷新按钮
    ├── ✅ 测试用例 (28/28)
    ├── ✅ Inline Editing 重命名
    └── ✅ Toast 通知组件
    ↓
阶段 2：应用内剪贴板（Zustand）✅ 100% 完成
    ├── ✅ clipboardStore.ts (Zustand)
    ├── ✅ 复制/剪切/粘贴功能
    ├── ✅ 剪切状态视觉反馈
    ├── ✅ IPC 文件操作（copyFile, copyDir, moveFile）
    ├── ✅ 智能冲突处理
    └── ✅ 剪贴板事件监听
    ↓
阶段 3：测试覆盖率 80% ⏳ 下一步
    ↓
阶段 4：虚拟滚动（react-virtuoso）- 未开始
    ↓
阶段 5：主题切换 UI - 未开始
    ↓
v1.2 发布
```

---

## 💾 **Git 状态**

```bash
# 当前分支
git branch
# * feature/v1.2-security-hardening
#   main

# 最新提交:
c647075 docs: 更新项目文档（PROGRESS, CONTEXT-RECOVERY, CHANGELOG）
e2c3a91 test: 修复阶段 2 后的测试失败（剪贴板菜单启用）
b15fc42 test: 修复 App.test.tsx 中的 API mock
78cd4db fix: 修复 clipboardStore 的 path-browserify 导入问题
0ad2a3d feat(clipboard): 阶段 2 - 应用内剪贴板完成
a06289d feat(toast): 添加 Toast 通知组件替代 alert
28d308a feat(rename): 实现 inline editing 重命名功能
83784d3 feat(context-menu): 阶段 1 - 右键菜单完成（渲染进程 + 测试）
5c9dd35 feat(context-menu): 阶段 1 - 右键菜单基础架构（主进程部分）
542ab06 fix(security): 恢复文件夹时设置安全白名单
3503aa6 feat(security): 阶段 0 - 安全加固完成

# 备份标签
v1.1.1-stable  # 安全加固前的稳定版本
```

---

## 🛠️ **下一步行动**

### 立即可选方案
1. **发布 v1.2-beta.1** - 阶段 0-2 已完成，可发布测试版
2. **继续阶段 3-5** - 测试覆盖率、虚拟滚动、主题 UI
3. **合并到 main** - 完成阶段性成果合并

### 剩余优化项（可选）
- ⏳ 全局快捷键支持（Cmd+R 刷新等）
- ⏳ 文件树刷新防抖（300ms）
- ⏳ 剪贴板快捷键优化

---

## 🔍 **常用命令**

```bash
# 开发模式
npm run dev

# 运行测试
npm test                 # 渲染进程测试（129 通过）
npx vitest run --config vitest.config.main.ts  # 主进程测试（55 通过）
npm run test:coverage    # 覆盖率报告

# 编译打包
npm run build
npm run build:mac

# Git
git status
git log --oneline -10
git checkout feature/v1.2-security-hardening
```

---

## 📋 **版本历史**

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v1.0.0 | 2026-01-02 | 首次发布：文件树、多标签、Markdown渲染 |
| v1.1.0 | 2026-01-03 | Mermaid图表、文件监听（有Bug）|
| v1.1.1 | 2026-01-03 | 修复卡死Bug、性能优化 |
| v1.1.2 | 2026-01-03 | KaTeX/Mermaid修复、开源准备 |
| **v1.2** | **开发中** | **安全加固✅、右键菜单✅、优化✅** |

---

## 🎯 **v1.2 核心目标**

| 目标 | 描述 | 状态 |
|------|------|------|
| 安全加固 | 路径校验 + 沙箱 | ✅ 完成 |
| 右键上下文菜单 | Electron 原生 Menu | ✅ 完成 |
| **Inline Editing** | **重命名功能** | ✅ **完成** |
| **Toast 组件** | **替代 alert** | ✅ **完成** |
| **应用内剪贴板** | **Zustand 状态管理** | ✅ **完成** |
| 虚拟滚动 | react-virtuoso | 未开始 |
| 测试覆盖率 | 55% → 80% | 未开始 |
| 主题切换 UI | 三档切换 | 未开始 |

---

## 📊 **测试状态**

```bash
渲染进程测试：129/129 通过 ✅
主进程测试：  55/55  通过 ✅
─────────────────────────────────
总计：      184/184 通过 ✅
覆盖率：     55.16% (组件 83.51%)
```

---

## ⚠️ **重要提醒**

1. **阶段 0-2 已完成**
   - 安全加固 ✅
   - 右键菜单完整功能 ✅
   - Inline Editing 重命名 ✅
   - Toast 通知组件 ✅
   - 应用内剪贴板 ✅
   - 所有测试通过（184/184）✅

2. **下一步选择**
   - 发布 v1.2-beta.1
   - 继续阶段 3-5
   - 或合并到 main

3. **备份标签可用**
   - `v1.1.1-stable` - 安全加固前的稳定版本
   - 如有问题可回滚

---

**最后更新**: 2026-01-03 20:55
**维护者**: wj2929
**状态**: ✅ **v1.2 阶段 0-2 完成（184 测试通过）**
