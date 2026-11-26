import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths, so the built dist/ folder works wherever Apache serves it
// (for example http://localhost/workshop/webtools/dist/ inside the AXIS Tools tab).
export default defineConfig({
  base: './',
  plugins: [react()],
  // fixed port: .vscode/launch.json opens http://localhost:5173/ (Ctrl+F5)
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true }
});
