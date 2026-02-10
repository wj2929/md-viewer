# Infographic 信息图完整测试

> 覆盖 38 个模板类别，236 个模板中的代表性模板

---

## 一、列表类（List）

### 1. 横向列表 - 箭头

```infographic
infographic list-row-simple-horizontal-arrow
data
  title 敏捷开发流程
  lists
    - label 需求收集
      desc 用户调研与需求分析
    - label Sprint 规划
      desc 任务拆分与排期
    - label 迭代开发
      desc 编码、测试、集成
    - label 评审发布
      desc Code Review 与上线
    - label 回顾改进
      desc 复盘与流程优化
```

### 2. 横向列表 - 圆形进度

```infographic
infographic list-row-circular-progress
data
  title 季度 OKR 完成度
  lists
    - label 营收目标
      value 85
      desc 完成 850 万 / 目标 1000 万
    - label 用户增长
      value 120
      desc 新增 12 万用户，超额完成
    - label 产品迭代
      value 70
      desc 完成 7/10 个核心功能
    - label 团队建设
      value 90
      desc 招聘 9/10 人到岗
```

### 3. 横向列表 - 紧凑卡片

```infographic
infographic list-row-horizontal-icon-arrow
data
  title 技术选型对比
  lists
    - label React
      desc 生态丰富，社区活跃，适合大型项目
    - label Vue
      desc 上手简单，文档友好，适合中小项目
    - label Svelte
      desc 编译时框架，零运行时开销
    - label Solid
      desc 细粒度响应式，极致性能
```

### 4. 纵向列表 - 待办清单

```infographic
infographic list-column-done-list
data
  title 上线检查清单
  lists
    - label 代码审查完成
      desc 所有 PR 已合并
    - label 单元测试通过
      desc 覆盖率 > 80%
    - label 集成测试通过
      desc E2E 全部绿灯
    - label 性能测试达标
      desc P99 < 200ms
    - label 安全扫描通过
      desc 无高危漏洞
    - label 文档已更新
      desc API 文档与变更日志
```

### 5. 纵向列表 - 紧凑卡片

```infographic
infographic list-grid-compact-card
data
  title 团队成员
  lists
    - label 张三
      desc 前端负责人，React 专家
    - label 李四
      desc 后端架构师，Go/Java
    - label 王五
      desc DevOps 工程师，K8s
    - label 赵六
      desc 产品经理，B 端经验
    - label 孙七
      desc UI 设计师，Figma
```

### 6. 网格卡片 - 徽章

```infographic
infographic list-grid-badge-card
data
  title 核心功能矩阵
  lists
    - label Markdown 渲染
      desc GFM / KaTeX / Mermaid
    - label 代码高亮
      desc 20+ 语言支持
    - label 信息图
      desc AntV Infographic
    - label ECharts 图表
      desc 交互式数据可视化
    - label 导出功能
      desc HTML / PDF / DOCX
    - label 主题切换
      desc 亮色 / 暗色模式
    - label 全屏阅读
      desc 沉浸式体验
    - label 书签管理
      desc 快速定位内容
    - label 分屏对比
      desc 多文件并排查看
```

### 7. 网格卡片 - 简洁

```infographic
infographic list-grid-simple
data
  title 编程语言排行
  lists
    - label Python
      value 1
      desc 数据科学与 AI
    - label JavaScript
      value 2
      desc Web 全栈开发
    - label TypeScript
      value 3
      desc 类型安全的 JS
    - label Java
      value 4
      desc 企业级应用
    - label Go
      value 5
      desc 云原生与微服务
    - label Rust
      value 6
      desc 系统级编程
```

### 8. 金字塔

```infographic
infographic list-pyramid-rounded-rect-node
data
  title 马斯洛需求层次
  lists
    - label 自我实现
      desc 创造力、问题解决、道德
    - label 尊重需求
      desc 自信、成就、被他人尊重
    - label 社交需求
      desc 友情、爱情、归属感
    - label 安全需求
      desc 人身安全、健康、财产
    - label 生理需求
      desc 食物、水、睡眠、呼吸
```

### 9. 扇形列表

```infographic
infographic list-sector-simple
data
  title 时间分配
  lists
    - label 编码
      value 40
      desc 核心开发工作
    - label 会议
      value 20
      desc 站会、评审、规划
    - label 学习
      value 15
      desc 技术调研与阅读
    - label 代码审查
      value 15
      desc Review 他人代码
    - label 其他
      value 10
      desc 文档、沟通、杂务
```

### 10. 锯齿列表 - 向上

```infographic
infographic list-zigzag-up-compact-card
data
  title 能力成长路径
  lists
    - label 初级工程师
      desc 掌握基础技能，完成指定任务
    - label 中级工程师
      desc 独立负责模块，参与技术方案
    - label 高级工程师
      desc 主导技术选型，解决复杂问题
    - label 技术专家
      desc 跨团队影响力，推动技术演进
    - label 架构师
      desc 系统级设计，技术战略规划
```

