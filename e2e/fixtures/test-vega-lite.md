# Vega-Lite Renderer 综合测试

本文档覆盖 Vega-Lite 常见统计图、组合图、分面图、中文标签和响应式宽度场景。所有数据均使用 `data.values`，避免依赖网络数据源。

---

## 1. 中文分类柱状图

```vega-lite
{
  "width": 640,
  "height": 320,
  "data": { "values": [
    { "category": "预览", "success": 18, "failed": 2, "owner": "渲染组" },
    { "category": "导出", "success": 11, "failed": 5, "owner": "导出组" },
    { "category": "编辑", "success": 9, "failed": 4, "owner": "编辑组" },
    { "category": "搜索", "success": 6, "failed": 1, "owner": "导航组" },
    { "category": "图表", "success": 15, "failed": 3, "owner": "插件组" }
  ] },
  "transform": [
    { "calculate": "datum.success + datum.failed", "as": "total" },
    { "fold": ["success", "failed"], "as": ["status", "count"] },
    { "calculate": "datum.status === 'success' ? '成功' : '失败'", "as": "statusLabel" }
  ],
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "category", "type": "nominal", "axis": { "title": "功能模块" } },
        "y": { "field": "count", "type": "quantitative", "axis": { "title": "用例数量" } },
        "color": { "field": "statusLabel", "type": "nominal", "title": "状态" },
        "tooltip": [
          { "field": "category", "type": "nominal", "title": "模块" },
          { "field": "owner", "type": "nominal", "title": "负责人" },
          { "field": "statusLabel", "type": "nominal", "title": "状态" },
          { "field": "count", "type": "quantitative", "title": "数量" }
        ]
      }
    },
    {
      "transform": [{ "filter": "datum.status === 'success'" }],
      "mark": { "type": "text", "dy": -8, "fontSize": 12 },
      "encoding": {
        "x": { "field": "category", "type": "nominal" },
        "y": { "field": "total", "type": "quantitative" },
        "text": { "field": "total", "type": "quantitative" }
      }
    }
  ]
}
```

## 2. 折线趋势图

```vega-lite
{
  "width": 640,
  "data": { "values": [
    { "day": "周一", "value": 42, "errors": 3, "stage": "预览" },
    { "day": "周二", "value": 55, "errors": 5, "stage": "导出" },
    { "day": "周三", "value": 49, "errors": 2, "stage": "预览" },
    { "day": "周四", "value": 68, "errors": 7, "stage": "图表" },
    { "day": "周五", "value": 72, "errors": 4, "stage": "图表" },
    { "day": "周六", "value": 64, "errors": 6, "stage": "导出" },
    { "day": "周日", "value": 83, "errors": 3, "stage": "预览" }
  ] },
  "vconcat": [
    {
      "height": 220,
      "transform": [
        { "window": [{ "op": "mean", "field": "value", "as": "rollingMean" }], "frame": [-2, 0] }
      ],
      "layer": [
        {
          "mark": { "type": "line", "point": true },
          "encoding": {
            "x": { "field": "day", "type": "ordinal", "axis": { "title": "日期" } },
            "y": { "field": "value", "type": "quantitative", "axis": { "title": "访问量" } },
            "color": { "field": "stage", "type": "nominal", "title": "主场景" }
          }
        },
        {
          "mark": { "type": "line", "strokeDash": [6, 4], "color": "#444" },
          "encoding": {
            "x": { "field": "day", "type": "ordinal" },
            "y": { "field": "rollingMean", "type": "quantitative" }
          }
        }
      ]
    },
    {
      "height": 90,
      "mark": "bar",
      "encoding": {
        "x": { "field": "day", "type": "ordinal", "axis": { "title": null } },
        "y": { "field": "errors", "type": "quantitative", "axis": { "title": "错误数" } },
        "color": { "condition": { "test": "datum.errors >= 6", "value": "#d62728" }, "value": "#9ecae1" }
      }
    }
  ]
}
```

## 3. 热力矩阵

```vega-lite
{
  "data": { "values": [
    { "module": "预览", "level": "低", "score": 2, "owner": "渲染组" },
    { "module": "预览", "level": "中", "score": 5, "owner": "渲染组" },
    { "module": "预览", "level": "高", "score": 8, "owner": "渲染组" },
    { "module": "导出", "level": "低", "score": 3, "owner": "导出组" },
    { "module": "导出", "level": "中", "score": 6, "owner": "导出组" },
    { "module": "导出", "level": "高", "score": 9, "owner": "导出组" },
    { "module": "编辑", "level": "低", "score": 4, "owner": "编辑组" },
    { "module": "编辑", "level": "中", "score": 7, "owner": "编辑组" },
    { "module": "编辑", "level": "高", "score": 10, "owner": "编辑组" },
    { "module": "图表", "level": "低", "score": 3, "owner": "插件组" },
    { "module": "图表", "level": "中", "score": 8, "owner": "插件组" },
    { "module": "图表", "level": "高", "score": 11, "owner": "插件组" }
  ] },
  "hconcat": [
    {
      "width": 360,
      "height": 220,
      "mark": "rect",
      "encoding": {
        "x": { "field": "module", "type": "nominal", "axis": { "title": "模块" } },
        "y": { "field": "level", "type": "nominal", "axis": { "title": "风险等级" } },
        "color": { "field": "score", "type": "quantitative", "scale": { "scheme": "blues" } },
        "tooltip": [
          { "field": "module", "type": "nominal" },
          { "field": "level", "type": "nominal" },
          { "field": "owner", "type": "nominal" },
          { "field": "score", "type": "quantitative" }
        ]
      }
    },
    {
      "width": 240,
      "height": 220,
      "transform": [
        { "aggregate": [{ "op": "mean", "field": "score", "as": "avgScore" }], "groupby": ["module"] },
        { "window": [{ "op": "rank", "as": "rank" }], "sort": [{ "field": "avgScore", "order": "descending" }] }
      ],
      "mark": "bar",
      "encoding": {
        "x": { "field": "avgScore", "type": "quantitative", "axis": { "title": "平均风险" } },
        "y": { "field": "module", "type": "nominal", "sort": "-x", "axis": { "title": null } },
        "color": { "field": "rank", "type": "ordinal", "legend": null }
      }
    }
  ]
}
```

## 4. 散点图与 Tooltip

