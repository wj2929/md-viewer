# C4-PlantUML Renderer 综合测试

本文档覆盖 `c4` 与 `c4plantuml` 两种语言标识。`c4` 示例不显式 include，应由渲染器自动补充 C4 标准库。

---

## 1. c4 别名基础上下文图

```c4
@startuml
Person(user, "用户", "阅读和导出 Markdown 文档")
System(viewer, "MD Viewer", "Markdown 预览、编辑与导出")
System_Ext(docx, "DOCX 服务", "生成 DOCX 文件")

Rel(user, viewer, "打开、预览、编辑")
Rel(viewer, docx, "提交渲染后的文档")
@enduml
```

## 2. 容器关系图

```c4
@startuml
Person(user, "用户")
System_Boundary(mdv, "MD Viewer") {
  Container(renderer, "RendererPlugin", "TypeScript", "识别和渲染扩展图表")
  Container(exporter, "Export Pipeline", "Electron", "收集截图并导出")
  Container(settings, "Settings", "React", "配置渲染能力")
}

Rel(user, settings, "启用 renderer")
Rel(user, renderer, "预览 Markdown")
Rel(renderer, exporter, "提供图表截图目标")
@enduml
```

## 3. 服务端渲染上下文

```c4
@startuml
Person(dev, "开发者")
System(viewer, "MD Viewer")
System_Ext(service, "md-viewer-docx-service")
System_Ext(browser, "Headless Browser")
System_Ext(pandoc, "Pandoc")

Rel(dev, viewer, "发起 DOCX 导出")
Rel(viewer, service, "发送 Markdown/HTML")
Rel(service, browser, "渲染图表截图")
Rel(service, pandoc, "生成 DOCX")
@enduml
```

## 4. 组件边界

```c4
@startuml
Container_Boundary(renderer, "RendererPlugin") {
  Component(registry, "Registry", "TS", "语言到渲染器的映射")
  Component(security, "Security Gateway", "TS", "网络和资源策略")
  Component(preview, "Preview Hook", "React", "预览渲染")
  Component(server, "Server Render Adapter", "React", "导出截图")
}

Rel(registry, preview, "resolve")
Rel(security, preview, "guard")
Rel(preview, server, "共享选择器")
@enduml
```

## 5. 文件关联上下文

```c4
@startuml
Person(writer, "内容作者")
System(os, "操作系统")
System(viewer, "MD Viewer")
System_Ext(files, "本地 Markdown 文件")

Rel(writer, os, "双击 .md 文件")
Rel(os, viewer, "open-file / argv")
Rel(viewer, files, "读取并预览")
@enduml
```

## 6. 多窗口场景

```c4
@startuml
Person(user, "用户")
System_Boundary(app, "MD Viewer") {
  Container(win1, "窗口 A", "Electron BrowserWindow", "打开项目 A")
  Container(win2, "窗口 B", "Electron BrowserWindow", "打开项目 B")
  Container(store, "App Store", "electron-store", "保存窗口状态")
}

Rel(user, win1, "查看文档")
Rel(user, win2, "对比文档")
Rel(win1, store, "保存位置")
Rel(win2, store, "保存位置")
@enduml
```

## 7. c4plantuml 显式 include

```c4plantuml
@startuml
!include <C4/C4_Context>
Person(editor, "内容编辑")
System_Boundary(app, "MD Viewer") {
  System(preview, "预览器", "渲染 Markdown 和图表")
  System(exporter, "导出器", "输出 HTML/PDF/DOCX")
}
System_Ext(files, "本地文件系统")

Rel(editor, preview, "查看文档")
Rel(preview, exporter, "提供渲染结果")
Rel(exporter, files, "写入导出文件")
@enduml
```

## 8. c4plantuml 容器图

```c4plantuml
@startuml
!include <C4/C4_Container>
Person(user, "用户")
System_Boundary(mdv, "MD Viewer") {
  Container(react, "Renderer", "React", "预览和编辑")
  Container(main, "Main Process", "Electron", "IPC、菜单、文件")
  Container(cache, "File Cache", "TS", "缓存 Markdown 内容")
}

Rel(user, react, "操作 UI")
Rel(react, main, "IPC")
Rel(main, cache, "读写缓存")
@enduml
```