### 11. 锯齿列表 - 向下

```infographic
infographic list-zigzag-down-simple
data
  title 问题排查流程
  lists
    - label 收集信息
      desc 日志、监控、用户反馈
    - label 复现问题
      desc 确定触发条件
    - label 定位根因
      desc 二分法缩小范围
    - label 修复验证
      desc 编写修复与测试
    - label 复盘总结
      desc 更新文档与告警
```

---

## 二、序列类（Sequence）

### 12. 时间线 - 简洁

```infographic
infographic sequence-timeline-simple
data
  title 产品里程碑
  sequences
    - label 2024 Q1
      desc 项目启动，完成技术调研与原型设计
    - label 2024 Q2
      desc 核心功能开发完成，内部 Alpha 测试
    - label 2024 Q3
      desc 公测上线，收集用户反馈
    - label 2024 Q4
      desc 正式发布 v1.0，商业化运营
    - label 2025 Q1
      desc 国际化版本，多语言支持
```

### 13. 时间线 - 待办清单

```infographic
infographic sequence-timeline-done-list
data
  title 项目进度
  sequences
    - label 第 1 周
      desc 需求评审与技术方案确认
    - label 第 2-3 周
      desc 后端 API 开发与数据库设计
    - label 第 4-5 周
      desc 前端页面开发与联调
    - label 第 6 周
      desc 测试与 Bug 修复
    - label 第 7 周
      desc 上线部署与监控配置
```

### 14. 步骤 - 徽章卡片

```infographic
infographic sequence-steps-badge-card
data
  title CI/CD 流水线
  sequences
    - label 代码提交
      desc Git Push 触发 Webhook
    - label 构建编译
      desc Docker Build + 依赖安装
    - label 自动测试
      desc 单元测试 + 集成测试
    - label 安全扫描
      desc SAST + 依赖漏洞检查
    - label 部署上线
      desc K8s Rolling Update
    - label 健康检查
      desc 监控告警确认
```

### 15. 漏斗图

```infographic
infographic sequence-funnel-simple
data
  title 电商转化漏斗
  sequences
    - label 页面浏览
      value 100000
    - label 商品点击
      value 35000
    - label 加入购物车
      value 12000
    - label 提交订单
      value 5000
    - label 支付成功
      value 3800
    - label 确认收货
      value 3500
```

### 16. 环形序列

```infographic
infographic sequence-circular-underline-text
data
  title DevOps 生命周期
  sequences
    - label Plan
      desc 需求规划
    - label Code
      desc 编码开发
    - label Build
      desc 构建打包
    - label Test
      desc 自动化测试
    - label Release
      desc 版本发布
    - label Deploy
      desc 部署上线
    - label Operate
      desc 运维监控
    - label Monitor
      desc 反馈优化
```

### 17. 上升阶梯

```infographic
infographic sequence-ascending-steps
data
  title 数据处理管道
  sequences
    - label 数据采集
      desc Kafka / Flume
    - label 数据清洗
      desc Spark ETL
    - label 数据存储
      desc HDFS / Hive
    - label 数据分析
      desc Presto / ClickHouse
    - label 数据可视化
      desc Grafana / Superset
```

### 18. 圆柱体 3D

```infographic
infographic sequence-cylinders-3d-simple
data
  title 存储架构层次
  sequences
    - label L1 Cache
      desc CPU 缓存 ~1ns
    - label L2 Cache
      desc 二级缓存 ~10ns
    - label Memory
      desc 内存 ~100ns
    - label SSD
      desc 固态硬盘 ~100μs
    - label HDD
      desc 机械硬盘 ~10ms
```

### 19. 蛇形步骤

```infographic
infographic sequence-snake-steps-compact-card
data
  title 用户注册流程
  sequences
    - label 输入手机号
      desc 发送验证码
    - label 验证手机
      desc 输入 6 位验证码
    - label 设置密码
      desc 8 位以上，含大小写
    - label 填写资料
      desc 昵称、头像、简介
    - label 实名认证
      desc 身份证 + 人脸识别
    - label 注册成功
      desc 发放新人礼包
```

### 20. 彩色蛇形

```infographic
infographic sequence-color-snake-steps-horizontal-icon-line
data
  title 设计思维流程
  sequences
    - label Empathize
      desc 同理心，理解用户
    - label Define
      desc 定义核心问题
    - label Ideate
      desc 头脑风暴
    - label Prototype
      desc 快速原型
    - label Test
      desc 用户测试验证
```

### 21. 金字塔序列

```infographic
infographic sequence-pyramid-simple
data
  title 学习金字塔
  sequences
    - label 教授他人
      value 90
      desc 最高效的学习方式
    - label 实践练习
      value 75
      desc 动手操作
    - label 小组讨论
      value 50
      desc 交流碰撞
    - label 演示观摩
      value 30
      desc 看别人做
    - label 阅读
      value 10
      desc 被动接收
```

### 22. 路线图

