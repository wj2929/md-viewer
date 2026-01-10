/**
 * 预览区右键菜单配置
 * @module previewContextMenu
 * @description v1.4.2 新增 - 右键菜单配置化（渲染进程定义）
 *
 * 这个文件定义预览区右键菜单的结构，
 * 主进程只负责渲染菜单，不再硬编码菜单项。
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 菜单项类型 */
export type MenuItemType = 'normal' | 'separator' | 'submenu'

/** 菜单项配置 */
export interface MenuItemConfig {
  id: string
  type: MenuItemType
  label?: string
  accelerator?: string
  enabled?: boolean
  visible?: boolean
  /** IPC 事件名称（点击时发送） */
  ipcEvent?: string
  /** 子菜单 */
  submenu?: MenuItemConfig[]
}

/** 预览区右键菜单上下文 */
export interface PreviewContextMenuContext {
  filePath: string
  headingId: string | null
  headingText: string | null
  headingLevel: string | null
  hasSelection: boolean
}

// ============================================================================
// 菜单配置生成器
// ============================================================================

/**
 * 生成预览区右键菜单配置
 * @param ctx 上下文信息
 * @returns 菜单项配置数组
 */
export function buildPreviewContextMenu(ctx: PreviewContextMenuContext): MenuItemConfig[] {
  const menu: MenuItemConfig[] = []

  // =========================================================================
  // 书签功能
  // =========================================================================

  // 如果右键点击的是标题，添加"添加标题书签"
  if (ctx.headingId && ctx.headingText) {
    menu.push({
      id: 'add-heading-bookmark',
      type: 'normal',
      label: '🔖 添加标题书签',
      ipcEvent: 'add-bookmark-from-preview'
    })
  }

  // 添加"添加文件书签"
  menu.push({
    id: 'add-file-bookmark',
    type: 'normal',
    label: '📄 添加文件书签',
    ipcEvent: 'add-bookmark-from-preview'
  })

  menu.push({ id: 'sep-1', type: 'separator' })

  // =========================================================================
  // 页面内搜索
  // =========================================================================

  menu.push({
    id: 'in-page-search',
    type: 'normal',
    label: '🔍 页面内搜索',
    accelerator: 'CmdOrCtrl+Shift+F',
    ipcEvent: 'shortcut:open-in-page-search'
  })

  menu.push({ id: 'sep-2', type: 'separator' })

  // =========================================================================
  // 导出功能
  // =========================================================================

  menu.push({
    id: 'export-html',
    type: 'normal',
    label: '导出 HTML',
    accelerator: 'CmdOrCtrl+E',
    ipcEvent: 'markdown:export-html'
  })

  menu.push({
    id: 'export-pdf',
    type: 'normal',
    label: '导出 PDF',
    accelerator: 'CmdOrCtrl+Shift+E',
    ipcEvent: 'markdown:export-pdf'
  })

  // =========================================================================
  // v1.4.2：打印功能
  // =========================================================================

  menu.push({
    id: 'print',
    type: 'normal',
    label: '🖨️ 打印',
    accelerator: 'CmdOrCtrl+P',
    ipcEvent: 'shortcut:print'
  })

  menu.push({ id: 'sep-3', type: 'separator' })

  // =========================================================================
  // v1.4.2：字体大小调节（子菜单）
  // =========================================================================

  menu.push({
    id: 'font-size',
    type: 'submenu',
    label: '🔤 字体大小',
    submenu: [
      {
        id: 'font-increase',
        type: 'normal',
        label: '放大',
        accelerator: 'CmdOrCtrl+Plus',
        ipcEvent: 'shortcut:font-increase'
      },
      {
        id: 'font-decrease',
        type: 'normal',
        label: '缩小',
        accelerator: 'CmdOrCtrl+-',
        ipcEvent: 'shortcut:font-decrease'
      },
      {
        id: 'font-reset',
        type: 'normal',
        label: '重置',
        accelerator: 'CmdOrCtrl+0',
        ipcEvent: 'shortcut:font-reset'
      }
    ]
  })

  menu.push({ id: 'sep-4', type: 'separator' })

  // =========================================================================
  // 复制功能
  // =========================================================================

  menu.push({
    id: 'copy-markdown',
    type: 'normal',
    label: '复制为 Markdown',
    ipcEvent: 'markdown:copy-source'
  })

  menu.push({
    id: 'copy-plain-text',
    type: 'normal',
    label: '复制为纯文本',
    ipcEvent: 'markdown:copy-plain-text'
  })

  menu.push({
    id: 'copy-html',
    type: 'normal',
    label: '复制为 HTML',
    ipcEvent: 'markdown:copy-html'
  })

  // 如果有选中内容，添加复制选中内容选项
  if (ctx.hasSelection) {
    menu.push({ id: 'sep-5', type: 'separator' })
    menu.push({
      id: 'copy-selection',
      type: 'normal',
      label: '复制选中内容',
      accelerator: 'CmdOrCtrl+C',
      ipcEvent: 'copy-selection'
    })
  }

  // 如果有标题，添加"复制链接"
  if (ctx.headingId) {
    menu.push({ id: 'sep-6', type: 'separator' })
    menu.push({
      id: 'copy-link',
      type: 'normal',
      label: '🔗 复制链接',
      ipcEvent: 'copy-heading-link'
    })
  }

  // =========================================================================
  // 快捷键帮助
  // =========================================================================

  menu.push({ id: 'sep-7', type: 'separator' })
  menu.push({
    id: 'shortcuts-help',
    type: 'normal',
    label: '⌨️ 查看所有快捷键',
    ipcEvent: 'open-shortcuts-help'
  })

  return menu
}

export default buildPreviewContextMenu
