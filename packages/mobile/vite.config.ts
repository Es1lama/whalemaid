import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// SPEC: docs/PRODUCT_DESIGN.md#§3 移动端 PWA（Web 先行）
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
})
