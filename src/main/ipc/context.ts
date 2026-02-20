import Store from 'electron-store'
import { windowManager } from '../windowManager'
import { folderHistoryManager } from '../folderHistoryManager'
import { appDataManager } from '../appDataManager'

// 定义存储的数据结构
export interface AppState {
  lastOpenedFolder: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
  alwaysOnTop: boolean
}

/**
 * IPC handlers 共享的上下文
 * 通过依赖注入避免模块间的循环引用和全局变量
 */
export interface IPCContext {
  store: Store<AppState>
  windowManager: typeof windowManager
  folderHistoryManager: typeof folderHistoryManager
  appDataManager: typeof appDataManager
  openPathInWindow: (targetPath: string, type: 'md-file' | 'directory', targetWindow?: Electron.BrowserWindow) => void
}
