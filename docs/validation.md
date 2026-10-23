# Validation record

## Issue #25: BDEF core skinning

### UTF-8 source-identity review fix

Revision evidence on 2026-10-24: the converter now transcodes UTF-8 PMX 2.0
text buffers before the pinned parser's UTF-16LE reader. The attributed binary
regression verifies exact Japanese/English names (including duplicates, odd/even
byte lengths, supplementary Unicode, leading U+FEFF and combining characters)
after parsing, GLB/glTF conversion and reload, and GLTFLoader display-name changes.
Its generated UTF-16LE counterpart produces identical transcoded bytes; numeric
records and the original input are unchanged. Optional text-bearing record
layouts, malformed UTF-8, truncation and existing SDEF/QDEF rejection are covered.
All four converted outputs have zero core-validator errors.

| Revision check | Actual result |
| --- | --- |
| `npm ci` | Passed; two existing audit findings (one low, one high) |
| `npm run build` | Passed; existing bundle-size warning |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 16 unit/integration tests and existing Toon/Outline CPU/schema/asset suites |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | Seven passed; two optional native-WebGPU tests skipped because no adapter was available |
| WebGL2 conformance | 43 Toon vectors, 109 Outline checks and 12 BDEF comparisons passed; BDEF maximum position error `3.3527612686157227e-8` meters, zero oracle pixel mismatches, exact reset |
| `npm run check:links` | Passed: 122 local links/anchors and built example assets |
| `git diff --check` | Passed |

### Initial implementation evidence

Local pre-merge evidence on 2026-10-23: Node.js 24.12.0, npm 11.6.2,
Darwin ARM64, lockfile Three.js 0.186.1, glTF Transform 4.5.1,
mmd-parser 1.1.4 and Playwright Chromium headless/SwiftShader. No dependency
changes, push, PR, comment, merge or deployment were performed.

| Normal pre-merge check | Actual result |
| --- | --- |
| `npm ci` | Passed with existing lockfile; two existing audit findings (one low, one high) |
| `npm run build` | Passed; Gene comparison and synthetic rig packaged; existing bundle-size warning |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 15 unit/integration tests, existing Toon and Outline CPU/schema/asset suites |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | Seven passed; two optional native-WebGPU tests skipped because no adapter was available |
| Existing WebGL2 conformance | 43 Toon vectors and 109 Outline checks passed |
| New BDEF WebGL2 conformance | All 12 independent numerical/raster comparisons and built rig controls passed |
| `npm run check:links` | Passed: 122 local links/anchors and both built page asset sets; all conformance entries excluded from build |
| `git diff --check` | Passed |

Initial development checks exposed Buffer/Uint8Array assertion typing, the parser
header limitation described below, and a Vite conformance-entry path. These were
corrected before the passing checks. The first browser attempt was interrupted
after its entry-path error; the completed normal run above supersedes it. A link
check made before this evidence section existed failed on its missing anchor and
passed once the section was written. No check failure remains outstanding.

The committed [binary fixture and deterministic generator](../tests/fixtures/README.md)
cover BDEF1/2/4, nonzero bone positions, mixed and duplicate influences, inactive
padding, two materials, forward parents, two source roots, 260 bones (including
unweighted bones), and duplicate exact Japanese/English names. Unit tests verify
byte-identical conversion, complete hierarchy and identity after GLB and unpacked
glTF reload, unchanged rest positions, and explicit scalar deformation predictions
for all 24 vertices. Both output formats and the attributed demo GLB have zero
core-validator errors; optional-material-extension notices are expected.
The CLI BDEF output is byte-identical to API output. Static loss reporting and
the existing Gene workflow remain covered. Rejections cover SDEF/QDEF, unknown
modes, cycles, invalid parents, non-finite positions, malformed influence records,
invalid active bone references, negative/non-finite weights, zero totals and
materially non-unit sums. A roundoff normalization regression checks its warning.

