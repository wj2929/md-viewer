// 简单的 LRU 缓存实现
class LRUCache<K, V> {
  private cache: Map<K, V>
  private maxSize: number

  constructor(maxSize: number) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // 将访问的项移到最后（表示最近使用）
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    // 如果key已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    // 如果缓存已满，删除最早的项（Map的第一个键）
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value as K
      this.cache.delete(firstKey)
    }

    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// 全局文件内容缓存实例
const fileContentCache = new LRUCache<string, string>(5)

// 使用缓存读取文件
export async function readFileWithCache(filePath: string): Promise<string> {
  // 检查缓存
  const cached = fileContentCache.get(filePath)
  if (cached !== undefined) {
    console.log(`Cache hit: ${filePath}`)
    return cached
  }

  // 缓存未命中，读取文件
  console.log(`Cache miss: ${filePath}`)
  const content = await window.api.readFile(filePath)

  // 存入缓存
  fileContentCache.set(filePath, content)

  return content
}

// 清除缓存
export function clearFileCache(filePath?: string): void {
  if (filePath) {
    // 清除特定文件的缓存
    fileContentCache.delete(filePath)
    console.log(`Cache cleared for: ${filePath}`)
  } else {
    // 清除所有缓存
    fileContentCache.clear()
    console.log('Cache cleared: all')
  }
}

// 使缓存失效并重新读取文件
export async function invalidateAndReload(filePath: string): Promise<string> {
  fileContentCache.delete(filePath)
  console.log(`Cache invalidated: ${filePath}`)
  const content = await window.api.readFile(filePath)
  fileContentCache.set(filePath, content)
  return content
}

// 获取缓存状态（用于调试）
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: fileContentCache.size,
    maxSize: 5
  }
}
