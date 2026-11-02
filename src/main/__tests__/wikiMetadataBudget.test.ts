import { describe, expect, it } from 'vitest'
import { WorkspaceWikiMetadata, type WikiDocumentMetadata } from '../indexing/wikiMetadata'
import type { IndexedDocument } from '../indexing/types'

function fill(count: number, aliases: string[]) {
  const runtime = new WorkspaceWikiMetadata()
  const documents = new Map<string, IndexedDocument>()
  const metadata: WikiDocumentMetadata = { aliases, complete: true, frontmatterEnd: 0, revisionToken: 'r', links: [] }
  for (let index = 0; index < count; index++) {
    const name = `${index}.md`
    documents.set(name, { relativePath: name, revisionToken: 'r' } as IndexedDocument)
    runtime.set(name, metadata)
  }
  runtime.publish(documents, true)
  return { runtime, documents, metadata }
}

describe('每根 Wiki 元数据预算', () => {
  it('超过十万条引用不伪报完整；删除后重新处理被拒文档可以恢复', () => {
    const { runtime, documents, metadata } = fill(782, Array.from({ length: 128 }, (_, i) => `alias-${i}`))
    expect(runtime.published?.complete).toBe(false)
    expect(runtime.published?.metadata.get('781.md')).toMatchObject({ complete: false, issue: 'budget', aliases: [] })
    runtime.remove('0.md'); documents.delete('0.md')
    runtime.set('781.md', metadata); runtime.publish(documents, true)
    expect(runtime.published?.complete).toBe(true)
  })
  it('低于引用数量上限仍受 UTF-8 文本预算保护', () => {
    const { runtime } = fill(350, Array.from({ length: 128 }, (_, i) => '中'.repeat(250) + String(i)))
    expect(runtime.published?.complete).toBe(false)
    expect([...runtime.published!.metadata.values()].some(item => item.issue === 'budget')).toBe(true)
  })
})
