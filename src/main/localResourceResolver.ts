import path from 'node:path'
import { readdir } from 'node:fs'
import { readdir as readdirAsync } from 'node:fs/promises'
import { isBareWikiDocumentName } from '../shared/markdown/wikiDocumentNames'
import * as fs from 'fs-extra'
import { escape, glob } from 'glob'
import type { IPCContext } from './ipc/context'
import { validateSecurePathInBase } from './security'
import { validateSenderReadPath } from './ipc/senderSecurity'
import {
  MARKDOWN_EXTENSIONS,
  MAX_LOCAL_RESOURCE_PATH_LENGTH,
  isSafeLocalResourceReference,
  type LocalResourceResolutionKind,
} from '../shared/localMedia'

export interface AuthorizedWorkspaceResource {
  canonicalPath: string
  canonicalRoot: string
  workspaceId: string
  lifecycleEpoch: number
  markdownPath: string
}

export type WikiFileCandidate =
  | { status: 'found'; canonicalPath: string; candidatePath?: string }
  | { status: 'missing' | 'ambiguous' | 'unavailable' | 'invalid' }

const wikiCandidateFlights = new Map<string, Promise<string[]>>()

export async function resolveAuthorizedWorkspaceResource(
  ctx: IPCContext,
  event: Electron.IpcMainInvokeEvent,
  markdownFilePath: string,
  rawResourcePath: string,
  resolutionKind: LocalResourceResolutionKind,
  options: { allowExtensionlessMarkdown?: boolean } = {},
): Promise<AuthorizedWorkspaceResource> {
  if (
    typeof markdownFilePath !== 'string'
    || typeof rawResourcePath !== 'string'
    || rawResourcePath.length > MAX_LOCAL_RESOURCE_PATH_LENGTH
  ) throw new Error('安全错误：本地资源请求无效')

  const markdownPath = await validateSenderReadPath(ctx, event, markdownFilePath)
  const window = ctx.windowManager.getWindowByWebContentsId(event.sender.id)
  if (!window) throw new Error('安全错误：当前窗口无效')

  let owner: { id: string; primaryRoot: string; lifecycleEpoch: number } | null = null
  for (const workspace of ctx.windowManager.listWorkspaces(window.id)) {
    if (!workspace.primaryRoot) continue
    try {
      await validateSecurePathInBase(markdownPath, workspace.primaryRoot)
      owner = { ...workspace, primaryRoot: workspace.primaryRoot }
      break
    } catch {
      // 继续尝试该窗口中的其他工作区。
    }
  }
  if (!owner) throw new Error('安全错误：文档不属于当前窗口的工作区')

  let decoded: string
  try {
    decoded = decodeURIComponent(rawResourcePath).trim()
  } catch {
    throw new Error('安全错误：本地资源路径编码无效')
  }
  if (!isSafeLocalResourceReference(decoded)) {
    throw new Error('安全错误：本地资源必须使用安全相对路径')
  }

  const canonicalRoot = await fs.realpath(owner.primaryRoot)
  const candidates = resolutionKind === 'markdown-relative'
    ? [path.resolve(path.dirname(markdownPath), decoded)]
    : await resolveWikiCandidates(canonicalRoot, markdownPath, decoded, options.allowExtensionlessMarkdown === true)

  const canonicalCandidates: string[] = []
  for (const candidate of candidates) {
    try {
      const canonical = await validateSecurePathInBase(candidate, canonicalRoot)
      const stats = await fs.stat(canonical)
      if (stats.isFile() && !canonicalCandidates.includes(canonical)) canonicalCandidates.push(canonical)
    } catch {
      // 候选不存在、越界或属于受保护路径时忽略。
    }
  }

  if (canonicalCandidates.length === 0) throw new Error('安全错误：本地资源不存在或不在工作区内')
  if (canonicalCandidates.length > 1) throw new Error('安全错误：Wiki 资源目标不唯一，请使用工作区相对路径')

  return {
    canonicalPath: canonicalCandidates[0],
    canonicalRoot,
    workspaceId: owner.id,
    lifecycleEpoch: owner.lifecycleEpoch,
    markdownPath,
  }
}

