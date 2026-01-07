/**
 * Slug 生成模块
 * 用于生成 URL 友好的标题 ID，确保与 markdownRenderer.ts 一致
 */

/**
 * 生成 URL 友好的 slug
 * @param text - 标题文本
 * @returns slug 字符串
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    // 保留字母（含中日韩）、数字、空格、连字符
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  // 如果 slug 为空，生成一个随机 ID
  return slug || `heading-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 生成唯一 slug（处理重复标题）
 * @param text - 标题文本
 * @param usedSlugs - 已使用的 slug 计数器
 * @returns 唯一的 slug 字符串
 */
export function uniqueSlugify(
  text: string,
  usedSlugs: Map<string, number>
): string {
  const baseSlug = slugify(text)
  const count = usedSlugs.get(baseSlug) || 0
  const slug = count > 0 ? `${baseSlug}-${count}` : baseSlug
  usedSlugs.set(baseSlug, count + 1)
  return slug
}
