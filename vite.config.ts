/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-flow': ['@xyflow/react'],
          'vendor-data': ['@supabase/supabase-js', 'zustand', 'zod'],
          'vendor-export': ['html2canvas', 'jspdf'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities']
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx']
  }
})
