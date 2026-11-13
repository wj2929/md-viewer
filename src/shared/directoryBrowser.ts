import type { WorkspaceOperationContext } from './workspace'
import type { LinkedAttachmentResult } from './linkRead'
import type { FolderActivation } from './workspace'
import type { LinkOperationReceipt } from '../main/linking/types'

export type WorkspaceBrowserAction = 'open' | 'system-open' | 'open-folder' | 'new-window' | 'create-file' | 'create-directory' | 'rename' | 'trash' | 'reveal' | 'copy-path' | 'copy-relative-path' | 'refresh' | 'validate'
export interface WorkspaceBrowserTarget extends WorkspaceDirectoryEntry { id: string; path: string }
export interface WorkspaceBrowserSelection { action: WorkspaceBrowserAction; target: WorkspaceBrowserTarget }
export interface WorkspaceBrowserInput { name?: string; impactId?: string }
export interface WorkspaceBrowserResult {
  entry?: WorkspaceDirectoryEntry
  activation?: FolderActivation
  renamed?: { newPath: string; receipt: LinkOperationReceipt }
  deleted?: boolean
}

export function isBrowserPathAffected(candidate: string, target: string, directory: boolean, windows = false): boolean {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return windows ? normalized.toLocaleLowerCase() : normalized
  }
  const path = normalize(candidate), source = normalize(target)
  return path === source || (directory && path.startsWith(`${source}/`))
}

export interface WorkspaceResourceRequest {
  operation: WorkspaceOperationContext
  relativePath: string
  leafId: string
  requestId: string
}

export type WorkspaceResourceResult = LinkedAttachmentResult & {
  preview?: { kind: 'image' | 'audio' | 'video'; url: string }
}

export function isWorkspaceRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !value.includes('\\')
    && !/[\u0000-\u001f]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
    && (value === '' || value.split('/').every(part => part !== '' && part !== '.' && part !== '..'))
}

export type WorkspaceDirectoryMetadata = 'modified' | 'size'

export interface WorkspaceDirectoryEntry {
  name: string
  relativePath: string
  kind: 'directory' | 'file' | 'link' | 'other'
  mtimeMs?: number | null
  size?: number | null
}
