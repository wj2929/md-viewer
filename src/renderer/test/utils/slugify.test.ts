import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlugify } from '../../src/utils/slugify'

describe('slugify 工具函数测试', () => {
  describe('slugify', () => {
    it('应该将英文标题转换为小写 slug', () => {
      expect(slugify('Hello World')).toBe('hello-world')
    })

    it('应该处理中文标题', () => {
      expect(slugify('你好世界')).toBe('你好世界')
    })

    it('应该处理混合中英文标题', () => {
      expect(slugify('Hello 世界')).toBe('hello-世界')
    })

    it('应该移除特殊字符', () => {
      expect(slugify('Hello! World?')).toBe('hello-world')
    })

    it('应该将多个空格转换为单个连字符', () => {
      expect(slugify('Hello   World')).toBe('hello-world')
    })

    it('应该移除首尾连字符', () => {
      expect(slugify('  Hello World  ')).toBe('hello-world')
    })

    it('应该处理只有数字的标题', () => {
      expect(slugify('123')).toBe('123')
    })

    it('应该处理数字和字母混合', () => {
      expect(slugify('Chapter 1')).toBe('chapter-1')
    })

    it('应该为空标题生成随机 ID', () => {
      const slug = slugify('')
      expect(slug).toMatch(/^heading-[a-z0-9]+$/)
    })

    it('应该为只有特殊字符的标题生成随机 ID', () => {
      const slug = slugify('!@#$%^&*()')
      expect(slug).toMatch(/^heading-[a-z0-9]+$/)
    })

    it('应该保留连字符', () => {
      expect(slugify('pre-existing')).toBe('pre-existing')
    })

    it('应该合并多个连续连字符', () => {
      expect(slugify('hello---world')).toBe('hello-world')
    })
  })

  describe('uniqueSlugify', () => {
    it('应该为第一个标题生成基础 slug', () => {
      const usedSlugs = new Map<string, number>()
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello')
    })

    it('应该为重复标题添加数字后缀', () => {
      const usedSlugs = new Map<string, number>()
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello')
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello-1')
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello-2')
    })

    it('应该独立处理不同的标题', () => {
      const usedSlugs = new Map<string, number>()
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello')
      expect(uniqueSlugify('World', usedSlugs)).toBe('world')
      expect(uniqueSlugify('Hello', usedSlugs)).toBe('hello-1')
    })

    it('应该正确处理中文重复标题', () => {
      const usedSlugs = new Map<string, number>()
      expect(uniqueSlugify('简介', usedSlugs)).toBe('简介')
      expect(uniqueSlugify('简介', usedSlugs)).toBe('简介-1')
    })
  })
})
