import { describe, expect, it } from 'vitest'
import { analyzeMarkdownSource } from '../../shared/markdown/analyze'
import { createCrossRootMoveImpactReport } from '../linking/CrossRootLinkImpactPlanner'
import type { IndexedDocument } from '../indexing/types'

function document(relativePath: string, source: string): IndexedDocument {
  const analysis = analyzeMarkdownSource(source)
  return {
    schemaVersion: 1, rootKey: '', indexInstanceId: '', relativePath,
    revisionToken: 'revision', mtimeMs: 0, size: source.length, indexedAt: 0,
    headings: analysis.headings, outboundLinks: analysis.links, terms: analysis.terms, lineCount: analysis.lineCount,
  }
}

describe('CrossRootLinkImpactPlanner', () => {
  it('统计 origin 断链、moved 出链变化和 target 新解析，且只返回报告', () => {
    const report = createCrossRootMoveImpactReport({
      originDocuments: [
        document('index.md', '[移动文档](./docs/a.md)'),
        document('docs/a.md', '[原根配置](../config.md)\n[同批](./b.md)'),
        document('docs/b.md', '# B'),
        document('config.md', '# Origin config'),
      ],
      targetDocuments: [
        document('index.md', '[即将到达](./imports/a.md)'),
        document('config.md', '# Target config'),
      ],
      mappings: [{ sourceRelativePath: 'docs', destinationRelativePath: 'imports', isDirectory: true }],
    })

    expect(report.reportOnly).toBe(true)
    expect(report.origin.linksBreakingAfterMove).toBe(1)
    expect(report.moved.linksChangingResolution).toBe(1)
    expect(report.moved.linksBreakingAfterMove).toBe(0)
    expect(report.target.linksResolvingAfterMove).toBe(1)
    expect(report).not.toHaveProperty('planId')
    expect(report).not.toHaveProperty('changes')
  })

  it('query、fragment 不影响目标路径并忽略外链和纯锚点', () => {
    const report = createCrossRootMoveImpactReport({
      originDocuments: [
        document('index.md', '[目标](./a.md?mode=full#标题)\n[外链](https://example.com)\n[锚点](#本页)'),
        document('a.md', '# A'),
      ],
      targetDocuments: [],
      mappings: [{ sourceRelativePath: 'a.md', destinationRelativePath: 'a.md', isDirectory: false }],
    })

    expect(report.origin.linksBreakingAfterMove).toBe(1)
    expect(report.coverage.ignoredLinks).toBe(2)
  })
})
