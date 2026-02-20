# Graphviz DOT 图测试

## 1. 简单有向图

```dot
digraph G {
    A -> B -> C
    B -> D
}
```

## 2. MD Viewer 渲染管线

```dot
digraph Pipeline {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, fillcolor="#E3F2FD"]
    edge [color="#666666", fontsize=9]

    Markdown [fillcolor="#BBDEFB"]
    "markdown-it" [fillcolor="#90CAF9"]
    HTML [fillcolor="#64B5F6"]
    DOMPurify [fillcolor="#42A5F5", fontcolor=white]
    "Safe HTML" [fillcolor="#2196F3", fontcolor=white]

    Mermaid [fillcolor="#C8E6C9"]
    ECharts [fillcolor="#C8E6C9"]
    Markmap [fillcolor="#FFF9C4"]
    Graphviz [fillcolor="#FFF9C4"]

    SVG1 [label="SVG", fillcolor="#A5D6A7"]
    SVG2 [label="SVG", fillcolor="#A5D6A7"]
    SVG3 [label="SVG", fillcolor="#A5D6A7"]
    SVG4 [label="SVG", fillcolor="#A5D6A7"]

    Export [label="HTML/PDF\n导出", shape=doubleoctagon, fillcolor="#FFCCBC"]

    Markdown -> "markdown-it" [label="解析"]
    "markdown-it" -> HTML [label="转换"]
    HTML -> DOMPurify [label="净化"]
    DOMPurify -> "Safe HTML"
    "Safe HTML" -> Mermaid
    "Safe HTML" -> ECharts
    "Safe HTML" -> Markmap
    "Safe HTML" -> Graphviz
    Mermaid -> SVG1
    ECharts -> SVG2
    Markmap -> SVG3
    Graphviz -> SVG4
    SVG1 -> Export
    SVG2 -> Export
    SVG3 -> Export
    SVG4 -> Export
}
```

## 3. 无向图（neato 布局）

```dot
graph Network {
    layout=neato
    overlap=false
    node [shape=circle, style=filled, fillcolor=lightblue, fontsize=10]
    edge [len=1.5]

    A -- B
    A -- C
    A -- F
    B -- C
    B -- D
    C -- D
    C -- E
    D -- E
    D -- F
    E -- F
    E -- G
    F -- G
}
```

## 4. 有限状态机（graphviz 语言标识）

```graphviz
digraph FSM {
    rankdir=LR
    node [shape=circle, fontsize=10]
    edge [fontsize=9]

    start [shape=point, width=0.2]
    idle [label="空闲"]
    loading [label="加载中"]
    success [label="成功", shape=doublecircle, style=filled, fillcolor="#C8E6C9"]
    error [label="错误", shape=doublecircle, style=filled, fillcolor="#FFCDD2"]

    start -> idle
    idle -> loading [label="fetch()"]
    loading -> success [label="resolve"]
    loading -> error [label="reject"]
    success -> idle [label="reset()"]
    error -> loading [label="retry()"]
    error -> idle [label="reset()"]
}
```

## 5. 类继承关系（UML 风格）

```dot
digraph Inheritance {
    rankdir=BT
    node [shape=record, fontname="Courier", fontsize=10]
    edge [arrowhead=empty]

    Animal [label="{Animal|+ name: string\l+ age: int\l+ species: string\l|+ makeSound(): void\l+ move(): void\l+ eat(food: string): void\l}"]
    Dog [label="{Dog|+ breed: string\l+ isGoodBoy: boolean\l|+ bark(): void\l+ fetch(item: string): void\l+ wagTail(): void\l}"]
    Cat [label="{Cat|+ isIndoor: boolean\l|+ meow(): void\l+ purr(): void\l+ scratch(target: string): void\l}"]
    Bird [label="{Bird|+ canFly: boolean\l+ wingspan: float\l|+ fly(): void\l+ sing(): void\l+ buildNest(): void\l}"]
    Fish [label="{Fish|+ waterType: string\l|+ swim(): void\l+ breathe(): void\l}"]

    Dog -> Animal
    Cat -> Animal
    Bird -> Animal
    Fish -> Animal
}
```

## 6. 子图（集群架构）

```dot
digraph Architecture {
    compound=true
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=10, fillcolor=white]
    edge [fontsize=9]

    subgraph cluster_frontend {
        label="前端层"
        style="filled,rounded"
        fillcolor="#E3F2FD"
        color="#1565C0"
        fontcolor="#1565C0"
        fontsize=12

        React [label="React 19"]
        Components [label="组件库"]
        Pages [label="页面"]
        Router [label="路由"]
        Store [label="Zustand Store"]

        React -> Components
        Components -> Pages
        Router -> Pages
        Store -> Components
    }

    subgraph cluster_backend {
        label="后端层"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        fontcolor="#2E7D32"
        fontsize=12

        API [label="REST API"]
        Service [label="业务逻辑"]
        Repository [label="数据访问层"]
        Cache [label="Redis 缓存"]

        API -> Service
        Service -> Repository
        Service -> Cache
    }

    subgraph cluster_data {
        label="数据层"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        color="#E65100"
        fontcolor="#E65100"
        fontsize=12

        MySQL [label="MySQL 主库"]
        MySQLSlave [label="MySQL 从库"]
        ES [label="Elasticsearch"]
        OSS [label="对象存储"]

        MySQL -> MySQLSlave [label="主从复制", style=dashed]
    }

    Pages -> API [lhead=cluster_backend, ltail=cluster_frontend, label="HTTP/WebSocket"]
    Repository -> MySQL [lhead=cluster_data, ltail=cluster_backend]
    Repository -> ES
    Service -> OSS
}
```

## 7. 复杂审批流程

```dot
digraph Workflow {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=10, fillcolor="#E8F5E9"]
    edge [fontsize=9]

    start [shape=ellipse, label="开始", fillcolor="#C8E6C9", style=filled]
    end_approve [shape=ellipse, label="审批通过\n流程结束", fillcolor="#A5D6A7", style=filled]
    end_reject [shape=ellipse, label="最终驳回\n流程结束", fillcolor="#FFCDD2", style=filled]

    submit [label="提交申请"]
    first_review [label="初审\n(部门经理)"]
    decision1 [shape=diamond, label="初审\n通过?", fillcolor="#FFF9C4"]
    second_review [label="复审\n(总监)"]
    decision2 [shape=diamond, label="复审\n通过?", fillcolor="#FFF9C4"]
    final_review [label="终审\n(VP)"]
    decision3 [shape=diamond, label="终审\n通过?", fillcolor="#FFF9C4"]
    revise [label="修改申请"]
    decision_revise [shape=diamond, label="修改次数\n< 3?", fillcolor="#FFE0B2"]
    execute [label="执行"]
    notify [label="通知相关方"]
    archive [label="归档"]

    start -> submit
    submit -> first_review
    first_review -> decision1
    decision1 -> second_review [label="是"]
    decision1 -> revise [label="否"]
    second_review -> decision2
    decision2 -> final_review [label="是"]
    decision2 -> revise [label="否"]
    final_review -> decision3
    decision3 -> execute [label="是"]
    decision3 -> revise [label="否"]
    revise -> decision_revise
    decision_revise -> submit [label="是"]
    decision_revise -> end_reject [label="否\n(超过3次)"]
    execute -> notify
    notify -> archive
    archive -> end_approve
}
```

## 8. 网络拓扑图

```dot
graph Topology {
    layout=fdp
    overlap=false
    splines=true
    node [shape=box, style="filled,rounded", fontsize=10]
    edge [len=2.0]

    Internet [shape=cloud, fillcolor="#FFFDE7", label="Internet\n☁️"]
    Firewall [shape=diamond, fillcolor="#FFCDD2", label="防火墙"]
    LB [shape=hexagon, fillcolor="#E1BEE7", label="负载均衡\nNginx"]
    Router [fillcolor="#B3E5FC", label="核心路由器"]
    Switch1 [fillcolor="#B2DFDB", label="交换机 A"]
    Switch2 [fillcolor="#B2DFDB", label="交换机 B"]

    Web1 [label="Web Server 1\n192.168.1.10", fillcolor="#C8E6C9"]
    Web2 [label="Web Server 2\n192.168.1.11", fillcolor="#C8E6C9"]
    Web3 [label="Web Server 3\n192.168.1.12", fillcolor="#C8E6C9"]
    DB_Master [label="DB Master\n192.168.2.10", fillcolor="#FFE0B2"]
    DB_Slave1 [label="DB Slave 1\n192.168.2.11", fillcolor="#FFE0B2"]
    DB_Slave2 [label="DB Slave 2\n192.168.2.12", fillcolor="#FFE0B2"]
    Redis1 [label="Redis Master\n192.168.3.10", fillcolor="#F8BBD0"]
    Redis2 [label="Redis Slave\n192.168.3.11", fillcolor="#F8BBD0"]
    NAS [label="NAS 存储\n192.168.4.10", fillcolor="#D7CCC8"]

    Internet -- Firewall
    Firewall -- LB
    LB -- Router
    Router -- Switch1
    Router -- Switch2
    Switch1 -- Web1
    Switch1 -- Web2
    Switch1 -- Web3
    Switch2 -- DB_Master
    Switch2 -- DB_Slave1
    Switch2 -- DB_Slave2
    Switch2 -- Redis1
    Switch2 -- Redis2
    Switch2 -- NAS
    DB_Master -- DB_Slave1 [style=dashed, label="复制"]
    DB_Master -- DB_Slave2 [style=dashed, label="复制"]
    Redis1 -- Redis2 [style=dashed, label="复制"]
}
```

## 9. strict 关键字（去重边）

```dot
strict digraph G {
    node [shape=box, style=rounded]
    A -> B
    A -> B
    A -> B
    B -> C
    B -> C
    C -> A
    C -> A
}
```

