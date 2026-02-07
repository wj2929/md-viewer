/**
 * DOCX 导出器
 * 将 Markdown 转换为 Word 文档
 * v1.5.0: 支持 ECharts 和 Mermaid 图表（通过图片嵌入）
 */

import MarkdownIt from 'markdown-it'
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Packer,
  ExternalHyperlink,
  ImageRun,
} from 'docx'
import * as fs from 'fs-extra'
import * as path from 'path'

// Token 类型定义
interface Token {
  type: string
  tag: string
  content: string
  info: string
  children: Token[] | null
  attrGet: (name: string) => string | null
}

// 图表数据接口
export interface ChartImageData {
  type: 'echarts' | 'mermaid'
  index: number
  base64: string  // PNG base64 数据（不含 data:image/png;base64, 前缀）
  width: number
  height: number
}

// 标题级别映射
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

// 解析行内格式（粗体、斜体、代码、链接）
function parseInlineTokens(
  tokens: Token[],
  basePath: string
): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []
  let bold = false
  let italic = false
  let linkHref = ''

  for (const token of tokens) {
    switch (token.type) {
      case 'strong_open':
        bold = true
        break
      case 'strong_close':
        bold = false
        break
      case 'em_open':
        italic = true
        break
      case 'em_close':
        italic = false
        break
      case 'code_inline':
        runs.push(
          new TextRun({
            text: token.content,
            font: 'Consolas',
            shading: { fill: 'f0f0f0' },
          })
        )
        break
      case 'link_open':
        linkHref = token.attrGet('href') || ''
        break
      case 'link_close':
        linkHref = ''
        break
      case 'text':
        if (linkHref) {
          runs.push(
            new ExternalHyperlink({
              children: [
                new TextRun({
                  text: token.content,
                  style: 'Hyperlink',
                }),
              ],
              link: linkHref,
            })
          )
        } else {
          runs.push(
            new TextRun({
              text: token.content,
              bold,
              italics: italic,
            })
          )
        }
        break
      case 'softbreak':
        runs.push(new TextRun({ text: ' ' }))
        break
      case 'hardbreak':
        runs.push(new TextRun({ break: 1 }))
        break
    }
  }

  return runs
}

