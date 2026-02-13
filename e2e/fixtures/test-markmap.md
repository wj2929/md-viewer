# Markmap 思维导图测试

## 1. 基础思维导图

```markmap
# 水果分类
## 热带水果
- 芒果
- 菠萝
- 香蕉
- 椰子
## 温带水果
- 苹果
- 梨
- 桃子
- 葡萄
## 浆果
- 草莓
- 蓝莓
- 树莓
```

## 2. MD Viewer 全功能思维导图

```markmap
# MD Viewer 功能全景
## 渲染器
### Mermaid
- 流程图
- 时序图
- 类图
- 状态图
- 甘特图
- 饼图
- ER 图
- Git 图
- 思维导图
- C4 架构图
- 时间线
### ECharts
- 折线图
- 柱状图
- 饼图
- 散点图
- 雷达图
- 热力图
- 树图
- 桑基图
### Markmap ✨
- 思维导图
- 交互式缩放
- 折叠/展开
### Graphviz ✨
- 有向图 (digraph)
- 无向图 (graph)
- 子图 (subgraph)
- 记录节点 (record)
### Infographic
- 236 种模板
- AntV 驱动
## 导出
### HTML
- 所见即所得
- 内联 SVG
- KaTeX CDN 降级
### PDF
- A4 分页
- 打印优化
### Word (DOCX)
- Pandoc 优先
- docx 库回退
## 编辑体验
### 实时预览
- 文件监听 (chokidar)
- 300ms 防抖
### 分屏
- 递归分屏
- 水平/垂直
- 最大深度 4
### 搜索
- 模糊搜索 (Fuse.js)
- 全文搜索 (mark.js)
- Cmd+Shift+F
## 安全
### DOMPurify
- 标签白名单
- 属性白名单
- CSS 白名单
### CSP
- script-src 'self'
- wasm-unsafe-eval
### 路径校验
- allowedBasePath
- 路径遍历防护
## 跨平台
### macOS
- 原生标题栏
- Cmd 快捷键
### Windows
- 自定义标题栏
- Ctrl 快捷键
### Linux
- AppImage
- deb
```

## 3. 前端技术栈全景

```markmap
# 2026 前端技术栈
## 框架
### React 19
- Server Components
- Actions
- use() Hook
- Concurrent Rendering
- Suspense 改进
- Compiler (React Forget)
### Vue 3.5
- Composition API
- Pinia 状态管理
- Vapor Mode
- defineModel
- Teleport 增强
### Svelte 5
- Runes ($state, $derived)
- Signals 响应式
- 编译时优化
- 零运行时开销
### Angular 19
- Signals
- Standalone Components
- Deferrable Views
- SSR 改进
### Solid.js
- 细粒度响应式
- 无虚拟 DOM
- 编译时优化
## 构建工具
### Vite 7
- Rolldown (Rust)
- HMR 极速
- ESBuild 预构建
- 插件生态
### Turbopack
- Rust 编写
- 增量编译
- Webpack 兼容
### Rspack
- Rust 编写
- Webpack 兼容
- 字节跳动出品
### Farm
- Rust 编写
- 超快编译
- 懒编译
## 语言
### TypeScript 5.9
- Decorators (Stage 3)
- satisfies 操作符
- const 类型参数
- 模板字面量类型
- 条件类型推断
### JavaScript
- ES2025
- Temporal API
- Record & Tuple
- Pattern Matching
- Pipeline Operator
## 样式方案
### CSS 原生
- Container Queries
- :has() 选择器
- Nesting
- Cascade Layers
- View Transitions
### Tailwind CSS 4
- Oxide 引擎
- 零配置
- CSS-first
### CSS-in-JS
- Panda CSS
- Vanilla Extract
- StyleX (Meta)
## 状态管理
### Zustand
- 极简 API
- 无 Provider
- 中间件
### Jotai
- 原子化
- 按需渲染
### Redux Toolkit
- createSlice
- RTK Query
### TanStack Query
- 服务端状态
- 缓存管理
- 乐观更新
## 测试
### Vitest
- Vite 原生
- 兼容 Jest
- 浏览器模式
### Playwright
- 跨浏览器
- 自动等待
- Trace Viewer
### Testing Library
- 用户视角
- 无实现细节
## 部署
### Vercel
### Netlify
### Cloudflare Pages
### AWS Amplify
```

## 4. 软件架构设计模式