```vega-lite
{
  "data": { "values": [
    { "size": 12, "time": 1.2, "type": "短文档", "charts": 1 },
    { "size": 34, "time": 2.8, "type": "短文档", "charts": 2 },
    { "size": 56, "time": 4.9, "type": "长文档", "charts": 5 },
    { "size": 80, "time": 7.6, "type": "长文档", "charts": 7 },
    { "size": 120, "time": 11.4, "type": "超大文档", "charts": 12 },
    { "size": 160, "time": 15.8, "type": "超大文档", "charts": 18 },
    { "size": 95, "time": 8.9, "type": "长文档", "charts": 9 },
    { "size": 42, "time": 3.3, "type": "短文档", "charts": 3 }
  ] },
  "layer": [
    {
      "mark": { "type": "point", "filled": true, "opacity": 0.8 },
      "encoding": {
        "x": { "field": "size", "type": "quantitative", "axis": { "title": "Markdown 大小 KB" } },
        "y": { "field": "time", "type": "quantitative", "axis": { "title": "渲染耗时秒" } },
        "size": { "field": "charts", "type": "quantitative", "title": "图表数量" },
        "color": { "field": "type", "type": "nominal", "title": "文档类型" },
        "tooltip": [
          { "field": "type", "type": "nominal" },
          { "field": "size", "type": "quantitative" },
          { "field": "time", "type": "quantitative" },
          { "field": "charts", "type": "quantitative" }
        ]
      }
    },
    {
      "transform": [
        { "regression": "time", "on": "size", "as": ["size", "predictedTime"] }
      ],
      "mark": { "type": "line", "color": "#d62728", "strokeWidth": 2 },
      "encoding": {
        "x": { "field": "size", "type": "quantitative" },
        "y": { "field": "predictedTime", "type": "quantitative" }
      }
    }
  ]
}
```

## 5. 堆叠柱状图

```vega-lite
{
  "width": 180,
  "height": 180,
  "data": { "values": [
    { "month": "一月", "status": "成功", "count": 42, "channel": "HTML" },
    { "month": "一月", "status": "失败", "count": 3, "channel": "HTML" },
    { "month": "一月", "status": "警告", "count": 6, "channel": "PDF" },
    { "month": "二月", "status": "成功", "count": 55, "channel": "PDF" },
    { "month": "二月", "status": "失败", "count": 5, "channel": "PDF" },
    { "month": "二月", "status": "警告", "count": 7, "channel": "DOCX" },
    { "month": "三月", "status": "成功", "count": 61, "channel": "DOCX" },
    { "month": "三月", "status": "失败", "count": 4, "channel": "DOCX" },
    { "month": "三月", "status": "警告", "count": 8, "channel": "HTML" }
  ] },
  "facet": { "field": "status", "type": "nominal", "columns": 3, "title": "导出状态分面" },
  "spec": {
    "transform": [
      { "aggregate": [{ "op": "sum", "field": "count", "as": "total" }], "groupby": ["month", "channel"] }
    ],
    "mark": "bar",
    "encoding": {
      "x": { "field": "month", "type": "ordinal", "axis": { "title": "月份" } },
      "y": { "field": "total", "type": "quantitative", "axis": { "title": "导出次数" } },
      "color": { "field": "channel", "type": "nominal", "title": "通道" },
      "tooltip": [
        { "field": "month", "type": "ordinal" },
        { "field": "channel", "type": "nominal" },
        { "field": "total", "type": "quantitative" }
      ]
    }
  }
}
```

## 6. 面积图

```vega-lite
{
  "data": { "values": [
    { "week": 1, "value": 20 },
    { "week": 2, "value": 32 },
    { "week": 3, "value": 41 },
    { "week": 4, "value": 48 },
    { "week": 5, "value": 66 },
    { "week": 6, "value": 58 }
  ] },
  "mark": { "type": "area", "line": true, "point": true },
  "encoding": {
    "x": { "field": "week", "type": "ordinal", "axis": { "title": "周次" } },
    "y": { "field": "value", "type": "quantitative", "axis": { "title": "活跃文档数" } },
    "color": { "value": "#4c78a8" }
  }
}
```

## 7. 柱线组合图

```vega-lite
{
  "data": { "values": [
    { "module": "Mermaid", "count": 30, "target": 25 },
    { "module": "ECharts", "count": 21, "target": 20 },
    { "module": "Graphviz", "count": 17, "target": 18 },
    { "module": "BPMN", "count": 12, "target": 10 }
  ] },
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "module", "type": "nominal", "axis": { "title": "渲染器" } },
        "y": { "field": "count", "type": "quantitative", "axis": { "title": "用例数" } },
        "color": { "field": "module", "type": "nominal", "legend": null }
      }
    },
    {
      "mark": { "type": "rule", "color": "#d62728", "strokeWidth": 2 },
      "encoding": {
        "x": { "field": "module", "type": "nominal" },
        "y": { "field": "target", "type": "quantitative" }
      }
    }
  ]
}
```

## 8. 直方图

```vega-lite
{
  "data": { "values": [
    { "duration": 1.1 }, { "duration": 1.4 }, { "duration": 2.2 },
    { "duration": 2.8 }, { "duration": 3.1 }, { "duration": 3.7 },
    { "duration": 4.2 }, { "duration": 4.9 }, { "duration": 5.5 },
    { "duration": 6.8 }, { "duration": 7.4 }, { "duration": 8.2 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "bin": true, "field": "duration", "type": "quantitative", "axis": { "title": "导出耗时秒" } },
    "y": { "aggregate": "count", "type": "quantitative", "axis": { "title": "次数" } }
  }
}
```

## 9. 箱线图

```vega-lite
{
  "data": { "values": [
    { "renderer": "D2", "ms": 22 }, { "renderer": "D2", "ms": 25 }, { "renderer": "D2", "ms": 31 }, { "renderer": "D2", "ms": 37 },
    { "renderer": "BPMN", "ms": 48 }, { "renderer": "BPMN", "ms": 55 }, { "renderer": "BPMN", "ms": 63 }, { "renderer": "BPMN", "ms": 72 },
    { "renderer": "WaveDrom", "ms": 15 }, { "renderer": "WaveDrom", "ms": 19 }, { "renderer": "WaveDrom", "ms": 23 }, { "renderer": "WaveDrom", "ms": 27 }
  ] },
  "mark": "boxplot",
  "encoding": {
    "x": { "field": "renderer", "type": "nominal", "axis": { "title": "渲染器" } },
    "y": { "field": "ms", "type": "quantitative", "axis": { "title": "耗时 ms" } },
    "color": { "field": "renderer", "type": "nominal", "legend": null }
  }
}
```

## 10. 分面小图

```vega-lite
{
  "data": { "values": [
    { "renderer": "D2", "stage": "解析", "ms": 8 },
    { "renderer": "D2", "stage": "渲染", "ms": 22 },
    { "renderer": "D2", "stage": "截图", "ms": 12 },
    { "renderer": "BPMN", "stage": "解析", "ms": 15 },
    { "renderer": "BPMN", "stage": "渲染", "ms": 54 },
    { "renderer": "BPMN", "stage": "截图", "ms": 20 },
    { "renderer": "WaveDrom", "stage": "解析", "ms": 4 },
    { "renderer": "WaveDrom", "stage": "渲染", "ms": 18 },
    { "renderer": "WaveDrom", "stage": "截图", "ms": 9 }
  ] },
  "facet": { "field": "renderer", "type": "nominal", "columns": 3 },
  "spec": {
    "mark": "bar",
    "encoding": {
      "x": { "field": "stage", "type": "nominal", "axis": { "title": null } },
      "y": { "field": "ms", "type": "quantitative", "axis": { "title": "ms" } },
      "color": { "field": "stage", "type": "nominal", "legend": null }
    }
  }
}
```