## 9. c4plantuml 组件图

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(exporter, "Export Pipeline") {
  Component(html, "HTML Export", "TS", "生成独立 HTML")
  Component(pdf, "PDF Export", "Electron", "printToPDF")
  Component(docx, "DOCX Export", "TS", "收集图表图片")
  Component(tasks, "Export Tasks", "React", "导出进度")
}

Rel(tasks, html, "触发")
Rel(tasks, pdf, "触发")
Rel(tasks, docx, "触发")
@enduml
```

## 10. c4plantuml 动态交互

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(user, "用户")
System(viewer, "MD Viewer")
System_Ext(service, "DOCX Service")
System_Ext(fs, "File System")

Rel(user, viewer, "点击导出 DOCX")
Rel(viewer, fs, "读取 Markdown")
Rel(viewer, service, "提交文档和资源")
Rel(service, viewer, "返回 DOCX 文件")
Rel(viewer, fs, "保存导出结果")
@enduml
```

## 11. c4 用户角色上下文

```c4
@startuml
Person(author, "内容作者", "维护 Markdown 文档")
Person(reviewer, "评审者", "查看导出结果")
System(viewer, "MD Viewer", "本地预览和导出工具")
System_Ext(repo, "Git 仓库", "保存文档和测试样例")

Rel(author, viewer, "编辑和预览")
Rel(reviewer, viewer, "打开 HTML/PDF/DOCX")
Rel(viewer, repo, "读取 fixture")
@enduml
```

## 12. c4 图表插件边界

```c4
@startuml
System_Boundary(mdv, "MD Viewer") {
  Container(registry, "Renderer Registry", "TypeScript", "统一插件描述")
  Container(vega, "Vega-Lite Plugin", "TS", "统计图")
  Container(d2, "D2 Plugin", "TS", "结构图")
  Container(bpmn, "BPMN Plugin", "TS", "流程图")
}

Rel(registry, vega, "注册")
Rel(registry, d2, "注册")
Rel(registry, bpmn, "注册")
@enduml
```

## 13. c4 导出运行时

```c4
@startuml
Person(user, "用户")
System_Boundary(runtime, "导出运行时") {
  Container(snapshot, "截图收集", "Playwright", "定位 SVG")
  Container(rewrite, "Markdown 替换", "TS", "插入图片占位")
  Container(result, "导出结果", "HTML/PDF/DOCX", "保存文件")
}
System_Ext(service, "DOCX 服务")

Rel(user, snapshot, "发起导出")
Rel(snapshot, rewrite, "图片数据")
Rel(rewrite, service, "提交")
Rel(service, result, "返回")
@enduml
```

## 14. c4 安全策略

```c4
@startuml
Person(user, "用户")
System(viewer, "MD Viewer")
System_Ext(local, "本地文件")
System_Ext(remote, "远程服务")
System_Ext(blocked, "不可信 URL")

Rel(user, viewer, "打开文档")
Rel(viewer, local, "读取同目录资源")
Rel(viewer, remote, "可配置 PlantUML")
Rel(viewer, blocked, "阻止")
@enduml
```

## 15. c4 测试流水线

```c4
@startuml
Person(dev, "开发者")
System(unit, "Vitest", "结构与单元测试")
System(e2e, "Electron E2E", "真实窗口预览")
System(ci, "发布前检查", "构建和回归")

Rel(dev, unit, "运行")
Rel(unit, e2e, "提供信心")
Rel(e2e, ci, "验证发布")
@enduml
```

## 16. c4 多平台打开方式

```c4
@startuml
Person(user, "用户")
System(mac, "macOS Finder")
System(win, "Windows Explorer")
System(linux, "Linux Desktop")
System(viewer, "MD Viewer")

Rel(user, mac, "右键打开 .md")
Rel(user, win, "Open with")
Rel(user, linux, "MIME handler")
Rel(mac, viewer, "open-file")
Rel(win, viewer, "argv")
Rel(linux, viewer, "desktop entry")
@enduml
```

## 17. c4plantuml 预览编辑闭环

```c4plantuml
@startuml
!include <C4/C4_Context>
Person(editor, "编辑者")
System(preview, "预览区")
System(edit, "编辑模式")
System(save, "保存机制")

Rel(editor, preview, "默认查看")
Rel(editor, edit, "切换编辑")
Rel(edit, preview, "实时预览")
Rel(edit, save, "保存或放弃")
@enduml
```

