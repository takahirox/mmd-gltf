/** See docs/browser-ci.md for the assertion-by-assertion replacement map.
 * Full matrices remain runnable for measurements on the same CPU runner. */
export const solverCases = [
  ['bytes', 'a'], ['bytes', 'b'], ['bytes', 'pose-a'], ['bytes', 'pose-b'],
  ['glb', 'a'], ['glb', 'pose-b'], ['gltf', 'b'], ['gltf', 'pose-a'],
  ['export-glb', 'a'], ['export-glb', 'pose-a'],
  ['export-gltf', 'b'], ['export-gltf', 'pose-b'],
] as const;

// Each material sees both motions and all three loader paths on each rig.
// Motion identity changes uniforms/data, not the BDEF shader graph.
export const vmdCases = [
  ['toon', 'bytes', 'a'], ['toon', 'glb', 'b'], ['toon', 'gltf', 'a'],
  ['pbr', 'bytes', 'b'], ['pbr', 'glb', 'a'], ['pbr', 'gltf', 'b'],
] as const;
