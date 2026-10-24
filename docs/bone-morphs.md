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
original-MMD fidelity. Original-MMD measurements were not available or performed.

Both pinned parsers already reflect translation Z and quaternion X/Y. The converter
scales translation once and normalizes near-unit rotation offsets once. The old
optional-record fixture used an all-zero bone quaternion when that family was
unexecuted. Its authored bytes now contain identity rotation so the original text,
encoding, optional-section and reference tests continue to exercise valid data.
Separate invalid-quaternion tests require rejection.

## Reusable APIs and Demo

Register `MMDMorphPlugin` to load standalone contracts; `MMDVMDPlugin` also loads it
idempotently for retained playback. `createMorphRig`, `getMorphModel`,
`getMorphWeights`, `applyMorphWeights` and `resetMorphWeights` use independent control
slots for v3; legacy vectors retain their original layout. Use `controlIndex` to
build controls rather than indexing by `target`. Loading preserves core snapshots.
Use `MMDMorphExporterPlugin` together with existing pose/advanced-skinning/physics
exporters to retain executable metadata, control weights, raw baseline and rest.

The built Demo offers bone/mixed box and wedge rigs, both motions from bytes,
GLB/glTF, manual independent controls and both existing VPD poses. Advanced SDEF
and QDEF presets use the same morph pipeline, surfaces and Outline.

## Validation evidence

Results and exact commands are recorded below after implementation-stage checks.
Tests belong to the Coordinator; no separate evaluation rerun or AI re-review is
required. Repository tests, analytical predictions, pinned physics-backend results
and alternative-renderer GPU/raster output are distinct forms of evidence. Neither
alternative-renderer output nor self-consistency establishes original-MMD parity.