## 10. 最小图

```dot
digraph { A -> B }
```

## 11. 数据库 ER 图

```dot
digraph ER {
    rankdir=LR
    node [shape=record, fontname="Helvetica", fontsize=10]
    edge [fontsize=9]

    users [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#4FC3F7"><B>users</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>username</TD><TD>VARCHAR(50)</TD></TR>
        <TR><TD></TD><TD>email</TD><TD>VARCHAR(100)</TD></TR>
        <TR><TD></TD><TD>password_hash</TD><TD>VARCHAR(255)</TD></TR>
        <TR><TD></TD><TD>status</TD><TD>ENUM</TD></TR>
        <TR><TD></TD><TD>created_at</TD><TD>TIMESTAMP</TD></TR>
        </TABLE>
    >]

    orders [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#81C784"><B>orders</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>user_id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>order_no</TD><TD>VARCHAR(32)</TD></TR>
        <TR><TD></TD><TD>total_amount</TD><TD>DECIMAL</TD></TR>
        <TR><TD></TD><TD>status</TD><TD>ENUM</TD></TR>
        <TR><TD></TD><TD>created_at</TD><TD>TIMESTAMP</TD></TR>
        </TABLE>
    >]

    order_items [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#FFB74D"><B>order_items</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>order_id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>product_id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>sku_id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>quantity</TD><TD>INT</TD></TR>
        <TR><TD></TD><TD>unit_price</TD><TD>DECIMAL</TD></TR>
        </TABLE>
    >]

    products [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#CE93D8"><B>products</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>category_id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>name</TD><TD>VARCHAR(200)</TD></TR>
        <TR><TD></TD><TD>price</TD><TD>DECIMAL</TD></TR>
        <TR><TD></TD><TD>stock</TD><TD>INT</TD></TR>
        <TR><TD></TD><TD>status</TD><TD>ENUM</TD></TR>
        </TABLE>
    >]

    categories [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#F48FB1"><B>categories</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>parent_id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>name</TD><TD>VARCHAR(100)</TD></TR>
        <TR><TD></TD><TD>level</TD><TD>INT</TD></TR>
        </TABLE>
    >]

    payments [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
        <TR><TD COLSPAN="3" BGCOLOR="#FFF176"><B>payments</B></TD></TR>
        <TR><TD>PK</TD><TD>id</TD><TD>BIGINT</TD></TR>
        <TR><TD>FK</TD><TD>order_id</TD><TD>BIGINT</TD></TR>
        <TR><TD></TD><TD>method</TD><TD>ENUM</TD></TR>
        <TR><TD></TD><TD>amount</TD><TD>DECIMAL</TD></TR>
        <TR><TD></TD><TD>status</TD><TD>ENUM</TD></TR>
        <TR><TD></TD><TD>transaction_id</TD><TD>VARCHAR(64)</TD></TR>
        </TABLE>
    >]

    users -> orders [label="1:N", arrowhead=crow]
    orders -> order_items [label="1:N", arrowhead=crow]
    products -> order_items [label="1:N", arrowhead=crow]
    categories -> products [label="1:N", arrowhead=crow]
    orders -> payments [label="1:N", arrowhead=crow]
    categories -> categories [label="自引用\n(parent)", style=dashed]
}
```

## 12. 编译器流水线

```graphviz
digraph Compiler {
    rankdir=LR
    node [fontsize=10]
    edge [fontsize=8]

    src [label="源代码\n(.ts/.js)", shape=note, style=filled, fillcolor="#E3F2FD"]
    lexer [label="词法分析器\nLexer", shape=box, style="rounded,filled", fillcolor="#BBDEFB"]
    tokens [label="Token 流", shape=ellipse, style=filled, fillcolor="#E8EAF6"]
    parser [label="语法分析器\nParser", shape=box, style="rounded,filled", fillcolor="#90CAF9"]
    ast [label="AST\n抽象语法树", shape=ellipse, style=filled, fillcolor="#E8EAF6"]
    semantic [label="语义分析器\nType Checker", shape=box, style="rounded,filled", fillcolor="#64B5F6"]
    annotated [label="带类型 AST", shape=ellipse, style=filled, fillcolor="#E8EAF6"]
    irgen [label="IR 生成器", shape=box, style="rounded,filled", fillcolor="#42A5F5", fontcolor=white]
    ir [label="中间表示\nIR", shape=ellipse, style=filled, fillcolor="#E8EAF6"]
    optimizer [label="优化器\nOptimizer", shape=box, style="rounded,filled", fillcolor="#1E88E5", fontcolor=white]
    optir [label="优化后 IR", shape=ellipse, style=filled, fillcolor="#E8EAF6"]
    codegen [label="代码生成器\nCode Generator", shape=box, style="rounded,filled", fillcolor="#1565C0", fontcolor=white]
    output [label="目标代码\n(.js/.wasm)", shape=note, style=filled, fillcolor="#C8E6C9"]

    src -> lexer [label="字符流"]
    lexer -> tokens [label="扫描"]
    tokens -> parser [label="消费"]
    parser -> ast [label="构建"]
    ast -> semantic [label="遍历"]
    semantic -> annotated [label="标注"]
    annotated -> irgen [label="转换"]
    irgen -> ir [label="生成"]
    ir -> optimizer [label="分析"]
    optimizer -> optir [label="变换"]
    optir -> codegen [label="映射"]
    codegen -> output [label="输出"]

    // 错误反馈
    lexer -> errors [style=dashed, color=red, label="词法错误"]
    parser -> errors [style=dashed, color=red, label="语法错误"]
    semantic -> errors [style=dashed, color=red, label="类型错误"]
    errors [label="错误报告", shape=octagon, style=filled, fillcolor="#FFCDD2"]
}
```

## 13. Kubernetes 集群架构

```dot
digraph K8s {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=10, fillcolor=white]
    edge [fontsize=8]

    subgraph cluster_master {
        label="Control Plane (Master)"
        style="filled,rounded,bold"
        fillcolor="#E3F2FD"
        color="#1565C0"
        fontsize=12

        apiserver [label="API Server\n:6443", fillcolor="#BBDEFB"]
        etcd [label="etcd\n:2379", fillcolor="#B3E5FC"]
        scheduler [label="Scheduler", fillcolor="#B3E5FC"]
        controller [label="Controller\nManager", fillcolor="#B3E5FC"]
        ccm [label="Cloud Controller\nManager", fillcolor="#B3E5FC"]

        apiserver -> etcd [label="读写"]
        apiserver -> scheduler [dir=both]
        apiserver -> controller [dir=both]
        apiserver -> ccm [dir=both]
    }

    subgraph cluster_node1 {
        label="Worker Node 1"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        fontsize=12

        kubelet1 [label="kubelet", fillcolor="#C8E6C9"]
        proxy1 [label="kube-proxy", fillcolor="#C8E6C9"]
        runtime1 [label="containerd", fillcolor="#A5D6A7"]

        subgraph cluster_pod1a {
            label="Pod: nginx-7d4f8"
            style="filled,dashed"
            fillcolor="#DCEDC8"
            nginx1 [label="nginx:1.25\n:80", shape=component]
            sidecar1 [label="fluentd\n(sidecar)", shape=component, fillcolor="#FFF9C4"]
        }

        subgraph cluster_pod1b {
            label="Pod: api-server-a3b2"
            style="filled,dashed"
            fillcolor="#DCEDC8"
            api1 [label="node:20\n:3000", shape=component]
        }

        kubelet1 -> runtime1
        runtime1 -> nginx1
        runtime1 -> api1
    }

    subgraph cluster_node2 {
        label="Worker Node 2"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        color="#E65100"
        fontsize=12

        kubelet2 [label="kubelet", fillcolor="#FFE0B2"]
        proxy2 [label="kube-proxy", fillcolor="#FFE0B2"]
        runtime2 [label="containerd", fillcolor="#FFCC80"]

        subgraph cluster_pod2a {
            label="Pod: nginx-9e2c1"
            style="filled,dashed"
            fillcolor="#FFF8E1"
            nginx2 [label="nginx:1.25\n:80", shape=component]
        }

        subgraph cluster_pod2b {
            label="Pod: redis-master-x7k9"
            style="filled,dashed"
            fillcolor="#FFF8E1"
            redis [label="redis:7\n:6379", shape=component]
        }

        kubelet2 -> runtime2
        runtime2 -> nginx2
        runtime2 -> redis
    }

    // Control Plane -> Nodes
    apiserver -> kubelet1 [label="指令"]
    apiserver -> kubelet2 [label="指令"]

    // Service 网络
    proxy1 -> nginx1 [style=dotted, label="iptables"]
    proxy1 -> api1 [style=dotted]
    proxy2 -> nginx2 [style=dotted, label="iptables"]
    proxy2 -> redis [style=dotted]

    // 外部访问
    ingress [label="Ingress Controller\n(Nginx/Traefik)", shape=hexagon, fillcolor="#E1BEE7"]
    lb [label="Cloud Load Balancer", shape=diamond, fillcolor="#F8BBD0"]

    lb -> ingress
    ingress -> proxy1
    ingress -> proxy2
}
```

## 14. Git 分支模型

