# Mermaid 图表测试

## 流程图

```mermaid
graph TD
    A[开始] --> B{是否成功?}
    B -->|是| C[继续]
    B -->|否| D[结束]
    C --> E[完成]
```

## 时序图

```mermaid
sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: 你好 Bob!
    Bob-->>Alice: 你好 Alice!
    Alice->>Bob: 最近怎么样?
    Bob-->>Alice: 很好，谢谢!
```

## 类图

```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +bark()
    }
    class Cat {
        +meow()
    }
    Animal <|-- Dog
    Animal <|-- Cat
```

## 状态图

```mermaid
stateDiagram-v2
    [*] --> 待处理
    待处理 --> 进行中: 开始
    进行中 --> 已完成: 完成
    进行中 --> 已取消: 取消
    已完成 --> [*]
    已取消 --> [*]
```

## 甘特图

```mermaid
gantt
    title 项目时间表
    dateFormat  YYYY-MM-DD
    section 设计
    需求分析           :a1, 2026-01-01, 3d
    原型设计           :after a1  , 5d
    section 开发
    前端开发           :2026-01-10  , 10d
    后端开发           :2026-01-10  , 12d
    section 测试
    集成测试           :2026-01-20  , 5d
```

## 饼图

```mermaid
pie title 技术栈分布
    "TypeScript" : 45
    "React" : 30
    "Electron" : 15
    "其他" : 10
```