```infographic
infographic sequence-roadmap-vertical-plain-text
data
  title 2025 技术路线图
  sequences
    - label Q1 基础设施
      desc 微服务拆分、CI/CD 流水线
    - label Q2 核心能力
      desc AI 推理引擎、实时计算平台
    - label Q3 产品化
      desc 低代码平台、数据中台
    - label Q4 商业化
      desc SaaS 版本、多租户架构
```

### 23. 横向锯齿

```infographic
infographic sequence-horizontal-zigzag-simple-illus
data
  title 软件发布流程
  sequences
    - label 开发环境
      desc 本地开发与调试
    - label 测试环境
      desc 功能测试与回归
    - label 预发布环境
      desc 灰度验证
    - label 生产环境
      desc 全量发布
```

### 24. 锯齿步骤

```infographic
infographic sequence-zigzag-steps-underline-text
data
  title 数据分析流程
  sequences
    - label 提出问题
      desc 明确分析目标
    - label 数据收集
      desc 多源数据整合
    - label 数据清洗
      desc 去重、补缺、标准化
    - label 探索分析
      desc 统计描述与可视化
    - label 建模预测
      desc 机器学习模型
    - label 结论报告
      desc 可视化呈现
```

### 25. 圆形箭头

```infographic
infographic sequence-circle-arrows-indexed-card
data
  title Scrum 迭代
  sequences
    - label 产品待办
      desc Product Backlog 梳理
    - label Sprint 规划
      desc 选取本迭代任务
    - label 每日站会
      desc 15 分钟同步进度
    - label Sprint 评审
      desc 演示交付成果
    - label Sprint 回顾
      desc 改进工作方式
```

### 26. 过滤网格

```infographic
infographic sequence-filter-mesh-underline-text
data
  title 简历筛选漏斗
  sequences
    - label 投递简历
      value 500
      desc 收到简历总数
    - label 初筛通过
      value 120
      desc HR 筛选
    - label 技术面试
      value 40
      desc 一面 + 二面
    - label 终面通过
      value 10
      desc 总监面试
    - label 发放 Offer
      value 6
      desc 最终录用
```

### 27. 山峰图

```infographic
infographic sequence-mountain-underline-text
data
  title 项目风险曲线
  sequences
    - label 启动期
      value 20
      desc 风险较低
    - label 规划期
      value 40
      desc 风险上升
    - label 执行期
      value 80
      desc 风险最高
    - label 收尾期
      value 30
      desc 风险下降
    - label 交付期
      value 10
      desc 风险最低
```

### 28. 楼梯 - 正面

```infographic
infographic sequence-stairs-front-pill-badge
data
  title 职级晋升
  sequences
    - label P5 初级
      desc 独立完成任务
    - label P6 中级
      desc 负责子模块
    - label P7 高级
      desc 负责核心系统
    - label P8 专家
      desc 跨团队技术影响
    - label P9 资深
      desc 公司级技术决策
```

---

## 三、比较类（Compare）

### 29. SWOT 分析

```infographic
infographic compare-swot
data
  title 创业项目 SWOT
  compares
    - label Strengths
      desc 核心技术壁垒高、团队执行力强、产品 PMF 验证通过
    - label Weaknesses
      desc 品牌知名度低、现金流紧张、销售团队不足
    - label Opportunities
      desc AI 行业爆发、政策扶持、海外市场空白
    - label Threats
      desc 大厂入局、人才竞争、监管不确定性
```

### 30. 象限图

```infographic
infographic compare-quadrant-quarter-simple-card
data
  title 技术债务优先级
  compares
    - label 紧急且重要
      desc 生产环境 Bug、安全漏洞、数据丢失风险
    - label 重要不紧急
      desc 架构重构、自动化测试、文档完善
    - label 紧急不重要
      desc 临时需求、非核心告警、格式调整
    - label 不紧急不重要
      desc 代码美化、过度优化、低频功能
```

### 31. 二元对比

```infographic
infographic compare-binary-horizontal-simple-fold
data
  title 单体 vs 微服务
  compares
    - label 单体架构
      desc 部署简单、调试方便、适合小团队、扩展性差
    - label 微服务架构
      desc 独立部署、技术多样、适合大团队、运维复杂
```

### 32. 层级对比

```infographic
infographic compare-hierarchy-left-right-circle-node-pill-badge
data
  title 前端 vs 后端
  compares
    - label 前端开发
      children
        - label HTML/CSS
        - label JavaScript
        - label React/Vue
        - label 浏览器 API
    - label 后端开发
      children
        - label 数据库
        - label API 设计
        - label 服务器运维
        - label 安全认证
```

---

## 四、层级类（Hierarchy）

### 33. 思维导图 - 分支渐变

```infographic
infographic hierarchy-mindmap-branch-gradient-rounded-rect
data
  root
    label 系统架构
    children
      - label 前端
        children
          - label React 18
          - label Next.js
          - label TailwindCSS
      - label 后端
        children
          - label Go Fiber
          - label gRPC
          - label PostgreSQL
      - label 基础设施
        children
          - label Kubernetes
          - label Terraform
          - label Prometheus
      - label AI 服务
        children
          - label LLM API
          - label RAG Pipeline
          - label Vector DB
```

