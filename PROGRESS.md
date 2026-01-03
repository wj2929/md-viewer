# MD Viewer 进度追踪

> Markdown 预览器项目进度状态
> **最后更新：2026-01-03 20:46** ✅ **v1.2 阶段 0-2 完成**

---

## 📋 **当前状态：v1.2 开发中（阶段 2 已完成）**

| 指标 | 状态 |
|------|------|
| **当前版本** | v1.1.2 ✅ **已发布** |
| **当前阶段** | v1.2 阶段 2：应用内剪贴板（100% 完成）✅ |
| **测试数量** | 184 个单元测试 (184 通过, 0 失败) ✅ |
| **测试覆盖率** | ~60%（新增功能覆盖率高）✅ |
| **安全状态** | ✅ 阶段 0 完成（路径校验 + 沙箱）|
| **开发分支** | `feature/v1.2-security-hardening` |
| **下一步** | 发布 v1.2-beta 或 继续阶段 3-5 |

---

## 📦 v1.1.2 打包文件

```
dist/MD Viewer-1.1.2-arm64.dmg      (138 MB)
dist/MD Viewer-1.1.2-arm64-mac.zip  (133 MB)
```

---

## ✅ **本次会话完成的工作（2026-01-03 18:00-20:46）**

### 1. v1.2 阶段 0：安全加固 ✅ **完成**
- ✅ 创建 `src/main/security.ts` 安全模块
- ✅ 实现路径白名单校验
- ✅ 实现受保护路径黑名单
- ✅ 为所有 IPC handlers 添加安全校验
- ✅ 启用沙箱模式 `sandbox: true`
- ✅ 创建 27 个安全测试用例（全部通过）
- ✅ 修复路径穿越漏洞 🔴 高危
- ✅ 修复沙箱禁用问题 🔴 高危

**测试结果**：
- 主进程测试：27/27 通过 ✅
- 渲染进程测试：129/129 通过 ✅
- **总计：156/156 通过** ✅

### 2. v1.2 阶段 1：右键菜单 ✅ **完成 100%**

#### 主进程 + Preload
- ✅ 创建 `src/main/contextMenuHandler.ts`
- ✅ 实现 Electron 原生 Menu
- ✅ 跨平台菜单文案（macOS/Windows/Linux）
- ✅ 集成安全校验
- ✅ 扩展 Preload API
- ✅ 添加 `fs:rename` IPC handler
- ✅ **补全 contextMenuHandler 测试套件（28 个测试）**

#### 渲染进程
- ✅ FileTree 右键事件绑定
- ✅ App 事件处理（删除/重命名/导出/错误）
- ✅ 侧边栏刷新按钮
- ✅ 测试用例（更新 mock，184/184 通过）

**菜单功能**：
| 功能 | 状态 | 说明 |
|------|------|------|
| 在 Finder 中显示 | ✅ | 跨平台适配 |
| 复制路径 | ✅ | Cmd+Alt+C |
| 复制相对路径 | ✅ | Shift+Alt+C |
| 导出 HTML | ✅ | 右键未打开的文件 |
| 导出 PDF | ✅ | 右键未打开的文件 |
| **重命名** | ✅ | **Inline Editing** |
| 删除 | ✅ | Cmd+Backspace |
| 刷新按钮 | ✅ | 侧边栏手动刷新 |
| **复制** | ✅ | **Cmd+Ctrl+C** |
| **剪切** | ✅ | **Cmd+Ctrl+X** |
| **粘贴** | ✅ | **Cmd+Ctrl+V（仅文件夹）** |

### 3. 优化改进 ✅ **完成**

#### Inline Editing 重命名
- ✅ 右键菜单触发 inline editing
- ✅ 自动聚焦并选中文件名（不含扩展名）
- ✅ Enter 提交，Escape 取消，失焦提交
- ✅ 主进程安全校验（validateSecurePath）
- ✅ 检查目标文件是否已存在
- ✅ 更新标签页文件路径
- ✅ 自动刷新文件树

**代码文件**：
- `src/components/FileTree.tsx` - 添加 inline editing 状态
- `src/main/index.ts` - 添加 `fs:rename` IPC
- `src/preload/index.ts` - 添加 `renameFile` API
- `src/assets/main.css` - 添加输入框样式

