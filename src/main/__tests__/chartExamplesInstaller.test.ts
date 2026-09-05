// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChartExamplesInstallError,
  installChartExamples,
  validateChartExamplesArchive,
} from '../chartExamplesInstaller'

const temporaryDirectories: string[] = []

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function createArchive(
  files: Array<{ name: string; data: Buffer }> = [
    { name: 'README.md', data: Buffer.from('# Examples\n') },
    { name: 'guide/start.md', data: Buffer.from('# Start\n') },
  ],
  options: {
    manifestFiles?: Array<{ name: string; bytes: number; sha256: string }>
    packageVersion?: string
    extraEntries?: Array<{ name: string; data: Buffer; attr?: number }>
  } = {},
): Buffer {
  const zip = new AdmZip()
  const manifest = {
    schemaVersion: '1.0',
    packageId: 'md-viewer-chart-examples',
    packageVersion: options.packageVersion ?? '2.8.0',
    minAppVersion: '2.8.0',
    maxAppVersion: '2.8.0',
    caseCount: 1,
    rendererCount: 1,
    languages: { mermaid: 1 },
    files: options.manifestFiles ?? files.map(file => ({
      name: file.name,
      bytes: file.data.byteLength,
      sha256: digest(file.data),
    })),
  }
  for (const file of files) {
    zip.addFile(`md-viewer-chart-examples/${file.name}`, file.data)
  }
  zip.addFile('md-viewer-chart-examples/manifest.json', Buffer.from(JSON.stringify(manifest)))
  for (const entry of options.extraEntries ?? []) {
    zip.addFile(entry.name, entry.data, '', entry.attr)
  }
  return zip.toBuffer()
}

