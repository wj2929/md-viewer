/**
 * 右键菜单管理器 - 状态管理和统一接口
 */

import { app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import Store from 'electron-store'
import {
  installMacOSContextMenu,
  uninstallMacOSContextMenu,
  installWindowsContextMenu,
  uninstallWindowsContextMenu,
  installLinuxContextMenu,
  uninstallLinuxContextMenu,
  InstallResult
} from './contextMenuInstaller'

interface ContextMenuStore {
  installed: boolean
  installedAt?: number
  platform?: string
  userConfirmedEnabled?: boolean
}

const store = new Store<ContextMenuStore>({
  name: 'context-menu-status',
  defaults: { installed: false }
})

export interface ContextMenuStatus {
  installed: boolean
  platform: string
  installedAt?: number
  userConfirmedEnabled?: boolean
}

/**
 * 检查安装状态
 */
export async function checkStatus(): Promise<ContextMenuStatus> {
  let actualInstalled = false

  if (process.platform === 'darwin') {
    const workflowPath = path.join(
      app.getPath('home'),
      'Library/Services/用 MD Viewer 打开.workflow'
    )
    actualInstalled = await fs.access(workflowPath).then(() => true, () => false)
  } else if (process.platform === 'linux') {
    const desktopFile = path.join(
      app.getPath('home'),
      '.local/share/applications/md-viewer.desktop'
    )
    actualInstalled = await fs.access(desktopFile).then(() => true, () => false)
  } else if (process.platform === 'win32') {
    // Windows 检查注册表比较复杂，使用存储状态
    actualInstalled = store.get('installed', false)
  }

  store.set('installed', actualInstalled)

  return {
    installed: actualInstalled,
    platform: process.platform,
    installedAt: actualInstalled ? store.get('installedAt') : undefined,
    userConfirmedEnabled: actualInstalled ? store.get('userConfirmedEnabled', false) : undefined
  }
}

/**
 * 安装右键菜单
 */
export async function install(): Promise<InstallResult> {
  let result: InstallResult

  if (process.platform === 'darwin') {
    result = await installMacOSContextMenu()
  } else if (process.platform === 'win32') {
    result = await installWindowsContextMenu()
  } else if (process.platform === 'linux') {
    result = await installLinuxContextMenu()
  } else {
    return { success: false, error: '不支持的平台' }
  }

  if (result.success) {
    store.set('installed', true)
    store.set('installedAt', Date.now())
    store.set('platform', process.platform)
  }

  return result
}

/**
 * 卸载右键菜单
 */
export async function uninstall(): Promise<InstallResult> {
  let result: InstallResult

  if (process.platform === 'darwin') {
    result = await uninstallMacOSContextMenu()
  } else if (process.platform === 'win32') {
    result = await uninstallWindowsContextMenu()
  } else if (process.platform === 'linux') {
    result = await uninstallLinuxContextMenu()
  } else {
    return { success: false, error: '不支持的平台' }
  }

  if (result.success) {
    store.set('installed', false)
    store.delete('installedAt')
    store.delete('userConfirmedEnabled')
  }

  return result
}

/**
 * 用户确认右键菜单已启用
 */
export async function confirmEnabled(): Promise<{ success: boolean }> {
  try {
    store.set('userConfirmedEnabled', true)
    return { success: true }
  } catch (error) {
    console.error('[ContextMenu] Failed to confirm enabled:', error)
    return { success: false }
  }
}
