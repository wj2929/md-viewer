# Structurizr 架构建模测试

## 1. 系统上下文

```structurizr
workspace "MD Viewer Context" {
  model {
    user = person "知识工作者" "阅读、编辑和导出 Markdown"
    app = softwareSystem "MD Viewer" "桌面 Markdown 预览器"
    docx = softwareSystem "DOCX Service" "高保真 DOCX 导出"
    user -> app "打开文档、切换预览"
    app -> docx "提交 full fidelity 渲染任务"
  }
  views {
    systemContext app "context" { include * autolayout lr }
  }
}
```

## 2. 容器视图

```structurizr
workspace "RendererPlugin Containers" {
  model {
    user = person "用户"
    app = softwareSystem "MD Viewer" {
      main = container "Electron Main" "文件、IPC、导出调度"
      renderer = container "React Renderer" "Markdown 预览和编辑"
      registry = container "RendererPlugin Registry" "统一图表契约"
      exporter = container "Export Pipeline" "HTML/PDF/DOCX 预渲染"
    }
    service = softwareSystem "DOCX Service"
    user -> renderer "操作预览"
    renderer -> registry "解析 fence"
    registry -> exporter "提供 SVG"
    exporter -> main "请求本地文件"
    exporter -> service "同步 renderer artifact"
  }
}
```

## 3. 插件生命周期

```structurizr
workspace "Plugin Lifecycle" {
  model {
    author = person "贡献者"
    app = softwareSystem "MD Viewer" {
      manifest = container "Manifest Builder"
      preview = container "Preview Hook"
      html = container "HTML Export"
      server = container "Server Render"
      tests = container "E2E Fixture Matrix"
    }
    author -> manifest "注册 renderer metadata"
    manifest -> preview "暴露选择器"
    preview -> html "复用 renderToSvg"
    html -> server "保持 blockId"
    tests -> preview "验证工具栏/全屏"
  }
}
```

## 4. 编辑模式上下文

```structurizr
workspace "Edit Mode Architecture" {
  model {
    user = person "编辑者"
    app = softwareSystem "MD Viewer" {
      preview = container "Preview Surface"
      editor = container "CodeMirror Editor"
      draft = container "Draft Store"
      sync = container "Scroll Sync"
    }
    user -> preview "在渲染区编辑段落"
    preview -> draft "提交块级修改"
    editor -> draft "代码编辑"
    draft -> sync "触发实时预览"
  }
}
```

## 5. 导出链路

```structurizr
workspace "Export Pipeline" {
  model {
    app = softwareSystem "MD Viewer" {
      markdown = container "Markdown Renderer"
      svg = container "SVG Renderer"
      pdf = container "PDF Export"
      html = container "HTML Export"
      docx = container "DOCX Client"
    }
    service = softwareSystem "DOCX Service" {
      browser = container "Headless Renderer"
      replacement = container "Block Replacement"
    }
    markdown -> svg "规范化图表块"
    svg -> html "嵌入静态 SVG"
    svg -> pdf "打印为 PDF"
    docx -> browser "提交 artifact"
    browser -> replacement "返回截图和 blockId"
  }
}
```

## 6. 安全边界

```structurizr
workspace "Security Boundaries" {
  model {
    document = person "不可信 Markdown"
    app = softwareSystem "MD Viewer" {
      sanitizer = container "DOMPurify"
      gateway = container "Renderer Security Gateway"
      local = container "Local Resource Host"
      remote = container "Explicit Remote Renderer"
    }
    document -> sanitizer "HTML 输入"
    sanitizer -> gateway "安全 DOM"
    gateway -> local "读取本地资源"
    gateway -> remote "仅显式允许"
  }
}
```

## 7. 多窗口协作

```structurizr
workspace "Multi Pane Preview" {
  model {
    user = person "用户"
    app = softwareSystem "MD Viewer" {
      tree = container "File Tree"
      tabs = container "Tab Store"
      split = container "Split Panels"
      watcher = container "File Watcher"
    }
    user -> tree "选择文件"
    tree -> tabs "打开标签"
    tabs -> split "分配 leaf"
    watcher -> tabs "刷新变更"
  }
}
```

## 8. 图表全屏

```structurizr
workspace "Chart Fullscreen" {
  model {
    user = person "读者"
    app = softwareSystem "MD Viewer" {
      wrapper = container "Chart Wrapper"
      lightbox = container "DrawIO-like Lightbox"
      toolbar = container "Bottom Toolbar"
      exporter = container "PNG Download"
    }
    user -> wrapper "点击全屏"
    wrapper -> lightbox "克隆图表"
    lightbox -> toolbar "缩放/适应/下载"
    toolbar -> exporter "导出 PNG"
  }
}
```

## 9. DOCX 服务