```graphviz
digraph GitFlow {
    rankdir=TB
    node [shape=record, fontsize=9, fontname="Courier"]
    edge [fontsize=8]

    // main 分支
    subgraph cluster_main {
        label="main"
        style="filled,bold"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        m1 [label="v1.0.0\n|a1b2c3d"]
        m2 [label="v1.0.1\n|e4f5g6h"]
        m3 [label="v1.1.0\n|i7j8k9l"]
        m4 [label="v1.2.0\n|m0n1o2p"]
        m1 -> m2 -> m3 -> m4
    }

    // develop 分支
    subgraph cluster_develop {
        label="develop"
        style="filled"
        fillcolor="#E3F2FD"
        color="#1565C0"
        d1 [label="init\n|q3r4s5t"]
        d2 [label="merge feat-A\n|u6v7w8x"]
        d3 [label="merge feat-B\n|y9z0a1b"]
        d4 [label="pre-release\n|c2d3e4f"]
        d1 -> d2 -> d3 -> d4
    }

    // feature 分支
    subgraph cluster_feature {
        label="feature/*"
        style="filled,dashed"
        fillcolor="#FFF3E0"
        color="#E65100"
        f1 [label="feat-A: start\n|g5h6i7j"]
        f2 [label="feat-A: wip\n|k8l9m0n"]
        f3 [label="feat-B: start\n|o1p2q3r"]
        f4 [label="feat-B: done\n|s4t5u6v"]
        f1 -> f2
        f3 -> f4
    }

    // hotfix 分支
    subgraph cluster_hotfix {
        label="hotfix/*"
        style="filled,dashed"
        fillcolor="#FFEBEE"
        color="#C62828"
        h1 [label="hotfix-001\n|w7x8y9z"]
    }

    // 分支操作
    m1 -> d1 [label="branch", style=dashed, color=blue]
    d1 -> f1 [label="branch", style=dashed, color=orange]
    f2 -> d2 [label="merge", style=bold, color=green]
    d2 -> f3 [label="branch", style=dashed, color=orange]
    f4 -> d3 [label="merge", style=bold, color=green]
    d4 -> m3 [label="release merge", style=bold, color=purple]
    m2 -> h1 [label="hotfix branch", style=dashed, color=red]
    h1 -> m2 [label="hotfix merge", style=bold, color=red]
    h1 -> d2 [label="backport", style=dotted, color=red]
}
```

## 15. 微服务架构

```dot
digraph Microservices {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontsize=10, fillcolor=white]
    edge [fontsize=8]

    // 客户端
    subgraph cluster_client {
        label="客户端"
        style="filled,rounded"
        fillcolor="#F3E5F5"
        color="#6A1B9A"
        fontsize=12
        web [label="Web App\n(React)", fillcolor="#CE93D8"]
        mobile [label="Mobile App\n(Flutter)", fillcolor="#CE93D8"]
        miniapp [label="小程序\n(WeChat)", fillcolor="#CE93D8"]
    }

    // 网关层
    subgraph cluster_gateway {
        label="网关层"
        style="filled,rounded"
        fillcolor="#E8EAF6"
        color="#283593"
        fontsize=12
        gateway [label="API Gateway\n(Kong/Nginx)", fillcolor="#9FA8DA"]
        auth [label="Auth Service\n(JWT/OAuth2)", fillcolor="#9FA8DA"]
        ratelimit [label="Rate Limiter", fillcolor="#9FA8DA"]
        gateway -> auth [label="验证"]
        gateway -> ratelimit [label="限流"]
    }

    // 业务服务
    subgraph cluster_services {
        label="业务服务层"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        fontsize=12
        user_svc [label="用户服务\n:8001", fillcolor="#A5D6A7"]
        order_svc [label="订单服务\n:8002", fillcolor="#A5D6A7"]
        product_svc [label="商品服务\n:8003", fillcolor="#A5D6A7"]
        payment_svc [label="支付服务\n:8004", fillcolor="#A5D6A7"]
        notify_svc [label="通知服务\n:8005", fillcolor="#A5D6A7"]
        search_svc [label="搜索服务\n:8006", fillcolor="#A5D6A7"]
        recommend_svc [label="推荐服务\n:8007", fillcolor="#A5D6A7"]
    }

    // 基础设施
    subgraph cluster_infra {
        label="基础设施层"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        color="#E65100"
        fontsize=12
        mq [label="消息队列\nKafka", fillcolor="#FFCC80"]
        cache [label="缓存\nRedis Cluster", fillcolor="#FFCC80"]
        db_user [label="用户库\nMySQL", fillcolor="#FFE0B2"]
        db_order [label="订单库\nMySQL", fillcolor="#FFE0B2"]
        db_product [label="商品库\nMySQL", fillcolor="#FFE0B2"]
        es [label="搜索引擎\nElasticsearch", fillcolor="#FFE0B2"]
        oss [label="对象存储\nMinIO/S3", fillcolor="#FFE0B2"]
        config [label="配置中心\nNacos", fillcolor="#FFCC80"]
        registry [label="服务注册\nNacos", fillcolor="#FFCC80"]
    }

    // 监控
    subgraph cluster_monitor {
        label="可观测性"
        style="filled,rounded"
        fillcolor="#FFEBEE"
        color="#C62828"
        fontsize=12
        prometheus [label="Prometheus\n指标采集", fillcolor="#EF9A9A"]
        grafana [label="Grafana\n可视化", fillcolor="#EF9A9A"]
        jaeger [label="Jaeger\n链路追踪", fillcolor="#EF9A9A"]
        elk [label="ELK Stack\n日志聚合", fillcolor="#EF9A9A"]
        prometheus -> grafana
    }

    // 连接
    web -> gateway
    mobile -> gateway
    miniapp -> gateway
    gateway -> user_svc
    gateway -> order_svc
    gateway -> product_svc
    gateway -> payment_svc
    gateway -> search_svc
    gateway -> recommend_svc

    order_svc -> mq [label="下单事件"]
    mq -> notify_svc [label="消费"]
    mq -> search_svc [label="索引更新"]
    payment_svc -> mq [label="支付回调"]

    user_svc -> db_user
    user_svc -> cache
    order_svc -> db_order
    order_svc -> cache
    product_svc -> db_product
    product_svc -> cache
    product_svc -> oss [label="图片"]
    search_svc -> es
    recommend_svc -> cache

    // 服务注册
    user_svc -> registry [style=dotted]
    order_svc -> registry [style=dotted]
    product_svc -> registry [style=dotted]
    payment_svc -> registry [style=dotted]

    // 监控
    user_svc -> prometheus [style=dotted, color=red]
    order_svc -> prometheus [style=dotted, color=red]
    user_svc -> jaeger [style=dotted, color=red]
    order_svc -> jaeger [style=dotted, color=red]
    user_svc -> elk [style=dotted, color=red]
}
```

## 16. TCP 状态机

```graphviz
digraph TCP {
    rankdir=LR
    node [shape=ellipse, style=filled, fillcolor="#E3F2FD", fontsize=10]
    edge [fontsize=8]

    CLOSED [fillcolor="#FFCDD2"]
    LISTEN [fillcolor="#C8E6C9"]
    SYN_SENT [fillcolor="#FFF9C4"]
    SYN_RCVD [fillcolor="#FFF9C4"]
    ESTABLISHED [fillcolor="#A5D6A7", shape=doublecircle]
    FIN_WAIT_1 [fillcolor="#FFE0B2"]
    FIN_WAIT_2 [fillcolor="#FFE0B2"]
    CLOSING [fillcolor="#FFE0B2"]
    TIME_WAIT [fillcolor="#FFCCBC"]
    CLOSE_WAIT [fillcolor="#E1BEE7"]
    LAST_ACK [fillcolor="#E1BEE7"]

    // 主动打开
    CLOSED -> SYN_SENT [label="connect()\nSYN"]
    SYN_SENT -> ESTABLISHED [label="rcv SYN+ACK\nsend ACK"]
    SYN_SENT -> CLOSED [label="timeout"]

    // 被动打开
    CLOSED -> LISTEN [label="listen()"]
    LISTEN -> SYN_RCVD [label="rcv SYN\nsend SYN+ACK"]
    SYN_RCVD -> ESTABLISHED [label="rcv ACK"]
    SYN_RCVD -> LISTEN [label="rcv RST"]

    // 同时打开
    SYN_SENT -> SYN_RCVD [label="rcv SYN\nsend SYN+ACK"]

    // 主动关闭
    ESTABLISHED -> FIN_WAIT_1 [label="close()\nsend FIN"]
    FIN_WAIT_1 -> FIN_WAIT_2 [label="rcv ACK"]
    FIN_WAIT_2 -> TIME_WAIT [label="rcv FIN\nsend ACK"]
    TIME_WAIT -> CLOSED [label="2MSL timeout"]

    // 同时关闭
    FIN_WAIT_1 -> CLOSING [label="rcv FIN\nsend ACK"]
    CLOSING -> TIME_WAIT [label="rcv ACK"]

    // 被动关闭
    ESTABLISHED -> CLOSE_WAIT [label="rcv FIN\nsend ACK"]
    CLOSE_WAIT -> LAST_ACK [label="close()\nsend FIN"]
    LAST_ACK -> CLOSED [label="rcv ACK"]

    // 直接关闭
    FIN_WAIT_1 -> TIME_WAIT [label="rcv FIN+ACK\nsend ACK"]
    LISTEN -> CLOSED [label="close()"]
}
```

## 17. HTML-like 标签（复杂表格节点）

