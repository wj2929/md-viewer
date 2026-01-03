/**
 * 安全模块 - 路径校验和沙箱安全
 * @module security
 * @description 提供路径白名单校验和受保护路径检测功能
 */

import * as path from 'path'

/**
 * 当前允许访问的基础路径
 * 用户通过"打开文件夹"操作设置
 */
let allowedBasePath: string | null = null

/**
 * 设置允许访问的基础路径
 * @param basePath - 用户打开的文件夹路径
 */
export function setAllowedBasePath(basePath: string): void {
  allowedBasePath = path.resolve(basePath)
  console.log(`[SECURITY] Allowed base path set to: ${allowedBasePath}`)
}

/**
 * 获取当前允许的基础路径
 * @returns 当前允许的基础路径，如果未设置则返回 null
 */
export function getAllowedBasePath(): string | null {
  return allowedBasePath
}

/**
 * 检查路径是否在允许的基础路径内
 * @param targetPath - 要检查的目标路径
 * @returns 如果路径被允许则返回 true
 */
export function isPathAllowed(targetPath: string): boolean {
  if (!allowedBasePath) {
    console.warn('[SECURITY] No allowed base path set')
    return false
  }

  const normalized = path.resolve(targetPath)
  const isAllowed =
    normalized.startsWith(allowedBasePath + path.sep) ||
    normalized === allowedBasePath

  if (!isAllowed) {
    console.warn(`[SECURITY] Path not allowed: ${targetPath}`)
    console.warn(`[SECURITY] Allowed base: ${allowedBasePath}`)
  }

  return isAllowed
}

/**
 * 验证路径是否在允许范围内，不通过则抛出错误
 * @param targetPath - 要验证的目标路径
 * @throws {Error} 如果路径不在允许范围内
 */
export function validatePath(targetPath: string): void {
  if (!isPathAllowed(targetPath)) {
    throw new Error(
      `安全错误：路径 "${targetPath}" 不在允许范围内。` +
      `当前允许的基础路径为：${allowedBasePath || '未设置'}`
    )
  }
}

/**
 * 受保护的系统路径模式
 * 这些路径即使在允许的基础路径内也不允许操作
 */
const PROTECTED_PATTERNS = [
  // Unix/Linux/macOS 系统目录
  /^\/etc\//,
  /^\/usr\//,
  /^\/System\//,
  /^\/Library\//,
  /^\/bin\//,
  /^\/sbin\//,
  /^\/var\//,
  /^\/private\//,

  // Windows 系统目录
  /^C:\\Windows\\/i,
  /^C:\\Program Files/i,
  /^C:\\ProgramData/i,

  // 敏感配置目录
  /\.ssh\//,
  /\.gnupg\//,
  /\.aws\//,
  /\.kube\//,

  // 系统隐藏目录
  /\/\.[^/]+\/.*\.key$/,  // 任何 .xxx 目录下的 .key 文件
  /\/\.[^/]+\/.*\.pem$/   // 任何 .xxx 目录下的 .pem 文件
]

/**
 * 检查路径是否为受保护的系统路径
 * @param targetPath - 要检查的目标路径
 * @returns 如果路径受保护则返回 true
 */
export function isProtectedPath(targetPath: string): boolean {
  const normalized = path.resolve(targetPath)
  const isProtected = PROTECTED_PATTERNS.some(pattern => pattern.test(normalized))

  if (isProtected) {
    console.warn(`[SECURITY] Protected path detected: ${targetPath}`)
  }

  return isProtected
}

/**
 * 验证路径不是受保护的系统路径，是则抛出错误
 * @param targetPath - 要验证的目标路径
 * @throws {Error} 如果路径是受保护的系统路径
 */
export function validateNotProtected(targetPath: string): void {
  if (isProtectedPath(targetPath)) {
    throw new Error(
      `安全错误：无法操作受保护的系统路径 "${targetPath}"。` +
      `此路径包含系统文件或敏感配置。`
    )
  }
}

/**
 * 综合验证：检查路径是否在允许范围内且不是受保护路径
 * @param targetPath - 要验证的目标路径
 * @throws {Error} 如果路径验证失败
 */
export function validateSecurePath(targetPath: string): void {
  validatePath(targetPath)
  validateNotProtected(targetPath)
}

/**
 * 重置安全配置（测试用）
 */
export function resetSecurity(): void {
  allowedBasePath = null
  console.log('[SECURITY] Security configuration reset')
}