### 34. 组织结构图

```infographic
infographic hierarchy-structure
data
  root
    label CEO
    children
      - label CTO
        children
          - label 前端团队
          - label 后端团队
          - label 数据团队
      - label CPO
        children
          - label 产品设计
          - label 用户研究
      - label CFO
        children
          - label 财务部
          - label 法务部
```

### 35. 镜像组织结构

```infographic
infographic hierarchy-structure-mirror
data
  root
    label 技术总监
    children
      - label 平台组
        children
          - label 基础架构
          - label 中间件
          - label DevOps
      - label 业务组
        children
          - label 交易系统
          - label 用户系统
          - label 营销系统
```

### 36. 树形图 - 科技风

```infographic
infographic hierarchy-tree-tech-style-capsule-item
data
  root
    label Linux 文件系统
    children
      - label /etc
        children
          - label nginx.conf
          - label hosts
          - label crontab
      - label /var
        children
          - label log
          - label www
          - label lib
      - label /home
        children
          - label user
          - label deploy
```

---

## 五、关系类（Relation）

### 37. DAG 流程图 - 上下

```infographic
infographic relation-dagre-flow-tb-simple-circle-node
data
  nodes
    - id req
      label 用户请求
    - id gateway
      label API 网关
    - id auth
      label 认证服务
    - id biz
      label 业务服务
    - id cache
      label Redis 缓存
    - id db
      label MySQL 数据库
    - id resp
      label 返回响应
  relations
    req --> gateway
    gateway --> auth
    auth --> biz
    biz --> cache
    biz --> db
    cache --> resp
    db --> resp
```

### 38. DAG 流程图 - 左右

```infographic
infographic relation-dagre-flow-lr-badge-card
data
  nodes
    - id input
      label 原始数据
    - id clean
      label 数据清洗
    - id feature
      label 特征工程
    - id train
      label 模型训练
    - id eval
      label 模型评估
    - id deploy
      label 模型部署
    - id monitor
      label 线上监控
  relations
    input --> clean
    clean --> feature
    feature --> train
    train --> eval
    eval --> deploy
    deploy --> monitor
    monitor --> feature
```

### 39. 环形关系

```infographic
infographic relation-circle-circular-progress
data
  title 微服务依赖
  nodes
    - id gateway
      label API Gateway
    - id user
      label User Service
    - id order
      label Order Service
    - id payment
      label Payment Service
    - id notify
      label Notification
  relations
    gateway --> user
    gateway --> order
    order --> payment
    payment --> notify
    notify --> user
```

---

## 六、图表类（Chart）

### 40. 饼图 - 纯文本

```infographic
infographic chart-pie-plain-text
data
  title 市场份额
  values
    - label Chrome
      value 65
    - label Safari
      value 18
    - label Firefox
      value 8
    - label Edge
      value 5
    - label 其他
      value 4
```

### 41. 饼图 - 环形

```infographic
infographic chart-pie-donut-plain-text
data
  title 收入构成
  values
    - label SaaS 订阅
      value 45
    - label 定制开发
      value 25
    - label 技术咨询
      value 15
    - label 培训服务
      value 10
    - label 其他
      value 5
```

### 42. 柱状图

```infographic
infographic chart-column-simple
data
  title 月度活跃用户（万）
  values
    - label 1月
      value 120
    - label 2月
      value 135
    - label 3月
      value 158
    - label 4月
      value 172
    - label 5月
      value 190
    - label 6月
      value 215
```

### 43. 条形图

```infographic
infographic chart-bar-plain-text
data
  title 框架 Star 数（K）
  values
    - label React
      value 220
    - label Vue
      value 210
    - label Angular
      value 95
    - label Svelte
      value 80
    - label Next.js
      value 125
```

### 44. 折线图

```infographic
infographic chart-line-plain-text
data
  title 服务器响应时间（ms）
  values
    - label 00:00
      value 45
    - label 04:00
      value 32
    - label 08:00
      value 120
    - label 12:00
      value 180
    - label 16:00
      value 150
    - label 20:00
      value 95
    - label 24:00
      value 50
```

### 45. 词云

```infographic
infographic chart-wordcloud-rotate
data
  title 技术热词 2025
  values
    - label AI Agent
      value 100
    - label LLM
      value 90
    - label RAG
      value 80
    - label Kubernetes
      value 70
    - label Rust
      value 65
    - label WebAssembly
      value 60
    - label Edge Computing
      value 55
    - label Serverless
      value 50
    - label GraphQL
      value 45
    - label Microservices
      value 40
    - label DevSecOps
      value 35
    - label Web3
      value 30
    - label Quantum
      value 25
    - label 5G
      value 20
```

---

## 七、主题与样式

### 46. 自定义主题 - 紫色

