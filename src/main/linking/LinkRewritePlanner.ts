import { randomUUID } from 'crypto'
import { lstat, open, readFile, realpath, rename, stat, unlink } from 'fs/promises'
import { isDeepStrictEqual } from 'util'
import * as path from 'path'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { buildFullSha256Revision } from '../revisionToken'
import type { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import { createWikiNameLookup } from '../indexing/wikiNameLookup'
import type { WorkspaceWikiSnapshot, RuntimeWikiLink } from '../indexing/wikiMetadata'
import { isBareWikiDocumentName } from '../../shared/markdown/wikiDocumentNames'
import { resolveIndexedWikiTarget } from '../indexing/WorkspaceIndexService'
import type { IndexedDocument } from '../indexing/types'
import type {
  LinkImpactItem,
  LinkImpactSummary,
  LinkMoveMapping,
  LinkMoveBatchOperation,
  LinkMoveBatchItemResult,
  LinkMoveBatchResult,
  LinkOperationReceipt,
  LinkRewriteApplyFileResult,
  LinkRewriteApplyResult,
  LinkRewriteBatchApplyResult,
  LinkRewriteChange,
  LinkRewritePlanView,
} from './types'
import { normalizeRelativePath, validateLinkMoveMapping, validateRelativePath } from './linkMoveMapping'

const PLAN_TTL_MS = 5 * 60 * 1000
const IMPACT_TTL_MS = 5 * 60 * 1000
const RECEIPT_TTL_MS = 5 * 60 * 1000
const MAX_PLANS_PER_OWNER = 8
const MAX_CHANGES_PER_PLAN = 2000
const MAX_PLAN_BYTES = 2 * 1024 * 1024

function groupChangesBySource(changes: readonly LinkRewriteChange[]): Map<string, LinkRewriteChange[]> {
  const grouped = new Map<string, LinkRewriteChange[]>()
  for (const change of changes) {
    const existing = grouped.get(change.sourceRelativePath)
    if (existing) existing.push(change)
    else grouped.set(change.sourceRelativePath, [change])
  }
  return grouped
}

interface StoredPlan extends LinkRewritePlanView {
  ownerId: string
  rootPath: string
  operationReceiptId: string
  reason: 'move' | 'rename'
  state: 'active' | 'retry-only'
}

interface StoredImpact extends LinkImpactSummary {
  ownerId: string
  rootPath: string
  wikiSnapshot: WorkspaceWikiSnapshot | null
}

interface StoredReceipt extends LinkOperationReceipt {
  ownerId: string
  rootPath: string
}

export interface LinkRewritePlannerOptions {
  beforeAtomicReplace?: (input: { rootPath: string; filePath: string }) => Promise<void>
  beforeCommitReplace?: (input: { rootPath: string; filePath: string }) => Promise<void>
  replaceFile?: (sourcePath: string, destinationPath: string) => Promise<void>
  platform?: NodeJS.Platform
}

export class LinkRewritePlanner {
  private readonly plans = new Map<string, StoredPlan>()
  private readonly impacts = new Map<string, StoredImpact>()
  private readonly receipts = new Map<string, StoredReceipt>()
  private readonly executingImpacts = new Set<string>()
  private readonly executingRoots = new Set<string>()

  constructor(
    private readonly indexService: WorkspaceIndexService,
    private readonly options: LinkRewritePlannerOptions = {},
  ) {}

  async createImpact(ownerId: string, rootPath: string, mapping: LinkMoveMapping): Promise<LinkImpactSummary> {
    this.pruneExpiredPlans()
    const normalized = validateLinkMoveMapping(mapping)
    const wikiSnapshot = this.indexService.getWikiSnapshot(rootPath)
    const items = await this.collectImpacts(rootPath, normalized)
    if (wikiSnapshot && !wikiSnapshot.isCurrent()) throw new Error('链接索引已变化，请重新预览文件操作')
    const now = Date.now()
    const impact: StoredImpact = {
      impactId: randomUUID(),
      ownerId,
      rootPath,
      createdAt: now,
      expiresAt: now + IMPACT_TTL_MS,
      mapping: normalized,
      wikiSnapshot,
      affectedSourceFiles: new Set(items.map(item => item.sourceRelativePath)).size,
      exactChanges: items.filter(item => item.confidence === 'exact').length,
      candidates: items.filter(item => item.confidence === 'candidate').length,
      items,
    }
    this.impacts.set(impact.impactId, impact)
    return publicImpact(impact)
  }

  async executeOperation<T>(input: {
    ownerId: string
    rootPath: string
    impactId: string
    actualMapping: LinkMoveMapping
    execute: () => Promise<T>
  }): Promise<{ result: T; receipt: LinkOperationReceipt }> {
    this.pruneExpiredPlans()
    const impact = this.requireImpact(input)
    if (this.executingRoots.has(input.rootPath) || this.executingImpacts.has(impact.impactId)) throw new Error('文件操作正在执行')
    if (impact.wikiSnapshot && !impact.wikiSnapshot.isCurrent()) throw new Error('链接索引已变化，请重新预览文件操作')
    this.executingImpacts.add(impact.impactId)
    try {
      const result = await input.execute()
      const receipt = this.recordOperationSuccess(impact)
      return { result, receipt }
    } finally {
      this.executingImpacts.delete(impact.impactId)
    }
  }

  async executeBatch(input: {
    ownerId: string
    rootPath: string
    operations: readonly LinkMoveBatchOperation[]
    validate: (mapping: LinkMoveMapping) => Promise<void>
    assertAuthorized: () => void
    execute: (mapping: LinkMoveMapping, assertCurrent: () => Promise<void>) => Promise<{ newPath: string; isDirectory: boolean }>
    afterMove?: (mapping: LinkMoveMapping, result: { newPath: string; isDirectory: boolean }) => Promise<void>
  }): Promise<LinkMoveBatchResult> {
    this.pruneExpiredPlans()
    if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 256
      || Buffer.byteLength(JSON.stringify(input.operations), 'utf8') > MAX_PLAN_BYTES) throw new Error('批量移动项无效或过多')
    if (this.executingRoots.has(input.rootPath) || [...this.executingImpacts].some(id => this.impacts.get(id)?.rootPath === input.rootPath)) {
      throw new Error('当前文件夹的文件操作正在执行')
    }
    const impacts = input.operations.map(operation => this.requireImpact({ ...input, impactId: operation.impactId, actualMapping: operation.mapping }))
    if (new Set(impacts.map(impact => impact.impactId)).size !== impacts.length) throw new Error('批量移动项重复')
    for (let index = 0; index < impacts.length; index++) {
      const paths = Object.values(impacts[index].mapping)
      for (const other of impacts.slice(index + 1)) {
        if (paths.some(first => Object.values(other.mapping).some(second => pathsOverlap(first, second)))) {
          throw new Error('批量移动的源或目标重叠，请分开预览')
        }
      }
    }
    const baseline = impacts[0].wikiSnapshot
    if (!baseline?.isCurrent() || !baseline.isContinuous() || impacts.some(impact => !impact.wikiSnapshot?.isCurrent()
      || impact.wikiSnapshot.documents !== baseline.documents)) throw new Error('链接索引已变化，请重新预览文件操作')
    this.executingRoots.add(input.rootPath)
    impacts.forEach(impact => this.executingImpacts.add(impact.impactId))
    const items: LinkMoveBatchItemResult[] = []
    const moved: LinkMoveMapping[] = []
    let warning: string | undefined
    try {
      input.assertAuthorized()
      for (const impact of impacts) await input.validate(impact.mapping)
      const rootIdentity = await stat(input.rootPath)
      const identities = new Map<string, Awaited<ReturnType<typeof lstat>> | null>()
      for (const impact of impacts) {
        try { identities.set(impact.impactId, await lstat(path.resolve(input.rootPath, impact.mapping.oldRelativePath))) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          identities.set(impact.impactId, null)
        }
      }
      input.assertAuthorized()
      if (impacts.some(impact => !impact.wikiSnapshot?.isCurrent())) throw new Error('链接索引已变化，请重新预览文件操作')
      for (const impact of impacts) {
        const operation = { impactId: impact.impactId, mapping: impact.mapping }
        if (warning) { items.push({ ...operation, status: 'not-executed', message: warning }); continue }
        let current: WorkspaceWikiSnapshot
        const align = async (): Promise<WorkspaceWikiSnapshot> => {
          await this.indexService.waitUntilIdle(input.rootPath)
          input.assertAuthorized()
          this.requireImpact({ ...input, impactId: impact.impactId, actualMapping: impact.mapping })
          const next = this.indexService.getWikiSnapshot(input.rootPath)
          if (impact.expiresAt <= Date.now() || !baseline.isContinuous() || !next?.isCurrent()
            || !matchesMovedSnapshot(baseline, next, moved)) throw new Error('链接索引已变化，请重新预览剩余文件操作')
          const nextItems = await this.collectImpacts(input.rootPath, impact.mapping)
          if (!next.isCurrent() || impactItemsKey(nextItems, []) !== impactItemsKey(impact.items, moved)) {
            throw new Error('链接影响已变化，请重新预览剩余文件操作')
          }
          return next
        }
        try { current = await align() }
        catch (error) {
          warning = error instanceof Error ? error.message : '无法确认链接影响，请重新预览剩余文件操作'
          items.push({ ...operation, status: 'not-executed', message: warning })
          continue
        }
        const identity = identities.get(impact.impactId)
        if (!identity || identity.isSymbolicLink()) {
          items.push({ ...operation, status: 'failed', message: identity ? '安全错误：不支持移动符号链接' : '源文件不存在' })
          continue
        }
        let guardFailed = false
        const assertCurrent = async (): Promise<void> => {
          try {
            if (!current.isCurrent()) current = await align()
            const source = await lstat(path.resolve(input.rootPath, impact.mapping.oldRelativePath))
            const root = await stat(input.rootPath)
            input.assertAuthorized()
            this.requireImpact({ ...input, impactId: impact.impactId, actualMapping: impact.mapping })
            if (!sameFileIdentity(identity, source) || root.dev !== rootIdentity.dev || root.ino !== rootIdentity.ino
              || !baseline.isContinuous() || !current.isCurrent() || impact.expiresAt <= Date.now()) {
              throw new Error('文件或链接索引已变化，请重新预览剩余文件操作')
            }
          } catch (error) { guardFailed = true; throw error }
        }
        let result: { newPath: string; isDirectory: boolean }
        try {
          await assertCurrent()
          result = await input.execute(impact.mapping, assertCurrent)
        } catch (error) {
          const message = error instanceof Error ? error.message : '文件移动失败'
          if (guardFailed) warning = message
          else if (message !== '目标文件已存在' && message !== '源文件不存在'
            && !message.includes('不支持移动')) warning = '文件操作未完成，请核对实际位置后重新预览剩余文件操作'
          items.push({ ...operation, status: guardFailed ? 'not-executed' : 'failed', message })
          continue
        }
        const receipt = this.recordOperationSuccess(impact)
        items.push({ ...operation, status: 'success', newPath: result.newPath, receipt })
        moved.push(impact.mapping)
        try {
          await this.indexService.refreshMovedRelativePaths(input.rootPath, [impact.mapping])
          await input.afterMove?.(impact.mapping, result)
        } catch {
          warning = '文件已移动，但索引或附属状态未能更新；请刷新后重新预览剩余文件操作'
        }
      }
      return { items, ...(warning ? { warning } : {}) }
    } finally {
      impacts.forEach(impact => this.executingImpacts.delete(impact.impactId))
      this.executingRoots.delete(input.rootPath)
    }
  }

  private recordOperationSuccess(impact: StoredImpact): LinkOperationReceipt {
    const mapping = impact.mapping
    const now = Date.now()
    const receipt: StoredReceipt = {
      operationReceiptId: randomUUID(),
      impactId: impact.impactId,
      ownerId: impact.ownerId,
      rootPath: impact.rootPath,
      createdAt: now,
      expiresAt: now + RECEIPT_TTL_MS,
      mapping,
      status: 'success',
    }
    this.receipts.set(receipt.operationReceiptId, receipt)
    this.impacts.delete(impact.impactId)
    return publicReceipt(receipt)
  }

  async createRepairPlan(input: {
    ownerId: string
    rootPath: string
    mapping: LinkMoveMapping
    reason: 'move' | 'rename'
    operationReceiptId: string
  }): Promise<LinkRewritePlanView> {
    this.pruneExpiredPlans()
    const receipt = this.receipts.get(input.operationReceiptId)
    if (!receipt || receipt.ownerId !== input.ownerId || receipt.rootPath !== input.rootPath) {
      throw new Error('文件操作回执无效或已过期')
    }
    if ([...this.plans.values()].filter(plan => plan.ownerId === input.ownerId).length >= MAX_PLANS_PER_OWNER) {
      throw new Error('链接修复计划过多，请先完成或关闭已有计划')
    }
    const rootPath = await realpath(input.rootPath)
    const mapping = validateLinkMoveMapping(input.mapping)
    if (receipt && (
      receipt.mapping.oldRelativePath !== mapping.oldRelativePath ||
      receipt.mapping.newRelativePath !== mapping.newRelativePath
    )) throw new Error('文件操作回执与修复映射不一致')
    const impacts = await this.collectImpacts(rootPath, mapping)
    const built = await this.buildChanges(rootPath, impacts, input.reason)
    this.invalidatePlansForMapping(input.ownerId, rootPath, mapping)

    const now = Date.now()
    const plan: StoredPlan = {
      planId: randomUUID(),
      ownerId: input.ownerId,
      rootPath,
      operationReceiptId: input.operationReceiptId,
      reason: input.reason,
      state: 'active',
      createdAt: now,
      expiresAt: now + PLAN_TTL_MS,
      mapping,
      changes: built.changes,
      warnings: built.warnings,
    }
    this.assertPlanSize(plan)
    this.plans.set(plan.planId, plan)
    if (receipt) this.receipts.delete(receipt.operationReceiptId)
    return publicPlan(plan)
  }

  async regeneratePlan(input: {
    ownerId: string
    rootPath: string
    planId: string
  }): Promise<LinkRewritePlanView> {
    const previous = this.requirePlan(input.ownerId, input.planId)
    if (previous.state !== 'retry-only') throw new Error('链接修复计划无需重新生成')
    const rootPath = await realpath(input.rootPath)
    if (previous.rootPath !== rootPath) throw new Error('工作区已失效')
    const impacts = await this.collectImpacts(rootPath, previous.mapping)
    const changes = await this.buildChanges(rootPath, impacts, previous.reason)
    const now = Date.now()
    const next: StoredPlan = {
      ...previous,
      planId: randomUUID(),
      createdAt: now,
      expiresAt: now + PLAN_TTL_MS,
      changes: changes.changes,
      warnings: changes.warnings,
      state: 'active',
    }
    this.assertPlanSize(next)
    this.plans.delete(previous.planId)
    this.plans.set(next.planId, next)
    return publicPlan(next)
  }

  discard(ownerId: string, planId: string): void {
    const plan = this.requirePlan(ownerId, planId)
    this.plans.delete(plan.planId)
  }

  async apply(input: {
    ownerId: string
    rootPath: string
    planId: string
    operationReceiptId: string
    selectedChangeIds: readonly string[]
    confirm: boolean
  }): Promise<LinkRewriteApplyResult> {
    if (input.confirm !== true) throw new Error('必须明确确认链接修复')
    const plan = this.requirePlan(input.ownerId, input.planId)
    if (plan.operationReceiptId !== input.operationReceiptId) throw new Error('文件操作回执与修复计划不一致')
    const rootPath = await realpath(input.rootPath)
    if (rootPath !== plan.rootPath) throw new Error('工作区已失效')
    const selectedIds = new Set(input.selectedChangeIds)
    if (selectedIds.size !== input.selectedChangeIds.length) throw new Error('链接修复项重复')
    const selected = plan.changes.filter(change => selectedIds.has(change.changeId))
    if (selected.length !== selectedIds.size) throw new Error('链接修复项无效')

    const grouped = groupChangesBySource(selected)
    const results: LinkRewriteApplyFileResult[] = []
    const updatedPaths: string[] = []
    for (const [relativePath, changes] of grouped) {
      const result = await this.applyFile(plan.rootPath, relativePath, changes)
      results.push(result)
      if (result.status === 'updated') updatedPaths.push(relativePath)
    }
    if (results.some(result => result.status === 'conflict')) plan.state = 'retry-only'
    else this.plans.delete(plan.planId)
    if (updatedPaths.length > 0) await this.indexService.refreshRelativePaths(plan.rootPath, updatedPaths)
    return { planId: plan.planId, files: results }
  }

  async applyBatch(input: {
    ownerId: string
    rootPath: string
    plans: readonly {
      planId: string
      operationReceiptId: string
      selectedChangeIds: readonly string[]
    }[]
    confirm: boolean
  }): Promise<LinkRewriteBatchApplyResult> {
    if (input.confirm !== true) throw new Error('必须明确确认链接修复')
    if (input.plans.length === 0 || input.plans.length > MAX_PLANS_PER_OWNER) {
      throw new Error('链接修复计划无效')
    }
    const planIds = new Set(input.plans.map(item => item.planId))
    if (planIds.size !== input.plans.length) throw new Error('链接修复计划重复')
    const plans = input.plans.map(item => {
      const plan = this.requirePlan(input.ownerId, item.planId)
      if (plan.operationReceiptId !== item.operationReceiptId) {
        throw new Error('文件操作回执与修复计划不一致')
      }
      return { plan, selectedChangeIds: item.selectedChangeIds }
    })
    const rootPath = await realpath(input.rootPath)
    if (plans.some(({ plan }) => plan.rootPath !== rootPath)) throw new Error('工作区已失效')

    const selectedChanges: LinkRewriteChange[] = []
    for (const { plan, selectedChangeIds } of plans) {
      const ids = new Set(selectedChangeIds)
      if (ids.size !== selectedChangeIds.length) throw new Error('链接修复项重复')
      const selected = plan.changes.filter(change => ids.has(change.changeId))
      if (selected.length !== ids.size) throw new Error('链接修复项无效')
      selectedChanges.push(...selected)
    }
    const changeIds = new Set(selectedChanges.map(change => change.changeId))
    if (changeIds.size !== selectedChanges.length) throw new Error('链接修复项重复')

    const grouped = groupChangesBySource(selectedChanges)
    const results: LinkRewriteApplyFileResult[] = []
    const updatedPaths: string[] = []
    for (const [relativePath, changes] of grouped) {
      const result = await this.applyFile(rootPath, relativePath, dedupeChanges(changes))
      results.push(result)
      if (result.status === 'updated') updatedPaths.push(relativePath)
    }
    for (const { plan } of plans) {
      plan.state = results.some(result => result.status === 'conflict') ? 'retry-only' : 'active'
      if (plan.state === 'active') this.plans.delete(plan.planId)
    }
    if (updatedPaths.length > 0) await this.indexService.refreshRelativePaths(rootPath, updatedPaths)
    return { planIds: plans.map(({ plan }) => plan.planId), files: results }
  }

  cleanupOwner(ownerId: string): void {
    for (const [planId, plan] of this.plans) {
      if (plan.ownerId === ownerId) this.plans.delete(planId)
    }
    for (const [impactId, impact] of this.impacts) {
      if (impact.ownerId === ownerId) {
        this.impacts.delete(impactId)
        this.executingImpacts.delete(impactId)
      }
    }
    for (const [receiptId, receipt] of this.receipts) {
      if (receipt.ownerId === ownerId) this.receipts.delete(receiptId)
    }
  }

  private async buildChanges(
    rootPath: string,
    impacts: readonly LinkImpactItem[],
    reason: 'move' | 'rename',
  ): Promise<{ changes: LinkRewriteChange[]; warnings: string[] }> {
    const changes: LinkRewriteChange[] = []
    const seenChanges = new Set<string>()
    const warnings: string[] = []
    for (const impact of impacts) {
      if (impact.confidence !== 'exact' || !impact.destinationRange) {
        warnings.push(`${impact.sourceRelativePath}:${impact.lineStart} 无法安全自动修复`)
        continue
      }
      try {
        const sourcePath = await resolveRelativeFilePath(rootPath, impact.sourceRelativePath)
        const bytes = await readFile(sourcePath)
        const source = bytes.toString('utf8')
        const before = source.slice(impact.destinationRange.startOffset, impact.destinationRange.endOffset)
        if (before !== impact.rawTarget) {
          warnings.push(`${impact.sourceRelativePath}:${impact.lineStart} 源范围已失效`)
          continue
        }
        const rewritten = rewriteTarget(impact)
        if (!rewritten || rewritten === before) continue
        const changeKey = `${impact.sourceRelativePath}:${impact.destinationRange.startOffset}:${impact.destinationRange.endOffset}`
        if (seenChanges.has(changeKey)) continue
        seenChanges.add(changeKey)
        changes.push({
          changeId: randomUUID(), sourceRelativePath: impact.sourceRelativePath, lineStart: impact.lineStart,
          sourceRevisionToken: buildFullSha256Revision(bytes), destinationRange: impact.destinationRange,
          before, after: rewritten, reason, confidence: 'exact',
        })
        if (changes.length > MAX_CHANGES_PER_PLAN) throw new Error('链接修复项过多，请缩小操作范围')
      } catch (error) {
        warnings.push(`${impact.sourceRelativePath}:${impact.lineStart} ${error instanceof Error ? error.message : '读取失败'}`)
      }
    }
    return { changes, warnings: [...new Set(warnings)] }
  }

  private async collectImpacts(rootPath: string, mapping: LinkMoveMapping): Promise<LinkImpactItem[]> {
    const snapshot = this.indexService.getWikiSnapshot(rootPath)
    const indexedDocuments = snapshot ? [...snapshot.documents.values()] : this.indexService.getIndexedDocuments(rootPath)
    const lookup = createWikiNameLookup(rootPath, snapshot)
    const documentsByPreMovePath = new Map<string, IndexedDocument>()
    for (const document of indexedDocuments) {
      const preMovePath = reverseRemapPath(document.relativePath, mapping)
      const existing = documentsByPreMovePath.get(preMovePath)
      if (!existing || document.relativePath !== preMovePath) {
        documentsByPreMovePath.set(preMovePath, document)
      }
    }
    const impacts: LinkImpactItem[] = []
    for (const [preMovePath, document] of documentsByPreMovePath) {
      impacts.push(...await collectDocumentImpacts(document, preMovePath, mapping, documentsByPreMovePath, snapshot, lookup))
    }
    if (snapshot && !snapshot.isCurrent()) throw new Error('链接索引已变化，请重新预览文件操作')
    return impacts.sort((left, right) =>
      left.sourceRelativePath.localeCompare(right.sourceRelativePath) || left.lineStart - right.lineStart
    )
  }

  private invalidatePlansForMapping(ownerId: string, rootPath: string, mapping: LinkMoveMapping): void {
    for (const [planId, plan] of this.plans) {
      if (
        plan.ownerId === ownerId && plan.rootPath === rootPath &&
        plan.mapping.oldRelativePath === mapping.oldRelativePath
      ) this.plans.delete(planId)
    }
  }

  private assertPlanSize(plan: StoredPlan): void {
    const size = Buffer.byteLength(JSON.stringify(publicPlan(plan)), 'utf8')
    if (size > MAX_PLAN_BYTES) throw new Error('链接修复计划过大，请缩小操作范围')
  }

  private requireImpact(input: {
    ownerId: string
    rootPath: string
    impactId: string
    actualMapping: LinkMoveMapping
  }): StoredImpact {
    const impact = this.impacts.get(input.impactId)
    const mapping = validateLinkMoveMapping(input.actualMapping)
    if (
      !impact || impact.ownerId !== input.ownerId || impact.rootPath !== input.rootPath ||
      impact.mapping.oldRelativePath !== mapping.oldRelativePath ||
      impact.mapping.newRelativePath !== mapping.newRelativePath
    ) throw new Error('链接影响预览无效或已过期')
    return impact
  }

  private requirePlan(ownerId: string, planId: string): StoredPlan {
    this.pruneExpiredPlans()
    const plan = this.plans.get(planId)
    if (!plan || plan.ownerId !== ownerId) throw new Error('链接修复计划无效或已过期')
    return plan
  }

  private pruneExpiredPlans(): void {
    const now = Date.now()
    for (const [planId, plan] of this.plans) {
      if (plan.expiresAt <= now) this.plans.delete(planId)
    }
    for (const [impactId, impact] of this.impacts) {
      if (impact.expiresAt <= now && !this.executingImpacts.has(impactId)) this.impacts.delete(impactId)
    }
    for (const [receiptId, receipt] of this.receipts) {
      if (receipt.expiresAt <= now) this.receipts.delete(receiptId)
    }
  }

  private async applyFile(
    rootPath: string,
    relativePath: string,
    changes: readonly LinkRewriteChange[],
  ): Promise<LinkRewriteApplyFileResult> {
    const sourcePath = await resolveRelativeFilePath(rootPath, relativePath)
    try {
      const sourceHandle = await open(sourcePath, 'r')
      let bytes: Buffer
      let sourceStats: Awaited<ReturnType<typeof stat>>
      try {
        bytes = await sourceHandle.readFile()
        sourceStats = await sourceHandle.stat()
      } finally {
        await sourceHandle.close()
      }
      if (changes.some(change => buildFullSha256Revision(bytes) !== change.sourceRevisionToken)) {
        return { sourceRelativePath: relativePath, status: 'conflict', updatedChanges: 0, message: 'revision 已变化' }
      }
      let source = bytes.toString('utf8')
      const ordered = [...changes].sort((left, right) => right.destinationRange.startOffset - left.destinationRange.startOffset)
      let previousStart = source.length + 1
      for (const change of ordered) {
        const { startOffset, endOffset } = change.destinationRange
        if (endOffset > previousStart || source.slice(startOffset, endOffset) !== change.before) {
          return { sourceRelativePath: relativePath, status: 'conflict', updatedChanges: 0, message: '链接范围已变化' }
        }
        source = `${source.slice(0, startOffset)}${change.after}${source.slice(endOffset)}`
        previousStart = startOffset
      }
      await this.options.beforeAtomicReplace?.({ rootPath, filePath: sourcePath })
      const revalidatedPath = await resolveRelativeFilePath(rootPath, relativePath)
      const currentStats = await stat(revalidatedPath)
      if (
        revalidatedPath !== sourcePath ||
        currentStats.dev !== sourceStats.dev ||
        currentStats.ino !== sourceStats.ino
      ) {
        return { sourceRelativePath: relativePath, status: 'conflict', updatedChanges: 0, message: '文件路径已变化' }
      }
      await atomicReplace(rootPath, sourcePath, Buffer.from(source, 'utf8'), {
        beforeCommitReplace: this.options.beforeCommitReplace,
        replaceFile: this.options.replaceFile,
        platform: this.options.platform,
      })
      return { sourceRelativePath: relativePath, status: 'updated', updatedChanges: changes.length }
    } catch (error) {
      return {
        sourceRelativePath: relativePath,
        status: 'failed',
        updatedChanges: 0,
        message: error instanceof Error ? error.message : '写入失败',
      }
    }
  }
}

