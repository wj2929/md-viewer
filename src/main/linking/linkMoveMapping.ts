import * as path from 'path'
import type { LinkMoveMapping } from './types'

export function validateLinkMoveMapping(mapping: LinkMoveMapping): LinkMoveMapping {
  if (!mapping || typeof mapping !== 'object') throw new Error('文件移动映射无效')
  const oldRelativePath = validateRelativePath(mapping.oldRelativePath)
  const newRelativePath = validateRelativePath(mapping.newRelativePath)
  if (oldRelativePath === newRelativePath) throw new Error('源路径与目标路径相同')
  return { oldRelativePath, newRelativePath }
}

export function validateRelativePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || path.isAbsolute(value)) {
    throw new Error('相对路径无效')
  }
  const normalized = normalizeRelativePath(value)
  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('相对路径无效')
  }
  return normalized
}

export function normalizeRelativePath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '')
}
