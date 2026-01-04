# MD Viewer 上下文恢复指南

> **用途**: Token 耗尽时快速恢复项目上下文
> **最后更新**: 2026-01-04 11:00 🚀 **v1.3 阶段 0-3 完成**

---

## 🚀 **快速恢复指令**（复制即用）

```bash
# 我是 MD Viewer 项目开发者，对话因token限制中断。
# 当前状态：
# - 版本：v1.2.0（已发布）✅ + v1.2.1（优化完成）✅
# - 开发版本：v1.3.0 🚀 阶段 0-3 完成
# - 当前分支：feature/v1.3
# - 测试：355个（355通过，0失败）✅
# - 安全状态：路径校验 + 沙箱 + 45 条保护规则 ✅
# 立即执行：
cd /Users/mac/Documents/test/testmd/md-viewer
git log --oneline -10
# 必读文档（按优先级）：
cat CONTEXT-RECOVERY.md     # 本文档
cat PROGRESS.md             # 最新进度
cat ../V1.3-IMPLEMENTATION-PLAN-REVISED.md  # v1.3 修订版方案
# 常用命令：
npm run dev              # 启动开发模式
npm test                 # 运行渲染进程测试（257 通过）
npx vitest run --config vitest.config.main.ts  # 运行主进程测试（98 通过）
npm run build:mac        # 构建 macOS 应用
```

---

## 📊 **项目快照** (2026-01-04 11:00)

| 项目 | MD Viewer - Markdown 预览器 |
|------|---------------------------|
| 当前版本 | v1.2.0 ✅ **已发布** |
| 优化版本 | v1.2.1 ✅ **完成** |
| **开发版本** | **v1.3.0 🚀 阶段 0-3 完成** |
| 路径 | /Users/mac/Documents/test/testmd/md-viewer |
| 技术栈 | Electron 39 + React 19 + TypeScript 5.9 |
| GitHub | https://github.com/wj2929/md-viewer |
| 当前分支 | `feature/v1.3` |
| 状态 | 🚀 **v1.3 开发中，阶段 0-3 完成** |

---

## 🚀 **v1.3 开发进度（2026-01-04）**

### **阶段进度**

| 阶段 | 功能 | 状态 | 新增测试 | 提交 |
|------|------|------|----------|------|
| 阶段 0 | 安全加固 + 文件监听修复 | ✅ 完成 | +16 | `36450a9` |
| 阶段 1 | Tab 右键菜单 | ✅ 完成 | +15 | `ecd49d5` |
| 阶段 2 | Markdown 右键菜单 | ✅ 完成 | +12 | `9e79a07` |
| 阶段 3 | 重构剪贴板架构 | ✅ 完成 | - | `2e767f2` |
| 阶段 4 | 优化虚拟滚动 | ⏳ 待开发 | - | - |
| 阶段 5 | 多文件选择 | ⏳ 待开发 | - | - |
| 阶段 6 | 跨应用剪贴板 | ⏳ 待开发 | - | - |
| 阶段 7 | 测试覆盖率 70%+ | ⏳ 待开发 | - | - |

### **已完成功能详情**

#### 阶段 0：安全加固 + 文件监听增强 ✅
- ✅ PROTECTED_PATTERNS 扩展到 45+ 条规则
- ✅ 新增保护：Docker/Azure/GCloud/GitHub CLI 配置
- ✅ 新增保护：.env/.npmrc/.pypirc/.git-credentials
- ✅ 新增保护：SSH/证书私钥 (pem/p12/pfx/key/jks)
- ✅ 文件监听：新增 add/addDir/unlinkDir/rename 事件
- ✅ 500ms 时间窗口重命名检测机制

#### 阶段 1：Tab 右键菜单 ✅
- ✅ 菜单项：关闭、关闭其他、关闭所有
- ✅ 菜单项：关闭左侧、关闭右侧
- ✅ 菜单项：在 Finder 中显示、复制路径
- ✅ 菜单项根据 Tab 位置动态启用/禁用

#### 阶段 2：Markdown 右键菜单 ✅
- ✅ 菜单项：导出 HTML (Cmd+E)、导出 PDF (Cmd+Shift+E)
- ✅ 菜单项：复制为 Markdown、纯文本、HTML
- ✅ 有选中内容时显示"复制选中内容"
- ✅ 移除预览区顶部导出按钮

