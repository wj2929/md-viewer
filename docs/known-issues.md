# MD Viewer 跨平台已知问题

> 最后更新：2026-02-07

---

## Linux 平台

### 1. Wayland 拖拽限制

**现象**：在 Wayland 会话下，文件从外部拖入应用窗口可能无响应。

**原因**：Electron 的 `startDrag` API 依赖 X11 协议，Wayland 原生拖拽协议（`wl_data_device`）尚未完全支持。

**影响范围**：GNOME 45+（默认 Wayland）、KDE Plasma 6+

**临时方案**：
- 启动时添加 `--ozone-platform=x11` 强制使用 XWayland
- 或在登录界面选择 "GNOME on Xorg" 会话

**跟踪**：[Electron #38612](https://github.com/electron/electron/issues/38612)

---

### 2. inotify 监听数量限制

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

### 3. 回收站依赖 gvfs

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

### 4. CF_HDROP 剪贴板格式限制

**现象**：从资源管理器复制文件后粘贴到应用内，部分场景下文件路径无法正确读取。

**原因**：Electron 的 `clipboard.readBuffer('FileNameW')` 只能读取单个文件路径。Windows 原生的 `CF_HDROP` 格式支持多文件，但需要通过 native module 解析 `DROPFILES` 结构体。

**当前状态**：单文件复制粘贴正常工作，多文件场景降级为逐个操作。

**未来计划**：评估引入 `node-ffi-napi` 或自定义 native addon 解析 `CF_HDROP`。

---

## macOS 平台

### 5. hardened runtime 与公证

**现象**：首次打开应用时 macOS 弹出 "无法验证开发者" 警告。

**原因**：应用未经 Apple 公证（notarization），Gatekeeper 会阻止运行。

**解决方案**：
```bash
# 方法 1：系统设置
# 系统设置 → 隐私与安全性 → 安全性 → 仍然允许

# 方法 2：命令行移除隔离属性
xattr -cr /Applications/MD\ Viewer.app

# 方法 3：Apple Silicon 用户额外步骤
sudo xattr -rd com.apple.quarantine /Applications/MD\ Viewer.app
```

**未来计划**：申请 Apple Developer 证书，配置自动公证流程。

---

## 跨平台通用

### 6. ARM64 架构支持评估

**当前状态**：
| 平台 | 架构 | 状态 |
|------|------|------|
| macOS | Apple Silicon (arm64) | ✅ 原生支持（Universal Binary） |
| macOS | Intel (x64) | ✅ 支持 |
| Windows | x64 | ✅ 支持 |
| Windows | ARM64 | ⚠️ 通过 x64 模拟运行，未提供原生 ARM64 包 |
| Linux | x64 | ✅ 支持（AppImage） |
| Linux | ARM64 | ⚠️ 未提供预编译包，需从源码构建 |

**结论**：Windows ARM64 和 Linux ARM64 用户量极少，暂不提供原生包。Windows ARM64 可通过 x64 模拟层运行，性能损失约 10-15%。Linux ARM64 用户可从源码 `npm run build` 自行构建。

---

### 7. 大文件性能

**现象**：超过 10000 行的 Markdown 文件渲染时可能出现卡顿。

**当前保护**：已实现 10000 行截断，超出部分显示提示信息。

---

*如遇到未列出的问题，请在 [GitHub Issues](https://github.com/wj2929/md-viewer/issues) 提交反馈。*