```markmap
# 软件架构模式
## 单体架构
- 简单部署
- 适合小团队
- 扩展性差
## 微服务架构
### 服务拆分
- 按业务域
- 按团队
- 按数据
### 通信方式
- REST API
- gRPC
- 消息队列
  - RabbitMQ
  - Kafka
  - Redis Streams
### 服务治理
- 服务发现
  - Consul
  - Eureka
  - Nacos
- 负载均衡
  - Nginx
  - Envoy
  - HAProxy
- 熔断降级
  - Hystrix
  - Sentinel
  - Resilience4j
- 链路追踪
  - Jaeger
  - Zipkin
  - SkyWalking
### 部署
- Docker
- Kubernetes
- Service Mesh (Istio)
## 事件驱动架构
### CQRS
- 命令端
- 查询端
- 事件存储
### Event Sourcing
- 事件日志
- 状态重建
- 时间旅行
### Saga 模式
- 编排式
- 协调式
## Serverless
### FaaS
- AWS Lambda
- Azure Functions
- Cloudflare Workers
### BaaS
- Firebase
- Supabase
- Appwrite
## 边缘计算
### CDN
### Edge Functions
### IoT Gateway
```

## 5. 深层嵌套（6 级）

```markmap
# 计算机科学
## 理论基础
### 算法
#### 排序算法
##### 比较排序
###### 快速排序
###### 归并排序
###### 堆排序
###### 插入排序
###### 选择排序
###### 冒泡排序
###### 希尔排序
###### Tim排序
##### 非比较排序
###### 计数排序
###### 基数排序
###### 桶排序
#### 搜索算法
##### 线性搜索
##### 二分搜索
##### 哈希搜索
##### 深度优先搜索 (DFS)
##### 广度优先搜索 (BFS)
##### A* 搜索
##### Dijkstra
#### 图算法
##### 最短路径
###### Dijkstra
###### Bellman-Ford
###### Floyd-Warshall
##### 最小生成树
###### Kruskal
###### Prim
##### 拓扑排序
##### 强连通分量
###### Tarjan
###### Kosaraju
#### 动态规划
##### 背包问题
##### 最长公共子序列
##### 编辑距离
##### 矩阵链乘法
### 数据结构
#### 线性结构
##### 数组
##### 链表
###### 单链表
###### 双链表
###### 循环链表
##### 栈
##### 队列
###### 普通队列
###### 双端队列
###### 优先队列
#### 树形结构
##### 二叉树
###### 二叉搜索树
###### AVL 树
###### 红黑树
###### B 树
###### B+ 树
##### 堆
###### 最大堆
###### 最小堆
###### 斐波那契堆
##### Trie 树
##### 线段树
#### 图结构
##### 邻接矩阵
##### 邻接表
##### 十字链表
### 计算理论
#### 自动机
##### 有限自动机 (DFA/NFA)
##### 下推自动机
##### 图灵机
#### 复杂度理论
##### P 问题
##### NP 问题
##### NP 完全
##### NP 困难
## 应用领域
### 人工智能
#### 机器学习
##### 监督学习
##### 无监督学习
##### 强化学习
#### 深度学习
##### CNN
##### RNN/LSTM
##### Transformer
##### GAN
#### 自然语言处理
##### 分词
##### 命名实体识别
##### 机器翻译
##### 大语言模型
### 数据库
#### 关系型
##### MySQL
##### PostgreSQL
##### Oracle
#### NoSQL
##### MongoDB
##### Redis
##### Cassandra
##### Neo4j
### 网络
#### 协议
##### TCP/IP
##### HTTP/HTTPS
##### WebSocket
##### gRPC
#### 安全
##### TLS/SSL
##### OAuth 2.0
##### JWT
```

## 6. 项目管理全流程

```markmap
# 敏捷项目管理
## 产品规划
### 愿景
- 产品定位
- 目标用户
- 核心价值
### 路线图
- 季度目标
- 里程碑
- 版本规划
### 需求管理
- 用户故事
- 验收标准
- 优先级排序 (MoSCoW)
## Sprint 流程
### 计划会议
- 容量评估
- 任务拆分
- 故事点估算
### 每日站会
- 昨天完成
- 今天计划
- 阻塞问题
### 评审会议
- 功能演示
- 反馈收集
- 验收确认
### 回顾会议
- 做得好的
- 需改进的
- 行动项
## 工程实践
### 代码管理
- Git Flow
- Trunk Based
- Feature Flags
### CI/CD
- 自动构建
- 自动测试
- 自动部署
- 蓝绿部署
- 金丝雀发布
### 代码质量
- Code Review
- 静态分析
- 单元测试覆盖率 ≥80%
- E2E 测试
### 监控告警
- APM
- 日志聚合
- 错误追踪
- 性能指标
## 团队协作
### 角色
- Product Owner
- Scrum Master
- 开发团队
- QA 团队
- UX 设计师
### 工具
- Jira / Linear
- Confluence / Notion
- Slack / 飞书
- Figma
- GitHub / GitLab
```

