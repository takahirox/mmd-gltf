import { defineConfig } from 'vite';
export default defineConfig({
  root: 'examples', base: '/mmd-gltf/', publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: ['examples/solver-conformance.html', 'examples/index.html', 'examples/rig.html', 'examples/vpd-conformance.html', 'examples/vmd-conformance.html', 'examples/sdef-conformance.html', 'examples/qdef-conformance.html', 'examples/group-advanced-conformance.html'] } },
});
