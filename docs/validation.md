# Validation record

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

**Completed on 2026-10-20 after merge.** Issue #9 was freshly read and confirmed
open immediately before the merge request. GitHub merged PR #10 using the exact
reviewed head `ef56fc2b118ec1c39a03c93ad42e9256260cf4b2` and the merge method
`merge`, without overriding checks or reviews. The resulting merge commit is
`25a0e24f0cbaff1e28cca5b150d45630cef17017`; GitHub subsequently closed Issue #9.

- [Pages workflow 39406851711](https://github.com/takahirox/mmd-gltf/actions/runs/39406851711)
  completed successfully for that merge commit, including all build, typecheck,
  unit, browser, link and whitespace checks and the Pages deployment job.
  GitHub Pages deployment `7197192759` reports success at
  `2026-10-20T10:19:22Z` for the same commit and
  [public comparison URL](https://takahirox.github.io/mmd-gltf/).
- The built-site comparison tests were adapted in an ignored temporary harness
  to target the public HTTPS URL, without starting local servers or updating
  committed evidence. Headless Chrome/SwiftShader WebGL2 passed; optional native
  WebGPU was skipped because no adapter was available. Both labeled models
  loaded with 13 materials, matching world bounds and synchronized cameras.
  Orbit from the PMX pane, zoom from the glTF pane, Front/Side/Back presets,
  toon/PBR/toon switching with unchanged PMX pixels, and the stacked 600-pixel
  layout all passed. Console, page errors, failed requests and HTTP error
  responses were monitored; none occurred during the passing WebGL2 test.
- All 13 original PMX/image/notice files loaded publicly and matched their
  pinned SHA-256 values. The served source manifest exactly matched the checked-in
  manifest. English/Japanese notice links, attribution, CC BY 4.0, noncommercial
  scope and adaptation text were visible. The GLB and conversion record loaded;
  their byte count and hash agreed, with the expected pinned source commit.
- Public front, side and back browser captures were opened and visually reviewed.
  All three are byte-identical to the committed
  [after captures](comparison.md#before-and-after). Hair, face, scarf, sleeves,
  boots and rear jacket retain the corrected occlusion; silhouette and texture
  landmarks align. The documented independent shading differences remain,
  including the grayer PMX and brighter, higher-contrast glTF.

The published GLB is 4,770,504 bytes with SHA-256
`ff7a3fd2b3c81a91fc201d4b83ca495ca8fb31a98af0ae933f1aee14229087b2`.
An initial extra assertion against the macOS-local hash above failed. Investigation
rebuilt locally and compared both GLBs: their entire 4,755,680-byte binary payloads
are identical, and the only JSON value difference is material 12's core PBR
`baseColorFactor[0]`, `0.0908417000288922` locally versus
`0.09084170002889219` in the Linux CI artifact. This last-digit floating-point
variation means whole-file hashes are not identical across these environments;
it does not change geometry, images or the normative toon values. The final
public test verifies the published bytes against their own conversion record
rather than assuming the macOS artifact hash. It passed, including the remaining
attribution, mobile-layout and error checks. Local `npm run build` also passed
during this investigation, with the existing bundle-size warning.
