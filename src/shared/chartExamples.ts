import type { FolderActivation } from './workspace'

export type ChartExamplesStatusState = 'ready' | 'missing' | 'corrupt' | 'incompatible'

export interface ChartExamplesStatus {
  state: ChartExamplesStatusState
  packageVersion?: string
  appVersion: string
  bytes?: number
  caseCount?: number
  totalCaseCount?: number
  designCaseCount?: number
  galleryCaseCount?: number
  starterCount?: number
  assetCount?: number
  remoteCaseCount?: number
  rendererCount?: number
  countsByCollection?: Record<string, number>
  countsByRenderer?: Record<string, number>
  message: string
}

export interface SaveChartExamplesResult {
  canceled: boolean
  filePath?: string
  packageVersion?: string
  bytes?: number
  error?: {
    code: 'EXAMPLES_MISSING' | 'EXAMPLES_CORRUPT' | 'EXAMPLES_INCOMPATIBLE' | 'OUTPUT_NOT_WRITABLE' | 'SAVE_FAILED'
    message: string
  }
}

export type InstallChartExamplesErrorCode =
  | 'EXAMPLES_MISSING'
  | 'EXAMPLES_CORRUPT'
  | 'EXAMPLES_INCOMPATIBLE'
  | 'DESTINATION_EXISTS'
  | 'OUTPUT_NOT_WRITABLE'
  | 'ARCHIVE_INVALID'
  | 'EXTRACT_FAILED'
  | 'ACTIVATION_FAILED'
  | 'RESTART_REQUIRED'

export type InstallChartExamplesResult =
  | { canceled: true }
  | {
      canceled: false
      activation: FolderActivation
      entryFilePath: string
      reusedExisting: boolean
    }
  | {
      canceled: false
      error: {
        code: InstallChartExamplesErrorCode
        message: string
      }
    }
