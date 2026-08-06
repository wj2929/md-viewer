import { describe, expect, it } from 'vitest'
import { aggregateDocxWarnings } from '../docxWarningAggregator'

const sub = (font: string, fallback = 'Noto Sans CJK SC') =>
  `未检测到 ${font}，已使用 ${fallback} 近似替代，实际显示取决于 Word/WPS 字体环境`

describe('aggregateDocxWarnings', () => {
  it('多条同源字体替代合并为一条', () => {
    const result = aggregateDocxWarnings([
      sub('方正小标宋简体'),
      sub('仿宋_GB2312'),
      sub('楷体_GB2312'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('未检测到 3 种字体')
    expect(result[0]).toContain('方正小标宋简体、仿宋_GB2312、楷体_GB2312')
    expect(result[0]).toContain('Noto Sans CJK SC')
  })

  it('单条字体替代保持原样，不做无意义聚合', () => {
    const input = [sub('方正小标宋简体')]
    expect(aggregateDocxWarnings(input)).toEqual(input)
  })

  it('非字体警告原样保留，且顺序在合并项之后', () => {
    const other = '文件已生成，字体未嵌入；如需固定字体请在服务端挂载授权字体'
    const result = aggregateDocxWarnings([
      sub('方正小标宋简体'),
      sub('仿宋_GB2312'),
      other,
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('未检测到 2 种字体')
    expect(result[1]).toBe(other)
  })

  it('回退字体不同时列出去重集合', () => {
    const result = aggregateDocxWarnings([
      sub('方正小标宋简体', 'Noto Sans CJK SC'),
      sub('Times New Roman', 'DejaVu Serif'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('Noto Sans CJK SC、DejaVu Serif')
  })

  it('无字体警告时原样返回', () => {
    const input = ['3 个图表未能渲染，已用占位符替代']
    expect(aggregateDocxWarnings(input)).toEqual(input)
  })

  it('空数组返回空', () => {
    expect(aggregateDocxWarnings([])).toEqual([])
  })
})
