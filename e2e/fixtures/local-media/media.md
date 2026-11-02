# Local media compatibility probe

这个文档覆盖 HTML 原生媒体、多个 source、字幕、时间片段、Obsidian/Wiki 嵌入和受限尺寸。

## HTML 视频、poster、时间片段与字幕

<video src="videos/demo.webm#t=0.5,2.5" controls poster="images/poster.png" preload="metadata" playsinline style="width: 100%; height: auto;">
  <track src="videos/zh.vtt" kind="subtitles" srclang="zh-CN" label="中文" default>
</video>

<video src="videos/demo.mp4" controls preload="metadata" style="width:100%;height:auto"></video>

## HTML 多 source、尺寸和 captions

<video controls preload="metadata" playsinline width="320" height="180" poster="images/poster.png">
  <source src="videos/demo.mp4" type="video/mp4">
  <source src="videos/demo.webm" type="video/webm">
  <track src="videos/zh.vtt" kind="captions" srclang="zh-CN" label="中文说明">
</video>

## Obsidian 视频与音频嵌入

![[videos/demo.webm|240x135]]

<audio src="audio/tone.mp3" controls preload="metadata"></audio>

<audio controls preload="metadata">
  <source src="audio/tone.mp3" type="audio/mpeg">
</audio>

![[audio/tone.mp3|测试音频]]

## Obsidian 图片尺寸与格式

![[images/poster.png|160x90]]

![[images/poster.avif|160x90]]

![[images/poster.bmp|160x90]]

## Obsidian 图表文件嵌入

![[diagrams/process.bpmn|Wiki BPMN]]

![[diagrams/board.excalidraw|规范 Excalidraw]]

下面的文件刻意缺少顶层 `type`，用于验证 Excalidraw 兼容模式提示。

![[../excalidraw/compatible-no-type.excalidraw|兼容模式 Excalidraw]]