## 18. c4plantuml 图表失败降级

```c4plantuml
@startuml
!include <C4/C4_Container>
System_Boundary(app, "MD Viewer") {
  Container(parser, "Parser", "TS", "识别代码块")
  Container(renderer, "Renderer", "TS", "生成 SVG")
  Container(fallback, "Fallback UI", "React", "显示错误和源码")
}

Rel(parser, renderer, "提交源码")
Rel(renderer, fallback, "失败原因")
@enduml
```

## 19. c4plantuml 服务端截图

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(server, "Server Render") {
  Component(input, "Render Input", "JSON", "Markdown 和开关")
  Component(page, "Render Page", "React", "等待图表完成")
  Component(images, "Image Collector", "TS", "输出 images[]")
}

Rel(input, page, "注入")
Rel(page, images, "查询 SVG")
@enduml
```

## 20. c4plantuml 发布验证

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(maintainer, "维护者")
System(workspace, "工作区")
System(test, "自动化测试")
System(tag, "Release Tag")
System_Ext(github, "GitHub Release")

Rel(maintainer, workspace, "整理变更")
Rel(workspace, test, "运行验证")
Rel(test, tag, "通过后打 tag")
Rel(tag, github, "发布说明")
@enduml
```

## 21. c4 多租户文档工作区

```c4
@startuml
Person(admin, "管理员")
Person(writer, "文档作者")
System(viewer, "MD Viewer")
System_Ext(folderA, "项目 A 文档目录")
System_Ext(folderB, "项目 B 文档目录")
System_Ext(settings, "本地设置")

Rel(admin, settings, "配置渲染器")
Rel(writer, viewer, "打开工作区")
Rel(viewer, folderA, "读取 Markdown")
Rel(viewer, folderB, "读取 Markdown")
Rel(viewer, settings, "保存窗口和导出设置")
@enduml
```

## 22. c4 插件注册中心

```c4
@startuml
Person(dev, "开发者")
System_Boundary(registry, "RendererPlugin Registry") {
  System(manifest, "Manifest", "声明 type/language/selector")
  System(preview, "Preview Adapter", "渲染进程 Hook")
  System(exporter, "Export Adapter", "服务端截图和 DOCX 替换")
  System(security, "Security Policy", "网络和文件访问控制")
}

Rel(dev, manifest, "新增插件")
Rel(manifest, preview, "预览契约")
Rel(manifest, exporter, "导出契约")
Rel(security, preview, "限制资源")
Rel(security, exporter, "限制资源")
@enduml
```

## 23. c4 DOCX 服务部署视图

```c4
@startuml
Person(user, "用户")
System(viewer, "MD Viewer Desktop")
System_Ext(service, "md-viewer-docx-service")
System_Ext(browser, "Headless Chromium")
System_Ext(pandoc, "Pandoc")
System_Ext(fonts, "离线字体目录")

Rel(user, viewer, "导出 DOCX")
Rel(viewer, service, "提交 Markdown 和资源")
Rel(service, browser, "渲染图表截图")
Rel(service, pandoc, "转换文档")
Rel(service, fonts, "加载字体")
@enduml
```

## 24. c4 文件树过滤

```c4
@startuml
Person(user, "用户")
System(viewer, "MD Viewer")
System(filter, "文件过滤框")
System(tree, "文件树")
System(cache, "目录缓存")

Rel(user, filter, "输入中文/英文")
Rel(filter, cache, "关键词查询")
Rel(cache, tree, "返回匹配节点")
Rel(user, tree, "点击打开")
Rel(tree, viewer, "加载文档")
@enduml
```

## 25. c4 图表工具栏

```c4
@startuml
Person(reader, "阅读者")
System(chart, "图表容器")
System(toolbar, "浮动工具栏")
System(code, "源码视图")
System(download, "下载能力")
System(fullscreen, "全屏预览")

Rel(reader, chart, "悬停")
Rel(chart, toolbar, "显示操作")
Rel(toolbar, code, "切换源码")
Rel(toolbar, download, "保存图片")
Rel(toolbar, fullscreen, "放大查看")
@enduml
```

