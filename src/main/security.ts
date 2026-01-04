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
 * v1.3 扩展：30+ 条规则
 */
const PROTECTED_PATTERNS = [
  // ========== Unix/Linux/macOS 系统目录 ==========
  /^\/etc\//,
  /^\/usr\//,
  /^\/System\//,
  /^\/Library\//,
  /^\/bin\//,
  /^\/sbin\//,
  /^\/var\//,
  /^\/private\//,
  /^\/opt\//,
  /^\/root\//,

  // ========== Windows 系统目录 ==========
  /^C:\\Windows\\/i,
  /^C:\\Program Files/i,
  /^C:\\ProgramData/i,
  /^C:\\Users\\[^\\]+\\AppData\\/i,

  // ========== 用户敏感目录（凭证和密钥）==========
  /\/\.ssh\//,           // SSH 密钥
  /\/\.gnupg\//,         // GPG 密钥
  /\/\.aws\//,           // AWS 凭证
  /\/\.kube\//,          // Kubernetes 配置
  /\/\.docker\//,        // Docker 配置
  /\/\.azure\//,         // Azure 凭证
  /\/\.gcloud\//,        // Google Cloud 凭证
  /\/\.config\/gh\//,    // GitHub CLI 凭证
  /\/\.config\/gcloud\//,  // Google Cloud 配置
  /\/\.config\/heroku\//,  // Heroku 配置

  // ========== 敏感配置文件 ==========
  /\/\.npmrc$/,          // NPM Token
  /\/\.pypirc$/,         // PyPI Token
  /\/\.netrc$/,          // FTP/网络凭证
  /\/\.gitconfig$/,      // Git 全局配置（可能含凭证）
  /\/\.git-credentials$/, // Git 凭证存储
  /\/\.env$/,            // 环境变量文件
  /\/\.env\.[^/]+$/,     // .env.local, .env.production 等

  // ========== macOS 特定敏感路径 ==========
  /\/Library\/Keychains\//,     // 钥匙串
  /\/Library\/Cookies\//,       // Cookies
  /\/Library\/Safari\//,        // Safari 数据
  /\/Library\/Application Support\/Google\/Chrome\/.*Login Data/i,  // Chrome 密码
  /\/Library\/Application Support\/Firefox\/Profiles\/.*logins\.json/i,  // Firefox 密码

  // ========== 敏感文件扩展名（私钥和证书）==========
  /\/id_rsa$/,           // SSH 私钥
  /\/id_ed25519$/,       // Ed25519 私钥
  /\/id_ecdsa$/,         // ECDSA 私钥
  /\/id_dsa$/,           // DSA 私钥
  /\.pem$/,              // 证书私钥
  /\.p12$/,              // PKCS#12 证书
  /\.pfx$/,              // 证书
  /\.key$/,              // 通用私钥
  /\.keystore$/,         // Java 密钥库
  /\.jks$/,              // Java KeyStore

  // ========== 数据库和密码存储 ==========
  /\.kdbx?$/,            // KeePass 数据库
  /\.1pux$/,             // 1Password 导出
  /password/i,           // 任何包含 password 的文件

  // ========== 系统隐藏目录下的敏感文件 ==========
  /\/\.[^/]+\/.*\.key$/,
  /\/\.[^/]+\/.*\.pem$/,
  /\/\.[^/]+\/.*credentials/i,
  /\/\.[^/]+\/.*secret/i,
  /\/\.[^/]+\/.*token/i
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
