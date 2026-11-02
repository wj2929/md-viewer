import { mkdir, mkdtemp, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'fs/promises'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import { LinkRewritePlanner } from '../linking/LinkRewritePlanner'
import { moveSameRootPath } from '../linking/sameRootMove'
import type { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(contents: Record<string, string> = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const directory = await mkdtemp(join(process.cwd(), '.tmp/batch-move-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'workspace')
  await mkdir(join(root, 'archive'), { recursive: true })
  for (const [name, text] of Object.entries({ 'a.md': '# A', 'b.md': '# B', 'c.md': '# C', ...contents })) {
    await mkdir(join(root, name, '..'), { recursive: true })
    await writeFile(join(root, name), text)
  }
  let token = 'healthy'
  const watcher = { getIndexCoverage: () => ({ token, complete: true }), attachIndexConsumer() {}, detachIndexConsumer() {} } as unknown as WorkspaceWatchService
  const service = new WorkspaceIndexService(new WorkspaceIndexStore(join(directory, 'cache')), watcher)
  await service.attach(root, 'test')
  await service.waitUntilIdle(root)
  cleanups.push(() => service.detach(root, 'test'))
  const planner = new LinkRewritePlanner(service)
  const prepare = async (names = ['a', 'b', 'c'], ownerId = 'owner') => Promise.all(names.map(async name => {
    const mapping = { oldRelativePath: name + '.md', newRelativePath: 'archive/' + name + '.md' }
    const impact = await planner.createImpact(ownerId, root, mapping)
    return { impactId: impact.impactId, mapping }
  }))
  const assertAuthorized = vi.fn()
  const execute = vi.fn(async (mapping, assertCurrent) => {
    const moved = await moveSameRootPath({ sourcePath: join(root, mapping.oldRelativePath), destinationPath: join(root, mapping.newRelativePath), beforeMove: assertCurrent })
    return { newPath: moved.destinationPath, isDirectory: moved.isDirectory }
  })
  const run = (operations: Parameters<LinkRewritePlanner['executeBatch']>[0]['operations'], extra: Partial<Parameters<LinkRewritePlanner['executeBatch']>[0]> = {}) => planner.executeBatch({ ownerId: 'owner', rootPath: root, operations,
    validate: async () => {}, assertAuthorized, execute, ...extra })
  return { root, service, planner, prepare, execute, run, assertAuthorized, changeCoverage: () => { token += '-gap' } }
}

describe('LinkRewritePlanner same-root batch', () => {
  it('三个独立移动均成功，回执不重复，重放被拒绝', async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations)
    expect(result.items.map(item => item.status)).toEqual(['success', 'success', 'success'])
    expect(new Set(result.items.map(item => item.receipt?.operationReceiptId)).size).toBe(3)
    await expect(f.run(operations)).rejects.toThrow('预览无效')
    expect(f.execute).toHaveBeenCalledTimes(3)
  })
  for (const conflict of ['a', 'b']) it(`目标冲突在${conflict}项时继续其余独立项，不签发失败回执`, async () => {
    const f = await setup({ [`archive/${conflict}.md`]: '# Existing' }), operations = await f.prepare()
    const result = await f.run(operations)
    expect(result.items.map(item => item.status)).toEqual(conflict === 'a' ? ['failed', 'success', 'success'] : ['success', 'failed', 'success'])
    const failed = result.items.find(item => item.status === 'failed')!
    expect(failed.message).toContain('目标文件已存在')
    expect(failed.receipt).toBeUndefined()
    expect(await readFile(join(f.root, 'archive', conflict + '.md'), 'utf8')).toBe('# Existing')
  })
  it('开始前快照已过期时整批拒绝，零次写入', async () => {
    const f = await setup(), operations = await f.prepare()
    await writeFile(join(f.root, 'c.md'), '# External')
    await f.service.refreshRelativePaths(f.root, ['c.md'])
    await expect(f.run(operations)).rejects.toThrow('索引已变化')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('批中外部修改停止剩余项，不丢首项成功', async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations, { afterMove: async () => {
      await writeFile(join(f.root, 'c.md'), '# External')
      await f.service.refreshRelativePaths(f.root, ['c.md'])
    } })
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
    expect(result.items[0].receipt).toBeDefined()
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('移动后刷新失败仍报告成功，只阻止后续移动', async () => {
    const f = await setup(), operations = await f.prepare()
    vi.spyOn(f.service, 'refreshMovedRelativePaths').mockRejectedValueOnce(new Error('injected refresh failure'))
    const result = await f.run(operations)
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
    expect(result.warning).toContain('索引')
    expect(result.items[0].receipt).toBeDefined()
    expect(await readFile(join(f.root, 'archive/a.md'), 'utf8')).toBe('# A')
  })
  for (const kind of ['coverage', 'rebuild', 'authorization']) it(`${kind}变化不能由自身移动接续绕过`, async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations, { afterMove: async () => {
      if (kind === 'coverage') f.changeCoverage()
      if (kind === 'rebuild') await f.service.rebuild(f.root)
      if (kind === 'authorization') f.assertAuthorized.mockImplementation(() => { throw new Error('workspace revoked') })
    } })
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
  })
  it('原本相互依赖的相对链接不静默重算后继续', async () => {
    const f = await setup({ 'a.md': '# A\n\n[B](./b.md)' }), operations = await f.prepare()
    const result = await f.run(operations)
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
    expect(result.warning).toContain('重新预览')
  })
  it('索引外新增同名文件不能被误当作可接续的纯alias', async () => {
    const f = await setup({ 'b.md': '---\naliases: Guide\n---\n# B', 'ref.md': '[[Guide]]', 'vendor/keep.md': '# ignored' }), operations = await f.prepare()
    const result = await f.run(operations, { afterMove: async () => { await writeFile(join(f.root, 'vendor/Guide.md'), '# Shadow') } })
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
  })
  it('重复、错误owner、篡改mapping在首次写入前拒绝', async () => {
    const f = await setup(), operations = await f.prepare()
    await expect(f.run([operations[0], operations[0]])).rejects.toThrow('重复')
    await expect(f.run(operations, { ownerId: 'other' })).rejects.toThrow('预览无效')
    await expect(f.run([{ ...operations[0], mapping: { ...operations[0].mapping, newRelativePath: 'other.md' } }])).rejects.toThrow('预览无效')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('全批预留阻止单项和另一批消费同一根，结束后释放', async () => {
    const f = await setup(), operations = await f.prepare(), others = await f.prepare()
    let release!: () => void
    let entered!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const running = f.run(operations, { validate: async () => { entered(); await barrier } })
    await started
    await expect(f.run(others)).rejects.toThrow('正在执行')
    await expect(f.planner.executeOperation({ ownerId: 'owner', rootPath: f.root, impactId: operations[1].impactId, actualMapping: operations[1].mapping, execute: vi.fn() })).rejects.toThrow('正在执行')
    release()
    expect((await running).items.every(item => item.status === 'success')).toBe(true)
    const next = await f.planner.createImpact('owner', f.root, { oldRelativePath: 'archive/a.md', newRelativePath: 'a.md' })
    await expect(f.planner.executeOperation({ ownerId: 'owner', rootPath: f.root, impactId: next.impactId, actualMapping: next.mapping,
      execute: () => rename(join(f.root, 'archive/a.md'), join(f.root, 'a.md')) })).resolves.toHaveProperty('receipt')
  })
  it('相同正文的新inode不能接续原选中文件身份', async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations, { afterMove: async () => {
      await rename(join(f.root, 'b.md'), join(f.root, 'old-b.txt'))
      await writeFile(join(f.root, 'b.md'), '# B')
      await f.service.refreshRelativePaths(f.root, ['b.md'])
    } })
    expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('迟到的自身重复变更只重新对齐，不重复移动', async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations, { afterMove: async mapping => {
      await f.service.refreshRelativePaths(f.root, [mapping.newRelativePath])
    } })
    expect(result.items.map(item => item.status)).toEqual(['success', 'success', 'success'])
    expect(f.execute).toHaveBeenCalledTimes(3)
  })
  it('拒绝重叠映射及过期计划，校验失败释放批次预留', async () => {
    const f = await setup(), operations = await f.prepare()
    const nested = await f.planner.createImpact('owner', f.root, { oldRelativePath: 'a.md/child.md', newRelativePath: 'elsewhere.md' })
    await expect(f.run([operations[0], { impactId: nested.impactId, mapping: nested.mapping }])).rejects.toThrow('重叠')
    await expect(f.run(operations, { validate: async () => { throw new Error('invalid authorization') } })).rejects.toThrow('invalid authorization')
    expect((await f.run(operations)).items.every(item => item.status === 'success')).toBe(true)
  })
  it('移动调用中超过TTL仍保留成功回执，剩余项不延长寿命', async () => {
    const f = await setup(), operations = await f.prepare()
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const result = await f.run(operations, { execute: async (mapping, assertCurrent) => {
        const moved = await f.execute(mapping, assertCurrent)
        clock.mockReturnValue(now + 301_000)
        return moved
      } })
      expect(result.items.map(item => item.status)).toEqual(['success', 'not-executed', 'not-executed'])
      expect(result.items[0].receipt).toBeDefined()
      expect(await readFile(join(f.root, 'archive/a.md'), 'utf8')).toBe('# A')
    } finally { clock.mockRestore() }
  })
  it('单项实际成功后过期不误报失败，原快照保护仍在写入前执行', async () => {
    const f = await setup(), [operation] = await f.prepare(['a'])
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const result = await f.planner.executeOperation({ ownerId: 'owner', rootPath: f.root, impactId: operation.impactId, actualMapping: operation.mapping,
        execute: async () => { clock.mockReturnValue(now + 301_000); return rename(join(f.root, 'a.md'), join(f.root, 'archive/a.md')) } })
      expect(result.receipt.impactId).toBe(operation.impactId)
    } finally { clock.mockRestore() }
  })

  it('执行前异步校验期间权限撤销不写入', async () => {
    const f = await setup(), operations = await f.prepare()
    const result = await f.run(operations, { execute: async (mapping, assertCurrent) => {
      f.assertAuthorized.mockImplementation(() => { throw new Error('workspace revoked') })
      await assertCurrent()
      throw new Error('must not reach mutation')
    } })
    expect(result.items.every(item => item.status === 'not-executed')).toBe(true)
    expect(await readFile(join(f.root, 'a.md'), 'utf8')).toBe('# A')
  })
})
