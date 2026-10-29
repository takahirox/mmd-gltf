# Source transport and execution capabilities

Issue #58 separates source structure, retained data, runtime support, and optional
core glTF approximation. `MMD_skeleton_solver` 1/2, `MMD_physics` 1 and
`MMD_animation_vmd` 1–5 keep their existing serialized meanings. New transport
versions are solver **3**, physics **2**, and VMD **6**. The importer still emits
older solver/physics versions when their complete contract applies; it upgrades
when broader transport is necessary. Parsed VMD now emits version 6.

## Retention and diagnostics

Conversion returns `diagnostics` as well as `warnings`; asset extras retain the
same diagnostics. Animation extras and version-6 payloads also contain their own
fallback/binding diagnostics. Each diagnostic has `category`, `code`, `path`,
and `message`. Runtime failures expose the same record as
`MMDDiagnosticError.diagnostic`:

| Category | Meaning |
| --- | --- |
| `malformed-data` | Invalid references/cycles, record layout, declared counts, numeric values or extension structure; conversion fails. |
| `unsupported-capability` | Valid retained data with unavailable execution or unresolved/ambiguous binding; loading/transport succeeds. |
| `fallback-limit` | Approximate core output cannot meet sampling, quality or FLOAT requirements; retained motion remains independent. |
| `resource-exhaustion` | Parser/executor allocation or work budget; runtime fails before committing model/native state. Conversion retains source when only optional execution/fallback exhausts its budget. |

`solverDiagnostics(profile, budget)` and
`physicsDiagnostics(profile, solver, budget)` assess execution after structural
validation. Loading extensions retains data without starting simulation. Explicit
playback of an unsupported solver/physics profile fails with a diagnostic before
committing transforms; it does not silently simulate a reduced feature set.

Every parsed PMX is preserved byte-for-byte as base64 in asset
`extras.mmdSource = {version:1, format:'pmx', encoding:'base64', data}`.
For the parsed-object API, `format:'pmx-records'` instead retains the bone, morph,
body, joint and soft-body source tables, with their coordinate-system declaration.
This retention path also applies to static/solver-free/physics-free conversions
and features not represented in a dedicated executable extension. Parser-created
`model.source` is non-enumerable so source encoding does not change model identity.
If an application modifies a parsed model, the original bytes still describe its
original input; the extension records describe the modified model. Applications
should clear/recreate `source` when authoring a new source asset.

VMD version 6 carries exact original base64 `source` bytes, bound TRS curves,
original weight `morphs`, optional bone-morph `controls`, and diagnostics. Access
original camera/light/shadow/display/IK sections through `VMDPlayer.source`, or
`parseVMD(decodeSource(payload.source))`. Re-convert these bytes to transport an
animation after export/editing; snapshot exporters do not serialize running VMD
players. Source bytes are independent of FLOAT timestamp quantization and sampled
fallback weights. Original VMD section order, names, padding and optional-section
EOF are preserved. The reader accepts both `Vocaloid Motion Data 0002` (20-byte
model name) and `Vocaloid Motion Data file` (10-byte model name).

## Broader solver and physics transport

Solver 3 adds `limits:{lower:[x,y,z],upper:[x,y,z]}` on an IK link, mutually
exclusive with legacy `hinge`. Bounds are radians in reflected original-rest
coordinates: X/Y endpoints negate and exchange; Z is unchanged. Multi-axis and
all-locked triples retain every value, without reducing them to a hinge. The
current CCD executor projects relative rotations through XYZ Euler angles before
and after a link update. This is a tested project policy, not original-MMD parity;
MikuDanceStudio uses more involved decomposition/iteration choices.