```infographic
infographic list-grid-candy-card-lite
theme
  colorPrimary #722ed1
  palette #722ed1,#eb2f96,#fa8c16,#52c41a
data
  title 紫色主题
  lists
    - label 策划
      desc 创意构思
    - label 设计
      desc 视觉呈现
    - label 开发
      desc 技术实现
    - label 测试
      desc 质量保障
```

### 47. 手绘风格（Rough）

```infographic
infographic sequence-snake-steps-pill-badge
theme
  stylize rough
data
  title 手绘风格步骤
  sequences
    - label 草图
      desc 纸笔勾勒想法
    - label 线框
      desc 低保真原型
    - label 视觉稿
      desc 高保真设计
    - label 交互稿
      desc 可点击原型
```

### 48. 暗色主题

```infographic
infographic list-grid-ribbon-card
theme
  colorBg #1a1a2e
  colorPrimary #e94560
  palette #e94560,#0f3460,#16213e,#533483
data
  title 暗色主题卡片
  lists
    - label 监控面板
      desc 实时数据大屏
    - label 告警中心
      desc 异常事件通知
    - label 日志分析
      desc ELK 日志检索
    - label 链路追踪
      desc 分布式调用链
```

---

## 八、边界测试

### 49. 最少数据（2 项）

```infographic
infographic compare-binary-horizontal-simple-vs
data
  title 二选一
  compares
    - label 选项 A
      desc 保守方案，风险低，收益稳定
    - label 选项 B
      desc 激进方案，风险高，潜在收益大
```

### 50. 较多数据（10 项）

```infographic
infographic sequence-timeline-plain-text
data
  title 十年技术演进
  sequences
    - label 2016
      desc jQuery 时代
    - label 2017
      desc React 崛起
    - label 2018
      desc TypeScript 普及
    - label 2019
      desc Hooks 革命
    - label 2020
      desc Jamstack 兴起
    - label 2021
      desc Next.js 全栈
    - label 2022
      desc Rust 工具链
    - label 2023
      desc AI 编程助手
    - label 2024
      desc AI Agent
    - label 2025
      desc AGI 探索
```

### 51. 纯标题无描述

```infographic
infographic list-grid-circular-progress
data
  title 快捷键
  lists
    - label Ctrl+C
      value 90
    - label Ctrl+V
      value 85
    - label Ctrl+Z
      value 80
    - label Ctrl+S
      value 95
    - label Ctrl+F
      value 70
    - label Ctrl+P
      value 60
```

### 52. 长文本描述

```infographic
infographic list-grid-progress-card
data
  title 架构决策记录
  lists
    - label ADR-001 选择 React
      desc 经过对 React、Vue、Angular 三个框架的全面评估，考虑到团队现有技术栈、社区生态、招聘难度和长期维护成本，最终决定采用 React 作为前端主框架
    - label ADR-002 选择 PostgreSQL
      desc 对比 MySQL、PostgreSQL、MongoDB 后，PostgreSQL 在 JSON 支持、全文搜索、扩展性和 ACID 合规方面表现最优，且与我们的 ORM 框架兼容性最好
    - label ADR-003 采用微服务
      desc 随着团队规模从 5 人扩展到 30 人，单体架构的开发效率和部署频率已成为瓶颈，决定按业务域拆分为微服务架构
```

---

## 九、进阶模板 - 复杂结构

### 53. 深层思维导图 - 层级渐变

```infographic
infographic hierarchy-mindmap-level-gradient-capsule-item
data
  root
    label 微服务架构全景
    children
      - label 服务治理
        children
          - label 服务注册
            children
              - label Nacos
              - label Consul
              - label Eureka
          - label 负载均衡
            children
              - label Nginx
              - label Envoy
          - label 熔断降级
            children
              - label Sentinel
              - label Hystrix
      - label 数据层
        children
          - label 关系型
            children
              - label MySQL
              - label PostgreSQL
          - label NoSQL
            children
              - label Redis
              - label MongoDB
              - label Elasticsearch
          - label 消息队列
            children
              - label Kafka
              - label RabbitMQ
      - label 可观测性
        children
          - label 日志
            children
              - label ELK Stack
              - label Loki
          - label 指标
            children
              - label Prometheus
              - label Grafana
          - label 链路追踪
            children
              - label Jaeger
              - label Zipkin
```

### 54. 思维导图 - 圆形进度

```infographic
infographic hierarchy-mindmap-branch-gradient-circle-progress
data
  root
    label 年度目标
    children
      - label 技术能力
        value 75
        children
          - label 系统设计
            value 80
          - label 算法
            value 60
          - label 新技术
            value 85
      - label 团队管理
        value 65
        children
          - label 招聘
            value 70
          - label 培训
            value 60
          - label 绩效
            value 65
      - label 业务理解
        value 50
        children
          - label 行业知识
            value 40
          - label 产品思维
            value 60
```

### 55. 树形图 - 虚线箭头

