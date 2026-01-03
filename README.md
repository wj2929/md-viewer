# MD Viewer

> 一个简洁、高效的桌面端 Markdown 预览工具

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-39.2.7-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)

---

## ✨ 特性

- 📁 **文件树浏览** - 递归显示文件夹中的所有 Markdown 文件
- 📑 **多标签预览** - 同时打开多个文件，自由切换
- 🎨 **完整 Markdown 支持** - 标题、列表、表格、引用等
- 💻 **代码高亮** - 支持 15+ 编程语言，VSCode Dark+ 主题
- 📐 **数学公式** - KaTeX 渲染 LaTeX 公式
- 📊 **Mermaid 图表** - 支持流程图、时序图、甘特图等 (v1.1+)
- 👀 **实时监听** - 文件修改自动刷新，无需手动重载 (v1.1+)
- 🔍 **强大搜索** - 文件名模糊搜索 + 全文搜索
- 💾 **导出功能** - 导出 HTML 和 PDF
- 🌓 **主题自适应** - 自动跟随系统明暗主题
- ⚡ **极速体验** - Vite 热重载，秒级启动

---

## 🖼️ 截图

_（待添加）_

---

## 📦 下载

### macOS
- [MD Viewer-1.1.1.dmg](https://github.com/wj2929/md-viewer/releases) (Apple Silicon)

### Windows
- [MD Viewer-1.1.1.exe](https://github.com/wj2929/md-viewer/releases)

### Linux
- [MD Viewer-1.1.1.AppImage](https://github.com/wj2929/md-viewer/releases)

---

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/wj2929/md-viewer.git

# 进入目录
cd md-viewer

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 使用

1. 点击「打开文件夹」选择包含 Markdown 文件的目录
2. 在左侧文件树中点击文件即可预览
3. 使用 `⌘K` (macOS) 或 `Ctrl+K` (Windows/Linux) 快速搜索文件

---

## 🛠️ 技术栈

### 核心框架
- **[Electron](https://electronjs.org/)** - 跨平台桌面应用框架
- **[React](https://react.dev/)** - UI 框架
- **[TypeScript](https://www.typescriptlang.org/)** - 类型安全
- **[Vite](https://vitejs.dev/)** - 构建工具

### Markdown 渲染
- **[markdown-it](https://github.com/markdown-it/markdown-it)** - Markdown 解析器
- **[Prism.js](https://prismjs.com/)** - 代码高亮
- **[KaTeX](https://katex.org/)** - 数学公式渲染
- **[Mermaid](https://mermaid.js.org/)** - 图表渲染 (v1.1+)

### 其他库
- **[Fuse.js](https://fusejs.io/)** - 模糊搜索
- **[chokidar](https://github.com/paulmillr/chokidar)** - 文件监听 (v1.1+)
- **[electron-store](https://github.com/sindresorhus/electron-store)** - 状态持久化

---

## 📚 功能文档

### Markdown 支持

#### 基础语法
- 标题（H1-H6）
- 粗体、斜体、删除线
- 链接、图片
- 有序列表、无序列表
- 引用块
- 水平分隔线

#### 扩展语法
- 表格
- 任务列表
- 代码块（支持语法高亮）
- 行内代码

#### 代码高亮

支持的语言：
```
JavaScript, TypeScript, JSX, TSX
Python, Java, Go, Rust
Bash, JSON, YAML
CSS, Markdown
```

#### 数学公式

**行内公式：**
```markdown
这是一个行内公式：$E = mc^2$
```

**块级公式：**
```markdown
$$
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$
```

#### Mermaid 图表 (v1.1+)

**流程图：**
```markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[OK]
    B -->|No| D[End]
\`\`\`
```

**时序图：**
```markdown
\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob!
    Bob-->>Alice: Hi Alice!
\`\`\`
```

支持的图表类型：流程图、时序图、类图、状态图、甘特图、饼图等。

### 搜索功能

#### 文件名搜索
- 按 `⌘K` / `Ctrl+K` 打开搜索
- 输入文件名关键词
- 支持模糊匹配

#### 全文搜索
- 切换到「全文」模式
- 搜索所有 Markdown 文件内容
- 显示匹配片段

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` / `Ctrl+K` | 打开搜索 |
| `Esc` | 关闭搜索 |
| `⌘W` / `Ctrl+W` | 关闭当前标签 |
| `⌘+` / `Ctrl+` | 放大 |
| `⌘-` / `Ctrl-` | 缩小 |
| `⌘0` / `Ctrl+0` | 重置缩放 |

---

## 🏗️ 开发

### 项目结构

```
md-viewer/
├── src/
│   ├── main/              # 主进程
│   ├── preload/           # 预加载脚本
│   └── renderer/          # 渲染进程
│       └── src/
│           ├── components/    # React 组件
│           ├── assets/        # 样式文件
│           ├── App.tsx
│           └── main.tsx
├── package.json
├── electron.vite.config.ts
└── tsconfig.json
```

### 可用脚本

```bash
# 开发模式（热重载）
npm run dev

# 构建应用
npm run build

# 类型检查
npm run typecheck

# 打包（macOS）
npm run build:mac

# 打包（Windows）
npm run build:win

# 打包（Linux）
npm run build:linux
```

### 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📋 路线图

### v1.0 ✅
- [x] 文件树浏览
- [x] 多标签预览
- [x] Markdown 渲染
- [x] 代码高亮
- [x] 数学公式
- [x] 文件名搜索
- [x] 全文搜索
- [x] HTML 导出
- [x] PDF 导出
- [x] 窗口状态记忆
- [x] 会话恢复

### v1.1 ✅ (当前版本)
- [x] Mermaid 图表支持
- [x] 文件监听与自动刷新
- [x] 测试覆盖率 55%+（组件 83%+）
- [x] CI/CD 自动化

### v2.0 (计划中)
- [ ] 插件系统
- [ ] 简单编辑功能
- [ ] 多语言支持
- [ ] PlantUML 支持
- [ ] 更多主题
- [ ] Vim 键位支持

---

## 🐛 已知问题

1. **大文件渲染可能卡顿** - 已添加 10000 行截断保护
2. ~~**Mermaid 图表未支持**~~ - ✅ v1.1 已实现

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [Electron](https://electronjs.org/)
- [React](https://react.dev/)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [Prism.js](https://prismjs.com/)
- [KaTeX](https://katex.org/)
- [Fuse.js](https://fusejs.io/)

---

## 📞 联系方式

- 问题反馈：[GitHub Issues](https://github.com/wj2929/md-viewer/issues)
- 邮箱：wj2929@gmail.com

---

**Made with ❤️ by [wj2929](https://github.com/wj2929)**
