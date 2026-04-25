import { create } from 'zustand'

export type ExportTaskStatus = 'idle' | 'rendering' | 'generating' | 'done' | 'error'

export type DocxErrorType = 'network' | 'timeout' | 'client_error' | 'server_error' | 'write_error' | 'unknown'

export interface DocxErrorDetail {
  errorType: DocxErrorType
  message: string
  statusCode?: number
  serverUrl: string
  serviceVersion?: string
  timestamp: string
  raw?: string
}

export interface VersionInfo {
  version: string
  platform: string
  arch: string
  electron: string
}

interface ExportTaskState {
  status: ExportTaskStatus
  minimized: boolean
  fileName: string
  currentChart: number
  totalCharts: number
  chartType: string
  filePath: string
  imagesFailed: number
  errorMessage: string
  warnings: string[]
  errorDetail: DocxErrorDetail | null
  // session-only，不跨重启持久化
  lastExportedFilePath: string
  lastExportedTime: string
  versionInfo: VersionInfo | null

  startExport: (fileName: string) => void
  updateChartProgress: (current: number, total: number, chartType: string) => void
  setGenerating: () => void
  setDone: (filePath: string, imagesFailed: number, warnings?: string[]) => void
  setError: (message: string, detail?: DocxErrorDetail) => void
  toggleMinimize: () => void
  close: () => void
  cacheVersionInfo: (info: VersionInfo) => void
}

const INITIAL_STATE = {
  status: 'idle' as ExportTaskStatus,
  minimized: false,
  fileName: '',
  currentChart: 0,
  totalCharts: 0,
  chartType: '',
  filePath: '',
  imagesFailed: 0,
  errorMessage: '',
  warnings: [] as string[],
  errorDetail: null as DocxErrorDetail | null,
  lastExportedFilePath: '',
  lastExportedTime: '',
  versionInfo: null as VersionInfo | null,
}

export const useExportTaskStore = create<ExportTaskState>((set, get) => ({
  ...INITIAL_STATE,

  startExport: (fileName: string) => {
    if (get().status !== 'idle') return
    const { lastExportedFilePath, lastExportedTime, versionInfo } = get()
    set({ ...INITIAL_STATE, status: 'rendering', fileName, lastExportedFilePath, lastExportedTime, versionInfo })
  },

  updateChartProgress: (current: number, total: number, chartType: string) => {
    set({ currentChart: current, totalCharts: total, chartType })
  },

  setGenerating: () => {
    set({ status: 'generating' })
  },

  setDone: (filePath: string, imagesFailed: number, warnings?: string[]) => {
    set({ status: 'done', filePath, imagesFailed, warnings: warnings || [], lastExportedFilePath: filePath, lastExportedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  },

  setError: (message: string, detail?: DocxErrorDetail) => {
    set({ status: 'error', errorMessage: message, errorDetail: detail || null })
  },

  toggleMinimize: () => {
    set(s => ({ minimized: !s.minimized }))
  },

  close: () => {
    const { lastExportedFilePath, lastExportedTime, versionInfo } = get()
    set({ ...INITIAL_STATE, lastExportedFilePath, lastExportedTime, versionInfo })
  },

  cacheVersionInfo: (info: VersionInfo) => {
    set({ versionInfo: info })
  },
}))
