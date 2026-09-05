import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildDiffResult } from '../cli/diffCommand'
import { getExitCode } from '../cli/result'

let tempDir: string | null = null

async function createPair(before: string, after: string): Promise<[string, string]> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-diff-'))
  const beforePath = path.join(tempDir, 'before.md')
  const afterPath = path.join(tempDir, 'after.md')
  await Promise.all([
    writeFile(beforePath, before, 'utf8'),
    writeFile(afterPath, after, 'utf8'),
  ])
  return [beforePath, afterPath]
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('diffCommand', () => {
  it('忽略换行符与行尾空格差异', async () => {
    const [before, after] = await createPair(
      '# 标题\r\n\r\n正文   \r\n',
      '# 标题\n\n正文\n',
    )

    const result = await buildDiffResult([before, after], { json: true })

    expect(result.ok).toBe(true)
    expect(result.summary.hasChanges).toBe(false)
    expect(result.results).toEqual({ hasChanges: false, changes: [] })
  })

  it('报告 heading、link、paragraph 和 chart 语义变化', async () => {
    const [before, after] = await createPair(
      '# 旧标题\n\n旧正文 [目标](./old.md)\n\n```mermaid\ngraph LR\nA-->B\n```\n',
      '# 新标题\n\n新正文 [目标](./new.md)\n\n```mermaid\ngraph LR\nA-->C\n```\n',
    )

    const result = await buildDiffResult([before, after], { json: true })

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      hasChanges: true,
      heading: 1,
      link: 1,
      paragraph: 1,
      chart: 1,
    })
    expect(result.results.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'changed', category: 'heading' }),
      expect.objectContaining({ type: 'changed', category: 'link' }),
      expect.objectContaining({ type: 'changed', category: 'chart' }),
    ]))
  })

  it('同类别前置插入只报告新增项', async () => {
    const [before, after] = await createPair(
      '# A\n\n段落 A\n\n[链接 A](./a.md)\n\n# B\n\n段落 B\n\n[链接 B](./b.md)\n',
      '# New\n\n新增段落\n\n[新增链接](./new.md)\n\n# A\n\n段落 A\n\n[链接 A](./a.md)\n\n# B\n\n段落 B\n\n[链接 B](./b.md)\n',
    )

    const result = await buildDiffResult([before, after], { json: true })

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      heading: 1,
      paragraph: 2,
      link: 1,
      totalChanges: 4,
    })
    const changes = result.results.changes as Array<{ type: string }>
    expect(changes).toHaveLength(4)
    expect(changes.every(change => change.type === 'added')).toBe(true)
  })

  it('拒绝将 Excalidraw 文件作为 Markdown diff 输入', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-diff-'))
    const before = path.join(tempDir, 'before.excalidraw')
    const after = path.join(tempDir, 'after.md')
    await Promise.all([
      writeFile(before, '{"type":"excalidraw"}', 'utf8'),
      writeFile(after, '# After\n', 'utf8'),
    ])

    const result = await buildDiffResult([before, after], {})

    expect(result.ok).toBe(false)
    expect(result.code).toBe('INPUT_NOT_ALLOWED')
    expect(result.message).toContain('仅支持 Markdown')
    expect(getExitCode(result)).toBe(2)
  })

  it('--fail-on-change 使用稳定非零退出码', async () => {
    const [before, after] = await createPair('# A\n', '# B\n')
    const result = await buildDiffResult([before, after], { 'fail-on-change': true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DIFF_FOUND')
    expect(getExitCode(result)).toBe(4)
  })

  it('参数不足时返回 INVALID_ARGUMENT', async () => {
    const result = await buildDiffResult(['one.md'], {})
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_ARGUMENT')
    expect(getExitCode(result)).toBe(2)
  })
})
