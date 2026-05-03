# DrawIO 渲染冒烟测试

## 1. 基础 drawio

```drawio
<mxfile host="app.diagrams.net">
  <diagram name="Basic" id="basic">
    <mxGraphModel dx="640" dy="360" grid="1" gridSize="10">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="开始" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="处理" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="220" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="4" edge="1" source="2" target="3" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## 2. dio 别名

```dio
<mxGraphModel dx="480" dy="240" grid="1" gridSize="10">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="dio 别名" style="ellipse;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
      <mxGeometry x="60" y="40" width="140" height="70" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

## 3. 破损 XML

```drawio
<mxGraphModel>
  <root>
    <mxCell id="0">
</mxGraphModel>
```
