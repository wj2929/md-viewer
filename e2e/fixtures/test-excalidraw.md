# Excalidraw 渲染测试

本文档集中覆盖 Excalidraw 渲染器的正常路径、架构图样式、复杂布局、边界条件和错误降级。
用例参考了 Excalidraw 官方 JSON 结构、Excalidraw Architect MCP 的图拓扑建议、mermaid-to-excalidraw 的转换覆盖，以及本项目已有 Mermaid / Graphviz / DrawIO fixture 的组织方式。

## 1. 基础代码块

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "source": "md-viewer-excalidraw-fixture",
  "elements": [
    {
      "id": "code-card",
      "type": "rectangle",
      "x": 0,
      "y": 0,
      "width": 420,
      "height": 160,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#e8f4ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": {
        "type": 3
      },
      "seed": 2079,
      "version": 1,
      "versionNonce": 2079,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "code-title",
      "type": "text",
      "x": 86,
      "y": 38,
      "width": 248,
      "height": 45,
      "angle": 0,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 2080,
      "version": 1,
      "versionNonce": 2080,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "fontSize": 36,
      "fontFamily": 5,
      "text": "代码块渲染",
      "originalText": "代码块渲染",
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": null,
      "lineHeight": 1.25,
      "autoResize": true
    },
    {
      "id": "code-note",
      "type": "text",
      "x": 103,
      "y": 100,
      "width": 214,
      "height": 25,
      "angle": 0,
      "strokeColor": "#4b5563",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "frameId": null,
      "roundness": null,
      "seed": 2081,
      "version": 1,
      "versionNonce": 2081,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "fontSize": 20,
      "fontFamily": 5,
      "text": "Markdown fenced block",
      "originalText": "Markdown fenced block",
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": null,
      "lineHeight": 1.25,
      "autoResize": true
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

## 2. 基础文件引用

![基础流程](./excalidraw/basic-flow.excalidraw)

## 3. 带查询参数的文件引用

![带查询参数](./excalidraw/sequence-flow.excalidraw?raw=1#demo)

## 4. 内嵌图片资源

![内嵌图片](./excalidraw/embedded-image.excalidraw)

## 5. 缺失图片资源警告

![缺失图片资源](./excalidraw/missing-image.excalidraw)

## 6. 空画布警告

![空画布](./excalidraw/empty.excalidraw)

## 7. MCP 风格：网关扇出

![网关扇出](./excalidraw/gateway-fanout.excalidraw)

## 8. MCP 风格：电商平台架构

![电商平台架构](./excalidraw/ecommerce-platform.excalidraw)

## 9. 支付决策流程

![支付决策流程](./excalidraw/payment-decision-flow.excalidraw)

## 10. 数据管道

![数据管道](./excalidraw/data-pipeline.excalidraw)

## 11. 分层架构

![分层架构](./excalidraw/layered-architecture.excalidraw)

## 12. Hub 扇出

![Hub 扇出](./excalidraw/hub-fanout.excalidraw)

## 13. 断开子图

![断开子图](./excalidraw/disconnected-monitoring.excalidraw)

## 14. 状态机

![状态机](./excalidraw/state-machine.excalidraw)

## 15. 决策树

![决策树](./excalidraw/decision-tree.excalidraw)

## 16. 形状库

![形状库](./excalidraw/shapes-gallery.excalidraw)

## 17. 样式库

![样式库](./excalidraw/style-gallery.excalidraw)

## 18. Unicode 与长文本

![Unicode 与长文本](./excalidraw/text-unicode.excalidraw)

## 19. 负坐标

![负坐标](./excalidraw/negative-coordinates.excalidraw)

## 20. 旋转元素

![旋转元素](./excalidraw/rotated-elements.excalidraw)

## 21. 删除元素

![删除元素](./excalidraw/deleted-elements.excalidraw)

## 22. 较大但均衡的架构图

![较大但均衡](./excalidraw/large-balanced-graph.excalidraw)

## 23. 深色背景

![深色背景](./excalidraw/dark-background.excalidraw)

## 24. 兼容模式警告

![兼容模式](./excalidraw/compatible-no-type.excalidraw)

## 25. 绑定文本容器

![绑定文本容器](./excalidraw/bound-text-containers.excalidraw)

## 26. 箭头绑定

![箭头绑定](./excalidraw/arrow-bindings.excalidraw)

## 27. Frame 元素

![Frame 元素](./excalidraw/frame-layout.excalidraw)

## 28. 自由绘制线条

![自由绘制线条](./excalidraw/freedraw-sketch.excalidraw)

## 29. 多段箭头

![多段箭头](./excalidraw/polyline-arrows.excalidraw)

## 30. 箭头头部集合

![箭头头部集合](./excalidraw/arrowhead-gallery.excalidraw)

## 31. Mermaid flowchart 形状

![Mermaid flowchart 形状](./excalidraw/mermaid-flowchart-shapes.excalidraw)

## 32. Sequence 生命线

![Sequence 生命线](./excalidraw/sequence-lifelines.excalidraw)

## 33. Class Diagram

![Class Diagram](./excalidraw/class-diagram.excalidraw)

## 34. ER Diagram

![ER Diagram](./excalidraw/er-diagram.excalidraw)

## 35. 复合状态图

![复合状态图](./excalidraw/state-composite.excalidraw)

## 36. Subgraph 集群

![Subgraph 集群](./excalidraw/subgraph-clusters.excalidraw)

## 37. 泳道流程

![泳道流程](./excalidraw/swimlane-process.excalidraw)

## 38. 时间线

![时间线](./excalidraw/timeline.excalidraw)

## 39. 网络拓扑

![网络拓扑](./excalidraw/network-topology.excalidraw)

## 40. 思维导图

![思维导图](./excalidraw/mind-map.excalidraw)

## 41. 看板布局

![看板布局](./excalidraw/kanban-board.excalidraw)

## 42. 数据库复制

![数据库复制](./excalidraw/database-replication.excalidraw)

## 43. 事件溯源

![事件溯源](./excalidraw/event-sourcing.excalidraw)

## 44. 密集注释

![密集注释](./excalidraw/dense-annotations.excalidraw)

## 45. 小元素网格

![小元素网格](./excalidraw/tiny-elements.excalidraw)

## 46. 纵向长流程

![纵向长流程](./excalidraw/tall-flow.excalidraw)

## 47. 横向宽画布

![横向宽画布](./excalidraw/wide-canvas.excalidraw)

## 48. 分组元素

![分组元素](./excalidraw/grouped-elements.excalidraw)

## 49. PlantUML 迁移：高级序列图

![PlantUML 高级序列图](./excalidraw/plantuml-sequence-advanced.excalidraw)

## 50. PlantUML 迁移：渲染器类图

![PlantUML 渲染器类图](./excalidraw/plantuml-class-renderers.excalidraw)

## 51. PlantUML 迁移：用例图

![PlantUML 用例图](./excalidraw/plantuml-use-case.excalidraw)

## 52. PlantUML 迁移：组件图

![PlantUML 组件图](./excalidraw/plantuml-component-packages.excalidraw)

## 53. PlantUML 迁移：对象图

![PlantUML 对象图](./excalidraw/plantuml-object-graph.excalidraw)

## 54. PlantUML 迁移：部署图

![PlantUML 部署图](./excalidraw/plantuml-deployment.excalidraw)

## 55. PlantUML 迁移：Timing Diagram

![PlantUML Timing Diagram](./excalidraw/plantuml-timing-diagram.excalidraw)

## 56. PlantUML 迁移：甘特图

![PlantUML 甘特图](./excalidraw/plantuml-gantt-plan.excalidraw)

## 57. PlantUML 迁移：WBS

![PlantUML WBS](./excalidraw/plantuml-wbs.excalidraw)

## 58. PlantUML 迁移：JSON/YAML 数据

![PlantUML JSON YAML 数据](./excalidraw/plantuml-config-data.excalidraw)

## 59. PlantUML 迁移：Salt 线框

![PlantUML Salt 线框](./excalidraw/plantuml-salt-wireframe.excalidraw)

## 60. PlantUML 迁移：Creole 富文本

![PlantUML Creole 富文本](./excalidraw/plantuml-creole-note.excalidraw)

## 61. PlantUML 迁移：链接类图

![PlantUML 链接类图](./excalidraw/plantuml-hyperlinks.excalidraw)

## 62. PlantUML 迁移：Stereotypes

![PlantUML Stereotypes](./excalidraw/plantuml-stereotypes.excalidraw)

## 63. PlantUML 迁移：颜色分层图

![PlantUML 颜色分层图](./excalidraw/plantuml-gradient-layers.excalidraw)

## 64. PlantUML 迁移：复杂导出序列

![PlantUML 复杂导出序列](./excalidraw/plantuml-export-sequence.excalidraw)

## 65. 错误文件：JSON 格式错误

![错误 JSON](./excalidraw/invalid-json.excalidraw)

## 66. 错误文件：缺少 elements

![缺少 elements](./excalidraw/missing-elements.excalidraw)

## 67. 错误文件：根节点是数组

![根节点数组](./excalidraw/array-root.excalidraw)

## 68. 错误文件：元素数量超限

![元素数量超限](./excalidraw/too-many-elements.excalidraw)

## 69. 错误文件：文件不存在

![缺失文件](./excalidraw/missing.excalidraw)

## 70. 与 Mermaid 对比

```mermaid
graph TD
  A[开始] --> B[处理] --> C[结束]
```
