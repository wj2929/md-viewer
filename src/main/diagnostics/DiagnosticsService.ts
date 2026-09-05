import AdmZip from 'adm-zip'
import { createHmac, randomBytes } from 'crypto'
import { mkdir, rename, writeFile } from 'fs/promises'
import * as path from 'path'
import type { WorkspaceIndexStatus } from '../indexing/types'

export const DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = '1.0' as const

export interface DiagnosticsBundleInput {
  app: {
    version: string
    electron: string
    node: string
    chrome: string
    platform: string
    arch: string
  }
  packaging?: {
    packaged: boolean
    runtimeDependencyCheck?: 'passed' | 'failed' | 'unknown'
    resourceCheck?: 'passed' | 'failed' | 'unknown'
    localeCheck?: 'passed' | 'failed' | 'unknown'
    fontCheck?: 'passed' | 'failed' | 'unknown'
  }
  index?: WorkspaceIndexStatus
  session?: {
    schemaVersion: number
    windows: number
    workspaces: number
    tabs: number
    splitLeaves: number
  }
  docx?: {
    configured: boolean
    reachable?: boolean
    status?: 'ok' | 'unavailable' | 'not-configured' | 'unknown'
    version?: string
  }
  tts?: {
    providers: Array<{
      type: 'system' | 'edge' | 'openai' | 'azure'
      enabled: boolean
      hasApiKey: boolean
    }>
  }
  errors?: Array<{
    category: string
    code?: string
    path?: string
  }>
}

export interface DiagnosticsBundleResult {
  outputPath: string
  bytes: number
  entries: string[]
}

export async function createDiagnosticsBundle(
  outputPath: string,
  input: DiagnosticsBundleInput,
): Promise<DiagnosticsBundleResult> {
  const absoluteOutput = path.resolve(outputPath)
  if (path.extname(absoluteOutput).toLowerCase() !== '.zip') {
    throw new Error('诊断包输出路径必须以 .zip 结尾')
  }
  await mkdir(path.dirname(absoluteOutput), { recursive: true })
  const bundleKey = randomBytes(32)
  const sanitized = sanitizeBundleInput(input, bundleKey)
  const zip = new AdmZip()
  const entries = ['diagnostics.json', 'README.txt']
  zip.addFile('diagnostics.json', Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`, 'utf8'))
  zip.addFile('README.txt', Buffer.from([
    'MD Viewer 本地诊断包',
    '',
    '此诊断包由字段白名单生成，不包含 Markdown 正文、文件名、绝对路径、搜索词、语音文本或 API Key。',
    '路径仅在本诊断包内使用随机 token 关联；不同诊断包之间无法关联。',
    '诊断包不会自动上传，也不发送遥测。',
    '',
  ].join('\n'), 'utf8'))
  const temporaryPath = `${absoluteOutput}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, zip.toBuffer(), { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, absoluteOutput)
  } catch (error) {
    const { unlink } = await import('fs/promises')
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  const bytes = zip.toBuffer().byteLength
  return { outputPath: absoluteOutput, bytes, entries }
}

export function sanitizeBundleInput(input: DiagnosticsBundleInput, bundleKey: Buffer): Record<string, unknown> {
  return {
    schemaVersion: DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
    app: {
      version: scalar(input.app.version),
      electron: scalar(input.app.electron),
      node: scalar(input.app.node),
      chrome: scalar(input.app.chrome),
      platform: scalar(input.app.platform),
      arch: scalar(input.app.arch),
    },
    ...(input.packaging ? { packaging: { ...input.packaging } } : {}),
    ...(input.index ? {
      index: {
        state: input.index.state,
        generation: input.index.generation,
        indexedDocuments: input.index.indexedDocuments,
        totalDocuments: input.index.totalDocuments,
        pendingDocuments: input.index.pendingDocuments,
        errors: input.index.errors,
      },
    } : {}),
    ...(input.session ? { session: { ...input.session } } : {}),
    ...(input.docx ? {
      docx: {
        configured: input.docx.configured,
        ...(input.docx.reachable !== undefined ? { reachable: input.docx.reachable } : {}),
        ...(input.docx.status ? { status: input.docx.status } : {}),
        ...(input.docx.version ? { version: scalar(input.docx.version) } : {}),
      },
    } : {}),
    ...(input.tts ? {
      tts: {
        providerCounts: countTtsProviders(input.tts.providers),
        enabled: input.tts.providers.filter(provider => provider.enabled).length,
        paidProvidersWithApiKey: input.tts.providers.filter(provider =>
          (provider.type === 'openai' || provider.type === 'azure') && provider.hasApiKey
        ).length,
      },
    } : {}),
    errors: (input.errors ?? []).slice(0, 100).map(error => ({
      category: scalar(error.category),
      ...(error.code ? { code: scalar(error.code) } : {}),
      ...(error.path ? { pathToken: pathToken(bundleKey, error.path) } : {}),
    })),
  }
}

function countTtsProviders(
  providers: NonNullable<DiagnosticsBundleInput['tts']>['providers'],
): Record<string, number> {
  const counts: Record<string, number> = { system: 0, edge: 0, openai: 0, azure: 0 }
  for (const provider of providers) {
    counts[provider.type] += 1
  }
  return counts
}

function pathToken(key: Buffer, value: string): string {
  return `path_${createHmac('sha256', key).update(path.resolve(value)).digest('hex').slice(0, 24)}`
}

function scalar(value: string): string {
  return value.replace(/[\r\n\0]/g, ' ').slice(0, 160)
}
