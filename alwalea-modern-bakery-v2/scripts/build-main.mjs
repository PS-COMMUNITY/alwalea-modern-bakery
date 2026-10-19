// بناء عملية Electron الرئيسية والبريلود عبر esbuild
// main: src/main/main.ts  → dist-electron/main.js   (external: electron, sql.js)
// preload: src/preload/preload.ts → dist-electron/preload.js (cjs، sandbox-safe)
import { build } from 'esbuild'
import { mkdirSync, cpSync } from 'node:fs'

mkdirSync('dist-electron', { recursive: true })

// نسخ الـ migrations إلى dist-electron/migrations (تُقرأ من __dirname وقت التشغيل)
cpSync('src/main/migrations', 'dist-electron/migrations', { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info'
}

await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist-electron/main.js',
  external: ['electron', 'sql.js']
})

await build({
  ...common,
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist-electron/preload.js',
  external: ['electron']
})

console.log('✔ main + preload built to dist-electron/')
