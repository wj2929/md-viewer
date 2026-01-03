# MD Viewer - 上下文恢复文档

> **用途**: Token限制时快速恢复上下文
> **最后更新**: 2026-01-03 17:05
> **当前状态**: ✅ **v1.1.1 已发布，所有功能正常**

---

## 🚀 快速恢复指令

```bash
# 项目路径
cd /Users/mac/Documents/test/testmd/md-viewer

# 当前状态：v1.1.1 已发布 ✅
# - 测试：125个（100%通过）✅
# - 覆盖率：55.16%（组件 83.51%）✅
# - 核心Bug：已修复 ✅
# - 性能优化：已完成 ✅
# - 打包状态：已发布 ✅

# 必读文档
cat CONTEXT-RECOVERY.md  # 本文档
cat PROGRESS.md          # 最新进度

# 启动开发模式
npm run dev

# 运行测试
npm test

# 运行覆盖率测试
npm run test:coverage

# 打包
npm run build:mac
```

---

## 📍 当前状态

### ✅ v1.1.1 已发布

| 指标 | 状态 |
|------|------|
| 版本 | v1.1.1 ✅ |
| 测试 | 125/125 通过 (100%) ✅ |
| 覆盖率 | 55.16%（组件 83.51%）✅ |
| 打包 | DMG 138MB, ZIP 133MB ✅ |
| 应用状态 | 正常运行 ✅ |

### 📦 打包文件

```
dist/MD Viewer-1.1.1-arm64.dmg      (138 MB)
dist/MD Viewer-1.1.1-arm64-mac.zip  (133 MB)
```

---

## ✅ 已修复的问题

### 1. 界面卡死Bug（P0 - 已修复）
**根本原因**: v1.1.0 的文件监听 useEffect 依赖数组包含 `tabs`
```javascript
// 问题代码
useEffect(() => { ... }, [folderPath, tabs, handleTabClose])
// 每次打开文件 → tabs变化 → 重新订阅 → 卡死
```

**修复方案**:
- 使用 `useRef` 存储 tabs 最新值
- 依赖数组只包含 `folderPath`
- 修复 CSP 策略支持 Vite HMR

### 2. 大文件夹加载慢（P1 - 已修复）
**原因**:
1. `readDirRecursive` 遍历所有目录（包括 node_modules）
2. chokidar 监听整个目录树导致 EMFILE

**修复方案**:
1. 使用 glob 直接扫描 .md 文件（不遍历无关目录）
2. 改为只监听已打开的文件（而非整个目录）
3. 扩展忽略目录列表

### 3. CSP 阻止 Vite HMR（已修复）
- 移除 index.html 静态 CSP
- 在 main 进程动态设置 CSP（开发/生产模式区分）

---

## 🔧 关键代码位置

```
src/renderer/src/App.tsx
  - L14-15: tabsRef 定义
  - L79-140: 文件监听 useEffect（只依赖 folderPath）
  - L142-172: handleFileSelect（使用 tabsRef）

src/main/index.ts
  - L92-106: 动态 CSP 设置
  - L152-303: scanMarkdownFiles + buildFileTree（glob方案）
  - L585-644: 文件监听（只监听已打开的文件）

src/preload/index.ts
  - L12-14: watchFolder + watchFile API
```

---

## 📊 Git 状态

### 最近提交
```
6ca7e53 chore: bump version to 1.1.1
3385fe9 fix: 修复文件监听性能问题和界面卡死bug
8625cc3 fix: 修复文件监听导致的界面卡死问题
3ec9487 test: Add comprehensive test suite and fix security issues
7b11464 docs: Add v1.1.0 testing guide
```

---

## 🛠️ 下一步行动（v1.2 计划）

1. **提高测试覆盖率** - 目标 70%+
   - 补充 logger.ts 测试
   - 补充 markdownRenderer.ts 测试
   - 提高 App.tsx 分支覆盖率

2. **实现 E2E 测试** - Playwright 框架已准备
   - 5 个核心测试场景待实现

3. **功能增强**
   - 主题切换 UI
   - 虚拟滚动优化大文件

---

## 📝 重要提醒

1. **v1.1.1 已发布** - 所有核心功能正常 ✅
2. **测试全部通过** - 125个测试 ✅
3. **性能优化完成** - 大文件夹加载正常 ✅
4. **已提交并打包** - 无未提交修改 ✅

---

## 📋 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v1.0.0 | 2026-01-02 | 首次发布：文件树、多标签、Markdown渲染 |
| v1.1.0 | 2026-01-03 | Mermaid图表、文件监听（有Bug） |
| v1.1.1 | 2026-01-03 | 修复卡死Bug、性能优化、125个测试 |

---

**维护者**: Claude Code
**项目路径**: `/Users/mac/Documents/test/testmd/md-viewer`
