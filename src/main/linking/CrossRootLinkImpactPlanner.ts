import * as path from 'path'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import type {
  CrossRootImpactSection,
  CrossRootMoveImpactReport,
  CrossRootMoveMapping,
} from '../../shared/crossRootMoveImpact'
import type { IndexedDocument } from '../indexing/types'

interface CrossRootImpactInput {
  originDocuments: readonly IndexedDocument[]
  targetDocuments: readonly IndexedDocument[]
  mappings: readonly CrossRootMoveMapping[]
}

interface ResolvedLink {
  entity: string | null
  ignored: boolean
  uncertain: boolean
}

const emptySection = (): CrossRootImpactSection => ({
  markdownDocumentsScanned: 0,
  localMarkdownLinksExamined: 0,
  linksBreakingAfterMove: 0,
  linksResolvingAfterMove: 0,
  linksChangingResolution: 0,
})

export function createCrossRootMoveImpactReport(input: CrossRootImpactInput): CrossRootMoveImpactReport {
  const originPaths = new Set(input.originDocuments.map(document => document.relativePath))
  const targetPaths = new Set(input.targetDocuments.map(document => document.relativePath))
  const movedOriginPaths = new Map<string, string>()
  for (const document of input.originDocuments) {
    const destination = remapPath(document.relativePath, input.mappings)
    if (destination) movedOriginPaths.set(document.relativePath, destination)
  }
  const movedDestinations = new Set(movedOriginPaths.values())
  const report: CrossRootMoveImpactReport = {
    reportOnly: true,
    origin: emptySection(),
    moved: emptySection(),
    target: emptySection(),
    coverage: {
      originIndexedMarkdownDocuments: input.originDocuments.length,
      targetIndexedMarkdownDocuments: input.targetDocuments.length,
      ignoredLinks: 0,
      uncertainLinks: 0,
    },
  }

  for (const document of input.originDocuments) {
    const destinationPath = movedOriginPaths.get(document.relativePath)
    const section = destinationPath ? report.moved : report.origin
    section.markdownDocumentsScanned += 1
    for (const link of document.outboundLinks) {
      if (link.kind !== 'markdown') {
        report.coverage.ignoredLinks += 1
        continue
      }
      const before = resolveLink('origin', document.relativePath, link.rawTarget, originPaths, targetPaths, movedOriginPaths, movedDestinations, false)
      if (before.ignored) {
        report.coverage.ignoredLinks += 1
        continue
      }
      if (before.uncertain) report.coverage.uncertainLinks += 1
      section.localMarkdownLinksExamined += 1
      const after = destinationPath
        ? resolveLink('target', destinationPath, link.rawTarget, originPaths, targetPaths, movedOriginPaths, movedDestinations, true)
        : resolveLink('origin', document.relativePath, link.rawTarget, originPaths, targetPaths, movedOriginPaths, movedDestinations, true)
      classifyTransition(section, before.entity, after.entity)
    }
  }

  for (const document of input.targetDocuments) {
    report.target.markdownDocumentsScanned += 1
    for (const link of document.outboundLinks) {
      if (link.kind !== 'markdown') {
        report.coverage.ignoredLinks += 1
        continue
      }
      const before = resolveLink('target', document.relativePath, link.rawTarget, originPaths, targetPaths, movedOriginPaths, movedDestinations, false)
      if (before.ignored) {
        report.coverage.ignoredLinks += 1
        continue
      }
      if (before.uncertain) report.coverage.uncertainLinks += 1
      report.target.localMarkdownLinksExamined += 1
      const after = resolveLink('target', document.relativePath, link.rawTarget, originPaths, targetPaths, movedOriginPaths, movedDestinations, true)
      classifyTransition(report.target, before.entity, after.entity)
    }
  }
  return report
}

function resolveLink(
  root: 'origin' | 'target',
  sourceRelativePath: string,
  rawTarget: string,
  originPaths: ReadonlySet<string>,
  targetPaths: ReadonlySet<string>,
  movedOriginPaths: ReadonlyMap<string, string>,
  movedDestinations: ReadonlySet<string>,
  afterMove: boolean,
): ResolvedLink {
  const { decodedPath } = splitMarkdownTarget(rawTarget)
  if (!decodedPath || path.posix.isAbsolute(decodedPath)) return { entity: null, ignored: true, uncertain: false }
  const target = normalize(path.posix.join(path.posix.dirname(sourceRelativePath), decodedPath))
  if (target === '..' || target.startsWith('../')) return { entity: null, ignored: false, uncertain: true }

  if (root === 'origin') {
    if (afterMove && movedOriginPaths.has(target)) return { entity: null, ignored: false, uncertain: false }
    return { entity: originPaths.has(target) ? `origin:${target}` : null, ignored: false, uncertain: false }
  }
  if (afterMove && movedDestinations.has(target)) {
    const originPath = [...movedOriginPaths].find(([, destination]) => destination === target)?.[0]
    return { entity: originPath ? `origin:${originPath}` : null, ignored: false, uncertain: false }
  }
  return { entity: targetPaths.has(target) ? `target:${target}` : null, ignored: false, uncertain: false }
}

function classifyTransition(section: CrossRootImpactSection, before: string | null, after: string | null): void {
  if (before && !after) section.linksBreakingAfterMove += 1
  else if (!before && after) section.linksResolvingAfterMove += 1
  else if (before && after && before !== after) section.linksChangingResolution += 1
}

function remapPath(relativePath: string, mappings: readonly CrossRootMoveMapping[]): string | null {
  for (const mapping of mappings) {
    if (relativePath === mapping.sourceRelativePath) return mapping.destinationRelativePath
    if (mapping.isDirectory && relativePath.startsWith(`${mapping.sourceRelativePath}/`)) {
      return `${mapping.destinationRelativePath}/${relativePath.slice(mapping.sourceRelativePath.length + 1)}`
    }
  }
  return null
}

function normalize(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '')
}