```dot
digraph HTMLLabels {
    rankdir=TB
    node [shape=plaintext]

    server [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6">
        <TR><TD COLSPAN="2" BGCOLOR="#1565C0"><FONT COLOR="white"><B>Web Server</B></FONT></TD></TR>
        <TR>
            <TD BGCOLOR="#E3F2FD" PORT="http">HTTP :80</TD>
            <TD BGCOLOR="#E3F2FD" PORT="https">HTTPS :443</TD>
        </TR>
        <TR>
            <TD COLSPAN="2" BGCOLOR="#BBDEFB">Nginx 1.25</TD>
        </TR>
        <TR>
            <TD PORT="upstream1">upstream: app1</TD>
            <TD PORT="upstream2">upstream: app2</TD>
        </TR>
        </TABLE>
    >]

    app1 [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6">
        <TR><TD COLSPAN="2" BGCOLOR="#2E7D32"><FONT COLOR="white"><B>App Server 1</B></FONT></TD></TR>
        <TR><TD>Node.js 20</TD><TD PORT="port">:3001</TD></TR>
        <TR><TD>CPU</TD><TD>4 cores</TD></TR>
        <TR><TD>RAM</TD><TD>8 GB</TD></TR>
        <TR><TD>Status</TD><TD BGCOLOR="#C8E6C9">Healthy</TD></TR>
        </TABLE>
    >]

    app2 [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6">
        <TR><TD COLSPAN="2" BGCOLOR="#2E7D32"><FONT COLOR="white"><B>App Server 2</B></FONT></TD></TR>
        <TR><TD>Node.js 20</TD><TD PORT="port">:3002</TD></TR>
        <TR><TD>CPU</TD><TD>4 cores</TD></TR>
        <TR><TD>RAM</TD><TD>8 GB</TD></TR>
        <TR><TD>Status</TD><TD BGCOLOR="#FFCDD2">Degraded</TD></TR>
        </TABLE>
    >]

    db [label=<
        <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6">
        <TR><TD COLSPAN="2" BGCOLOR="#E65100"><FONT COLOR="white"><B>Database</B></FONT></TD></TR>
        <TR><TD>MySQL 8.0</TD><TD PORT="port">:3306</TD></TR>
        <TR><TD>Storage</TD><TD>500 GB SSD</TD></TR>
        <TR><TD>Connections</TD><TD>150/200</TD></TR>
        <TR><TD>Replication</TD><TD BGCOLOR="#FFF9C4">Master</TD></TR>
        </TABLE>
    >]

    server:upstream1 -> app1:port
    server:upstream2 -> app2:port
    app1 -> db:port
    app2 -> db:port
}
```

## 18. 多种节点形状展示

```dot
digraph Shapes {
    rankdir=TB
    node [style=filled, fillcolor="#E3F2FD", fontsize=9, width=1.2]

    box [shape=box, label="box"]
    ellipse [shape=ellipse, label="ellipse"]
    circle [shape=circle, label="circle"]
    diamond [shape=diamond, label="diamond"]
    triangle [shape=triangle, label="triangle"]
    pentagon [shape=pentagon, label="pentagon"]
    hexagon [shape=hexagon, label="hexagon"]
    octagon [shape=octagon, label="octagon"]
    doublecircle [shape=doublecircle, label="doublecircle"]
    doubleoctagon [shape=doubleoctagon, label="doubleoctagon"]
    invtriangle [shape=invtriangle, label="invtriangle"]
    trapezium [shape=trapezium, label="trapezium"]
    invtrapezium [shape=invtrapezium, label="invtrapezium"]
    parallelogram [shape=parallelogram, label="parallelogram"]
    house [shape=house, label="house"]
    invhouse [shape=invhouse, label="invhouse"]
    star [shape=star, label="star", fillcolor="#FFF9C4"]
    cylinder [shape=cylinder, label="cylinder", fillcolor="#C8E6C9"]
    note [shape=note, label="note", fillcolor="#FFE0B2"]
    tab [shape=tab, label="tab"]
    folder [shape=folder, label="folder", fillcolor="#E1BEE7"]
    box3d [shape=box3d, label="box3d"]
    component [shape=component, label="component", fillcolor="#FFCCBC"]
    rect [shape=rect, label="rect"]
    square [shape=square, label="square"]
    plain [shape=plain, label="plain"]
    none [shape=none, label="none"]
    underline [shape=underline, label="underline"]
    Mdiamond [shape=Mdiamond, label="Mdiamond"]
    Msquare [shape=Msquare, label="Msquare"]
    Mcircle [shape=Mcircle, label="Mcircle"]
    record [shape=record, label="{record|field1|field2}"]

    // 排列
    box -> ellipse -> circle -> diamond [style=invis]
    triangle -> pentagon -> hexagon -> octagon [style=invis]
    doublecircle -> doubleoctagon -> invtriangle -> trapezium [style=invis]
    invtrapezium -> parallelogram -> house -> invhouse [style=invis]
    star -> cylinder -> note -> tab [style=invis]
    folder -> box3d -> component -> rect [style=invis]
    square -> plain -> none -> underline [style=invis]
    Mdiamond -> Msquare -> Mcircle -> record [style=invis]
}
```

## 19. 颜色和边样式展示

```dot
digraph Styles {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontsize=10]

    // 渐变色节点
    a [label="默认", fillcolor="#E3F2FD"]
    b [label="蓝色", fillcolor="#2196F3", fontcolor=white]
    c [label="绿色", fillcolor="#4CAF50", fontcolor=white]
    d [label="红色", fillcolor="#F44336", fontcolor=white]
    e [label="橙色", fillcolor="#FF9800", fontcolor=white]
    f [label="紫色", fillcolor="#9C27B0", fontcolor=white]
    g [label="青色", fillcolor="#00BCD4", fontcolor=white]
    h [label="粉色", fillcolor="#E91E63", fontcolor=white]

    // 各种边样式
    a -> b [label="solid (默认)", style=solid]
    b -> c [label="dashed", style=dashed]
    c -> d [label="dotted", style=dotted]
    d -> e [label="bold", style=bold]
    e -> f [label="tapered", style=tapered]

    // 各种箭头
    a -> c [label="normal", arrowhead=normal, color="#666"]
    b -> d [label="inv", arrowhead=inv, color="#666"]
    c -> e [label="dot", arrowhead=dot, color="#666"]
    d -> f [label="odot", arrowhead=odot, color="#666"]
    e -> g [label="diamond", arrowhead=diamond, color="#666"]
    f -> h [label="box", arrowhead=box, color="#666"]
    g -> a [label="crow", arrowhead=crow, color="#666"]
    h -> b [label="vee", arrowhead=vee, color="#666"]

    // 双向箭头
    g -> h [label="both", dir=both, arrowhead=normal, arrowtail=normal, color=red]
}
```

## 20. 大型依赖图（npm 包依赖树）

```dot
digraph Dependencies {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=8, fillcolor="#E3F2FD"]
    edge [fontsize=7, color="#999"]

    // 根项目
    root [label="md-viewer\nv1.5.4", fillcolor="#1565C0", fontcolor=white, fontsize=10]

    // 核心依赖
    react [label="react\n19.2.3", fillcolor="#61DAFB"]
    react_dom [label="react-dom\n19.2.3", fillcolor="#61DAFB"]
    electron [label="electron\n39.2.7", fillcolor="#47848F", fontcolor=white]
    typescript [label="typescript\n5.9.3", fillcolor="#3178C6", fontcolor=white]
    vite [label="vite\n7.3.0", fillcolor="#646CFF", fontcolor=white]

    // Markdown 相关
    markdown_it [label="markdown-it\n14.1.0", fillcolor="#C8E6C9"]
    dompurify [label="dompurify\n3.3.1", fillcolor="#C8E6C9"]
    prismjs [label="prismjs\n1.30.0", fillcolor="#C8E6C9"]
    katex [label="katex\n0.16.27", fillcolor="#C8E6C9"]

    // 图表渲染
    mermaid [label="mermaid\n11.12.2", fillcolor="#FFE0B2"]
    echarts [label="echarts\n6.0.0", fillcolor="#FFE0B2"]
    antv [label="@antv/infographic\n0.2.13", fillcolor="#FFE0B2"]
    markmap_lib [label="markmap-lib\n(new)", fillcolor="#FFF9C4"]
    markmap_view [label="markmap-view\n(new)", fillcolor="#FFF9C4"]
    graphviz_wasm [label="@hpcc-js/\nwasm-graphviz\n(new)", fillcolor="#FFF9C4"]

    // 状态管理
    zustand [label="zustand\n5.0.9", fillcolor="#E1BEE7"]

    // 工具库
    chokidar [label="chokidar\n5.0.0", fillcolor="#F5F5F5"]
    fuse [label="fuse.js\n7.1.0", fillcolor="#F5F5F5"]
    markjs [label="mark.js\n8.11.1", fillcolor="#F5F5F5"]
    zod [label="zod\n4.3.5", fillcolor="#F5F5F5"]

    // 测试
    vitest [label="vitest\n4.0.16", fillcolor="#FFCDD2"]
    playwright [label="playwright\n1.57.0", fillcolor="#FFCDD2"]
    testing_lib [label="@testing-library\n/react 16.3.1", fillcolor="#FFCDD2"]

    // mermaid 子依赖
    d3 [label="d3\n7.x", fillcolor="#F5F5F5"]
    dagre [label="dagre-d3\n0.6.x", fillcolor="#F5F5F5"]
    dompurify2 [label="dompurify\n(内置)", fillcolor="#F5F5F5"]

    // markmap 子依赖
    d3_markmap [label="d3 (子集)", fillcolor="#F5F5F5"]

    // 连接
    root -> react
    root -> react_dom
    root -> electron
    root -> typescript
    root -> vite
    root -> markdown_it
    root -> dompurify
    root -> prismjs
    root -> katex
    root -> mermaid
    root -> echarts
    root -> antv
    root -> markmap_lib
    root -> markmap_view
    root -> graphviz_wasm
    root -> zustand
    root -> chokidar
    root -> fuse
    root -> markjs
    root -> zod
    root -> vitest
    root -> playwright
    root -> testing_lib

    react_dom -> react [label="peer"]
    mermaid -> d3
    mermaid -> dagre
    mermaid -> dompurify2
    markmap_lib -> d3_markmap
    markmap_view -> d3_markmap
    testing_lib -> react [label="peer"]
}
```

## 21. 中文内容和特殊字符