#### Toast 通知组件
- ✅ 创建 Toast 组件（4 种类型）
  - success, error, warning, info
- ✅ 滑入/滑出动画（300ms）
- ✅ 自定义持续时间（默认 3 秒）
- ✅ 手动关闭按钮
- ✅ 图标 + 颜色区分
- ✅ 替代所有 alert 调用

**代码文件**：
- `src/components/Toast.tsx` - Toast 组件
- `src/components/Toast.css` - Toast 样式
- `src/hooks/useToast.ts` - useToast Hook
- `src/App.tsx` - 使用 Toast 替代 alert

### 4. v1.2 阶段 2：应用内剪贴板 ✅ **完成 100%**

#### Zustand 状态管理
- ✅ 安装 zustand 依赖
- ✅ 创建 `src/renderer/src/stores/clipboardStore.ts`
  - copy/cut/paste 方法
  - 剪切状态管理（isCut + files Set）
  - 智能清空逻辑（剪切后清空，复制保留）
  - 边界情况处理（文件冲突、子目录粘贴）

#### 主进程文件操作 IPC
- ✅ `fs:copyFile` - 复制文件
- ✅ `fs:copyDir` - 递归复制目录
- ✅ `fs:moveFile` - 移动文件/文件夹
- ✅ `fs:exists` - 检查文件存在
- ✅ `fs:isDirectory` - 检查是否为目录
- ✅ 全部带安全校验（validateSecurePath）

#### Preload API 扩展
- ✅ copyFile, copyDir, moveFile, fileExists, isDirectory
- ✅ 剪贴板事件监听：onClipboardCopy, onClipboardCut, onClipboardPaste

#### UI 集成
- ✅ FileTree 剪切状态可视化
  - 半透明（opacity: 0.5）
  - 删除线（text-decoration: line-through）
  - useClipboardStore 精准订阅
- ✅ App.tsx 监听剪贴板事件
- ✅ Toast 通知：成功/失败提示
- ✅ 自动刷新文件树

#### 右键菜单集成
- ✅ 启用复制/剪切/粘贴菜单项（enabled: true）
- ✅ 发送 IPC 事件到渲染进程
- ✅ 快捷键支持

#### 边界情况处理
- ✅ 目标文件已存在 → 错误提示
- ✅ 粘贴到自身子目录 → 阻止
- ✅ 自我粘贴 → 跳过
- ✅ 路径穿越 → 安全校验拦截
- ✅ 文件/文件夹递归复制

**代码文件**：
- `src/renderer/src/stores/clipboardStore.ts` - Zustand Store (165 行)
- `src/main/index.ts` - 文件操作 IPC handlers
- `src/preload/index.ts` - API 扩展
- `src/preload/index.d.ts` - 类型定义
- `src/renderer/src/components/FileTree.tsx` - 剪切状态集成
- `src/renderer/src/assets/main.css` - 剪切样式
- `src/renderer/src/App.tsx` - 事件监听
- `src/main/contextMenuHandler.ts` - 启用菜单项

**测试更新**：
- ✅ 更新 App.test.tsx mock（添加剪贴板 API）
- ✅ 更新 contextMenuHandler.test.ts（启用状态）
- ✅ 渲染进程：129/129 通过 ✅
- ✅ 主进程：55/55 通过 ✅
- ✅ **总计：184/184 通过** ✅

---

## 📊 **Git 提交记录（本次会话）**

```
cd816e0 feat(clipboard): 阶段 2 完成 - 应用内剪贴板全功能实现
a7a093a feat(clipboard): 阶段 2 - 应用内剪贴板基础架构
d0bd833 test(context-menu): 添加 contextMenuHandler 完整测试套件
7154eba docs: update project documentation for v1.2 stage 1 completion
a06289d feat(toast): 添加 Toast 通知组件替代 alert
28d308a feat(rename): 实现 inline editing 重命名功能
83784d3 feat(context-menu): 阶段 1 - 右键菜单完成（渲染进程 + 测试）
5c9dd35 feat(context-menu): 阶段 1 - 右键菜单基础架构（主进程部分）
542ab06 fix(security): 恢复文件夹时设置安全白名单
3503aa6 feat(security): 阶段 0 - 安全加固完成
```