## ER 图（实体关系图）

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER {
        int id PK
        string name
        string email
    }
    ORDER ||--|{ LINE_ITEM : contains
    ORDER {
        int id PK
        date created_at
    }
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    PRODUCT {
        int id PK
        string name
        float price
    }
```

## 用户旅程图

```mermaid
journey
    title 用户购物流程
    section 浏览
      打开网站: 5: 用户
      搜索商品: 4: 用户
      查看详情: 4: 用户
    section 购买
      加入购物车: 5: 用户
      结算: 3: 用户
      支付: 4: 用户
    section 收货
      等待发货: 2: 用户
      收到商品: 5: 用户
```

## Git 图

```mermaid
gitGraph
    commit id: "初始化"
    commit id: "添加功能A"
    branch develop
    commit id: "开发中"
    commit id: "功能完成"
    checkout main
    merge develop id: "合并开发"
    commit id: "发布v1.0"
```

## 思维导图

```mermaid
mindmap
  root((MD Viewer))
    功能
      文件树
      多标签
      Markdown渲染
    技术栈
      Electron
      React
      TypeScript
    特性
      KaTeX公式
      Mermaid图表
      代码高亮
```

## 流程图（左右方向）

```mermaid
graph LR
    A[输入] --> B[处理]
    B --> C[输出]
```

## 流程图（带子图）

```mermaid
graph TB
    subgraph 前端
        A[React] --> B[组件]
        B --> C[页面]
    end
    subgraph 后端
        D[API] --> E[数据库]
    end
    C --> D
```

## C4 架构图

```mermaid
C4Context
    title 系统上下文图
    Person(user, "用户", "使用系统的人")
    System(system, "MD Viewer", "Markdown预览工具")
    System_Ext(fs, "文件系统", "本地文件")
    Rel(user, system, "使用")
    Rel(system, fs, "读取")
```

## 时间线

```mermaid
timeline
    title MD Viewer 发展历程
    2026-01-02 : v1.0.0 发布
               : 基础功能完成
    2026-01-03 : v1.1.0 发布
               : 添加 Mermaid 支持
               : 添加文件监听
    2026-01-03 : v1.1.1 发布
               : Bug 修复
```

## 错误语法测试

以下是故意的错误语法，应该保留原始代码显示：

```mermaid
这是无效的 Mermaid 语法
应该显示原始代码而不是崩溃
```

---

## MD Viewer 系统专属测试

> 以下用例围绕 MD Viewer 自身的架构、功能和流程展开，增强代入感。

## MD-1. MD Viewer 渲染管线流程图

```mermaid
graph TD
    A[用户打开 .md 文件] --> B[fs.readFile 读取内容]
    B --> C[markdown-it 解析]
    C --> D{检测代码块类型}
    D -->|mermaid| E[Mermaid.js 本地渲染]
    D -->|echarts/js/json| F[ECharts 本地渲染]
    D -->|plantuml/puml| G[PlantUML 远程服务器]
    D -->|dot/graphviz| H[WASM Graphviz 渲染]
    D -->|markmap| I[Markmap 本地渲染]
    D -->|drawio| J[DrawIO mxGraph 渲染]
    D -->|infographic| K[AntV Infographic 渲染]
    D -->|普通代码| L[Prism.js 语法高亮]
    E --> M[DOMPurify 净化]
    F --> M
    G --> M
    H --> M
    I --> M
    J --> M
    K --> M
    L --> M
    M --> N[VirtualizedMarkdown 渲染到 DOM]
    N --> O[用户看到预览]
```

## MD-2. Electron 主进程与渲染进程通信

```mermaid
sequenceDiagram
    participant U as 用户
    participant R as Renderer Process<br/>(React App)
    participant P as Preload Script<br/>(contextBridge)
    participant M as Main Process<br/>(Electron)
    participant FS as File System

    U->>R: 点击文件树中的文件
    R->>P: window.api.readFile(path)
    P->>M: ipcRenderer.invoke('read-file', path)
    M->>M: 校验 allowedBasePath
    alt 路径合法
        M->>FS: fs.readFile(path, 'utf-8')
        FS-->>M: fileContent
        M-->>P: fileContent
        P-->>R: fileContent
        R->>R: markdownRenderer.render(content)
        R-->>U: 显示 Markdown 预览
    else 路径非法
        M-->>P: Error: 路径不在允许范围内
        P-->>R: Error
        R-->>U: Toast 错误提示
    end
```

## MD-3. 文件监听与自动刷新

```mermaid
sequenceDiagram
    participant FS as 文件系统
    participant C as chokidar<br/>文件监听
    participant M as Main Process
    participant R as Renderer Process

    Note over C: 监听当前打开文件
    FS->>C: 文件内容变更
    C->>M: change 事件
    M->>M: 防抖 300ms
    M->>R: ipcMain.send('file-changed', path)
    R->>R: 重新读取并渲染
    R->>R: 保持滚动位置
    Note over R: 用户无感知刷新
```

## MD-4. 导出功能状态图

```mermaid
stateDiagram-v2
    [*] --> 空闲

    state 空闲 {
        [*] --> 等待用户操作
    }

    空闲 --> 导出HTML: Cmd+Shift+E
    空闲 --> 导出PDF: Cmd+P → 打印为PDF
    空闲 --> 导出DOCX: 右键 → 导出DOCX

    state 导出HTML {
        [*] --> 克隆DOM
        克隆DOM --> 内联CSS样式
        内联CSS样式 --> 处理图表SVG
        处理图表SVG --> 处理KaTeX公式
        处理KaTeX公式 --> 写入文件
        写入文件 --> [*]
    }

    state 导出PDF {
        [*] --> printToPDF
        printToPDF --> 生成PDF文件
        生成PDF文件 --> [*]
    }

    state 导出DOCX {
        [*] --> 调用Pandoc
        调用Pandoc --> 应用Lua过滤器
        应用Lua过滤器 --> 生成DOCX
        生成DOCX --> [*]
    }

    导出HTML --> 空闲: 完成/失败
    导出PDF --> 空闲: 完成/失败
    导出DOCX --> 空闲: 完成/失败
```

## MD-5. 书签系统 ER 图

```mermaid
erDiagram
    AppData ||--o{ Bookmark : "管理"
    AppData ||--o{ RecentFile : "记录"
    AppData ||--o{ PinnedTab : "包含"
    AppData {
        string app_id PK
        string theme
        int font_size
        string plantuml_server
        json window_bounds
    }
    Bookmark {
        string bookmark_id PK
        string file_path
        string title
        timestamp created_at
        int sort_order
    }
    RecentFile {
        string file_path PK
        timestamp last_opened
        int open_count
    }
    PinnedTab {
        string tab_id PK
        string folder_path FK
        string file_path
        int sort_order
    }
```

## MD-6. MD Viewer 版本发布甘特图

```mermaid
gantt
    title MD Viewer 版本发布时间线
    dateFormat YYYY-MM-DD
    axisFormat %m/%d

    section v1.3.x
    v1.3.5 基础功能          :done, v135, 2026-01-08, 1d
    v1.3.6 混合方案+书签     :done, v136, 2026-01-09, 1d
    v1.3.7 书签增强          :done, v137, 2026-01-09, 1d

    section v1.4.x
    v1.4.0 页面内搜索        :done, v140, 2026-01-10, 1d
    v1.4.2 置顶+字体+打印   :done, v142, 2026-01-10, 1d
    v1.4.3 全屏查看          :done, v143, 2026-01-10, 1d
    v1.4.4 目录自动滚动      :done, v144, 2026-01-11, 1d
    v1.4.7 导出HTML所见即所得 :done, v147, 2026-01-30, 1d

    section v1.5.x
    v1.5.0 ECharts+跨平台    :done, v150, 2026-02-07, 1d
    v1.5.1 递归分屏+Lightbox :done, v151, 2026-02-09, 1d
    v1.5.2 Infographic+多窗口 :done, v152, 2026-02-10, 1d
    v1.5.3 书签菜单+串行渲染 :done, v153, 2026-02-11, 1d
    v1.5.4 Markmap+Graphviz  :done, v154, 2026-02-13, 2d
    v1.5.5 DrawIO+工具栏     :active, v155, 2026-02-15, 3d
```

## MD-7. 技术栈饼图

```mermaid
pie title MD Viewer 技术栈组成
    "TypeScript" : 55
    "React/JSX" : 20
    "CSS" : 10
    "Electron API" : 10
    "Shell/Config" : 5
```

## MD-8. 图表渲染器类图

```mermaid
classDiagram
    class MarkdownRenderer {
        -md: MarkdownIt
        +render(content: string): string
        +configure(): void
    }

    class MermaidRenderer {
        +renderAll(container: HTMLElement): Promise~void~
        -initMermaid(): void
    }

    class EChartsRenderer {
        -instances: Map~string, ECharts~
        +render(el: HTMLElement, config: object): void
        +dispose(el: HTMLElement): void
    }

    class PlantUMLRenderer {
        -serverUrl: string
        -cache: Map~string, string~
        +render(code: string): Promise~string~
        -encode(code: string): string
    }

    class GraphvizRenderer {
        -wasmInstance: Graphviz
        +render(code: string): Promise~string~
        +init(): Promise~void~
    }

    class MarkmapRenderer {
        +render(el: HTMLElement, code: string): void
        -transformer: Transformer
    }

    class DrawIORenderer {
        +render(el: HTMLElement, xml: string): void
        -parseXML(xml: string): Document
    }

    MarkdownRenderer --> MermaidRenderer : 检测 mermaid 块
    MarkdownRenderer --> EChartsRenderer : 检测 echarts 块
    MarkdownRenderer --> PlantUMLRenderer : 检测 plantuml 块
    MarkdownRenderer --> GraphvizRenderer : 检测 dot 块
    MarkdownRenderer --> MarkmapRenderer : 检测 markmap 块
    MarkdownRenderer --> DrawIORenderer : 检测 drawio 块
```

## MD-9. 用户操作旅程图

```mermaid
journey
    title 用户使用 MD Viewer 的典型旅程
    section 启动
      打开 MD Viewer: 5: 用户
      选择文件夹: 4: 用户
      浏览文件树: 4: 用户
    section 预览
      点击 .md 文件: 5: 用户
      查看渲染效果: 5: 用户
      调整字体大小: 3: 用户
      切换亮暗主题: 4: 用户
    section 图表
      查看 Mermaid 图: 5: 用户
      查看 ECharts 图: 5: 用户
      全屏查看图表: 4: 用户
    section 导出
      导出为 HTML: 4: 用户
      导出为 PDF: 3: 用户
      分享给同事: 5: 用户
```

## MD-10. Git 分支管理

```mermaid
gitGraph
    commit id: "v1.5.3 release"
    branch feature/drawio
    commit id: "feat: drawio renderer"
    commit id: "feat: drawio toolbar"
    commit id: "test: drawio e2e"
    checkout main
    branch feature/plantuml
    commit id: "feat: plantuml support"
    commit id: "feat: plantuml cache"
    checkout main
    merge feature/drawio id: "merge drawio"
    merge feature/plantuml id: "merge plantuml"
    commit id: "v1.5.5 release"
```

## MD-11. Zustand 状态管理架构

```mermaid
graph LR
    subgraph Stores
        WS[windowStore<br/>isAlwaysOnTop]
        US[uiStore<br/>fontSize, theme]
        CS[clipboardStore<br/>clipboard data]
    end

    subgraph Components
        App[App.tsx]
        Nav[NavigationBar]
        VM[VirtualizedMarkdown]
        TB[TabBar]
        BB[BookmarkBar]
    end

    WS -->|useWindowStore| Nav
    US -->|useUIStore| App
    US -->|useUIStore| VM
    CS -->|useClipboardStore| App

    App -->|initWindowStore| WS
    App -->|applyCSSVariable| US
    Nav -->|toggleAlwaysOnTop| WS
    Nav -->|increaseFontSize| US
```

## MD-12. 安全防护流程

```mermaid
flowchart TD
    A[用户点击链接] --> B{链接类型判断}
    B -->|锚点 #xxx| C[页内滚动跳转]
    B -->|http/https| D[shell.openExternal<br/>系统浏览器打开]
    B -->|.md 文件链接| E[IPC 跳转到对应文件]
    B -->|file:// 协议| F[❌ 阻止]
    B -->|javascript:| G[❌ 阻止]
    B -->|其他协议| H[❌ 阻止默认行为]

    I[will-navigate 事件] --> J{目标 URL 检查}
    J -->|同源| K[允许导航]
    J -->|非同源| L[❌ 拦截<br/>防止 BrowserWindow 被劫持]

    M[DOMPurify] --> N[净化 HTML 输出]
    N --> O[移除 script/iframe/on* 事件]
```

## MD-13. 快捷键系统思维导图

```mermaid
mindmap
  root((MD Viewer 快捷键))
    文件操作
      Cmd+N 新建窗口
      Cmd+O 打开文件
      Cmd+W 关闭标签
    视图控制
      Cmd+加号 放大字体
      Cmd+减号 缩小字体
      Cmd+0 重置字体
      Cmd+Option+T 窗口置顶
      Cmd+F11 全屏查看
    搜索
      Cmd+Shift+F 页面搜索
      Cmd+G 下一个匹配
      Cmd+Shift+G 上一个匹配
    导出
      Cmd+P 打印/PDF
      Cmd+Shift+E 导出HTML
```

## MD-14. 多窗口架构 C4 图

```mermaid
C4Context
    title MD Viewer 多窗口架构
    Person(user, "用户", "使用 MD Viewer 的开发者")
    System(mainWindow, "主窗口", "BrowserWindow #1")
    System(subWindow, "子窗口", "BrowserWindow #2 (Cmd+N)")
    System(mainProcess, "Main Process", "Electron 主进程")
    SystemDb(appData, "AppData", "书签/设置/最近文件")
    System_Ext(fs, "文件系统", "本地 .md 文件")
    System_Ext(plantuml, "PlantUML Server", "远程渲染服务")

    Rel(user, mainWindow, "操作")
    Rel(user, subWindow, "操作")
    Rel(mainWindow, mainProcess, "IPC")
    Rel(subWindow, mainProcess, "IPC")
    Rel(mainProcess, appData, "读写")
    Rel(mainProcess, fs, "读取文件")
    Rel(mainWindow, plantuml, "HTTP")
    Rel(subWindow, plantuml, "HTTP")
```

## MD-15. 右键菜单系统流程

```mermaid
flowchart LR
    subgraph 预览区右键
        A1[📑 添加书签]
        A2[🔍 搜索]
        A3[📤 导出 HTML]
        A4[🖨️ 打印]
        A5[🔠 字体大小]
        A6[📋 复制]
    end

    subgraph 文件树右键
        B1[📂 在 Finder 中显示]
        B2[📑 添加到书签]
        B3[📋 复制路径]
        B4[📤 导出]
        B5[✏️ 重命名]
        B6[🗑️ 删除]
    end

    subgraph 书签右键
        C1[📂 在 Finder 中显示]
        C2[🗑️ 从书签移除]
        C3[📋 复制路径]
    end

    subgraph 最近文件右键
        D1[↔️ 分屏打开]
        D2[🗑️ 从历史移除]
    end
```