```dot
digraph Chinese {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=11, fillcolor="#E3F2FD"]
    edge [fontsize=9]

    root [label="中文测试 🇨🇳", fillcolor="#F44336", fontcolor=white]

    // 标点符号
    punct [label="标点符号\n逗号，句号。\n问号？感叹号！\n引号"双引号"\n括号（圆括号）\n破折号——\n省略号……"]

    // Emoji
    emoji [label="Emoji 表情\n🎉🚀⚡🔥\n✅❌⚠️💡\n🎯🏆📊🗺️"]

    // 数学符号
    math [label="数学符号\nα β γ δ ε\n∑ ∏ ∫ ∂\n≈ ≠ ≤ ≥\n∞ √ π"]

    // 多语言
    lang [label="多语言\nEnglish 英文\n日本語 にほんご\n한국어 韩语\nDeutsch 德语\nFrançais 法语"]

    // 长中文
    long_text [label="这是一段很长很长很长很长很长\n很长很长很长很长很长很长很长\n的中文文本用来测试换行效果"]

    root -> punct
    root -> emoji
    root -> math
    root -> lang
    root -> long_text

    punct -> p1 [label="测试：冒号"]
    punct -> p2 [label="测试、顿号"]
    p1 [label="子节点 A\n（带括号）"]
    p2 [label="子节点 B\n【带方括号】"]
}
```

## 22. 与普通 Markdown 内容混排

这是一段普通的 Markdown 文本。下面是第一个 Graphviz 图：

```dot
digraph First {
    rankdir=LR
    A [label="第一个图", shape=box, style="rounded,filled", fillcolor="#C8E6C9"]
    B [label="混排测试", shape=box, style="rounded,filled", fillcolor="#BBDEFB"]
    A -> B [label="上面有文字"]
}
```

这是两个图之间的文字。下面是一个 **JavaScript 代码块**，不应该被 Graphviz 渲染：

```javascript
const graph = {
  nodes: ['A', 'B', 'C'],
  edges: [
    { from: 'A', to: 'B', label: 'connects' },
    { from: 'B', to: 'C', label: 'links' }
  ]
}
console.log('digraph G { A -> B }') // 这不是 DOT 代码
```

再来一个 Graphviz 图，使用 `graphviz` 语言标识：

```graphviz
digraph Second {
    rankdir=LR
    C [label="第二个图", shape=box, style="rounded,filled", fillcolor="#FFE0B2"]
    D [label="验证共存", shape=box, style="rounded,filled", fillcolor="#E1BEE7"]
    C -> D [label="下面也有文字"]
}
```

这是最后一段文字。两个 Graphviz 图应该都能正常渲染，JS 代码块保持原样。

## 23. 设计模式关系图

```dot
digraph DesignPatterns {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=9]
    edge [fontsize=8]

    // 创建型
    subgraph cluster_creational {
        label="创建型模式"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        singleton [label="单例模式\nSingleton", fillcolor="#C8E6C9"]
        factory [label="工厂方法\nFactory Method", fillcolor="#C8E6C9"]
        abstract_factory [label="抽象工厂\nAbstract Factory", fillcolor="#C8E6C9"]
        builder [label="建造者\nBuilder", fillcolor="#C8E6C9"]
        prototype [label="原型\nPrototype", fillcolor="#C8E6C9"]
    }

    // 结构型
    subgraph cluster_structural {
        label="结构型模式"
        style="filled,rounded"
        fillcolor="#E3F2FD"
        color="#1565C0"
        adapter [label="适配器\nAdapter", fillcolor="#BBDEFB"]
        bridge [label="桥接\nBridge", fillcolor="#BBDEFB"]
        composite [label="组合\nComposite", fillcolor="#BBDEFB"]
        decorator [label="装饰器\nDecorator", fillcolor="#BBDEFB"]
        facade [label="外观\nFacade", fillcolor="#BBDEFB"]
        flyweight [label="享元\nFlyweight", fillcolor="#BBDEFB"]
        proxy [label="代理\nProxy", fillcolor="#BBDEFB"]
    }

    // 行为型
    subgraph cluster_behavioral {
        label="行为型模式"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        color="#E65100"
        observer [label="观察者\nObserver", fillcolor="#FFE0B2"]
        strategy [label="策略\nStrategy", fillcolor="#FFE0B2"]
        command [label="命令\nCommand", fillcolor="#FFE0B2"]
        state [label="状态\nState", fillcolor="#FFE0B2"]
        template [label="模板方法\nTemplate Method", fillcolor="#FFE0B2"]
        iterator [label="迭代器\nIterator", fillcolor="#FFE0B2"]
        mediator [label="中介者\nMediator", fillcolor="#FFE0B2"]
        chain [label="责任链\nChain of Resp.", fillcolor="#FFE0B2"]
        visitor [label="访问者\nVisitor", fillcolor="#FFE0B2"]
        memento [label="备忘录\nMemento", fillcolor="#FFE0B2"]
        interpreter [label="解释器\nInterpreter", fillcolor="#FFE0B2"]
    }

    // 常见组合关系
    factory -> abstract_factory [label="演进", style=dashed]
    abstract_factory -> singleton [label="常结合"]
    builder -> composite [label="构建", style=dashed]
    adapter -> facade [label="类似"]
    decorator -> proxy [label="类似"]
    observer -> mediator [label="常结合"]
    strategy -> state [label="类似"]
    command -> memento [label="常结合"]
    iterator -> composite [label="遍历"]
    template -> strategy [label="对比"]
    chain -> command [label="常结合"]
}
```

## 24. 错误语法测试

以下是无效的 DOT 语法，应该显示错误提示：

```dot
这不是有效的 DOT 语法
应该显示错误而不是崩溃
```

## 25. 普通代码块（不应被渲染）

以下是普通代码块，不应被 Graphviz 渲染：

```javascript
// 这是 JavaScript 代码，不是 DOT
const graphConfig = {
  type: 'digraph',
  nodes: ['A', 'B', 'C'],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' }
  ]
}

function renderGraph(config) {
  const dot = `digraph G { ${config.edges.map(e => `${e.from} -> ${e.to}`).join('; ')} }`
  return dot
}
```

```python
# 这是 Python 代码，也不是 DOT
import graphviz

dot = graphviz.Digraph(comment='Test')
dot.node('A', 'Node A')
dot.node('B', 'Node B')
dot.edge('A', 'B')
dot.render('output', format='svg')
```

## 26. 所有布局引擎测试

### dot 布局（默认，层次化）

```dot
digraph DotLayout {
    layout=dot
    label="layout=dot (默认层次化)"
    labelloc=t
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=9]
    A -> B -> C -> D -> E
    A -> C
    B -> D
    C -> E
    F -> B
    F -> D
}
```

### neato 布局（弹簧模型）

```dot
graph NeatoLayout {
    layout=neato
    label="layout=neato (弹簧模型)"
    labelloc=t
    node [shape=circle, style=filled, fillcolor="#C8E6C9", fontsize=9]
    A -- B -- C -- D -- E -- A
    A -- C
    B -- D
    C -- E
    B -- E
}
```

### fdp 布局（力导向）

```dot
graph FdpLayout {
    layout=fdp
    label="layout=fdp (力导向)"
    labelloc=t
    node [shape=circle, style=filled, fillcolor="#FFE0B2", fontsize=9]
    edge [len=1.2]
    center -- a1
    center -- a2
    center -- a3
    center -- a4
    center -- a5
    a1 -- b1
    a1 -- b2
    a2 -- b3
    a2 -- b4
    a3 -- b5
    a3 -- b6
    a4 -- b7
    a5 -- b8
    a5 -- b9
}
```

### sfdp 布局（大规模力导向）

```dot
graph SfdpLayout {
    layout=sfdp
    label="layout=sfdp (大规模力导向)"
    labelloc=t
    overlap=prism
    node [shape=point, width=0.15]
    n1 -- n2 -- n3 -- n4 -- n5
    n2 -- n6 -- n7 -- n8
    n3 -- n9 -- n10
    n4 -- n11 -- n12 -- n13
    n5 -- n14
    n6 -- n15 -- n16
    n7 -- n17 -- n18 -- n19
    n8 -- n20
    n9 -- n21 -- n22
    n10 -- n23 -- n24 -- n25
    n1 -- n15
    n5 -- n20
    n13 -- n25
}
```

### circo 布局（环形）

```dot
digraph CircoLayout {
    layout=circo
    label="layout=circo (环形)"
    labelloc=t
    node [shape=box, style="rounded,filled", fillcolor="#E1BEE7", fontsize=9]
    A -> B -> C -> D -> E -> F -> G -> H -> A
    A -> D
    B -> F
    C -> G
}
```

### twopi 布局（径向）

```dot
graph TwopiLayout {
    layout=twopi
    label="layout=twopi (径向)"
    labelloc=t
    root=center
    node [shape=circle, style=filled, fontsize=8]
    center [fillcolor="#F44336", fontcolor=white, fontsize=10]
    l1a [fillcolor="#FF9800"]
    l1b [fillcolor="#FF9800"]
    l1c [fillcolor="#FF9800"]
    l1d [fillcolor="#FF9800"]
    l2a [fillcolor="#FFC107"]
    l2b [fillcolor="#FFC107"]
    l2c [fillcolor="#FFC107"]
    l2d [fillcolor="#FFC107"]
    l2e [fillcolor="#FFC107"]
    l2f [fillcolor="#FFC107"]
    l2g [fillcolor="#FFC107"]
    l2h [fillcolor="#FFC107"]
    l3a [fillcolor="#CDDC39"]
    l3b [fillcolor="#CDDC39"]
    l3c [fillcolor="#CDDC39"]
    l3d [fillcolor="#CDDC39"]

    center -- l1a
    center -- l1b
    center -- l1c
    center -- l1d
    l1a -- l2a
    l1a -- l2b
    l1b -- l2c
    l1b -- l2d
    l1c -- l2e
    l1c -- l2f
    l1d -- l2g
    l1d -- l2h
    l2a -- l3a
    l2c -- l3b
    l2e -- l3c
    l2g -- l3d
}
```

