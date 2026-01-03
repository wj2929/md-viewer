// 简单的文件日志工具
const LOG_FILE = '/tmp/md-viewer-debug.log'

export function logToFile(message: string): void {
  const timestamp = new Date().toISOString()
  const logLine = `[${timestamp}] ${message}\n`
  
  // 使用 navigator.sendBeacon 或 console.log 作为后备
  console.log(logLine.trim())
  
  // 通过 IPC 发送到主进程写入文件
  if (window.api?.logToFile) {
    window.api.logToFile(logLine)
  }
}

export function clearLog(): void {
  if (window.api?.clearLog) {
    window.api.clearLog()
  }
}
