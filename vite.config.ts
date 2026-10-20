import { defineConfig } from 'vite';
export default defineConfig({
  root: 'examples', base: '/mmd-gltf/', publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
});