### osage 布局（树图/打包）

```dot
digraph OsageLayout {
    layout=osage
    label="layout=osage (打包)"
    labelloc=t
    node [shape=box, style="filled,rounded", fontsize=9]

    subgraph cluster_a {
        label="Group A"
        fillcolor="#E3F2FD"
        style=filled
        a1 [fillcolor="#BBDEFB"]
        a2 [fillcolor="#BBDEFB"]
        a3 [fillcolor="#BBDEFB"]
    }
    subgraph cluster_b {
        label="Group B"
        fillcolor="#E8F5E9"
        style=filled
        b1 [fillcolor="#C8E6C9"]
        b2 [fillcolor="#C8E6C9"]
    }
    subgraph cluster_c {
        label="Group C"
        fillcolor="#FFF3E0"
        style=filled
        c1 [fillcolor="#FFE0B2"]
        c2 [fillcolor="#FFE0B2"]
        c3 [fillcolor="#FFE0B2"]
        c4 [fillcolor="#FFE0B2"]
    }
}
```

## 27. 边的高级特性

```dot
digraph EdgeFeatures {
    rankdir=LR
    node [shape=circle, style=filled, fillcolor="#E3F2FD", width=0.5, fontsize=9]

    // 多重边标签
    A -> B [label="label 1\nsecond line", fontsize=8]

    // 头尾标签
    C -> D [headlabel="head", taillabel="tail", labeldistance=2.5, fontsize=8]

    // 约束边
    E -> F [constraint=false, style=dashed, color=red, label="no constraint"]
    E -> G [label="normal"]

    // 权重
    H -> I [weight=10, label="weight=10", penwidth=3]
    H -> J [weight=1, label="weight=1", penwidth=1]

    // 颜色列表（多色边）
    K -> L [color="red:blue", penwidth=3]

    // 端口连接
    M [shape=record, label="<p1>port1|<p2>port2|<p3>port3"]
    N [shape=record, label="<q1>port1|<q2>port2"]
    M:p1 -> N:q1
    M:p2 -> N:q2
    M:p3 -> N:q1

    // 自环
    O -> O [label="self loop"]

    // 反向边
    P -> Q [dir=back, label="dir=back"]

    // 无箭头
    R -> S [arrowhead=none, arrowtail=none, label="no arrows"]
}
```

## 28. rank 控制和对齐

```dot
digraph RankControl {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor="#E3F2FD"]

    // 强制同一层级
    { rank=same; B; C; D }
    { rank=same; E; F }
    { rank=min; A }
    { rank=max; G }

    A [label="Start\n(rank=min)", fillcolor="#C8E6C9"]
    B [label="Step B"]
    C [label="Step C"]
    D [label="Step D"]
    E [label="Step E"]
    F [label="Step F"]
    G [label="End\n(rank=max)", fillcolor="#FFCDD2"]

    A -> B
    A -> C
    A -> D
    B -> E
    C -> E
    C -> F
    D -> F
    E -> G
    F -> G
}
```

## 29. 图属性全面测试

```dot
digraph GraphAttrs {
    // 图级属性
    label="图属性全面测试\nGraph Attributes Test"
    labelloc=t
    labeljust=c
    fontname="Helvetica"
    fontsize=14
    fontcolor="#1565C0"
    bgcolor="#FAFAFA"
    pad=0.5
    nodesep=0.8
    ranksep=1.0
    splines=ortho
    concentrate=true

    // 默认节点属性
    node [
        shape=box
        style="rounded,filled"
        fillcolor="#E3F2FD"
        fontname="Helvetica"
        fontsize=10
        margin="0.2,0.1"
        penwidth=1.5
    ]

    // 默认边属性
    edge [
        fontname="Helvetica"
        fontsize=8
        color="#666666"
        penwidth=1.2
    ]

    A [label="splines=ortho\n正交连线"]
    B [label="concentrate=true\n合并边"]
    C [label="nodesep=0.8"]
    D [label="ranksep=1.0"]
    E [label="pad=0.5"]

    A -> C
    A -> D
    B -> C
    B -> D
    C -> E
    D -> E
}
```

## 30. 超大节点数量（压力测试）

```dot
digraph StressTest {
    rankdir=LR
    node [shape=point, width=0.1]
    edge [arrowsize=0.5]

    // 50 个节点的链
    n0->n1->n2->n3->n4->n5->n6->n7->n8->n9
    n10->n11->n12->n13->n14->n15->n16->n17->n18->n19
    n20->n21->n22->n23->n24->n25->n26->n27->n28->n29
    n30->n31->n32->n33->n34->n35->n36->n37->n38->n39
    n40->n41->n42->n43->n44->n45->n46->n47->n48->n49

    // 跨链连接
    n0->n10->n20->n30->n40
    n9->n19->n29->n39->n49
    n5->n15->n25->n35->n45
    n3->n23->n43
    n7->n27->n47
    n1->n31
    n11->n41
    n2->n22->n42
    n8->n28->n48
    n4->n14->n24->n34->n44
    n6->n16->n26->n36->n46
}
```

## 31. 空图（边界测试）

```dot
digraph Empty {
}
```

## 32. 只有节点没有边

```dot
digraph NodesOnly {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontsize=10]
    A [label="孤立节点 A", fillcolor="#FFCDD2"]
    B [label="孤立节点 B", fillcolor="#C8E6C9"]
    C [label="孤立节点 C", fillcolor="#BBDEFB"]
    D [label="孤立节点 D", fillcolor="#FFE0B2"]
    E [label="孤立节点 E", fillcolor="#E1BEE7"]
}
```

## 33. 只有一个节点

```dot
digraph SingleNode {
    A [label="唯一节点", shape=doublecircle, style=filled, fillcolor="#FFF9C4", fontsize=14]
}
```

## 34. 超长标签文本

```dot
digraph LongLabels {
    rankdir=TB
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=9]

    a [label="这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的节点标签"]
    b [label="Short"]
    c [label="Another very very very very very very very very very very very very very very very very very very very very very very very very very very very very long label text for testing purposes"]

    a -> b -> c
}
```

## 35. 完全图 K6（每个节点都连接其他所有节点）

```dot
graph K6 {
    layout=circo
    label="完全图 K6"
    labelloc=t
    node [shape=circle, style=filled, fillcolor="#E1BEE7", width=0.4, fontsize=9]

    A -- B -- C -- D -- E -- F -- A
    A -- C -- E -- A
    A -- D
    B -- D -- F -- B
    B -- E
    C -- F
}
```

## 36. 二部图

```dot
graph Bipartite {
    rankdir=LR
    node [shape=circle, style=filled, fontsize=9]

    // 左侧集合
    { rank=same
      L1 [fillcolor="#BBDEFB"]
      L2 [fillcolor="#BBDEFB"]
      L3 [fillcolor="#BBDEFB"]
      L4 [fillcolor="#BBDEFB"]
    }

    // 右侧集合
    { rank=same
      R1 [fillcolor="#FFCDD2"]
      R2 [fillcolor="#FFCDD2"]
      R3 [fillcolor="#FFCDD2"]
    }

    L1 -- R1
    L1 -- R2
    L2 -- R1
    L2 -- R3
    L3 -- R2
    L3 -- R3
    L4 -- R1
    L4 -- R2
    L4 -- R3
}
```

## 37. 有向无环图 DAG（拓扑排序）

```dot
digraph DAG {
    rankdir=TB
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=9]
    edge [fontsize=8]

    // 课程先修关系
    math101 [label="数学基础\nMATH101"]
    cs101 [label="计算机导论\nCS101"]
    cs201 [label="数据结构\nCS201"]
    cs202 [label="算法设计\nCS202"]
    cs301 [label="操作系统\nCS301"]
    cs302 [label="计算机网络\nCS302"]
    cs303 [label="数据库系统\nCS303"]
    cs401 [label="编译原理\nCS401"]
    cs402 [label="分布式系统\nCS402"]
    cs403 [label="机器学习\nCS403"]
    math201 [label="线性代数\nMATH201"]
    math202 [label="概率统计\nMATH202"]

    math101 -> cs101
    math101 -> math201
    math101 -> math202
    cs101 -> cs201
    cs201 -> cs202
    cs201 -> cs301
    cs201 -> cs303
    cs202 -> cs401
    cs301 -> cs302
    cs301 -> cs402
    cs302 -> cs402
    cs303 -> cs402
    math201 -> cs403
    math202 -> cs403
    cs202 -> cs403
}
```

## 38. 多重子图嵌套（4 层）

