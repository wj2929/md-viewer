import { useEditSessionStore } from '../stores/editSessionStore'
import type { EditSession } from '../stores/editSessionStore'

interface ExportGuardToast {
  error: (message: string) => void
  info?: (message: string) => unknown
}

interface CreateExportGuardOptions {
  toast: ExportGuardToast
  saveBeforeExport?: (canonicalPath: string) => Promise<boolean | void>
}

interface ExportGuardOptions {
  saveAndContinue?: boolean
}

export function findDirtyEditSessionForPath(
  sessions: Record<string, EditSession>,
  filePath: string
): EditSession | undefined {
  return Object.values(sessions).find(session =>
    session.draft !== session.original &&
    (session.displayPath === filePath || session.canonicalPath === filePath)
  )
}

export function createExportGuard({ toast, saveBeforeExport }: CreateExportGuardOptions) {
  return async function exportGuard(filePath: string, options: ExportGuardOptions = {}): Promise<boolean> {
    const session = findDirtyEditSessionForPath(useEditSessionStore.getState().sessions, filePath)
    if (!session) return true

    if (options.saveAndContinue && saveBeforeExport) {
      return (await saveBeforeExport(session.canonicalPath)) !== false
    }

    if (saveBeforeExport && window.confirm('存在未保存的编辑草稿。是否先保存并继续导出？')) {
      return (await saveBeforeExport(session.canonicalPath)) !== false
    }

    toast.error('请先保存编辑草稿后再导出')
    return false
  }
}
