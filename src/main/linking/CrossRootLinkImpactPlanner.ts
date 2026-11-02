import * as path from 'path'
import { splitMarkdownTarget } from '../../shared/markdown/semantics'
import { resolveIndexedWikiTargetStatus } from '../indexing/WorkspaceIndexService'
import type {
  CrossRootImpactSection,
  CrossRootMoveImpactReport,
  CrossRootMoveMapping,
} from '../../shared/crossRootMoveImpact'
import type { IndexedDocument } from '../indexing/types'
import type { RuntimeWikiLink, WorkspaceWikiSnapshot } from '../indexing/wikiMetadata'
import { findWikiDocumentFile, type WikiFileCandidate } from '../localResourceResolver'
import { isBareWikiDocumentName } from '../../shared/markdown/wikiDocumentNames'
import { MARKDOWN_EXTENSIONS } from '../../shared/localMedia'

interface CrossRootImpactInput {
  originDocuments: readonly IndexedDocument[]
  targetDocuments: readonly IndexedDocument[]
  mappings: readonly CrossRootMoveMapping[]
  originWiki?: WorkspaceWikiSnapshot | null
  targetWiki?: WorkspaceWikiSnapshot | null
  originRoot?: string
  targetRoot?: string
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

export async function createCrossRootMoveImpactReport(input: CrossRootImpactInput): Promise<CrossRootMoveImpactReport> {
  const originPaths = new Set(input.originDocuments.map(document => document.relativePath))
  const targetPaths = new Set(input.targetDocuments.map(document => document.relativePath))
  const movedOriginPaths = new Map<string, string>()
  for (const document of input.originDocuments) {
    const destination = remapPath(document.relativePath, input.mappings)
    if (destination) movedOriginPaths.set(document.relativePath, destination)
  }
  const movedDestinations = new Set(movedOriginPaths.values())
  const originPathsAfterMove = new Set([...originPaths].filter(candidate => !movedOriginPaths.has(candidate)))
  const targetPathsAfterMove = new Set([...targetPaths, ...movedDestinations])
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

  const files = new Map<string, Promise<WikiFileCandidate>>()
  const deadline = performance.now() + 5000
  const linksFor = (document: IndexedDocument, snapshot?: WorkspaceWikiSnapshot | null): readonly RuntimeWikiLink[] => {
    const metadata = snapshot?.metadata.get(document.relativePath)
    return metadata?.revisionToken === document.revisionToken ? metadata.links : document.outboundLinks
  }
  const resolve = async (root: 'origin' | 'target', source: string, link: RuntimeWikiLink, after: boolean): Promise<ResolvedLink> => {
    const { decodedPath } = splitMarkdownTarget(link.rawTarget)
    const uncertain = { entity: null, ignored: false, uncertain: true }
    if (link.syntax === 'wiki' && link.wikiEmbed === undefined && isBareWikiDocumentName(decodedPath)
      && (input.originRoot || input.targetRoot)) return uncertain
    if (link.syntax !== 'wiki' || link.wikiEmbed !== false || !isBareWikiDocumentName(decodedPath)) {
      return resolveLink(root, source, link.rawTarget, link.syntax, originPaths, targetPaths, originPathsAfterMove, targetPathsAfterMove, movedOriginPaths, movedDestinations, after)
    }
    const snapshot = root === 'origin' ? input.originWiki : input.targetWiki
    const rootPath = root === 'origin' ? input.originRoot : input.targetRoot
    if (!rootPath || !snapshot?.isCurrent()) return uncertain
    const key = JSON.stringify([root, path.posix.dirname(source), decodedPath])
    let pending = files.get(key)
    if (!pending) {
      if (files.size >= 256 || performance.now() > deadline) return uncertain
      pending = findWikiDocumentFile(rootPath, path.join(rootPath, source), decodedPath)
      files.set(key, pending)
    }
    const file = await pending
    if (!snapshot.isCurrent()) return uncertain
    if (after) {
      const changedNames = root === 'origin' ? [...movedOriginPaths.keys()] : [...movedDestinations]
      if (changedNames.some(name => path.posix.basename(name).replace(/\.(?:md|markdown|mdown|mkd|mkdn)$/i, '') === decodedPath)) return uncertain
    }
    if (file.status === 'found') {
      if (!MARKDOWN_EXTENSIONS.has(path.extname(file.candidatePath ?? file.canonicalPath).toLowerCase())
        || !MARKDOWN_EXTENSIONS.has(path.extname(file.canonicalPath).toLowerCase())) return { entity: null, ignored: true, uncertain: false }
      const relative = path.relative(rootPath, file.canonicalPath).split(path.sep).join('/')
      return { entity: `${root}:${relative}`, ignored: false, uncertain: false }
    }
    if (file.status !== 'missing' || !snapshot.ready) return uncertain
    if (after && (!input.originWiki?.ready || !input.targetWiki?.ready
      || !input.originWiki.isCurrent() || !input.targetWiki.isCurrent())) return uncertain
    const entities = new Set<string>()
    for (const relative of snapshot.aliases.get(decodedPath) ?? []) {
      if (after && root === 'origin' && movedOriginPaths.has(relative)) continue
      entities.add(`${root}:${relative}`)
    }
    if (after && root === 'target') {
      for (const relative of input.originWiki!.aliases.get(decodedPath) ?? []) {
        if (movedOriginPaths.has(relative)) entities.add(`origin:${relative}`)
      }
    }
    return entities.size > 1 ? uncertain : { entity: [...entities][0] ?? null, ignored: false, uncertain: false }
  }

  for (const document of input.originDocuments) {
    const destinationPath = movedOriginPaths.get(document.relativePath)
    const section = destinationPath ? report.moved : report.origin
    section.markdownDocumentsScanned += 1
    for (const link of linksFor(document, input.originWiki)) {
      if (link.kind !== 'markdown') {
        report.coverage.ignoredLinks += 1
        continue
      }
      const before = await resolve('origin', document.relativePath, link, false)
      if (before.ignored) {
        report.coverage.ignoredLinks += 1
        continue
      }
      section.localMarkdownLinksExamined += 1
      const after = destinationPath
        ? await resolve('target', destinationPath, link, true)
        : await resolve('origin', document.relativePath, link, true)
      if (before.uncertain || after.uncertain) report.coverage.uncertainLinks += 1
      else classifyTransition(section, before.entity, after.entity)
    }
  }

  for (const document of input.targetDocuments) {
    report.target.markdownDocumentsScanned += 1
    for (const link of linksFor(document, input.targetWiki)) {
      if (link.kind !== 'markdown') {
        report.coverage.ignoredLinks += 1
        continue
      }
      const before = await resolve('target', document.relativePath, link, false)
      if (before.ignored) {
        report.coverage.ignoredLinks += 1
        continue
      }
      report.target.localMarkdownLinksExamined += 1
      const after = await resolve('target', document.relativePath, link, true)
      if (before.uncertain || after.uncertain) report.coverage.uncertainLinks += 1
      else classifyTransition(report.target, before.entity, after.entity)
    }
  }
  if ((input.originWiki && !input.originWiki.isCurrent()) || (input.targetWiki && !input.targetWiki.isCurrent())) {
    report.coverage.uncertainLinks = report.origin.localMarkdownLinksExamined + report.moved.localMarkdownLinksExamined + report.target.localMarkdownLinksExamined
    for (const section of [report.origin, report.moved, report.target]) {
      section.linksBreakingAfterMove = 0
      section.linksResolvingAfterMove = 0
      section.linksChangingResolution = 0
    }
  }
  return report
}

function resolveLink(
  root: 'origin' | 'target',
  sourceRelativePath: string,
  rawTarget: string,
  syntax: 'inline' | 'reference-definition' | 'autolink' | 'html' | 'wiki',
  originPaths: ReadonlySet<string>,
  targetPaths: ReadonlySet<string>,
  originPathsAfterMove: ReadonlySet<string>,
  targetPathsAfterMove: ReadonlySet<string>,
  movedOriginPaths: ReadonlyMap<string, string>,
  movedDestinations: ReadonlySet<string>,
  afterMove: boolean,
): ResolvedLink {
  const { decodedPath } = splitMarkdownTarget(rawTarget)
  if (!decodedPath || path.posix.isAbsolute(decodedPath)) return { entity: null, ignored: true, uncertain: false }
  const availablePaths = root === 'origin'
    ? afterMove ? originPathsAfterMove : originPaths
    : afterMove ? targetPathsAfterMove : targetPaths
  const wikiResolution = syntax === 'wiki'
    ? resolveIndexedWikiTargetStatus(availablePaths, sourceRelativePath, decodedPath)
    : null
  const target = wikiResolution?.target
    ?? (syntax === 'wiki' ? null : normalize(path.posix.join(path.posix.dirname(sourceRelativePath), decodedPath)))
  if (!target) return { entity: null, ignored: false, uncertain: wikiResolution?.ambiguous ?? false }
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