function pathsOverlap(first: string, second: string): boolean {
  return first === second || first.startsWith(second + '/') || second.startsWith(first + '/')
}

function movedPath(file: string, mappings: readonly LinkMoveMapping[]): string {
  return mappings.reduce((current, mapping) => remapPath(current, mapping), file)
}

function impactItemsKey(items: readonly LinkImpactItem[], moved: readonly LinkMoveMapping[]): string {
  return JSON.stringify(items.map(item => ({ ...item,
    sourceRelativePath: movedPath(item.sourceRelativePath, moved),
    resolvedTargetRelativePath: movedPath(item.resolvedTargetRelativePath, moved),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
}

function matchesMovedSnapshot(before: WorkspaceWikiSnapshot, after: WorkspaceWikiSnapshot, moved: readonly LinkMoveMapping[]): boolean {
  if (before.ready !== after.ready || before.complete !== after.complete || before.documents.size !== after.documents.size) return false
  for (const [file, document] of before.documents) {
    const next = movedPath(file, moved)
    if (after.documents.get(next)?.revisionToken !== document.revisionToken
      || !isDeepStrictEqual(before.metadata.get(file), after.metadata.get(next))) return false
  }
  return true
}

function sameFileIdentity(before: Awaited<ReturnType<typeof lstat>>, after: Awaited<ReturnType<typeof lstat>>): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.mode === after.mode
}

function dedupeChanges(changes: readonly LinkRewriteChange[]): LinkRewriteChange[] {
  const byRange = new Map<string, LinkRewriteChange>()
  for (const change of changes) {
    const key = `${change.destinationRange.startOffset}:${change.destinationRange.endOffset}`
    const existing = byRange.get(key)
    if (existing && (existing.before !== change.before || existing.after !== change.after)) {
      throw new Error('链接修复计划存在冲突变更')
    }
    byRange.set(key, existing ?? change)
  }
  return [...byRange.values()]
}

async function collectDocumentImpacts(
  document: IndexedDocument,
  sourcePathBeforeMove: string,
  mapping: LinkMoveMapping,
  documents: ReadonlyMap<string, IndexedDocument>,
  snapshot: WorkspaceWikiSnapshot | null,
  lookup: ReturnType<typeof createWikiNameLookup>,
): Promise<LinkImpactItem[]> {
  const items: LinkImpactItem[] = []
  const sourcePathAfterMove = remapPath(sourcePathBeforeMove, mapping)
  const sourceMoved = sourcePathAfterMove !== sourcePathBeforeMove
  const metadata = snapshot?.metadata.get(document.relativePath)
  const links: readonly RuntimeWikiLink[] = metadata?.revisionToken === document.revisionToken ? metadata.links : document.outboundLinks
  for (const link of links) {
    if (link.kind !== 'markdown') continue
    const target = splitMarkdownTarget(link.rawTarget)
    if (!target.decodedPath || path.posix.isAbsolute(target.decodedPath)) continue
    let resolvedTargetBeforeMove = link.syntax === 'wiki'
      ? resolveIndexedWikiTarget(documents, sourcePathBeforeMove, target.decodedPath)
      : normalizeRelativePath(path.posix.join(path.posix.dirname(sourcePathBeforeMove), target.decodedPath))
    let uncertain = false
    let provenance: 'alias' | 'uncertain' | undefined
    const bareWiki = link.syntax === 'wiki' && link.wikiEmbed !== true && isBareWikiDocumentName(target.decodedPath)
    const nameAffected = [mapping.oldRelativePath, mapping.newRelativePath].some(value =>
      path.posix.basename(value).replace(/\.(?:md|markdown|mdown|mkd|mkdn)$/i, '') === target.decodedPath)
    if (bareWiki) {
      const resolution = link.wikiEmbed === undefined ? { status: 'uncertain' as const }
        : await lookup(document.relativePath, target.decodedPath)
      if (resolution.status === 'found' && resolution.provenance === 'alias') {
        if (!nameAffected) continue
        resolvedTargetBeforeMove = reverseRemapPath(resolution.target, mapping)
        uncertain = true; provenance = 'alias'
      } else if (resolution.status === 'found') {
        if (!resolvedTargetBeforeMove && snapshot?.aliases.has(target.decodedPath)) {
          uncertain = true; provenance = 'uncertain'
        }
        resolvedTargetBeforeMove = reverseRemapPath(resolution.target, mapping)
      } else if (resolution.status !== 'missing') {
        uncertain = true; provenance = 'uncertain'
      }
    }
    if (!resolvedTargetBeforeMove && !uncertain) continue
    const resolvedTargetAfterMove = resolvedTargetBeforeMove ? remapPath(resolvedTargetBeforeMove, mapping) : ''
    const targetMoved = Boolean(resolvedTargetBeforeMove && resolvedTargetAfterMove !== resolvedTargetBeforeMove)
    if (!targetMoved && !sourceMoved && !uncertain) continue
    const rawTarget = link.syntax === 'wiki'
      ? link.rawTarget.slice(0, link.rawTarget.indexOf('#') < 0 ? undefined : link.rawTarget.indexOf('#')).trim()
      : link.rawTarget
    items.push({
      sourceRelativePath: sourcePathAfterMove,
      lineStart: link.lineStart,
      rawTarget,
      resolvedTargetRelativePath: resolvedTargetAfterMove,
      ...(link.destinationRange ? { destinationRange: link.destinationRange } : {}),
      relation: targetMoved ? 'inbound' : 'outbound',
      ...(link.syntax === 'wiki' ? { syntax: 'wiki' as const } : {}),
      ...(provenance ? { provenance } : {}),
      confidence: !uncertain && link.destinationRange && link.syntax !== 'html' ? 'exact' : 'candidate',
    })
  }
  return items
}

function remapPath(relativePath: string, mapping: LinkMoveMapping): string {
  if (relativePath === mapping.oldRelativePath) return mapping.newRelativePath
  if (relativePath.startsWith(`${mapping.oldRelativePath}/`)) {
    return `${mapping.newRelativePath}/${relativePath.slice(mapping.oldRelativePath.length + 1)}`
  }
  return relativePath
}

function reverseRemapPath(relativePath: string, mapping: LinkMoveMapping): string {
  if (relativePath === mapping.newRelativePath) return mapping.oldRelativePath
  if (relativePath.startsWith(`${mapping.newRelativePath}/`)) {
    return `${mapping.oldRelativePath}/${relativePath.slice(mapping.newRelativePath.length + 1)}`
  }
  return relativePath
}

function rewriteTarget(impact: LinkImpactItem): string | null {
  const target = splitMarkdownTarget(impact.rawTarget)
  if (!target.decodedPath) return null
  // collectDocumentImpacts already remaps each descendant, not just the moved directory.
  const targetPath = impact.resolvedTargetRelativePath
  if (impact.syntax === 'wiki') {
    const preserveExtension = path.posix.extname(target.decodedPath) !== ''
    const wikiPath = preserveExtension
      ? targetPath
      : targetPath.replace(/\.(?:md|markdown|mdown|mkd|mkdn)$/i, '')
    return wikiPath
  }

  const sourcePath = impact.sourceRelativePath
  let nextPath = path.posix.relative(path.posix.dirname(sourcePath), targetPath)
  if (!nextPath.startsWith('.')) nextPath = `./${nextPath}`
  const encodedPath = encodeMarkdownPath(nextPath)
  return [
    encodedPath,
    target.rawQuery === undefined ? '' : `?${target.rawQuery}`,
    target.rawAnchor === undefined ? '' : `#${target.rawAnchor}`,
  ].join('')
}

function encodeMarkdownPath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment).replace(/%2E/gi, '.')).join('/')
}

