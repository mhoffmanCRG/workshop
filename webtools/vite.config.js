import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One HTML page per tool, so each starts clean (its own styles, window hooks and AXIS toolbar
// state). Add a live tool here and in src/tools.js.
const pages = {
  home: 'index.html',
  gear: 'gear/index.html'
};

// Relative asset paths, so the built dist/ folder works wherever Apache serves it
// (for example http://localhost/workshop/webtools/dist/ inside the AXIS Tools tab).
export default defineConfig({
  base: './',
  plugins: [react()],
  // fixed port: .vscode/launch.json opens http://localhost:5173/ (Ctrl+F5)
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, fileURLToPath(new URL(p, import.meta.url))]))
    }
  }
});
