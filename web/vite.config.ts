import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Object form on purpose: the string shorthand rewrites the Host header to the
// target, and the API compares Host with Origin to refuse cross-site requests.
const api = { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': api },
  },
  preview: {
    port: 5173,
    proxy: { '/api': api },
  },
});
