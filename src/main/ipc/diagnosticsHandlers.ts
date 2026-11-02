import { app, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import type { IPCContext } from './context'
import { getSenderWindow } from './senderSecurity'
import { createDiagnosticsBundle, type DiagnosticsBundleInput } from '../diagnostics/DiagnosticsService'
import {
  isDiagnosticRetentionPolicy,
  type DiagnosticClearResult,
  type DiagnosticDirectoryResult,
  type DiagnosticLogSettings,
  type DiagnosticOpenDirectoryResult,
  type DiagnosticRetentionResult,
} from '../../shared/diagnostics'
import { hasProviderKey } from '../tts/keyStore'
import { providerTarget } from '../tts/ttsSettings'
import { defaultReadAloudSettings } from '../../shared/ttsProviders'
import { validateReadAloudSettings } from '../tts/ttsSettings'

export function registerDiagnosticsHandlers(ctx: IPCContext): void {
  ipcMain.handle('diagnostics:getLogStatus', async (event) => {
    getSenderWindow(ctx, event)
    return ctx.diagnosticEventLogService.getStatus()
  })

  ipcMain.handle('diagnostics:setLoggingEnabled', async (event, enabled: unknown) => {
    getSenderWindow(ctx, event)
    if (typeof enabled !== 'boolean') throw new Error('无效的诊断日志开关')
    const current = ctx.appDataManager.getDiagnosticLogSettings()
    const saved = ctx.appDataManager.setDiagnosticLogSettings({ ...current, enabled })
    await ctx.diagnosticEventLogService.setEnabled(saved.enabled)
    return ctx.diagnosticEventLogService.getStatus()
  })

  ipcMain.handle('diagnostics:chooseLogDirectory', async (event): Promise<DiagnosticDirectoryResult> => {
    const window = getSenderWindow(ctx, event)
    const result = await dialog.showOpenDialog(window, {
      title: '选择诊断日志保存位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, status: await ctx.diagnosticEventLogService.getStatus() }
    }
    try {
      const directory = await ctx.diagnosticEventLogService.validateCustomDirectory(result.filePaths[0])
      const current = ctx.appDataManager.getDiagnosticLogSettings()
      await ctx.diagnosticEventLogService.applyConfiguredDirectory(directory)
      ctx.appDataManager.setDiagnosticLogSettings({ ...current, directory })
      return { canceled: false, status: await ctx.diagnosticEventLogService.getStatus() }
    } catch {
      return {
        canceled: false,
        status: await ctx.diagnosticEventLogService.getStatus(),
        message: '所选位置不可用或不可写，请选择其他文件夹。',
      }
    }
  })

  ipcMain.handle('diagnostics:retryLogDirectory', async (event): Promise<DiagnosticDirectoryResult> => {
    getSenderWindow(ctx, event)
    try {
      await ctx.diagnosticEventLogService.retryConfiguredDirectory()
      return { canceled: false, status: await ctx.diagnosticEventLogService.getStatus() }
    } catch {
      return {
        canceled: false,
        status: await ctx.diagnosticEventLogService.getStatus(),
        message: '自定义位置仍不可用，新日志继续写入默认位置。',
      }
    }
  })

  ipcMain.handle('diagnostics:resetLogDirectory', async (event): Promise<DiagnosticDirectoryResult> => {
    getSenderWindow(ctx, event)
    const current = ctx.appDataManager.getDiagnosticLogSettings()
    const { directory: _directory, ...withoutDirectory } = current
    await ctx.diagnosticEventLogService.applyConfiguredDirectory(null)
    ctx.appDataManager.setDiagnosticLogSettings(withoutDirectory as DiagnosticLogSettings)
    return { canceled: false, status: await ctx.diagnosticEventLogService.getStatus() }
  })

  ipcMain.handle('diagnostics:openLogDirectory', async (event): Promise<DiagnosticOpenDirectoryResult> => {
    getSenderWindow(ctx, event)
    const status = await ctx.diagnosticEventLogService.getStatus()
    if (!status.effectiveDirectory) return { success: false, error: 'OPEN_DIRECTORY_FAILED' }
    const error = await shell.openPath(status.effectiveDirectory)
    return error
      ? { success: false, error: 'OPEN_DIRECTORY_FAILED' }
      : { success: true }
  })

  ipcMain.handle('diagnostics:applyRetentionPolicy', async (event, policy: unknown): Promise<DiagnosticRetentionResult> => {
    const window = getSenderWindow(ctx, event)
    if (!isDiagnosticRetentionPolicy(policy)) throw new Error('无效的诊断日志保留规则')
    const preview = await ctx.diagnosticEventLogService.previewRetentionPolicy(policy)
    if (preview.files.length > 0) {
      const confirmation = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '应用新的保留规则并删除日志？',
        message: '应用新的保留规则并删除日志？',
        detail: `新规则：最多 ${policy.maxTotalMiB} MiB，保留 ${policy.retentionDays} 天。将删除 ${preview.files.length} 个最旧文件，共 ${formatBytes(preview.bytes)}。删除后不可恢复。`,
        buttons: ['取消', '应用规则并删除日志'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation.response !== 1) {
        return {
          canceled: true,
          applied: false,
          status: await ctx.diagnosticEventLogService.getStatus(),
        }
      }
    }
    const current = ctx.appDataManager.getDiagnosticLogSettings()
    ctx.appDataManager.setDiagnosticLogSettings({ ...current, ...policy })
    const cleanup = await ctx.diagnosticEventLogService.applyRetentionPolicy(policy)
    return {
      canceled: false,
      applied: true,
      status: await ctx.diagnosticEventLogService.getStatus(),
      ...cleanup,
    }
  })

  ipcMain.handle('diagnostics:clearLogs', async (event): Promise<DiagnosticClearResult> => {
    const window = getSenderWindow(ctx, event)
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '清除诊断日志？',
      message: '清除当前日志文件夹中的诊断日志？',
      detail: '将永久删除由 MD Viewer 创建的诊断事件日志，不会删除该目录中的其他文件。日志开启时，后续使用仍会生成新日志。',
      buttons: ['取消', '清除日志'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) {
      return {
        canceled: true,
        deletedFiles: 0,
        deletedBytes: 0,
        skippedActiveFiles: 0,
        partial: false,
        status: await ctx.diagnosticEventLogService.getStatus(),
      }
    }
    const cleared = await ctx.diagnosticEventLogService.clearLogs()
    return {
      canceled: false,
      ...cleared,
      status: await ctx.diagnosticEventLogService.getStatus(),
    }
  })

  ipcMain.on('diagnostics:rendererEvent', (event, input: unknown) => {
    try {
      getSenderWindow(ctx, event)
      ctx.diagnosticEventLogService.recordRendererEvent(event.sender.id, input)
    } catch {
      // 单向遥测事件不得把伪造 sender 异常抛到主进程事件循环。
    }
  })

  ipcMain.handle('diagnostics:exportBundle', async (event) => {
    const window = getSenderWindow(ctx, event)
    const result = await dialog.showSaveDialog(window, {
      title: '保存 MD Viewer 诊断包',
      defaultPath: `md-viewer-diagnostics-${app.getVersion()}.zip`,
      filters: [{ name: 'ZIP 诊断包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const outputPath = path.extname(result.filePath).toLowerCase() === '.zip'
      ? result.filePath
      : `${result.filePath}.zip`
    try {
      const eventLog = await ctx.diagnosticEventLogService.readEventsForBundle()
        .then(snapshot => ({ snapshot, health: ctx.diagnosticEventLogService.getHealth() }))
        .catch(() => undefined)
      return {
        canceled: false,
        ...(await createDiagnosticsBundle(outputPath, collectDiagnostics(ctx, window), eventLog)),
      }
    } catch (error) {
      const code = diagnosticsErrorCode(error)
      console.error('diagnostics bundle export failed', {
        code,
        errorCode: rawErrorCode(error),
      })
      return {
        canceled: false,
        error: {
          code,
          message: diagnosticsErrorMessage(code),
        },
      }
    }
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function rawErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
}

function diagnosticsErrorCode(error: unknown): 'OUTPUT_EXISTS' | 'OUTPUT_NOT_WRITABLE' | 'BUNDLE_FAILED' {
  const code = rawErrorCode(error)
  if (code === 'EEXIST') return 'OUTPUT_EXISTS'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOSPC') {
    return 'OUTPUT_NOT_WRITABLE'
  }
  return 'BUNDLE_FAILED'
}

function diagnosticsErrorMessage(
  code: ReturnType<typeof diagnosticsErrorCode>,
): string {
  if (code === 'OUTPUT_EXISTS') return '所选位置已存在同名文件，请更换文件名后重试。'
  if (code === 'OUTPUT_NOT_WRITABLE') return '无法写入所选位置，请更换保存位置后重试。'
  return '诊断包生成失败，请重试；若仍失败，可从终端启动应用查看本地错误类别。'
}

function collectDiagnostics(ctx: IPCContext, window: Electron.BrowserWindow): DiagnosticsBundleInput {
  const settings = ctx.appDataManager.getSettings()
  const readAloud = validateReadAloudSettings(settings.readAloud ?? defaultReadAloudSettings())
  const workspaces = ctx.windowManager.listWorkspaces(window.id)
  const presentations = workspaces.map(workspace =>
    ctx.windowManager.getWorkspacePresentation(window.id, workspace.id)
  )
  const activeWorkspace = ctx.windowManager.getActiveWorkspace(window.id)
  const index = activeWorkspace?.primaryRoot
    ? ctx.workspaceIndexService?.getStatus(activeWorkspace.primaryRoot)
    : undefined
  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
    },
    packaging: {
      packaged: app.isPackaged,
      runtimeDependencyCheck: 'unknown',
      resourceCheck: 'unknown',
      localeCheck: 'unknown',
      fontCheck: 'unknown',
    },
    ...(index ? { index } : {}),
    session: {
      schemaVersion: 1,
      windows: ctx.windowManager.getWindowCount(),
      workspaces: workspaces.length,
      tabs: presentations.reduce((sum, presentation) => sum + (presentation?.tabCount ?? 0), 0),
      splitLeaves: presentations.filter(presentation => presentation?.hasSplit).length,
    },
    docx: {
      configured: Boolean(settings.docxExport?.remoteEnabled),
      status: settings.docxExport?.remoteEnabled ? 'unknown' : 'not-configured',
    },
    tts: {
      providers: readAloud.providers.map(provider => ({
        type: provider.type,
        enabled: provider.enabled,
        hasApiKey: (provider.type === 'openai' || provider.type === 'azure')
          ? hasProviderKey(provider.id, providerTarget(provider))
          : false,
      })),
    },
    errors: [],
  }
}