**代码统计**：
- 10 次提交
- 约 20+ 文件修改
- 约 800+ 行新增代码
- 184 个测试全部通过

---

## 🚀 **v1.2 实施方案概要**

### 核心目标

| 目标 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| 安全加固 | 路径校验 + 沙箱启用 | P0 | ✅ 完成 |
| 右键上下文菜单 | Electron 原生 Menu | P0 | ✅ 完成 |
| **Inline Editing** | **重命名功能** | **P0** | ✅ **完成** |
| **Toast 组件** | **替代 alert** | **P0** | ✅ **完成** |
| **应用内剪贴板** | **Zustand 状态管理** | **P0** | ✅ **完成** |
| 虚拟滚动 | react-virtuoso | P1 | 未开始 |
| 测试覆盖率 | 从 55% 提升到 80% | P1 | 未开始 |
| 主题切换 UI | 手动切换明暗主题 | P2 | 未开始 |

### 开发阶段

```
阶段 0：安全加固 ✅ 100% 完成
    ├── ✅ 路径白名单校验
    ├── ✅ 受保护路径黑名单
    ├── ✅ 启用沙箱模式
    └── ✅ 安全测试 (27/27)
    ↓
阶段 1：右键菜单 ✅ 100% 完成
    ├── ✅ Electron Menu（主进程）
    ├── ✅ Preload API 扩展
    ├── ✅ FileTree 右键事件
    ├── ✅ App 事件处理
    ├── ✅ 刷新按钮
    ├── ✅ Inline Editing 重命名
    ├── ✅ Toast 通知组件
    └── ✅ 测试用例 (55/55)
    ↓
阶段 2：应用内剪贴板 ✅ 100% 完成
    ├── ✅ Zustand Store
    ├── ✅ 文件复制/剪切/粘贴
    ├── ✅ 剪切状态可视化
    ├── ✅ 文件夹递归复制
    ├── ✅ 同名冲突处理
    └── ✅ 测试更新 (184/184)
    ↓
阶段 3：测试覆盖率 80% ⏸️ 待定
    ↓
阶段 4：虚拟滚动（react-virtuoso）⏸️ 待定
    ↓
阶段 5：主题切换 UI ⏸️ 待定
    ↓
v1.2 发布
```

---

## ⚠️ **发现的安全问题（已修复）**

| 问题 | 严重程度 | 状态 |
|------|----------|------|
| 路径穿越漏洞 | 🔴 高危 | ✅ 已修复 |
| 沙箱禁用 | 🔴 高危 | ✅ 已修复 |
| 剪贴板 API 错误 | 🔴 阻塞 | ✅ 已修复（阶段 2）|

---

## 📊 **版本规划**

| 版本 | 核心功能 | 状态 |
|------|----------|------|
| v1.0 | 纯预览器：文件树 + 多标签 + Markdown 渲染 | ✅ 完成 |
| v1.1 | Mermaid 图表 + 文件监听自动刷新 | ✅ 完成 |
| v1.1.1 | Bug修复 + 性能优化 | ✅ 完成 |
| v1.1.2 | KaTeX/Mermaid 修复 + 开源准备 | ✅ 完成 |
| **v1.2** | **安全加固✅ + 右键菜单✅ + 剪贴板✅** | **阶段 0-2 完成** |
| v1.3 | 跨应用剪贴板 + 多文件选择 | 未开始 |
| v2.0 | 插件系统 + 多语言 + 简单编辑 | 未开始 |

---

## 🎯 **里程碑进度**