## 11. 环形占比图

```vega-lite
{
  "data": { "values": [
    { "kind": "HTML", "value": 38 },
    { "kind": "PDF", "value": 24 },
    { "kind": "DOCX", "value": 31 },
    { "kind": "图片", "value": 7 }
  ] },
  "mark": { "type": "arc", "innerRadius": 60 },
  "encoding": {
    "theta": { "field": "value", "type": "quantitative" },
    "color": { "field": "kind", "type": "nominal", "title": "导出类型" }
  }
}
```

## 12. 长标签横轴

```vega-lite
{
  "width": 720,
  "data": { "values": [
    { "label": "RendererPlugin 契约校验", "score": 91 },
    { "label": "服务端渲染截图", "score": 84 },
    { "label": "DOCX 图片替换", "score": 88 },
    { "label": "禁用渲染源码保留", "score": 79 },
    { "label": "本地文件引用读取", "score": 86 }
  ] },
  "mark": { "type": "bar", "cornerRadiusEnd": 3 },
  "encoding": {
    "x": { "field": "score", "type": "quantitative", "axis": { "title": "覆盖分" } },
    "y": { "field": "label", "type": "nominal", "sort": "-x", "axis": { "title": null } },
    "color": { "field": "score", "type": "quantitative", "scale": { "scheme": "tealblues" } }
  }
}
```

## 13. 分组柱状图

```vega-lite
{
  "data": { "values": [
    { "module": "预览", "channel": "桌面", "count": 32 },
    { "module": "预览", "channel": "导出", "count": 21 },
    { "module": "编辑", "channel": "桌面", "count": 18 },
    { "module": "编辑", "channel": "导出", "count": 9 },
    { "module": "图表", "channel": "桌面", "count": 25 },
    { "module": "图表", "channel": "导出", "count": 17 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "module", "type": "nominal", "axis": { "title": "模块" } },
    "xOffset": { "field": "channel" },
    "y": { "field": "count", "type": "quantitative", "axis": { "title": "数量" } },
    "color": { "field": "channel", "type": "nominal", "title": "场景" }
  }
}
```

## 14. 横向区间条

```vega-lite
{
  "data": { "values": [
    { "task": "解析", "start": 0, "end": 18 },
    { "task": "渲染", "start": 18, "end": 64 },
    { "task": "截图", "start": 64, "end": 91 },
    { "task": "导出", "start": 91, "end": 135 }
  ] },
  "mark": { "type": "bar", "cornerRadius": 4 },
  "encoding": {
    "y": { "field": "task", "type": "nominal", "axis": { "title": null } },
    "x": { "field": "start", "type": "quantitative", "axis": { "title": "耗时 ms" } },
    "x2": { "field": "end" },
    "color": { "field": "task", "type": "nominal", "legend": null }
  }
}
```

## 15. 时间序列面积堆叠

```vega-lite
{
  "width": 700,
  "data": { "values": [
    { "date": "2026-05-01", "type": "HTML", "count": 12 },
    { "date": "2026-05-01", "type": "PDF", "count": 8 },
    { "date": "2026-05-01", "type": "DOCX", "count": 6 },
    { "date": "2026-05-02", "type": "HTML", "count": 18 },
    { "date": "2026-05-02", "type": "PDF", "count": 11 },
    { "date": "2026-05-02", "type": "DOCX", "count": 9 },
    { "date": "2026-05-03", "type": "HTML", "count": 22 },
    { "date": "2026-05-03", "type": "PDF", "count": 16 },
    { "date": "2026-05-03", "type": "DOCX", "count": 14 }
  ] },
  "mark": "area",
  "encoding": {
    "x": { "field": "date", "type": "temporal", "axis": { "title": "日期" } },
    "y": { "field": "count", "type": "quantitative", "stack": "zero", "axis": { "title": "导出次数" } },
    "color": { "field": "type", "type": "nominal", "title": "格式" }
  }
}
```

## 16. 文本表格

```vega-lite
{
  "data": { "values": [
    { "item": "本地文件引用", "status": "通过", "rank": 1 },
    { "item": "中文标签", "status": "通过", "rank": 2 },
    { "item": "长宽自适应", "status": "观察", "rank": 3 },
    { "item": "导出截图", "status": "通过", "rank": 4 }
  ] },
  "mark": { "type": "text", "align": "left", "baseline": "middle", "dx": 4 },
  "encoding": {
    "y": { "field": "item", "type": "nominal", "sort": { "field": "rank" }, "axis": { "title": null } },
    "text": { "field": "status" },
    "color": { "field": "status", "type": "nominal", "legend": null }
  }
}
```

## 17. 阈值参考线

```vega-lite
{
  "data": { "values": [
    { "renderer": "Vega-Lite", "ms": 42, "target": 60 },
    { "renderer": "D2", "ms": 35, "target": 60 },
    { "renderer": "BPMN", "ms": 74, "target": 60 },
    { "renderer": "WaveDrom", "ms": 29, "target": 60 }
  ] },
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "renderer", "type": "nominal", "axis": { "title": "渲染器" } },
        "y": { "field": "ms", "type": "quantitative", "axis": { "title": "耗时 ms" } },
        "color": { "field": "renderer", "type": "nominal", "legend": null }
      }
    },
    {
      "mark": { "type": "rule", "color": "#d62728", "strokeDash": [4, 4] },
      "encoding": { "y": { "datum": 60 } }
    }
  ]
}
```

## 18. 点线双轴替代图

```vega-lite
{
  "data": { "values": [
    { "week": "W1", "files": 12, "success": 0.92 },
    { "week": "W2", "files": 19, "success": 0.95 },
    { "week": "W3", "files": 25, "success": 0.9 },
    { "week": "W4", "files": 31, "success": 0.97 }
  ] },
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "week", "type": "ordinal" },
        "y": { "field": "files", "type": "quantitative", "axis": { "title": "文件数" } }
      }
    },
    {
      "mark": { "type": "line", "point": true, "color": "#f58518" },
      "encoding": {
        "x": { "field": "week", "type": "ordinal" },
        "y": { "field": "success", "type": "quantitative", "axis": { "title": "成功率" } }
      }
    }
  ]
}
```

## 19. 误差条

```vega-lite
{
  "data": { "values": [
    { "renderer": "Vega-Lite", "lower": 31, "upper": 52, "mean": 42 },
    { "renderer": "D2", "lower": 21, "upper": 46, "mean": 34 },
    { "renderer": "BPMN", "lower": 55, "upper": 88, "mean": 70 },
    { "renderer": "WaveDrom", "lower": 18, "upper": 38, "mean": 27 }
  ] },
  "layer": [
    {
      "mark": "rule",
      "encoding": {
        "x": { "field": "renderer", "type": "nominal" },
        "y": { "field": "lower", "type": "quantitative" },
        "y2": { "field": "upper" }
      }
    },
    {
      "mark": { "type": "point", "filled": true, "size": 90 },
      "encoding": {
        "x": { "field": "renderer", "type": "nominal", "axis": { "title": "渲染器" } },
        "y": { "field": "mean", "type": "quantitative", "axis": { "title": "耗时 ms" } }
      }
    }
  ]
}
```