## 26. c4 错误隔离

```c4
@startuml
Person(user, "用户")
System(markdown, "Markdown 页面")
System(ok, "正常图表")
System(failed, "失败图表")
System(error, "错误占位")
System(export, "导出汇总")

Rel(user, markdown, "打开文档")
Rel(markdown, ok, "渲染成功")
Rel(markdown, failed, "渲染失败")
Rel(failed, error, "显示原因")
Rel(ok, export, "输出图片")
Rel(error, export, "保留错误信息")
@enduml
```

## 27. c4 自动化验证

```c4
@startuml
Person(maintainer, "维护者")
System(unit, "Vitest")
System(typecheck, "TypeScript")
System(lint, "ESLint")
System(build, "Electron Build")
System(e2e, "Playwright E2E")

Rel(maintainer, unit, "运行")
Rel(unit, typecheck, "通过后继续")
Rel(typecheck, lint, "检查风格")
Rel(lint, build, "构建产物")
Rel(build, e2e, "真实预览验证")
@enduml
```

## 28. c4 多窗口状态

```c4
@startuml
Person(user, "用户")
System(app, "MD Viewer")
System(winA, "窗口 A")
System(winB, "窗口 B")
System(store, "窗口状态存储")
System(files, "本地文件")

Rel(user, app, "打开多个项目")
Rel(app, winA, "创建")
Rel(app, winB, "创建")
Rel(winA, files, "读取项目 A")
Rel(winB, files, "读取项目 B")
Rel(winA, store, "保存状态")
Rel(winB, store, "保存状态")
@enduml
```

## 29. c4 离线资源策略

```c4
@startuml
Person(user, "用户")
System(viewer, "MD Viewer")
System(local, "本地资源")
System(fonts, "离线字体")
System(remote, "远程渲染服务")
System(policy, "网络策略")

Rel(user, viewer, "打开文档")
Rel(viewer, local, "读取图片和 BPMN")
Rel(viewer, fonts, "导出字体")
Rel(viewer, policy, "检查")
Rel(policy, remote, "允许或阻止")
@enduml
```

## 30. c4 发布说明结构

```c4
@startuml
Person(maintainer, "维护者")
System(changelog, "CHANGELOG")
System(tag, "Git Tag")
System(release, "GitHub Release")
System(assets, "安装包")
System(macHelp, "macOS 打开说明")

Rel(maintainer, changelog, "整理变更")
Rel(changelog, tag, "版本依据")
Rel(tag, release, "生成发布")
Rel(assets, release, "上传")
Rel(macHelp, release, "补充说明")
@enduml
```

## 31. c4plantuml 容器级插件架构

```c4plantuml
@startuml
!include <C4/C4_Container>
Person(user, "用户")
System_Boundary(app, "MD Viewer") {
  Container(ui, "Renderer UI", "React", "显示 Markdown 与图表")
  Container(registry, "Renderer Registry", "TypeScript", "统一插件元数据")
  Container(exporter, "Export Pipeline", "Electron", "HTML/PDF/DOCX")
  Container(settings, "Settings Store", "electron-store", "保存图表开关")
}

Rel(user, ui, "预览")
Rel(ui, registry, "查询插件")
Rel(ui, exporter, "发起导出")
Rel(settings, registry, "启用状态")
@enduml
```

## 32. c4plantuml 组件级导出链路

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(exporter, "Export Pipeline") {
  Component(markdown, "Markdown Renderer", "TS", "生成安全 HTML")
  Component(capture, "Chart Capture", "Playwright", "截图 SVG")
  Component(replace, "Placeholder Rewriter", "TS", "替换占位")
  Component(writer, "File Writer", "Electron", "写入文件")
}

Rel(markdown, capture, "提供 DOM")
Rel(capture, replace, "图片数据")
Rel(replace, writer, "最终内容")
@enduml
```

## 33. c4plantuml 动态错误恢复

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(user, "用户")
System(ui, "预览 UI")
System(renderer, "RendererPlugin")
System(error, "错误占位")
System(editor, "编辑模式")

Rel(user, ui, "打开文档")
Rel(ui, renderer, "渲染图表")
Rel(renderer, error, "返回错误")
Rel(user, editor, "修改源码")
Rel(editor, renderer, "重新渲染")
Rel(renderer, ui, "显示图表")
@enduml
```