| 里程碑 | 完成度 | 状态 |
|--------|--------|------|
| M1: 项目初始化 | 100% | ✅ 完成 |
| M2: 文件系统 | 100% | ✅ 完成 |
| M3: Markdown 渲染 | 100% | ✅ 完成 |
| M4: 多标签系统 | 100% | ✅ 完成 |
| M5: 搜索 + 导出 | 100% | ✅ 完成 |
| M6: 状态持久化 + 打包 | 100% | ✅ 完成 |
| M7: 测试 + v1.1 新功能 | 100% | ✅ 完成 |
| M8: Bug修复 + 性能优化 | 100% | ✅ 完成 |
| M9: 开源准备 | 100% | ✅ 完成 |
| M10: v1.2 规划与审批 | 100% | ✅ 完成 |
| **M11: v1.2 阶段 0-2** | **100%** | ✅ **完成** |
| M12: v1.2 阶段 3-5 | 0% | ⏸️ 待定 |

---

## ✨ **已实现功能清单**

### 核心功能
- ✅ 打开文件夹
- ✅ 文件树浏览（递归，只显示 .md）
- ✅ 多标签预览
- ✅ Markdown 渲染
- ✅ 代码高亮（15+ 语言）
- ✅ **数学公式（KaTeX）** - 行内 $...$ 和块级 $$...$$
- ✅ **Mermaid 图表** - 15 种稳定图表类型
- ✅ 文件监听自动刷新
- ✅ 文件名搜索 + 全文搜索
- ✅ 导出 HTML/PDF
- ✅ 状态持久化
- ✅ 明暗主题自适应

### v1.2 新增功能
- ✅ **安全加固** - 路径白名单 + 沙箱模式
- ✅ **右键菜单** - Electron 原生 Menu
- ✅ **Inline Editing** - 重命名功能
- ✅ **Toast 通知** - 替代 alert
- ✅ **手动刷新** - 侧边栏刷新按钮
- ✅ **应用内剪贴板** - 复制/剪切/粘贴文件
- ✅ **剪切状态可视化** - 半透明 + 删除线

---

## 📝 **下一步行动**

### 立即可选方案
1. **发布 v1.2-beta.1**（推荐）
   - 阶段 0-2 功能稳定
   - 184 个测试全部通过
   - 手动测试完整流程
   - 创建 beta 标签并发布

2. **继续阶段 3：测试覆盖率**
   - 从当前 ~60% 提升到 80%
   - 补充集成测试
   - E2E 测试（Playwright）

3. **继续阶段 4：虚拟滚动**
   - react-virtuoso 集成
   - 大文件性能优化
   - 支持 10000+ 行文档

### v1.2 剩余任务
- ⏸️ 阶段 3：测试覆盖率 80%（可选）
- ⏸️ 阶段 4：虚拟滚动（可选）
- ⏸️ 阶段 5：主题切换 UI（可选）

---

## 📚 **文档清单**

### 核心文档
- ✅ PROGRESS.md - 进度追踪（本文档）
- ✅ CONTEXT-RECOVERY.md - 上下文恢复指南
- ✅ CHANGELOG.md - 变更日志
- ✅ README.md - 项目说明

### v1.2 规划文档
- ✅ V1.2-IMPLEMENTATION-PLAN.md - 实施方案
- ✅ V1.2-REVIEW-REPORT.md - 综合审批报告

---

## 📅 **变更历史**

| 日期 | 时间 | 变更内容 |
|------|------|----------|
| 2026-01-02 | 14:00 | 创建项目，搭建脚手架 |
| 2026-01-02 | 23:00 | v1.0.0 发布 |
| 2026-01-03 | 07:00 | v1.1.0 发布（有 Bug）|
| 2026-01-03 | 17:00 | v1.1.1 发布（修复 Bug）|
| 2026-01-03 | 18:30 | 开源准备完成 ✅ |
| 2026-01-03 | 18:00-19:00 | v1.2 实施方案制定与审批 |
| 2026-01-03 | 19:00-19:15 | 阶段 0：安全加固完成 ✅ |
| 2026-01-03 | 19:50-20:15 | 阶段 1：右键菜单完成 ✅ |
| 2026-01-03 | 20:00-20:30 | 优化完成：Inline Editing + Toast ✅ |
| **2026-01-03** | **20:30-20:46** | **阶段 2：应用内剪贴板完成 ✅** |

---

**更新频率**：实时更新
**维护者**：wj2929
**当前状态**：✅ **v1.2 阶段 0-2 完成（184 测试通过）**