## 20. 百分比堆叠

```vega-lite
{
  "data": { "values": [
    { "scope": "预览", "result": "成功", "count": 96 },
    { "scope": "预览", "result": "失败", "count": 4 },
    { "scope": "导出", "result": "成功", "count": 88 },
    { "scope": "导出", "result": "失败", "count": 12 },
    { "scope": "编辑", "result": "成功", "count": 91 },
    { "scope": "编辑", "result": "失败", "count": 9 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "scope", "type": "nominal", "axis": { "title": "场景" } },
    "y": { "field": "count", "type": "quantitative", "stack": "normalize", "axis": { "title": "占比", "format": ".0%" } },
    "color": { "field": "result", "type": "nominal", "title": "结果" }
  }
}
```

## 21. 排名气泡图

```vega-lite
{
  "data": { "values": [
    { "name": "Mermaid", "complexity": 4, "usage": 80, "bugs": 3 },
    { "name": "Graphviz", "complexity": 6, "usage": 54, "bugs": 5 },
    { "name": "D2", "complexity": 5, "usage": 37, "bugs": 2 },
    { "name": "BPMN", "complexity": 7, "usage": 26, "bugs": 4 },
    { "name": "WaveDrom", "complexity": 3, "usage": 18, "bugs": 1 }
  ] },
  "mark": { "type": "circle", "opacity": 0.75 },
  "encoding": {
    "x": { "field": "complexity", "type": "quantitative", "axis": { "title": "复杂度" } },
    "y": { "field": "usage", "type": "quantitative", "axis": { "title": "使用频次" } },
    "size": { "field": "bugs", "type": "quantitative", "title": "问题数" },
    "color": { "field": "name", "type": "nominal", "title": "渲染器" }
  }
}
```

## 22. 小倍数散点

```vega-lite
{
  "data": { "values": [
    { "kind": "A", "size": 10, "ms": 20 }, { "kind": "A", "size": 20, "ms": 34 }, { "kind": "A", "size": 30, "ms": 43 },
    { "kind": "B", "size": 10, "ms": 15 }, { "kind": "B", "size": 20, "ms": 28 }, { "kind": "B", "size": 30, "ms": 39 },
    { "kind": "C", "size": 10, "ms": 18 }, { "kind": "C", "size": 20, "ms": 31 }, { "kind": "C", "size": 30, "ms": 47 }
  ] },
  "facet": { "field": "kind", "type": "nominal", "columns": 3 },
  "spec": {
    "mark": { "type": "point", "filled": true },
    "encoding": {
      "x": { "field": "size", "type": "quantitative", "axis": { "title": "大小 KB" } },
      "y": { "field": "ms", "type": "quantitative", "axis": { "title": "ms" } }
    }
  }
}
```

## 23. 环比瀑布替代表

```vega-lite
{
  "data": { "values": [
    { "stage": "基线", "start": 0, "end": 100 },
    { "stage": "预览优化", "start": 100, "end": 118 },
    { "stage": "导出优化", "start": 118, "end": 132 },
    { "stage": "回归修复", "start": 132, "end": 126 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "stage", "type": "nominal", "axis": { "title": "阶段", "labelAngle": -20 } },
    "y": { "field": "start", "type": "quantitative", "axis": { "title": "综合评分" } },
    "y2": { "field": "end" },
    "color": {
      "condition": { "test": "datum.end >= datum.start", "value": "#4c78a8" },
      "value": "#e45756"
    }
  }
}
```

## 24. 宽图例压力场景

```vega-lite
{
  "width": 760,
  "height": 260,
  "data": { "values": [
    { "module": "Markdown 基础渲染", "value": 98 },
    { "module": "RendererPlugin 统一契约", "value": 87 },
    { "module": "DOCX 服务截图链路", "value": 79 },
    { "module": "Electron 本地文件安全", "value": 92 },
    { "module": "低分辨率布局", "value": 71 },
    { "module": "中文输入法兼容", "value": 84 }
  ] },
  "mark": { "type": "bar", "tooltip": true },
  "encoding": {
    "x": { "field": "module", "type": "nominal", "axis": { "title": null, "labelAngle": -35 } },
    "y": { "field": "value", "type": "quantitative", "axis": { "title": "覆盖分" } },
    "color": { "field": "module", "type": "nominal", "legend": { "orient": "bottom", "columns": 2 } }
  }
}
```

## 25. 窗口函数排名

```vega-lite
{
  "data": { "values": [
    { "team": "预览", "score": 94 },
    { "team": "导出", "score": 88 },
    { "team": "编辑", "score": 91 },
    { "team": "搜索", "score": 79 },
    { "team": "图表", "score": 86 }
  ] },
  "transform": [
    { "window": [{ "op": "rank", "as": "rank" }], "sort": [{ "field": "score", "order": "descending" }] }
  ],
  "mark": { "type": "bar", "cornerRadiusEnd": 4 },
  "encoding": {
    "y": { "field": "team", "type": "nominal", "sort": "-x", "axis": { "title": null } },
    "x": { "field": "score", "type": "quantitative", "axis": { "title": "评分" } },
    "color": { "field": "rank", "type": "ordinal", "legend": { "title": "排名" } }
  }
}
```

## 26. 聚合平均耗时

```vega-lite
{
  "data": { "values": [
    { "renderer": "D2", "stage": "preview", "ms": 22 },
    { "renderer": "D2", "stage": "export", "ms": 41 },
    { "renderer": "BPMN", "stage": "preview", "ms": 61 },
    { "renderer": "BPMN", "stage": "export", "ms": 92 },
    { "renderer": "WaveDrom", "stage": "preview", "ms": 18 },
    { "renderer": "WaveDrom", "stage": "export", "ms": 36 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "renderer", "type": "nominal", "axis": { "title": "渲染器" } },
    "y": { "aggregate": "mean", "field": "ms", "type": "quantitative", "axis": { "title": "平均耗时 ms" } },
    "color": { "field": "stage", "type": "nominal", "title": "阶段" }
  }
}
```

## 27. Fold 多指标折线

```vega-lite
{
  "data": { "values": [
    { "day": "周一", "preview": 42, "export": 12, "edit": 18 },
    { "day": "周二", "preview": 51, "export": 18, "edit": 22 },
    { "day": "周三", "preview": 48, "export": 16, "edit": 25 },
    { "day": "周四", "preview": 63, "export": 24, "edit": 30 }
  ] },
  "transform": [{ "fold": ["preview", "export", "edit"], "as": ["metric", "value"] }],
  "mark": { "type": "line", "point": true },
  "encoding": {
    "x": { "field": "day", "type": "ordinal", "axis": { "title": "日期" } },
    "y": { "field": "value", "type": "quantitative", "axis": { "title": "次数" } },
    "color": { "field": "metric", "type": "nominal", "title": "指标" }
  }
}
```