## 34. c4plantuml 跨平台文件关联

```c4plantuml
@startuml
!include <C4/C4_Context>
Person(user, "用户")
System(mac, "macOS Finder")
System(win, "Windows Explorer")
System(linux, "Linux Desktop")
System(viewer, "MD Viewer")

Rel(user, mac, "右键打开")
Rel(user, win, "Open With")
Rel(user, linux, "MIME 打开")
Rel(mac, viewer, "open-file")
Rel(win, viewer, "argv")
Rel(linux, viewer, "desktop entry")
@enduml
```

## 35. c4plantuml DOCX 服务边界

```c4plantuml
@startuml
!include <C4/C4_Container>
Person(user, "用户")
System(viewer, "MD Viewer Desktop")
System_Boundary(service, "DOCX Service") {
  Container(api, "FastAPI", "Python", "接收导出请求")
  Container(render, "Renderer", "Playwright", "图表截图")
  Container(convert, "Pandoc", "CLI", "转换 DOCX")
  Container(fonts, "Fonts", "Local Files", "离线字体")
}

Rel(user, viewer, "导出")
Rel(viewer, api, "HTTP")
Rel(api, render, "渲染")
Rel(api, convert, "转换")
Rel(convert, fonts, "加载")
@enduml
```

## 36. c4plantuml 安全威胁模型

```c4plantuml
@startuml
!include <C4/C4_Context>
Person(attacker, "恶意文档")
System(viewer, "MD Viewer")
System(policy, "Security Policy")
System(local, "本地文件")
System(remote, "远程 URL")
System(error, "错误提示")

Rel(attacker, viewer, "嵌入外部资源")
Rel(viewer, policy, "检查")
Rel(policy, local, "允许同目录")
Rel(policy, remote, "阻止")
Rel(policy, error, "说明原因")
@enduml
```

## 37. c4plantuml 复杂工作区

```c4plantuml
@startuml
!include <C4/C4_Container>
Person(writer, "作者")
System_Boundary(workspace, "文档工作区") {
  Container(tree, "File Tree", "React", "过滤和打开文件")
  Container(tabs, "Tabs", "React", "多文档切换")
  Container(preview, "Preview", "React", "Markdown 渲染")
  Container(edit, "Edit Mode", "CodeMirror", "源码编辑")
}

Rel(writer, tree, "搜索")
Rel(tree, tabs, "打开")
Rel(tabs, preview, "显示")
Rel(preview, edit, "切换编辑")
Rel(edit, preview, "实时预览")
@enduml
```

## 38. c4plantuml 观测性

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(runtime, "Runtime") {
  Component(log, "Logger", "TS", "记录错误")
  Component(metric, "Metrics", "TS", "统计渲染耗时")
  Component(toast, "Toast", "React", "用户提示")
  Component(test, "E2E Report", "Playwright", "保存 trace")
}

Rel(log, toast, "用户可见错误")
Rel(metric, test, "测试结果")
Rel(log, test, "失败上下文")
@enduml
```

## 39. c4plantuml 插件路线图

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(maintainer, "维护者")
System(vega, "Vega-Lite")
System(d2, "D2")
System(bpmn, "BPMN")
System(wave, "WaveDrom")
System(c4, "C4PlantUML")
System(future, "真实文档补充")

Rel(maintainer, vega, "第一阶段")
Rel(vega, d2, "第二阶段")
Rel(d2, bpmn, "第三阶段")
Rel(bpmn, wave, "第四阶段")
Rel(wave, c4, "第五阶段")
Rel(c4, future, "按需扩展")
@enduml
```

## 40. c4plantuml 发布前质量门禁

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(gate, "Release Gate") {
  Component(fixtures, "Fixture Coverage", "Vitest", "数量和结构")
  Component(unit, "Renderer Unit Tests", "Vitest", "渲染器逻辑")
  Component(server, "Server Render E2E", "Playwright", "导出路径")
  Component(electron, "Electron E2E", "Playwright", "真实预览")
}