## 7. 中文特殊字符

```markmap
# 中文内容测试
## 标点符号
- 逗号，句号。
- 问号？感叹号！
- 引号"双引号"
- 引号'单引号'
- 括号（圆括号）
- 括号【方括号】
- 破折号——
- 省略号……
## Emoji 表情
- 🎉 庆祝
- 🚀 火箭
- ⚡ 闪电
- 🔥 火焰
- ✅ 完成
- ❌ 失败
- ⚠️ 警告
- 💡 灵感
- 🎯 目标
- 🏆 冠军
## 数学符号
- α β γ δ ε
- ∑ ∏ ∫ ∂
- ≈ ≠ ≤ ≥
- ∞ √ π
- → ← ↑ ↓
## 混合语言
- English 英文
- 日本語 にほんご
- 한국어 韩语
- Русский 俄语
- العربية 阿拉伯语
```

## 8. 长文本节点

```markmap
# 软件开发生命周期 (SDLC)
## 需求分析阶段：与利益相关者沟通，收集和分析业务需求，编写需求规格说明书
- 功能需求：系统必须实现的功能特性，包括用户交互、数据处理、业务逻辑等
- 非功能需求：性能、安全性、可用性、可维护性、可扩展性等质量属性
- 约束条件：技术限制、预算限制、时间限制、法规合规要求等
## 设计阶段：将需求转化为技术方案，包括架构设计、数据库设计、接口设计、UI/UX 设计
- 高层设计 (HLD)：系统架构、模块划分、技术选型、部署方案
- 详细设计 (LLD)：类图、时序图、数据库表结构、API 接口文档
## 编码实现阶段：按照设计文档进行编码，遵循编码规范和最佳实践
- 前端开发：React/Vue/Angular 组件开发、状态管理、路由配置
- 后端开发：API 开发、业务逻辑实现、数据库操作、中间件集成
- 移动端开发：iOS (Swift)、Android (Kotlin)、跨平台 (Flutter/RN)
## 测试阶段：确保软件质量，发现和修复缺陷
- 单元测试：Jest/Vitest/JUnit，覆盖率目标 ≥80%
- 集成测试：API 测试、服务间调用测试
- E2E 测试：Playwright/Cypress，模拟真实用户操作
- 性能测试：JMeter/k6，压力测试、负载测试
- 安全测试：OWASP Top 10、渗透测试、代码审计
## 部署与运维阶段：将软件部署到生产环境，持续监控和维护
- 持续集成/持续部署 (CI/CD)
- 容器化部署 (Docker + Kubernetes)
- 监控告警 (Prometheus + Grafana)
- 日志管理 (ELK Stack)
```

## 9. 单根节点

```markmap
# 只有一个根节点，没有任何子节点
```

## 10. 两级扁平结构

```markmap
# 编程语言
- JavaScript
- TypeScript
- Python
- Go
- Rust
- Java
- C++
- C#
- Swift
- Kotlin
- Ruby
- PHP
- Dart
- Elixir
- Haskell
- Scala
- Clojure
- Lua
- R
- Julia
```

## 11. 极度不平衡的树

```markmap
# 不平衡树
## 左侧深度嵌套
### 第三层
#### 第四层
##### 第五层
###### 第六层
- 最深的叶子节点 A
- 最深的叶子节点 B
- 最深的叶子节点 C
## 右侧只有一层
- 叶子 1
- 叶子 2
```

## 12. 大量同级节点

```markmap
# 世界国家
## 亚洲
- 中国
- 日本
- 韩国
- 印度
- 泰国
- 越南
- 新加坡
- 马来西亚
- 印度尼西亚
- 菲律宾
- 缅甸
- 柬埔寨
- 老挝
- 蒙古
- 尼泊尔
- 斯里兰卡
- 巴基斯坦
- 孟加拉国
- 以色列
- 土耳其
## 欧洲
- 英国
- 法国
- 德国
- 意大利
- 西班牙
- 葡萄牙
- 荷兰
- 比利时
- 瑞士
- 奥地利
- 瑞典
- 挪威
- 丹麦
- 芬兰
- 波兰
- 捷克
- 希腊
- 爱尔兰
- 冰岛
- 俄罗斯
## 北美洲
- 美国
- 加拿大
- 墨西哥
## 南美洲
- 巴西
- 阿根廷
- 智利
- 哥伦比亚
- 秘鲁
## 非洲
- 南非
- 埃及
- 尼日利亚
- 肯尼亚
- 摩洛哥
- 埃塞俄比亚
## 大洋洲
- 澳大利亚
- 新西兰
```