## 28. Filter 过滤异常值

```vega-lite
{
  "data": { "values": [
    { "file": "a.md", "size": 12, "ms": 31 },
    { "file": "b.md", "size": 32, "ms": 52 },
    { "file": "c.md", "size": 75, "ms": 98 },
    { "file": "outlier.md", "size": 180, "ms": 920 },
    { "file": "d.md", "size": 90, "ms": 121 }
  ] },
  "transform": [{ "filter": "datum.ms < 300" }],
  "mark": { "type": "point", "filled": true, "size": 130 },
  "encoding": {
    "x": { "field": "size", "type": "quantitative", "axis": { "title": "文件大小 KB" } },
    "y": { "field": "ms", "type": "quantitative", "axis": { "title": "渲染耗时 ms" } },
    "tooltip": [{ "field": "file" }, { "field": "ms" }]
  }
}
```

## 29. Calculate 派生字段

```vega-lite
{
  "data": { "values": [
    { "module": "Preview", "passed": 38, "failed": 2 },
    { "module": "Export", "passed": 31, "failed": 5 },
    { "module": "Edit", "passed": 27, "failed": 3 },
    { "module": "Charts", "passed": 44, "failed": 6 }
  ] },
  "transform": [{ "calculate": "datum.passed / (datum.passed + datum.failed)", "as": "rate" }],
  "mark": "bar",
  "encoding": {
    "x": { "field": "module", "type": "nominal", "axis": { "title": "模块" } },
    "y": { "field": "rate", "type": "quantitative", "axis": { "title": "通过率", "format": ".0%" } },
    "color": { "field": "rate", "type": "quantitative", "scale": { "scheme": "greens" } }
  }
}
```

## 30. HConcat 并排对比

```vega-lite
{
  "data": { "values": [
    { "renderer": "Vega-Lite", "preview": 42, "export": 58 },
    { "renderer": "D2", "preview": 36, "export": 47 },
    { "renderer": "BPMN", "preview": 72, "export": 96 },
    { "renderer": "WaveDrom", "preview": 25, "export": 38 }
  ] },
  "hconcat": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "renderer", "type": "nominal", "axis": { "labelAngle": -25 } },
        "y": { "field": "preview", "type": "quantitative", "axis": { "title": "预览 ms" } }
      }
    },
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "renderer", "type": "nominal", "axis": { "labelAngle": -25 } },
        "y": { "field": "export", "type": "quantitative", "axis": { "title": "导出 ms" } }
      }
    }
  ]
}
```

## 31. VConcat 上下组合

```vega-lite
{
  "data": { "values": [
    { "month": "一月", "html": 30, "docx": 18 },
    { "month": "二月", "html": 38, "docx": 24 },
    { "month": "三月", "html": 45, "docx": 31 },
    { "month": "四月", "html": 52, "docx": 36 }
  ] },
  "vconcat": [
    {
      "mark": { "type": "line", "point": true },
      "encoding": {
        "x": { "field": "month", "type": "ordinal" },
        "y": { "field": "html", "type": "quantitative", "axis": { "title": "HTML" } }
      }
    },
    {
      "mark": { "type": "line", "point": true, "color": "#f58518" },
      "encoding": {
        "x": { "field": "month", "type": "ordinal" },
        "y": { "field": "docx", "type": "quantitative", "axis": { "title": "DOCX" } }
      }
    }
  ]
}
```

## 32. Repeat 矩阵

```vega-lite
{
  "data": { "values": [
    { "name": "A", "size": 12, "ms": 31, "errors": 1 },
    { "name": "B", "size": 40, "ms": 55, "errors": 3 },
    { "name": "C", "size": 75, "ms": 102, "errors": 2 },
    { "name": "D", "size": 110, "ms": 140, "errors": 4 }
  ] },
  "repeat": { "column": ["size", "ms", "errors"] },
  "spec": {
    "mark": { "type": "bar", "tooltip": true },
    "encoding": {
      "x": { "field": "name", "type": "nominal" },
      "y": { "field": { "repeat": "column" }, "type": "quantitative" }
    }
  }
}
```

## 33. 条件颜色规则

```vega-lite
{
  "data": { "values": [
    { "case": "HTML 导出", "value": 96 },
    { "case": "PDF 导出", "value": 84 },
    { "case": "DOCX 导出", "value": 72 },
    { "case": "图表截图", "value": 68 },
    { "case": "远程服务", "value": 59 }
  ] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "case", "type": "nominal", "axis": { "title": null, "labelAngle": -25 } },
    "y": { "field": "value", "type": "quantitative", "axis": { "title": "稳定度" } },
    "color": {
      "condition": { "test": "datum.value >= 70", "value": "#4c78a8" },
      "value": "#e45756"
    }
  }
}
```

## 34. 分箱热力图

```vega-lite
{
  "data": { "values": [
    { "size": 10, "ms": 22 }, { "size": 20, "ms": 31 }, { "size": 30, "ms": 45 },
    { "size": 40, "ms": 58 }, { "size": 50, "ms": 65 }, { "size": 60, "ms": 76 },
    { "size": 70, "ms": 81 }, { "size": 80, "ms": 94 }, { "size": 90, "ms": 112 }
  ] },
  "mark": "rect",
  "encoding": {
    "x": { "bin": { "maxbins": 4 }, "field": "size", "type": "quantitative", "axis": { "title": "大小区间" } },
    "y": { "bin": { "maxbins": 4 }, "field": "ms", "type": "quantitative", "axis": { "title": "耗时区间" } },
    "color": { "aggregate": "count", "type": "quantitative", "scale": { "scheme": "purples" } }
  }
}
```

## 35. 密集标签点图

```vega-lite
{
  "width": 700,
  "data": { "values": [
    { "name": "超长文档-研发中心-专项工作-费用分析", "x": 12, "y": 42 },
    { "name": "导出链路-服务端截图-多图表", "x": 18, "y": 58 },
    { "name": "编辑模式-实时预览-滚动同步", "x": 30, "y": 61 },
    { "name": "文件树过滤-中文输入法", "x": 40, "y": 33 }
  ] },
  "layer": [
    {
      "mark": { "type": "point", "filled": true, "size": 100 },
      "encoding": {
        "x": { "field": "x", "type": "quantitative" },
        "y": { "field": "y", "type": "quantitative" }
      }
    },
    {
      "mark": { "type": "text", "align": "left", "dx": 8 },
      "encoding": {
        "x": { "field": "x", "type": "quantitative" },
        "y": { "field": "y", "type": "quantitative" },
        "text": { "field": "name" }
      }
    }
  ]
}
```

## 36. 交叉表热力