async function resolveRelativeFilePath(rootPath: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(rootPath, validateRelativePath(relativePath))
  assertContained(rootPath, candidate)
  const canonicalPath = await realpath(candidate)
  assertContained(rootPath, canonicalPath)
  return canonicalPath
}

function assertContained(rootPath: string, targetPath: string): void {
  const relative = path.relative(rootPath, targetPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('路径超出当前工作区')
  }
}

async function atomicReplace(
  rootPath: string,
  filePath: string,
  bytes: Buffer,
  options: {
    beforeCommitReplace?: (input: { rootPath: string; filePath: string }) => Promise<void>
    replaceFile?: (sourcePath: string, destinationPath: string) => Promise<void>
    platform?: NodeJS.Platform
  } = {},
): Promise<void> {
  const parentPath = path.dirname(filePath)
  const canonicalParent = await realpath(parentPath)
  assertContained(rootPath, canonicalParent)
  const canonicalTarget = await realpath(filePath)
  assertContained(rootPath, canonicalTarget)
  if (canonicalTarget !== filePath) throw new Error('文件路径已变化')

  const fileStats = await stat(filePath)
  const tempPath = path.join(parentPath, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  assertContained(rootPath, tempPath)
  const handle = await open(tempPath, 'wx', fileStats.mode & 0o777)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await options.beforeCommitReplace?.({ rootPath, filePath })
    const commitTarget = await realpath(filePath)
    const commitStats = await stat(commitTarget)
    assertContained(rootPath, commitTarget)
    if (
      commitTarget !== canonicalTarget ||
      commitStats.dev !== fileStats.dev ||
      commitStats.ino !== fileStats.ino
    ) throw new Error('文件路径已变化')
    const replaceFile = options.replaceFile ?? rename
    try {
      await replaceFile(tempPath, filePath)
    } catch (error) {
      if ((options.platform ?? process.platform) !== 'win32' || !isWindowsReplaceError(error)) throw error
      await replaceFileWindows(tempPath, filePath, rootPath, fileStats, replaceFile)
    }
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

function isWindowsReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES'
}

async function replaceFileWindows(
  tempPath: string,
  filePath: string,
  rootPath: string,
  expectedStats: Awaited<ReturnType<typeof stat>>,
  replaceFile: (sourcePath: string, destinationPath: string) => Promise<void>,
): Promise<void> {
  const backupPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.bak`)
  assertContained(rootPath, backupPath)
  const currentPath = await realpath(filePath)
  const currentStats = await stat(currentPath)
  assertContained(rootPath, currentPath)
  if (
    currentPath !== filePath ||
    currentStats.dev !== expectedStats.dev ||
    currentStats.ino !== expectedStats.ino
  ) throw new Error('文件路径已变化')

  await rename(filePath, backupPath)
  try {
    await replaceFile(tempPath, filePath)
    await unlink(backupPath).catch(() => {})
  } catch (error) {
    await rename(backupPath, filePath).catch(() => {})
    throw error
  }
}

function publicImpact(impact: StoredImpact): LinkImpactSummary {
  return {
    impactId: impact.impactId,
    createdAt: impact.createdAt,
    expiresAt: impact.expiresAt,
    mapping: impact.mapping,
    affectedSourceFiles: impact.affectedSourceFiles,
    exactChanges: impact.exactChanges,
    candidates: impact.candidates,
    items: impact.items,
  }
}

function publicReceipt(receipt: StoredReceipt): LinkOperationReceipt {
  return {
    operationReceiptId: receipt.operationReceiptId,
    impactId: receipt.impactId,
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
    mapping: receipt.mapping,
    status: receipt.status,
  }
}

function publicPlan(plan: StoredPlan): LinkRewritePlanView {
  return {
    planId: plan.planId,
    operationReceiptId: plan.operationReceiptId,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    mapping: plan.mapping,
    changes: plan.changes,
    warnings: plan.warnings,
  }
}
