import { defineConfig } from 'vite';
export default defineConfig({
  root: 'examples', base: '/mmd-gltf/', publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: ['examples/index.html', 'examples/rig.html', 'examples/vpd-conformance.html'] } },
});
