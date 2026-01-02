# 测试覆盖率分析报告

> **生成时间**: 2026-01-03
> **项目**: MD Viewer v1.1.0
> **测试框架**: Vitest + @testing-library/react
> **总测试数**: 60 个单元测试

---

## 📊 覆盖率总览

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   40.44 |    45.06 |      44 |   41.46 |
 src               |       0 |        0 |       0 |       0 |
  App.tsx          |       0 |        0 |       0 |       0 | 7-218
 src/components    |   75.37 |    70.46 |   74.57 |   77.27 |
  ErrorBoundary    |       0 |        0 |       0 |       0 | 15-82
  FileTree.tsx     |     100 |    96.15 |     100 |     100 | 37
  MarkdownRenderer |   78.81 |    65.95 |      90 |   80.35 | ...96,202,227-238
  SearchBar.tsx    |   84.76 |    80.32 |   93.33 |      90 | ...24-125,140,220
  TabBar.tsx       |       0 |        0 |       0 |       0 | 17-49
 src/utils         |       0 |        0 |       0 |       0 |
  fileCache.ts     |       0 |        0 |       0 |       0 | 7-83
  markdownRenderer |       0 |        0 |       0 |       0 | 24-140
-------------------|---------|----------|---------|---------|-------------------
```

---

## 🔴 未覆盖的关键文件（0% 覆盖）

### 1. **App.tsx** (0% 覆盖 - 最严重)

#### 未覆盖代码: 7-218 行（全部代码）

**为什么这很危险？**
- App.tsx 是整个应用的**核心入口**
- 包含所有业务逻辑：文件夹操作、标签管理、文件监听、导出功能
- **v1.1 新增的文件监听代码**（56-123 行）完全没有测试覆盖

**未测试的关键功能**:
```typescript
// ❌ 完全未测试
- handleOpenFolder()        // 打开文件夹
- handleFileSelect()        // 选择文件
- handleTabClick()          // 切换标签
- handleTabClose()          // 关闭标签
- handleExportHTML()        // 导出 HTML
- handleExportPDF()         // 导出 PDF
- useEffect(文件监听)       // v1.1 新增功能
- useEffect(加载文件列表)   // 文件夹加载逻辑
```

**风险评估**: ⚠️⚠️⚠️ **极高**
- 没有集成测试，无法验证组件之间的交互
- 文件监听的 3 个事件处理器（changed/added/removed）未测试
- 状态管理逻辑（tabs、activeTabId、files）未验证

**建议**:
```typescript
// 必须添加的测试（优先级 P0）
1. 测试打开文件夹后文件树是否正确渲染
2. 测试选择文件后是否创建新标签
3. 测试关闭标签后 activeTabId 是否正确切换
4. 测试文件监听事件是否正确触发刷新
5. 测试导出功能是否调用正确的 API
```

---

### 2. **TabBar.tsx** (0% 覆盖)

#### 未覆盖代码: 17-49 行（全部代码）

**未测试的功能**:
- 标签页渲染逻辑
- 标签切换交互
- 关闭按钮点击事件
- 活动标签高亮样式

**风险评估**: ⚠️⚠️ **高**
- 多标签系统是核心功能之一
- 没有测试用户无法确认标签是否正常工作

**建议**:
```typescript
// 必须添加的测试（优先级 P1）
describe('TabBar', () => {
  test('应该渲染所有标签')
  test('应该高亮活动标签')
  test('点击标签应该触发 onTabClick')
  test('点击关闭按钮应该触发 onTabClose')
  test('空标签列表应该不渲染任何内容')
})
```

---

### 3. **ErrorBoundary.tsx** (0% 覆盖)

#### 未覆盖代码: 15-82 行（全部代码）

**未测试的功能**:
- 错误捕获机制
- 错误状态渲染
- 错误日志记录
- 重置错误状态

**风险评估**: ⚠️ **中等**
- ErrorBoundary 是安全网，理论上不应该被触发
- 但如果触发了却没被测试过，可能导致白屏

**建议**:
```typescript
// 必须添加的测试（优先级 P2）
describe('ErrorBoundary', () => {
  test('应该捕获子组件错误')
  test('应该显示错误 UI')
  test('应该记录错误日志')
  test('重置后应该恢复正常')
})
```

---

### 4. **fileCache.ts** (0% 覆盖)

#### 未覆盖代码: 7-83 行（全部代码）

**未测试的功能**:
- LRU 缓存逻辑（最多保留 5 个文件）
- readFileWithCache() API 调用
- 缓存过期和淘汰策略

**风险评估**: ⚠️⚠️ **高**
- 缓存逻辑错误可能导致内存泄漏
- 没有测试无法确认 LRU 算法是否正确

**建议**:
```typescript
// 必须添加的测试（优先级 P1）
describe('fileCache', () => {
  test('应该缓存文件内容')
  test('缓存超过 5 个文件时应该淘汰最旧的')
  test('读取已缓存文件应该直接返回')
  test('文件读取失败应该抛出错误')
})
```

---

### 5. **markdownRenderer.ts** (0% 覆盖)

#### 未覆盖代码: 24-140 行（全部代码）

**未测试的功能**:
- createMarkdownRenderer() 工厂函数
- markdown-it 配置
- 代码高亮配置
- KaTeX 数学公式解析规则
- Mermaid 图表配置

**风险评估**: ⚠️ **中等**
- 这是工具函数，导出功能依赖它
- 如果配置错误，导出的 HTML/PDF 可能格式不正确

**建议**:
```typescript
// 建议添加的测试（优先级 P2）
describe('markdownRenderer', () => {
  test('应该正确配置 markdown-it')
  test('应该支持代码高亮')
  test('应该支持 KaTeX 公式')
  test('render() 应该生成正确的 HTML')
})
```

---

## 🟡 部分覆盖的文件（需改进）

### 6. **MarkdownRenderer.tsx** (78.81% 语句, 65.95% 分支)

#### 未覆盖的代码行:
- **94-96 行**: 数学公式块级解析的边界条件
- **202 行**: 渲染错误时的降级显示
- **227-238 行**: Mermaid 图表异步渲染逻辑

**问题分析**:
```typescript
// ❌ 未测试：单行 $$...$$ 数学公式（94-96 行）
if (firstLine.trim().endsWith('$$')) {
  firstLine = firstLine.trim().slice(0, -2)
  // ... 未测试这个分支
}

