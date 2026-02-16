/**
 * DrawIO 图表渲染器
 *
 * 基于官方 viewer.min.js（~2.1MB），支持在 Markdown 中渲染 DrawIO XML 图表。
 * viewer.min.js 是传统 IIFE 脚本，通过 <script> 标签动态注入加载。
 *
 * 特点：
 * - 懒加载（首次使用时注入 <script>）
 * - 支持缩放、平移、图层等交互
 * - 需要 CSP 允许 'unsafe-eval'（viewer 内部使用 eval）
 *
 * @version v1.5.5
 */

const DRAWIO_CONFIG = {
  MAX_CODE_SIZE: 500 * 1024, // 500KB
  MAX_PER_PAGE: 10,
}

// viewer 实例类型（viewer.min.js 全局对象）
export interface DrawioViewerInstance {
  graph: { zoomIn: () => void; zoomOut: () => void; fit: () => void }
  showLightbox: () => void
  showLocalLightbox: () => void
  graphConfig: Record<string, unknown>
}

// 扩展 HTMLElement 以存储 viewer 实例
export interface HTMLElementWithViewer extends HTMLElement {
  __drawioViewer?: DrawioViewerInstance
}

// 单例加载状态
let viewerLoaded = false
let viewerLoadPromise: Promise<void> | null = null

/**
 * 懒加载 viewer.min.js（通过 <script> 标签注入）
 */
export async function loadDrawioViewer(): Promise<void> {
  if (viewerLoaded) return
  if (viewerLoadPromise) return viewerLoadPromise

  viewerLoadPromise = new Promise<void>((resolve, reject) => {
    // 预设路径为空字符串，阻止 viewer.min.js 使用远程 CDN（会触发 CORS 错误）
    // viewer.min.js 第 1 行：window.STENCIL_PATH = window.STENCIL_PATH || "https://viewer.diagrams.net/stencils"
    // 预设后 || 短路，不会覆盖为远程地址
    const w = window as unknown as Record<string, unknown>
    if (!w.STENCIL_PATH) w.STENCIL_PATH = './stencils'
    if (!w.SHAPES_PATH) w.SHAPES_PATH = './shapes'
    if (!w.STYLE_PATH) w.STYLE_PATH = './styles'
    if (!w.GRAPH_IMAGE_PATH) w.GRAPH_IMAGE_PATH = './img'

    const script = document.createElement('script')
    script.src = './drawio-viewer.min.js'
    script.onload = () => {
      viewerLoaded = true
      // Monkey-patch: 静默处理 stencil 加载失败（本地不存在的 stencil 文件）
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const registry = (window as any).mxStencilRegistry
        if (registry) {
          const origLoadStencilSet = registry.loadStencilSet
          registry.loadStencilSet = function (url: string, ...args: unknown[]) {
            try {
              return origLoadStencilSet.call(this, url, ...args)
            } catch {
              // 静默忽略 stencil 加载失败
            }
          }
          const origLoadStencil = registry.loadStencil
          if (origLoadStencil) {
            registry.loadStencil = function (url: string, ...args: unknown[]) {
              try {
                return origLoadStencil.call(this, url, ...args)
              } catch {
                return null
              }
            }
          }
        }
        // 同时 patch mxUtils.load 以静默处理所有远程资源加载失败
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mxUtils = (window as any).mxUtils
        if (mxUtils) {
          const origLoad = mxUtils.load
          mxUtils.load = function (url: string) {
            try {
              return origLoad.call(this, url)
            } catch {
              return null
            }
          }
        }
      } catch {
        // ignore patch failure
      }
      resolve()
    }
    script.onerror = () => {
      viewerLoadPromise = null
      reject(new Error('DrawIO viewer 加载失败'))
    }
    document.head.appendChild(script)
  })

  return viewerLoadPromise
}

/**
 * 验证 DrawIO XML 代码
 */
export function validateDrawioCode(code: string): { valid: boolean; error?: string } {
  if (!code || !code.trim()) {
    return { valid: false, error: '内容为空' }
  }

  if (code.length > DRAWIO_CONFIG.MAX_CODE_SIZE) {
    return {
      valid: false,
      error: `内容过大（${(code.length / 1024).toFixed(1)}KB），最大允许 ${DRAWIO_CONFIG.MAX_CODE_SIZE / 1024}KB`,
    }
  }

  // 基本格式校验：必须包含 mxGraphModel 或 mxfile
  if (!/<mxGraphModel|<mxfile/i.test(code)) {
    return { valid: false, error: '无效的 DrawIO 格式：缺少 mxGraphModel 或 mxfile 标签' }
  }

  return { valid: true }
}

/**
 * 渲染 DrawIO 到容器
 *
 * 使用 viewer.min.js 的标准 API：创建 .mxgraph 容器，
 * 然后调用 GraphViewer.createViewerForElement() 渲染单个元素。
 */
export async function renderDrawioInElement(
  code: string,
  container: HTMLElement
): Promise<void> {
  await loadDrawioViewer()

  // 创建 mxgraph 容器
  const mxDiv = document.createElement('div')
  mxDiv.className = 'mxgraph'
  mxDiv.style.width = '100%'
  mxDiv.setAttribute(
    'data-mxgraph',
    JSON.stringify({
      xml: code,
      highlight: '#0000ff',
      nav: true,
      resize: true,
      toolbar: '',
      edit: '_blank',
      'check-visible-state': false,
    })
  )
  container.appendChild(mxDiv)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gv = (window as any).GraphViewer
  if (typeof gv === 'undefined' || gv === null) {
    console.error('[DrawIO] GraphViewer 全局变量不存在')
    return
  }

  try {
    gv.createViewerForElement(mxDiv, (viewer: DrawioViewerInstance) => {
      // 将 viewer 实例存储到容器上，供工具栏按钮调用
      container.dataset.drawioReady = 'true'
      ;(container as HTMLElementWithViewer).__drawioViewer = viewer
    })
  } catch (err) {
    console.error('[DrawIO] createViewerForElement 异常:', err)
  }
}

/**
 * 处理 HTML 中的 drawio 代码块（用于导出）
 *
 * 导出时 viewer.min.js 不可用（依赖 DOM），
 * 将 drawio 代码块替换为静态提示信息。
 */
export async function processDrawioInHtml(html: string): Promise<string> {
  const regex =
    /<pre class="language-drawio"><code class="language-drawio">([\s\S]*?)<\/code><\/pre>/g
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
  for (let i = 0; i < Math.min(matches.length, DRAWIO_CONFIG.MAX_PER_PAGE); i++) {
    const { fullMatch } = matches[i]
    // 导出时替换为静态提示（viewer.min.js 依赖 DOM 环境，无法离线渲染为 SVG）
    const placeholder = `<div class="drawio-container" style="width: 100%; text-align: center; padding: 20px; border: 1px dashed #ccc; color: #999;">DrawIO 图表（需在应用内查看）</div>`
    result = result.replace(fullMatch, placeholder)
  }

  return result
}
