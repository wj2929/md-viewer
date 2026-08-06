/**
 * 安全模块 - 路径校验和沙箱安全
 * @module security
 * @description 提供路径白名单校验和受保护路径检测功能
 */

import * as path from 'path'
import * as fs from 'fs-extra'

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
 * 异步验证路径在给定根目录内且不是受保护路径。
 * 已存在路径解析为真实路径；不存在目标则解析最近存在的父目录，
 * 防止通过中间符号链接越出根目录。
 */
export async function validateSecurePathInBase(
  targetPath: string,
  basePath: string
): Promise<string> {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedBase = path.resolve(basePath)
  const resolvedBase = await fs.realpath(normalizedBase)
  const baseStats = await fs.stat(resolvedBase)
  if (!baseStats.isDirectory()) {
    throw new Error(`安全错误：基础路径 "${basePath}" 不是目录`)
  }
  const resolvedTarget = await resolvePathFromNearestExistingAncestor(normalizedTarget)

  if (!isPathWithinBase(resolvedTarget, resolvedBase)) {
    throw new Error(
      `安全错误：路径 "${targetPath}" 不在允许范围内。` +
      `当前允许的基础路径为：${resolvedBase}`
    )
  }

  validateNotProtected(resolvedTarget)
  return resolvedTarget
}

function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const relativePath = path.relative(basePath, targetPath)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

async function resolvePathFromNearestExistingAncestor(targetPath: string): Promise<string> {
  const missingSegments: string[] = []
  let candidatePath = targetPath

  while (true) {
    try {
      await fs.lstat(candidatePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      const parentPath = path.dirname(candidatePath)
      if (parentPath === candidatePath) {
        throw new Error(`安全错误：无法解析路径 "${targetPath}"`)
      }
      missingSegments.unshift(path.basename(candidatePath))
      candidatePath = parentPath
      continue
    }

    try {
      return path.join(await fs.realpath(candidatePath), ...missingSegments)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(`安全错误：无法解析路径 "${targetPath}" 中的符号链接`)
      }
      throw error
    }
  }
}

/**
 * 搜索专用路径验证：仅拦截系统/敏感路径，不限制 allowedBasePath
 * 用于跨文件夹搜索场景
 */
export function validateSearchPath(targetPath: string): void {
  const normalized = path.resolve(targetPath)
  if (PROTECTED_PATTERNS.some(pattern => pattern.test(normalized))) {
    throw new Error(`安全错误：路径 "${targetPath}" 是受保护的系统路径`)
  }
}

/**
 * 重置安全配置（测试用）
 * @deprecated 全局 allowedBasePath 已移除，鉴权改由各窗口根目录承担；
 * 保留为空实现以兼容现有测试的 beforeEach 清理调用。
 */
export function resetSecurity(): void {
  // no-op：不再有进程级可变授权状态需要重置
}
