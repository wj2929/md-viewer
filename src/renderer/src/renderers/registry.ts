import type { RendererDefinition, RendererRegistry, RendererType } from './types'

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase()
}

export function createRendererRegistry(definitions: RendererDefinition[]): RendererRegistry {
  const byType = new Map<RendererType, RendererDefinition>()
  const byLanguage = new Map<string, RendererDefinition>()

  for (const definition of definitions) {
    if (byType.has(definition.type)) {
      throw new Error(`Duplicate renderer type: ${definition.type}`)
    }
    byType.set(definition.type, definition)

    for (const language of [...definition.languages, ...definition.aliases]) {
      const normalized = normalizeLanguage(language)
      if (!normalized) continue

      const existing = byLanguage.get(normalized)
      if (existing) {
        throw new Error(`Duplicate renderer language: ${normalized} (${existing.type}, ${definition.type})`)
      }
      byLanguage.set(normalized, definition)
    }
  }

  return {
    definitions: [...definitions],
    resolveLanguage: (language) => byLanguage.get(normalizeLanguage(language)),
    getByType: (type) => byType.get(type),
  }
}
