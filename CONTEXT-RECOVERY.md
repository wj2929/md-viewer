# MD Viewer - 上下文恢复文档

> **用途**: Token限制时快速恢复上下文
> **最后更新**: 2026-01-03 14:50
> **当前状态**: ✅ **核心Bug已修复，性能优化进行中**

---

## 🚀 快速恢复指令

```bash
# 项目路径
cd /Users/mac/Documents/test/testmd/md-viewer

# 当前状态：v1.1.1 开发中
# - 测试：125个（100%通过）✅
# - 核心Bug：已修复 ✅
# - 性能优化：进行中（大文件夹加载慢）

# 必读文档
cat CONTEXT-RECOVERY.md  # 本文档
cat PROGRESS.md          # 最新进度

# 启动开发模式
npm run dev

# 运行测试
npm test
```

---

## 📍 当前状态

### ✅ 已修复的问题

#### 1. 界面卡死Bug（P0 - 已修复）
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

#### 2. CSP 阻止 Vite HMR（已修复）
- 移除 index.html 静态 CSP
- 在 main 进程动态设置 CSP（开发/生产模式区分）

### ⏳ 进行中的优化

#### 大文件夹加载慢（P1）
**症状**: 打开包含 node_modules/venv 的大目录非常慢
**原因**:
1. `readDirRecursive` 遍历所有目录
2. chokidar 监听整个目录树导致 EMFILE

**已实施的优化**:
1. 使用 glob 直接扫描 .md 文件（不遍历无关目录）
2. 改为只监听已打开的文件（而非整个目录）
3. 扩展忽略目录列表

**状态**: 需要进一步测试验证

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
8625cc3 fix: 修复文件监听导致的界面卡死问题
3ec9487 test: Add comprehensive test suite and fix security issues
7b11464 docs: Add v1.1.0 testing guide
```

### 未提交的修改
- 性能优化代码（glob扫描、只监听打开的文件）
- 需要测试验证后提交

---

## 🛠️ 下一步行动

1. **验证性能优化** - 测试大文件夹加载速度
2. **提交优化代码** - 如果测试通过
3. **重新打包** - 发布 v1.1.1
4. **运行完整测试** - 确保没有回归

---

## 📝 重要提醒

1. **测试全部通过** - 125个测试 ✅
2. **核心Bug已修复** - 可以正常打开文件 ✅
3. **性能优化进行中** - 大文件夹可能仍较慢
4. **有未提交的修改** - 需要测试后提交

---

**维护者**: Claude Code
**项目路径**: `/Users/mac/Documents/test/testmd/md-viewer`
