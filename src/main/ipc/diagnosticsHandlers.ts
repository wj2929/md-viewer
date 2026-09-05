import { app, dialog, ipcMain } from 'electron'
import * as path from 'path'
import type { IPCContext } from './context'
import { getSenderWindow } from './senderSecurity'
import { createDiagnosticsBundle, type DiagnosticsBundleInput } from '../diagnostics/DiagnosticsService'
import { hasProviderKey } from '../tts/keyStore'
import { providerTarget } from '../tts/ttsSettings'
import { defaultReadAloudSettings } from '../../shared/ttsProviders'
import { validateReadAloudSettings } from '../tts/ttsSettings'

export function registerDiagnosticsHandlers(ctx: IPCContext): void {
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
      return {
        canceled: false,
        ...(await createDiagnosticsBundle(outputPath, collectDiagnostics(ctx, window))),
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
