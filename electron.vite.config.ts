import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    define: { __SUMI_SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN || '') },
    plugins: [
      {
        name: 'tencent-agent-memory-license',
        generateBundle() {
          for (const name of ['LICENSE', 'SOURCE.json']) {
            this.emitFile({ type: 'asset', fileName: `licenses/tencent-agent-memory-${name}`, source: readFileSync(resolve(__dirname, 'src/main/vendor/tencent-agent-memory', name)) })
          }
        },
      },
      externalizeDepsPlugin({
        exclude: ['@anthropic-ai/claude-agent-sdk', 'electron-store']
      })
    ],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer')
    }
  }
})