// ❌ 未测试：渲染错误时的错误 UI（202 行）
if (renderError) {
  return (
    <div className="render-error">  // 这个分支没有测试
      ...
    </div>
  )
}

// ❌ 未测试：Mermaid 渲染失败处理（227-238 行）
} catch (error) {
  console.error('Mermaid render error:', error)
  // 保留原始代码显示  // 没有测试这个错误路径
}
```

**必须补充的测试**:
```typescript
describe('MarkdownRenderer - 边界情况', () => {
  test('应该处理单行数学公式 $$x = 1$$')
  test('渲染失败时应该显示错误 UI')
  test('Mermaid 语法错误应该保留原始代码')
  test('Mermaid 异步渲染应该替换 pre 标签为 SVG')
})
```

---

### 7. **SearchBar.tsx** (84.76% 语句, 80.32% 分支)

#### 未覆盖的代码行:
- **124-125 行**: 快捷键事件监听器清理
- **140 行**: 全文搜索的边界条件
- **220 行**: 某个未覆盖的边缘情况

**未测试的场景**:
```typescript
// ❌ 未测试：组件卸载时移除事件监听器（124-125 行）
return () => {
  document.removeEventListener('keydown', handleKeyDown)
  // 没有测试这个 cleanup 是否被调用
}

// ❌ 未测试：全文搜索空结果的边界情况（140 行）
```

**必须补充的测试**:
```typescript
describe('SearchBar - 边界情况', () => {
  test('组件卸载时应该移除快捷键监听器')
  test('全文搜索无结果时应该显示提示')
  test('全文搜索应该正确转义特殊字符')
})
```

---

## 📈 测试覆盖率改进计划

### 阶段 1: 修复 P0 问题（v1.1 发布前必须完成）

| 文件 | 当前覆盖 | 目标覆盖 | 需增加测试数 | 预计时间 |
|------|---------|---------|-------------|---------|
| **App.tsx** | 0% | **60%** | 15-20 个 | 4 小时 |
| **TabBar.tsx** | 0% | **80%** | 5-8 个 | 1 小时 |
| **fileCache.ts** | 0% | **80%** | 6-8 个 | 1.5 小时 |

**总预计时间**: 6.5 小时

### 阶段 2: 修复 P1 问题（v1.2 完成）

| 文件 | 当前覆盖 | 目标覆盖 | 需增加测试数 | 预计时间 |
|------|---------|---------|-------------|---------|
| **ErrorBoundary** | 0% | **70%** | 4-6 个 | 1 小时 |
| **markdownRenderer** | 0% | **60%** | 5-7 个 | 1.5 小时 |
| **MarkdownRenderer** | 78.81% | **90%** | 3-5 个 | 1 小时 |
| **SearchBar** | 84.76% | **95%** | 2-3 个 | 0.5 小时 |

**总预计时间**: 4 小时

### 阶段 3: E2E 测试（v1.2 完成）

- 补充 Playwright E2E 测试（已生成框架）
- 测试真实 Electron 环境
- 覆盖关键用户流程

**总预计时间**: 6 小时

---

## 🎯 优先级建议

### ⚠️ **立即修复（v1.1 发布前）**:
1. ✅ 为 **App.tsx** 添加集成测试（最关键）
   - 测试文件监听逻辑（v1.1 核心功能）
   - 测试标签管理逻辑
   - 测试导出功能调用

2. ✅ 为 **TabBar.tsx** 添加单元测试
   - 多标签系统是核心功能

3. ✅ 为 **fileCache.ts** 添加单元测试
   - LRU 缓存错误可能导致内存泄漏

### 🔄 **尽快补充（v1.1 发布后 1 周内）**:
4. 补充 **MarkdownRenderer** 边界情况测试
5. 补充 **SearchBar** 边界情况测试
6. 添加 **ErrorBoundary** 测试

### 📅 **计划中（v1.2）**:
7. 完成 E2E 测试套件
8. 添加性能测试
9. 添加安全性测试

---

## 🚨 **当前最大风险**

### **App.tsx 0% 覆盖 = v1.1 文件监听功能完全未测试**

你的 v1.1 核心功能（文件监听）代码在 App.tsx 的 56-123 行：
```typescript
// ⚠️ 这段代码完全没有测试覆盖！
useEffect(() => {
  if (!folderPath) return

  window.api.watchFolder(folderPath).catch(error => {
    console.error('Failed to watch folder:', error)
  })

  const unsubscribeChanged = window.api.onFileChanged(async (filePath: string) => {
    // ❌ 未测试：文件修改时的刷新逻辑
  })

  const unsubscribeAdded = window.api.onFileAdded(async () => {
    // ❌ 未测试：文件添加时的刷新逻辑
  })

  const unsubscribeRemoved = window.api.onFileRemoved(async (filePath: string) => {
    // ❌ 未测试：文件删除时的关闭标签逻辑
  })

  return () => {
    // ❌ 未测试：清理逻辑
  }
}, [folderPath, tabs, handleTabClose])
```

**这意味着**:
- ❌ 你不知道文件监听事件是否正确触发
- ❌ 你不知道标签是否正确刷新
- ❌ 你不知道文件删除时标签是否正确关闭
- ❌ 你不知道内存是否会泄漏（事件监听器是否正确清理）

---

## 📋 行动建议

### **发布 v1.1 前（今天必须完成）**:

```bash
# 1. 生成详细覆盖率 HTML 报告
npm run test:coverage -- --reporter=html

# 2. 查看报告（在浏览器中打开）
open coverage/index.html

# 3. 重点检查以下文件的未覆盖行：
# - App.tsx (文件监听逻辑)
# - TabBar.tsx (标签管理)
# - fileCache.ts (LRU 缓存)

# 4. 至少补充 20 个测试覆盖关键功能
```

### **理想的测试覆盖率目标**:

| 组件类型 | 最低覆盖率 | 理想覆盖率 |
|---------|-----------|-----------|
| 核心组件 (App.tsx) | 60% | 80% |
| UI 组件 | 80% | 90% |
| 工具函数 | 80% | 95% |
| 整体项目 | 70% | 85% |

**你当前的 40.44% 覆盖率远低于行业标准（70%+）**

---

**结论**: v1.1 的测试覆盖率不足以支持发布。建议先补充 App.tsx 的集成测试，确保文件监听功能经过验证后再发布。
