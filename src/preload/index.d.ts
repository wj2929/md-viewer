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

      // 其他事件
      onRestoreFolder: (callback: (folderPath: string) => void) => () => void
    }
  }

  interface FileInfo {
    name: string
    path: string
    isDirectory: boolean
    children?: FileInfo[]
  }
}
