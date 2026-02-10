import { BrowserWindow, globalShortcut, app } from 'electron'

/**
 * 全局快捷键模块 (v1.2.1)
 * 注册和管理应用的键盘快捷键
 */

// 快捷键配置
export interface ShortcutConfig {
  accelerator: string
  action: string
  description: string
}

// 默认快捷键映射
export const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  { accelerator: 'CommandOrControl+O', action: 'open-folder', description: '打开文件夹' },
  { accelerator: 'CommandOrControl+R', action: 'refresh', description: '刷新文件树' },
  { accelerator: 'CommandOrControl+W', action: 'close-tab', description: '关闭当前标签' },
  { accelerator: 'CommandOrControl+E', action: 'export-html', description: '导出 HTML' },
  { accelerator: 'CommandOrControl+Shift+E', action: 'export-pdf', description: '导出 PDF' },
  { accelerator: 'CommandOrControl+F', action: 'focus-search', description: '聚焦搜索栏' },
  { accelerator: 'CommandOrControl+Tab', action: 'next-tab', description: '下一个标签' },
  { accelerator: 'CommandOrControl+Shift+Tab', action: 'prev-tab', description: '上一个标签' },
  { accelerator: 'CommandOrControl+1', action: 'tab-1', description: '切换到第1个标签' },
  { accelerator: 'CommandOrControl+2', action: 'tab-2', description: '切换到第2个标签' },
  { accelerator: 'CommandOrControl+3', action: 'tab-3', description: '切换到第3个标签' },
  { accelerator: 'CommandOrControl+4', action: 'tab-4', description: '切换到第4个标签' },
  { accelerator: 'CommandOrControl+5', action: 'tab-5', description: '切换到第5个标签' },
  { accelerator: 'CommandOrControl+,', action: 'settings', description: '打开设置' },
  { accelerator: 'CommandOrControl+N', action: 'new-window', description: '新建窗口' },
  { accelerator: 'CommandOrControl+Shift+O', action: 'new-window-folder', description: '新窗口打开文件夹' },
  { accelerator: 'CommandOrControl+Shift+W', action: 'close-window', description: '关闭窗口' }
]

/**
 * 注册窗口快捷键
 * 使用 webContents 的 before-input-event 来处理快捷键
 * 这样可以避免与系统快捷键冲突
 */
export function registerWindowShortcuts(window: BrowserWindow): void {
  const webContents = window.webContents

  webContents.on('before-input-event', (event, input) => {
    // 只处理按键按下事件
    if (input.type !== 'keyDown') return

    const isMac = process.platform === 'darwin'
    const cmdOrCtrl = isMac ? input.meta : input.control

    // Cmd/Ctrl + O: 打开文件夹
    if (cmdOrCtrl && input.key.toLowerCase() === 'o' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:open-folder')
      return
    }

    // v1.6.0: Cmd/Ctrl + Shift + O: 新窗口打开文件夹
    if (cmdOrCtrl && input.key.toLowerCase() === 'o' && input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:new-window-folder')
      return
    }

    // v1.6.0: Cmd/Ctrl + N: 新建窗口
    if (cmdOrCtrl && input.key.toLowerCase() === 'n' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:new-window')
      return
    }

    // v1.6.0: Cmd/Ctrl + Shift + W: 关闭窗口
    if (cmdOrCtrl && input.key.toLowerCase() === 'w' && input.shift && !input.alt) {
      event.preventDefault()
      window.close()
      return
    }

    // Cmd/Ctrl + R: 刷新文件树
    if (cmdOrCtrl && input.key.toLowerCase() === 'r' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:refresh')
      return
    }

    // Cmd/Ctrl + W: 关闭当前标签
    if (cmdOrCtrl && input.key.toLowerCase() === 'w' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:close-tab')
      return
    }

    // Cmd/Ctrl + E: 导出 HTML
    if (cmdOrCtrl && input.key.toLowerCase() === 'e' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:export-html')
      return
    }

    // Cmd/Ctrl + Shift + E: 导出 PDF
    if (cmdOrCtrl && input.key.toLowerCase() === 'e' && input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:export-pdf')
      return
    }

    // Cmd/Ctrl + F: 聚焦搜索栏
    if (cmdOrCtrl && input.key.toLowerCase() === 'f' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:focus-search')
      return
    }

    // Cmd/Ctrl + Tab: 下一个标签
    if (cmdOrCtrl && input.key === 'Tab' && !input.shift) {
      event.preventDefault()
      webContents.send('shortcut:next-tab')
      return
    }

    // Cmd/Ctrl + Shift + Tab: 上一个标签
    if (cmdOrCtrl && input.key === 'Tab' && input.shift) {
      event.preventDefault()
      webContents.send('shortcut:prev-tab')
      return
    }

    // Cmd/Ctrl + 1-5: 切换到指定标签
    if (cmdOrCtrl && !input.shift && !input.alt) {
      const tabNum = parseInt(input.key)
      if (tabNum >= 1 && tabNum <= 5) {
        event.preventDefault()
        webContents.send('shortcut:switch-tab', tabNum - 1) // 0-indexed
        return
      }
    }

    // v1.3.6: Cmd/Ctrl + D: 添加书签
    if (cmdOrCtrl && input.key.toLowerCase() === 'd' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:add-bookmark')
      return
    }

    // v1.4.2: Cmd+Option+T / Ctrl+Alt+T: 切换窗口置顶
    if (cmdOrCtrl && input.alt && input.key.toLowerCase() === 't' && !input.shift) {
      event.preventDefault()
      webContents.send('shortcut:toggle-always-on-top')
      return
    }

    // v1.4.2: Cmd/Ctrl + P: 打印
    if (cmdOrCtrl && input.key.toLowerCase() === 'p' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:print')
      return
    }

    // v1.4.2: Cmd/Ctrl + =: 放大字体
    if (cmdOrCtrl && (input.key === '=' || input.key === '+') && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:font-increase')
      return
    }

    // v1.4.2: Cmd/Ctrl + -: 缩小字体
    if (cmdOrCtrl && input.key === '-' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:font-decrease')
      return
    }

    // v1.4.2: Cmd/Ctrl + 0: 重置字体大小
    if (cmdOrCtrl && input.key === '0' && !input.shift && !input.alt) {
      event.preventDefault()
      webContents.send('shortcut:font-reset')
      return
    }
  })

  console.log('[SHORTCUTS] Window shortcuts registered')
}

/**
 * 注册全局快捷键（可选，用于全局操作）
 * 注意：全局快捷键在应用失去焦点时也会触发
 */
export function registerGlobalShortcuts(): void {
  // 暂时不注册全局快捷键，使用窗口级别的快捷键
  // 如果需要，可以在这里添加
}

/**
 * 注销所有全局快捷键
 */
export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll()
  console.log('[SHORTCUTS] All global shortcuts unregistered')
}

// 应用退出时清理
app.on('will-quit', () => {
  unregisterAllShortcuts()
})