```structurizr
workspace "DOCX Service Integration" {
  model {
    desktop = softwareSystem "MD Viewer Desktop"
    service = softwareSystem "md-viewer-docx-service" {
      api = container "FastAPI"
      renderer = container "Full Fidelity Renderer"
      manifest = container "Renderer Manifest Check"
      pandoc = container "Pandoc Conversion"
    }
    desktop -> api "上传 Markdown"
    api -> manifest "校验 renderer 能力"
    manifest -> renderer "启用截图"
    renderer -> pandoc "替换图表后转换"
  }
}
```

## 10. 插件治理

```structurizr
workspace "Renderer Governance" {
  model {
    maintainer = person "维护者"
    app = softwareSystem "MD Viewer" {
      registry = container "Builtin Registry"
      fixtures = container "Fixture Coverage"
      e2e = container "Playwright Visual Tests"
      changelog = container "Release Notes"
    }
    maintainer -> registry "添加 renderer"
    registry -> fixtures "要求复杂样例"
    fixtures -> e2e "视觉回归"
    e2e -> changelog "形成发布说明"
  }
}
```

## 11. 长尾格式入口

```structurizr
workspace "Kroki Compatibility" {
  model {
    author = person "文档作者"
    app = softwareSystem "MD Viewer" {
      kroki = container "Kroki Adapter"
      policy = container "Remote Policy"
      fallback = container "Source Fallback"
    }
    remote = softwareSystem "Kroki Service"
    author -> kroki "编写 nomnoml/pikchr"
    kroki -> policy "检查网络策略"
    policy -> remote "POST SVG"
    policy -> fallback "保留源码和警告"
  }
}
```

## 12. 架构决策流

```structurizr
workspace "Architecture Decision Flow" {
  model {
    lead = person "架构负责人"
    app = softwareSystem "MD Viewer" {
      roadmap = container "Roadmap"
      spike = container "Spike"
      implementation = container "Implementation"
      verification = container "Verification"
    }
    lead -> roadmap "确定优先级"
    roadmap -> spike "验证依赖和风险"
    spike -> implementation "拆分 renderer"
    implementation -> verification "自动化测试"
  }
}
```

## 13. 多租户 SaaS 架构

```structurizr
workspace "Multi Tenant SaaS" {
  model {
    admin = person "平台管理员"
    tenant = person "租户用户"
    app = softwareSystem "SaaS Platform" {
      gateway = container "API Gateway"
      auth = container "Identity Service"
      billing = container "Billing Service"
      tenantSvc = container "Tenant Service"
      audit = container "Audit Service"
      portal = container "Admin Portal"
    }
    data = softwareSystem "Data Layer" {
      tenantDb = container "Tenant Database"
      billingDb = container "Billing Database"
      logStore = container "Audit Log Store"
    }
    admin -> portal "管理租户"
    tenant -> gateway "访问业务 API"
    portal -> auth "登录校验"
    gateway -> auth "验证 token"
    gateway -> tenantSvc "路由请求"
    tenantSvc -> tenantDb "读写租户数据"
    tenantSvc -> billing "检查订阅"
    billing -> billingDb "保存账单"
    tenantSvc -> audit "写审计事件"
    audit -> logStore "追加日志"
  }
}
```

## 14. 实时协作文档

```structurizr
workspace "Realtime Collaboration" {
  model {
    editor = person "编辑者"
    reviewer = person "审阅者"
    app = softwareSystem "Collaboration Workspace" {
      web = container "Web Client"
      sync = container "Sync Gateway"
      presence = container "Presence Service"
      conflict = container "Conflict Resolver"
      notify = container "Notification Service"
      export = container "Export Worker"
    }
    store = softwareSystem "Storage" {
      docDb = container "Document DB"
      eventLog = container "Event Log"
      objectStore = container "Attachment Store"
    }
    editor -> web "编辑 Markdown"
    reviewer -> web "评论批注"
    web -> sync "提交操作"
    sync -> conflict "合并变更"
    conflict -> docDb "保存快照"
    conflict -> eventLog "追加操作"
    sync -> presence "广播在线状态"
    sync -> notify "触发通知"
    export -> docDb "读取最新版本"
    export -> objectStore "读取附件"
  }
}
```

## 15. 数据湖治理

```structurizr
workspace "Data Lake Governance" {
  model {
    analyst = person "数据分析师"
    steward = person "数据管理员"
    platform = softwareSystem "Data Platform" {
      ingest = container "Ingestion API"
      catalog = container "Metadata Catalog"
      quality = container "Quality Engine"
      lineage = container "Lineage Service"
      policy = container "Policy Engine"
      notebook = container "Notebook Gateway"
    }
    lake = softwareSystem "Lakehouse" {
      bronze = container "Bronze Zone"
      silver = container "Silver Zone"
      gold = container "Gold Mart"
    }
    analyst -> notebook "查询数据"
    steward -> catalog "维护元数据"
    ingest -> bronze "写入原始数据"
    quality -> bronze "读取校验"
    quality -> silver "写入清洗数据"
    lineage -> bronze "采集血缘"
    lineage -> silver "采集血缘"
    policy -> catalog "读取分类"
    notebook -> policy "请求授权"
    notebook -> gold "执行分析"
  }
}
```

