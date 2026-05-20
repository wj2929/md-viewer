# Kroki 兼容层测试

## 1. Nomnoml 系统图

```nomnoml
[User] -> [MD Viewer]
[MD Viewer] -> [DOCX Service]
[MD Viewer] -> [RendererPlugin]
```

## 2. Nomnoml 分层

```nomnoml
[<frame> Desktop|
  [React Renderer] -> [Chart Hooks]
  [Chart Hooks] -> [SVG Export]
]
[SVG Export] -> [DOCX Service]
```

## 3. Nomnoml 状态

```nomnoml
[Preview] -> [Edit Mode]
[Edit Mode] -> [Dirty Draft]
[Dirty Draft] -> [Saved]
[Dirty Draft] -> [Discarded]
```

## 4. Pikchr 时序

```pikchr
box "Open Markdown" wid 1.55 ht 0.48
arrow right 0.45
box "Normalize fences" wid 1.75 ht 0.48
arrow right 0.45
box "Render SVG" wid 1.45 ht 0.48
arrow right 0.45
box "Export" wid 1.1 ht 0.48
```

## 5. Pikchr 架构

```pikchr
box "RendererPlugin" wid 1.85 ht 0.5
arrow right 0.65
box "Manifest" wid 1.25 ht 0.5
arrow down 0.55
box "DOCX Service" wid 1.65 ht 0.5
```

## 6. Pikchr 质量门

```pikchr
circle "Plan" rad 0.38
arrow right 0.4
circle "Implement" rad 0.58
arrow right 0.4
circle "Test" rad 0.38
arrow right 0.4
circle "Release" rad 0.5
```

## 7. SvgBob 网络

```svgbob
+-----------+    +------------+
| Preview   | -> | Renderer   |
+-----------+    +------------+
      |                |
      v                v
+-----------+    +------------+
| HTML      | -> | DOCX       |
+-----------+    +------------+
```

## 8. SvgBob 流程

```svgbob
+--------+    +--------+    +--------+
| read   | -> | parse  | -> | draw   |
+--------+    +--------+    +--------+
```

## 9. Bytefield 数据包

```bytefield
(defattrs :bg-green {:fill "#d5f5e3"})
(draw-column-headers)
(draw-box "magic" {:span 4})
(draw-box "version" {:span 4})
(draw-box "flags" {:span 8})
(draw-box "payload length" {:span 8 :attrs :bg-green})
(draw-box "checksum" {:span 8})
(draw-box "payload type" {:span 4})
(draw-box "encoding" {:span 4})
(draw-box "reserved" {:span 8})
```

## 10. Bytefield 导出任务

```bytefield
(draw-column-headers)
(draw-box "task id" {:span 8})
(draw-box "renderer type" {:span 8})
(draw-box "status" {:span 4})
(draw-box "warning count" {:span 4})
(draw-box "output format" {:span 8})
(draw-box "artifact kb" {:span 8})
(draw-box "duration ms" {:span 8})
(draw-box "worker id" {:span 8})
(draw-box "retry count" {:span 8})
```

## 11. TikZ 简图

```tikz
\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\tikzset{
  stepbox/.style={draw, rounded corners=2pt, minimum width=2.4cm, minimum height=1cm, inner xsep=10pt, inner ysep=6pt, align=center, font=\sffamily\scriptsize},
  flow/.style={-{Stealth[length=2mm]}, thick}
}
\begin{document}
\begin{tikzpicture}[node distance=1.55cm]
\node[stepbox] (a) {Markdown};
\node[stepbox, right=of a] (b) {SVG};
\node[stepbox, right=of b] (c) {PDF};
\draw[flow] (a) -- (b);
\draw[flow] (b) -- (c);
\end{tikzpicture}
\end{document}
```

## 12. TikZ 架构节点

```tikz
\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\tikzset{
  module/.style={draw, rounded corners=2pt, minimum width=2.4cm, minimum height=0.95cm, inner xsep=10pt, inner ysep=6pt, align=center, font=\sffamily\scriptsize},
  flow/.style={-{Stealth[length=2mm]}, thick}
}
\begin{document}
\begin{tikzpicture}[node distance=1.65cm and 1.9cm]
\node[module] (r) {Renderer};
\node[module, above right=of r] (m) {Manifest};
\node[module, below right=of m] (d) {DOCX};
\draw[flow] (r) -- (m);
\draw[flow] (m) -- (d);
\end{tikzpicture}
\end{document}
```

## 13. Nomnoml 服务分层

```nomnoml
#direction: right
[<actor> Editor] -> [Gateway]
[Gateway] -> [Auth]
[Gateway] -> [Renderer]
[Renderer] -> [<database> Cache]
[Renderer] -> [Export Worker]
[Export Worker] -> [<database> Artifact Store]
[Export Worker] -> [Notification]
[Notification] -> [<actor> Reviewer]
```

## 14. Nomnoml 领域关系

```nomnoml
#direction: right
[Workspace]++-[Document]
[Document]++-[Version]
[Document]++-[Comment Thread]
[Comment Thread]++-[Comment]
[Document]++-[Attachment]
[User] -> [Comment]
[User] -> [Version]
[Attachment] -> [Asset Store]
```

## 15. Nomnoml 状态机

