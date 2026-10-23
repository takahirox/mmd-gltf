# Validation record

## Issue #29: VMD bone motion

Validated in this worktree on 2026-10-24, Node `24.12.0`, pinned lockfile,
Three.js `0.186.1`, Playwright `1.56.1` Chromium installed with
`npx playwright install chromium`. Browser checks force WebGL2/SwiftShader using
the documented Chromium channel. No model/provider/allowance changes were made.
The BDEF weight interoperability policy (`1e-6`) is unchanged.
Historical sections below report earlier bounded increments; their former VMD
limitations are superseded only by this bone-motion increment.

| Check | Actual result |
| --- | --- |
| `npm run build` | Passed; generates both motions × both rigs as GLB/unpacked glTF, builds Demo and conformance pages; existing bundle-size notice remains |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 26 unit/integration tests, existing Toon/Outline corpora unchanged |
| Targeted built VMD browser suite | Passed: 2 tests; 144 oracle raster comparisons plus actual Demo lifecycle |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | Passed: 10 tests, 2 existing optional native-WebGPU skips (no adapter); 144 VMD and 240 VPD oracle comparisons passed; final run 3.3 minutes |
| `npm run check:links` | Passed: 178 local links/anchors and built example assets |
| `git diff --check` | Passed on the complete change before commit |

The first unpacked-reload unit run exposed Node's missing browser `ProgressEvent`;
the test harness now supplies it. The subsequent targeted and full unit runs
passed. A newly added Japanese-name test initially assumed traversal order equaled
source-index order; it now selects the retained source index explicitly and passes.
An intermediate links check correctly reported the not-yet-written
Issue #29 heading; final links are checked after writing this record. No acceptance
threshold was loosened to address a failure. The only existing assertion changed
is the Demo's intentional support/omission wording.

### Original fixtures and measured numerical results

