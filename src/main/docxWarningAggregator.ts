/**
 * DOCX 导出字体替代警告聚合。
 *
 * docx-service 对每个未检测到的字体各推一条警告（main.py:242），
 * 一个中文公文文档常引用「方正小标宋简体 / 仿宋_GB2312 / 楷体_GB2312」等多种字体，
 * 于是导出提示里堆出 N 条几乎一字不差的「未检测到 X，已使用 Noto Sans CJK SC 近似替代」，
 * 加上一条讲环境变量的长警告，面板又吵又长。
 *
 * 这里在客户端把「逐字体近似替代」这类同源警告合并成一条，
 * 不改独立的 docx-service 仓库。其它警告原样保留。
 */

// 匹配 docx-service main.py:242 的逐字体近似替代文案：
// 「未检测到 {font}，已使用 {fallback} 近似替代，实际显示取决于 Word/WPS 字体环境」
const FONT_SUBSTITUTION_PATTERN = /^未检测到\s*(.+?)，已使用\s*(.+?)\s*近似替代，实际显示取决于/

export function aggregateDocxWarnings(warnings: string[]): string[] {
  const substituted: { font: string; fallback: string }[] = []
  const rest: string[] = []

  for (const warning of warnings) {
    const match = typeof warning === 'string' ? warning.match(FONT_SUBSTITUTION_PATTERN) : null
    if (match) {
      substituted.push({ font: match[1].trim(), fallback: match[2].trim() })
    } else {
      rest.push(warning)
    }
  }

  if (substituted.length === 0) return warnings
  if (substituted.length === 1) {
    // 只有一条时不必聚合，保留原文案（信息量与一行等价）
    const only = substituted[0]
    return [
      `未检测到 ${only.font}，已使用 ${only.fallback} 近似替代，实际显示取决于 Word/WPS 字体环境`,
      ...rest,
    ]
  }

  const fonts = substituted.map(s => s.font).join('、')
  // 多个字体通常回退到同一个 fallback；若不同则列出去重后的集合
  const fallbacks = [...new Set(substituted.map(s => s.fallback))].join('、')
  const merged = `未检测到 ${substituted.length} 种字体（${fonts}），已用 ${fallbacks} 近似替代，实际显示取决于 Word/WPS 字体环境`

  return [merged, ...rest]
}
