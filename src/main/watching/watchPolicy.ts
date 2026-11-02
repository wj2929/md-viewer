import { readdirSync, type Stats } from 'node:fs'
import * as path from 'node:path'
import { hasIgnoredPathSegment, PREVIEWABLE_FILE_EXTENSIONS } from './watchPaths'

// Used only inside the utility process. Tree/index/CLI discovery deliberately do not use this policy.
export function createRootWatchPolicy(root: string): {
  ignored: (candidate: string, stats?: Stats) => boolean
  excluded: Set<string>
} {
  const projects = new Map<string, boolean>()
  const excluded = new Set<string>()
  return {
    excluded,
    ignored(candidate, stats) {
      if (candidate === root) return false
      if (hasIgnoredPathSegment(candidate, root) || stats?.isSymbolicLink()) return true
      const name = path.basename(candidate)
      if ((name === 'bin' || name === 'obj') && (!stats || stats.isDirectory())) {
        const parent = path.dirname(candidate)
        let project = projects.get(parent)
        if (project === undefined) {
          try {
            project = readdirSync(parent, { withFileTypes: true }).some(entry => (
              entry.isFile() && /\.(?:csproj|fsproj|vbproj)$/i.test(entry.name)
            ))
          } catch { project = false }
          projects.set(parent, project)
        }
        if (project) {
          excluded.add(path.relative(root, candidate))
          return true
        }
      }
      return Boolean(stats && !stats.isDirectory() && !PREVIEWABLE_FILE_EXTENSIONS.has(path.extname(candidate).toLowerCase()))
    },
  }
}
