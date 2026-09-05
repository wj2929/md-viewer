import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { validateNotProtected } from './security'

const ARCHIVE_ROOT = 'md-viewer-chart-examples'
const MANIFEST_NAME = 'manifest.json'
const MAX_ENTRY_COUNT = 120
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 3 * 1024 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const HASH_PATTERN = /^[a-f0-9]{64}$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/
const IGNORED_SYSTEM_FILES = new Set(['.DS_Store'])

type InstallFailureCode =
  | 'DESTINATION_EXISTS'
  | 'OUTPUT_NOT_WRITABLE'
  | 'ARCHIVE_INVALID'
  | 'EXTRACT_FAILED'

interface ManifestFile {
  name: string
  bytes: number
  sha256: string
}

interface ArchiveManifest {
  schemaVersion: '1.0' | '1.1'
  packageId: 'md-viewer-chart-examples'
  packageVersion: string
  files: ManifestFile[]
}

interface ValidatedFile extends ManifestFile {
  data: Buffer
}

interface ValidatedArchive {
  manifest: ArchiveManifest
  files: ValidatedFile[]
  manifestData: Buffer
}

export interface InstallChartExamplesOptions {
  destinationParent: string
  packageVersion: string
  zipBytes: Buffer
}

export interface InstalledChartExamples {
  directoryPath: string
  entryFilePath: string
  reusedExisting: boolean
  treeDirectories: string[]
}

export class ChartExamplesInstallError extends Error {
  constructor(
    readonly code: InstallFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ChartExamplesInstallError'
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > 512 || value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || value.startsWith('~') || /^[a-z]:/i.test(value) || value.startsWith('//')) return false
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false
  return path.posix.normalize(value) === value
}

function isSafeVersion(value: string): boolean {
  return VERSION_PATTERN.test(value)
}

function isArchiveManifest(value: unknown): value is ArchiveManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ArchiveManifest>
  if (
    !['1.0', '1.1'].includes(String(manifest.schemaVersion)) ||
    manifest.packageId !== 'md-viewer-chart-examples' ||
    typeof manifest.packageVersion !== 'string' ||
    !isSafeVersion(manifest.packageVersion) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.length >= MAX_ENTRY_COUNT
  ) return false

  const names = new Set<string>()
  let totalBytes = 0
  for (const candidate of manifest.files) {
    if (!candidate || typeof candidate !== 'object') return false
    const file = candidate as Partial<ManifestFile>
    if (
      typeof file.name !== 'string' ||
      !isSafeRelativePath(file.name) ||
      file.name === MANIFEST_NAME ||
      file.name.toLowerCase().endsWith('.zip') ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0 ||
      Number(file.bytes) > MAX_FILE_BYTES ||
      typeof file.sha256 !== 'string' ||
      !HASH_PATTERN.test(file.sha256)
    ) return false
    const foldedName = file.name.toLocaleLowerCase('en-US')
    if (names.has(foldedName)) return false
    names.add(foldedName)
    totalBytes += Number(file.bytes)
    if (totalBytes > MAX_TOTAL_BYTES) return false
  }
  return true
}

function assertRegularEntry(entry: AdmZip.IZipEntry): void {
  if (entry.isDirectory || entry.header.encripted) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包结构无效，请重新安装 MD Viewer。')
  }

  const creatorPlatform = (entry.header.made >>> 8) & 0xff
  if (creatorPlatform !== 3) return
  const unixMode = (entry.header.attr >>> 16) & 0xffff
  const fileType = unixMode & 0o170000
  if (fileType !== 0 && fileType !== 0o100000) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包包含不支持的文件类型，请重新安装 MD Viewer。')
  }
}

function readEntry(entry: AdmZip.IZipEntry, expectedBytes: number): Buffer {
  if (
    !Number.isSafeInteger(entry.header.size) ||
    entry.header.size < 0 ||
    entry.header.size !== expectedBytes ||
    expectedBytes > MAX_FILE_BYTES
  ) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包文件大小校验失败，请重新安装 MD Viewer。')
  }
  try {
    const data = entry.getData()
    if (data.byteLength !== expectedBytes) throw new Error('Unexpected extracted size')
    return data
  } catch (error) {
    throw new ChartExamplesInstallError(
      'ARCHIVE_INVALID',
      '内置图表示例包无法读取，请重新安装 MD Viewer。',
      { cause: error },
    )
  }
}

