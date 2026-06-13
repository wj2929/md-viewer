import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/renderer/test/setup.ts'],
    include: [
      'src/renderer/**/*.{test,spec}.{ts,tsx}',
      'src/main/__tests__/appDataManager.test.ts',
      'src/main/__tests__/fileHandlers.editing.test.ts',
      'src/main/__tests__/fileHandlers.excalidraw.test.ts',
      'src/main/__tests__/previewContextMenu.editing.test.ts',
      'src/main/__tests__/docxExporter.embeddedImages.test.ts',
      'src/main/__tests__/exportHandlers.chartsZip.test.ts',
      'src/main/__tests__/cli*.test.ts',
      'src/main/__tests__/pathValidator.previewable.test.ts',
      'src/main/__tests__/remoteDocxExporter.test.ts',
      'src/main/__tests__/securityPolicy.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: [
        'src/renderer/src/main.tsx',
        'src/renderer/src/**/*.d.ts',
        'src/renderer/test/**/*'
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80
    }
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
      '@': path.resolve(__dirname, 'src/renderer/src')
    }
  }
})