Tolerances are absolute `1e-6` for accepting weight-sum roundoff and `2e-6`
meters for numerical position comparisons. The former permits a few FLOAT
accumulation ulps without changing substantial source deformation; the latter
allows FLOAT weights and inverse binds in this sub-meter test pose. The
[PMX format document](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
explicitly allows non-unit BDEF4 sums, but [core glTF skinning](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skins)
requires normalized weights. The converter rejects materially abnormal sums;
original-MMD handling remains unresolved.

The browser suite loads the actual converter-produced asset with pinned
GLTFLoader. Twelve independent comparisons cover active Toon/core PBR ×
rest/deformed/reset × surface/outline. An analytic baked-geometry oracle uses
explicit scalar rotation/translation formulas and authored influence patterns,
without emitted joint matrices or the production outline equation. Surface
normals follow Three.js's weighted transform; outline normals independently use
the specified inverse transpose. The existing raw-weight/multiple-influence-set
outline tests and their numerical expectations are unchanged.

| BDEF WebGL2 measurement | Actual result |
| --- | --- |
| Maximum loaded surface position error | `3.3527612686157227e-8` meters (limit `2e-6`) |
| Oracle pixel mismatches in all 12 comparisons | Zero at two encoded-level tolerance; allowance is at most 128/25,600 boundary pixels (0.5%) |
| Deformed Toon/PBR surface pixels changed from rest | 5,984 / 6,848 |
| Deformed outline pixels changed from rest | 5,386 for each material path |
| Reset difference from rest | Zero pixels for surfaces and outlines |
| Built interactive rig | Repeatable preset, exact rest reset, Toon/PBR switch and outline toggle passed |

The generated synthetic demo is 49,984 bytes, SHA-256
`28bd6d44709a29bb5bb3dbd6994ced6def8527fdd641bd147bc0c2d413832795`.
Its conversion report retains input/output hashes, attribution, scale and six
roundoff adjustments at source vertices `[2, 6, 10, 14, 18, 22]`.

### Parser evidence correction for the Coordinator

The initial assumption was that the pinned parser's QDEF limitation would first
be encountered when reading a type-4 vertex in a PMX 2.1 file. The corrected
requirement is to report both the earlier PMX 2.1 header rejection and the
independent QDEF record rejection, without approximating either. Primary evidence
is the [distributed mmd-parser 1.1.4 source](https://unpkg.com/mmd-parser@1.1.4/build/mmdparser.js):
`parsePmx` compares the decoded FLOAT version strictly to JavaScript `2.1`, while
binary FLOAT 2.1 decodes as `2.0999999046325684`; `readPmxVertex` also has no type-4
branch. The valid synthetic 2.1 QDEF file reproduces the header failure. A
regression changing only that header to 2.0 reaches the unsupported type-4 error;
that modified file is never treated as valid conversion input. PMX format evidence
defines QDEF as a distinct PMX 2.1 dual-quaternion mode. This finding narrows parser
claims, preserves the agreed PMX 2.0 BDEF contract, and does not relax acceptance.
No external Issue/PR update was made because this node explicitly forbids comments
and PR operations; the Coordinator can carry this record into the normal PR.

SDEF/QDEF, solver/deformation-layer semantics, morph evaluation, physics and
motion/pose loading remain outstanding. This evidence establishes synthetic
BDEF conformance, not VPD/VMD playback or original-MMD equivalence. Optional
alternative-MMD-loader comparison and original-MMD measurements were not
performed. No post-merge verification is required for Issue #25.

## Issue #21: outline review fixes

Local checks on 2026-10-22 with Node.js 24.12.0, npm 11.6.2, Darwin ARM64,
Three.js 0.186.1 and Google Chrome headless/SwiftShader passed:
`npm run typecheck`, `npm test` (including `test:outline` and all 13
converter/plugin tests), `npm run build`, `npm run test:browser`,
`npm run check:links` and `git diff --check`. The browser suite passed four tests;
two optional native-WebGPU tests skipped because no adapter was available.
The existing bundle-size warning remains. No push or merge was performed;
required deployed-site verification remains pending after merge.

The production WebGL2 outline suite now performs **109 checks**. New real
GLTFLoader regressions load `EXT_mesh_gpu_instancing` with single/multiple
primitives, reused mesh nodes, signed/zero vertex scales, enabled/disabled
outline materials and custom instance attributes that clone geometry. Outline
records reach each applicable instance, preserve core PBR materials and detach
on plugin disposal. Single-primitive readback is `[127,0,0,255]`; ordered red/blue
primitives produce `[64,0,127,255]`.

Double-sided `MeshPhysicalMaterial` cases compare transmission 0 and 1 over
opaque black across two frames. Both produce `[127,0,0,255]` for a red edge with
alpha 0.5, confirming one hull contribution rather than the reported duplicate
191/255. Three ordered groups using material indices `[0,1,0]` produce
`[159,0,64,255]`, matching encoded RGB `[0.625,0,0.25]` within the existing
`2/255` tolerance. Distinct groups sharing a material still contribute separately.
The encoded midgray discriminator remains `[64,64,64,255]`. Rendering settings
and the independent normative fixtures remain as recorded below.

## Issue #21: outline pipeline

Local pre-merge checks on 2026-10-22, Node.js 24.12.0, npm 11.6.2, Darwin
ARM64, pinned Three.js 0.186.1 and Google Chrome headless with SwiftShader.
No push, PR, merge, deployment or original-MMD execution was performed.

| Check | Actual result |
| --- | --- |
| `npm ci` | Passed with the existing lockfile; no dependency changes |
| `npm run test:outline` (also included in `npm test`) | Passed: 39 position, 28 fragment, 24 schema and 33 asset cases, flags/skips, four depth/blend sequences, four core-valid examples |
| `npm run typecheck` | Passed |
| `npm test` | Passed: unchanged Toon CPU expectations plus 13 converter/plugin tests, including the independent outline schema/asset corpus and sparse data |
| Khronos glTF Validator 2.0.0-dev.3.10 | Zero core errors for generated Gene and synthetic GLB/glTF outputs; expected `UNSUPPORTED_EXTENSION` notices |
| `npm run build` | Passed; all 13 original source file hashes retained; Vite's existing large-bundle warning remains |
| `UPDATE_COMPARISON_EVIDENCE=1 npm run test:browser` | Four passed, two optional native-WebGPU tests skipped because no adapter was available |
| `npm run check:links` | Passed; local documentation links/anchors and built asset links only |
| `git diff --check` | Passed |

The WebGL2 outline run performs **97 checks** against the production effect and
its shared TSL equation. It uses `antialias:false`, default linear-sRGB working
space, sRGB output, no tone mapping, no scene lighting/shadows/postprocessing,
float probe targets and actual 8-bit canvas readback. Numerical clip tolerance is
`3e-6`; derived fixture pixel positions allow `3e-4` pixels; raster silhouette
bounds use exact integer expectations; covered RGB/alpha allow `2/255`; retained
depth allows `2e-6`. Half-float intermediate attachments are part of the production
path. No independent fixture expectations were changed or generated from the
implementation.

Measured encoded gray `.5` with edge alpha `.5` over opaque black was
`[64,64,64,255] / 255`, or RGB **0.2509803922**, rather than conventional
linear-light compositing near 0.36. All independent fragment cases and ordered
sequences were exercised, including colored and transparent destinations, exact
zero versus partial core/active-Toon/custom factor alpha, clamping at evaluation,
front-face rejection, clipping, depth equality, retained base occlusion and
partial-edge depth writes. Sequence depth was also copied back to an application
render target and sampled numerically.

GPU checks additionally cover perspective/orthographic signed/default/zero scales
in active sub-viewports, exact displacement in render-target pixels, nonuniform
normal transforms through raster coverage, material group layering, reflected
and singular hardware instances, core skinning with reflected/singular mesh-node
transforms ignored, nonzero core morphs and joint animation. A loaded two-joint,
two-influence-set asset proves raw `.25/.75` weights survive GLTFLoader's
base-material normalization. Owned float palettes avoid shared-geometry attribute
mutation and have explicit disposal. Loader/browser checks cover active Toon and
core PBR coexistence, correct instance/group metadata, custom alpha integration,
disposal and renderer-hook/state restoration.

The complete built example was checked for both loaders, outline off/on,
Toon/PBR/Toon switching, synchronized orbit/zoom, front/side/back presets, mobile
layout, source/notice hashes and a clear missing-image failure. Normal runs had
no asset/network/shader/runtime/console errors. The three new browser captures
were opened and reviewed; [findings and remaining sampling/appearance differences](comparison.md#outline-pipeline-issue-21)
are recorded separately, preserving historical no-outline captures.

Generic Gene GLB: 4,768,156 bytes; SHA-256
`8f859b023dec5f2ba9c6d54cfc57233e9d626a3a16edbc4b0fe15bb4cb2e5dc1`.
Attributed demo GLB: 4,771,032 bytes; SHA-256
`607bc699f22279cecd0b52a3a4e6ba93abca2ce7faac1098d6be2c8d99598569`.
Both extensions are optional, geometry remains shared and unexpanded, and original
source bytes/notices remain unchanged. The converter still exports a static pose.
The [integration guide](pipeline.md#outline-plugin-and-effect) documents numeric
limits, full-scene rendering, factor updates, MSAA resolved-depth boundaries and
lifecycle. Native WebGPU has the same graph but no real-adapter validation here.

Initial development runs exposed lost callback metadata during loader cloning,
sub-viewport/scissor state, first-use depth initialization and test-harness path/
fixture issues. Those were corrected before the passing runs above. npm's two
existing audit findings (one low, one high) and the bundle-size warning were not
changed. The draft itself and the existing Toon numerical expectations are intact.

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
   Toggle Outlines off/on and verify that both panes change and return, with the
   two different algorithms labeled (Issue #21).
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
