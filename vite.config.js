import { defineConfig } from 'vite';
export default defineConfig(({mode})=>({
  root: 'browser', base: './',
  build: { outDir: mode==='verification'?'../dist-qa':'../dist', emptyOutDir: true, target: 'es2022', ...(mode==='verification'?{rollupOptions:{input:{app:'browser/index.html',verification:'browser/tests/verification.html'}}}:{}) },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
}));