```vega-lite
{
  "data": { "values": [
    { "os": "macOS", "format": "HTML", "ok": 98 },
    { "os": "macOS", "format": "PDF", "ok": 94 },
    { "os": "macOS", "format": "DOCX", "ok": 89 },
    { "os": "Windows", "format": "HTML", "ok": 92 },
    { "os": "Windows", "format": "PDF", "ok": 86 },
    { "os": "Windows", "format": "DOCX", "ok": 81 },
    { "os": "Linux", "format": "HTML", "ok": 88 },
    { "os": "Linux", "format": "PDF", "ok": 83 },
    { "os": "Linux", "format": "DOCX", "ok": 77 }
  ] },
  "mark": { "type": "rect", "tooltip": true },
  "encoding": {
    "x": { "field": "format", "type": "nominal", "axis": { "title": "格式" } },
    "y": { "field": "os", "type": "nominal", "axis": { "title": "系统" } },
    "color": { "field": "ok", "type": "quantitative", "scale": { "scheme": "redyellowgreen", "domain": [70, 100] } }
  }
}
```

## 37. 多层规则和文本

```vega-lite
{
  "data": { "values": [
    { "step": "解析", "ms": 12 },
    { "step": "渲染", "ms": 48 },
    { "step": "截图", "ms": 33 },
    { "step": "写入", "ms": 21 }
  ] },
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "step", "type": "nominal" },
        "y": { "field": "ms", "type": "quantitative" }
      }
    },
    {
      "mark": { "type": "rule", "color": "#ff7f0e" },
      "encoding": { "y": { "datum": 40 } }
    },
    {
      "mark": { "type": "text", "dy": -6 },
      "encoding": {
        "x": { "field": "step", "type": "nominal" },
        "y": { "field": "ms", "type": "quantitative" },
        "text": { "field": "ms" }
      }
    }
  ]
}
```

## 38. 归一化面积图

```vega-lite
{
  "data": { "values": [
    { "week": "W1", "kind": "预览", "count": 50 },
    { "week": "W1", "kind": "导出", "count": 20 },
    { "week": "W1", "kind": "编辑", "count": 30 },
    { "week": "W2", "kind": "预览", "count": 46 },
    { "week": "W2", "kind": "导出", "count": 29 },
    { "week": "W2", "kind": "编辑", "count": 25 },
    { "week": "W3", "kind": "预览", "count": 41 },
    { "week": "W3", "kind": "导出", "count": 35 },
    { "week": "W3", "kind": "编辑", "count": 24 }
  ] },
  "mark": "area",
  "encoding": {
    "x": { "field": "week", "type": "ordinal" },
    "y": { "field": "count", "type": "quantitative", "stack": "normalize", "axis": { "format": ".0%" } },
    "color": { "field": "kind", "type": "nominal" }
  }
}
```

## 39. Resolve 独立颜色

```vega-lite
{
  "data": { "values": [
    { "name": "A", "preview": 10, "export": 30 },
    { "name": "B", "preview": 20, "export": 25 },
    { "name": "C", "preview": 30, "export": 40 }
  ] },
  "hconcat": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "name", "type": "nominal" },
        "y": { "field": "preview", "type": "quantitative" },
        "color": { "field": "preview", "type": "quantitative", "scale": { "scheme": "blues" } }
      }
    },
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "name", "type": "nominal" },
        "y": { "field": "export", "type": "quantitative" },
        "color": { "field": "export", "type": "quantitative", "scale": { "scheme": "oranges" } }
      }
    }
  ],
  "resolve": { "scale": { "color": "independent" } }
}
```

## 40. 宽表单导出压力

```vega-lite
{
  "width": 820,
  "data": { "values": [
    { "name": "图表渲染器数量", "value": 14 },
    { "name": "Fixture 独立样例数量", "value": 40 },
    { "name": "Electron E2E 打开文件数量", "value": 5 },
    { "name": "DOCX 服务端渲染链路", "value": 3 },
    { "name": "导出格式覆盖 HTML/PDF/DOCX", "value": 3 }
  ] },
  "mark": { "type": "bar", "cornerRadiusEnd": 3 },
  "encoding": {
    "y": { "field": "name", "type": "nominal", "sort": "-x", "axis": { "title": null } },
    "x": { "field": "value", "type": "quantitative", "axis": { "title": "数量" } },
    "color": { "field": "value", "type": "quantitative", "scale": { "scheme": "viridis" } }
  }
}
```

## 41. 多指标运维看板

```vega-lite
{
  "data": { "values": [
    { "day": "周一", "module": "Preview", "latency": 42, "errors": 1, "success": 0.98 },
    { "day": "周一", "module": "Export", "latency": 88, "errors": 4, "success": 0.91 },
    { "day": "周一", "module": "Edit", "latency": 35, "errors": 2, "success": 0.95 },
    { "day": "周二", "module": "Preview", "latency": 46, "errors": 1, "success": 0.97 },
    { "day": "周二", "module": "Export", "latency": 92, "errors": 6, "success": 0.88 },
    { "day": "周二", "module": "Edit", "latency": 41, "errors": 2, "success": 0.94 },
    { "day": "周三", "module": "Preview", "latency": 39, "errors": 0, "success": 0.99 },
    { "day": "周三", "module": "Export", "latency": 81, "errors": 3, "success": 0.93 },
    { "day": "周三", "module": "Edit", "latency": 38, "errors": 1, "success": 0.96 }
  ] },
  "transform": [{ "fold": ["latency", "errors", "success"], "as": ["metric", "value"] }],
  "facet": { "field": "metric", "type": "nominal", "columns": 1 },
  "spec": {
    "width": 760,
    "height": 140,
    "layer": [
      {
        "mark": { "type": "line", "point": true },
        "encoding": {
          "x": { "field": "day", "type": "ordinal", "axis": { "title": "日期" } },
          "y": { "field": "value", "type": "quantitative", "axis": { "title": null } },
          "color": { "field": "module", "type": "nominal", "title": "模块" }
        }
      },
      {
        "mark": { "type": "text", "dy": -8, "fontSize": 10 },
        "encoding": {
          "x": { "field": "day", "type": "ordinal" },
          "y": { "field": "value", "type": "quantitative" },
          "text": { "field": "value", "type": "quantitative", "format": ".2f" },
          "color": { "field": "module", "type": "nominal", "legend": null }
        }
      }
    ]
  }
}
```

## 42. 导出漏斗与状态热力组合