export function validateChartExamplesArchive(zipBytes: Buffer, packageVersion: string): ValidatedArchive {
  if (!isSafeVersion(packageVersion)) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包版本无效，请重新安装 MD Viewer。')
  }

  let entries: AdmZip.IZipEntry[]
  try {
    entries = new AdmZip(zipBytes).getEntries()
  } catch (error) {
    throw new ChartExamplesInstallError(
      'ARCHIVE_INVALID',
      '内置图表示例包无法解析，请重新安装 MD Viewer。',
      { cause: error },
    )
  }
  if (entries.length < 2 || entries.length > MAX_ENTRY_COUNT) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包条目数量无效，请重新安装 MD Viewer。')
  }

  const entriesByName = new Map<string, AdmZip.IZipEntry>()
  const foldedNames = new Set<string>()
  let declaredTotal = 0
  for (const entry of entries) {
    assertRegularEntry(entry)
    const entryName = entry.entryName
    const prefix = `${ARCHIVE_ROOT}/`
    if (!entryName.startsWith(prefix)) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包目录结构无效，请重新安装 MD Viewer。')
    }
    const relativeName = entryName.slice(prefix.length)
    if (!isSafeRelativePath(relativeName) || relativeName.toLowerCase().endsWith('.zip')) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包包含不安全路径，请重新安装 MD Viewer。')
    }
    const foldedName = relativeName.toLocaleLowerCase('en-US')
    if (foldedNames.has(foldedName)) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包包含重复路径，请重新安装 MD Viewer。')
    }
    foldedNames.add(foldedName)
    entriesByName.set(relativeName, entry)
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.header.size > MAX_FILE_BYTES) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包文件大小无效，请重新安装 MD Viewer。')
    }
    declaredTotal += entry.header.size
    if (declaredTotal > MAX_TOTAL_BYTES) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包解压体积超出限制，请重新安装 MD Viewer。')
    }
  }

  const manifestEntry = entriesByName.get(MANIFEST_NAME)
  if (!manifestEntry || manifestEntry.header.size > MAX_MANIFEST_BYTES) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包缺少有效清单，请重新安装 MD Viewer。')
  }
  const manifestData = readEntry(manifestEntry, manifestEntry.header.size)
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestData.toString('utf8'))
  } catch (error) {
    throw new ChartExamplesInstallError(
      'ARCHIVE_INVALID',
      '内置图表示例包清单无效，请重新安装 MD Viewer。',
      { cause: error },
    )
  }
  if (!isArchiveManifest(parsed) || parsed.packageVersion !== packageVersion) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包清单与应用资源不一致，请重新安装 MD Viewer。')
  }

  const expectedNames = new Set([MANIFEST_NAME, ...parsed.files.map(file => file.name)])
  if (expectedNames.size !== entriesByName.size || [...entriesByName.keys()].some(name => !expectedNames.has(name))) {
    throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包文件清单不一致，请重新安装 MD Viewer。')
  }

  const files = parsed.files.map(file => {
    const entry = entriesByName.get(file.name)
    if (!entry) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包缺少清单文件，请重新安装 MD Viewer。')
    }
    const data = readEntry(entry, file.bytes)
    if (sha256(data) !== file.sha256) {
      throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包文件完整性校验失败，请重新安装 MD Viewer。')
    }
    return { ...file, data }
  })

  return { manifest: parsed, files, manifestData }
}

function archiveTreeDirectories(archive: ValidatedArchive): string[] {
  const directories = new Set<string>()
  for (const file of archive.files) {
    const segments = file.name.split('/').slice(0, -1)
    for (let length = 1; length <= segments.length; length += 1) {
      directories.add(segments.slice(0, length).join('/'))
    }
  }
  return [...directories].sort()
}

function expectedDiskFiles(archive: ValidatedArchive): Map<string, { bytes: number; sha256: string }> {
  return new Map([
    ...archive.files.map(file => [file.name, { bytes: file.bytes, sha256: file.sha256 }] as const),
    [MANIFEST_NAME, { bytes: archive.manifestData.byteLength, sha256: sha256(archive.manifestData) }],
  ])
}

function expectedDirectories(files: Iterable<string>): Set<string> {
  const result = new Set<string>()
  for (const fileName of files) {
    let directory = path.posix.dirname(fileName)
    while (directory !== '.') {
      result.add(directory)
      directory = path.posix.dirname(directory)
    }
  }
  return result
}

async function validateInstalledDirectory(directoryPath: string, archive: ValidatedArchive): Promise<boolean> {
  try {
    const rootStats = await lstat(directoryPath)
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return false
    const expectedFiles = expectedDiskFiles(archive)
    const expectedDirs = expectedDirectories(expectedFiles.keys())
    const seenFiles = new Set<string>()
    const seenDirs = new Set<string>()

    const walk = async (currentPath: string, relativeDirectory = ''): Promise<void> => {
      for (const entry of await readdir(currentPath, { withFileTypes: true })) {
        if (IGNORED_SYSTEM_FILES.has(entry.name)) continue
        const relativeName = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name
        if (!isSafeRelativePath(relativeName)) throw new Error('unsafe disk path')
        const entryPath = path.join(currentPath, entry.name)
        const entryStats = await lstat(entryPath)
        if (entryStats.isSymbolicLink()) throw new Error('symbolic link')
        if (entryStats.isDirectory()) {
          if (!expectedDirs.has(relativeName)) throw new Error('unexpected directory')
          seenDirs.add(relativeName)
          await walk(entryPath, relativeName)
          continue
        }
        if (!entryStats.isFile()) throw new Error('special file')
        const expected = expectedFiles.get(relativeName)
        if (!expected || entryStats.size !== expected.bytes) throw new Error('unexpected file')
        const bytes = await readFile(entryPath)
        if (sha256(bytes) !== expected.sha256) throw new Error('hash mismatch')
        seenFiles.add(relativeName)
      }
    }

    await walk(directoryPath)
    return seenFiles.size === expectedFiles.size && seenDirs.size === expectedDirs.size
  } catch {
    return false
  }
}

