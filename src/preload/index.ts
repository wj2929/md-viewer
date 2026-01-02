import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义 API 暴露给渲染进程
const api = {
  // 文件系统操作 (v1.0 核心功能)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),

  // 文件监听 (v1.1 新增)
  watchFolder: (path: string) => ipcRenderer.invoke('fs:watchFolder', path),
  unwatchFolder: () => ipcRenderer.invoke('fs:unwatchFolder'),

  // 导出功能
  exportHTML: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:html', htmlContent, fileName),
  exportPDF: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:pdf', htmlContent, fileName),

  // 窗口操作
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // 事件监听
  onFileChange: (callback: (event: unknown, data: unknown) => void) => {
    ipcRenderer.on('fs:fileChanged', callback)
    return () => ipcRenderer.removeListener('fs:fileChanged', callback)
  },

  // 文件监听事件 (v1.1 新增)
  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:changed', handler)
    return () => ipcRenderer.removeListener('file:changed', handler)
  },

  onFileAdded: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:added', handler)
    return () => ipcRenderer.removeListener('file:added', handler)
  },

  onFileRemoved: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:removed', handler)
    return () => ipcRenderer.removeListener('file:removed', handler)
  },

  // 监听恢复文件夹事件
  onRestoreFolder: (callback: (folderPath: string) => void) => {
    const handler = (_event: unknown, folderPath: string) => callback(folderPath)
    ipcRenderer.on('restore-folder', handler)
    return () => ipcRenderer.removeListener('restore-folder', handler)
  }
}

// 仅在 contextIsolation 启用时暴露 API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (for legacy support)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