```vega-lite
{
  "data": { "values": [
    { "stage": "打开文档", "format": "HTML", "count": 120, "risk": 1 },
    { "stage": "解析 Markdown", "format": "HTML", "count": 118, "risk": 2 },
    { "stage": "渲染图表", "format": "HTML", "count": 112, "risk": 4 },
    { "stage": "写入文件", "format": "HTML", "count": 110, "risk": 2 },
    { "stage": "打开文档", "format": "PDF", "count": 90, "risk": 2 },
    { "stage": "解析 Markdown", "format": "PDF", "count": 88, "risk": 3 },
    { "stage": "渲染图表", "format": "PDF", "count": 80, "risk": 6 },
    { "stage": "写入文件", "format": "PDF", "count": 76, "risk": 5 },
    { "stage": "打开文档", "format": "DOCX", "count": 72, "risk": 3 },
    { "stage": "解析 Markdown", "format": "DOCX", "count": 69, "risk": 4 },
    { "stage": "渲染图表", "format": "DOCX", "count": 58, "risk": 8 },
    { "stage": "写入文件", "format": "DOCX", "count": 53, "risk": 7 }
  ] },
  "hconcat": [
    {
      "width": 360,
      "mark": { "type": "bar", "cornerRadiusEnd": 4 },
      "encoding": {
        "y": { "field": "stage", "type": "nominal", "sort": null, "axis": { "title": "阶段" } },
        "x": { "aggregate": "sum", "field": "count", "type": "quantitative", "axis": { "title": "总次数" } },
        "color": { "field": "stage", "type": "nominal", "legend": null }
      }
    },
    {
      "width": 360,
      "mark": { "type": "rect", "tooltip": true },
      "encoding": {
        "x": { "field": "format", "type": "nominal", "axis": { "title": "格式" } },
        "y": { "field": "stage", "type": "nominal", "sort": null, "axis": { "title": null } },
        "color": { "field": "risk", "type": "quantitative", "scale": { "scheme": "yelloworangered" } }
      }
    }
  ]
}
```

## 43. 分层质量矩阵

```vega-lite
{
  "data": { "values": [
    { "layer": "Renderer", "case": "Vega-Lite", "score": 95, "bugs": 1 },
    { "layer": "Renderer", "case": "D2", "score": 91, "bugs": 2 },
    { "layer": "Renderer", "case": "BPMN", "score": 84, "bugs": 4 },
    { "layer": "Renderer", "case": "WaveDrom", "score": 88, "bugs": 2 },
    { "layer": "Export", "case": "HTML", "score": 96, "bugs": 1 },
    { "layer": "Export", "case": "PDF", "score": 89, "bugs": 3 },
    { "layer": "Export", "case": "DOCX", "score": 78, "bugs": 6 },
    { "layer": "Editing", "case": "Rendered Edit", "score": 82, "bugs": 5 },
    { "layer": "Editing", "case": "Source Edit", "score": 90, "bugs": 2 },
    { "layer": "File Tree", "case": "中文过滤", "score": 87, "bugs": 3 }
  ] },
  "layer": [
    {
      "mark": "rect",
      "encoding": {
        "x": { "field": "case", "type": "nominal", "axis": { "title": null, "labelAngle": -35 } },
        "y": { "field": "layer", "type": "nominal", "axis": { "title": null } },
        "color": { "field": "score", "type": "quantitative", "scale": { "scheme": "redyellowgreen", "domain": [70, 100] } }
      }
    },
    {
      "mark": { "type": "text", "fontSize": 11 },
      "encoding": {
        "x": { "field": "case", "type": "nominal" },
        "y": { "field": "layer", "type": "nominal" },
        "text": { "field": "score", "type": "quantitative" },
        "color": { "condition": { "test": "datum.score < 84", "value": "white" }, "value": "black" }
      }
    }
  ]
}
```

## 44. 发布节奏窗口统计

```vega-lite
{
  "data": { "values": [
    { "version": "2.1.0", "type": "feat", "count": 12 },
    { "version": "2.1.0", "type": "fix", "count": 9 },
    { "version": "2.1.0", "type": "test", "count": 7 },
    { "version": "2.1.1", "type": "feat", "count": 5 },
    { "version": "2.1.1", "type": "fix", "count": 11 },
    { "version": "2.1.1", "type": "test", "count": 14 },
    { "version": "2.2.0", "type": "feat", "count": 18 },
    { "version": "2.2.0", "type": "fix", "count": 8 },
    { "version": "2.2.0", "type": "test", "count": 19 }
  ] },
  "transform": [
    { "joinaggregate": [{ "op": "sum", "field": "count", "as": "versionTotal" }], "groupby": ["version"] },
    { "calculate": "datum.count / datum.versionTotal", "as": "ratio" }
  ],
  "layer": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "version", "type": "nominal", "axis": { "title": "版本" } },
        "y": { "field": "ratio", "type": "quantitative", "stack": "normalize", "axis": { "title": "占比", "format": ".0%" } },
        "color": { "field": "type", "type": "nominal", "title": "类型" }
      }
    },
    {
      "mark": { "type": "text", "dy": -6, "fontSize": 10 },
      "encoding": {
        "x": { "field": "version", "type": "nominal" },
        "y": { "aggregate": "max", "field": "ratio", "type": "quantitative" },
        "text": { "field": "versionTotal", "type": "quantitative" }
      }
    }
  ]
}
```

## 45. 大规模图表耗时分布

```vega-lite
{
  "data": { "values": [
    { "renderer": "Vega-Lite", "doc": "A", "kb": 12, "ms": 35, "charts": 2 },
    { "renderer": "Vega-Lite", "doc": "B", "kb": 55, "ms": 72, "charts": 6 },
    { "renderer": "Vega-Lite", "doc": "C", "kb": 110, "ms": 145, "charts": 12 },
    { "renderer": "D2", "doc": "D", "kb": 24, "ms": 42, "charts": 4 },
    { "renderer": "D2", "doc": "E", "kb": 70, "ms": 96, "charts": 9 },
    { "renderer": "D2", "doc": "F", "kb": 135, "ms": 180, "charts": 16 },
    { "renderer": "BPMN", "doc": "G", "kb": 40, "ms": 92, "charts": 3 },
    { "renderer": "BPMN", "doc": "H", "kb": 105, "ms": 220, "charts": 10 },
    { "renderer": "WaveDrom", "doc": "I", "kb": 18, "ms": 51, "charts": 5 },
    { "renderer": "WaveDrom", "doc": "J", "kb": 82, "ms": 132, "charts": 18 }
  ] },
  "repeat": { "row": ["ms", "charts"], "column": ["kb"] },
  "spec": {
    "mark": { "type": "point", "filled": true, "opacity": 0.8 },
    "encoding": {
      "x": { "field": { "repeat": "column" }, "type": "quantitative" },
      "y": { "field": { "repeat": "row" }, "type": "quantitative" },
      "size": { "field": "charts", "type": "quantitative" },
      "color": { "field": "renderer", "type": "nominal" },
      "tooltip": [{ "field": "doc" }, { "field": "renderer" }, { "field": "ms" }, { "field": "charts" }]
    }
  }
}
```

## 46. 双层异常检测

