import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { WorkspaceIndexStore } from '../indexing/WorkspaceIndexStore'
import { LinkRewritePlanner } from '../linking/LinkRewritePlanner'
import type { WorkspaceWatchService } from '../watching/WorkspaceWatchService'

let tempDir: string | null = null

const watcher = {
  attachIndexConsumer: () => {},
  detachIndexConsumer: () => {},
} as unknown as WorkspaceWatchService

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

async function setup(): Promise<{
  root: string
  service: WorkspaceIndexService
  planner: LinkRewritePlanner
}> {
  tempDir = await mkdtemp(join(tmpdir(), 'mdv-link-rewrite-'))
  const root = join(tempDir, 'workspace')
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, 'archive'), { recursive: true })
  await writeFile(join(root, 'index.md'), '# 首页\n\n参见 [设计](./docs/design.md?mode=full#安全边界)。')
  await writeFile(join(root, 'docs', 'design.md'), '# 设计\n\n参见 [指南](./guide.md)。\n\n## 安全边界')
  await writeFile(join(root, 'docs', 'guide.md'), '# 指南')
  const service = new WorkspaceIndexService(new WorkspaceIndexStore(join(tempDir, 'index')), watcher)
  await service.attach(root, 'test')
  await service.waitUntilIdle(root)
  return { root: await realpath(root), service, planner: new LinkRewritePlanner(service) }
}

