# Validation record

## Issue #17: three-mmd 0.1.2 reference upgrade

Local pre-merge validation on 2026-10-22, Node.js 24.12.0, npm 11.6.2,
Darwin ARM64, Google Chrome 156.0.8078.48 headless with SwiftShader. This covers
the built static preview; publication remains pending after merge.

- `npm view @takahirox/three-mmd@0.1.2` confirms the published package,
  `three: ~0.186.0` peer and npm `gitHead`
  `5ae203246ccffd86a3e8fb7be0e34b9559c33a46`. Reviewed the runtime source diff
  from published 0.1.1, release record and shading notes; the
  [comparison report](comparison.md) records the relevant lighting/morph changes.
  No demo loader compatibility changes were needed; scene settings remain fixed.
- `npm ci` passes with exact 0.1.2 tarball/integrity in the lockfile.
  `npm ls three @takahirox/three-mmd` reports 0.1.2 with its peer deduplicated
  to the one `three@0.186.1` runtime. The existing two audit findings (one low,
  one high) remain; no unrelated dependency upgrade was included.
- `npm run typecheck` passes. `npm test` passes all eight converter/plugin tests,
  43 toon shading vectors, ten shared mappings, 56 toon schema cases, ten toon
  asset cases and two toon glTF examples. The outline checker also passes its
  35 position vectors, 20 fragment vectors, 23 schema cases, 30 asset cases,
  flag/default/skip/draw-order checks and three glTF examples. Validated GLBs
  have zero errors; existing draft-extension notices remain.
- `npm run build` passes, verifying all 13 pinned source files. The attributed
  GLB remains 4,770,504 bytes, SHA-256
  `b6e8318feda9738e1fc29ad7fefdbe66d7c1cceb4414eed86d799f56ad3efb00`.
  The existing large-bundle warning remains (1,174.26 kB, 340.91 kB gzip).
- `UPDATE_COMPARISON_EVIDENCE=1 npm run test:browser` passes three tests; optional
  native WebGPU is explicitly skipped because no adapter is available. All 43
  production TSL numeric vectors pass on WebGL2. The built-site tests cover both
  labeled models, matched bounds/silhouettes, static pose/scale, synchronized
  orbit/zoom, all presets, toon/PBR/toon switching with an unchanged PMX reference,
  restored toon pixels, all served source/notice hashes, mobile layout and the
  missing-PMX-image error path. Normal operation reports no asset/network,
  console, runtime or shader errors. The built footer identifies version 0.1.2.
- Opened and visually inspected all three new version-labeled captures alongside
  0.1.1. The PMX reference is brighter, especially jacket/face/hair/boots; no
  obvious new geometry, alpha, texture or orientation regression was observed.
  An independent decoded-pixel comparison confirms zero changed glTF-half pixels
  in every view. Historical evidence is retained. The capture-update switch now
  writes only the 0.1.2 filenames, preserving the historical 0.1.0 files.
- `npm run check:links` passes all 95 local links/anchors and built asset links;
  `git diff --check` passes.

The converter, local glTF plugin, PBR fallback, normative equations, color-space
rules, conformance vectors, original assets and rights notices are unchanged.
No original-MMD fidelity claim follows from the closer visual brightness.

## Issue #13: original-MMD research checkpoint

Local checks on 2026-10-21, Node.js 24.12.0, npm 11.6.2, Darwin ARM64,
Google Chrome headless with SwiftShader. This is partial research/input
preparation, **not completion of Issue #13**. See the
[primary-evidence report, audit matrix and capture request](original-mmd-research.md).

- Read the live issue before the later verification follow-up (no comments at
  that time). Downloaded the author's Japanese
  9.32 x64 archive, hashed the executable and inspected its readme and embedded
  effect resources. Re-executed the report's local inspection recipe and
  obtained the recorded hashes. No original MMD executable was run and no
  reference pixels, original scene defaults or D3D9 state trace were obtained.
- `npm ci` succeeds with the existing lockfile. Its two audit findings (one
  low, one high) remain; no dependency changes were made.
- `npx tsx tools/generate-mmd-probes.ts` succeeds: 80 newly authored PMX files
  reparse with checked source factors/selectors; all 80 corresponding GLBs
  pass the Khronos Validator with zero errors. Six synthetic PNGs and a
  manifest record requested inputs, 166 asset hashes and null MMD observations.
  An independent file/hash check matches the manifest. Inputs use UTF-16LE
  for compatibility with the pinned parser. MMD acceptance/rendering is untested.
- `npm run typecheck` and `npm test` pass: eight converter/plugin tests,
  43 draft shading vectors, ten shared mappings, 56 schema cases, ten asset
  cases and two complete glTF examples. These are draft consistency checks.