## 13. Markdown 格式混合

```markmap
# Markdown 格式
## **粗体文本**
- **这是粗体**
- *这是斜体*
- ~~这是删除线~~
## `代码片段`
- `console.log()`
- `npm install`
- `git commit -m "msg"`
## 链接
- [GitHub](https://github.com)
- [MDN](https://developer.mozilla.org)
## 混合格式
- **粗体** 和 *斜体* 混合
- `代码` 和 **粗体** 混合
- ~~删除~~ 和 *斜体* 混合
```

## 14. 数据库设计思维导图

```markmap
# 电商数据库设计
## 用户模块
### users 用户表
- id (PK, BIGINT)
- username (VARCHAR 50, UNIQUE)
- email (VARCHAR 100, UNIQUE)
- password_hash (VARCHAR 255)
- phone (VARCHAR 20)
- avatar_url (VARCHAR 500)
- status (ENUM: active/inactive/banned)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
### user_addresses 地址表
- id (PK)
- user_id (FK → users)
- province (VARCHAR 50)
- city (VARCHAR 50)
- district (VARCHAR 50)
- detail (VARCHAR 200)
- is_default (BOOLEAN)
### user_profiles 用户画像
- user_id (FK → users)
- gender (ENUM)
- birthday (DATE)
- vip_level (INT)
- total_spent (DECIMAL)
## 商品模块
### products 商品表
- id (PK)
- name (VARCHAR 200)
- description (TEXT)
- category_id (FK → categories)
- brand_id (FK → brands)
- price (DECIMAL 10,2)
- stock (INT)
- status (ENUM: draft/active/sold_out)
- images (JSON)
### categories 分类表
- id (PK)
- parent_id (FK → self)
- name (VARCHAR 100)
- level (INT)
- sort_order (INT)
### product_skus SKU 表
- id (PK)
- product_id (FK → products)
- spec_json (JSON)
- price (DECIMAL)
- stock (INT)
- sku_code (VARCHAR 50)
## 订单模块
### orders 订单表
- id (PK)
- order_no (VARCHAR 32, UNIQUE)
- user_id (FK → users)
- total_amount (DECIMAL)
- pay_amount (DECIMAL)
- status (ENUM: pending/paid/shipped/completed/cancelled)
- address_snapshot (JSON)
- created_at (TIMESTAMP)
### order_items 订单项
- id (PK)
- order_id (FK → orders)
- product_id (FK → products)
- sku_id (FK → product_skus)
- quantity (INT)
- unit_price (DECIMAL)
### payments 支付记录
- id (PK)
- order_id (FK → orders)
- payment_method (ENUM: alipay/wechat/card)
- amount (DECIMAL)
- status (ENUM: pending/success/failed/refunded)
- transaction_id (VARCHAR 64)
## 索引策略
### 主键索引
- 所有表的 id 字段
### 唯一索引
- users.username
- users.email
- orders.order_no
### 普通索引
- orders.user_id
- orders.status
- products.category_id
- order_items.order_id
### 复合索引
- orders (user_id, status, created_at)
- products (category_id, status, price)
```

## 15. 与普通 Markdown 内容混排

这是一段普通的 Markdown 文本，下面是一个思维导图：

```markmap
# 混排测试
## 上面有文字
- 节点 A
- 节点 B
## 下面也有文字
- 节点 C
- 节点 D
```

这是思维导图后面的文字。下面是一个代码块，不应该被 markmap 渲染：

```javascript
const tree = {
  root: 'MD Viewer',
  children: ['Mermaid', 'ECharts', 'Markmap', 'Graphviz']
}
```

再来一个思维导图：

```markmap
# 第二个思维导图
## 验证多个思维导图共存
- 思维导图 1 在上面
- 思维导图 2 在这里
## 应该都能正常渲染
- 互不干扰
- 独立交互
```

最后是一段总结文字。

## 16. 空内容（错误测试）

以下是空内容，应该显示错误提示：

```markmap

```

## 17. 只有空白字符（错误测试）

```markmap

```

## 18. 超长单行节点

```markmap
# 这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的根节点标题
## 这也是一个很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的二级标题
- 这是一个很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的叶子节点
```