```dot
digraph NestedClusters {
    node [shape=box, style="rounded,filled", fontsize=9]

    subgraph cluster_level1 {
        label="Level 1 - 公司"
        style="filled,rounded,bold"
        fillcolor="#ECEFF1"
        color="#455A64"
        fontsize=12

        subgraph cluster_level2a {
            label="Level 2 - 技术部"
            style="filled,rounded"
            fillcolor="#E3F2FD"
            color="#1565C0"

            subgraph cluster_level3a {
                label="Level 3 - 前端组"
                style="filled,rounded"
                fillcolor="#BBDEFB"
                color="#1976D2"

                subgraph cluster_level4a {
                    label="Level 4 - React 小队"
                    style="filled,dashed"
                    fillcolor="#90CAF9"
                    fe1 [label="张三", fillcolor="#64B5F6"]
                    fe2 [label="李四", fillcolor="#64B5F6"]
                }

                subgraph cluster_level4b {
                    label="Level 4 - Vue 小队"
                    style="filled,dashed"
                    fillcolor="#90CAF9"
                    fe3 [label="王五", fillcolor="#64B5F6"]
                }
            }

            subgraph cluster_level3b {
                label="Level 3 - 后端组"
                style="filled,rounded"
                fillcolor="#C8E6C9"
                color="#2E7D32"
                be1 [label="赵六", fillcolor="#A5D6A7"]
                be2 [label="孙七", fillcolor="#A5D6A7"]
                be3 [label="周八", fillcolor="#A5D6A7"]
            }
        }

        subgraph cluster_level2b {
            label="Level 2 - 产品部"
            style="filled,rounded"
            fillcolor="#FFF3E0"
            color="#E65100"
            pm1 [label="产品经理 A", fillcolor="#FFE0B2"]
            pm2 [label="产品经理 B", fillcolor="#FFE0B2"]
            designer [label="UI 设计师", fillcolor="#FFCCBC"]
        }
    }

    // 跨组协作
    pm1 -> fe1 [label="需求", style=dashed]
    pm1 -> be1 [label="需求", style=dashed]
    pm2 -> fe3 [label="需求", style=dashed]
    designer -> fe1 [label="设计稿", style=dotted, color=purple]
    designer -> fe2 [label="设计稿", style=dotted, color=purple]
    fe1 -> be1 [label="API 调用"]
    fe2 -> be2 [label="API 调用"]
    fe3 -> be3 [label="API 调用"]
    be1 -> be2 [label="RPC", style=dashed]
}
```

## 39. 同一节点多次引用（不同属性覆盖）

```dot
digraph NodeOverride {
    rankdir=LR
    // 第一次定义
    A [shape=box, label="初始定义", fillcolor=white, style="filled"]
    B [shape=circle, label="B"]
    C [shape=diamond, label="C"]

    A -> B -> C

    // 第二次引用覆盖属性
    A [fillcolor="#F44336", fontcolor=white, label="被覆盖了!"]
    B [fillcolor="#4CAF50", fontcolor=white, style=filled]

    C -> A [label="回环"]
}
```

## 40. 边的 compass point（精确端口方向）

```dot
digraph CompassPoints {
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", width=1.5, height=0.8, fontsize=10]

    A [label="Node A"]
    B [label="Node B"]
    C [label="Node C"]
    D [label="Node D"]

    // 使用 compass points 控制边的连接方向
    A:n -> B:s [label="A:n → B:s"]
    A:e -> C:w [label="A:e → C:w"]
    A:se -> D:nw [label="A:se → D:nw"]
    B:e -> C:n [label="B:e → C:n"]
    C:s -> D:n [label="C:s → D:n"]
    B:sw -> D:ne [label="B:sw → D:ne", style=dashed, color=red]
}
```

## 41. 子图间的边（跨集群连接）

```dot
digraph CrossCluster {
    compound=true
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor=white]

    subgraph cluster_0 {
        label="Cluster 0"
        style="filled,rounded"
        fillcolor="#E3F2FD"
        a0 [fillcolor="#BBDEFB"]
        a1 [fillcolor="#BBDEFB"]
        a2 [fillcolor="#BBDEFB"]
        a0 -> a1 -> a2
    }

    subgraph cluster_1 {
        label="Cluster 1"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        b0 [fillcolor="#C8E6C9"]
        b1 [fillcolor="#C8E6C9"]
        b2 [fillcolor="#C8E6C9"]
        b0 -> b1 -> b2
    }

    subgraph cluster_2 {
        label="Cluster 2"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        c0 [fillcolor="#FFE0B2"]
        c1 [fillcolor="#FFE0B2"]
        c0 -> c1
    }

    // 跨集群边（使用 lhead/ltail）
    a2 -> b0 [ltail=cluster_0, lhead=cluster_1, label="0→1"]
    b2 -> c0 [ltail=cluster_1, lhead=cluster_2, label="1→2"]
    a1 -> c0 [ltail=cluster_0, lhead=cluster_2, label="0→2", style=dashed]
}
```

## 42. 透明度和渐变

```dot
digraph Transparency {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontsize=10]

    a [label="不透明", fillcolor="#2196F3", fontcolor=white]
    b [label="半透明", fillcolor="#2196F380", fontcolor=white]
    c [label="更透明", fillcolor="#2196F340"]
    d [label="几乎透明", fillcolor="#2196F320"]

    e [label="红色", fillcolor="#F4433680", fontcolor=white]
    f [label="绿色", fillcolor="#4CAF5080", fontcolor=white]
    g [label="紫色", fillcolor="#9C27B080", fontcolor=white]

    a -> b -> c -> d
    e -> f -> g
    a -> e [style=dashed, color="#FF000080"]
    b -> f [style=dashed, color="#00FF0080"]
    c -> g [style=dashed, color="#0000FF80"]
}
```

## 43. 换行和转义字符

```dot
digraph Escaping {
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=10]

    a [label="第一行\n第二行\n第三行"]
    b [label="左对齐\l第二行\l第三行\l"]
    c [label="右对齐\r第二行\r第三行\r"]
    d [label="包含\"引号\""]
    e [label="包含\\反斜杠"]
    f [label="Tab\t分隔"]
    g [label="{record|with|pipes}", shape=record]

    a -> b -> c
    d -> e -> f -> g
}
```

## 44. 边的 label 位置控制

```dot
digraph LabelPlacement {
    rankdir=TB
    node [shape=circle, style=filled, fillcolor="#E3F2FD", width=0.5, fontsize=10]

    A -> B [label="居中标签", fontsize=9]
    A -> C [xlabel="外部标签\n(xlabel)", fontsize=8, fontcolor=red]
    B -> D [headlabel="头标签", taillabel="尾标签", fontsize=8]
    C -> D [label="带距离", labeldistance=3, labelangle=30, fontsize=8]
    D -> E [label="加粗边", style=bold, penwidth=3, fontsize=9]
    D -> F [label="弯曲", style=dashed, fontsize=9]

    { rank=same; B; C }
    { rank=same; E; F }
}
```

## 45. 连续多个 DOT 图（渲染器并发测试）

第一个：

```dot
digraph Concurrent1 {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#FFCDD2"]
    A1 -> B1 -> C1
}
```

第二个紧跟着：

```dot
digraph Concurrent2 {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#C8E6C9"]
    A2 -> B2 -> C2
}
```

第三个紧跟着：

```dot
digraph Concurrent3 {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#BBDEFB"]
    A3 -> B3 -> C3
}
```

第四个紧跟着：

```graphviz
digraph Concurrent4 {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#FFE0B2"]
    A4 -> B4 -> C4
}
```

第五个紧跟着：

```graphviz
digraph Concurrent5 {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#E1BEE7"]
    A5 -> B5 -> C5
}
```

以上 5 个图应该全部正常渲染，测试 WASM 实例复用和并发安全。

## 46. 超宽图（横向大量节点）

```dot
digraph WideGraph {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=8, width=0.6]

    S -> A1 -> A2 -> A3 -> A4 -> A5 -> A6 -> A7 -> A8 -> A9 -> A10 -> A11 -> A12 -> A13 -> A14 -> A15 -> E
    S [label="Start", fillcolor="#C8E6C9"]
    E [label="End", fillcolor="#FFCDD2"]
}
```

## 47. 超深图（纵向大量层级）

```dot
digraph DeepGraph {
    rankdir=TB
    node [shape=ellipse, style=filled, fillcolor="#E3F2FD", fontsize=8]

    L0 [label="Level 0", fillcolor="#F44336", fontcolor=white]
    L1 [label="Level 1"]
    L2 [label="Level 2"]
    L3 [label="Level 3"]
    L4 [label="Level 4"]
    L5 [label="Level 5"]
    L6 [label="Level 6"]
    L7 [label="Level 7"]
    L8 [label="Level 8"]
    L9 [label="Level 9"]
    L10 [label="Level 10"]
    L11 [label="Level 11"]
    L12 [label="Level 12"]
    L13 [label="Level 13"]
    L14 [label="Level 14"]
    L15 [label="Level 15", fillcolor="#4CAF50", fontcolor=white]

    L0->L1->L2->L3->L4->L5->L6->L7->L8->L9->L10->L11->L12->L13->L14->L15
}
```

## 48. 注释测试

```dot
// 这是 C++ 风格注释
/* 这是 C 风格注释 */
# 这是 shell 风格注释
digraph Comments {
    // 节点定义
    A [label="注释不影响渲染"]
    B [label="各种注释风格"]
    /* 边定义 */
    A -> B // 行尾注释
    # 最后一行注释
}
```

## 49. Unicode 和特殊 ID

```dot
digraph UnicodeIDs {
    rankdir=LR
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=10]

    "节点-甲" -> "节点-乙" [label="中文 ID"]
    "node with spaces" -> "another node" [label="空格 ID"]
    "123numeric" -> "456start" [label="数字开头"]
    "_underscore" -> "__double" [label="下划线"]
    "special!@#" -> "chars$%^" [label="特殊字符"]
    "very-long-node-identifier-name-for-testing" -> "short" [label="长 ID"]
}
```

## 50. 混合有向图和属性继承

```dot
digraph Inheritance {
    // 全局默认
    node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", fontsize=10]
    edge [color="#666", fontsize=8]

    // 子图覆盖默认
    subgraph cluster_override {
        label="覆盖默认属性"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        node [fillcolor="#FFE0B2", shape=ellipse]  // 子图内覆盖
        edge [color=red, style=dashed]

        x1 [label="椭圆+橙色"]
        x2 [label="继承子图属性"]
        x1 -> x2
    }

    // 子图外恢复全局默认
    y1 [label="方框+蓝色"]
    y2 [label="恢复全局默认"]
    y1 -> y2

    // 单节点覆盖
    z1 [label="单独覆盖", shape=diamond, fillcolor="#F44336", fontcolor=white]

    x2 -> y1 [label="跨子图"]
    y2 -> z1
}
```

---

## MD Viewer 系统专属补充测试

