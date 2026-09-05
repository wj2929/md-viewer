import * as fs from 'fs-extra'
import * as path from 'path'

export async function moveSameRootPath(input: {
  sourcePath: string
  destinationPath: string
}): Promise<{ destinationPath: string; isDirectory: boolean }> {
  if (!(await fs.pathExists(input.sourcePath))) throw new Error('源文件不存在')
  const sourceStats = await fs.lstat(input.sourcePath)
  if (sourceStats.isSymbolicLink()) throw new Error('安全错误：不支持移动符号链接')
  if (sourceStats.isDirectory()) await rejectDirectorySymbolicLinks(input.sourcePath)
  if (await fs.pathExists(input.destinationPath)) throw new Error('目标文件已存在')
  await fs.move(input.sourcePath, input.destinationPath, { overwrite: false })
  return { destinationPath: input.destinationPath, isDirectory: sourceStats.isDirectory() }
}

async function rejectDirectorySymbolicLinks(directoryPath: string): Promise<void> {
  for (const entry of await fs.readdir(directoryPath)) {
    const entryPath = path.join(directoryPath, entry)
    const entryStats = await fs.lstat(entryPath)
    if (entryStats.isSymbolicLink()) {
      throw new Error('安全错误：不支持移动包含符号链接的目录')
    }
    if (entryStats.isDirectory()) await rejectDirectorySymbolicLinks(entryPath)
  }
}