- `npm run build` passes with the existing large-bundle warning. The attributed
  Gene GLB is unchanged: 4,770,504 bytes, SHA-256
  `b6e8318feda9738e1fc29ad7fefdbe66d7c1cceb4414eed86d799f56ad3efb00`.
- `npm run test:browser` passes three tests, including all 43 production TSL
  vectors on WebGL2 and the built Gene comparison/navigation/toon-PBR switching,
  source hashes, mobile layout and missing-image path. Native WebGPU is skipped
  because no adapter is available. No original-MMD GPU comparison is claimed.
- `npm run check:links` and `git diff --check` pass. The spec, fixture guide,
  README, comparison report and demo now make the primary-verification gap
  explicit. Existing captures retain their historical provenance; no corrected
  shading capture, numerical oracle or normative equation is invented.

Pre-merge acceptance for this research checkpoint covers the agent-verifiable
research/provenance report, reproducible validated probe inputs, explicit
fidelity limitations and applicable automated checks recorded above. Per
[Issue #13's verification follow-up](https://github.com/takahirox/mmd-gltf/issues/13#issuecomment-6307160015),
manual original-MMD observations are pending post-merge verification, not Issue
completion criteria or a merge gate for this checkpoint.

Remaining implementation work is evidence-supported spec/plugin/adapter
corrections, independent measured fixtures and GPU comparisons, once primary
observations support them. Those corrections are not implemented or claimed by
this partial checkpoint; Issue #13 remains open for that work. No original-MMD
fidelity result is inferred from deferring manual verification.

Verification-gate revision on 2026-10-21: reviewed the cited Issue follow-up and
aligned this record, the research report and PR description.
`npm ci --no-audit --no-fund` succeeds. `npm run build` passes with the existing large-bundle
warning; `npm run check:links` passes all 74 local links/anchors and built asset
links, and `git diff --check` passes. The first link-check attempt found missing
local dependencies; installing the lockfile and building the static output
resolved it. Reviewed the complete documentation diff for Markdown and
consistent gate/status wording. Type, unit and browser suites were not repeated
for this documentation-only revision; their earlier results above are historical.

PR linkage revision on 2026-10-21: updated PR #14's Related Issues section to
`Related to #13` and removed the contradictory intended-closing statement.
The description explicitly leaves Issue #13 open for the remaining implementation.
Read back the live PR body, confirmed the saved text matches the correction and
contains no closing reference to Issue #13, and confirmed the PR head is unchanged.
Reviewed the complete local diff for Markdown and consistency with the partial
scope; `git diff --check` passes. No links or runtime files changed, so build,
type, unit and browser checks were not repeated for this metadata/log revision.

Publication persistence revision on 2026-10-21: a subsequent publication restored
the closing reference in the live PR body. Corrected PR #14 again to use
`Related to #13`, removed the contradictory publication explanation, and saved
the complete corrected body in [the PR publication artifact](../.github/pr-14-body.md).
Subsequent publication must use that body and preserve the non-closing reference:
the remaining implementation scope is still open under Issue #13. Live readback
matches the saved body, contains no closing keyword for Issue #13, and retains
PR head `3b2e421846b201ec9e6cd3182777c7e195833231`. Reviewed the complete diff,
Markdown headings and links; `git diff --cached --check` passes. No runtime files
changed, so type, unit, build and browser suites were not repeated.

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

**Pending.** No merge or publication is established by the local validation
records above. After merging and the Pages workflow completes:

1. Record the deployed commit, workflow run URL/result, deployment URL and date.
   Confirm that commit's manifest and lockfile resolve
   `@takahirox/three-mmd@0.1.2` for the direct PMX reference (Issue #17).
2. Open `https://takahirox.github.io/mmd-gltf/` and confirm
   both correctly labeled models are visible in the same base pose, orbit/zoom
   stays synchronized, Front/Side/Back presets work, narrow layouts stack, and
   glTF toon/PBR/toon switching succeeds without changing the PMX reference.
3. Confirm `gene-light/model.glb`, `gene-light/Gene_light.pmx`, all ten original
   `gene-light/light/` PNGs, both original notices, `source-manifest.json`
   and `conversion.json` load under `/mmd-gltf/`, with the displayed attribution,
   usage terms, adaptation notice and matching artifact hash.
4. Inspect browser console/network for asset, shader and runtime errors. Verify
   WebGL2 with `?backend=webgl`; check native WebGPU when an adapter is available.

These are required publication checks after merge; local checks do not prove
that deployment succeeds.

Issue #13's manual original-MMD verification is also **pending post-merge**, per
the linked follow-up. Follow the [capture protocol](original-mmd-research.md#capture-request-and-blocker)
to record build/settings, lossless frames, interior pixel measurements and
relevant D3D9 states, specifically discriminating ambient 0.5 versus 1 and
RGB/alpha color-domain behavior. Record actual results and resulting correction
work when available; these observations do not gate this checkpoint's merge or
Issue completion.
