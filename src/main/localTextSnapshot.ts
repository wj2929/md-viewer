import { open } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { MAX_LOCAL_ATTACHMENT_TEXT_SIZE } from '../shared/localMedia'

export function sameTextFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.ino !== 0n && a.ino === b.ino && a.dev === b.dev
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

export type LocalTextSnapshot = { content: string } | { notice: 'too-large' | 'not-utf8' | 'binary' }

export async function readLocalTextSnapshot(
  canonicalPath: string,
  info: BigIntStats,
  validateSnapshot: () => Promise<void>,
): Promise<LocalTextSnapshot> {
  if (!info.isFile() || info.ino === 0n) throw new Error('unavailable')
  if (info.size > BigInt(MAX_LOCAL_ATTACHMENT_TEXT_SIZE)) {
    await validateSnapshot()
    return { notice: 'too-large' }
  }
  const handle = await open(canonicalPath, 'r')
  try {
    if (!sameTextFile(info, await handle.stat({ bigint: true }))) throw new Error('stale')
    await validateSnapshot()
    const bytes = Buffer.alloc(Math.min(Number(info.size) + 1, MAX_LOCAL_ATTACHMENT_TEXT_SIZE + 1))
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (!sameTextFile(info, await handle.stat({ bigint: true }))) throw new Error('stale')
    await validateSnapshot()
    if (offset > MAX_LOCAL_ATTACHMENT_TEXT_SIZE) return { notice: 'too-large' }
    if (offset !== Number(info.size)) throw new Error('stale')
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)) }
    catch { return { notice: 'not-utf8' } }
    return content.includes('\0') ? { notice: 'binary' } : { content }
  } finally {
    await handle.close()
    await validateSnapshot()
  }
}