```nomnoml
#direction: down
[Draft] -> [Review]
[Review] -> [Approved]
[Review] -> [Rejected]
[Rejected] -> [Draft]
[Approved] -> [Published]
[Published] -> [Archived]
[Archived] -> [Restored]
[Restored] -> [Published]
```

## 16. Pikchr 部署链路

```pikchr
box "Developer" fit
arrow right 120%
box "Git" fit
arrow right 120%
box "CI" fit
arrow right 120%
box "Artifact" fit
arrow down 90%
box "Staging" fit
arrow left 120%
box "Approval" fit
arrow left 120%
box "Production" fit
```

## 17. Pikchr 数据处理

```pikchr
box "Raw Events" fit
arrow right 120%
box "Schema Check" fit
arrow right 120%
box "Quality Gate" fit
arrow right 120%
box "Warehouse" fit
arrow down 100%
box "Dashboard" fit
arrow left 120%
box "Alerting" fit
arrow left 120%
box "Data Steward" fit
```

## 18. SvgBob 微服务网络

```svgbob
+-----------+    +-----------+    +---------+
| Browser   | -> | Gateway   | -> | Render  |
+-----------+    +-----------+    +---------+
                     |                |
                     v                v
                 +--------+       +--------+
                 | Auth   |       | Cache  |
                 +--------+       +--------+
                     |
                     v
                 +--------+
                 | UserDB |
                 +--------+
```

## 19. SvgBob 批处理拓扑

```svgbob
+-----------+    +------------+    +-----------+
| Scheduler | -> | Job Queue  | -> | Worker    |
+-----------+    +------------+    +-----------+
      |                |                |
      v                v                v
+-----------+    +------------+    +-----------+
| Calendar  |    | DeadLetter |    | Artifacts |
+-----------+    +------------+    +-----------+
```

## 20. SvgBob 数据血缘

```svgbob
+-----+    +-----+    +-----+    +------+
| CRM | -> | ODS | -> | DWD | -> | MART |
+-----+    +-----+    +-----+    +------+
   |          ^          ^          |
   v          |          |          v
+------+      |      +------+    +------+
| Logs | -----+      | ERP  | -> | BI   |
+------+             +------+    +------+
```

## 21. Bytefield 鉴权 Token

```bytefield
(defattrs :bg-blue {:fill "#d6eaff"})
(defattrs :bg-red {:fill "#ffe1e1"})
(draw-column-headers)
(draw-box "version" {:span 2 :attrs :bg-blue})
(draw-box "key id" {:span 6})
(draw-box "tenant id" {:span 8})
(draw-box "issued at" {:span 8})
(draw-box "expires at" {:span 8})
(draw-box "scope bitmap" {:span 8 :attrs :bg-red})
(draw-box "session flags" {:span 8})
(draw-box "signature a" {:span 16})
(draw-box "signature b" {:span 16})
```

## 22. Bytefield 渲染任务消息

```bytefield
(defattrs :bg-green {:fill "#d5f5e3"})
(draw-column-headers)
(draw-box "message type" {:span 4})
(draw-box "renderer" {:span 4})
(draw-box "priority" {:span 4})
(draw-box "retry count" {:span 4})
(draw-box "block id hash" {:span 16})
(draw-box "source bytes" {:span 8})
(draw-box "timeout ms" {:span 8})
(draw-box "route flags" {:span 8})
(draw-box "schema id" {:span 8})
(draw-box "payload chunk 1" {:span 16 :attrs :bg-green})
(draw-box "payload chunk 2" {:span 16 :attrs :bg-green})
```

## 23. TikZ 多层架构

```tikz
\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\tikzset{
  service/.style={draw, rounded corners=2pt, minimum width=2.55cm, minimum height=0.95cm, inner xsep=10pt, inner ysep=6pt, align=center, font=\sffamily\scriptsize},
  flow/.style={-{Stealth[length=2mm]}, thick}
}
\begin{document}
\begin{tikzpicture}[node distance=1.75cm and 2.05cm]
\node[service] (u) {User};
\node[service, right=of u] (g) {Gateway};
\node[service, above right=of g] (a) {Auth};
\node[service, below right=of g] (r) {Renderer};
\node[service, below right=of a] (d) {Database};
\draw[flow] (u) -- (g);
\draw[flow] (g) -- (a);
\draw[flow] (g) -- (r);
\draw[flow] (a) -- (d);
\draw[flow] (r) -- (d);
\end{tikzpicture}
\end{document}
```

## 24. TikZ 发布流程

```tikz
\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\tikzset{
  stage/.style={draw, rounded corners=2pt, minimum width=1.9cm, minimum height=0.88cm, inner xsep=10pt, inner ysep=6pt, align=center, font=\sffamily\scriptsize},
  flow/.style={-{Stealth[length=2mm]}, thick}
}
\begin{document}
\begin{tikzpicture}[node distance=1.25cm]
\node[stage] (code) {Code};
\node[stage, right=of code] (test) {Test};
\node[stage, right=of test] (build) {Build};
\node[stage, right=of build] (stage) {Stage};
\node[stage, right=of stage] (prod) {Prod};
\draw[flow] (code) -- (test);
\draw[flow] (test) -- (build);
\draw[flow] (build) -- (stage);
\draw[flow] (stage) -- (prod);
\draw[flow, bend left=35] (test) to (code);
\end{tikzpicture}
\end{document}
```
