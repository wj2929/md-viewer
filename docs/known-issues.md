# MD Viewer 已知问题

> 最后更新：2026-08-23

---

## 当前稳定性与限制

### 1. 渲染区直接编辑能力边界

**现象**：编辑模式下，段落、标题、列表、引用、普通代码块和表格单元格适合直接在渲染区编辑；复杂图表、嵌入式组件、非标准 Markdown 或深层嵌套结构仍建议使用源码编辑。

**原因**：渲染区编辑需要把 DOM 位置映射回 Markdown 源码。复杂块的语法边界和渲染结果不总是一一对应。

**当前状态**：已覆盖常见块编辑、未保存草稿保护、撤销重做、保存后滚动保持和分屏编辑。复杂块继续保留源码编辑兜底，并对不可直接编辑块提供源码编辑入口。

---

### 2. 外部服务型图表与 DOCX 导出

**现象**：PlantUML、Kroki、DOCX 高质量导出等能力可能依赖外部服务、本机服务或网络环境。服务不可用时，导出预检会显示风险；无法安全渲染的图表在正式导出中使用中性占位，不嵌入图表源码或内部错误信息。

**原因**：这些能力并非全部由桌面端离线完成。DOCX 生成尤其依赖 `md-viewer-docx-service` 的版本、字体、模板和浏览器渲染环境。

**当前状态**：未设置 `MD_VIEWER_DOCX_SERVICE_URL` 时，DOCX 服务 E2E 会记录跳过原因，不阻断桌面端发版；已配置服务时，服务不可达、版本过低或样式不支持应作为导出问题处理。

---

### 3. DOCX 与预览不是像素级一致

**现象**：HTML/PDF 更接近应用内预览，DOCX 仍可能在字体、分页、图表尺寸、表格宽度和公式布局上与预览存在差异。

**原因**：DOCX 是 Word 文档格式，正文会映射为 Word 样式，图表通常以截图方式注入。

**当前状态**：桌面端 HTML/PDF、图表 PNG 下载和批量打包导出均有回归门禁；DOCX 的高质量一致性继续由 `md-viewer-docx-service` 版本共同决定，导出 warning 会提供原因、影响和处理建议。

---

## Linux 平台

### 4. Wayland 拖拽限制

**现象**：在 Wayland 会话下，文件从外部拖入应用窗口可能无响应。

**原因**：Electron 的 `startDrag` API 依赖 X11 协议，Wayland 原生拖拽协议（`wl_data_device`）尚未完全支持。

**影响范围**：GNOME 45+（默认 Wayland）、KDE Plasma 6+

**临时方案**：
- 启动时添加 `--ozone-platform=x11` 强制使用 XWayland
- 或在登录界面选择 "GNOME on Xorg" 会话

