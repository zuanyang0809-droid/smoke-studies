import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The demos folder is the site root: demos/index.html is the landing page.
// GitHub Pages serves the repo under /<repo-name>/, so the build uses that
// base path. Override with BASE_PATH if the repository is renamed.
export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'demos'),
  base: command === 'build' ? process.env.BASE_PATH || '/smoke-studies/' : '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'demos/index.html'),
        brush2d: resolve(__dirname, 'demos/brush-2d.html'),
        cards25d: resolve(__dirname, 'demos/cards-2_5d.html'),
        volume3d: resolve(__dirname, 'demos/volume-3d.html'),
      },
    },
  },
  test: {
    root: __dirname,
    include: ['tests/**/*.test.js'],
  },
}));