async function resolveWikiCandidates(
  root: string,
  markdownPath: string,
  resourcePath: string,
  allowExtensionlessMarkdown: boolean,
): Promise<string[]> {
  const key = JSON.stringify([
    root,
    path.dirname(markdownPath),
    resourcePath,
    allowExtensionlessMarkdown,
  ])
  const existing = wikiCandidateFlights.get(key)
  if (existing) return existing

  const pending = resolveWikiCandidatesUncached(
    root,
    markdownPath,
    resourcePath,
    allowExtensionlessMarkdown,
  )
  wikiCandidateFlights.set(key, pending)
  try {
    return await pending
  } finally {
    if (wikiCandidateFlights.get(key) === pending) wikiCandidateFlights.delete(key)
  }
}

async function resolveWikiCandidatesUncached(
  root: string,
  markdownPath: string,
  resourcePath: string,
  allowExtensionlessMarkdown: boolean,
): Promise<string[]> {
  const hasDirectory = /[\\/]/.test(resourcePath)
  const requestedNames = expandMarkdownNames(resourcePath, allowExtensionlessMarkdown)
  if (hasDirectory) {
    for (const name of requestedNames) {
      const local = path.resolve(path.dirname(markdownPath), name)
      if (await fs.pathExists(local)) return [local]
    }
    for (const name of requestedNames) {
      const atRoot = path.resolve(root, name)
      if (await fs.pathExists(atRoot)) return [atRoot]
    }
    return []
  }

  const candidates: string[] = []
  for (const name of requestedNames) {
    const local = path.resolve(path.dirname(markdownPath), name)
    if (await fs.pathExists(local)) candidates.push(local)
  }
  if (candidates.length > 0) return candidates

  for (const name of requestedNames) {
    const atRoot = path.resolve(root, name)
    if (await fs.pathExists(atRoot)) candidates.push(atRoot)
  }
  if (candidates.length > 0) return candidates

  for (const name of requestedNames) {
    const matches = await glob(`**/${escape(name)}`, {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
      follow: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/.claude/**'],
    })
    candidates.push(...matches)
  }
  return candidates
}

export async function findWikiDocumentFile(
  root: string,
  sourcePath: string,
  name: string,
): Promise<WikiFileCandidate> {
  if (!isBareWikiDocumentName(name)) return { status: 'invalid' }
  try {
    const canonicalRoot = await fs.realpath(root)
    const source = await validateSecurePathInBase(sourcePath, canonicalRoot)
    const inspect = async (candidates: string[]): Promise<WikiFileCandidate> => {
      const files = new Map<string, string>()
      for (const candidate of candidates) {
        const canonical = await validateSecurePathInBase(candidate, canonicalRoot)
        try {
          if (!(await fs.stat(canonical)).isFile()) return { status: 'unavailable' }
          files.set(canonical, candidate)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (files.size > 1) return { status: 'ambiguous' }
      const first = [...files][0]
      return first ? { status: 'found', canonicalPath: first[0], ...(first[0] !== first[1] ? { candidatePath: first[1] } : {}) }
        : { status: 'missing' }
    }
    const nameGroups = [
      ...(path.extname(name) ? [[name]] : []),
      [...MARKDOWN_EXTENSIONS].map(extension => `${name}${extension}`),
    ]
    for (const names of nameGroups) {
      for (const directory of new Set([path.dirname(source), canonicalRoot])) {
        const result = await inspect(names.map(value => path.join(directory, value)))
        if (result.status !== 'missing') return result
      }
      let incomplete = false
      const observeError = (error: NodeJS.ErrnoException | null) => {
        if (error && error.code !== 'ENOENT') incomplete = true
      }
      // glob treats readdir failures as empty directories; missing must remain a complete observation.
      const matches = await glob(names.map(value => `**/${escape(value)}`), {
        cwd: canonicalRoot, absolute: true, nodir: true, dot: false, follow: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/.claude/**'],
        fs: {
          readdir: (directory, options, callback) => readdir(directory, options, (error, entries) => {
            observeError(error)
            callback(error, entries)
          }),
          promises: {
            readdir: async (directory, options) => {
              try { return await readdirAsync(directory, options) }
              catch (error) { observeError(error as NodeJS.ErrnoException); throw error }
            },
          },
        },
      })
      if (incomplete) return { status: 'unavailable' }
      const result = await inspect(matches)
      if (result.status !== 'missing') return result
    }
    return { status: 'missing' }
  } catch {
    return { status: 'unavailable' }
  }
}

function expandMarkdownNames(value: string, allowExtensionlessMarkdown: boolean): string[] {
  if (!allowExtensionlessMarkdown || path.extname(value)) return [value]
  return [...MARKDOWN_EXTENSIONS].map(extension => `${value}${extension}`)
}
