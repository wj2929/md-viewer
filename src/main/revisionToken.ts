import { createHash } from 'crypto'

export const FULL_SHA256_REVISION_PREFIX = 'v2:full-sha256:'
const FULL_SHA256_PATTERN = /^[a-f0-9]{64}$/

export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function buildFullSha256Revision(content: string | Uint8Array): string {
  return `${FULL_SHA256_REVISION_PREFIX}${sha256Hex(content)}`
}

export function parseFullSha256Revision(token: string): string | null {
  if (!token.startsWith(FULL_SHA256_REVISION_PREFIX)) return null
  const digest = token.slice(FULL_SHA256_REVISION_PREFIX.length)
  return FULL_SHA256_PATTERN.test(digest) ? digest : null
}

export function isFullSha256Revision(token: string): boolean {
  return parseFullSha256Revision(token) !== null
}