Two original attributed byte motions, both authored in this repository by mmd-gltf
contributors, run on both existing distinct box and wedge rigs. Provenance, source
generator and independent oracle are recorded in the
[fixture guide](../tests/fixtures/README.md#issue-29-vmd-fixtures). SHA-256:

- A: `9397bb1edcfd6f66fec0ac626649fd105277e57c93415722f4c8963a6745f54a`
- B: `d4fd5b6b63c708eba7ac3579b033cf18981d5784aefbbfc139597605c958039a`

The oracle uses scalar polynomial Newton inversion, axis-angle rotations,
hierarchical point/vector transforms, scalar BDEF sums and inverse-transpose
normals. It does not use the production evaluator, emitted fallback samples or
joint matrices as expected values. Declared tolerances **before measurement**:
exact skinned positions `2e-6 m`, exact orientation `1e-7 rad`; fallback local
translation `1e-5 m`, orientation `1e-4 rad`. Orientation distance is
`2*acos(abs(normalizedQuaternionDot))`, making quaternion signs equivalent.

Exact paths: direct VMD bytes on the rest GLB, retained-curve converted GLB and
retained-curve unpacked glTF. Both conversion formats have zero core-validator
errors in all four cases, deterministic API/CLI binary bytes, retained original
inverse binds and optional curve/material declarations. Ordinary GLTFLoader
without the VMD plugin supplies the measured core fallback. The local fallback
measurements include all source keys and a uniform **1201-point grid**, including
endpoints (1200 subdivisions of last bound frame/30). These are observed finite-grid
maxima, **not a continuous error proof**.

| Rig / motion | Max exact skin position (m) | Max exact orientation (rad) | Max fallback local translation (m) | Max fallback orientation (rad) |
| --- | --- | --- | --- | --- |
| Box / A | `2.5854903440425403e-8` | `4.2146848510894035e-8` | `1.983120726512261e-6` | `1.9860514499681696e-5` |
| Box / B | `1.1737594451943778e-8` | `4.2146848510894035e-8` | `1.9806652804417342e-6` | `1.9860872262989417e-5` |
| Wedge / A | `9.245415710790184e-9` | `4.2146848510894035e-8` | `1.9863436845804975e-6` | `1.9860514499681696e-5` |
| Wedge / B | `8.823775377031495e-9` | `4.2146848510894035e-8` | `1.932682671959578e-6` | `1.9860872262989417e-5` |

### Built browser coverage

The [VMD conformance entry](../examples/vmd-conformance.html) exercises
2 motions × 2 rigs × 2 materials × 3 load paths × 3 fractional-time states ×
2 passes = **144 comparisons**. Initial/reseek time is `0.371 s`, intermediate
seek `0.719 s`. Passes are surface and outline. The independent baked mesh uses
scalar normals for both ordinary blended skin normals and outline inverse
transpose normals. Existing raster limits remain: two encoded levels, at most
128 mismatched pixels out of 160×160, nonempty foreground at least 100 pixels.
Observed: maximum position error `2.31930292193816e-8 m`, maximum orientation
error `2.9802322387695312e-8 rad`, **zero oracle pixel mismatches** across all 144.
Reseeking after another time renders identically. Playwright attaches the complete
per-case JSON as `vmd-conformance.json`.

The actual built `rig.html` test exercises both motions on both rigs from bytes,
GLB and glTF, compares source-independent fractional seeks, checks Toon/PBR and
outline image changes, pause stability, seek order independence, play/loop/reset,
VPD ownership handoff, motion switching, malformed local bytes with unchanged
pose, missing explicit-map failure, successful recovery and disposal counts.
The existing VPD 240-comparison conformance and BDEF/Toon/Outline suites remain
mandatory regression checks. Native WebGPU results are separately reported by
the full suite; no native GPU or original-MMD measurement is inferred from
WebGL2 synthetic passes.

### Reader, semantics, limits and evidence categories

Unit cases cover all six VMD sections and retained raw fields; every truncation
point in fixture A, permitted complete-section EOF, hostile counts and IK counts,
nonfinite executed/unexecuted fields, malformed/versioned headers, invalid curves
and quaternions; Japanese bytes, full 15-byte names, truncated-name collisions,
undecodable fields, duplicate PMX names, invalid/repeated mappings and explicit
unmatched policy; sorting, nonzero first frames, single-key clamping, adjacent
intervals, sign-equivalent quaternions, nonidentity original rest, overflow,
instance isolation, history independence, ownership, loop/stop/disposal;
structural/semantic extension fixtures and FLOAT/sample/accuracy guards.

This is **synthetic conformance** for the documented continuous-curve project
profile. Identified alternative-renderer evidence is the historical official
Three.js implementation; it is not measured original-MMD acceptance. Original-MMD
captures of adjacent intervals/endpoints, lawful representative production assets
and native WebGPU motion measurements remain unperformed optional validation.
Non-bone VMD execution, advanced skinning, morph deformation, append/IK/deformation
ordering, physics and representative-model fidelity remain mandatory overall
project work. Existing VPD support remains functional. No new specification
reconciliation was needed; the earlier skin-weight SHOULD correction remains in
force. There is no required post-merge verification for Issue #29.

## Issue #27: solver-free VPD bone offsets

Local pre-merge validation on 2026-10-24 used Node.js **24.12.0**, npm **11.6.2**,
Darwin ARM64, the existing lockfile, Three.js **0.186.1**, glTF Transform **4.5.1**,
and Playwright **1.56.1** Chromium/SwiftShader with forced WebGL2. Setup used
`npm ci` and `npx playwright install chromium`. No dependencies or acceptance
thresholds were changed. No push, PR, comment, merge or deployment was performed.

| Required check | Actual result |
| --- | --- |
| `npm ci` | Passed; the same two existing audit findings (one low, one high) |
| `npm run build` | Passed, including verified Gene acquisition and both rigs/poses/posed reload assets; existing bundle-size warning |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 20 unit/integration tests, plus existing Toon and Outline CPU/schema/asset suites |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | Passed: 8 passed; 2 existing optional native-WebGPU cases skipped (no adapter); 240 VPD comparisons passed |
| `npm run check:links` | Passed: 147 local links/anchors and built example assets |
| `git diff --check` | Passed |

### Contract and matrix

The [documented input profile and runtime contract](pipeline.md#vpd-bone-offsets)
use core joint transforms and versioned application extras, with original inverse
binds. The [committed bytes and provenance](../tests/fixtures/README.md#issue-27-vpd-fixtures)
include Shift_JIS/CRLF Pose A, UTF-8/LF Pose B, an unchanged box PMX and a sheared
wedge PMX with different leaf position and parentage. Both rigs are solver-free;
they are original synthetic works, not representative production models.

Tolerances were chosen before recording measurements: absolute **`2e-6` meters**
for loaded/skinned positions, **`1e-12`** for local quaternion components and rotated
basis vectors (double precision/JSON, short quarter-turn chains), and **two encoded
RGB levels** with at most **128/25,600** boundary pixels for independent FLOAT
raster rounding (the existing 0.5% allowance). Parser quaternion normalization
permits absolute length error **`1e-5`**, accommodating six-decimal exports.
These distinct tolerances do not relax skin-weight acceptance or the existing
raw-weight/normal conventions.

| Rig / pose | Scale m/unit | GLB + unpacked glTF core-validator errors | API/CLI determinism, runtime agreement, reload and original-rest reset | Built surface/outline comparisons | Maximum position error (m) | Maximum oracle pixel mismatches |
| --- | --- | --- | --- | --- | --- | --- |
| Box / A | 0.2 | 0 / 0 | Passed | 60 passed | `1.490116130486996e-8` | 0 |
| Box / B | 0.2 | 0 / 0 | Passed | 60 passed | `9.46223749354047e-9` | 0 |
| Wedge / A | 0.125 | 0 / 0 | Passed | 60 passed | `8.568167730871323e-9` | 0 |
| Wedge / B | 0.125 | 0 / 0 | Passed | 60 passed | `8.381903171539307e-9` | 0 |

[Unit tests](../tests/vpd.test.ts) cover actual byte decoding, exact Japanese and
punctuated names, BOM/combining characters, comments/newlines, reordered records,
counts, truncation, nonfinite numbers, zero/materially invalid quaternions and
roundoff normalization. Binding tests cover duplicate source names, explicit
record-ordinal mappings, bad mapping keys/indices/types, repeated target
assignments, unmatched diagnostics and explicit partial policy. Wrong-model and
second-instance application fail unchanged. Reapplication, A→B→A, omitted bones,
dirty translation/rotation/scale replacement and original-rest reset are checked.
Overflow fails before any mutation. Missing/inconsistent metadata and inverse
binds are rejected. An independent nonidentity rest-rotation case checks the
order `qRest * qOffset`. Converter bytes and original inverse binds remain
unchanged by runtime application; CLI output matches API output deterministically.
Both converter formats pass the existing core validator; unknown optional draft
notices remain expected.

The built [VPD raster tool](../examples/vpd-conformance.html), driven by
[Playwright](../tests/browser/vpd.spec.ts), checks **240** comparisons:
2 rigs × 2 poses × 2 material paths (active Toon/core PBR) × 5 sources
(runtime apply, converter GLB, converter unpacked glTF, runtime GLTFExporter GLB,
runtime GLTFExporter embedded-resource glTF) × 3 states (posed/reset/reapply) ×
2 passes (surface/outline). The [oracle](../tests/vpd-oracle.ts) uses explicit
scalar quarter turns, authored hierarchy/offsets and influence patterns; expected
positions are not computed from production pose code, skin attributes, inverse
binds or emitted joint matrices. Surface normals retain the existing Three.js
weighted-transform convention; outline normals independently use inverse
transpose. Every render must contain nonempty geometry. Reapplication must
exactly reproduce the first posed image after reset; movement from rest must be
visible. Runtime export additionally checks retained draft extensions and
attribution. The full per-comparison record is attached by Playwright as
`vpd-conformance.json` in ignored test output; this table is the committed summary.

The built Demo tests load both rigs and both samples, compare repeated/switch/reset
transforms and screenshots, upload real local Shift_JIS and UTF-8 bytes, exercise
malformed encoding and ambiguous bindings without changing the pose, recover
with explicit mapping, and verify Toon/PBR and outline controls. Apply reports
busy status and disables overlapping operations. Gene Light and the 12 existing
BDEF raster regressions remain part of the same required browser run. Existing
43 Toon vectors and 109 Outline checks remain unchanged. The VPD measurement page
is intentionally built so these numerical/raster checks run against preview;
older development-only conformance entries remain excluded.

Initial development runs caught a brace-containing name accepted by the parser,
an oracle parent error for unused bones, stale success status during asynchronous
local file loading, and an export assertion looking for Group attribution on the
outer scene. Git attributes preserve the Shift_JIS/CRLF byte fixture (otherwise
Git whitespace checking treats each intentional CR as trailing whitespace). These
were corrected; final results above supersede those runs.

### Weight requirement correction retained

**Old assumption:** glTF mandates normalized FLOAT weight sums. **Corrected
requirement:** [glTF §3.7.3.3](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skinned-mesh-attributes)
uses SHOULD for FLOAT sums near one; integer-normalized sums have separate MUST
requirements. The converter's existing `1e-6` rejection and roundoff normalization
policy remains an interoperability choice, including compatibility with pinned
Three.js GLTFLoader's call to `SkinnedMesh.normalizeSkinWeights`. No weight acceptance is relaxed.
This corrects the attribution in the pipeline and earlier validation discussion,
retaining the old assumption, primary source and rationale. No external Issue/PR
edit was made because this node prohibits comments/PR operations; downstream
integration can carry this record into its normal PR.

### Evidence limits and remaining overall goal

| Evidence category | Status |
| --- | --- |
| Synthetic solver-free VPD conformance | Present; results recorded per case above |
| Existing BDEF, Toon, Outline and Gene regressions | Present; included in required checks above |
| Optional native WebGPU | Two existing optional cases skipped because no adapter was available; VPD native WebGPU unperformed |
| Historical r169 Three.js helper comparison | Unperformed (optional); source inspected only |
| Original MikuMikuDance VPD execution/measurements | Unperformed; no lawful runnable original-MMD reference available in this runner |
| Representative production-model VPD fidelity | Unperformed; synthetic passes do not establish it |
| VMD, full IK/append/deformation ordering, advanced skinning, morphs, physics | Unsupported and mandatory outstanding parts of the overall project goal |

The historical r169 Three.js loader/parser/helper are alternative-implementation
evidence for the bounded contract, not a normative VPD specification or a measured
original-renderer oracle. Raw bone-offset application is not full MMD pose
reproduction and does not complete the overall reproduction matrix. No post-merge
verification is required by Issue #27.

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
§3.7.3.3 recommends FLOAT sums near one with SHOULD, not MUST (the previous
wording incorrectly claimed a mandate). The unchanged `1e-6` rejection and
roundoff-normalization policy is a converter interoperability requirement,
including Three.js loader normalization. No weight acceptance is relaxed;
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

## Issue #31 vertex morphs and combined motion

Validation is local Coordinator execution on the pinned lockfile and Node
`v24.12.0`, using Playwright `1.56.1`, its pinned Chromium `141.0.7390.37`
(revision 1194), SwiftShader WebGL2 and the README's Chromium setup. No
hosted-CI, original-MMD execution or representative integrated fidelity is claimed.
No new specification correction was established; the earlier glTF FLOAT skin
weight sum SHOULD correction and stricter converter interoperability policy remain.

The committed [morph suite](../tests/morph.test.ts) and
[independent scalar oracle](../tests/morph-oracle.ts) compare both distinct rigs
and both combined motions across direct bytes, retained GLB, unpacked glTF and
ordinary GLTFLoader. Measurements include keys and the existing 1201-point grid.
Combined exports request bone fallback probes `2e-8 m`/`2e-7 rad`; existing bone-only
probe defaults and regression tolerances are unchanged. No production evaluator
or emitted sample supplies expected weights or positions.

| Rig | Motion | Maximum weight error | Maximum skinned position error (m) | Maximum orientation error, including fallback (rad) |
| --- | --- | ---: | ---: | ---: |
| Box | A | 4.76837159e-8 | 1.09843715e-7 | 2.19001449e-7 |
| Box | B | 8.10515139e-8 | 1.17469766e-7 | 2.08616257e-7 |
| Wedge | A | 4.76837159e-8 | 5.57003865e-8 | 2.34663721e-7 |
| Wedge | B | 8.10515139e-8 | 1.05532220e-7 | 2.08616257e-7 |

All are within the predeclared `1e-6` weight / `2e-6 m` position limits; exact bone
orientation separately retains `1e-7 rad`, fallback orientation `1e-4 rad`.
GLB/unpacked core validator results are zero errors for every combined case and
morph-only coverage. API/CLI and repeated conversions are byte deterministic.
Static/BDEF target ordering, reflection/scaling, zero defaults, exact identity,
unsupported families, malformed records/numeric limits, linear scalar endpoint
policies, switching, failure atomicity, VPD preservation, bounds and disposal have
executable checks. The original fixtures and bone checks are retained, including
explicit ignored/unmatched morph diagnostics.

The built `vmd-conformance.html?morph` performs 144 independent baked raster
comparisons through Toon/PBR and surfaces/Outline across both rigs/motions and
byte/GLB/glTF paths. Measured maxima: weight `8.03838674e-8`, position
`2.59389674e-8 m`, **zero** pixels exceeding two encoded levels (limit 128 of
160×160). Existing bone-only raster checks also measured zero mismatches. These
are finite synthetic comparisons; endpoints/interpolation are documented project
policies, not measured original-MMD execution. Unsupported morph families,
advanced skinning, solvers/order, physics, scene animation and representative
fidelity remain overall project work. VPD remains supported.

During implementation, one exploratory converter run lacked prepared assets and
material-only triangle subsets still referenced the original full-model morphs;
setup and subset fixtures were corrected. The first Demo browser run found stale
morph maps on legacy motions and horizontal control overflow; both were fixed.
A subsequent Demo run exposed reselection of the same local VMD without a change
event; sample changes now clear stale file selection. The first full browser run
measured Gene bounds using its conservative morph envelope; camera framing and
reported bounds now use current deformed vertices, preserving the existing
regression assertions. A link check initially failed before this section existed.
Final mandatory command results are recorded below.


| Command | Actual result |
| --- | --- |
| `npm ci` | Passed using the unchanged pinned lockfile. |
| `npm run build` | Passed; existing Vite large-chunk advisory remains. |
| `npm run typecheck` | Passed. |
| `npm test` | 33 passed, zero failures or skips; Toon/Outline fixture scripts also passed. |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | 12 passed, zero failures; two optional native WebGPU cases skipped because no adapter was available (5.9 minutes). |
| `npm run check:links` | Passed, 191 local documentation/anchor/built-asset links. |
| `git diff --check` | Passed. |

No required post-merge verification for Issue #31. Optional controlled original-MMD
measurements and alternative-implementation comparison were not performed.

### PR #32 review revision

The Issue #31 review fixes restrict extension weight writes to primitives of the
referenced glTF node, resolve mesh-rooted morph handles to the instance's bone
motion owner, and validate every weight vector position before releasing ownership
or mutating state. Two added regression tests cover nested unanimated nodes with
and without targets, shared mesh definitions, one/two material primitives, both
rigs, instance isolation, mesh-rooted apply/reset, and fully/partly sparse vectors.
The nested assets have zero core-validator errors and preserve the same child
weights as ordinary GLTFLoader. Sparse-vector failures preserve bones, weights,
playback time and the active owner. The initial regression run reproduced the
nested-node and sparse-vector failures; both tests pass after the fixes.

Local revision checks use Node `v24.12.0` and `npm ci` with the unchanged pinned
lockfile. The measured morph numerical maxima above are unchanged; all 144 morph
raster comparisons again had zero pixel mismatches. No hosted-CI or original-MMD
evidence is inferred from this run.

| Command | Revision result |
| --- | --- |
| `npm run build` | Passed; existing Vite large-chunk advisory remains. |
| `npm run typecheck` | Passed. |
| `npm test` | 35 passed, zero failures or skips; Toon/Outline fixture scripts passed. |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | 12 passed, zero failures; two optional native WebGPU skips (no adapter), 5.6 minutes. |
| `npm run check:links` | Passed, 191 links. |
| `git diff --check` | Passed. |

## Issue #33: mixed SDEF conversion and playback

Local measurements on 2026-10-24 use the pinned lockfile (`npm ci`), Node
24.12.0, Three.js 0.186.1, mmd-parser 1.1.4, glTF Transform 4.5.1 and Playwright
1.56.1 Chromium/SwiftShader. The [SDEF draft](../extensions/MMD_skinning_sdef/README.md),
[runtime/export contract](pipeline.md#mixed-sdef-conversion-and-runtime),
[fixture provenance](../tests/fixtures/README.md#issue-33-mixed-sdef-variants) and
[machine-readable measurements](sdef-validation.json) describe the same cases.
These are local results, not claims about completed hosted CI or original MMD.

| Measurement | Observed maximum | Required limit |
| --- | ---: | ---: |
| CPU position component error | 2.729001513518403e-7 m | 2e-6 m |
| GPU position component error (RGBA32F readback) | 7.996936788362552e-5 m | 1e-4 m |
| GPU normalized normal component error | 1.3919622870173232e-4 | 5e-4 |
| Independently baked raster mismatches in 160×160 | 5 pixels across 176 comparisons | 128 pixels, two encoded levels |
| Ordinary-loader BDEF2 difference from SDEF | 0.32842715404709455 m | Must exceed 0.001 m for the distinguishing case |

The box uses 0.2 m/PMX unit; the geometrically and hierarchically distinct wedge
uses 0.125 m/unit. Both have 24 source vertices, 260 joints, two material primitives,
zero and nonzero centers, ordered asymmetric influence pairs, endpoint weights
and active additive vertex morphs. The standalone one-metre analytical arc also
distinguishes SDEF from BDEF2. Expected positions/normals use independent authored
geometry and scalar VMD/VPD predictions with expanded center correction, not
runtime SDEF evaluators, emitted geometry or live joint matrices.

The CPU sweep covers both combined motions across 121 times over 0..1.5 seconds
plus fractional probes, both VPD poses, bounds, rest/reset/reapply and separate
instances. Binary fixtures directly establish retention of type and C/R0/R1 by
the installed published parser, Z reflection once and metric scaling once.
API/CLI determinism, core validation, ordered endpoint slots, malformed input,
quaternion sign/near-identical cases, rigid nonidentity binds, common scene
placement, shared materials and disposal are tested. All 32 generated SDEF
GLB/unpacked glTF assets and the complete extension example have zero core
validator errors; unknown-extension/unused-accessor notices are expected because
the core validator does not evaluate this draft's semantics.

The browser matrix covers Toon and plugin-enabled PBR plus Outline on both rigs,
both combined VMD motions and both VPD poses, byte application, converter GLB/glTF
and runtime VPD export/reload in both formats. The exporter adapter resolves new
accessors rather than copying source indices. Float readbacks inspect shader
positions and normalized normals; separate rasters inspect actual materials and
Outline. Additional probes force 1,100 joints through bone textures, rigid
nonidentity bind transforms, scene placement and successive pose/rest/pose passes.
The built Demo exercises fractional seeking, morph controls, BDEF2 comparison,
VPD/VMD handoff, resets and invalid local-file recovery.

During development the inherited 180-second budget was insufficient for the new
176-comparison SDEF test; its dedicated budget is now 420 seconds. No numeric or
raster threshold changed. An intermediate full browser run had one existing BDEF
Demo five-second rig-readiness timeout (13 passes, two optional WebGPU skips).
Unnecessary SDEF hierarchy/bounds work was removed from BDEF-only loads; the
isolated existing VMD Demo lifecycle then passed. Initial load-time SDEF bounds
also exposed stale sibling joint worlds, fixed by refreshing the complete SDEF
hierarchy before computing bounds.

Original-MMD SDEF positions, normal-sensitive rendering and representative model
fidelity remain unmeasured. Native WebGPU SDEF execution was not measured here;
the two existing optional native-WebGPU browser cases skip without an adapter.
Rigid joint transforms are supported; joint scale/shear/reflection is diagnosed.
QDEF/PMX 2.1, IK/append ordering, physics, other morph families, scene animation
and representative original-MMD fidelity remain overall work. Core FLOAT
normalization remains SHOULD, with a documented stricter converter policy.
No post-merge verification is required.

Initial local gate results before the review fixes below:

| Command | Completed result |
| --- | --- |
| `npm run build` | Pass; deterministic fixture generation and production Vite build. Existing chunk-size advisory remains. |
| `npm run typecheck` | Pass. |
| `npm test` | 44 passed, zero failures/skips; includes all nine new SDEF tests and the existing extension suites. |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | 14 passed, two optional native-WebGPU skips, zero failures; full fresh rerun completed in 11.2 minutes. |
| `npm run check:links` | Pass; 216 local documentation/asset links and anchors. |
| `git diff --check` and `git diff --cached --check` | Pass after final staging. |

The final full browser run includes the existing Gene, BDEF, VMD, VPD, morph,
Toon and Outline checks, plus the two new SDEF checks. The earlier readiness
failure did not recur. Existing VMD/morph/VPD raster comparisons still report
zero mismatches; SDEF uses the unchanged two-level/128-pixel acceptance budget.

### Issue #33 review fixes: duplicate joints and interleaved selectors

The earlier draft assumed duplicate SDEF joints could retain two nonzero weights.
[Core glTF skinned mesh attributes](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skinned-mesh-attributes)
forbid multiple nonzero weights for one joint at a vertex. The corrected draft
retains both ordered indices but permits only one active weight for duplicate
pairs. The converter writes [1, 0] for these pairs: identical palettes reduce SDEF
to a single rigid transform for any original weight and C/R0/R1, preserving
deformation and core fallback. Distinct pairs keep their ordered weights.

Regression coverage uses both rig families, zero/nonzero centers, weights 0,
0.25 and 1, and joints 2 and 259. Every resulting GLB and unpacked glTF has zero
core-validator errors. Plugin and ordinary-loader queries agree with independent
90-degree rotation/translation calculations within the existing 2e-6 m limit.

The shared accessor decoder now distinguishes data from mesh indices explicitly.
An UNSIGNED_BYTE SCALAR selector with byteStride 4 and byteOffset 1 passes core
validation and loads with correct selection and arc deformation. Mesh indices
with byteStride remain rejected; the existing sparse validation remains covered.

The full Node suite passes 47 tests with zero failures/skips, including the three
new regressions. The 176-comparison SDEF GPU matrix reproduces the maxima above:
7.996936788362552e-5 m position error, 1.3919622870173232e-4 normal component error
and five raster mismatches. Build, typecheck, 216 local links and whitespace
checks pass. The complete Chromium browser rerun passes 14 tests in 11.1 minutes
with zero failures and two optional native-WebGPU skips (no adapter), including
the SDEF Demo and all existing Gene/BDEF/VMD/VPD/morph/Toon/Outline coverage.
These remain local synthetic measurements.