```infographic
infographic hierarchy-tree-dashed-arrow-capsule-item
data
  root
    label 编译器流水线
    children
      - label 前端
        children
          - label 词法分析 Lexer
          - label 语法分析 Parser
          - label 语义分析
      - label 中端
        children
          - label IR 生成
          - label 优化 Pass
          - label 死代码消除
      - label 后端
        children
          - label 指令选择
          - label 寄存器分配
          - label 代码生成
```

### 56. 树形图 - 曲线连接

```infographic
infographic hierarchy-tree-curved-line-capsule-item
data
  root
    label React 组件树
    children
      - label App
        children
          - label Router
            children
              - label HomePage
              - label Dashboard
              - label Settings
          - label AuthProvider
          - label ThemeProvider
```

### 57. 复杂 DAG 流程图 - 上下紧凑卡片

```infographic
infographic relation-dagre-flow-tb-compact-card
data
  nodes
    - id client
      label 客户端
      desc 浏览器/App
    - id cdn
      label CDN
      desc 静态资源加速
    - id gateway
      label API Gateway
      desc 路由/限流/鉴权
    - id user-svc
      label 用户服务
      desc 注册/登录/权限
    - id order-svc
      label 订单服务
      desc 下单/支付/退款
    - id product-svc
      label 商品服务
      desc 商品/库存/价格
    - id notify-svc
      label 通知服务
      desc 短信/邮件/推送
    - id mysql
      label MySQL
      desc 持久化存储
    - id redis
      label Redis
      desc 缓存/会话
    - id kafka
      label Kafka
      desc 异步消息
  relations
    client --> cdn
    client --> gateway
    gateway --> user-svc
    gateway --> order-svc
    gateway --> product-svc
    user-svc --> mysql
    user-svc --> redis
    order-svc --> mysql
    order-svc --> kafka
    product-svc --> mysql
    product-svc --> redis
    kafka --> notify-svc
```

### 58. DAG 流程图 - 左右紧凑卡片

```infographic
infographic relation-dagre-flow-lr-compact-card
data
  nodes
    - id src
      label 源代码
    - id lint
      label ESLint 检查
    - id test
      label 单元测试
    - id build
      label 构建打包
    - id scan
      label 安全扫描
    - id staging
      label Staging 部署
    - id e2e
      label E2E 测试
    - id prod
      label 生产部署
    - id monitor
      label 监控告警
  relations
    src --> lint
    lint --> test
    test --> build
    build --> scan
    scan --> staging
    staging --> e2e
    e2e --> prod
    prod --> monitor
```

### 59. 象限图 - 圆形

```infographic
infographic compare-quadrant-quarter-circular
data
  title 技术投资矩阵
  compares
    - label 高价值 · 低成本
      desc 自动化测试、代码规范、CI/CD 优化
    - label 高价值 · 高成本
      desc 微服务拆分、数据中台、AI 平台
    - label 低价值 · 低成本
      desc 代码美化、文档格式、工具升级
    - label 低价值 · 高成本
      desc 过度抽象、全量重写、自研中间件
```

### 60. 象限图 - 插图风格

```infographic
infographic compare-quadrant-simple-illus
data
  title 产品优先级矩阵
  compares
    - label 快速实现
      desc 用户反馈强烈、开发成本低的功能
    - label 战略投入
      desc 长期价值高、需要持续投入的功能
    - label 低优先级
      desc 需求不明确、价值待验证的功能
    - label 谨慎评估
      desc 技术难度大、收益不确定的功能
```

### 61. 饼图 - 紧凑卡片

```infographic
infographic chart-pie-compact-card
data
  title 云服务支出分布
  values
    - label 计算资源
      value 35
      desc EC2/ECS/Lambda
    - label 存储服务
      value 20
      desc S3/EBS/EFS
    - label 数据库
      value 25
      desc RDS/DynamoDB/ElastiCache
    - label 网络
      value 10
      desc CloudFront/VPC/ELB
    - label 其他
      value 10
      desc 监控/日志/安全
```

### 62. 饼图 - 环形紧凑卡片

```infographic
infographic chart-pie-donut-compact-card
data
  title 团队时间分配
  values
    - label 功能开发
      value 40
      desc 新功能迭代
    - label Bug 修复
      value 15
      desc 线上问题处理
    - label 技术债务
      value 20
      desc 重构与优化
    - label 基础设施
      value 15
      desc DevOps 与工具链
    - label 学习成长
      value 10
      desc 技术分享与培训
```

### 63. 饼图 - 药丸徽章

```infographic
infographic chart-pie-pill-badge
data
  title 编程语言使用占比
  values
    - label TypeScript
      value 45
    - label Go
      value 25
    - label Python
      value 15
    - label Rust
      value 10
    - label Shell
      value 5
```

### 64. 词云 - 普通

```infographic
infographic chart-wordcloud
data
  title 前端生态 2025
  values
    - label React
      value 100
    - label Next.js
      value 90
    - label TypeScript
      value 95
    - label Vite
      value 80
    - label TailwindCSS
      value 75
    - label Zustand
      value 60
    - label tRPC
      value 55
    - label Playwright
      value 50
    - label Bun
      value 45
    - label Astro
      value 40
    - label SolidJS
      value 35
    - label Qwik
      value 30
    - label Deno
      value 25
    - label HTMX
      value 20
    - label Alpine.js
      value 15
    - label Svelte
      value 70
    - label Remix
      value 50
    - label Turbopack
      value 45
    - label RSC
      value 55
    - label Biome
      value 30
```

