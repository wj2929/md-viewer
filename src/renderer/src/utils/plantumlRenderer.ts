/**
 * PlantUML 图表渲染器
 *
 * 使用 plantuml-encoder 编码 + 可配置服务器获取 SVG。
 * 默认使用官方服务器 https://www.plantuml.com/plantuml/svg/
 * 用户可在设置中配置本地服务器地址。
 *
 * 特点：
 * - 编码后通过 HTTP 获取 SVG（GET / POST 自动切换）
 * - 结果缓存（避免重复请求）
 * - 超时控制（5s AbortController）
 * - 离线/错误降级（显示代码块 + 错误提示）
 *
 * @version v1.6.0
 */

// @ts-expect-error plantuml-encoder 没有类型定义
import plantumlEncoder from 'plantuml-encoder'

const PLANTUML_CONFIG = {
  MAX_CODE_SIZE: 50000, // 50KB
  MAX_PER_PAGE: 15,
  DEFAULT_SERVER: 'https://www.plantuml.com/plantuml',
  FETCH_TIMEOUT: 8000, // 8s
  MAX_GET_LENGTH: 4000, // 编码后超过此长度改用 POST
}

/** SVG 缓存：key = code hash, value = SVG string */
const svgCache = new Map<string, string>()

/**
 * 清除 SVG 缓存（用于测试）
 */
export function clearSvgCache(): void {
  svgCache.clear()
}

/**
 * 简单字符串哈希（用于缓存 key）
 */
function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash.toString(36)
}

/**
 * 获取 PlantUML 服务器地址
 */
function getServerUrl(): string {
  try {
    // 尝试从 localStorage 读取用户配置的服务器地址
    const customServer = localStorage.getItem('plantuml-server-url')
    if (customServer && customServer.trim()) {
      return customServer.trim().replace(/\/+$/, '')
    }
  } catch {
    // localStorage 不可用时使用默认值
  }
  return PLANTUML_CONFIG.DEFAULT_SERVER
}

/**
 * 验证 PlantUML 代码
 */
export function validatePlantUMLCode(code: string): { valid: boolean; error?: string } {
  if (!code || !code.trim()) {
    return { valid: false, error: '内容为空' }
  }

  if (code.length > PLANTUML_CONFIG.MAX_CODE_SIZE) {
    return {
      valid: false,
      error: `内容过大（${(code.length / 1024).toFixed(1)}KB），最大允许 ${PLANTUML_CONFIG.MAX_CODE_SIZE / 1024}KB`,
    }
  }

  return { valid: true }
}

/**
 * 编码 PlantUML 代码
 */
export function encodePlantUML(code: string): string {
  return plantumlEncoder.encode(code)
}

/**
 * 渲染 PlantUML 为 SVG 字符串
 */
export async function renderPlantUMLToSvg(code: string): Promise<string> {
  const cacheKey = hashCode(code)

  // 检查缓存
  const cached = svgCache.get(cacheKey)
  if (cached) return cached

  const encoded = encodePlantUML(code)
  const serverUrl = getServerUrl()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PLANTUML_CONFIG.FETCH_TIMEOUT)

  try {
    let response: Response

    if (encoded.length <= PLANTUML_CONFIG.MAX_GET_LENGTH) {
      // GET 请求
      response = await fetch(`${serverUrl}/svg/${encoded}`, {
        signal: controller.signal,
      })
    } else {
      // POST 请求（大型图表）
      response = await fetch(`${serverUrl}/svg`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: code,
        signal: controller.signal,
      })
    }

    if (!response.ok) {
      throw new Error(`服务器返回 ${response.status}: ${response.statusText}`)
    }

    const svg = await response.text()

    // 验证返回的确实是 SVG
    if (!svg.includes('<svg') && !svg.includes('<SVG')) {
      throw new Error('服务器返回了非 SVG 内容')
    }

    // 存入缓存
    svgCache.set(cacheKey, svg)
    return svg
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('PlantUML 服务器请求超时，请检查网络连接或配置本地服务器')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 处理 HTML 中的 PlantUML 代码块（用于导出）
 */
export async function processPlantUMLInHtml(html: string): Promise<string> {
  const regex =
    /<pre class="language-plantuml"><code class="language-plantuml">([\s\S]*?)<\/code><\/pre>/g
  const matches: { fullMatch: string; code: string }[] = []

  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      code: match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    })
  }

  if (matches.length === 0) return html

  let result = html
  for (let i = 0; i < Math.min(matches.length, PLANTUML_CONFIG.MAX_PER_PAGE); i++) {
    const { fullMatch, code } = matches[i]
    try {
      const svgString = await renderPlantUMLToSvg(code)
      const svgHtml = `<div class="plantuml-container" style="width: 100%; text-align: center;">${svgString}</div>`
      result = result.replace(fullMatch, svgHtml)
    } catch (error) {
      console.error(`[PlantUML] 导出渲染失败 #${i}:`, error)
      const errorHtml = `<div class="plantuml-error"><div class="error-title">PlantUML 渲染失败</div><div class="error-message">${(error as Error).message}</div></div>`
      result = result.replace(fullMatch, errorHtml)
    }
  }

  return result
}
