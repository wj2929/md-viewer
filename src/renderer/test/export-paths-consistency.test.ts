// @ts-nocheck
/**
 * 回归保障：两条 HTML 导出路径必须共享同一个 buildExportHtmlContent
 *
 * 历史复发的根本原因是两条路径独立维护。2026-04 决定合并：
 * - useExport.ts 的 handleExportHTML / handleExportPDF 走 buildExportHtmlContent
 * - useIPC.ts 的 onFileExportRequest 也走 buildExportHtmlContent
 *
 * 不变式：
 * - 两个文件都从 utils/exportHtml 导入 buildExportHtmlContent
 * - 两个文件里不应出现对具体 processXxxInHtml 的直接调用（全部进 buildExportHtmlContent 统一处理）
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const readFile = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8')

describe('导出路径统一化', () => {
  it('useExport.ts 和 useIPC.ts 都使用 buildExportHtmlContent', () => {
    const useExportSrc = readFile('src/hooks/useExport.ts')
    const useIPCSrc = readFile('src/hooks/useIPC.ts')

    expect(useExportSrc.includes('buildExportHtmlContent'), 'useExport.ts 应该调用 buildExportHtmlContent').toBe(true)
    expect(useIPCSrc.includes('buildExportHtmlContent'), 'useIPC.ts 应该调用 buildExportHtmlContent').toBe(true)
  })

  it('两个 hook 不应直接调用 processXxxInHtml（都要经 buildExportHtmlContent）', () => {
    const PROCESS_FN_RE = /await\s+process(\w+)InHtml\(/g
    for (const rel of ['src/hooks/useExport.ts', 'src/hooks/useIPC.ts']) {
      const src = readFile(rel)
      const m = src.match(PROCESS_FN_RE)
      expect(
        m,
        `${rel} 不应直接调用 processXxxInHtml（应全部走 buildExportHtmlContent），实际出现：${m}`
      ).toBeNull()
    }
  })

  it('buildExportHtmlContent 覆盖至少 6 种图表类型', () => {
    const src = readFile('src/utils/exportHtml.ts')
    const PROCESS_FN_RE = /process(\w+)InHtml/g
    const names = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = PROCESS_FN_RE.exec(src)) !== null) names.add(m[1])
    expect(
      names.size,
      `exportHtml.ts 应至少处理 6 种图表类型，实际：${[...names].join(', ')}`
    ).toBeGreaterThanOrEqual(6)
  })
})
