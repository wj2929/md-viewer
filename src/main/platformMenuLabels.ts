export interface FileManagerLabels {
  showInFolder: string
  fileManagerName: string
}

export function getFileManagerLabels(platform: NodeJS.Platform = process.platform): FileManagerLabels {
  if (platform === 'darwin') {
    return { showInFolder: '在 Finder 中显示', fileManagerName: 'Finder' }
  }
  if (platform === 'win32') {
    return { showInFolder: '在文件资源管理器中显示', fileManagerName: '文件资源管理器' }
  }
  return { showInFolder: '在文件管理器中显示', fileManagerName: '文件管理器' }
}
