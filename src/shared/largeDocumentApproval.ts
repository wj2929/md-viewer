export interface LargeDocumentSize {
  characters: number
  lines: number
}

export function isLargeDocumentSize(value: unknown): value is LargeDocumentSize {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const size = value as Record<string, unknown>
  return Number.isSafeInteger(size.characters) && Number(size.characters) > 0
    && Number.isSafeInteger(size.lines) && Number(size.lines) > 0
}
