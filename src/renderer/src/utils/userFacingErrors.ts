export function cleanUserFacingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutIpcPrefix = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (/ENOENT|no such file or directory/i.test(withoutIpcPrefix)) {
    return '文件不存在'
  }

  return withoutIpcPrefix || '未知错误'
}
