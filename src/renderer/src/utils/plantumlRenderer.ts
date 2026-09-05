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
import {
  clearRemoteChartRequestState,
  createRemoteChartRequestKey,
  scheduleRemoteChartRequest,
} from './remoteChartRequestScheduler'

const PLANTUML_CONFIG = {
  MAX_CODE_SIZE: 50000, // 50KB
  DEFAULT_SERVER: 'https://www.plantuml.com/plantuml',
  FETCH_TIMEOUT: 8000, // 8s
  MAX_GET_LENGTH: 4000, // 编码后超过此长度改用 POST
}

/** 清除共享远程图表缓存（用于测试） */
export function clearSvgCache(): void {
  clearRemoteChartRequestState()
}

/**
 * 获取 PlantUML 服务器地址
 */
export function getPlantUMLServerUrl(): string {
  try {
    // 尝试从 localStorage 读取用户配置的服务器地址
    const customServer = localStorage.getItem('plantuml-server-url')
    if (customServer && customServer.trim()) {
      const url = new URL(customServer.trim())
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString().replace(/\/+$/, '')
      }
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

type PlantUMLDiagramType = 'plantuml' | 'c4plantuml'

function inferC4Include(code: string): string {
  if (/\b(?:Component|ComponentDb|ComponentQueue|Component_Ext|Component_Boundary)\s*\(/i.test(code)) {
    return '!include <C4/C4_Component>'
  }
  if (/\b(?:Container|ContainerDb|ContainerQueue|Container_Ext|Container_Boundary)\s*\(/i.test(code)) {
    return '!include <C4/C4_Container>'
  }
  return '!include <C4/C4_Context>'
}

export function normalizePlantUMLCode(code: string, diagramType: PlantUMLDiagramType = 'plantuml'): string {
  if (diagramType !== 'c4plantuml') return code
  if (/!include(?:url)?\s+(?:<C4\/|.*C4_)/i.test(code)) return code

  const include = inferC4Include(code)
  const startMatch = code.match(/^(\s*@startuml[^\n]*)(\r?\n)?/i)
  if (!startMatch) return `${include}\n${code}`

  const startLine = startMatch[1]
  const lineBreak = startMatch[2] || '\n'
  return `${startLine}${lineBreak}${include}${lineBreak}${code.slice(startMatch[0].length)}`
}

/**
 * 渲染 PlantUML 为 SVG 字符串
 */
export async function renderPlantUMLToSvg(code: string, diagramType: PlantUMLDiagramType = 'plantuml'): Promise<string> {
  const normalizedCode = normalizePlantUMLCode(code, diagramType)
  const serverUrl = getPlantUMLServerUrl()
  const requestKey = createRemoteChartRequestKey('plantuml', serverUrl, diagramType, normalizedCode)

  return scheduleRemoteChartRequest(requestKey, async () => {
    const encoded = encodePlantUML(normalizedCode)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PLANTUML_CONFIG.FETCH_TIMEOUT)

    try {
      let response: Response

      if (encoded.length <= PLANTUML_CONFIG.MAX_GET_LENGTH) {
        response = await fetch(`${serverUrl}/svg/${encoded}`, {
          signal: controller.signal,
        })
      } else {
        response = await fetch(`${serverUrl}/svg`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: normalizedCode,
          signal: controller.signal,
        })
      }

      if (!response.ok) {
        throw new Error(`服务器返回 ${response.status}: ${response.statusText}`)
      }

      const svg = await response.text()
      if (!/<svg[\s>]/i.test(svg)) throw new Error('服务器返回了非 SVG 内容')
      return svg
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('PlantUML 服务器请求超时，请检查网络连接或配置本地服务器')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  })
}

/**
 * 处理 HTML 中的 PlantUML 代码块（用于导出）
 */
export async function processPlantUMLInHtml(html: string): Promise<string> {
  const regex =
    /<pre\b(?=[^>]*\bclass=["'][^"']*\blanguage-(plantuml|c4plantuml)\b[^"']*["'])[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g
  const matches: { fullMatch: string; code: string; diagramType: PlantUMLDiagramType }[] = []

  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      diagramType: match[1] === 'c4plantuml' ? 'c4plantuml' : 'plantuml',
      code: match[2]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    })
  }

  if (matches.length === 0) return html

  let result = html
  for (let i = 0; i < matches.length; i++) {
    const { fullMatch, code, diagramType } = matches[i]
    try {
      const svgString = await renderPlantUMLToSvg(code, diagramType)
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
