# MD Viewer v1.1.0 发布说明

**发布日期**: 2026-01-03
**版本类型**: 功能版本 (Minor Release)
**状态**: ✅ 已完成

---

## 📦 下载

### macOS (Apple Silicon)
- **DMG 安装包**: `dist/MD Viewer-1.1.0-arm64.dmg` (137 MB)
- **ZIP 压缩包**: `dist/MD Viewer-1.1.0-arm64-mac.zip` (132 MB)

### 安装说明
1. 下载 DMG 文件
2. 双击打开
3. 将 MD Viewer 拖拽到 Applications 文件夹
4. 首次打开时，右键 → 打开（绕过 Gatekeeper）

---

## 🎉 新增功能

### 1. Mermaid 图表支持
- ✨ 支持多种图表类型：
  - 流程图 (Flowchart)
  - 时序图 (Sequence Diagram)
  - 类图 (Class Diagram)
  - 状态图 (State Diagram)
  - 甘特图 (Gantt Chart)
- 🎨 明暗主题自适应
- ⚠️ 错误时保留原始代码显示

### 2. 实时文件监听
- 👀 自动监听已打开文件夹的变化
- 🔄 文件修改 → 自动刷新已打开标签页
- ➕ 文件添加 → 自动刷新文件树
- ❌ 文件删除 → 自动关闭标签并刷新文件树
- ⚡ 响应时间: 1-2秒

### 3. 自动刷新功能
- 无需手动重新加载
- 提升 Markdown 编辑体验
- 支持递归监听子目录

---

## 🧪 测试体系

### 测试统计
| 指标 | v1.0.0 | v1.1.0 | 提升 |
|------|--------|--------|------|
| **单元测试数** | 60 | 125 | +108% |
| **测试通过率** | 100% | 100% | - |
| **代码覆盖率** | 40% | 60-70% | +20-30% |

### 新增测试
- ✅ TabBar: 18 测试（90%+ 覆盖率）
- ✅ ErrorBoundary: 12 测试（80%+ 覆盖率）
- ✅ fileCache: 14 测试（85%+ 覆盖率）
- ✅ App.tsx: 21 集成测试

### 质量保证
- ✅ E2E 测试框架 (Playwright)
- ✅ 回归测试清单 (150+ 测试项)
- ✅ 安全审查报告
- ✅ 性能测试脚本
- ✅ QA 指南

---

## 🔒 安全修复

### 已修复
1. **XSS 漏洞** (高危)
   - 问题: markdown-it 配置 `html: true` 允许执行任意 HTML/JavaScript
   - 修复: 改为 `html: false`
   - 影响: 防止恶意 Markdown 文件执行脚本

2. **代码结构优化**
   - 修复函数定义顺序问题
   - 确保所有依赖正确声明

### 已知风险（低优先级）
- Mermaid SVG 输出未过滤（建议 v1.2 添加 DOMPurify）
- Mermaid 渲染无限制（建议 v1.2 添加超时）

---

## 🛠️ 技术细节

### 新增依赖
```json
{
  "mermaid": "^11.0.0",
  "chokidar": "^4.0.0"
}
```

### 测试框架
```json
{
  "vitest": "^4.0.16",
  "@testing-library/react": "^16.3.1",
  "playwright": "^1.57.0"
}
```

### API 变更
- 新增 `window.api.watchFolder(path)`
- 新增 `window.api.unwatchFolder()`
- 新增 `window.api.onFileChanged(callback)`
- 新增 `window.api.onFileAdded(callback)`
- 新增 `window.api.onFileRemoved(callback)`

---

## 📚 文档

### 新增文档
- `TEST_SUMMARY.md` - 测试补充工作总结
- `SECURITY_AUDIT.md` - 安全审查报告
- `QA_GUIDE.md` - 质量保证指南
- `REGRESSION_TEST_CHECKLIST.md` - 回归测试清单
- `COVERAGE_ANALYSIS.md` - 测试覆盖率分析

### 更新文档
- `CHANGELOG.md` - 添加 v1.1.0 变更记录
- `README.md` - 更新功能说明（建议补充 Mermaid 使用示例）

---

## 🔄 升级说明

### 从 v1.0.0 升级
1. 下载新版本安装包
2. 覆盖安装即可
3. 所有设置和数据会自动保留（electron-store）

### 破坏性变更
- ⚠️ 无破坏性变更

---

## 🐛 已知问题

### 无已知严重问题

### 次要问题
1. macOS 代码签名过期警告
   - 影响: 首次打开需要右键 → 打开
   - 计划: v1.2 更新签名证书

2. E2E 测试未实现
   - 影响: 仅框架准备完成，测试逻辑待补充
   - 计划: v1.2 完善

---

## 📊 性能指标

| 指标 | 数值 |
|------|------|
| **安装包大小** | 137 MB (DMG) |
| **启动时间** | <2 秒 |
| **文件监听响应** | 1-2 秒 |
| **最大文件大小** | 5 MB |
| **文件缓存** | 5 个文件 (LRU) |

---

## 🙏 致谢

本次发布由以下工具和技术支持：
- Electron 39.2.7
- React 19.2.3
- TypeScript 5.9.3
- Vite 7.3.0
- Mermaid 11.0.0
- Chokidar 4.0.0

感谢所有贡献者对测试编写和质量保证方面的协助。

---

## 🔮 下一步计划 (v1.2.0)

### 计划功能
- 🔧 实现 E2E 测试逻辑
- 🛡️ 添加 Mermaid XSS 防护 (DOMPurify)
- ⏱️ 添加 Mermaid 渲染超时保护
- 🎨 主题切换 UI
- 🌍 多语言支持（i18n）

### 长期规划 (v2.0.0)
- ✏️ 简单编辑功能
- 🧩 插件系统
- 🔌 扩展 API

---

**发布者**: MD Viewer Team
**发布时间**: 2026-01-03 07:30 CST
**Git 标签**: v1.1.0
**Git 提交**: 3ec9487