describe('LinkRewritePlanner', () => {
  it('预览并修复 same-root move 的入链与移动文档出链', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)
    expect(impact).toMatchObject({ affectedSourceFiles: 2, exactChanges: 2, candidates: 0 })

    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshRelativePaths(root, ['archive/design.md'])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRelativePath: 'index.md', before: './docs/design.md?mode=full#安全边界', after: './archive/design.md?mode=full#安全边界' }),
      expect.objectContaining({ sourceRelativePath: 'archive/design.md', before: './guide.md', after: '../docs/guide.md' }),
    ]))

    const result = await planner.apply({
      ownerId: 'window:1',
      rootPath: root,
      planId: plan.planId,
      operationReceiptId: plan.operationReceiptId,
      selectedChangeIds: plan.changes.map(change => change.changeId),
      confirm: true,
    })
    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'updated' }),
      expect.objectContaining({ sourceRelativePath: 'archive/design.md', status: 'updated' }),
    ]))
    expect(await readFile(join(root, 'index.md'), 'utf8')).toContain('./archive/design.md?mode=full#安全边界')
    expect(await readFile(join(root, 'archive', 'design.md'), 'utf8')).toContain('../docs/guide.md')
  })

  it('目录 move 会映射目录下文档及其入链', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs', newRelativePath: 'archive/docs' }
    const impact = planner.createImpact('window:1', root, mapping)
    expect(impact.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRelativePath: 'index.md', resolvedTargetRelativePath: 'archive/docs/design.md' }),
      expect.objectContaining({ sourceRelativePath: 'archive/docs/design.md', resolvedTargetRelativePath: 'archive/docs/guide.md' }),
    ]))
    expect(impact.exactChanges).toBe(2)
  })

  it('apply 前 revision 改变时逐文件报冲突且不覆盖', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshRelativePaths(root, ['archive/design.md'])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'rename',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    await writeFile(join(root, 'index.md'), '# 用户的新内容')

    const indexChange = plan.changes.find(change => change.sourceRelativePath === 'index.md')!
    const result = await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId,
      selectedChangeIds: [indexChange.changeId], confirm: true,
    })
    expect(result.files).toEqual([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'conflict', updatedChanges: 0 }),
    ])
    expect(await readFile(join(root, 'index.md'), 'utf8')).toBe('# 用户的新内容')
  })

  it('物理操作失败不签发回执，impact 可重试且并发执行被拒绝', async () => {
    const { root, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)

    await expect(planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => { throw new Error('物理移动失败') },
    })).rejects.toThrow('物理移动失败')

    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const first = planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => { await barrier; return 'moved' },
    })
    await expect(planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => 'duplicate',
    })).rejects.toThrow('正在执行')
    release()
    const executed = await first
    expect(executed).toMatchObject({ result: 'moved', receipt: { impactId: impact.impactId } })
    await expect(planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => 'replay',
    })).rejects.toThrow('影响预览无效')
  })

  it('批量计划会按来源文件合并 edits，避免多次 revision 校验冲突', async () => {
    const { root, service, planner } = await setup()
    await writeFile(join(root, 'index.md'), '# 首页\n\n[设计](./docs/design.md) 与 [指南](./docs/guide.md)')
    await service.refreshRelativePaths(root, ['index.md'])
    const mappings = [
      { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' },
      { oldRelativePath: 'docs/guide.md', newRelativePath: 'archive/guide.md' },
    ]
    const plans = []
    for (const mapping of mappings) {
      const impact = planner.createImpact('window:1', root, mapping)
      const execution = await planner.executeOperation({
        ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
        execute: async () => {
          await rename(join(root, mapping.oldRelativePath), join(root, mapping.newRelativePath))
          return true
        },
      })
      await service.refreshMovedRelativePaths(root, [mapping])
      plans.push(await planner.createRepairPlan({
        ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
        operationReceiptId: execution.receipt.operationReceiptId,
      }))
    }

    const result = await planner.applyBatch({
      ownerId: 'window:1',
      rootPath: root,
      plans: plans.map(plan => ({
        planId: plan.planId,
        operationReceiptId: plan.operationReceiptId,
        selectedChangeIds: plan.changes.map(change => change.changeId),
      })),
      confirm: true,
    })
    expect(result.files).toEqual([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'updated', updatedChanges: 2 }),
    ])
    expect(await readFile(join(root, 'index.md'), 'utf8')).toContain('[设计](./archive/design.md) 与 [指南](./archive/guide.md)')
  })

  it('revision 冲突后可重新生成预览且不复用旧 plan', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    await writeFile(join(root, 'index.md'), '# 用户补充\n\n参见 [设计](./docs/design.md?mode=full#安全边界)。')
    await service.refreshRelativePaths(root, ['index.md'])
    const change = plan.changes.find(item => item.sourceRelativePath === 'index.md')!
    const applied = await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId, selectedChangeIds: [change.changeId], confirm: true,
    })
    expect(applied.files[0].status).toBe('conflict')

    const regenerated = await planner.regeneratePlan({ ownerId: 'window:1', rootPath: root, planId: plan.planId })
    expect(regenerated.planId).not.toBe(plan.planId)
    expect(regenerated.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRelativePath: 'index.md', before: './docs/design.md?mode=full#安全边界' }),
    ]))
    expect(() => planner.discard('window:1', plan.planId)).toThrow('计划无效')
  })

  it('capability TTL 到期后 impact、receipt、plan 均不可继续使用', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    try {
      const { root, planner } = await setup()
      const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
      const expiredImpact = planner.createImpact('window:1', root, mapping)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      await expect(planner.executeOperation({
        ownerId: 'window:1', rootPath: root, impactId: expiredImpact.impactId, actualMapping: mapping,
        execute: async () => true,
      })).rejects.toThrow('影响预览无效')

      vi.setSystemTime(new Date('2026-08-23T01:00:00Z'))
      const impact = planner.createImpact('window:1', root, mapping)
      const execution = await planner.executeOperation({
        ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
        execute: async () => {
          await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
          return true
        },
      })
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      await expect(planner.createRepairPlan({
        ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
        operationReceiptId: execution.receipt.operationReceiptId,
      })).rejects.toThrow('回执无效')
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一源路径的新 plan 会使旧 plan 失效', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const create = async () => {
      const impact = planner.createImpact('window:1', root, mapping)
      return planner.executeOperation({
        ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
        execute: async () => true,
      })
    }
    const firstReceipt = await create()
    await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
    await service.refreshMovedRelativePaths(root, [mapping])
    const first = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: firstReceipt.receipt.operationReceiptId,
    })
    const secondReceipt = await create()
    const second = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: secondReceipt.receipt.operationReceiptId,
    })
    expect(second.planId).not.toBe(first.planId)
    expect(() => planner.discard('window:1', first.planId)).toThrow('计划无效')
  })

  it('apply 保留 UTF-8 BOM、CRLF 和文件 mode', async () => {
    const { root, service, planner } = await setup()
    const sourcePath = join(root, 'index.md')
    const original = Buffer.from('﻿# 首页\r\n\r\n参见 [设计](./docs/design.md)。\r\n', 'utf8')
    await writeFile(sourcePath, original)
    await chmod(sourcePath, 0o640)
    await service.refreshRelativePaths(root, ['index.md'])
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId, operationReceiptId: plan.operationReceiptId,
      selectedChangeIds: plan.changes.map(change => change.changeId), confirm: true,
    })
    const bytes = await readFile(sourcePath)
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(bytes.toString('utf8')).toContain('\r\n\r\n')
    expect(bytes.toString('utf8')).toContain('./archive/design.md')
    if (process.platform !== 'win32') {
      expect((await stat(sourcePath)).mode & 0o777).toBe(0o640)
    }
  })

  it('apply 写入前路径被替换时拒绝覆盖新目标', async () => {
    const { root, service } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const indexPath = join(root, 'index.md')
    const parkedPath = join(root, 'index-original.md')
    const planner = new LinkRewritePlanner(service, {
      beforeAtomicReplace: async ({ filePath }) => {
        if (filePath !== indexPath) return
        await rename(indexPath, parkedPath)
        await writeFile(indexPath, '# 攻击者替换的新文件')
      },
    })
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    const change = plan.changes.find(item => item.sourceRelativePath === 'index.md')!

    const result = await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId, selectedChangeIds: [change.changeId], confirm: true,
    })
    expect(result.files).toEqual([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'conflict', updatedChanges: 0 }),
    ])
    expect(await readFile(indexPath, 'utf8')).toBe('# 攻击者替换的新文件')
  })

  it('Windows rename 不能直接覆盖时使用同目录备份替换并清理备份', async () => {
    const { root, service } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const indexPath = join(root, 'index.md')
    const replaceFile = vi.fn(async (sourcePath: string, destinationPath: string) => {
      if (destinationPath === indexPath && sourcePath.endsWith('.tmp') && replaceFile.mock.calls.length === 1) {
        const error = new Error('Windows destination exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      await rename(sourcePath, destinationPath)
    })
    const planner = new LinkRewritePlanner(service, { platform: 'win32', replaceFile })
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    const change = plan.changes.find(item => item.sourceRelativePath === 'index.md')!

    const result = await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId, selectedChangeIds: [change.changeId], confirm: true,
    })
    expect(result.files).toEqual([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'updated', updatedChanges: 1 }),
    ])
    expect(await readFile(indexPath, 'utf8')).toContain('./archive/design.md')
    const names = await (await import('fs/promises')).readdir(root)
    expect(names.filter(name => name.startsWith('.index.md.') && /\.(?:tmp|bak)$/.test(name))).toEqual([])
  })

  it('临时文件写完后目标被替换仍拒绝覆盖并清理临时文件', async () => {
    const { root, service } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const indexPath = join(root, 'index.md')
    const parkedPath = join(root, 'index-before-commit.md')
    const planner = new LinkRewritePlanner(service, {
      beforeCommitReplace: async ({ filePath }) => {
        if (filePath !== indexPath) return
        await rename(indexPath, parkedPath)
        await writeFile(indexPath, '# 提交前替换的新文件')
      },
    })
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    const change = plan.changes.find(item => item.sourceRelativePath === 'index.md')!

    const result = await planner.apply({
      ownerId: 'window:1', rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId, selectedChangeIds: [change.changeId], confirm: true,
    })
    expect(result.files).toEqual([
      expect.objectContaining({ sourceRelativePath: 'index.md', status: 'failed', updatedChanges: 0 }),
    ])
    expect(await readFile(indexPath, 'utf8')).toBe('# 提交前替换的新文件')
    await expect((await import('fs/promises')).readdir(root).then(names =>
      names.filter(name => name.startsWith('.index.md.') && name.endsWith('.tmp'))
    )).resolves.toEqual([])
  })

  it('cleanupOwner 会撤销该 lifecycle 的 impact、receipt 和 plan', async () => {
    const { root, service, planner } = await setup()
    const owner = 'window:workspace:1'
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }

    const impactOnly = planner.createImpact(owner, root, mapping)
    planner.cleanupOwner(owner)
    await expect(planner.executeOperation({
      ownerId: owner, rootPath: root, impactId: impactOnly.impactId, actualMapping: mapping,
      execute: async () => true,
    })).rejects.toThrow('影响预览无效')

    const impactForReceipt = planner.createImpact(owner, root, mapping)
    const receipt = await planner.executeOperation({
      ownerId: owner, rootPath: root, impactId: impactForReceipt.impactId, actualMapping: mapping,
      execute: async () => true,
    })
    planner.cleanupOwner(owner)
    await expect(planner.createRepairPlan({
      ownerId: owner, rootPath: root, mapping, reason: 'move',
      operationReceiptId: receipt.receipt.operationReceiptId,
    })).rejects.toThrow('回执无效')

    const impactForPlan = planner.createImpact(owner, root, mapping)
    const execution = await planner.executeOperation({
      ownerId: owner, rootPath: root, impactId: impactForPlan.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshMovedRelativePaths(root, [mapping])
    const plan = await planner.createRepairPlan({
      ownerId: owner, rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })
    planner.cleanupOwner(owner)
    await expect(planner.apply({
      ownerId: owner, rootPath: root, planId: plan.planId,
      operationReceiptId: plan.operationReceiptId, selectedChangeIds: [], confirm: true,
    })).rejects.toThrow('计划无效')
  })

  it('计划绑定 owner、需要显式确认且不可重放', async () => {
    const { root, service, planner } = await setup()
    const mapping = { oldRelativePath: 'docs/design.md', newRelativePath: 'archive/design.md' }
    const impact = planner.createImpact('window:1', root, mapping)
    const execution = await planner.executeOperation({
      ownerId: 'window:1', rootPath: root, impactId: impact.impactId, actualMapping: mapping,
      execute: async () => {
        await rename(join(root, 'docs', 'design.md'), join(root, 'archive', 'design.md'))
        return true
      },
    })
    await service.refreshRelativePaths(root, ['archive/design.md'])
    const plan = await planner.createRepairPlan({
      ownerId: 'window:1', rootPath: root, mapping, reason: 'move',
      operationReceiptId: execution.receipt.operationReceiptId,
    })

    await expect(planner.apply({ ownerId: 'window:2', rootPath: root, planId: plan.planId, operationReceiptId: plan.operationReceiptId, selectedChangeIds: [], confirm: true }))
      .rejects.toThrow('计划无效')
    await expect(planner.apply({ ownerId: 'window:1', rootPath: root, planId: plan.planId, operationReceiptId: plan.operationReceiptId, selectedChangeIds: [], confirm: false }))
      .rejects.toThrow('明确确认')
    planner.discard('window:1', plan.planId)
    expect(() => planner.discard('window:1', plan.planId)).toThrow('计划无效')
  })
})
