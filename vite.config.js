import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pages = ['index', 'brush-2d', 'cards-2_5d', 'volume-3d'];

// The demo pages live in demos/ next to src/. This plugin makes demos/ the
// site root: the dev server redirects / to /demos/, and the build writes
// demos/*.html to the top of dist/ (asset URLs are absolute, so they still work).
function demosAsSiteRoot() {
  return {
    name: 'demos-as-site-root',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(302, { Location: '/demos/' });
          res.end();
        } else next();
      });
    },
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.fileName.startsWith('demos/') && file.fileName.endsWith('.html')) file.fileName = file.fileName.slice('demos/'.length);
      }
    },
  };
}

// GitHub Pages serves the repo under /<repo-name>/, so the build uses that
// base path. Override with BASE_PATH if the repository is renamed.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.BASE_PATH || '/smoke-studies/' : '/',
  plugins: [demosAsSiteRoot()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `demos/${p}.html`)])),
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
}));