```vega-lite
{
  "data": { "values": [
    { "time": "09:00", "service": "preview", "value": 40 },
    { "time": "10:00", "service": "preview", "value": 44 },
    { "time": "11:00", "service": "preview", "value": 43 },
    { "time": "12:00", "service": "preview", "value": 120 },
    { "time": "09:00", "service": "export", "value": 80 },
    { "time": "10:00", "service": "export", "value": 86 },
    { "time": "11:00", "service": "export", "value": 92 },
    { "time": "12:00", "service": "export", "value": 210 }
  ] },
  "transform": [{ "calculate": "datum.value > 100 ? '异常' : '正常'", "as": "status" }],
  "layer": [
    {
      "mark": { "type": "line", "point": true },
      "encoding": {
        "x": { "field": "time", "type": "ordinal" },
        "y": { "field": "value", "type": "quantitative", "axis": { "title": "耗时 ms" } },
        "color": { "field": "service", "type": "nominal" }
      }
    },
    {
      "mark": { "type": "point", "shape": "diamond", "size": 180 },
      "encoding": {
        "x": { "field": "time", "type": "ordinal" },
        "y": { "field": "value", "type": "quantitative" },
        "color": { "field": "status", "type": "nominal", "scale": { "domain": ["正常", "异常"], "range": ["#4c78a8", "#e45756"] } }
      }
    },
    {
      "mark": { "type": "rule", "strokeDash": [6, 4], "color": "#e45756" },
      "encoding": { "y": { "datum": 100 } }
    }
  ]
}
```

## 47. 复杂分面导出矩阵

```vega-lite
{
  "data": { "values": [
    { "platform": "macOS", "format": "HTML", "renderer": "Vega-Lite", "ok": 98 },
    { "platform": "macOS", "format": "PDF", "renderer": "Vega-Lite", "ok": 94 },
    { "platform": "macOS", "format": "DOCX", "renderer": "Vega-Lite", "ok": 91 },
    { "platform": "Windows", "format": "HTML", "renderer": "D2", "ok": 92 },
    { "platform": "Windows", "format": "PDF", "renderer": "D2", "ok": 88 },
    { "platform": "Windows", "format": "DOCX", "renderer": "D2", "ok": 82 },
    { "platform": "Linux", "format": "HTML", "renderer": "BPMN", "ok": 87 },
    { "platform": "Linux", "format": "PDF", "renderer": "BPMN", "ok": 79 },
    { "platform": "Linux", "format": "DOCX", "renderer": "BPMN", "ok": 74 }
  ] },
  "facet": { "field": "platform", "type": "nominal", "columns": 3 },
  "spec": {
    "layer": [
      {
        "mark": "bar",
        "encoding": {
          "x": { "field": "format", "type": "nominal" },
          "y": { "field": "ok", "type": "quantitative", "axis": { "title": "成功率" } },
          "color": { "field": "renderer", "type": "nominal" }
        }
      },
      {
        "mark": { "type": "text", "dy": -5 },
        "encoding": {
          "x": { "field": "format", "type": "nominal" },
          "y": { "field": "ok", "type": "quantitative" },
          "text": { "field": "ok", "type": "quantitative" }
        }
      }
    ]
  }
}
```

## 48. 缺陷优先级瀑布

```vega-lite
{
  "data": { "values": [
    { "stage": "初始风险", "start": 0, "end": 100, "type": "base" },
    { "stage": "图表复杂化", "start": 100, "end": 128, "type": "up" },
    { "stage": "E2E 覆盖", "start": 128, "end": 96, "type": "down" },
    { "stage": "服务端 smoke", "start": 96, "end": 74, "type": "down" },
    { "stage": "发布检查", "start": 74, "end": 52, "type": "down" }
  ] },
  "layer": [
    {
      "mark": { "type": "bar", "cornerRadius": 3 },
      "encoding": {
        "x": { "field": "stage", "type": "nominal", "axis": { "labelAngle": -30, "title": null } },
        "y": { "field": "start", "type": "quantitative", "axis": { "title": "风险指数" } },
        "y2": { "field": "end" },
        "color": { "field": "type", "type": "nominal", "scale": { "domain": ["base", "up", "down"], "range": ["#4c78a8", "#e45756", "#54a24b"] } }
      }
    },
    {
      "mark": { "type": "text", "dy": -6 },
      "encoding": {
        "x": { "field": "stage", "type": "nominal" },
        "y": { "field": "end", "type": "quantitative" },
        "text": { "field": "end", "type": "quantitative" }
      }
    }
  ]
}
```

## 49. 多图拼接报告

```vega-lite
{
  "data": { "values": [
    { "renderer": "Vega-Lite", "complex": 9, "coverage": 95, "speed": 82 },
    { "renderer": "D2", "complex": 8, "coverage": 92, "speed": 88 },
    { "renderer": "BPMN", "complex": 10, "coverage": 85, "speed": 70 },
    { "renderer": "WaveDrom", "complex": 7, "coverage": 89, "speed": 91 },
    { "renderer": "C4PlantUML", "complex": 8, "coverage": 86, "speed": 68 }
  ] },
  "concat": [
    {
      "mark": "bar",
      "encoding": {
        "x": { "field": "renderer", "type": "nominal", "axis": { "labelAngle": -25 } },
        "y": { "field": "complex", "type": "quantitative", "axis": { "title": "复杂度" } },
        "color": { "field": "renderer", "type": "nominal", "legend": null }
      }
    },
    {
      "mark": { "type": "point", "filled": true, "size": 140 },
      "encoding": {
        "x": { "field": "coverage", "type": "quantitative", "axis": { "title": "覆盖率" } },
        "y": { "field": "speed", "type": "quantitative", "axis": { "title": "速度" } },
        "color": { "field": "renderer", "type": "nominal" },
        "tooltip": [{ "field": "renderer" }, { "field": "coverage" }, { "field": "speed" }]
      }
    }
  ],
  "columns": 1
}
```

## 50. 长文档图表密度分布

```vega-lite
{
  "data": { "values": [
    { "chapter": "需求", "section": "概述", "charts": 2, "words": 1200 },
    { "chapter": "需求", "section": "流程", "charts": 8, "words": 2600 },
    { "chapter": "设计", "section": "架构", "charts": 12, "words": 3400 },
    { "chapter": "设计", "section": "安全", "charts": 7, "words": 2100 },
    { "chapter": "测试", "section": "单测", "charts": 10, "words": 1800 },
    { "chapter": "测试", "section": "E2E", "charts": 16, "words": 2900 },
    { "chapter": "发布", "section": "变更", "charts": 5, "words": 1500 },
    { "chapter": "发布", "section": "验证", "charts": 9, "words": 2200 }
  ] },
  "transform": [
    { "calculate": "datum.charts / datum.words * 1000", "as": "density" },
    { "window": [{ "op": "rank", "as": "rank" }], "sort": [{ "field": "density", "order": "descending" }] }
  ],
  "layer": [
    {
      "mark": { "type": "bar", "cornerRadiusEnd": 4 },
      "encoding": {
        "y": { "field": "section", "type": "nominal", "sort": "-x", "axis": { "title": "章节" } },
        "x": { "field": "density", "type": "quantitative", "axis": { "title": "每千字图表数" } },
        "color": { "field": "chapter", "type": "nominal", "title": "部分" }
      }
    },
    {
      "mark": { "type": "text", "align": "left", "dx": 5 },
      "encoding": {
        "y": { "field": "section", "type": "nominal", "sort": "-x" },
        "x": { "field": "density", "type": "quantitative" },
        "text": { "field": "rank", "type": "ordinal" }
      }
    }
  ]
}
```