Bone `fixedAxis`, `localAxes:{x,z}` and signed `externalParent` retain PMX metadata;
axes reflect Z once. Fixed/local-axis execution is unavailable. External parents
need a host binding; unresolved keys produce `unresolved-external-parent`.
Source array order, signed layer and pre/post flag remain intact. Missing graph
references and parent/append cycles fail structurally. Late parents/appends,
repeated/non-ancestor IK links, nonstandard link order and cross-phase writes can
transport; the present executor reports unsupported ordering rather than guessing.

Solver 3 uses signed PMX count/index ranges rather than 255 iterations/256 links
or a format work cap. `solvePose` has a fifth, optional `{maxBoneUpdates}` argument
(default 20,000,000 estimated updates). Core skin output still uses glTF's actual
unsigned-short joint-index limit. Parser input/record budgets remain enforced.

Physics 2 retains inverted lower/upper joint limits as **free axes**, equality as
locked axes, and increasing pairs as bounded axes. No endpoint sort/clamp occurs
on import/export. Bullet receives free angular-axis sentinels where its setters
would otherwise normalize away the inversion. It accepts the larger signed PMX
identity/count range. Multiple writers and phase dependencies remain in source
order; unsupported scheduling is diagnosed at execution. Joint types 1–5, world-bound endpoints and bounded angular ranges outside
[-pi,pi] transport but do not execute. `retained.impulseMorphs` and
`retained.softBodies` hold currently unexecuted source records, with `vertexCount`/`materialCount`
for validating retained references. `coordinateSystem:"pmx-source"` and
`metersPerPMXUnit` identify their raw PMX record conventions/units: unexecuted
impulse velocity/torque and soft-body margin/configuration are not glTF body
frames and are not silently scaled or reflected; PMX 2.1 parsing
consumes/validates these complete sections, including anchors and pin references.

Finite nonnegative body mass (including zero for dynamic modes) and positive
dimensions transport in version 2 even when reciprocal mass, FLOAT
overflow/underflow or computed inertia exceeds the backend's range. Scaled body
dimensions/translations, joint frames/limits/springs and other numeric fields
retain finite JSON values beyond FLOAT range. `physics-numeric-range` reports
unavailable execution; version 1 retains its stricter numeric contract.

`PhysicsTimeline`'s fourth argument configures `maxBodies`, `maxJoints`,
`maxSeekSteps`, `maxUpdateSteps`, `maxPoseScalars`, and `maxBoneUpdates`. Defaults
remain 1024/4096, 3600 replay ticks, 240 update ticks, 1,000,000 pose units and
20,000,000 estimated bone updates. These are implementation budgets, not MMD
format restrictions. Replay streams samples into a candidate world and only
commits on success. Long seek/settle fallback inability is reported separately
from retained source validity. No hidden time clamp or skipped simulation ticks.

## Approximation and binding

Core TRS fallback first attempts finite adaptive probes (2e-6 m, 2e-5 rad;
200,000 samples). A failed quality, sample-budget or FLOAT seam check yields a
bounded uniform approximation and `fallback-limit`, with exact VMD preserved.
Core weight samples may similarly be reduced; version 6 uses retained weight
curves for exact evaluation. Unsupported solver/physics fallback uses raw
bone/morph motion and explicitly reports missing execution. Safety limits and
malformed options still fail; no tolerance or FLOAT failure relabels the source
as invalid. A minimum sample per output channel can exceed a requested sampling
budget smaller than the channel count; the channel count is bounded by the
transport's joint/morph limits and this relaxation is always diagnosed.
If valid solver inputs produce transforms outside finite FLOAT range,
`solver-numeric-range` reports an execution capability failure. Conversion retains
the exact PMX/VMD data and emits a reduced core approximation with
`unexecuted-morph-or-solver`; explicit playback still reports the numeric failure.

Version 6 lists exactly the emitted fallback channels in `owned:[{node,path}]`.
The loader removes these tracks and leaves unrelated glTF channels in the
ordinary animation clip. Duplicate/conflicting owned channels fail; owned rest
TRS cannot be driven twice. Versions 1–5 keep their entire-clip ownership rules.

