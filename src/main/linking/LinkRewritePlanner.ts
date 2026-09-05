import { randomUUID } from 'crypto'
import { open, readFile, realpath, rename, stat, unlink } from 'fs/promises'
import * as path from 'path'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { buildFullSha256Revision } from '../revisionToken'
import type { WorkspaceIndexService } from '../indexing/WorkspaceIndexService'
import type { IndexedDocument } from '../indexing/types'
import type {
  LinkImpactItem,
  LinkImpactSummary,
  LinkMoveMapping,
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

  constructor(
    private readonly indexService: WorkspaceIndexService,
    private readonly options: LinkRewritePlannerOptions = {},
  ) {}

  createImpact(ownerId: string, rootPath: string, mapping: LinkMoveMapping): LinkImpactSummary {
    this.pruneExpiredPlans()
    const normalized = validateLinkMoveMapping(mapping)
    const items = this.collectImpacts(rootPath, normalized)
    const now = Date.now()
    const impact: StoredImpact = {
      impactId: randomUUID(),
      ownerId,
      rootPath,
      createdAt: now,
      expiresAt: now + IMPACT_TTL_MS,
      mapping: normalized,
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
    if (this.executingImpacts.has(impact.impactId)) throw new Error('文件操作正在执行')
    this.executingImpacts.add(impact.impactId)
    try {
      const result = await input.execute()
      const receipt = this.recordOperationSuccess(input)
      return { result, receipt }
    } finally {
      this.executingImpacts.delete(impact.impactId)
    }
  }

  private recordOperationSuccess(input: {
    ownerId: string
    rootPath: string
    impactId: string
    actualMapping: LinkMoveMapping
  }): LinkOperationReceipt {
    this.pruneExpiredPlans()
    const impact = this.requireImpact(input)
    const mapping = impact.mapping
    const now = Date.now()
    const receipt: StoredReceipt = {
      operationReceiptId: randomUUID(),
      impactId: impact.impactId,
      ownerId: input.ownerId,
      rootPath: input.rootPath,
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
    const impacts = this.collectImpacts(rootPath, mapping)
    const built = await this.buildChanges(rootPath, impacts, mapping, input.reason)
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
    const impacts = this.collectImpacts(rootPath, previous.mapping)
    const changes = await this.buildChanges(rootPath, impacts, previous.mapping, previous.reason)
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

    const grouped = Map.groupBy(selected, change => change.sourceRelativePath)
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

    const grouped = Map.groupBy(selectedChanges, change => change.sourceRelativePath)
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
    mapping: LinkMoveMapping,
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
        const rewritten = rewriteTarget(impact, mapping)
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

  private collectImpacts(rootPath: string, mapping: LinkMoveMapping): LinkImpactItem[] {
    const documents = this.indexService.getIndexedDocuments(rootPath)
    const impacts: LinkImpactItem[] = []
    for (const document of documents) {
      impacts.push(...collectDocumentImpacts(document, mapping))
    }
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
      if (impact.expiresAt <= now) this.impacts.delete(impactId)
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

function collectDocumentImpacts(document: IndexedDocument, mapping: LinkMoveMapping): LinkImpactItem[] {
  const items: LinkImpactItem[] = []
  const sourcePathBeforeMove = document.relativePath
  const sourcePathAfterMove = remapPath(document.relativePath, mapping)
  const sourceMoved = sourcePathAfterMove !== sourcePathBeforeMove
  for (const link of document.outboundLinks) {
    if (link.kind !== 'markdown') continue
    const target = splitMarkdownTarget(link.rawTarget)
    if (!target.decodedPath || path.posix.isAbsolute(target.decodedPath)) continue
    const resolvedTargetBeforeMove = normalizeRelativePath(path.posix.join(path.posix.dirname(sourcePathBeforeMove), target.decodedPath))
    const resolvedTargetAfterMove = remapPath(resolvedTargetBeforeMove, mapping)
    const targetMoved = resolvedTargetAfterMove !== resolvedTargetBeforeMove
    if (!targetMoved && !sourceMoved) continue
    items.push({
      sourceRelativePath: sourcePathAfterMove,
      lineStart: link.lineStart,
      rawTarget: link.rawTarget,
      resolvedTargetRelativePath: resolvedTargetAfterMove,
      ...(link.destinationRange ? { destinationRange: link.destinationRange } : {}),
      relation: targetMoved ? 'inbound' : 'outbound',
      confidence: link.destinationRange && link.syntax !== 'html' ? 'exact' : 'candidate',
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

function rewriteTarget(impact: LinkImpactItem, mapping: LinkMoveMapping): string | null {
  const target = splitMarkdownTarget(impact.rawTarget)
  if (!target.decodedPath) return null
  const sourcePath = impact.sourceRelativePath
  const targetPath = impact.relation === 'inbound'
    ? mapping.newRelativePath
    : impact.resolvedTargetRelativePath
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
