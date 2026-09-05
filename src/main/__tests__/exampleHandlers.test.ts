// @vitest-environment node
import { createHash } from 'node:crypto'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app, dialog, ipcMain } from 'electron'
import { copyFile } from 'node:fs/promises'
import { registerExampleHandlers } from '../ipc/exampleHandlers'
import { ChartExamplesInstallError } from '../chartExamplesInstaller'

const state = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  handlers: new Map<string, (...args: any[]) => any>(),
  installChartExamples: vi.fn(),
  activateFolderForWindow: vi.fn(),
  saveFolderTreeState: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn((filePath: string) => state.files.has(String(filePath))),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (filePath: string, encoding?: string) => {
    const value = state.files.get(String(filePath))
    if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    if (encoding) return Buffer.isBuffer(value) ? value.toString(encoding as BufferEncoding) : value
    return Buffer.isBuffer(value) ? value : Buffer.from(value)
  }),
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(async (filePath: string) => {
    const value = state.files.get(String(filePath))
    if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    const size = Buffer.isBuffer(value) ? value.byteLength : Buffer.byteLength(value)
    return { isFile: () => true, size }
  }),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/Applications/MD Viewer.app'),
    getPath: vi.fn(() => '/Users/test/Library/Application Support/md-viewer'),
    getVersion: vi.fn(() => '2.8.0'),
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, callback: (...args: any[]) => any) => {
      state.handlers.set(channel, callback)
    }),
  },
}))

vi.mock('../ipc/senderSecurity', () => ({
  getSenderWindow: vi.fn(() => ({})),
}))

vi.mock('../chartExamplesInstaller', () => ({
  ChartExamplesInstallError: class ChartExamplesInstallError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
  installChartExamples: state.installChartExamples,
}))

vi.mock('../folderActivation', () => ({
  activateFolderForWindow: state.activateFolderForWindow,
}))

const examplesDir = path.join(process.cwd(), 'resources', 'examples')
const zipPath = path.join(examplesDir, 'md-viewer-chart-examples.zip')
const manifestPath = path.join(examplesDir, 'md-viewer-chart-examples.manifest.json')
const originalResourcesPath = process.resourcesPath

function installExamples(
  overrides: Record<string, unknown> = {},
  zip = Buffer.from('chart examples'),
  directory = examplesDir,
): void {
  const manifest = {
    schemaVersion: '1.0',
    packageId: 'md-viewer-chart-examples',
    packageVersion: '2.8.0',
    minAppVersion: '2.8.0',
    maxAppVersion: '2.8.0',
    filename: 'md-viewer-chart-examples.zip',
    bytes: zip.byteLength,
    sha256: createHash('sha256').update(zip).digest('hex'),
    caseCount: 93,
    rendererCount: 20,
    ...overrides,
  }
  state.files.set(path.join(directory, 'md-viewer-chart-examples.zip'), zip)
  state.files.set(path.join(directory, 'md-viewer-chart-examples.manifest.json'), JSON.stringify(manifest))
}

function handler<T extends (...args: any[]) => any>(channel: string): T {
  const callback = state.handlers.get(channel)
  if (!callback) throw new Error(`Missing handler: ${channel}`)
  return callback as T
}

