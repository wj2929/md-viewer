import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import type {
  ChartExamplesStatus,
  InstallChartExamplesResult,
  SaveChartExamplesResult,
} from '../../shared/chartExamples'
import { activateFolderForWindow } from '../folderActivation'
import {
  ChartExamplesInstallError,
  installChartExamples,
} from '../chartExamplesInstaller'
import type { IPCContext } from './context'
import { getSenderWindow } from './senderSecurity'

const EXAMPLES_FILENAME = 'md-viewer-chart-examples.zip'
const MANIFEST_FILENAME = 'md-viewer-chart-examples.manifest.json'
const MAX_EXAMPLES_BYTES = 5 * 1024 * 1024

interface ChartExamplesManifest {
  schemaVersion: '1.0' | '1.1'
  packageId: 'md-viewer-chart-examples'
  packageVersion: string
  minAppVersion: string
  maxAppVersion: string
  filename: string
  bytes: number
  sha256: string
  caseCount: number
  totalCaseCount?: number
  designCaseCount?: number
  galleryCaseCount?: number
  starterCount?: number
  assetCount?: number
  remoteCaseCount?: number
  rendererCount: number
  countsByCollection?: Record<string, number>
  countsByRenderer?: Record<string, number>
}

interface ResolvedExamples {
  zipPath: string
  manifest: ChartExamplesManifest
}

interface ResolveExamplesResult {
  resolved?: ResolvedExamples
  foundInvalid: boolean
}

function examplesDirectories(): string[] {
  const packagedDirectory = path.join(process.resourcesPath || '', 'examples')
  if (app.isPackaged) return [packagedDirectory]

  const candidates = [
    path.join(process.cwd(), 'resources', 'examples'),
    path.join(app.getAppPath(), 'resources', 'examples'),
    packagedDirectory,
  ]
  return [...new Set(candidates)]
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(count => Number.isSafeInteger(count) && Number(count) >= 0)
}

function isManifest(value: unknown): value is ChartExamplesManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ChartExamplesManifest>
  const baseValid = ['1.0', '1.1'].includes(String(manifest.schemaVersion)) &&
    manifest.packageId === 'md-viewer-chart-examples' &&
    typeof manifest.packageVersion === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(manifest.packageVersion) &&
    typeof manifest.minAppVersion === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(manifest.minAppVersion) &&
    typeof manifest.maxAppVersion === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(manifest.maxAppVersion) &&
    manifest.filename === EXAMPLES_FILENAME &&
    Number.isSafeInteger(manifest.bytes) && Number(manifest.bytes) > 0 && Number(manifest.bytes) <= MAX_EXAMPLES_BYTES &&
    typeof manifest.sha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.sha256) &&
    Number.isSafeInteger(manifest.caseCount) && Number(manifest.caseCount) > 0 &&
    Number.isSafeInteger(manifest.rendererCount) && Number(manifest.rendererCount) > 0
  if (!baseValid) return false
  if (manifest.schemaVersion === '1.0') return true

  return Number.isSafeInteger(manifest.totalCaseCount) && manifest.totalCaseCount === manifest.caseCount &&
    Number.isSafeInteger(manifest.designCaseCount) && Number(manifest.designCaseCount) > 0 &&
    Number.isSafeInteger(manifest.galleryCaseCount) && Number(manifest.galleryCaseCount) > 0 &&
    Number(manifest.designCaseCount) + Number(manifest.galleryCaseCount) === manifest.totalCaseCount &&
    Number.isSafeInteger(manifest.starterCount) && Number(manifest.starterCount) > 0 &&
    Number.isSafeInteger(manifest.assetCount) && Number(manifest.assetCount) >= 0 &&
    Number.isSafeInteger(manifest.remoteCaseCount) && Number(manifest.remoteCaseCount) >= 0 &&
    isCountRecord(manifest.countsByCollection) &&
    isCountRecord(manifest.countsByRenderer)
}

