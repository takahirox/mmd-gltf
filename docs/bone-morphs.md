# Bone and mixed morph implementation record (Issue #47)

Evaluation baseline: `631a5946744180e15d3704d43244656d1d9c0ded`. Worktree input:
`22751b83c9790d275ce2f99dd8d75bf87ad0a592`. All changes remain within Issue #47;
VMD animation and VPD pose reproduction remain part of the overall goal.

## Representation correction and retained conventions

Old assumption: executable PMX morph identity equals a geometry POSITION target.
This remains valid for the retained v1/v2 vertex profile. Corrected requirement:
scalar identity must be independent of target identity for bone and mixed groups.
The [PMX author document mirror](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
(section モーフ, bone translation/quaternion offsets and group contribution rates)
and [core glTF morph/skin/animation specification](https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc)
show why vertex targets cannot encode runtime bone inputs. The optional
[MMD_morphs contract](../extensions/MMD_morphs/README.md) fills only that gap; core
vertex deltas and resolved joint fallback remain in core glTF. Bone-only motion
needs no dummy target. No acceptance requirement was weakened to fit failures.

Quaternion weighting, reduction and ordered postmultiplication are documented
project policies. [Three.js r186](https://raw.githubusercontent.com/mrdoob/three.js/r186/src/math/Quaternion.js)
supports implementing quaternion products/interpolation, not original-MMD semantics.
Existing append source/contribution composition remains unchanged. Analytical
fixtures distinguish noncommuting X/Y order, duplicate reduction, direct controls,
compiled-group double application and immutable raw baselines. They do not prove
original-MMD fidelity. No original-MMD measurements were performed in this run.

Both pinned parsers already reflect translation Z and quaternion X/Y. The converter
scales translation once and normalizes near-unit rotation offsets once. The old
optional-record fixture used an all-zero bone quaternion when that family was
unexecuted. Its authored bytes now contain identity rotation so the original text,
encoding, optional-section and reference tests continue to exercise valid data.
Separate invalid-quaternion tests require rejection.

## Reusable APIs and Demo

For v3 controls and applied-state reloads, register `MMDMorphPlugin` so the
independent control snapshot and raw baseline are retained, including for converter
assets and standalone contracts. `MMDVMDPlugin` also loads it idempotently for
retained playback. Legacy v1/v2 extras retain their previous loading behavior. `createMorphRig`, `getMorphModel`,
`getMorphWeights`, `applyMorphWeights` and `resetMorphWeights` use independent control
slots for v3; legacy vectors retain their original layout. Use `controlIndex` to
build controls rather than indexing by `target`. Loading preserves core snapshots.
Use `MMDMorphExporterPlugin` together with existing pose/advanced-skinning/physics
exporters to retain executable metadata, control weights, raw baseline and rest.

The built Demo offers bone/mixed box and wedge rigs, both motions from bytes,
GLB/glTF, manual independent controls and both existing VPD poses. Advanced SDEF
and QDEF presets use the same morph pipeline, surfaces and Outline.

## Validation evidence

Implementation and executable checks: `34e7db66f3b100c730d48fbe09a66c4434496b22`.
The only subsequent runtime change, `b7076d9dfd3c3e005f6b9bf1cbc653e329eb46d9`,
restores model-specific legacy capability status text. Bone evaluation, rendered
outputs, thresholds and timeouts are unchanged. The final evidence update changes
only reports and documentation.

`npm ci`, `npm run build` (before generated-asset-dependent checks),
`npm run typecheck`, `npm test`, `npx playwright install chromium`,
`npm run check:links` and `git diff --check` passed. Node: **118 passed, zero
failures/skips** on the corrected revision as well. The complete Chromium run
on `34e7db6` finished with **67 passed, two optional native-WebGPU skips, and one
legacy VPD status-text assertion failure**. The label correction preserves the
existing test assertion; all **eight affected/new-feature and VPD browser tests
passed** on `b7076d9`. A second complete 56-minute browser run was not repeated
for this isolated text correction. The [browser report](bone-morph-browser-validation.json)
keeps these executions distinct. Exact commands are recorded in the
[command/result record](bone-morph-checks.json), including its tested revision,
optional skips, superseded failures and interrupted runs.

The [Node report](bone-morph-node-validation.json) records all modes and parser
paths, 36 generated GLB/external glTF validations, 12 additional CLI conversions,
raw-input physics tick checks, palette/bounds checks and independently authored
noncommuting predictions. Ordinary-loader fallback at keys and 241/242 probes
per rig/motion stayed within 6.57e-7 m vertex error and 9.97e-7 rad joint rotation
error, using explicit 1e-7 m / 1e-6 rad sampling tolerances. This is finite-probe
evidence, not a continuous error bound.

The [raster/export report](bone-morph-raster-validation.json) covers 240
BDEF Toon/PBR surface/Outline comparisons across both rigs/motions, bytes/GLB/glTF
and both VPD handoffs, plus 40 applied-state GLB/glTF export checks. CPU error is
at most 3.30e-8 m; actual BDEF GPU position and normal-component errors are at most
8.37e-8 m / 1.29e-7. Every raster comparison has **zero** pixels differing by
more than two byte levels (limit 128). Exports validate against core glTF and the
custom schema, reload without applying offsets again, and support repeated
manual/VPD/VMD operations.

The [advanced GPU report](bone-morph-gpu-validation.json) adds eight mixed
SDEF/QDEF rig/motion cases. Actual GPU position error is at most 3.13e-5 m and
normal-component error at most 7.83e-5, below the unchanged 1e-4 m / 5e-4 gates;
CPU queries retain the 2e-6 m gate.
The [retained physics report](bone-morph-physics-retained-validation.json),
reproducible with `npx tsx tools/verify-bone-physics.ts`, checks bone-only v5 motion
with the pre/post-physics v2 solver on both rigs through direct bytes, GLB and
external glTF. Positions agree exactly at initialization and fractional tick
probes. This is backend cross-transport consistency, distinct from the independent
raw-input numerical predictions and from original-MMD evidence. Existing stricter tests and timeouts remain
unchanged.

The [Demo report](bone-morph-demo-validation.json) records four built-Demo cases
and hashes/dimensions/nonempty checks for all 24 saved PNGs. These cases require
matching state/render revisions, numerical CPU queries,
exact restoration, loop/endpoints, both VPD handoffs, invalid-file recovery,
manual controls, instance replacement and player disposal. Nonempty intrinsic
captures and display evidence are retained in [bone-canvas](bone-canvas/):
[box motion](bone-canvas/built-bone-Demo-bone-box-bone-a-bytes-glb-gltf-fractional-bone-intrinsic.png),
[box display](bone-canvas/built-bone-Demo-bone-box-bone-a-bytes-glb-gltf-fractional-bone-display.png),
[wedge VPD](bone-canvas/built-bone-Demo-bone-wedge-bone-b-bytes-glb-gltf-VPD-b-intrinsic.png)
and [wedge display](bone-canvas/built-bone-Demo-bone-wedge-bone-b-bytes-glb-gltf-VPD-b-display.png).
Tests belong to the Coordinator; no separate evaluation rerun or AI re-review is
required. Repository tests, analytical predictions, pinned physics-backend results
and alternative-renderer GPU/raster output are distinct forms of evidence. Neither
alternative-renderer output nor self-consistency establishes original-MMD parity.
