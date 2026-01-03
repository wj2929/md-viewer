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

## 需求图

```mermaid
requirementDiagram
    requirement 用户登录 {
        id: REQ-001
        text: 用户必须能够登录系统
        risk: low
        verifymethod: test
    }
    element 登录页面 {
        type: ui
    }
    登录页面 - satisfies -> 用户登录
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

## 象限图

```mermaid
quadrantChart
    title 技术选型评估
    x-axis 低复杂度 --> 高复杂度
    y-axis 低价值 --> 高价值
    quadrant-1 优先实现
    quadrant-2 计划实现
    quadrant-3 可能放弃
    quadrant-4 需要评估
    TypeScript: [0.8, 0.9]
    React: [0.7, 0.85]
    Electron: [0.6, 0.7]
    Vite: [0.3, 0.8]
```

## XY 图表

```mermaid
xychart-beta
    title "月度销售额"
    x-axis [一月, 二月, 三月, 四月, 五月, 六月]
    y-axis "销售额(万)" 0 --> 100
    bar [30, 45, 60, 55, 70, 85]
    line [30, 45, 60, 55, 70, 85]
```

## Sankey 图

```mermaid
sankey-beta
    源A,目标X,5
    源A,目标Y,3
    源B,目标X,2
    源B,目标Y,4
    目标X,最终,7
    目标Y,最终,7
```

## 框图（Block）

```mermaid
block-beta
    columns 3
    a["前端"]:1
    b["API"]:1
    c["数据库"]:1
    a --> b --> c
```

## 错误语法测试

以下是故意的错误语法，应该保留原始代码显示：

```mermaid
这是无效的 Mermaid 语法
应该显示原始代码而不是崩溃
```
