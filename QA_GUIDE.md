# v1.1.0 发布前质量保证指南

> **目标**: 确保 v1.1.0 质量达到生产级别
> **完成时间**: 预计 6-8 小时
> **重要性**: ⚠️ 未完成前不得发布

---

## 📚 已生成的测试和分析文档

### 1. **E2E 自动化测试** ✅
- **位置**: `e2e/` 目录
- **文件**:
  - `playwright.config.ts` - Playwright 配置
  - `e2e/fixtures/electron.ts` - Electron 测试 Fixture
  - `e2e/01-app-launch.spec.ts` - 应用启动测试
  - `e2e/02-file-tree.spec.ts` - 文件树功能测试
  - `e2e/03-markdown-rendering.spec.ts` - Markdown 渲染测试
  - `e2e/04-file-watching.spec.ts` - 文件监听测试（v1.1 核心）
  - `e2e/05-export-features.spec.ts` - 导出功能测试

**运行方法**:
```bash
# 1. 先构建应用
npm run build

# 2. 运行 E2E 测试
npm run test:e2e

# 3. 使用 UI 模式调试
npm run test:e2e:ui
```

**注意事项**:
⚠️ E2E 测试需要完整的 Electron 构建，首次运行可能需要 Mock 文件对话框

---

### 2. **回归测试清单** ✅
- **位置**: `REGRESSION_TEST_CHECKLIST.md`
- **内容**: 150+ 个手动测试项目
- **用途**: 打印后逐项勾选，确保所有功能正常

**使用方法**:
```bash
# 1. 打开文件
open REGRESSION_TEST_CHECKLIST.md

# 2. 打印（建议 A4 双面）
# 或使用在线 Markdown 编辑器导出 PDF

# 3. 边测试边勾选 ✅

# 4. 记录发现的问题到"发现的问题"表格
```

**预计时间**: 30-45 分钟（完整测试）

---

### 3. **测试覆盖率分析** ✅
- **位置**: `COVERAGE_ANALYSIS.md`
- **内容**: 详细的未覆盖代码分析

**关键发现**:
```
🔴 App.tsx: 0% 覆盖 - v1.1 文件监听功能完全未测试
🔴 TabBar.tsx: 0% 覆盖 - 多标签系统未测试
🔴 fileCache.ts: 0% 覆盖 - LRU 缓存未测试
🟡 MarkdownRenderer: 78.81% - 需补充边界情况测试
🟡 SearchBar: 84.76% - 需补充边界情况测试
```

**下一步行动**:
```bash
# 1. 生成详细覆盖率 HTML 报告
npm run test:coverage -- --reporter=html

# 2. 在浏览器中查看
open coverage/index.html

# 3. 查看未覆盖的代码行
# 4. 补充测试（参考 COVERAGE_ANALYSIS.md 建议）
```

---

### 4. **性能测试脚本** ✅
- **位置**: `scripts/performance-test.ts`
- **测试场景**:
  1. 大量文件创建（100 个文件）
  2. 快速连续修改（50 次）
  3. 批量删除
  4. 深层嵌套目录（10 层）
  5. 内存使用监控

**运行方法**:
```bash
# 1. 安装 tsx（如果还没有）
npm install -g tsx

# 2. 运行性能测试
cd scripts
npm run perf:test

# 或直接运行
tsx scripts/performance-test.ts
```

**预期输出**:
```
========================================
MD Viewer 性能测试 - 文件监听
========================================

[测试 1] 大量文件创建
创建 100 个 Markdown 文件: 234.56ms
✅ 通过 (234.56ms < 5000ms)

[测试 2] 快速连续修改
50 次快速修改: 123.45ms
✅ 通过 (123.45ms < 2000ms)

...

通过率: 100%
🎉 所有性能测试通过！
```

---

### 5. **安全审查报告** ✅
- **位置**: `SECURITY_AUDIT.md`
- **发现**: 4 个安全问题（1 高危、2 中危、1 低危）

**关键问题**:
```
🔴 VUL-001: XSS 漏洞 - dangerouslySetInnerHTML 未过滤
🟡 VUL-002: Mermaid XSS 风险
🟡 VUL-003: DoS 攻击 - 无限制的 Mermaid 渲染
🟢 VUL-004: 信息泄露 - 错误日志包含路径信息
```

**必须修复**:
⚫ **VUL-001 必须在发布前修复！**

---

## 🚀 发布前质量保证流程

### 阶段 1: 修复关键问题（2-3 小时）⚠️ 必须完成

```bash
# 1. 修复高危 XSS 漏洞
# 编辑 src/renderer/src/components/MarkdownRenderer.tsx
# 将 html: true 改为 html: false
# 或添加 DOMPurify 过滤

# 2. 补充 App.tsx 的集成测试（至少 10 个测试）
# 创建 src/renderer/test/App.test.tsx
# 测试文件监听、标签管理、导出功能

# 3. 运行测试确认覆盖率提升
npm run test:coverage
```