// 将 markdown-it tokens 转换为 docx 元素
async function tokensToDocxElements(
  tokens: Token[],
  basePath: string,
  chartImages: ChartImageData[]
): Promise<(Paragraph | Table)[]> {
  const elements: (Paragraph | Table)[] = []
  let i = 0
  let echartsIndex = 0
  let mermaidIndex = 0

  while (i < tokens.length) {
    const token = tokens[i]

    switch (token.type) {
      // 标题
      case 'heading_open': {
        const level = parseInt(token.tag.slice(1)) - 1
        const contentToken = tokens[i + 1]
        if (contentToken && contentToken.type === 'inline') {
          const runs = parseInlineTokens(contentToken.children || [], basePath)
          elements.push(
            new Paragraph({
              children: runs,
              heading: HEADING_LEVELS[level] || HeadingLevel.HEADING_6,
            })
          )
        }
        i += 3 // heading_open, inline, heading_close
        break
      }

      // 段落
      case 'paragraph_open': {
        const contentToken = tokens[i + 1]
        if (contentToken && contentToken.type === 'inline') {
          const runs = parseInlineTokens(contentToken.children || [], basePath)
          elements.push(new Paragraph({ children: runs }))
        }
        i += 3 // paragraph_open, inline, paragraph_close
        break
      }

      // 无序列表
      case 'bullet_list_open': {
        i++
        while (i < tokens.length && tokens[i].type !== 'bullet_list_close') {
          if (tokens[i].type === 'list_item_open') {
            i++
            while (i < tokens.length && tokens[i].type !== 'list_item_close') {
              if (tokens[i].type === 'paragraph_open') {
                const contentToken = tokens[i + 1]
                if (contentToken && contentToken.type === 'inline') {
                  const runs = parseInlineTokens(contentToken.children || [], basePath)
                  elements.push(
                    new Paragraph({
                      children: runs,
                      bullet: { level: 0 },
                    })
                  )
                }
                i += 3
              } else {
                i++
              }
            }
          }
          i++
        }
        i++ // bullet_list_close
        break
      }

      // 有序列表
      case 'ordered_list_open': {
        i++
        while (i < tokens.length && tokens[i].type !== 'ordered_list_close') {
          if (tokens[i].type === 'list_item_open') {
            i++
            while (i < tokens.length && tokens[i].type !== 'list_item_close') {
              if (tokens[i].type === 'paragraph_open') {
                const contentToken = tokens[i + 1]
                if (contentToken && contentToken.type === 'inline') {
                  const runs = parseInlineTokens(contentToken.children || [], basePath)
                  elements.push(
                    new Paragraph({
                      children: runs,
                      numbering: { reference: 'default-numbering', level: 0 },
                    })
                  )
                }
                i += 3
              } else {
                i++
              }
            }
          }
          i++
        }
        i++ // ordered_list_close
        break
      }

      // 代码块（包括 ECharts 和 Mermaid）
      case 'fence':
      case 'code_block': {
        const lang = token.info?.trim().toLowerCase() || ''
        const code = token.content

        // ECharts 图表
        if (lang === 'echarts') {
          const chartData = chartImages.find(
            c => c.type === 'echarts' && c.index === echartsIndex
          )
          echartsIndex++

          if (chartData) {
            // 嵌入图表图片
            const imageBuffer = Buffer.from(chartData.base64, 'base64')

            // Word 页面可用宽度约 6.5 英寸（A4 纸，左右边距各 1 英寸）
            // 图表占页面宽度的 85%，即约 5.5 英寸
            const PAGE_WIDTH_INCHES = 6.5
            const CHART_WIDTH_RATIO = 0.85
            const TARGET_WIDTH_INCHES = PAGE_WIDTH_INCHES * CHART_WIDTH_RATIO // 5.525 英寸

            // docx 库的 transformation 单位是 DXA (Twips)
            // 1 英寸 = 914400 EMU，但 transformation 使用的是像素（需要转换）
            // 实际上 docx 库内部会将像素转换为 EMU，假设 96 DPI
            // 为了确保图表足够大，我们直接使用英寸转像素（96 DPI）
            const DPI = 96
            const targetWidthPixels = TARGET_WIDTH_INCHES * DPI // 约 530 像素

            // 计算最终尺寸（保持宽高比）
            const aspectRatio = chartData.height / chartData.width
            const finalWidth = targetWidthPixels
            const finalHeight = finalWidth * aspectRatio

            // 调试日志
            console.log(`[DOCX Export] ECharts #${echartsIndex - 1} 最终尺寸:`, {
              输入宽度: chartData.width,
              输入高度: chartData.height,
              目标宽度像素: finalWidth,
              目标高度像素: finalHeight,
              宽高比: aspectRatio
            })

            elements.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: {
                      width: finalWidth,
                      height: finalHeight,
                    },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 200, after: 200 },
              })
            )
          } else {
            // 回退：显示提示文本
            elements.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: '[ECharts 图表 - 无法渲染]',
                    italics: true,
                    color: '999999',
                  }),
                ],
              })
            )
          }
          i++
          break
        }

        // Mermaid 图表
        if (lang === 'mermaid') {
          const chartData = chartImages.find(
            c => c.type === 'mermaid' && c.index === mermaidIndex
          )
          mermaidIndex++

          if (chartData) {
            // 嵌入图表图片
            const imageBuffer = Buffer.from(chartData.base64, 'base64')

            // Word 页面可用宽度约 6.5 英寸（A4 纸，左右边距各 1 英寸）
            // 图表占页面宽度的 85%，即约 5.5 英寸
            const PAGE_WIDTH_INCHES = 6.5
            const CHART_WIDTH_RATIO = 0.85
            const TARGET_WIDTH_INCHES = PAGE_WIDTH_INCHES * CHART_WIDTH_RATIO // 5.525 英寸

            // docx 库的 transformation 单位是像素（96 DPI）
            const DPI = 96
            const targetWidthPixels = TARGET_WIDTH_INCHES * DPI // 约 530 像素

            // 计算最终尺寸（保持宽高比）
            const aspectRatio = chartData.height / chartData.width
            const finalWidth = targetWidthPixels
            const finalHeight = finalWidth * aspectRatio

            // 调试日志
            console.log(`[DOCX Export] Mermaid #${mermaidIndex - 1} 最终尺寸:`, {
              输入宽度: chartData.width,
              输入高度: chartData.height,
              目标宽度像素: finalWidth,
              目标高度像素: finalHeight,
              宽高比: aspectRatio
            })

            elements.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageBuffer,
                    transformation: {
                      width: finalWidth,
                      height: finalHeight,
                    },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { before: 200, after: 200 },
              })
            )
          } else {
            // 回退：显示提示文本
            elements.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: '[Mermaid 图表 - 无法渲染]',
                    italics: true,
                    color: '999999',
                  }),
                ],
              })
            )
          }
          i++
          break
        }

        // 普通代码块
        const lines = code.split('\n')
        for (const line of lines) {
          elements.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line || ' ',
                  font: 'Consolas',
                  size: 20, // 10pt
                }),
              ],
              shading: { fill: 'f5f5f5' },
            })
          )
        }
        i++
        break
      }

      // 引用块
      case 'blockquote_open': {
        i++
        while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
          if (tokens[i].type === 'paragraph_open') {
            const contentToken = tokens[i + 1]
            if (contentToken && contentToken.type === 'inline') {
              const runs = parseInlineTokens(contentToken.children || [], basePath)
              elements.push(
                new Paragraph({
                  children: runs,
                  indent: { left: 720 }, // 0.5 inch
                  border: {
                    left: { style: BorderStyle.SINGLE, size: 12, color: 'cccccc' },
                  },
                })
              )
            }
            i += 3
          } else {
            i++
          }
        }
        i++ // blockquote_close
        break
      }

      // 表格
      case 'table_open': {
        const rows: TableRow[] = []
        i++

        while (i < tokens.length && tokens[i].type !== 'table_close') {
          if (tokens[i].type === 'thead_open' || tokens[i].type === 'tbody_open') {
            i++
            continue
          }
          if (tokens[i].type === 'thead_close' || tokens[i].type === 'tbody_close') {
            i++
            continue
          }

          if (tokens[i].type === 'tr_open') {
            const cells: TableCell[] = []
            i++

            while (i < tokens.length && tokens[i].type !== 'tr_close') {
              if (tokens[i].type === 'th_open' || tokens[i].type === 'td_open') {
                const isHeader = tokens[i].type === 'th_open'
                i++

                if (tokens[i].type === 'inline') {
                  const runs = parseInlineTokens(tokens[i].children || [], basePath)
                  cells.push(
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: isHeader
                            ? runs.map((r) =>
                                r instanceof TextRun
                                  ? new TextRun({ ...r, bold: true })
                                  : r
                              )
                            : runs,
                        }),
                      ],
                      shading: isHeader ? { fill: 'f0f0f0' } : undefined,
                    })
                  )
                  i++
                }

                // Skip th_close or td_close
                if (tokens[i].type === 'th_close' || tokens[i].type === 'td_close') {
                  i++
                }
              } else {
                i++
              }
            }

            if (cells.length > 0) {
              rows.push(new TableRow({ children: cells }))
            }
            i++ // tr_close
          } else {
            i++
          }
        }

        if (rows.length > 0) {
          elements.push(
            new Table({
              rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          )
        }
        i++ // table_close
        break
      }

      // 水平线
      case 'hr': {
        elements.push(
          new Paragraph({
            children: [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc' },
            },
          })
        )
        i++
        break
      }

      // 图片（在段落内）
      case 'image': {
        // 图片通常在 inline token 中处理
        i++
        break
      }

      default:
        i++
    }
  }

  return elements
}

// 导出 DOCX
export async function exportToDocx(
  markdown: string,
  outputPath: string,
  basePath: string,
  chartImages: ChartImageData[] = []
): Promise<{ filePath: string; warnings: string[] }> {
  const warnings: string[] = []

  // 使用 markdown-it 解析
  const md = new MarkdownIt()
  const tokens = md.parse(markdown, {}) as Token[]

  // 转换为 docx 元素
  const elements = await tokensToDocxElements(tokens, basePath, chartImages)

  // 创建文档
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: elements,
      },
    ],
  })

  // 生成并保存文件
  const buffer = await Packer.toBuffer(doc)
  await fs.writeFile(outputPath, buffer)

  return { filePath: outputPath, warnings }
}
