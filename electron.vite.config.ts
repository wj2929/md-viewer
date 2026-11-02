import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { transform } from 'esbuild'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['pdf-lib', 'yaml'] }),
      {
        name: 'bundle-wiki-yaml',
        async renderChunk(code, chunk) {
          if (chunk.name !== 'wiki-yaml') return null
          return transform(code, { minify: true, legalComments: 'eof', target: 'node22' })
        },
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === 'chunk' && chunk.name === 'wiki-yaml') {
              chunk.code += `\n/*! yaml/LICENSE\n${readFileSync(resolve(__dirname, 'node_modules/yaml/LICENSE'), 'utf8')}\n*/\n`
            }
          }
        },
      },
      {
        name: 'minify-pdf-vendor',
        async renderChunk(code, chunk) {
          if (chunk.name !== 'pdf-vendor') return null
          return transform(code, { minify: true, legalComments: 'eof', target: 'node22' })
        },
        generateBundle(_options, bundle) {
          const notices = [
            'pdf-lib/LICENSE.md', '@pdf-lib/standard-fonts/LICENSE.md', '@pdf-lib/upng/LICENSE',
            'pako/LICENSE', 'pdf-lib/node_modules/tslib/LICENSE.txt',
          ].map(file => `${file}\n${readFileSync(resolve(__dirname, 'node_modules', file), 'utf8')}`).join('\n\n')
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === 'chunk' && chunk.name === 'pdf-vendor') {
              // 在后续转换结束后保留完整许可；不能只依赖源 JS 自带的 legal comments。
              chunk.code += `\n/*! PDF dependency licenses\n${notices}\n*/\n`
            }
          }
        },
      },
    ],
    resolve: {
      alias: { yaml: resolve(__dirname, 'node_modules/yaml/browser/index.js') },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/yaml/')) return 'wiki-yaml'
            if (id.includes('/node_modules/pdf-lib/') || id.includes('/node_modules/@pdf-lib/')) return 'pdf-vendor'
          },
        },
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          watcherProcess: resolve(__dirname, 'src/main/watching/watcherProcess.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'src/renderer/public'),
    server: {
      port: 5897,
      strictPort: true
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          serverRender: resolve(__dirname, 'src/renderer/server-render.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
