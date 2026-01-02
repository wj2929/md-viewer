import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder: () => Promise<string | null>
      readDir: (path: string) => Promise<FileInfo[]>
      readFile: (path: string) => Promise<string>
      watchFolder: (path: string) => void
      exportHTML: (htmlContent: string, fileName: string) => Promise<string | null>
      exportPDF: (htmlContent: string, fileName: string) => Promise<string | null>
      minimize: () => void
      maximize: () => void
      close: () => void
      onFileChange: (callback: (event: unknown, data: unknown) => void) => () => void
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