#### 阶段 3：重构剪贴板架构 ✅
- ✅ 渲染进程 clipboardStore 作为唯一数据源
- ✅ 主进程仅作为状态镜像
- ✅ 事务性粘贴：部分失败不丢失数据
- ✅ 右键菜单动态控制粘贴菜单启用状态

---

## 📁 **关键文件位置**

```
项目根目录: /Users/mac/Documents/test/testmd/md-viewer/

核心文档（testmd 目录）:
├── PROGRESS.md                        # 主进度追踪
├── CONTEXT-RECOVERY.md                # 上下文恢复
├── V1.3-IMPLEMENTATION-PLAN.md        # v1.3 原方案
├── V1.3-IMPLEMENTATION-PLAN-REVISED.md # v1.3 修订版方案 ⭐
└── V1.3-REVIEW-REPORT.md              # v1.3 审批报告

项目内文档（md-viewer 目录）:
├── CHANGELOG.md                       # 变更日志
├── PROGRESS.md                        # 项目进度（本文档同步）
└── CONTEXT-RECOVERY.md                # 恢复指南（本文档）

v1.3 已修改的核心文件:
├── src/main/security.ts               # ✅ 扩展 PROTECTED_PATTERNS 到 45+
├── src/main/index.ts                  # ✅ 文件监听 + IPC + 剪贴板同步
├── src/main/tabMenuHandler.ts         # ✅ 新增：Tab 右键菜单
├── src/main/markdownMenuHandler.ts    # ✅ 新增：Markdown 右键菜单
├── src/main/clipboardState.ts         # ✅ 新增：剪贴板状态缓存
├── src/main/contextMenuHandler.ts     # ✅ 更新：动态粘贴菜单
├── src/renderer/src/App.tsx           # ✅ 事件监听 + 移除导出按钮
├── src/renderer/src/components/TabBar.tsx    # ✅ 右键菜单支持
├── src/renderer/src/components/VirtualizedMarkdown.tsx # ✅ 右键菜单支持
├── src/renderer/src/stores/clipboardStore.ts # ✅ 重构：事务性粘贴
└── src/preload/index.ts               # ✅ 新增 API
```

---

## 💾 **Git 状态**

```bash
# 当前分支
git branch
# * feature/v1.3

# v1.3 分支提交:
2e767f2 feat(v1.3): 阶段 3 - 重构剪贴板架构（单一数据源）
9e79a07 feat(v1.3): 阶段 2 - Markdown 内容区右键菜单
ecd49d5 feat(v1.3): 阶段 1 - Tab 右键菜单
36450a9 feat(v1.3): 阶段 0 - 安全加固 + 文件监听增强

# 标签
v1.2.0   # 最新发布版本
v1.1.2   # 上一个稳定版本
```

---

## 🛠️ **下一步行动**

### **v1.3 继续开发**
1. 阶段 4：优化虚拟滚动（CSS 调整）
2. 阶段 5：多文件选择（Cmd+点击、Shift+点击）
3. 阶段 6：跨应用剪贴板（Finder ↔ MD Viewer）
4. 阶段 7：测试覆盖率 70%+

### **v1.3 开发顺序**
```
阶段 0（安全+监听）✅ → 阶段 1（Tab菜单）✅ → 阶段 2（Markdown菜单）✅
→ 阶段 3（剪贴板重构）✅ → 阶段 4（虚拟滚动）⏳ → 阶段 5（多选）⏳
→ 阶段 6（跨应用剪贴板）⏳ → 阶段 7（测试）⏳
```

---

## 🔍 **常用命令**

```bash
# 开发模式
npm run dev

# 运行测试
npm test                 # 渲染进程测试（257 通过）
npx vitest run --config vitest.config.main.ts  # 运行主进程测试（98 通过）
npm run test:coverage    # 覆盖率报告

# 编译打包
npm run build
npm run build:mac

# Git
git status
git log --oneline -10
```

---

## 📊 **测试状态**

```bash
渲染进程测试：257/257 通过 ✅
主进程测试：  98/98  通过 ✅
─────────────────────────────────
总计：       355/355 通过 ✅
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
| **v1.3.0** | **开发中** | **Tab菜单+Markdown菜单+剪贴板重构+多选+跨应用剪贴板** |

---

**最后更新**: 2026-01-04 11:00
**维护者**: wj2929
**状态**: 🚀 **v1.3 开发中（阶段 0-3 完成，355 测试通过）**