## 16. IoT 边缘平台

```structurizr
workspace "IoT Edge Platform" {
  model {
    operator = person "运维人员"
    device = softwareSystem "Edge Devices"
    cloud = softwareSystem "IoT Cloud" {
      mqtt = container "MQTT Broker"
      registry = container "Device Registry"
      rule = container "Rule Engine"
      command = container "Command Service"
      dashboard = container "Ops Dashboard"
      ota = container "OTA Service"
    }
    data = softwareSystem "Telemetry Storage" {
      tsdb = container "Time Series DB"
      cold = container "Cold Archive"
      alarm = container "Alarm Store"
    }
    operator -> dashboard "监控设备"
    device -> mqtt "上传遥测"
    mqtt -> registry "验证设备"
    mqtt -> rule "转发消息"
    rule -> tsdb "写入指标"
    rule -> alarm "写入告警"
    rule -> command "触发控制"
    command -> mqtt "下发命令"
    ota -> registry "读取设备分组"
    ota -> mqtt "推送升级任务"
  }
}
```

## 17. 支付风控链路

```structurizr
workspace "Payment Risk Control" {
  model {
    buyer = person "买家"
    merchant = person "商户"
    payment = softwareSystem "Payment Platform" {
      checkout = container "Checkout API"
      risk = container "Risk Scoring"
      rule = container "Rule Engine"
      ledger = container "Ledger Service"
      settlement = container "Settlement Service"
      webhook = container "Webhook Dispatcher"
    }
    data = softwareSystem "Risk Data" {
      profile = container "User Profile DB"
      graph = container "Relation Graph"
      event = container "Event Stream"
    }
    buyer -> checkout "提交支付"
    merchant -> webhook "接收结果"
    checkout -> risk "请求评分"
    risk -> profile "读取画像"
    risk -> graph "查询关联"
    risk -> rule "执行策略"
    checkout -> ledger "记账"
    ledger -> settlement "生成清算"
    ledger -> event "发布交易事件"
    webhook -> merchant "推送通知"
  }
}
```

## 18. 低代码流程平台

```structurizr
workspace "Low Code Workflow" {
  model {
    builder = person "流程设计者"
    user = person "业务用户"
    platform = softwareSystem "Workflow Platform" {
      designer = container "Process Designer"
      form = container "Form Runtime"
      engine = container "Workflow Engine"
      rule = container "Rule Sandbox"
      task = container "Task Center"
      integration = container "Integration Hub"
    }
    store = softwareSystem "Workflow Storage" {
      definitionDb = container "Definition DB"
      instanceDb = container "Instance DB"
      fileStore = container "File Store"
    }
    builder -> designer "配置流程"
    designer -> definitionDb "保存定义"
    user -> form "提交表单"
    form -> engine "启动实例"
    engine -> rule "计算分支"
    engine -> task "创建待办"
    engine -> integration "调用外部系统"
    task -> instanceDb "更新状态"
    form -> fileStore "上传附件"
    integration -> instanceDb "回写结果"
  }
}
```

## 19. 可观测性平台

```structurizr
workspace "Observability Platform" {
  model {
    sre = person "SRE"
    service = softwareSystem "Business Services"
    obs = softwareSystem "Observability" {
      collector = container "Telemetry Collector"
      metrics = container "Metrics Pipeline"
      traces = container "Trace Pipeline"
      logs = container "Log Pipeline"
      alert = container "Alert Manager"
      dashboard = container "Dashboard"
    }
    storage = softwareSystem "Telemetry Store" {
      metricDb = container "Metric DB"
      traceDb = container "Trace DB"
      logIndex = container "Log Index"
    }
    service -> collector "发送遥测"
    collector -> metrics "路由指标"
    collector -> traces "路由链路"
    collector -> logs "路由日志"
    metrics -> metricDb "写入"
    traces -> traceDb "写入"
    logs -> logIndex "写入"
    alert -> metricDb "查询规则"
    dashboard -> metricDb "展示指标"
    sre -> dashboard "排障分析"
  }
}
```

## 20. 内容分发平台

