# Issue #7 validation record

Local validation on 2026-10-20, Node.js 24.12.0, macOS, Google Chrome headless.
This record covers the pre-merge worktree, not a published deployment.

- TypeScript checks pass (`npm run typecheck`).
- The original conformance checker passes: 43 shading vectors, 10 shared mappings,
  56 schema cases, 10 whole-asset cases, and 2 complete example assets.
- Converter/plugin tests pass (`npm test`): deterministic pinned-source conversion,
  Khronos glTF Validator with zero errors, geometry/index/UV checks, unchanged
  image hashes, separate PBR factors, material modes, shared/custom selectors,
  unpacked glTF resources, invalid inputs and missing resource/error paths.
- WebGL2 browser checks pass using the actual production TSL graph and generated
  Gene Light GLB (`npm run test:browser`). All 43 independent numerical material
  vectors pass against float-target readback, including linear compositing and
  an actual sRGB output check. Numerical tolerance is 2e-6 for GPU floats and
  2/255 at the quantized canvas boundary. Existing fixture expectations are
  unchanged. Full GLTFLoader tests also cover PNG decoding, simultaneous PBR
  use of the same image, and deliberately contradictory core material factors.
- The built static example renders 13 mesh primitives, switches toon/PBR/back, and
  serves notices/manifest/conversion record without asset, shader or runtime
  errors. A screenshot was inspected locally; no MMD visual-equivalence claim
  is made. Browser artifacts live in ignored `test-results/`.
- Native WebGPU: capability skip; no adapter is available in this headless
  environment. The renderer's WebGL2 backend is tested with SwiftShader.
- Static build and repository-prefix link/anchor checks pass (`npm run build`,
  `npm run check:links`). The static output contains no conformance entry,
  source PMX or duplicate source textures. Vite reports a large-bundle warning
  for the Three.js renderer bundle (approximately 999 kB, 274 kB gzip).
- `git diff --check` passes.

Generic CLI GLB: 4,767,780 bytes, SHA-256
`c760c80e6b50ec6b66a686b31f44790491db4d3ed5225f16b56e475ea91b9efb`.
Attributed example GLB: 4,770,644 bytes, SHA-256
`6c753b5ccf1f95875fb4cfe1aeb0bbdf3058d9f4cb93d1b88e1cb508433596b5`.
The extra bytes are provenance/rights/conversion metadata. Both are reproducible
from the pinned source with this dependency lockfile. The validator reports
`UNSUPPORTED_EXTENSION` for the draft; extension-specific tests provide its
validation. Source counts: 28,646 vertices, 47,106 triangles, 13 materials and
10 images. Shared MMD image bytes are absent.

The Gene source has a sphere-mode flag with texture index -1 on one material;
conversion disables that absent operation and reports it, retaining the flag
in extras. The [pipeline limitations](pipeline.md) and
[distribution review](gene-light.md) apply. Optional visual comparison against
the upstream animated MMD demo was not performed.

## Required post-merge verification

**Pending.** No push, PR, merge, GitHub comment, or publication was performed
while implementing this node. After merging and the Pages workflow completes:

1. Record the deployed commit, workflow run URL/result, deployment URL and date.
2. Open `https://takahirox.github.io/mmd-gltf/` and confirm the character is visible,
   orbit/zoom works, and toon/PBR/toon switching succeeds.
3. Confirm `gene-light/model.glb`, both original notices, `source-manifest.json`
   and `conversion.json` load under `/mmd-gltf/`, with the displayed attribution,
   usage terms, adaptation notice and matching artifact hash.
4. Inspect browser console/network for asset, shader and runtime errors. Verify
   WebGL2 with `?backend=webgl`; check native WebGPU when an adapter is available.

These are required publication checks after merge; local checks do not prove
that deployment succeeds.
