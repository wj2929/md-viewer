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
      'src/shared/**/*.{test,spec}.{ts,tsx}',
      'src/renderer/**/*.{test,spec}.{ts,tsx}',
      'src/main/__tests__/appDataManager.test.ts',
      'src/main/__tests__/appDataManager.folderTabSession.test.ts',
      'src/main/__tests__/dataHandlers.folderTabSession.security.test.ts',
      'src/main/__tests__/fileHandlers.editing.test.ts',
      'src/main/__tests__/fileHandlers.excalidraw.test.ts',
      'src/main/__tests__/fileHandlers.copyMove.security.test.ts',
      'src/main/__tests__/fileHandlers.moveToFolder.security.test.ts',
      'src/main/__tests__/fileHandlers.watcherPrune.test.ts',
      'src/main/__tests__/previewContextMenu.editing.test.ts',
      'src/main/__tests__/docxExporter.embeddedImages.test.ts',
      'src/main/__tests__/exportHandlers.chartsZip.test.ts',
      'src/main/__tests__/exampleHandlers.test.ts',
      'src/main/__tests__/chartExamplesInstaller.test.ts',
      'src/main/__tests__/chartExamplesGenerator.test.ts',
      'src/main/__tests__/cli*.test.ts',
      'src/main/__tests__/localImageEmbed.test.ts',
      'src/main/__tests__/docxWarningAggregator.test.ts',
      'src/main/__tests__/pathValidator.previewable.test.ts',
      'src/main/__tests__/remoteDocxExporter.test.ts',
      'src/main/__tests__/revisionToken.test.ts',
      'src/main/__tests__/contextMenuHandler.test.ts',
      'src/main/__tests__/menuHandlers.recentItems.test.ts',
      'src/main/__tests__/platformMenuLabels.test.ts',
      'src/main/__tests__/securityPolicy.test.ts',
      'src/main/__tests__/security.test.ts',
      'src/main/__tests__/security.realpath.test.ts',
      'src/main/__tests__/senderSecurity.readPath.test.ts',
      'src/main/__tests__/fileHandlers.readAuthorization.test.ts',
      'src/main/__tests__/workspaceTransferCoordinator.test.ts',
      'src/main/__tests__/workspaceWatchService.test.ts',
      'src/main/__tests__/workspaceIndexStore.test.ts',
      'src/main/__tests__/workspaceIndexService.test.ts',
      'src/main/__tests__/workspaceIndexHandlers.security.test.ts',
      'src/main/__tests__/linkRewritePlanner.test.ts',
      'src/main/__tests__/crossRootLinkImpactPlanner.test.ts',
      'src/main/__tests__/linkRewriteHandlers.security.test.ts',
      'src/main/__tests__/windowCleanup.test.ts',
      'src/main/__tests__/diagnosticsService.test.ts',
      'src/main/__tests__/diagnosticsHandlers.test.ts',
      'src/main/__tests__/windowHandlers.workspacePresentation.test.ts',
      'src/main/__tests__/windowTransferCoordinator.test.ts',
      'src/main/__tests__/EdgeAdapter.test.ts',
      'src/main/__tests__/keyStore.test.ts',
      'src/main/__tests__/ttsHandlers.security.test.ts',
      'src/main/__tests__/ttsService.test.ts',
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
