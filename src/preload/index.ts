import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义 API 暴露给渲染进程
const api = {
  // 文件系统操作 (v1.0 核心功能)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),

  // 文件监听 (v1.1 新增) - 只监听已打开的文件
  watchFolder: (path: string) => ipcRenderer.invoke('fs:watchFolder', path),
  watchFile: (path: string) => ipcRenderer.invoke('fs:watchFile', path),
  unwatchFolder: () => ipcRenderer.invoke('fs:unwatchFolder'),

  // 导出功能
  exportHTML: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:html', htmlContent, fileName),
  exportPDF: (htmlContent: string, fileName: string) => ipcRenderer.invoke('export:pdf', htmlContent, fileName),

  // 右键菜单 (v1.2 阶段 1 新增)
  showContextMenu: (file: { name: string; path: string; isDirectory: boolean }, basePath: string) =>
    ipcRenderer.invoke('context-menu:show', file, basePath),
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('fs:rename', oldPath, newName),

  // 文件操作 (v1.2 阶段 2 新增)
  copyFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:copyFile', srcPath, destPath),
  copyDir: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:copyDir', srcPath, destPath),
  moveFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('fs:moveFile', srcPath, destPath),
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  isDirectory: (filePath: string) => ipcRenderer.invoke('fs:isDirectory', filePath),

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
  },

  // 右键菜单事件 (v1.2 阶段 1 新增)
  onFileDeleted: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:deleted', handler)
    return () => ipcRenderer.removeListener('file:deleted', handler)
  },

  onFileStartRename: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string) => callback(filePath)
    ipcRenderer.on('file:start-rename', handler)
    return () => ipcRenderer.removeListener('file:start-rename', handler)
  },

  onFileExportRequest: (callback: (data: { path: string; type: 'html' | 'pdf' }) => void) => {
    const handler = (_event: unknown, data: { path: string; type: 'html' | 'pdf' }) => callback(data)
    ipcRenderer.on('file:export-request', handler)
    return () => ipcRenderer.removeListener('file:export-request', handler)
  },

  onError: (callback: (error: { message: string }) => void) => {
    const handler = (_event: unknown, error: { message: string }) => callback(error)
    ipcRenderer.on('error:show', handler)
    return () => ipcRenderer.removeListener('error:show', handler)
  },

  // 剪贴板事件 (v1.2 阶段 2 新增)
  onClipboardCopy: (callback: (paths: string[]) => void) => {
    const handler = (_event: unknown, paths: string[]) => callback(paths)
    ipcRenderer.on('clipboard:copy', handler)
    return () => ipcRenderer.removeListener('clipboard:copy', handler)
  },

  onClipboardCut: (callback: (paths: string[]) => void) => {
    const handler = (_event: unknown, paths: string[]) => callback(paths)
    ipcRenderer.on('clipboard:cut', handler)
    return () => ipcRenderer.removeListener('clipboard:cut', handler)
  },

  onClipboardPaste: (callback: (targetDir: string) => void) => {
    const handler = (_event: unknown, targetDir: string) => callback(targetDir)
    ipcRenderer.on('clipboard:paste', handler)
    return () => ipcRenderer.removeListener('clipboard:paste', handler)
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