async function resolveExamples(): Promise<ResolveExamplesResult> {
  let foundInvalid = false
  for (const directory of examplesDirectories()) {
    const zipPath = path.join(directory, EXAMPLES_FILENAME)
    const manifestPath = path.join(directory, MANIFEST_FILENAME)
    const zipExists = existsSync(zipPath)
    const manifestExists = existsSync(manifestPath)
    if (!zipExists && !manifestExists) continue
    if (!zipExists || !manifestExists) {
      foundInvalid = true
      continue
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (isManifest(parsed)) return { resolved: { zipPath, manifest: parsed }, foundInvalid }
      foundInvalid = true
    } catch {
      foundInvalid = true
    }
  }
  return { foundInvalid }
}

function status(
  state: ChartExamplesStatus['state'],
  message: string,
  appVersion: string,
  manifest?: ChartExamplesManifest,
): ChartExamplesStatus {
  return {
    state,
    appVersion,
    message,
    ...(manifest ? {
      packageVersion: manifest.packageVersion,
      bytes: manifest.bytes,
      caseCount: manifest.caseCount,
      rendererCount: manifest.rendererCount,
      ...(manifest.schemaVersion === '1.1' ? {
        totalCaseCount: manifest.totalCaseCount,
        designCaseCount: manifest.designCaseCount,
        galleryCaseCount: manifest.galleryCaseCount,
        starterCount: manifest.starterCount,
        assetCount: manifest.assetCount,
        remoteCaseCount: manifest.remoteCaseCount,
        countsByCollection: manifest.countsByCollection,
        countsByRenderer: manifest.countsByRenderer,
      } : {}),
    } : {}),
  }
}

async function currentAppVersion(): Promise<string> {
  if (!app.isPackaged) {
    const packageCandidates = [
      path.join(process.cwd(), 'package.json'),
      path.join(app.getAppPath(), 'package.json'),
      path.resolve(app.getAppPath(), '..', '..', 'package.json'),
    ]
    for (const packagePath of [...new Set(packageCandidates)]) {
      try {
        const packageJson: unknown = JSON.parse(await readFile(packagePath, 'utf8'))
        if (
          packageJson && typeof packageJson === 'object' &&
          'version' in packageJson && typeof packageJson.version === 'string'
        ) {
          return packageJson.version
        }
      } catch { /* try the next development package location */ }
    }
  }
  return app.getVersion()
}

async function readVerifiedZip(resolved: ResolvedExamples): Promise<Buffer> {
  const zipStat = await stat(resolved.zipPath)
  if (
    !zipStat.isFile() ||
    zipStat.size !== resolved.manifest.bytes ||
    zipStat.size > MAX_EXAMPLES_BYTES
  ) throw new Error('Invalid chart examples size')

  const bytes = await readFile(resolved.zipPath)
  if (
    bytes.byteLength !== resolved.manifest.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== resolved.manifest.sha256
  ) throw new Error('Invalid chart examples digest')
  return bytes
}

async function inspectExamples(): Promise<{ status: ChartExamplesStatus; resolved?: ResolvedExamples }> {
  const appVersion = await currentAppVersion()
  const resolution = await resolveExamples()
  const resolved = resolution.resolved
  if (!resolved) {
    return {
      status: resolution.foundInvalid
        ? status('corrupt', '内置图表示例包资源不完整或清单无效，请重新安装 MD Viewer。', appVersion)
        : status('missing', '未找到内置图表示例包，请重新安装 MD Viewer。', appVersion),
    }
  }

  const { manifest } = resolved
  if (appVersion !== manifest.minAppVersion || appVersion !== manifest.maxAppVersion) {
    return {
      status: status('incompatible', '内置图表示例包与当前应用版本不兼容，请重新安装匹配版本。', appVersion, manifest),
    }
  }

  try {
    await readVerifiedZip(resolved)
  } catch {
    return {
      status: status('corrupt', '内置图表示例包完整性校验失败，请重新安装 MD Viewer。', appVersion, manifest),
    }
  }

  return {
    status: status('ready', '内置离线示例包已就绪，无需联网。', appVersion, manifest),
    resolved,
  }
}

function saveErrorCode(error: unknown): SaveChartExamplesResult['error'] {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''
  if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(code)) {
    return { code: 'OUTPUT_NOT_WRITABLE', message: '无法写入所选位置，请更换保存位置后重试。' }
  }
  return { code: 'SAVE_FAILED', message: '保存离线图表示例包失败，请重试。' }
}

