import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const staticDir = path.resolve(projectRoot, 'static');
const faviconPath = path.resolve(staticDir, 'favicon.ico');

const faviconPlugin = {
  name: 'copy-static-favicon',
  apply: 'build' as const,
  generateBundle() {
    if (!fs.existsSync(faviconPath)) {
      this.warn(`Missing favicon at ${faviconPath}`);
      return;
    }

    const source = fs.readFileSync(faviconPath);
    this.emitFile({
      type: 'asset',
      fileName: 'favicon.ico',
      source,
    });
  },
};

export default defineConfig({
  root: staticDir,
  plugins: [faviconPlugin],
  build: {
    outDir: path.resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(staticDir, 'index.html'),
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT || '8080', 10),
    host: process.env.HOST || '0.0.0.0',
    fs: {
      allow: [projectRoot],
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