> 以下用例进一步围绕 MD Viewer 内部架构展开。

## 51. IPC 通信全景图

```dot
digraph IPC {
    rankdir=LR
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor=white]
    edge [fontsize=8]

    subgraph cluster_renderer {
        label="Renderer Process"
        style="filled,rounded"
        fillcolor="#E3F2FD"
        color="#1565C0"
        fontsize=11

        App [label="App.tsx", fillcolor="#BBDEFB"]
        FileTree [label="FileTree.tsx", fillcolor="#BBDEFB"]
        VM [label="VirtualizedMarkdown", fillcolor="#BBDEFB"]
        Nav [label="NavigationBar", fillcolor="#BBDEFB"]
        Settings [label="SettingsPanel", fillcolor="#BBDEFB"]
    }

    subgraph cluster_preload {
        label="Preload (contextBridge)"
        style="filled,rounded"
        fillcolor="#FFF9C4"
        color="#F9A825"
        fontsize=11

        api [label="window.api", fillcolor="#FFF59D"]
    }

    subgraph cluster_main {
        label="Main Process"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        color="#2E7D32"
        fontsize=11

        index [label="index.ts\nipcMain.handle", fillcolor="#C8E6C9"]
        appData [label="appDataManager.ts", fillcolor="#C8E6C9"]
        shortcuts [label="shortcuts.ts", fillcolor="#C8E6C9"]
        ctxMenu [label="contextMenuHandler.ts", fillcolor="#C8E6C9"]
        clipboard [label="clipboardManager.ts", fillcolor="#C8E6C9"]
        pandoc [label="pandocExporter.ts", fillcolor="#C8E6C9"]
    }

    subgraph cluster_fs {
        label="系统资源"
        style="filled,rounded"
        fillcolor="#FFF3E0"
        color="#E65100"
        fontsize=11

        files [label="文件系统\n.md 文件", fillcolor="#FFE0B2"]
        store [label="electron-store\n持久化", fillcolor="#FFE0B2"]
        shell [label="shell\nopenExternal", fillcolor="#FFE0B2"]
    }

    // Renderer -> Preload
    App -> api [label="readFile\nwriteFile"]
    FileTree -> api [label="readDir\ngetFileInfo"]
    VM -> api [label="openExternal"]
    Nav -> api [label="toggleAlwaysOnTop"]
    Settings -> api [label="getSettings\nsaveSettings"]

    // Preload -> Main
    api -> index [label="ipcRenderer.invoke"]

    // Main -> 系统
    index -> files [label="fs.readFile"]
    index -> appData [label="书签/标签"]
    appData -> store [label="读写"]
    index -> shell [label="打开链接"]
    shortcuts -> index [label="注册快捷键"]
    ctxMenu -> index [label="右键菜单"]
    clipboard -> index [label="剪贴板"]
    pandoc -> files [label="导出 DOCX"]
}
```

## 52. 图表工具栏悬停显示架构

```dot
digraph ChartToolbar {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor="#E3F2FD"]
    edge [fontsize=8]

    container [label="图表容器\n.chart-container", fillcolor="#BBDEFB"]
    toolbar [label="工具栏\n.chart-toolbar\n(opacity: 0)", fillcolor="#FFF9C4"]
    hover [label="mouseenter 事件", shape=ellipse, fillcolor="#C8E6C9"]
    leave [label="mouseleave 事件", shape=ellipse, fillcolor="#FFCDD2"]

    subgraph cluster_buttons {
        label="工具栏按钮"
        style="filled,rounded"
        fillcolor="#F5F5F5"
        btn_fullscreen [label="全屏查看"]
        btn_copy [label="复制代码"]
        btn_download [label="下载 SVG"]
        btn_zoom_in [label="放大"]
        btn_zoom_out [label="缩小"]
        btn_reset [label="重置"]
    }

    subgraph cluster_charts {
        label="支持的图表类型"
        style="filled,rounded"
        fillcolor="#E8F5E9"
        mermaid [label="Mermaid", fillcolor="#C8E6C9"]
        echarts [label="ECharts", fillcolor="#C8E6C9"]
        plantuml [label="PlantUML", fillcolor="#C8E6C9"]
        graphviz [label="Graphviz", fillcolor="#C8E6C9"]
        markmap [label="Markmap", fillcolor="#C8E6C9"]
        drawio [label="DrawIO", fillcolor="#C8E6C9"]
    }

    container -> hover [label="鼠标进入"]
    hover -> toolbar [label="opacity: 1\ntransition 0.2s"]
    container -> leave [label="鼠标离开"]
    leave -> toolbar [label="opacity: 0\ntransition 0.2s"]

    toolbar -> btn_fullscreen
    toolbar -> btn_copy
    toolbar -> btn_download
    toolbar -> btn_zoom_in
    toolbar -> btn_zoom_out
    toolbar -> btn_reset

    mermaid -> container
    echarts -> container
    plantuml -> container
    graphviz -> container
    markmap -> container
    drawio -> container
}
```

## 53. 导出 HTML 所见即所得流程

```graphviz
digraph ExportHTML {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor="#E3F2FD"]
    edge [fontsize=8]

    start [label="用户点击\n导出 HTML", shape=ellipse, fillcolor="#C8E6C9"]

    clone [label="1. 克隆当前 DOM\ndocument.cloneNode(true)"]
    css [label="2. 内联所有 CSS\ngetComputedStyle → inline"]
    mermaid [label="3. Mermaid SVG\n已渲染，直接保留"]
    echarts [label="4. ECharts\ngetDataURL() → img"]
    plantuml [label="5. PlantUML SVG\n已渲染，直接保留"]
    graphviz [label="6. Graphviz SVG\n已渲染，直接保留"]
    markmap [label="7. Markmap SVG\n已渲染，直接保留"]
    drawio [label="8. DrawIO SVG\n已渲染，直接保留"]
    katex [label="9. KaTeX CSS\n内联 + CDN 降级"]
    prism [label="10. 代码高亮\n内联 Prism 样式"]
    assemble [label="11. 组装完整 HTML\n<!DOCTYPE html>..."]
    write [label="12. 写入文件\nfs.writeFile()"]
    done [label="导出完成\nToast 通知", shape=ellipse, fillcolor="#C8E6C9"]

    start -> clone -> css
    css -> mermaid
    css -> echarts
    css -> plantuml
    css -> graphviz
    css -> markmap
    css -> drawio
    mermaid -> katex
    echarts -> katex
    plantuml -> katex
    graphviz -> katex
    markmap -> katex
    drawio -> katex
    katex -> prism -> assemble -> write -> done
}
```

## 54. 安全边界检查决策树

```dot
digraph SecurityCheck {
    rankdir=TB
    node [shape=box, style="rounded,filled", fontsize=9, fillcolor="#E3F2FD"]
    edge [fontsize=8]

    input [label="用户输入/操作", shape=ellipse, fillcolor="#FFF9C4"]

    check_path [label="路径检查\nallowedBasePath", shape=diamond, fillcolor="#FFE0B2"]
    check_protocol [label="协议检查\nhttp/https only", shape=diamond, fillcolor="#FFE0B2"]
    check_navigate [label="导航检查\nwill-navigate", shape=diamond, fillcolor="#FFE0B2"]
    check_dom [label="DOM 净化\nDOMPurify", shape=diamond, fillcolor="#FFE0B2"]

    allow [label="✅ 允许操作", fillcolor="#C8E6C9"]
    block [label="❌ 阻止操作", fillcolor="#FFCDD2"]
    sanitize [label="🧹 净化后输出", fillcolor="#B3E5FC"]

    input -> check_path [label="文件操作"]
    input -> check_protocol [label="链接点击"]
    input -> check_navigate [label="页面导航"]
    input -> check_dom [label="HTML 渲染"]

    check_path -> allow [label="在允许范围内"]
    check_path -> block [label="路径遍历"]

    check_protocol -> allow [label="http/https"]
    check_protocol -> block [label="file://\njavascript:"]

    check_navigate -> allow [label="同源"]
    check_navigate -> block [label="非同源"]

    check_dom -> sanitize [label="移除危险标签"]
}
```

## 55. 窗口生命周期状态机

```graphviz
digraph WindowLifecycle {
    rankdir=LR
    node [shape=ellipse, style=filled, fillcolor="#E3F2FD", fontsize=9]
    edge [fontsize=8]

    created [label="窗口创建\nnew BrowserWindow", fillcolor="#C8E6C9"]
    loading [label="加载中\nloadURL", fillcolor="#FFF9C4"]
    ready [label="就绪\nready-to-show", fillcolor="#A5D6A7", shape=doublecircle]
    focused [label="获得焦点\nfocus", fillcolor="#81C784"]
    blurred [label="失去焦点\nblur", fillcolor="#E0E0E0"]
    minimized [label="最小化\nminimize", fillcolor="#BDBDBD"]
    maximized [label="最大化\nmaximize", fillcolor="#90CAF9"]
    fullscreen [label="全屏\nenter-full-screen", fillcolor="#64B5F6"]
    closing [label="关闭中\nclose", fillcolor="#FFCDD2"]
    destroyed [label="已销毁\nclosed", fillcolor="#EF9A9A"]

    created -> loading [label="loadURL()"]
    loading -> ready [label="did-finish-load"]
    ready -> focused [label="show()"]
    focused -> blurred [label="blur"]
    blurred -> focused [label="focus"]
    focused -> minimized [label="minimize()"]
    minimized -> focused [label="restore()"]
    focused -> maximized [label="maximize()"]
    maximized -> focused [label="unmaximize()"]
    focused -> fullscreen [label="setFullScreen(true)"]
    fullscreen -> focused [label="setFullScreen(false)"]
    focused -> closing [label="close()"]
    blurred -> closing [label="close()"]
    closing -> destroyed [label="destroy()"]
}
```