function unavailableResult(examplesStatus: ChartExamplesStatus): SaveChartExamplesResult {
  const code = examplesStatus.state === 'corrupt'
    ? 'EXAMPLES_CORRUPT'
    : examplesStatus.state === 'incompatible'
      ? 'EXAMPLES_INCOMPATIBLE'
      : 'EXAMPLES_MISSING'
  return {
    canceled: false,
    error: { code, message: examplesStatus.message },
  }
}

function unavailableInstallResult(examplesStatus: ChartExamplesStatus): InstallChartExamplesResult {
  const code = examplesStatus.state === 'corrupt'
    ? 'EXAMPLES_CORRUPT'
    : examplesStatus.state === 'incompatible'
      ? 'EXAMPLES_INCOMPATIBLE'
      : 'EXAMPLES_MISSING'
  return {
    canceled: false,
    error: { code, message: examplesStatus.message },
  }
}

function installErrorResult(error: unknown): InstallChartExamplesResult {
  if (error instanceof ChartExamplesInstallError) {
    return {
      canceled: false,
      error: { code: error.code, message: error.message },
    }
  }
  return {
    canceled: false,
    error: { code: 'EXTRACT_FAILED', message: '离线图表示例准备失败，请重试。' },
  }
}

export function registerExampleHandlers(ctx: IPCContext): void {
  ipcMain.handle('examples:getChartExamplesStatus', async (): Promise<ChartExamplesStatus> => {
    return (await inspectExamples()).status
  })

  ipcMain.handle('examples:installChartExamples', async (event): Promise<InstallChartExamplesResult> => {
    const window = getSenderWindow(ctx, event)
    const inspection = await inspectExamples()
    if (!inspection.resolved) return unavailableInstallResult(inspection.status)

    const managedParent = path.join(app.getPath('userData'), 'chart-examples')
    let installed
    try {
      await mkdir(managedParent, { recursive: true, mode: 0o700 })
      const zipBytes = await readVerifiedZip(inspection.resolved)
      installed = await installChartExamples({
        destinationParent: managedParent,
        packageVersion: inspection.resolved.manifest.packageVersion,
        zipBytes,
      })
    } catch (error) {
      return installErrorResult(error)
    }

    if (!installed.reusedExisting && installed.treeDirectories?.length > 0) {
      try {
        ctx.appDataManager.saveFolderTreeState(
          installed.directoryPath,
          Object.fromEntries(installed.treeDirectories.map(treePath => [treePath, false])),
        )
      } catch (error) {
        console.warn('[ChartExamples] Failed to initialize collapsed folder tree:', error)
      }
    }

    try {
      const activation = await activateFolderForWindow(ctx, window, installed.directoryPath)
      return {
        canceled: false,
        activation,
        entryFilePath: installed.entryFilePath,
        reusedExisting: installed.reusedExisting,
      }
    } catch {
      return {
        canceled: false,
        error: {
          code: 'ACTIVATION_FAILED',
          message: '示例已准备完成，但无法打开工作区。请稍后通过“打开文件夹”重试。',
        },
      }
    }
  })

  ipcMain.handle('examples:saveChartExamples', async (event): Promise<SaveChartExamplesResult> => {
    const window = getSenderWindow(ctx, event)
    const inspection = await inspectExamples()
    if (!inspection.resolved) return unavailableResult(inspection.status)

    const initialManifest = inspection.resolved.manifest
    const result = await dialog.showSaveDialog(window, {
      title: '保存 MD Viewer 离线图表示例包',
      defaultPath: `md-viewer-chart-examples-v${initialManifest.packageVersion}.zip`,
      filters: [{ name: 'ZIP 示例包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    const latestInspection = await inspectExamples()
    if (!latestInspection.resolved) return unavailableResult(latestInspection.status)
    const { zipPath, manifest } = latestInspection.resolved
    const outputPath = path.extname(result.filePath).toLowerCase() === '.zip'
      ? result.filePath
      : `${result.filePath}.zip`
    try {
      await copyFile(zipPath, outputPath)
      return {
        canceled: false,
        filePath: outputPath,
        packageVersion: manifest.packageVersion,
        bytes: manifest.bytes,
      }
    } catch (error) {
      return { canceled: false, error: saveErrorCode(error) }
    }
  })
}
