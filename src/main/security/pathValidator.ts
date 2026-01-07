/**
 * 路径验证器 - 安全验证启动参数和文件路径
 */

import * as path from 'path'
import * as fs from 'fs/promises'

const ALLOWED_MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn']
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export interface PathValidationResult {
  valid: boolean
  type: 'md-file' | 'directory' | 'invalid'
  normalizedPath: string
  error?: string
}

/**
 * 验证路径安全性
 */
export async function validateSecurePath(inputPath: string): Promise<PathValidationResult> {
  // 1. 基础验证
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, type: 'invalid', normalizedPath: '', error: '路径不能为空' }
  }

  // 2. 长度限制
  if (inputPath.length > 4096) {
    return { valid: false, type: 'invalid', normalizedPath: '', error: '路径过长' }
  }

  // 3. 空字节检测
  if (inputPath.includes('\x00') || inputPath.includes('\0')) {
    return { valid: false, type: 'invalid', normalizedPath: '', error: '检测到空字节' }
  }

  // 4. 路径遍历检测
  if (/\.\.[\\/]/.test(inputPath) || inputPath.endsWith('..')) {
    return { valid: false, type: 'invalid', normalizedPath: '', error: '不允许路径遍历' }
  }

  // 5. 标准化路径
  const normalizedPath = path.resolve(inputPath)

  try {
    // 6. 检查路径是否存在
    const stats = await fs.stat(normalizedPath)

    // 7. 如果是文件
    if (stats.isFile()) {
      const ext = path.extname(normalizedPath).toLowerCase()

      if (!ALLOWED_MD_EXTENSIONS.includes(ext)) {
        return {
          valid: false,
          type: 'invalid',
          normalizedPath: '',
          error: `只支持 Markdown 文件，当前: ${ext}`
        }
      }

      if (stats.size > MAX_FILE_SIZE) {
        return {
          valid: false,
          type: 'invalid',
          normalizedPath: '',
          error: `文件过大 (${Math.round(stats.size / 1024 / 1024)}MB, 最大 50MB)`
        }
      }

      // 符号链接检测
      const realPath = await fs.realpath(normalizedPath)
      const realExt = path.extname(realPath).toLowerCase()

      if (!ALLOWED_MD_EXTENSIONS.includes(realExt)) {
        return {
          valid: false,
          type: 'invalid',
          normalizedPath: '',
          error: '符号链接目标不是 Markdown 文件'
        }
      }

      return { valid: true, type: 'md-file', normalizedPath: realPath }
    }

    // 8. 如果是文件夹
    if (stats.isDirectory()) {
      return { valid: true, type: 'directory', normalizedPath }
    }

    // 9. 其他类型
    return {
      valid: false,
      type: 'invalid',
      normalizedPath: '',
      error: '路径不是文件或目录'
    }

  } catch (error) {
    const err = error as NodeJS.ErrnoException

    if (err.code === 'ENOENT') {
      return { valid: false, type: 'invalid', normalizedPath: '', error: '路径不存在' }
    }

    if (err.code === 'EACCES') {
      return { valid: false, type: 'invalid', normalizedPath: '', error: '权限不足' }
    }

    return {
      valid: false,
      type: 'invalid',
      normalizedPath: '',
      error: `验证错误: ${err.message}`
    }
  }
}