Rel(fixtures, unit, "通过后继续")
Rel(unit, server, "覆盖服务端")
Rel(server, electron, "覆盖桌面端")
@enduml
```

## 41. c4 企业级文档平台全景

```c4
@startuml
Person(author, "文档作者")
Person(reviewer, "评审者")
Person(admin, "管理员")
System_Boundary(desktop, "MD Viewer Desktop") {
  System(preview, "预览模块")
  System(editor, "编辑模块")
  System(exporter, "导出模块")
  System(settings, "设置模块")
}
System_Ext(docx, "DOCX Service")
System_Ext(fs, "本地文件系统")
System_Ext(release, "GitHub Release")

Rel(author, editor, "编辑 Markdown")
Rel(author, preview, "实时预览")
Rel(reviewer, preview, "审阅文档")
Rel(admin, settings, "配置渲染器")
Rel(preview, fs, "读取资源")
Rel(exporter, docx, "导出 DOCX")
Rel(exporter, fs, "保存 HTML/PDF")
Rel(admin, release, "发布安装包")
@enduml
```

## 42. c4 多服务导出集群

```c4
@startuml
Person(user, "用户")
System(viewer, "MD Viewer")
System_Boundary(cluster, "导出集群") {
  System(api, "Export API")
  System(queue, "任务队列")
  System(workerA, "Renderer Worker A")
  System(workerB, "Renderer Worker B")
  System(pandoc, "Pandoc Worker")
  System(store, "对象存储")
}
System_Ext(fonts, "离线字体包")

Rel(user, viewer, "点击导出")
Rel(viewer, api, "提交任务")
Rel(api, queue, "入队")
Rel(queue, workerA, "渲染 HTML")
Rel(queue, workerB, "截图图表")
Rel(workerA, store, "写入中间产物")
Rel(workerB, store, "写入图片")
Rel(store, pandoc, "读取资源")
Rel(fonts, pandoc, "加载字体")
Rel(pandoc, api, "返回 DOCX")
@enduml
```

## 43. c4 安全分区

```c4
@startuml
Person(user, "用户")
System_Boundary(trusted, "可信区域") {
  System(localFiles, "同目录文件")
  System(settings, "本地配置")
  System(cache, "渲染缓存")
}
System_Boundary(untrusted, "不可信输入") {
  System(markdown, "Markdown 内容")
  System(remoteUrl, "远程 URL")
  System(svg, "第三方 SVG")
}
System(policy, "安全策略")
System(error, "错误 UI")
System(renderer, "RendererPlugin")

Rel(user, markdown, "打开")
Rel(markdown, policy, "校验")
Rel(remoteUrl, policy, "网络检查")
Rel(svg, policy, "净化")
Rel(localFiles, policy, "路径检查")
Rel(settings, policy, "读取策略")
Rel(policy, renderer, "允许")
Rel(policy, error, "阻止")
Rel(renderer, cache, "缓存结果")
@enduml
```

## 44. c4 复杂测试覆盖地图

```c4
@startuml
Person(maintainer, "维护者")
System_Boundary(tests, "测试体系") {
  System(unit, "单元测试")
  System(fixture, "Fixture 复杂度测试")
  System(e2e, "Electron E2E")
  System(server, "Server Render E2E")
  System(export, "导出回归")
}
System_Ext(fixtures, "复杂 Markdown 样例")
System_Ext(results, "test-results")

Rel(maintainer, unit, "运行")
Rel(maintainer, fixture, "检查数量和复杂度")
Rel(fixture, fixtures, "读取")
Rel(unit, e2e, "基础通过后")
Rel(e2e, results, "截图和 trace")
Rel(server, export, "验证导出")
Rel(export, results, "记录结果")
Rel(fixtures, e2e, "真实打开")
@enduml
```

## 45. c4plantuml 跨进程架构细节

```c4plantuml
@startuml
!include <C4/C4_Container>
Person(user, "用户")
System_Boundary(electron, "Electron App") {
  Container(renderer, "Renderer Process", "React", "预览、编辑、图表 Hook")
  Container(preload, "Preload Bridge", "TypeScript", "安全暴露 IPC API")
  Container(main, "Main Process", "Electron", "文件、菜单、导出")
  Container(store, "Store", "electron-store", "配置和窗口状态")
}
System_Ext(docx, "DOCX Service")
System_Ext(fs, "Local File System")