```structurizr
workspace "Content Delivery Platform" {
  model {
    author = person "内容编辑"
    reader = person "读者"
    platform = softwareSystem "Content Platform" {
      cms = container "CMS Console"
      workflow = container "Review Workflow"
      renderer = container "Page Renderer"
      cdn = container "CDN Publisher"
      search = container "Search Indexer"
      analytics = container "Analytics Collector"
    }
    data = softwareSystem "Content Data" {
      contentDb = container "Content DB"
      assetStore = container "Asset Store"
      searchIndex = container "Search Index"
    }
    author -> cms "编辑内容"
    cms -> workflow "提交审核"
    workflow -> contentDb "发布版本"
    renderer -> contentDb "读取页面"
    renderer -> assetStore "读取资源"
    renderer -> cdn "发布静态页"
    cdn -> reader "分发内容"
    search -> contentDb "同步内容"
    search -> searchIndex "更新索引"
    analytics -> contentDb "关联内容维度"
  }
}
```

## 21. AI 文档助手

```structurizr
workspace "AI Document Assistant" {
  model {
    writer = person "文档作者"
    reviewer = person "审阅人"
    assistant = softwareSystem "AI Assistant" {
      chat = container "Chat UI"
      retrieval = container "Retrieval Service"
      planner = container "Task Planner"
      guard = container "Policy Guard"
      renderer = container "Chart Renderer"
      exporter = container "Export Agent"
    }
    knowledge = softwareSystem "Knowledge Base" {
      vector = container "Vector Store"
      docStore = container "Document Store"
      promptLog = container "Prompt Log"
    }
    writer -> chat "提出编辑请求"
    reviewer -> chat "审阅建议"
    chat -> guard "检查输入"
    guard -> planner "生成任务"
    planner -> retrieval "检索上下文"
    retrieval -> vector "相似度查询"
    retrieval -> docStore "读取原文"
    planner -> renderer "生成图表"
    planner -> exporter "导出文档"
    guard -> promptLog "记录审计"
  }
}
```

## 22. 多区域部署

```structurizr
workspace "Multi Region Deployment" {
  model {
    user = person "全球用户"
    edge = softwareSystem "Global Edge" {
      dns = container "Geo DNS"
      waf = container "WAF"
      cdn = container "CDN"
      router = container "Traffic Router"
    }
    regionA = softwareSystem "Region A" {
      apiA = container "API Cluster A"
      workerA = container "Worker Pool A"
      dbA = container "Primary DB"
      cacheA = container "Redis A"
    }
    regionB = softwareSystem "Region B" {
      apiB = container "API Cluster B"
      workerB = container "Worker Pool B"
      dbB = container "Replica DB"
      cacheB = container "Redis B"
    }
    user -> dns "解析入口"
    dns -> waf "转发"
    waf -> cdn "静态资源"
    waf -> router "动态请求"
    router -> apiA "主区域"
    router -> apiB "容灾区域"
    apiA -> cacheA "读缓存"
    apiA -> dbA "写主库"
    dbA -> dbB "复制"
    apiB -> cacheB "读缓存"
  }
}
```

## 23. 事件驱动中台

```structurizr
workspace "Event Driven Platform" {
  model {
    producer = person "业务系统"
    consumer = person "订阅系统"
    platform = softwareSystem "Event Platform" {
      gateway = container "Event Gateway"
      schema = container "Schema Registry"
      bus = container "Event Bus"
      router = container "Event Router"
      replay = container "Replay Service"
      monitor = container "Event Monitor"
    }
    store = softwareSystem "Event Storage" {
      topicStore = container "Topic Store"
      deadLetter = container "Dead Letter Queue"
      archive = container "Archive Store"
    }
    producer -> gateway "发布事件"
    gateway -> schema "校验 schema"
    gateway -> bus "写入 topic"
    bus -> router "分发"
    router -> consumer "投递事件"
    router -> deadLetter "失败消息"
    replay -> archive "读取历史"
    replay -> bus "重放事件"
    monitor -> topicStore "统计积压"
    bus -> archive "归档"
  }
}
```

## 24. 移动端同步架构

```structurizr
workspace "Mobile Sync Architecture" {
  model {
    mobile = person "移动用户"
    app = softwareSystem "Mobile App" {
      local = container "Local Cache"
      syncClient = container "Sync Client"
      conflictUi = container "Conflict UI"
      upload = container "Upload Queue"
    }
    cloud = softwareSystem "Sync Cloud" {
      api = container "Sync API"
      conflict = container "Conflict Resolver"
      file = container "File Service"
      push = container "Push Service"
      audit = container "Audit Service"
    }
    data = softwareSystem "Cloud Data" {
      docDb = container "Document DB"
      blob = container "Blob Store"
      auditDb = container "Audit DB"
    }
    mobile -> local "离线编辑"
    local -> syncClient "提交变更"
    syncClient -> api "同步操作"
    upload -> file "上传附件"
    api -> conflict "合并版本"
    conflict -> docDb "保存文档"
    file -> blob "保存文件"
    api -> push "通知其他设备"
    api -> audit "记录审计"
    audit -> auditDb "写入日志"
  }
}
```
