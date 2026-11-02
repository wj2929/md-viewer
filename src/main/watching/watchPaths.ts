import * as path from 'path'
import * as os from 'os'

const IGNORED_DIR_NAMES = new Set([
  'node_modules', 'vendor', 'target', 'build', 'dist',
  '__pycache__', 'venv', '.venv', 'env', 'coverage',
])

export const PREVIEWABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.excalidraw'])

export function hasIgnoredPathSegment(filePath: string, rootPath?: string): boolean {
  const candidatePath = rootPath ? path.relative(rootPath, filePath) : filePath
  if (rootPath && (
    candidatePath === '' || candidatePath.startsWith(`..${path.sep}`) ||
    candidatePath === '..' || path.isAbsolute(candidatePath)
  )) return false
  for (const segment of candidatePath.split(/[/\\]/)) {
    if (!segment) continue
    if (IGNORED_DIR_NAMES.has(segment)) return true
    if (segment.length > 1 && segment.startsWith('.') && segment !== '..') return true
  }
  return false
}

export function isWatchPathSafe(targetPath: string): { safe: boolean; reason?: string } {
  const resolved = path.resolve(targetPath)
  if (resolved.split(path.sep).filter(Boolean).length < 3) {
    return { safe: false, reason: '目录层级过高，请选择更具体的项目目录' }
  }
  if (resolved === os.homedir()) return { safe: false, reason: '不能监听用户主目录，请选择子目录' }
  return { safe: true }
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
