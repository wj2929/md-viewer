/**
 * Pandoc DOCX 导出器
 * 使用 Pandoc 将 HTML 转换为高质量 Word 文档
 * 直接使用渲染后的 HTML，保证与 PDF 导出格式一致
 */

import { spawn, execSync } from 'child_process'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import AdmZip from 'adm-zip'
import { app } from 'electron'

// Word 页面宽度常量（EMU 单位）
// 1 英寸 = 914400 EMU，Word 默认页面宽度 6.5 英寸
const WORD_PAGE_WIDTH_EMU = 5943600 // 6.5 * 914400

/**
 * 获取 reference.docx 的路径
 * 在开发模式下从 resources 目录读取，打包后从 app 资源目录读取
 */
function getReferenceDocPath(): string | null {
  // 尝试多个可能的路径
  const possiblePaths = [
    // 开发模式：项目根目录下的 resources
    path.join(process.cwd(), 'resources', 'reference.docx'),
    // 打包后：app 资源目录
    path.join(app.getAppPath(), 'resources', 'reference.docx'),
    // 打包后：extraResources 目录
    path.join(process.resourcesPath || '', 'reference.docx'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('[Pandoc] 找到 reference.docx:', p)
      return p
    }
  }

  console.log('[Pandoc] 未找到 reference.docx，使用 Pandoc 默认样式')
  return null
}

/**
 * 裁剪 SVG 的 viewBox 以移除两侧空白
 * 注意：这个功能暂时禁用，因为自动检测内容边界容易出错
 * 保持原始 SVG 不变，让 Word 按原始宽高比显示
 */
function cropSvgViewBox(svgContent: string): { content: string; widthRatio: number } {
  // 暂时禁用裁剪功能，直接返回原始内容
  // 因为自动检测 SVG 内容边界容易裁剪掉有用内容
  return { content: svgContent, widthRatio: 1 }
}

/**
 * 获取 Lua 过滤器目录路径
 * Lua 过滤器来自 pandoc_docx_template 项目，用于增强 DOCX 输出质量
 */
function getLuaFilterDir(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'resources', 'lua'),
    path.join(app.getAppPath(), 'resources', 'lua'),
    path.join(process.resourcesPath || '', 'lua'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('[Pandoc] 找到 Lua 过滤器目录:', p)
      return p
    }
  }

  console.log('[Pandoc] 未找到 Lua 过滤器目录')
  return null
}

/**
 * 获取公文格式 reference.docx 的路径
 */
function getGongwenReferenceDocPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'resources', 'reference-gongwen.docx'),
    path.join(app.getAppPath(), 'resources', 'reference-gongwen.docx'),
    path.join(process.resourcesPath || '', 'reference-gongwen.docx'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('[Pandoc] 找到公文格式 reference-gongwen.docx:', p)
      return p
    }
  }

  console.log('[Pandoc] 未找到 reference-gongwen.docx')
  return null
}

/**
 * 使用 Pandoc 从 HTML 导出 DOCX
 * 直接使用渲染后的 HTML 内容，与 PDF 导出保持一致
 * @param docStyle - 文档样式：'standard'（默认）或 'gongwen'（公文格式）
 */
