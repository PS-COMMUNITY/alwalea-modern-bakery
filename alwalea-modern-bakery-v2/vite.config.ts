import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// جذر الـ renderer: src/renderer — البناء إلى dist/ في جذر المشروع
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  css: {
    // منع التقاط postcss.config.mjs الخاص بمجلد المعاينة الأب
    postcss: { plugins: [] }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    assetsInclude: ['**/*.woff2'],
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html')
    }
  }
})
