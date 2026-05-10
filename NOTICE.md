# 第三方组件声明

本项目采用 MIT License 发布，完整许可证文本见 [LICENSE](LICENSE)。

本文档用于说明 MD Viewer 使用的主要第三方开源组件。许可证名称保留 SPDX 标识，便于自动化工具识别。

## 第三方运行时组件

项目依赖的完整清单以 [package.json](package.json) 和 [package-lock.json](package-lock.json) 为准。下表只列出对应用运行、渲染或导出能力影响较大的直接依赖。

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| Electron | MIT | 跨平台桌面应用运行时 |
| React / React DOM | MIT | 渲染进程 UI |
| markdown-it | MIT | Markdown 解析 |
| Prism.js | MIT | 代码高亮 |
| KaTeX | MIT | 数学公式渲染 |
| Mermaid | MIT | Mermaid 图表渲染 |
| ECharts | Apache-2.0 | 交互式图表渲染 |
| Markmap | MIT | 思维导图渲染 |
| hpcc-js/wasm-graphviz | Apache-2.0 | Graphviz DOT 图表渲染 |
| PlantUML Encoder | MIT | PlantUML 文本编码 |
| Excalidraw | MIT | Excalidraw 静态画板渲染 |
| AntV Infographic | MIT | 信息图渲染 |
| DOMPurify / isomorphic-dompurify | MPL-2.0 / Apache-2.0 | HTML 清理与安全过滤 |
| docx | MIT | DOCX 生成辅助 |
| chokidar | MIT | 文件监听 |
| Fuse.js | Apache-2.0 | 模糊搜索 |
| Zustand | MIT | 状态管理 |
| electron-store | MIT | 本地设置持久化 |

## 说明

本文件不是第三方依赖许可证的完整副本。完整依赖列表、版本和传递依赖以 [package.json](package.json) 和 [package-lock.json](package-lock.json) 为准。