export async function exportWithPandoc(
  htmlContent: string,
  outputPath: string,
  _basePath: string,
  docStyle?: string
): Promise<{ filePath: string; warnings: string[] }> {
  const warnings: string[] = []
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-viewer-'))

  try {
    // 1. 包装 HTML 内容为完整的 HTML 文档
    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    img { max-width: 100%; height: auto; }
    .echarts-container, .mermaid-container { width: 100%; }
    .echarts-container svg, .mermaid-container svg { width: 100% !important; height: auto !important; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>
`

    // 2. 保存 HTML 到临时文件
    const htmlPath = path.join(tempDir, 'input.html')
    await fs.writeFile(htmlPath, fullHtml, 'utf-8')

    console.log('[Pandoc] HTML 文件已保存:', htmlPath)

    // 3. 调用 Pandoc 转换 HTML -> DOCX
    // 根据 docStyle 选择不同的 reference.docx
    const isGongwen = docStyle === 'gongwen'
    const referenceDocPath = isGongwen ? getGongwenReferenceDocPath() : getReferenceDocPath()
    const pandocArgs = [
      htmlPath,
      '-o', outputPath,
      '-f', 'html',
      '-t', 'docx',
      '--standalone',
    ]

    // 如果找到 reference.docx，添加 --reference-doc 参数
    if (referenceDocPath) {
      pandocArgs.push('--reference-doc', referenceDocPath)
      console.log(`[Pandoc] 使用${isGongwen ? '公文格式' : '标准'} reference.docx:`, referenceDocPath)
    }

    // 添加 Lua 过滤器（为行内代码添加独立样式）
    const luaDir = getLuaFilterDir()
    if (luaDir) {
      const inlineCodeLua = path.join(luaDir, 'add-inline-code.lua')
      if (fs.existsSync(inlineCodeLua)) {
        pandocArgs.push('--lua-filter', inlineCodeLua)
        console.log('[Pandoc] 使用 Lua 过滤器: add-inline-code.lua')
      }
    }

    await new Promise<void>((resolve, reject) => {
      const pandoc = spawn('pandoc', pandocArgs)

      let stderr = ''

      pandoc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      pandoc.on('close', (code) => {
        if (code === 0) {
          if (stderr) {
            warnings.push(stderr)
          }
          resolve()
        } else {
          reject(new Error(`Pandoc 退出码 ${code}: ${stderr}`))
        }
      })

      pandoc.on('error', (err) => {
        reject(new Error(`Pandoc 执行失败: ${err.message}`))
      })
    })

    // 4. 将 DOCX 中的 SVG 转换为 PNG（提高兼容性）
    await convertSvgToPngInDocx(outputPath)

    // 5. 修复 DOCX 中的图片尺寸（Pandoc 有最大宽度限制）
    await fixDocxImageSizes(outputPath)

    // 6. 确保表格有边框（Pandoc 生成的表格可能缺少内联边框）
    await ensureTableBorders(outputPath)

    // 7. 公文格式额外处理（确保页面设置和字体正确）
    if (isGongwen) {
      await applyGongwenPageSetup(outputPath)
    }

    console.log(`[Pandoc] DOCX 导出成功${isGongwen ? '（公文格式）' : ''}:`, outputPath)

    return { filePath: outputPath, warnings }
  } finally {
    // 清理临时目录
    await fs.remove(tempDir).catch(() => {})
  }
}

/**
 * 将 DOCX 中的 SVG 文件转换为 PNG
 * Word/WPS 对 SVG 的支持有限，转换为 PNG 可以提高兼容性
 */
async function convertSvgToPngInDocx(docxPath: string): Promise<void> {
  try {
    // 检查 rsvg-convert 是否可用
    try {
      execSync('which rsvg-convert', { stdio: 'ignore' })
    } catch {
      console.log('[Pandoc] rsvg-convert 不可用，跳过 SVG 转 PNG')
      return
    }

    const zip = new AdmZip(docxPath)
    const entries = zip.getEntries()
    const svgEntries: string[] = []
    // 记录每个 rId 的裁剪比例，用于后续调整 DOCX 中的图片尺寸
    const cropRatios: Map<string, number> = new Map()

    // 创建临时目录用于转换
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-convert-'))

    try {
      // 第一步：转换所有 SVG 为 PNG
      for (const entry of entries) {
        if (entry.entryName.startsWith('word/media/') && entry.entryName.endsWith('.svg')) {
          let svgContent = entry.getData().toString('utf-8')
          const baseName = path.basename(entry.entryName, '.svg')
          const svgPath = path.join(tempDir, `${baseName}.svg`)
          const pngPath = path.join(tempDir, `${baseName}.png`)

          // 修复 ECharts SVG 的 viewbox 属性（应该是 viewBox，大写 B）
          svgContent = svgContent.replace(/viewbox=/gi, 'viewBox=')

          // 优化 ECharts SVG：裁剪空白区域
          // ECharts 生成的 SVG viewBox 通常很宽（如 0 0 1660 400），但内容居中
          // 我们需要计算实际内容的边界并裁剪 viewBox
          const { content: croppedSvg, widthRatio } = cropSvgViewBox(svgContent)
          svgContent = croppedSvg

          // 记录裁剪比例（baseName 就是 rId，如 rId9）
          cropRatios.set(baseName, widthRatio)

          // 保存 SVG 文件
          await fs.writeFile(svgPath, svgContent)

          // 使用 rsvg-convert 转换为 PNG
          // 使用 -z 3 缩放因子来提高分辨率（3倍缩放，提高清晰度）
          // 这样可以保持 SVG 的原始宽高比，同时生成高分辨率 PNG
          try {
            execSync(`rsvg-convert -z 3 -o "${pngPath}" "${svgPath}"`, { stdio: 'ignore' })

            // 读取 PNG 文件
            const pngData = await fs.readFile(pngPath)

            // 添加 PNG 文件
            const newEntryName = entry.entryName.replace('.svg', '.png')
            zip.addFile(newEntryName, pngData)

            // 记录要删除的 SVG
            svgEntries.push(entry.entryName)

            console.log(`[Pandoc] 转换 SVG -> PNG: ${baseName}`)
          } catch (err) {
            console.error(`[Pandoc] SVG 转换失败: ${entry.entryName}`, err)
          }
        }
      }

      if (svgEntries.length === 0) {
        console.log('[Pandoc] 没有 SVG 文件需要转换')
        return
      }

      // 第二步：删除所有 SVG 文件
      for (const svgEntry of svgEntries) {
        zip.deleteFile(svgEntry)
      }

      // 第三步：更新 document.xml 中的引用，并修复 SVG 扩展标签结构
      const documentXml = zip.getEntry('word/document.xml')
      if (documentXml) {
        let content = documentXml.getData().toString('utf-8')

        // 替换文件扩展名
        content = content.replace(/\.svg/g, '.png')

        // 关键修复：Pandoc 生成的 SVG 使用扩展标签 <asvg:svgBlip r:embed="rIdX"/>
        // 这个标签在 Word 中不被正确识别，需要将 r:embed 移动到父级 <a:blip> 标签
        // 原始结构: <a:blip><a:extLst><a:ext uri="..."><asvg:svgBlip r:embed="rIdX"/></a:ext></a:extLst></a:blip>
        // 目标结构: <a:blip r:embed="rIdX"/>

        // 匹配整个 a:blip 块，提取 r:embed 并重构
        content = content.replace(
          /<a:blip([^>]*)>[\s\S]*?<asvg:svgBlip[^>]*r:embed="([^"]+)"[^>]*\/>[\s\S]*?<\/a:blip>/g,
          (match, blipAttrs, embedId) => {
            // 检查 a:blip 是否已经有 r:embed 属性
            if (blipAttrs.includes('r:embed')) {
              // 已经有 r:embed，只需移除 SVG 扩展
              return match.replace(/<a:extLst>[\s\S]*?<\/a:extLst>/g, '')
            }
            // 将 r:embed 移动到 a:blip 标签
            return `<a:blip${blipAttrs} r:embed="${embedId}"/>`
          }
        )

        // 移除空的 a:extLst 标签
        content = content.replace(/<a:extLst>\s*<\/a:extLst>/g, '')

        // 移除 asvg 命名空间声明（如果存在）
        content = content.replace(/\s*xmlns:asvg="[^"]*"/g, '')

        // 清除 pic:cNvPr 中的 base64 SVG 数据，避免 Word 使用错误的图片源
        // 原始: <pic:cNvPr descr="data:image/svg+xml;base64,..." id="11" name="Picture"/>
        // 目标: <pic:cNvPr descr="" id="11" name="Picture"/>
        content = content.replace(
          /<pic:cNvPr\s+descr="data:image\/svg\+xml;base64,[^"]*"/g,
          '<pic:cNvPr descr=""'
        )

        // 第四步：根据裁剪比例调整图片尺寸
        // 匹配每个图片块，找到对应的 rId，然后调整尺寸
        for (const [rId, ratio] of cropRatios) {
          if (ratio < 1) {
            // 匹配包含此 rId 的图片块，调整 wp:extent 和 a:ext
            const rIdPattern = new RegExp(
              `(<wp:inline[^>]*>[\\s\\S]*?r:embed="${rId}"[\\s\\S]*?</wp:inline>)`,
              'g'
            )
            content = content.replace(rIdPattern, (match) => {
              // 调整 wp:extent
              match = match.replace(
                /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/g,
                (extMatch, cx, cy) => {
                  const newCx = Math.round(parseInt(cx, 10) * ratio)
                  return `<wp:extent cx="${newCx}" cy="${cy}"/>`
                }
              )
              // 调整 a:ext（图片实际尺寸）
              match = match.replace(
                /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/g,
                (extMatch, cx, cy) => {
                  const oldCx = parseInt(cx, 10)
                  // 只调整大尺寸的 a:ext（图片尺寸），不调整小的（如形状尺寸）
                  if (oldCx > 1000000) {
                    const newCx = Math.round(oldCx * ratio)
                    return `<a:ext cx="${newCx}" cy="${cy}"/>`
                  }
                  return extMatch
                }
              )
              return match
            })
            console.log(`[Pandoc] 调整图片 ${rId} 尺寸，比例: ${ratio.toFixed(3)}`)
          }
        }

        zip.updateFile('word/document.xml', Buffer.from(content, 'utf-8'))
        console.log('[Pandoc] 已修复 SVG 扩展标签结构')
      }

      // 第四步：更新 [Content_Types].xml
      const contentTypes = zip.getEntry('[Content_Types].xml')
      if (contentTypes) {
        let content = contentTypes.getData().toString('utf-8')

        // 移除所有 SVG Override 条目
        content = content.replace(/<Override[^>]*\.svg[^>]*\/>/g, '')

        // 添加 PNG Default 类型（如果不存在）
        if (!content.includes('Extension="png"')) {
          content = content.replace(
            '</Types>',
            '<Default Extension="png" ContentType="image/png"/></Types>'
          )
        }

        zip.updateFile('[Content_Types].xml', Buffer.from(content, 'utf-8'))
      }

      // 第五步：更新所有关系文件
      for (const entry of zip.getEntries()) {
        if (entry.entryName.endsWith('.rels')) {
          let content = entry.getData().toString('utf-8')
          if (content.includes('.svg')) {
            content = content.replace(/\.svg/g, '.png')
            zip.updateFile(entry.entryName, Buffer.from(content, 'utf-8'))
          }
        }
      }

      zip.writeZip(docxPath)
      console.log(`[Pandoc] 已将 ${svgEntries.length} 个 SVG 转换为 PNG`)
    } finally {
      await fs.remove(tempDir).catch(() => {})
    }
  } catch (error) {
    console.error('[Pandoc] SVG 转 PNG 失败:', error)
    // 不抛出错误，让导出继续
  }
}

/**
 * 修复 DOCX 中的图片尺寸
 * 扩大检测范围：将宽度 > 3,000,000 EMU 且 < 页面宽度的图片拉伸至全页宽
 * 这样可以捕获所有被 Pandoc 限制的图表图片（包括 ECharts 等）
 */
async function fixDocxImageSizes(docxPath: string): Promise<void> {
  try {
    const zip = new AdmZip(docxPath)
    const documentXml = zip.getEntry('word/document.xml')

    if (!documentXml) {
      console.log('[Pandoc] 未找到 document.xml，跳过图片尺寸修复')
      return
    }

    let content = documentXml.getData().toString('utf-8')
    let modified = false

    // 检测阈值：宽度大于 3,000,000 EMU 的图片视为需要拉伸的全宽图片
    const MIN_WIDTH_THRESHOLD = 3000000

    content = content.replace(
      /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/g,
      (match, cx, cy) => {
        const oldWidth = parseInt(cx, 10)
        const oldHeight = parseInt(cy, 10)

        // 宽度大于阈值且小于页面宽度的图片，拉伸至全页宽
        if (oldWidth >= MIN_WIDTH_THRESHOLD && oldWidth < WORD_PAGE_WIDTH_EMU) {
          const scale = WORD_PAGE_WIDTH_EMU / oldWidth
          const newHeight = Math.round(oldHeight * scale)
          modified = true
          console.log(`[Pandoc] 调整 wp:extent: ${oldWidth} -> ${WORD_PAGE_WIDTH_EMU} EMU (scale: ${scale.toFixed(3)})`)
          return `<wp:extent cx="${WORD_PAGE_WIDTH_EMU}" cy="${newHeight}"/>`
        }
        return match
      }
    )

    // 同时修复 a:ext 标签
    content = content.replace(
      /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/g,
      (match, cx, cy) => {
        const oldWidth = parseInt(cx, 10)
        const oldHeight = parseInt(cy, 10)

        if (oldWidth >= MIN_WIDTH_THRESHOLD && oldWidth < WORD_PAGE_WIDTH_EMU) {
          const scale = WORD_PAGE_WIDTH_EMU / oldWidth
          const newHeight = Math.round(oldHeight * scale)
          console.log(`[Pandoc] 调整 a:ext: ${oldWidth} -> ${WORD_PAGE_WIDTH_EMU} EMU (scale: ${scale.toFixed(3)})`)
          return `<a:ext cx="${WORD_PAGE_WIDTH_EMU}" cy="${newHeight}"/>`
        }
        return match
      }
    )

    if (modified) {
      zip.updateFile('word/document.xml', Buffer.from(content, 'utf-8'))
      zip.writeZip(docxPath)
      console.log('[Pandoc] 已调整全宽图片尺寸')
    }
  } catch (error) {
    console.error('[Pandoc] 修复图片尺寸失败:', error)
    // 不抛出错误，让导出继续
  }
}

/**
 * 确保表格有边框
 * Pandoc 生成的 document.xml 中的表格可能缺少内联边框，
 * 即使模板定义了 Table 样式，也需要在 document.xml 中添加 tblLook
 * 以启用条件格式（如 firstRow 表头样式）
 */
async function ensureTableBorders(docxPath: string): Promise<void> {
  try {
    const zip = new AdmZip(docxPath)
    const documentXml = zip.getEntry('word/document.xml')

    if (!documentXml) {
      return
    }

    let content = documentXml.getData().toString('utf-8')
    let modified = false

    // 给所有 w:tblPr 添加 w:tblLook（启用 firstRow 条件格式）
    content = content.replace(
      /<w:tblPr>([\s\S]*?)<\/w:tblPr>/g,
      (match, inner) => {
        if (!inner.includes('w:tblLook')) {
          modified = true
          return `<w:tblPr>${inner}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
        }
        return match
      }
    )

    if (modified) {
      zip.updateFile('word/document.xml', Buffer.from(content, 'utf-8'))
      zip.writeZip(docxPath)
      console.log('[Pandoc] 已添加表格 tblLook 属性')
    }
  } catch (error) {
    console.error('[Pandoc] 确保表格边框失败:', error)
  }
}

