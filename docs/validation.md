# Validation record

## Issue #11: three-mmd 0.1.1 reference upgrade

Local pre-merge validation on 2026-10-21, Node.js 24.12.0, npm 11.6.2, macOS,
Google Chrome headless with SwiftShader. This covers the built static preview,
not the deployed Pages site.

- `npm view @takahirox/three-mmd@0.1.1` confirms the published version and
  `three: ~0.186.0` peer dependency. `npm ci` succeeds with its registry tarball
  and integrity locked in `package-lock.json`. `npm ls three @takahirox/three-mmd`
  reports `@takahirox/three-mmd@0.1.1` and one shared `three@0.186.1`, with the
  reference's peer deduplicated to that installation.
- `npm run typecheck` passes without compatibility changes to the demo.
- `npm test` passes all eight converter/plugin tests and the independent
  extension checker: 43 shading vectors, ten shared mappings, 56 schema cases,
  ten whole-asset cases and two complete glTF examples. Generated GLBs have zero
  Khronos Validator errors; the expected draft-extension notices remain.
- `npm run build` passes, verifies all 13 pinned source files and retains the
  original PMX/images/notices and attributed derivative. The example GLB remains
  4,770,504 bytes with SHA-256
  `b6e8318feda9738e1fc29ad7fefdbe66d7c1cceb4414eed86d799f56ad3efb00`.
  The existing large-bundle warning remains (1,174.10 kB, 340.82 kB gzip).
- `npm run test:browser` passes three tests; the optional native-WebGPU case is
  explicitly skipped because no adapter is available. All 43 production TSL
  numeric vectors pass on WebGL2. The built comparison loads both models and
  checks aligned bounds/silhouettes, static pose/scale, synchronized orbit and
  zoom, Front/Side/Back presets, toon/PBR/toon switching with an unchanged PMX
  reference, served source/notice hashes, mobile layout and the missing-PMX-image
  error path. Normal operation has no asset/network/console/runtime/shader errors.
- Real front, side and back captures were opened and inspected alongside the
  historical 0.1.0 captures. The reference has darker scarf/trousers and clearer
  texture detail, with remaining independent brightness/highlight differences.
  No obvious new geometry, material, texture, alpha or orientation defects were
  found. The [comparison record](comparison.md) includes all three updated paired
  captures and retains the historical evidence. No converter, plugin, normative
  material equations, conformance fixtures or model rights notices changed.
- `npm run check:links` and `git diff --check` pass.

`npm ci` also reports two audit findings (one low, one high); unrelated dependency
updates were not included in this reference-loader upgrade.

## Issue #9: direct PMX comparison and occlusion correction

Local pre-merge validation on 2026-10-20, Node.js 24.12.0, macOS,
Google Chrome headless with SwiftShader. This covers the built static preview,
not a deployment.

- `npm ci` installs the published, integrity-locked
  `@takahirox/three-mmd@0.1.0`; `npm ls three` confirms one shared `0.186.1`.
- `npm run typecheck` passes.
- `npm test` passes all eight converter/plugin tests and the original independent
  checker: 43 shading vectors, ten shared mappings, 56 schema cases, ten
  whole-asset cases, two complete example assets. Both generated GLBs have
  zero Khronos Validator errors; the expected draft `UNSUPPORTED_EXTENSION`
  notice remains. The new regression checks opaque versus blended Gene
  materials and synthetic alpha/material/subtexture/sphere cases.
- `npm run build` passes and re-verifies all 13 source files. The generated
  source directory is rebuilt from its allowlist; tests verify its exact file
  set and source hashes. The static artifact includes the original PMX, ten
  PNGs, both unchanged notices, derivative GLB, manifest and conversion record.
  No full Gene, unrelated/private images, motions or conformance page ships.
  Vite reports its existing large-renderer-bundle warning (now about 1,173 kB,
  341 kB gzip including the reference loader).
- `UPDATE_COMPARISON_EVIDENCE=1 npm run test:browser` passes three tests with
  one native-WebGPU capability skip (no adapter). All 43 production GPU numeric
  vectors still pass on WebGL2. Built-preview tests cover both loaders, visible
  model silhouettes, aligned world bounds and pixel extents, synchronized orbit
  and zoom from opposite panes, fixed front/side/back views, PBR/toon switching
  with an unchanged PMX reference, every served source hash and notice, equal
  stacked mobile views, and a clear error when a PMX image is missing. Normal
  operation has no console, network, shader or runtime errors.
