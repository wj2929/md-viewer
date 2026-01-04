import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // 文件系统操作
      openFolder: () => Promise<string | null>
      readDir: (path: string) => Promise<FileInfo[]>
      readFile: (path: string) => Promise<string>

      // 文件监听 (v1.1) - 只监听已打开的文件
      watchFolder: (path: string) => Promise<{ success: boolean }>
      watchFile: (path: string) => Promise<{ success: boolean }>
      unwatchFolder: () => Promise<{ success: boolean }>

      // 导出功能
      exportHTML: (htmlContent: string, fileName: string) => Promise<string | null>
      exportPDF: (htmlContent: string, fileName: string) => Promise<string | null>

      // 右键菜单 (v1.2 阶段 1)
      showContextMenu: (
        file: { name: string; path: string; isDirectory: boolean },
        basePath: string
      ) => Promise<{ success: boolean }>
      renameFile: (oldPath: string, newName: string) => Promise<string>

      // 文件操作 (v1.2 阶段 2)
      copyFile: (srcPath: string, destPath: string) => Promise<string>
      copyDir: (srcPath: string, destPath: string) => Promise<string>
      moveFile: (srcPath: string, destPath: string) => Promise<string>
      fileExists: (filePath: string) => Promise<boolean>
      isDirectory: (filePath: string) => Promise<boolean>

      // 窗口操作
      minimize: () => void
      maximize: () => void
      close: () => void

      // 事件监听
      onFileChange: (callback: (event: unknown, data: unknown) => void) => () => void

      // 文件监听事件 (v1.1)
      onFileChanged: (callback: (filePath: string) => void) => () => void
      onFileAdded: (callback: (filePath: string) => void) => () => void
      onFileRemoved: (callback: (filePath: string) => void) => () => void

      // v1.3 新增文件监听事件
      onFolderAdded: (callback: (dirPath: string) => void) => () => void
      onFolderRemoved: (callback: (dirPath: string) => void) => () => void
      onFileRenamed: (callback: (data: { oldPath: string; newPath: string }) => void) => () => void

      // 右键菜单事件 (v1.2 阶段 1)
      onFileDeleted: (callback: (filePath: string) => void) => () => void
      onFileStartRename: (callback: (filePath: string) => void) => () => void
      onFileExportRequest: (
        callback: (data: { path: string; type: 'html' | 'pdf' }) => void
      ) => () => void
      onError: (callback: (error: { message: string }) => void) => () => void

      // 剪贴板事件 (v1.2 阶段 2)
      onClipboardCopy: (callback: (paths: string[]) => void) => () => void
      onClipboardCut: (callback: (paths: string[]) => void) => () => void
      onClipboardPaste: (callback: (targetDir: string) => void) => () => void

      // 其他事件
      onRestoreFolder: (callback: (folderPath: string) => void) => () => void

      // 快捷键事件 (v1.2.1)
      onShortcutOpenFolder: (callback: () => void) => () => void
      onShortcutRefresh: (callback: () => void) => () => void
      onShortcutCloseTab: (callback: () => void) => () => void
      onShortcutExportHTML: (callback: () => void) => () => void
      onShortcutExportPDF: (callback: () => void) => () => void
      onShortcutFocusSearch: (callback: () => void) => () => void
      onShortcutNextTab: (callback: () => void) => () => void
      onShortcutPrevTab: (callback: () => void) => () => void
      onShortcutSwitchTab: (callback: (tabIndex: number) => void) => () => void
    }
  }

  interface FileInfo {
    name: string
    path: string
    isDirectory: boolean
    children?: FileInfo[]
  }
}