Rel(user, renderer, "操作 UI")
Rel(renderer, preload, "window.api")
Rel(preload, main, "IPC")
Rel(main, fs, "读写文件")
Rel(main, store, "保存设置")
Rel(main, docx, "远程导出")
Rel(docx, main, "返回文件")
@enduml
```

## 46. c4plantuml RendererPlugin 组件图

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(registry, "RendererPlugin Registry") {
  Component(manifest, "Manifest Loader", "TS", "加载内置插件声明")
  Component(resolver, "Language Resolver", "TS", "别名与语言映射")
  Component(preview, "Preview Adapter", "React Hook", "替换代码块")
  Component(server, "Server Adapter", "React", "等待图表完成")
  Component(docx, "DOCX Adapter", "TS", "占位符与图片替换")
  Component(policy, "Security Gateway", "TS", "资源与网络限制")
}

Rel(manifest, resolver, "注册")
Rel(resolver, preview, "解析语言")
Rel(resolver, server, "解析语言")
Rel(preview, policy, "检查输入")
Rel(server, policy, "检查导出策略")
Rel(preview, docx, "共享 blockId")
Rel(server, docx, "输出 images")
@enduml
```

## 47. c4plantuml DOCX 服务组件细节

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(service, "md-viewer-docx-service") {
  Component(api, "FastAPI Router", "Python", "接收导出请求")
  Component(asset, "Asset Resolver", "Python", "解析本地和上传资源")
  Component(render, "Renderer Runtime", "Playwright", "渲染图表")
  Component(template, "Template Manager", "Python", "选择导出模板")
  Component(pandoc, "Pandoc Runner", "CLI", "生成 DOCX")
  Component(fonts, "Font Resolver", "Python", "离线字体路径")
}

Rel(api, asset, "解析资源")
Rel(api, render, "启动页面")
Rel(render, asset, "读取图片和图表")
Rel(api, template, "选择模板")
Rel(template, pandoc, "传入模板")
Rel(fonts, pandoc, "字体配置")
Rel(render, pandoc, "图表图片")
@enduml
```

## 48. c4plantuml 动态导出失败恢复

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(user, "用户")
System(ui, "ExportTaskView")
System(main, "Main Process")
System(service, "DOCX Service")
System(error, "错误提示")
System(settings, "设置面板")
System(retry, "重试任务")

Rel(user, ui, "点击导出")
Rel(ui, main, "IPC export")
Rel(main, service, "HTTP request")
Rel(service, main, "连接失败")
Rel(main, error, "返回错误")
Rel(error, settings, "提示服务地址")
Rel(user, settings, "修改配置")
Rel(settings, retry, "重新导出")
Rel(retry, service, "再次请求")
@enduml
```

## 49. c4plantuml 多窗口动态流程

```c4plantuml
@startuml
!include <C4/C4_Dynamic>
Person(user, "用户")
System(os, "操作系统")
System(main, "Electron Main")
System(winA, "Window A")
System(winB, "Window B")
System(store, "Window State Store")
System(file, "Markdown File")

Rel(user, os, "打开 .md")
Rel(os, main, "open-file / argv")
Rel(main, store, "读取窗口策略")
Rel(main, winA, "复用窗口")
Rel(main, winB, "必要时新建")
Rel(winA, file, "读取文档")
Rel(winB, file, "读取文档")
Rel(winA, store, "保存状态")
Rel(winB, store, "保存状态")
@enduml
```

## 50. c4plantuml 发布链路全景

```c4plantuml
@startuml
!include <C4/C4_Component>
Container_Boundary(release, "Release Pipeline") {
  Component(changelog, "CHANGELOG", "Markdown", "版本变更")
  Component(tag, "Git Tag", "Git", "版本标记")
  Component(build, "Build Assets", "electron-builder", "dmg zip exe")
  Component(notes, "Release Notes", "Markdown", "安装说明")
  Component(mac, "macOS Notice", "Text", "xattr 和隐私安全说明")
  Component(github, "GitHub Release", "GitHub", "发布页面")
}

Rel(changelog, tag, "确定版本")
Rel(tag, build, "触发构建")
Rel(changelog, notes, "生成说明")
Rel(mac, notes, "补充 macOS 使用说明")
Rel(build, github, "上传资产")
Rel(notes, github, "发布正文")
Rel(tag, github, "关联版本")
@enduml
```