- Six committed WebGL2 screenshots were actually opened and visually reviewed:
  matched front/side/back pairs before and after. The
  [investigation record](comparison.md) identifies the unconditional BLEND
  defect, its correction and remaining independently implemented shading
  differences. No normative material math or conformance expectation changed.
- `npm run check:links` and `git diff --check` pass.

Generic corrected GLB: 4,767,640 bytes, SHA-256
`fe4e0b54174e3083ac400b0b8a9f3a256fcb8b0b0e896d953a98b5e48e198a85`.
Attributed example GLB: 4,770,504 bytes, SHA-256
`b6e8318feda9738e1fc29ad7fefdbe66d7c1cceb4414eed86d799f56ad3efb00`.
The conversion record includes source commit, derivative bytes/hash and 0.08
meters per PMX unit. Every original PMX/image/notice hash remains unchanged.

During implementation, the first browser invocation exposed a JSON-import
attribute requirement in the runner; the import was corrected. The next run
exposed residual orbit damping after a fixed-view reset, which changed the
reference pixels during material switching. View presets now clear residual
damping before applying the exact camera. The final suite passes.

## Historical Issue #7 validation

The following describes the original one-model implementation before Issue #9.
Its artifact sizes and source-asset exclusions are historical.

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

**Completed for Issue #11 on 2026-10-21 JST (2026-10-20 UTC).** PR #12
was merged with a merge commit after a fresh read confirmed Issue #11 was open.
GitHub accepted the expected PR head
`10c3ae09eae8bd9dd79dd914a5a3cb85baf1d244`.

- Deployed merge commit: `b7df74479af0f0ad6e3e4dd264ceba93b93d5c98`.
  Its two parents are the prior `main` and the reviewed PR head, preserving the
  checkpoint history. The deployed commit's manifest and lockfile resolve
  `@takahirox/three-mmd@0.1.1` with `three@0.186.1`.
- [Validate and deploy Gene Light, run 39505253257](https://github.com/takahirox/mmd-gltf/actions/runs/39505253257)
  completed successfully, including both build and deploy jobs. GitHub Pages
  deployment `7212211911` reports success for that commit at
  `2026-10-20T22:05:44Z` and
  [the public demo](https://takahirox.github.io/mmd-gltf/).
- A temporary copy of the existing paired-model browser tests targeted that
  public URL with Google Chrome headless and SwiftShader. The WebGL2 test passed
  in a 46.6-second run; native WebGPU was explicitly skipped because no adapter
  was available. No local preview or development server was used for these checks.
- Both labeled models rendered with 13 materials/mesh primitives, static pose,
  scale 0.08 and aligned bounds. Synchronized orbit and zoom from opposite panes,
  Front/Side/Back presets, toon/PBR/toon switching with an unchanged PMX reference,
  and equal stacked mobile views passed. Attribution, CC BY 4.0 and retained
  trademark/design-rights text remained visible. There were no asset/network,
  console, runtime or shader errors during normal operation.
- All 13 original PMX/image/notice files returned HTTP 200 and matched the pinned
  source SHA-256 values. Both source manifest and conversion record loaded.
  The deployed GLB returned HTTP 200, contained 4,770,504 bytes and matched its
  published conversion record's SHA-256:
  `ff7a3fd2b3c81a91fc201d4b83ca495ca8fb31a98af0ae933f1aee14229087b2`.
- This deployment hash differs from the earlier local hash. Comparing the
  deployed GLB with a fresh local generation found identical binary chunks and
  exactly one JSON-number difference: material 12's PBR base-color red factor is
  `0.09084170002889219` deployed versus `0.0908417000288922` locally. This tiny
  numeric difference does not indicate changed model/image bytes or a visible
  regression; the earlier local hash must not be used as the deployment hash.
- Real deployed [front](comparison/deployed-front.png) and
  [side](comparison/deployed-side.png) captures were opened and inspected. Both
  show aligned models without obvious new geometry, texture, alpha or orientation
  defects. The documented independent shading/brightness differences remain.

This publication record and its two captures are saved in the merge node's
worktree checkpoint; they are not part of the deployed merge commit.