async function createDestination(): Promise<string> {
  const directory = await mkdtemp(path.join(process.cwd(), '.chart-examples-installer-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('chartExamplesInstaller', () => {
  it('installs the real fixed archive and reuses only an exact existing copy', async () => {
    const destinationParent = await createDestination()
    const zipBytes = await readFile(path.join(
      process.cwd(),
      'resources/examples/md-viewer-chart-examples.zip',
    ))

    const first = await installChartExamples({
      destinationParent,
      packageVersion: '2.8.0-r4',
      zipBytes,
    })
    expect(first.reusedExisting).toBe(false)
    expect(first.directoryPath).toBe(path.join(destinationParent, 'md-viewer-chart-examples-v2.8.0-r4'))
    expect(first.treeDirectories).toContain('03-renderer-gallery/service-renderers')
    expect(await readFile(first.entryFilePath, 'utf8')).toContain('# MD Viewer 图表示例')

    await writeFile(path.join(first.directoryPath, '.DS_Store'), 'Finder metadata')
    await writeFile(path.join(first.directoryPath, '02-design-reference', '.DS_Store'), 'Finder metadata')

    const second = await installChartExamples({
      destinationParent,
      packageVersion: '2.8.0-r4',
      zipBytes,
    })
    expect(second).toEqual({ ...first, reusedExisting: true })
  })

  it('handles concurrent publication without overwriting the completed target', async () => {
    const destinationParent = await createDestination()
    const zipBytes = createArchive()
    const results = await Promise.all([
      installChartExamples({ destinationParent, packageVersion: '2.8.0', zipBytes }),
      installChartExamples({ destinationParent, packageVersion: '2.8.0', zipBytes }),
    ])

    expect(results.map(result => result.reusedExisting).sort()).toEqual([false, true])
    expect(new Set(results.map(result => result.directoryPath)).size).toBe(1)
    expect((await readdir(destinationParent)).filter(name => name.startsWith('.md-viewer-chart-examples-')))
      .toEqual([])
  })

  it('never overwrites a changed destination or its sentinel file', async () => {
    const destinationParent = await createDestination()
    const zipBytes = createArchive()
    const installed = await installChartExamples({
      destinationParent,
      packageVersion: '2.8.0',
      zipBytes,
    })
    const sentinelPath = path.join(installed.directoryPath, 'sentinel.txt')
    await writeFile(sentinelPath, 'keep me')

    await expect(installChartExamples({
      destinationParent,
      packageVersion: '2.8.0',
      zipBytes,
    })).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' })
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('keep me')
  })

  it.each([
    '../escape.md',
    '/absolute.md',
    'C:/windows.md',
    '\\\\server\\share.md',
    'guide\\backslash.md',
    './dot.md',
    'nested/archive.zip',
  ])('rejects unsafe or nested archive path %s', archiveName => {
    const zipBytes = createArchive(undefined, {
      extraEntries: [{
        name: archiveName.startsWith('md-viewer-chart-examples/')
          ? archiveName
          : `md-viewer-chart-examples/${archiveName}`,
        data: Buffer.from('unsafe'),
      }],
    })
    expect(() => validateChartExamplesArchive(zipBytes, '2.8.0'))
      .toThrow(ChartExamplesInstallError)
  })

  it('rejects case-folded duplicate paths and unknown entries', () => {
    const first = Buffer.from('one')
    const second = Buffer.from('two')
    const zipBytes = createArchive(
      [{ name: 'README.md', data: first }],
      {
        extraEntries: [
          { name: 'md-viewer-chart-examples/readme.md', data: second },
          { name: 'md-viewer-chart-examples/unknown.md', data: second },
        ],
      },
    )
    expect(() => validateChartExamplesArchive(zipBytes, '2.8.0'))
      .toThrow(ChartExamplesInstallError)
  })

  it('keeps the expanded archive entry budget finite', () => {
    const files = Array.from({ length: 120 }, (_, index) => ({
      name: `gallery/case-${String(index).padStart(3, '0')}.md`,
      data: Buffer.from(`# Case ${index}\n`),
    }))

    expect(() => validateChartExamplesArchive(createArchive(files), '2.8.0')).toThrow(ChartExamplesInstallError)
  })

  it('rejects symbolic links, oversized entries, and file hash mismatches', () => {
    const symlinkZip = createArchive(undefined, {
      extraEntries: [{
        name: 'md-viewer-chart-examples/link',
        data: Buffer.from('README.md'),
        attr: (0o120777 << 16) >>> 0,
      }],
    })
    expect(() => validateChartExamplesArchive(symlinkZip, '2.8.0'))
      .toThrow(ChartExamplesInstallError)

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1)
    const oversizedZip = createArchive([{ name: 'large.md', data: oversized }])
    expect(() => validateChartExamplesArchive(oversizedZip, '2.8.0'))
      .toThrow(ChartExamplesInstallError)

    const data = Buffer.from('actual')
    const hashMismatchZip = createArchive(
      [{ name: 'README.md', data }],
      { manifestFiles: [{ name: 'README.md', bytes: data.byteLength, sha256: '0'.repeat(64) }] },
    )
    expect(() => validateChartExamplesArchive(hashMismatchZip, '2.8.0'))
      .toThrow(ChartExamplesInstallError)
  })

  it('cleans its staging directory after extraction fails', async () => {
    const destinationParent = await createDestination()
    const zipBytes = createArchive([
      { name: 'README.md', data: Buffer.from('# Examples') },
      { name: 'guide/start.md', data: Buffer.from('# Start') },
    ])

    // A conflicting regular file makes creation of guide/start.md fail after staging exists.
    const archive = validateChartExamplesArchive(zipBytes, '2.8.0')
    archive.files.splice(1, 0, {
      name: 'guide',
      bytes: 4,
      sha256: digest(Buffer.from('file')),
      data: Buffer.from('file'),
    })
    const malformedZip = createArchive(
      archive.files.map(file => ({ name: file.name, data: file.data })),
    )

    await expect(installChartExamples({
      destinationParent,
      packageVersion: '2.8.0',
      zipBytes: malformedZip,
    })).rejects.toMatchObject({ code: 'EXTRACT_FAILED' })
    expect((await readdir(destinationParent)).filter(name => name.startsWith('.md-viewer-chart-examples-')))
      .toEqual([])
  })
})