/**
 * 应用公文格式页面设置
 * 确保页面边距、行间距等符合 GB/T 9704 标准
 * reference-gongwen.docx 已包含字体和样式定义，
 * 这里主要确保 document.xml 中的页面设置正确
 */
async function applyGongwenPageSetup(docxPath: string): Promise<void> {
  try {
    const zip = new AdmZip(docxPath)
    const documentXml = zip.getEntry('word/document.xml')

    if (!documentXml) {
      console.log('[Pandoc] 未找到 document.xml，跳过公文页面设置')
      return
    }

    let content = documentXml.getData().toString('utf-8')
    let modified = false

    // 公文页面边距（twip）：上3.7cm 下3.5cm 左2.8cm 右2.6cm
    // 1cm ≈ 567 twip
    const TOP = 2098    // 3.7 * 567
    const BOTTOM = 1985  // 3.5 * 567
    const LEFT = 1588    // 2.8 * 567
    const RIGHT = 1474   // 2.6 * 567

    // 替换页面边距
    if (content.includes('<w:pgMar')) {
      content = content.replace(
        /<w:pgMar[^/]*\/>/,
        `<w:pgMar w:top="${TOP}" w:right="${RIGHT}" w:bottom="${BOTTOM}" w:left="${LEFT}" w:header="851" w:footer="992" w:gutter="0"/>`
      )
      modified = true
    } else if (content.includes('<w:sectPr')) {
      // 在 sectPr 内添加 pgMar
      content = content.replace(
        /<w:sectPr([^>]*)>/,
        `<w:sectPr$1><w:pgMar w:top="${TOP}" w:right="${RIGHT}" w:bottom="${BOTTOM}" w:left="${LEFT}" w:header="851" w:footer="992" w:gutter="0"/>`
      )
      modified = true
    }

    if (modified) {
      zip.updateFile('word/document.xml', Buffer.from(content, 'utf-8'))
      zip.writeZip(docxPath)
      console.log('[Pandoc] 公文格式页面设置已应用')
    }
  } catch (error) {
    console.error('[Pandoc] 应用公文页面设置失败:', error)
  }
}

/**
 * 检查 Pandoc 是否可用
 */
export async function isPandocAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const pandoc = spawn('pandoc', ['--version'])

    pandoc.on('close', (code) => {
      resolve(code === 0)
    })

    pandoc.on('error', () => {
      resolve(false)
    })
  })
}
