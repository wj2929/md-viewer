import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWikiDocumentMetadata, WorkspaceWikiMetadata, type WorkspaceWikiSnapshot } from '../indexing/wikiMetadata'

const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })
async function vault(files: Record<string, string>): Promise<WorkspaceWikiSnapshot> {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const rootPath = await mkdtemp(join(process.cwd(), '.tmp', 'wiki-cross-root-'))
  fixtures.push(rootPath)
  const documents = new Map<string, IndexedDocument>()
  const metadata = new WorkspaceWikiMetadata()
  for (const [name, source] of Object.entries(files)) {
    const file = join(rootPath, name)
    await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, source)
    const item = document(name, source)
    documents.set(name, item)
    metadata.set(name, createWikiDocumentMetadata(source, item.revisionToken, item.outboundLinks))
  }
  metadata.publish(documents, true)
  return { ...metadata.published!, rootPath, epoch: 1, ready: true, isCurrent: () => true, isContinuous: () => true }
}
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
  it('跨根移动带走 alias 声明，保留同批实体并正确报告原根断链和目标根新解析', async () => {
    const originWiki = await vault({ 'index.md': '[[Guide]]', 'docs/a.md': '[[Guide]]', 'docs/b.md': '---\naliases: Guide\n---' })
    const targetWiki = await vault({ 'index.md': '[[Guide]]' })
    const input = { originWiki, targetWiki, originRoot: originWiki.rootPath, targetRoot: targetWiki.rootPath,
      originDocuments: [...originWiki.documents.values()], targetDocuments: [...targetWiki.documents.values()],
      mappings: [{ sourceRelativePath: 'docs', destinationRelativePath: 'imports', isDirectory: true }] }
    const report = await createCrossRootMoveImpactReport(input)
    expect(report.origin.linksBreakingAfterMove).toBe(1)
    expect(report.moved.linksBreakingAfterMove).toBe(0)
    expect(report.target.linksResolvingAfterMove).toBe(1)
    expect(report.coverage.uncertainLinks).toBe(0)
    targetWiki.ready = false
    const partial = await createCrossRootMoveImpactReport(input)
    expect(partial.origin.linksBreakingAfterMove).toBe(0)
    expect(partial.coverage.uncertainLinks).toBeGreaterThan(0)
  })
  it('alias 冲突或文件名遮蔽变化只能算 uncertain，不能把 null 算作确定断链', async () => {
    const originWiki = await vault({ 'index.md': '[[Guide]]', 'docs/a.md': '---\naliases: Guide\n---' })
    const targetWiki = await vault({ 'index.md': '[[Guide]]', 'existing.md': '---\naliases: Guide\n---' })
    const report = await createCrossRootMoveImpactReport({ originWiki, targetWiki,
      originRoot: originWiki.rootPath, targetRoot: targetWiki.rootPath,
      originDocuments: [...originWiki.documents.values()], targetDocuments: [...targetWiki.documents.values()],
      mappings: [{ sourceRelativePath: 'docs/a.md', destinationRelativePath: 'a.md', isDirectory: false }] })
    expect(report.origin.linksBreakingAfterMove).toBe(1)
    expect(report.target.linksBreakingAfterMove).toBe(0)
    expect(report.target.linksChangingResolution).toBe(0)
    expect(report.coverage.uncertainLinks).toBe(1)
  })
  it('统计 origin 断链、moved 出链变化和 target 新解析，且只返回报告', async () => {
    const report = await createCrossRootMoveImpactReport({
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

  it('按各自 vault 语义评估 Wiki 链接的跨根解析变化', async () => {
    const report = await createCrossRootMoveImpactReport({
      originDocuments: [
        document('index.md', '[[docs/a#标题|移动文档]]'),
        document('docs/a.md', '[[config|配置]]'),
        document('config.md', '# Origin config'),
      ],
      targetDocuments: [
        document('index.md', '[[imports/a|即将到达]]'),
        document('config.md', '# Target config'),
      ],
      mappings: [{ sourceRelativePath: 'docs', destinationRelativePath: 'imports', isDirectory: true }],
    })

    expect(report.origin.linksBreakingAfterMove).toBe(1)
    expect(report.moved.linksChangingResolution).toBe(1)
    expect(report.target.linksResolvingAfterMove).toBe(1)
    expect(report.coverage.uncertainLinks).toBe(0)
  })

  it('query、fragment 不影响目标路径并忽略外链和纯锚点', async () => {
    const report = await createCrossRootMoveImpactReport({
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