function isWriteError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : ''
  return ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT'].includes(code)
}

export async function installChartExamples(
  options: InstallChartExamplesOptions,
): Promise<InstalledChartExamples> {
  const archive = validateChartExamplesArchive(options.zipBytes, options.packageVersion)
  const treeDirectories = archiveTreeDirectories(archive)
  let parentPath: string
  try {
    parentPath = await realpath(options.destinationParent)
    const parentStats = await stat(parentPath)
    if (!parentStats.isDirectory()) throw new Error('Destination parent is not a directory')
    validateNotProtected(parentPath)
  } catch (error) {
    throw new ChartExamplesInstallError(
      isWriteError(error) ? 'OUTPUT_NOT_WRITABLE' : 'EXTRACT_FAILED',
      '无法访问 MD Viewer 的示例数据目录，请检查应用数据目录权限后重试。',
      { cause: error },
    )
  }

  const directoryName = `${ARCHIVE_ROOT}-v${options.packageVersion}`
  const targetPath = path.join(parentPath, directoryName)
  validateNotProtected(targetPath)

  try {
    const existingStats = await lstat(targetPath)
    if (existingStats && await validateInstalledDirectory(targetPath, archive)) {
      return {
        directoryPath: targetPath,
        entryFilePath: path.join(targetPath, 'README.md'),
        reusedExisting: true,
        treeDirectories,
      }
    }
    throw new ChartExamplesInstallError(
      'DESTINATION_EXISTS',
      `应用管理的“${directoryName}”内容已发生变化。为避免覆盖，未重新安装示例；如需原始内容，可使用“仅导出 ZIP”。`,
    )
  } catch (error) {
    if (error instanceof ChartExamplesInstallError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ChartExamplesInstallError(
        isWriteError(error) ? 'OUTPUT_NOT_WRITABLE' : 'EXTRACT_FAILED',
        '无法检查 MD Viewer 的示例数据目录，请重试。',
        { cause: error },
      )
    }
  }

  let stagingPath: string | null = null
  try {
    stagingPath = await mkdtemp(path.join(parentPath, '.md-viewer-chart-examples-'))
    const stagingRoot = path.resolve(stagingPath)
    for (const file of archive.files) {
      const outputPath = path.resolve(stagingRoot, ...file.name.split('/'))
      const relativeOutput = path.relative(stagingRoot, outputPath)
      if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
        throw new ChartExamplesInstallError('ARCHIVE_INVALID', '内置图表示例包包含不安全路径，请重新安装 MD Viewer。')
      }
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, file.data, { flag: 'wx', mode: 0o600 })
    }
    await writeFile(path.join(stagingRoot, MANIFEST_NAME), archive.manifestData, { flag: 'wx', mode: 0o600 })

    if (!await validateInstalledDirectory(stagingRoot, archive)) {
      throw new ChartExamplesInstallError('EXTRACT_FAILED', '离线图表示例准备失败，请重试。')
    }

    try {
      await rename(stagingRoot, targetPath)
      stagingPath = null
    } catch (error) {
      let targetExists = false
      try {
        await lstat(targetPath)
        targetExists = true
      } catch (targetError) {
        if ((targetError as NodeJS.ErrnoException).code !== 'ENOENT') throw targetError
      }
      if (targetExists) {
        if (await validateInstalledDirectory(targetPath, archive)) {
          return {
            directoryPath: targetPath,
            entryFilePath: path.join(targetPath, 'README.md'),
            reusedExisting: true,
        treeDirectories,
          }
        }
        throw new ChartExamplesInstallError(
          'DESTINATION_EXISTS',
          `应用管理的“${directoryName}”内容已发生变化。为避免覆盖，未重新安装示例；如需原始内容，可使用“仅导出 ZIP”。`,
        )
      }
      throw error
    }

    return {
      directoryPath: targetPath,
      entryFilePath: path.join(targetPath, 'README.md'),
      reusedExisting: false,
      treeDirectories,
    }
  } catch (error) {
    if (error instanceof ChartExamplesInstallError) throw error
    throw new ChartExamplesInstallError(
      isWriteError(error) ? 'OUTPUT_NOT_WRITABLE' : 'EXTRACT_FAILED',
      isWriteError(error)
        ? '无法写入 MD Viewer 的示例数据目录，请检查目录权限后重试。'
        : '离线图表示例准备失败，请重试。',
      { cause: error },
    )
  } finally {
    if (stagingPath) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