### 65. 楼梯 - 正面紧凑卡片

```infographic
infographic sequence-stairs-front-compact-card
data
  title 数据成熟度模型
  sequences
    - label Level 1
      desc 手动收集，Excel 管理
    - label Level 2
      desc 数据仓库，定期报表
    - label Level 3
      desc 实时分析，自助 BI
    - label Level 4
      desc 机器学习，预测分析
    - label Level 5
      desc AI 驱动，自动决策
```

### 66. 楼梯 - 正面简洁

```infographic
infographic sequence-stairs-front-simple
data
  title 安全等级
  sequences
    - label 基础防护
      desc 防火墙 + WAF
    - label 身份认证
      desc MFA + SSO
    - label 数据加密
      desc TLS + AES-256
    - label 零信任
      desc 微隔离 + 持续验证
```

### 67. 锯齿列表 - 向上简洁

```infographic
infographic list-zigzag-up-simple
data
  title 技术演进路线
  lists
    - label 单体应用
      desc 所有功能在一个进程
    - label SOA 架构
      desc 服务化拆分，ESB 集成
    - label 微服务
      desc 独立部署，轻量通信
    - label 云原生
      desc 容器化 + 服务网格
    - label Serverless
      desc 按需执行，零运维
```

### 68. 横向列表 - 图标线条

```infographic
infographic list-row-horizontal-icon-line
data
  title 数据流转
  lists
    - label 采集
      desc Fluentd / Filebeat
    - label 传输
      desc Kafka / Pulsar
    - label 处理
      desc Flink / Spark
    - label 存储
      desc ClickHouse / Doris
    - label 展示
      desc Grafana / Superset
```

### 69. 横向列表 - 简洁插图

```infographic
infographic list-row-simple-illus
data
  title 产品设计流程
  lists
    - label 用户研究
      desc 访谈、问卷、数据分析
    - label 需求定义
      desc PRD、用户故事、验收标准
    - label 交互设计
      desc 信息架构、线框图、原型
    - label 视觉设计
      desc UI 规范、高保真设计稿
```

### 70. 网格 - 横向图标箭头

```infographic
infographic list-grid-horizontal-icon-arrow
data
  title 全栈技术能力
  lists
    - label 前端开发
      desc React / Vue / CSS
    - label 后端开发
      desc Node.js / Go / Java
    - label 数据库
      desc MySQL / Redis / MongoDB
    - label DevOps
      desc Docker / K8s / Terraform
    - label 测试
      desc Jest / Playwright / k6
    - label 安全
      desc OWASP / 渗透测试
```

### 71. 纵向列表 - 图标箭头

```infographic
infographic list-column-vertical-icon-arrow
data
  title 事件响应流程
  lists
    - label 检测
      desc 监控告警触发
    - label 分类
      desc 确定严重等级 P0-P3
    - label 响应
      desc 组建应急小组
    - label 修复
      desc 定位根因并修复
    - label 恢复
      desc 服务恢复正常
    - label 复盘
      desc 编写事后报告
```

### 72. 纵向列表 - 简洁箭头

```infographic
infographic list-column-simple-vertical-arrow
data
  title TCP 三次握手
  lists
    - label SYN
      desc 客户端发送 SYN 包
    - label SYN-ACK
      desc 服务端回复 SYN+ACK
    - label ACK
      desc 客户端确认，连接建立
```

### 73. 步骤 - 简洁

```infographic
infographic sequence-steps-simple
data
  title Git 工作流
  sequences
    - label feature 分支
      desc 从 develop 创建功能分支
    - label 开发提交
      desc 本地开发并 commit
    - label Pull Request
      desc 提交 PR 并请求 Review
    - label Code Review
      desc 团队成员审查代码
    - label 合并部署
      desc 合入 develop 并自动部署
```

### 74. 步骤 - 药丸徽章

```infographic
infographic sequence-steps-pill-badge
data
  title Kubernetes Pod 生命周期
  sequences
    - label Pending
      desc 等待调度到节点
    - label Init
      desc 运行 Init 容器
    - label Running
      desc 主容器运行中
    - label Terminating
      desc 收到终止信号
    - label Terminated
      desc 容器已停止
```

### 75. 层级对比 - 纯文本

```infographic
infographic compare-hierarchy-left-right-circle-node-plain-text
data
  title SQL vs NoSQL
  compares
    - label SQL 数据库
      children
        - label 强一致性 ACID
        - label 固定 Schema
        - label 复杂查询 JOIN
        - label 垂直扩展为主
        - label MySQL / PostgreSQL
    - label NoSQL 数据库
      children
        - label 最终一致性 BASE
        - label 灵活 Schema
        - label 简单查询模式
        - label 水平扩展为主
        - label MongoDB / Cassandra
```