**跟踪**：[Electron #38612](https://github.com/electron/electron/issues/38612)

---

### 5. inotify 监听数量限制

**现象**：打开包含大量文件的目录时，文件监听可能失败，控制台报 `ENOSPC: System limit for number of file watchers reached`。

**原因**：Linux 默认 `fs.inotify.max_user_watches` 为 8192，大型项目目录可能超出。

**解决方案**：
```bash
# 临时生效
sudo sysctl fs.inotify.max_user_watches=524288

# 永久生效
echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

### 6. 回收站依赖 gvfs

**现象**：删除文件时报错 "移到废纸篓失败"。

**原因**：Electron 的 `shell.trashItem()` 在 Linux 上依赖 `gvfs-trash` 或 `gio trash`。

**解决方案**：
```bash
# Ubuntu/Debian
sudo apt install gvfs

# Fedora
sudo dnf install gvfs

# Arch
sudo pacman -S gvfs
```

---

## Windows 平台

### 7. CF_HDROP 剪贴板格式限制

**现象**：从资源管理器复制文件后粘贴到应用内，部分场景下文件路径无法正确读取。

**原因**：Electron 的 `clipboard.readBuffer('FileNameW')` 只能读取单个文件路径。Windows 原生的 `CF_HDROP` 格式支持多文件，但需要通过 native module 解析 `DROPFILES` 结构体。

**当前状态**：单文件复制粘贴正常工作，多文件场景降级为逐个操作。

**未来计划**：评估引入 `node-ffi-napi` 或自定义 native addon 解析 `CF_HDROP`。

---

## macOS 平台

### 8. hardened runtime 与公证

**现象**：首次打开应用时 macOS 弹出 "无法验证开发者" 警告。

**原因**：应用未经 Apple 公证（notarization），Gatekeeper 会阻止运行。

**解决方案**：
```bash
# 方法 1：系统设置
# 系统设置 → 隐私与安全性 → 安全性 → 仍然允许

# 方法 2：命令行移除隔离属性
APP="/Applications/MD Viewer.app"; if [ -d "$APP" ]; then xattr -dr com.apple.quarantine "$APP" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$APP"; xattr -d com.apple.provenance "$APP" 2>/dev/null || true; else echo "未找到 $APP，请先把 MD Viewer.app 拖到 /Applications"; fi

# 方法 3：兜底清理
APP="/Applications/MD Viewer.app"; xattr -cr "$APP" 2>/dev/null || sudo xattr -cr "$APP"
```

**未来计划**：申请 Apple Developer 证书，配置自动公证流程。

---

## 跨平台通用

### 9. ARM64 架构支持评估

**当前状态**：
| 平台 | 架构 | 状态 |
|------|------|------|
| macOS | Apple Silicon (arm64) | ✅ 提供独立 arm64 安装包 |
| macOS | Intel (x64) | ✅ 提供独立 x64 安装包 |
| Windows | x64 | ✅ 支持 |
| Windows | ARM64 | ⚠️ 通过 x64 模拟运行，未提供原生 ARM64 包 |
| Linux | x64 | ✅ 支持 AppImage 与 deb |
| Linux | ARM64 | ⚠️ 未提供预编译包，需从源码构建 |

**结论**：当前仅发布 macOS arm64/x64、Windows x64 和 Linux x64 包。Windows ARM64 可尝试通过系统的 x64 模拟层运行，但未建立原生性能与兼容性门禁；Linux ARM64 也未提供预编译包。源码构建是否成功取决于 Electron、运行时依赖和目标发行版环境，不作为正式支持承诺。

---

### 10. 大文件与工作区索引边界

**现象**：超长 Markdown、图表密集文档或包含大量文件的工作区，首次渲染、全文搜索和反向链接建立可能需要更长时间。

**当前保护**：预览对超长内容采用受限渲染；本地工作区索引默认不索引超过 5 MiB 的 Markdown，也会跳过不可读、解析失败和受剪枝规则排除的文件。此时搜索状态会显示“部分降级”，结果可能不完整，但普通文档阅读不受阻塞。

---

### 11. 移动后的链接修复边界

**当前状态**：同一工作区根内移动或重命名可在物理操作成功后生成精确修复预览，并要求第二次确认。文件 revision、source range 或原始目标不一致时会报告冲突并跳过，不提供强制覆盖。

跨根移动只显示 origin、moved、target 三侧链接影响，不自动改写任一侧 Markdown。HTML、动态目标、无法取得稳定 source range 和工作区外资源也只报告，需要手工处理。watcher 推断出的 rename 仅作为提示，不会自动迁移标签或修改链接。

---

### 12. 文件夹会话并发覆盖

**现象**：多个窗口同时打开并修改同一文件夹的标签、分屏和阅读位置时，最后保存的文件夹会话会覆盖较早保存的会话。

**当前状态**：会话恢复采用 last-write-wins。它不影响 Markdown 文件内容，但不提供多个窗口之间的会话合并。

---

### 13. Experimental CLI 契约

`inspect`、`links`、`render`、`diff` 和 `watch` 当前属于 experimental。脚本和 CI 在调用前应读取 `md-viewer capabilities --json`，并按返回的 schema/version 判断能力；不要假设实验性字段永久不变。`watch` 的 rename 事件带 `inferred: true`，只表示启发式相关性，原始 added/removed 事实仍会保留。

---

*如遇到未列出的问题，请在 [GitHub Issues](https://github.com/wj2929/md-viewer/issues) 提交反馈。*