The converter retains unbound tracks by default and reports unresolved/ambiguous
names rather than guessing. Direct binding APIs remain strict unless
`preserveUnbound:true` or explicit ignore/mapping policies are requested.
`retargetVMD(targetRig, sourceBindingOrPlayer, options)` is an opt-in rebind of
original byte-name tracks against the target's original rest and unit scale;
explicit bone/morph/IK mappings resolve ambiguity. It does not infer anatomical
correspondences or copy a source model's resolved transforms. Visibility is
exposed as `player.visibility`; automatic visibility and camera/light/shadow
playback are unimplemented and diagnosed.

## Evidence and comparison fixtures

[Validation record](source-transport-validation.json) lists the completed checks.
[Comparison cases](../tests/fixtures/mmd-comparison.json) record the evidence type
for each expectation. [Source transport tests](../tests/source-transport.test.ts)
exercise preservation, measured executor behavior and negative/resource cases.
The synthetic PMX/VMD inputs are original repository fixtures; no original MMD
binary/output or third-party asset is redistributed.

The MikuDanceStudio source inspected at commit
[`4648314a8379efa7ce2f01ec96beda2eac0c4678`](https://github.com/jstzwj/MikuDanceStudio/commit/4648314a8379efa7ce2f01ec96beda2eac0c4678)
provides reverse-engineering evidence, not proof of fidelity:

| Concern | Evidence in MikuDanceStudio | Current project policy / measured coverage |
| --- | --- | --- |
| Clock/world | [physics_frame.cpp](https://github.com/jstzwj/MikuDanceStudio/blob/4648314a8379efa7ce2f01ec96beda2eac0c4678/src/physics/physics_frame.cpp): shared scene world; catch-up and settle scheduling; `stepSimulation(1/60,10,1/60)` | Separate world per rig, default 1/120 s, explicit steps with hidden Bullet accumulator disabled. Analytical gravity/direct Ammo tests measure this policy only. |
| Pre/post order | Same source runs model pose/morph passes, kinematic synchronization, world stepping, readback and a second pose pass | Explicit pre-solver, sync, step, writeback, post-solver. Cross-phase dependencies not supported by that executor transport with diagnostics. |
| Mode 2 / writeback | Same source retains rotation while collapsing onto the animated bone position, with overstretch/reset behavior | Mode-2 alignment and offset composition tested against independent project calculations; original reset/overstretch and shared-world parity unmeasured. |
| Joint limits | [physics_create.cpp](https://github.com/jstzwj/MikuDanceStudio/blob/4648314a8379efa7ce2f01ec96beda2eac0c4678/src/physics/physics_create.cpp) passes lower/upper vectors into Bullet spring 6DoF constraints | Inverted ranges retain free axes; tested through actual Ammo execution. Spring/contact policy has independent backend tests. |
| IK | [pmx_load.cpp](https://github.com/jstzwj/MikuDanceStudio/blob/4648314a8379efa7ce2f01ec96beda2eac0c4678/src/model/pmx_load.cpp) retains XYZ limits; [bone_transform.cpp](https://github.com/jstzwj/MikuDanceStudio/blob/4648314a8379efa7ce2f01ec96beda2eac0c4678/src/model/bone_transform.cpp) uses Euler decomposition/clamping and fixed-axis handling | XYZ projection is analytical conformance only; fixed-axis execution explicitly unavailable. |
| Motion names | [vmd_load.cpp](https://github.com/jstzwj/MikuDanceStudio/blob/4648314a8379efa7ce2f01ec96beda2eac0c4678/src/model/vmd_load.cpp) accepts old/new signatures and prompts on model-name mismatch | Names preserved; opt-in target-rest rebinding with explicit ambiguity handling. |

Windows original-MMD v9.32/MikuDanceStudio trajectory comparison was not run in
this environment. It remains optional. No table entry claims measured original
fidelity; the reference implementation's reconstructed comments are evidence.
