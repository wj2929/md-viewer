/**
 * 快捷键帮助弹窗组件
 * v1.4.0：展示所有快捷键，按任务分组
 */

import { useEffect, useCallback } from 'react'
import './ShortcutsHelpDialog.css'

interface ShortcutsHelpDialogProps {
  isOpen: boolean
  onClose: () => void
}

// 快捷键数据（按任务分组）
const SHORTCUTS_DATA = [
  {
    group: '搜索',
    items: [
      { label: '全局搜索（文件名）', accelerator: 'CmdOrCtrl+F' },
      { label: '页面内搜索（当前文档）', accelerator: 'CmdOrCtrl+Shift+F' },
      { label: '下一个匹配', accelerator: 'CmdOrCtrl+G' },
      { label: '上一个匹配', accelerator: 'CmdOrCtrl+Shift+G' }
    ]
  },
  {
    group: '标签与文件',
    items: [
      { label: '打开文件夹', accelerator: 'CmdOrCtrl+O' },
      { label: '刷新文件树', accelerator: 'CmdOrCtrl+R' },
      { label: '关闭当前标签', accelerator: 'CmdOrCtrl+W' },
      { label: '下一个标签', accelerator: 'CmdOrCtrl+Tab' },
      { label: '上一个标签', accelerator: 'CmdOrCtrl+Shift+Tab' },
      { label: '切换到标签 1-5', accelerator: 'CmdOrCtrl+1~5' },
      { label: '添加书签', accelerator: 'CmdOrCtrl+D' }
    ]
  },
  {
    group: '导出',
    items: [
      { label: '导出 HTML', accelerator: 'CmdOrCtrl+E' },
      { label: '导出 PDF', accelerator: 'CmdOrCtrl+Shift+E' }
    ]
  }
]

/**
 * 格式化快捷键显示（根据平台）
 */
function formatAccelerator(accelerator: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  if (isMac) {
    return accelerator
      .replace(/CmdOrCtrl/g, '⌘')
      .replace(/Cmd/g, '⌘')
      .replace(/Ctrl/g, '⌃')
      .replace(/Shift/g, '⇧')
      .replace(/Alt/g, '⌥')
      .replace(/Tab/g, '⇥')
      .replace(/\+/g, '')
  } else {
    return accelerator
      .replace(/CmdOrCtrl/g, 'Ctrl')
      .replace(/Cmd/g, 'Ctrl')
  }
}

export const ShortcutsHelpDialog: React.FC<ShortcutsHelpDialogProps> = ({
  isOpen,
  onClose
}) => {
  // 按 Esc 关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div className="shortcuts-help-overlay" onClick={onClose}>
      <div className="shortcuts-help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-help-header">
          <h2>⌨️ 快捷键参考</h2>
          <button className="shortcuts-help-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="shortcuts-help-content">
          {SHORTCUTS_DATA.map((group) => (
            <div key={group.group} className="shortcuts-group">
              <h3 className="shortcuts-group-title">{group.group}</h3>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.label} className="shortcut-item">
                    <span className="shortcut-label">{item.label}</span>
                    <span className="shortcut-key">
                      {formatAccelerator(item.accelerator)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="shortcuts-help-footer">
          <span className="shortcuts-tip">
            💡 提示：按 Esc 关闭此弹窗
          </span>
        </div>
      </div>
    </div>
  )
}