---

### 阶段 2: 自动化测试（1-2 小时）

```bash
# 1. 运行单元测试
npm run test

# 2. 运行 E2E 测试（需要先构建）
npm run build
npm run test:e2e

# 3. 检查所有测试通过
```

---

### 阶段 3: 手动回归测试（30-45 分钟）

```bash
# 1. 打印 REGRESSION_TEST_CHECKLIST.md

# 2. 启动应用
npm run dev

# 3. 逐项测试并勾选 ✅

# 4. 记录发现的问题
```

---

### 阶段 4: 性能验证（15 分钟）

```bash
# 1. 运行性能测试
tsx scripts/performance-test.ts

# 2. 验证所有指标通过

# 3. 手动测试极端场景：
#    - 打开包含 100+ 个文件的文件夹
#    - 快速连续修改文件 10 次
#    - 打开超大文件（>10000 行）
```

---

### 阶段 5: 安全验证（30 分钟）

```bash
# 1. 修复 VUL-001（XSS 漏洞）

# 2. 运行依赖审计
npm audit

# 3. 修复已知漏洞
npm audit fix

# 4. 测试恶意 Markdown 文件
# 创建包含 <script> 标签的 .md 文件，确认不执行
```

---

## 📋 发布检查清单

### 代码质量
- [ ] 所有单元测试通过（60/60）
- [ ] E2E 测试通过（至少 15/20）
- [ ] 测试覆盖率 > 70%（当前 40.44%）
- [ ] App.tsx 覆盖率 > 60%（当前 0%）
- [ ] 无 ESLint 错误
- [ ] 无 TypeScript 错误

### 功能验证
- [ ] 回归测试清单完成（150+ 项）
- [ ] v1.0 核心功能正常（文件树、标签、搜索、导出）
- [ ] v1.1 新功能正常（Mermaid、文件监听）
- [ ] 所有 P0 bug 已修复

### 性能验证
- [ ] 性能测试通过（5/5）
- [ ] 应用启动 < 2 秒
- [ ] 文件监听响应 < 2 秒
- [ ] 内存占用 < 500MB（10 标签）
- [ ] CPU 占用 < 5%（空闲）

### 安全验证
- [ ] VUL-001 (XSS) 已修复 ⚠️ **必须**
- [ ] VUL-002 (Mermaid XSS) 已修复或缓解
- [ ] VUL-003 (DoS) 已修复或缓解
- [ ] `npm audit` 无高危漏洞
- [ ] 启用 `sandbox: true`

### 文档
- [ ] README.md 更新
- [ ] CHANGELOG.md 更新
- [ ] 版本号升级到 1.1.0
- [ ] Git 标签创建 `v1.1.0`

---

## ⚠️ **发布阻塞问题**（必须修复）

### 1. **VUL-001: XSS 漏洞**
**状态**: ❌ **未修复**
**影响**: 攻击者可以通过恶意 .md 文件执行任意代码
**修复方法**: 见 `SECURITY_AUDIT.md` 第 15-70 行

### 2. **App.tsx 0% 测试覆盖**
**状态**: ❌ **未修复**
**影响**: v1.1 核心功能（文件监听）未经测试验证
**修复方法**: 见 `COVERAGE_ANALYSIS.md` 第 55-100 行

### 3. **E2E 测试未实现**
**状态**: ⚠️ **框架已生成，需补充实现细节**
**影响**: 无法验证真实 Electron 环境下的行为
**修复方法**: 完善 `e2e/*.spec.ts` 中的测试用例

---

## 📞 如果遇到问题

### 测试失败
```bash
# 查看详细错误
npm run test -- --reporter=verbose

# 运行单个测试文件
npm run test src/renderer/test/components/FileTree.test.tsx

# 查看覆盖率报告
npm run test:coverage -- --reporter=html
open coverage/index.html
```

### E2E 测试失败
```bash
# 使用 UI 模式调试
npm run test:e2e:ui

# 查看截图和视频
ls test-results/
```

### 性能测试失败
```bash
# 查看详细日志
tsx scripts/performance-test.ts 2>&1 | tee perf.log
```

---

## 🎯 最终目标

**发布标准**:
- ✅ 代码质量: 测试覆盖率 ≥ 70%
- ✅ 功能完整: 回归测试 100% 通过
- ✅ 性能合格: 所有性能指标达标
- ✅ 安全可靠: 无高危漏洞
- ✅ 文档齐全: README、CHANGELOG 更新

**当前状态**:
```
代码质量: ❌ 40.44% (需要 70%)
功能完整: ⏳ 待测试
性能合格: ⏳ 待测试
安全可靠: ❌ 1 个高危漏洞
文档齐全: ✅ 已完成
```

**预计完成时间**: 6-8 小时

---

**最后提醒**: 不要在修复 VUL-001 和提升测试覆盖率之前发布 v1.1.0！
