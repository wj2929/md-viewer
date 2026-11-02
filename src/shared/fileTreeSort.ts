export type FileTreeSortBy = 'name' | 'natural' | 'type' | 'modified' | 'size'
export type FileTreeSort = { by: FileTreeSortBy; direction: 'asc' | 'desc' }
export type FileTreeSortSnapshot = { value: FileTreeSort; revision: number }
export type FileTreeMetadata = { mtimeMs: number; size: number }
export type FileTreeMetadataMap = Record<string, FileTreeMetadata | null>
export type FileTreeMetadataResult = { relativePath: string; value: FileTreeMetadata | null }

export const DEFAULT_FILE_TREE_SORT: FileTreeSort = { by: 'name', direction: 'asc' }
export const FILE_TREE_SORT_OPTIONS: Array<{ by: FileTreeSortBy; label: string }> = [
  { by: 'name', label: '名称（现有规则）' },
  { by: 'natural', label: '名称（自然数字）' },
  { by: 'type', label: '文件类型' },
  { by: 'modified', label: '修改时间' },
  { by: 'size', label: '大小' },
]
export const FILE_TREE_METADATA_BATCH_SIZE = 256

export function isFileTreeSort(value: unknown): value is FileTreeSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2 && Object.hasOwn(record, 'by') && Object.hasOwn(record, 'direction')
    && FILE_TREE_SORT_OPTIONS.some(option => option.by === record.by)
    && (record.direction === 'asc' || record.direction === 'desc')
}

export function normalizeFileTreeSort(value: unknown): FileTreeSort {
  return isFileTreeSort(value) ? { by: value.by, direction: value.direction } : { ...DEFAULT_FILE_TREE_SORT }
}

export function needsFileTreeMetadata(by: FileTreeSortBy): boolean {
  return by === 'modified' || by === 'size'
}

export function defaultFileTreeSortDirection(by: FileTreeSortBy): FileTreeSort['direction'] {
  return needsFileTreeMetadata(by) ? 'desc' : 'asc'
}

export function fileTreeSortDirectionLabel(sort: FileTreeSort): string {
  if (sort.by === 'modified') return sort.direction === 'asc' ? '最早在前' : '最新在前'
  if (sort.by === 'size') return sort.direction === 'asc' ? '最小在前' : '最大在前'
  return `${sort.by === 'type' ? '扩展名' : '名称'}${sort.direction === 'asc' ? '升序' : '降序'}`
}