describe('chart examples IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.files.clear()
    state.handlers.clear()
    ;(app as any).isPackaged = false
    ;(process as any).resourcesPath = originalResourcesPath
    vi.mocked(app.getVersion).mockReturnValue('2.8.0')
    registerExampleHandlers({
      appDataManager: { saveFolderTreeState: state.saveFolderTreeState },
    } as any)
  })

  it('reports a ready fixed local package without accepting a source path', async () => {
    installExamples()
    const getStatus = handler<(event?: unknown, payload?: unknown) => Promise<any>>('examples:getChartExamplesStatus')

    await expect(getStatus({}, { sourcePath: '/tmp/other.zip' })).resolves.toEqual({
      state: 'ready',
      appVersion: '2.8.0',
      message: '内置离线示例包已就绪，无需联网。',
      packageVersion: '2.8.0',
      bytes: 14,
      caseCount: 93,
      rendererCount: 20,
    })
  })

  it('reports expanded v1.1 package counts without mixing starters into case totals', async () => {
    installExamples({
      schemaVersion: '1.1',
      packageVersion: '2.8.0-r2',
      caseCount: 978,
      totalCaseCount: 978,
      designCaseCount: 93,
      galleryCaseCount: 885,
      starterCount: 21,
      assetCount: 65,
      remoteCaseCount: 112,
      countsByCollection: { 'data-visualization': 334 },
      countsByRenderer: { mermaid: 29 },
    })
    const getStatus = handler<() => Promise<any>>('examples:getChartExamplesStatus')

    await expect(getStatus()).resolves.toMatchObject({
      state: 'ready',
      packageVersion: '2.8.0-r2',
      caseCount: 978,
      totalCaseCount: 978,
      designCaseCount: 93,
      galleryCaseCount: 885,
      starterCount: 21,
      assetCount: 65,
      remoteCaseCount: 112,
    })
  })

  it('uses the project package version instead of Electron version during development', async () => {
    vi.mocked(app.getVersion).mockReturnValue('39.2.7')
    state.files.set(path.join(process.cwd(), 'package.json'), JSON.stringify({ version: '2.8.0' }))
    installExamples()
    const getStatus = handler<() => Promise<any>>('examples:getChartExamplesStatus')

    await expect(getStatus()).resolves.toMatchObject({
      state: 'ready',
      appVersion: '2.8.0',
      packageVersion: '2.8.0',
    })
  })

  it('continues past a damaged development candidate to a valid app resource', async () => {
    state.files.set(zipPath, Buffer.from('damaged'))
    state.files.set(manifestPath, '{invalid')
    installExamples({}, Buffer.from('valid app resource'), '/Applications/MD Viewer.app/resources/examples')
    const getStatus = handler<() => Promise<any>>('examples:getChartExamplesStatus')

    await expect(getStatus()).resolves.toMatchObject({ state: 'ready', bytes: 18 })
  })

  it('uses only the trusted resources directory in a packaged app', async () => {
    ;(app as any).isPackaged = true
    ;(process as any).resourcesPath = '/trusted/resources'
    state.files.set(zipPath, Buffer.from('untrusted'))
    state.files.set(manifestPath, '{invalid')
    installExamples({}, Buffer.from('trusted'), '/trusted/resources/examples')
    const getStatus = handler<() => Promise<any>>('examples:getChartExamplesStatus')

    await expect(getStatus()).resolves.toMatchObject({
      state: 'ready',
      bytes: 7,
      packageVersion: '2.8.0',
    })
  })

  it('distinguishes missing, invalid, corrupt, and incompatible packages', async () => {
    const getStatus = handler<() => Promise<any>>('examples:getChartExamplesStatus')
    await expect(getStatus()).resolves.toMatchObject({ state: 'missing' })

    state.files.set(zipPath, Buffer.from('zip'))
    state.files.set(manifestPath, '{invalid')
    await expect(getStatus()).resolves.toMatchObject({ state: 'corrupt' })

    installExamples({}, Buffer.from('original'))
    state.files.set(zipPath, Buffer.from('changed'))
    await expect(getStatus()).resolves.toMatchObject({ state: 'corrupt' })

    installExamples({ minAppVersion: '2.9.0', maxAppVersion: '2.9.0' })
    await expect(getStatus()).resolves.toMatchObject({ state: 'incompatible' })
  })

  it('installs only the verified built-in package in the app-managed directory', async () => {
    const zip = Buffer.from('chart examples')
    installExamples({}, zip)
    state.installChartExamples.mockResolvedValue({
      directoryPath: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0',
      entryFilePath: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0/README.md',
      reusedExisting: false,
      treeDirectories: ['02-design-reference', '03-renderer-gallery', '03-renderer-gallery/data-visualization'],
    })
    state.activateFolderForWindow.mockResolvedValue({
      id: 'history-1',
      path: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0',
      name: 'md-viewer-chart-examples-v2.8.0',
      workspace: {
        id: 'workspace-1',
        primaryRoot: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0',
        lifecycleEpoch: 2,
      },
    })
    const open = handler<(event: unknown, payload?: unknown) => Promise<any>>('examples:installChartExamples')

    await expect(open({ sender: {} }, { destination: '/tmp/untrusted' })).resolves.toMatchObject({
      canceled: false,
      reusedExisting: false,
      activation: { id: 'history-1' },
    })
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(state.installChartExamples).toHaveBeenCalledWith({
      destinationParent: '/Users/test/Library/Application Support/md-viewer/chart-examples',
      packageVersion: '2.8.0',
      zipBytes: zip,
    })
    expect(state.saveFolderTreeState).toHaveBeenCalledWith(
      '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0',
      {
        '02-design-reference': false,
        '03-renderer-gallery': false,
        '03-renderer-gallery/data-visualization': false,
      },
    )
  })

  it('maps install or activation failures without opening a dialog', async () => {
    installExamples()
    const open = handler<(event: unknown) => Promise<any>>('examples:installChartExamples')

    state.installChartExamples.mockRejectedValueOnce(
      new ChartExamplesInstallError('DESTINATION_EXISTS' as any, '应用管理的示例目录内容不同。'),
    )
    await expect(open({ sender: {} })).resolves.toEqual({
      canceled: false,
      error: { code: 'DESTINATION_EXISTS', message: '应用管理的示例目录内容不同。' },
    })

    state.installChartExamples.mockResolvedValueOnce({
      directoryPath: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0',
      entryFilePath: '/Users/test/Library/Application Support/md-viewer/chart-examples/md-viewer-chart-examples-v2.8.0/README.md',
      reusedExisting: true,
    })
    state.activateFolderForWindow.mockRejectedValueOnce(new Error('activation failed'))
    await expect(open({ sender: {} })).resolves.toMatchObject({
      canceled: false,
      error: { code: 'ACTIVATION_FAILED' },
    })
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('uses the save dialog and copies only the verified built-in package', async () => {
    installExamples()
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/examples' } as any)
    const save = handler<(event: unknown, payload?: unknown) => Promise<any>>('examples:saveChartExamples')

    await expect(save({ sender: {} }, { sourcePath: '/tmp/other.zip' })).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/examples.zip',
      packageVersion: '2.8.0',
      bytes: 14,
    })
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      defaultPath: 'md-viewer-chart-examples-v2.8.0.zip',
      filters: [{ name: 'ZIP 示例包', extensions: ['zip'] }],
    }))
    expect(copyFile).toHaveBeenCalledWith(zipPath, '/tmp/examples.zip')
  })

  it('returns canceled without copying and revalidates after the dialog closes', async () => {
    installExamples()
    const save = handler<(event: unknown) => Promise<any>>('examples:saveChartExamples')

    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true } as any)
    await expect(save({ sender: {} })).resolves.toEqual({ canceled: true })
    expect(copyFile).not.toHaveBeenCalled()

    vi.mocked(dialog.showSaveDialog).mockImplementationOnce(async () => {
      state.files.set(zipPath, Buffer.from('tampered'))
      return { canceled: false, filePath: '/tmp/examples.zip' } as any
    })
    await expect(save({ sender: {} })).resolves.toMatchObject({
      canceled: false,
      error: { code: 'EXAMPLES_CORRUPT' },
    })
    expect(copyFile).not.toHaveBeenCalled()
  })

  it('maps write failures to a stable output error', async () => {
    installExamples()
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/examples.zip' } as any)
    vi.mocked(copyFile).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const save = handler<(event: unknown) => Promise<any>>('examples:saveChartExamples')

    await expect(save({ sender: {} })).resolves.toEqual({
      canceled: false,
      error: {
        code: 'OUTPUT_NOT_WRITABLE',
        message: '无法写入所选位置，请更换保存位置后重试。',
      },
    })
  })
})
