import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as sameRootMove from '../linking/sameRootMove'
import * as senderSecurity from '../ipc/senderSecurity'
import { registerLinkRewriteHandlers } from '../ipc/linkRewriteHandlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) },
}))

const operation = { workspaceId: 'workspace-a', lifecycleEpoch: 4 }
const planner = {
  createImpact: vi.fn(() => ({ impactId: 'impact-a', exactChanges: 1 })),
  executeOperation: vi.fn(async (input) => ({
    result: await input.execute(),
    receipt: { operationReceiptId: 'receipt-a' },
  })),
  createRepairPlan: vi.fn(async () => ({ planId: 'plan-a', changes: [] })),
  apply: vi.fn(async () => ({ planId: 'plan-a', files: [] })),
  applyBatch: vi.fn(async () => ({ planIds: ['plan-a'], files: [] })),
  regeneratePlan: vi.fn(async () => ({ planId: 'plan-b', changes: [] })),
  discard: vi.fn(),
}
const index = {
  attach: vi.fn(async () => {}),
  waitUntilIdle: vi.fn(async () => {}),
  refreshMovedRelativePaths: vi.fn(async () => {}),
}
const ctx = {
  linkRewritePlanner: planner,
  workspaceIndexService: index,
  windowManager: {
    getWorkspace: vi.fn(() => ({ id: 'workspace-a', lifecycleEpoch: 4, primaryRoot: '/workspace' })),
  },
}

function handler(channel: string): (...args: any[]) => any {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`missing handler: ${channel}`)
  return call[1] as (...args: any[]) => any
}

describe('link rewrite IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerLinkRewriteHandlers(ctx as any)
  })

  it('从 sender workspace 取得唯一 root 并绑定 plan owner', async () => {
    await handler('link-rewrite:getImpact')(
      { sender: { id: 9 } }, operation,
      { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
    )
    expect(index.attach).toHaveBeenCalledWith('/workspace', 'workspace:9:workspace-a')
    expect(planner.createImpact).toHaveBeenCalledWith(
      '9:workspace-a:4',
      '/workspace',
      { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
    )

    await handler('link-rewrite:createRepairPlan')(
      { sender: { id: 9 } }, operation,
      { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' }, 'move', 'receipt-a',
    )
    expect(planner.createRepairPlan).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '9:workspace-a:4', rootPath: '/workspace', reason: 'move', operationReceiptId: 'receipt-a',
    }))
  })

  it('executeOperation 在主进程绑定 owner/root/mapping 并要求明确确认', async () => {
    vi.spyOn(senderSecurity, 'validateWorkspaceOperationPath').mockImplementation(async (_ctx, _event, _operation, targetPath) => targetPath)
    vi.spyOn(sameRootMove, 'moveSameRootPath').mockResolvedValue({
      destinationPath: '/workspace/archive/a.md',
      isDirectory: false,
    })
    const result = await handler('link-rewrite:executeOperation')(
      { sender: { id: 9 } }, operation,
      {
        impactId: 'impact-a',
        mapping: { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
        reason: 'move',
        confirm: true,
      },
    )
    expect(planner.executeOperation).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '9:workspace-a:4',
      rootPath: '/workspace',
      impactId: 'impact-a',
      actualMapping: { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
    }))
    expect(index.refreshMovedRelativePaths).toHaveBeenCalledWith('/workspace', [
      { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
    ])
    expect(result).toEqual({
      newPath: '/workspace/archive/a.md',
      receipt: { operationReceiptId: 'receipt-a' },
    })

    await expect(handler('link-rewrite:executeOperation')(
      { sender: { id: 9 } }, operation,
      {
        impactId: 'impact-a',
        mapping: { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
        reason: 'move',
        confirm: false,
      },
    )).rejects.toThrow('明确确认')
  })

  it('repair plan 必须沿用同一 sender owner 和操作回执', async () => {
    await handler('link-rewrite:createRepairPlan')(
      { sender: { id: 9 } }, operation,
      { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
      'move',
      'receipt-a',
    )
    expect(planner.createRepairPlan).toHaveBeenCalledWith({
      ownerId: '9:workspace-a:4',
      rootPath: '/workspace',
      mapping: { oldRelativePath: 'docs/a.md', newRelativePath: 'archive/a.md' },
      reason: 'move',
      operationReceiptId: 'receipt-a',
    })
  })

  it('apply 要求有界 change ids 并把明确确认传给 planner', async () => {
    await handler('link-rewrite:apply')({ sender: { id: 9 } }, operation, {
      planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'], confirm: true,
    })
    expect(planner.apply).toHaveBeenCalledWith({
      ownerId: '9:workspace-a:4', rootPath: '/workspace', planId: 'plan-a', operationReceiptId: 'receipt-a',
      selectedChangeIds: ['change-a'], confirm: true,
    })

    await expect(handler('link-rewrite:apply')({ sender: { id: 9 } }, operation, {
      planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: Array.from({ length: 2001 }, () => 'change'), confirm: true,
    })).rejects.toThrow('链接修复项无效')
  })

  it('batch apply 有界并绑定同一 sender owner/root', async () => {
    await handler('link-rewrite:applyBatch')({ sender: { id: 9 } }, operation, {
      plans: [{ planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'] }],
      confirm: true,
    })
    expect(planner.applyBatch).toHaveBeenCalledWith({
      ownerId: '9:workspace-a:4',
      rootPath: '/workspace',
      plans: [{ planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'] }],
      confirm: true,
    })
    await expect(handler('link-rewrite:applyBatch')({ sender: { id: 9 } }, operation, {
      plans: Array.from({ length: 9 }, (_, index) => ({
        planId: `plan-${index}`,
        operationReceiptId: `receipt-${index}`,
        selectedChangeIds: [],
      })),
      confirm: true,
    })).rejects.toThrow('计划无效')
  })

  it('冲突重新生成仍绑定同一 sender owner/root', async () => {
    await handler('link-rewrite:regeneratePlan')({ sender: { id: 9 } }, operation, 'plan-a')
    expect(planner.regeneratePlan).toHaveBeenCalledWith({
      ownerId: '9:workspace-a:4', rootPath: '/workspace', planId: 'plan-a',
    })
  })

  it('拒绝旧 epoch并防止不同 owner 使用计划', async () => {
    await expect(handler('link-rewrite:getImpact')({ sender: { id: 9 } }, {
      workspaceId: 'workspace-a', lifecycleEpoch: 3,
    }, { oldRelativePath: 'a.md', newRelativePath: 'b.md' })).rejects.toThrow('工作区已失效')

    await handler('link-rewrite:discard')({ sender: { id: 10 } }, operation, 'plan-a')
    expect(planner.discard).toHaveBeenCalledWith('10:workspace-a:4', 'plan-a')
  })
})
