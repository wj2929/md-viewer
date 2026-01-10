/**
 * 安全的日志工具
 *
 * 解决 Electron 开发模式下 console.log 可能触发 EPIPE 错误的问题
 * 当 stdout 管道断开时（终端连接不稳定），普通的 console.log 会抛出异常
 *
 * 这个工具包装了 console 方法，静默处理 EPIPE 错误
 */

type LogLevel = 'log' | 'info' | 'warn' | 'error'

/**
 * 安全地写入日志，忽略 EPIPE 错误
 */
function safeWrite(level: LogLevel, ...args: unknown[]): void {
  try {
    console[level](...args)
  } catch (error: unknown) {
    // 静默处理 EPIPE 错误（管道断开）
    if (error instanceof Error && error.message.includes('EPIPE')) {
      return
    }
    // 其他错误仍然抛出
    throw error
  }
}

/**
 * 安全的日志方法
 */
export const safeLog = {
  log: (...args: unknown[]): void => safeWrite('log', ...args),
  info: (...args: unknown[]): void => safeWrite('info', ...args),
  warn: (...args: unknown[]): void => safeWrite('warn', ...args),
  error: (...args: unknown[]): void => safeWrite('error', ...args)
}

/**
 * 安装全局错误处理器，防止 EPIPE 错误导致应用崩溃
 * 应在应用启动时调用
 */
export function installEpipeHandler(): void {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      // 静默处理 - stdout 管道断开是正常的（比如终端关闭）
      return
    }
  })

  process.stderr.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      return
    }
  })

  // 捕获未处理的 EPIPE 异常
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) {
      // 静默处理
      return
    }
    // 其他未捕获异常正常抛出
    console.error('Uncaught Exception:', err)
    throw err
  })
}

export default safeLog