---

## 十、高级主题与风格

### 76. 手绘风格 - 思维导图

```infographic
infographic hierarchy-mindmap-branch-gradient-compact-card
theme
  stylize rough
data
  root
    label 创业想法
    children
      - label 问题
        children
          - label 用户痛点
          - label 市场空白
      - label 方案
        children
          - label MVP 定义
          - label 技术可行性
      - label 验证
        children
          - label 用户访谈
          - label A/B 测试
```

### 77. 手绘风格 - 漏斗

```infographic
infographic sequence-filter-mesh-simple
theme
  stylize rough
data
  title 招聘漏斗
  sequences
    - label 简历投递
      value 200
    - label 简历筛选
      value 80
    - label 技术面试
      value 30
    - label 终面
      value 12
    - label Offer
      value 5
```

### 78. 渐变色主题 - 时间线

```infographic
infographic sequence-timeline-rounded-rect-node
theme
  colorPrimary #667eea
  palette #667eea,#764ba2,#f093fb,#4facfe,#00f2fe
data
  title 渐变色时间线
  sequences
    - label Phase 1
      desc 基础架构搭建
    - label Phase 2
      desc 核心功能开发
    - label Phase 3
      desc 性能优化
    - label Phase 4
      desc 安全加固
    - label Phase 5
      desc 正式上线
```

### 79. 暖色主题 - 金字塔

```infographic
infographic list-pyramid-badge-card
theme
  colorPrimary #ff6b6b
  palette #ff6b6b,#ffa502,#ffd43b,#51cf66,#339af0
data
  title 学习效率金字塔
  lists
    - label 教别人
      desc 留存率 90%
    - label 实际操作
      desc 留存率 75%
    - label 讨论交流
      desc 留存率 50%
    - label 观看演示
      desc 留存率 30%
    - label 阅读文字
      desc 留存率 10%
```

### 80. 冷色主题 - 环形

```infographic
infographic sequence-circular-simple
theme
  colorPrimary #0ea5e9
  palette #0ea5e9,#06b6d4,#14b8a6,#10b981,#22c55e,#84cc16
data
  title 持续改进循环
  sequences
    - label 观察
      desc 收集数据与反馈
    - label 分析
      desc 识别模式与问题
    - label 假设
      desc 提出改进方案
    - label 实验
      desc 小范围验证
    - label 评估
      desc 衡量效果
    - label 推广
      desc 全面实施
```

---

## 十一、极端边界测试

### 81. 单项数据

```infographic
infographic list-sector-half-plain-text
data
  title 唯一选择
  lists
    - label 全力以赴
      value 100
      desc 没有退路
```

### 82. 超多项数据（15 项）

```infographic
infographic sequence-roadmap-vertical-simple
data
  title HTTP 状态码
  sequences
    - label 100
      desc Continue
    - label 200
      desc OK
    - label 201
      desc Created
    - label 204
      desc No Content
    - label 301
      desc Moved Permanently
    - label 302
      desc Found
    - label 304
      desc Not Modified
    - label 400
      desc Bad Request
    - label 401
      desc Unauthorized
    - label 403
      desc Forbidden
    - label 404
      desc Not Found
    - label 500
      desc Internal Server Error
    - label 502
      desc Bad Gateway
    - label 503
      desc Service Unavailable
    - label 504
      desc Gateway Timeout
```

### 83. 深层嵌套（4 层）

```infographic
infographic hierarchy-mindmap-level-gradient-compact-card
data
  root
    label 操作系统
    children
      - label 进程管理
        children
          - label 调度算法
            children
              - label FIFO
              - label Round Robin
              - label CFS
          - label 进程通信
            children
              - label 管道
              - label 共享内存
              - label 信号量
      - label 内存管理
        children
          - label 虚拟内存
            children
              - label 页表
              - label TLB
              - label 缺页中断
          - label 内存分配
            children
              - label Buddy System
              - label Slab Allocator
```

### 84. 复杂关系图（多对多）

```infographic
infographic relation-dagre-flow-tb-badge-card
data
  nodes
    - id web
      label Web 前端
    - id mobile
      label 移动端
    - id gateway
      label API 网关
    - id auth
      label 认证中心
    - id user
      label 用户服务
    - id order
      label 订单服务
    - id pay
      label 支付服务
    - id stock
      label 库存服务
    - id msg
      label 消息服务
    - id db1
      label 用户 DB
    - id db2
      label 订单 DB
    - id cache
      label Redis
  relations
    web --> gateway
    mobile --> gateway
    gateway --> auth
    gateway --> user
    gateway --> order
    auth --> cache
    user --> db1
    user --> cache
    order --> db2
    order --> pay
    order --> stock
    order --> msg
    pay --> db2
    stock --> cache
    msg --> user
```

---

共 84 个测试用例，覆盖全部模板类别，包含深层嵌套、复杂关系图、多种主题风格和极端边界测试。
