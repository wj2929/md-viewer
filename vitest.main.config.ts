import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/__tests__/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/**/*.ts'],
      exclude: [
        'src/main/__tests__/**/*',
        'src/main/**/*.d.ts'
      ],
      all: true
    }
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main')
    }
  }
})
