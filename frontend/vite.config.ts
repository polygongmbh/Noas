import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte()],
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        verify: resolve(__dirname, 'verify.html'),
        portal: resolve(__dirname, 'portal.html'),
        docs: resolve(__dirname, 'docs.html'),
        404: resolve(__dirname, '404.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
  },
});
