# MMD_morphs

Optional, runtime-independent root contract, version 1. Draft project policy; no
original-MMD equivalence claim. [Schema](schema/glTF.MMD_morphs.schema.json),
[standalone bone-only glTF](examples/minimal.gltf), [valid](tests/valid.json) and
[invalid semantic fixtures](tests/invalid.json). The minimal example has no mesh,
POSITION targets, skin, animation or PMX extras; `lift=0.5` moves its joint 0.1 m.

## Identities and representation

`model.modelId` identifies an immutable source model/scale; source morph `index`
and bone `index` remain stable across export. Display names are informational;
exact-name/byte-map VMD binding uses the retained source names. `nodes` maps every
bone index to a unique glTF joint node. `model.bones` contains original unit-scale
local rest TRS, names and parent indices. `meshes` lists the glTF nodes whose
primitives share the target layout; it can be absent for bone-only models.
`model.metersPerPMXUnit` converts raw VMD/VPD translation units into meters.
Translation offsets are already right-handed meters; rotations are unit XYZW
quaternions in glTF local axes. Consumers must not reflect or scale them again.

The v3 model adds `control` to every identity, independently of nullable `target`.
Executable vertex, bone and supported one-hop group identities have distinct
contiguous control slots. Unsupported families and unsupported whole groups have
`control:null`. Direct vertex targets come first, then legacy vertex-only groups (including empty
groups), then newly executable mixed vertex/bone groups; each family retains source
order. A newly executable mixed group cannot shift existing vertex-only group slots. These target slots remain unchanged
when bone controls are appended. Control slots corresponding to targets retain
those indices; remaining bone/bone-only-group controls follow in source order.

`weights` is the complete independent scalar snapshot, default zero in newly
converted assets. No normalization or clamping occurs: negative, fractional and
weights above one are supported up to absolute 10000. `raw`, when supplied, is the
unmorphed VPD/VMD baseline underlying the snapshot; otherwise rest is the baseline.
Raw records must preserve the rest table's identity, hierarchy and scale.
On loading, retain both the original rest and this baseline, and leave core TRS
and core weights untouched. Executing a snapshot during loading would double
apply the deformation. Editing a control recomputes from `raw`, never current
resolved joints.

## Families and deterministic evaluation

Type 1 uses core POSITION deltas. Type 2 has ordered `bone` entries containing
bone index, translation and rotation offsets. Type 0 retains ordered `group`
entries `{index,rate}`, including duplicates, forward/shared references and zero
rates. Only immediate vertex/bone children execute. UV, material, flip, impulse,
nested, self and cyclic groups remain unsupported, with indexed diagnostics.
Even a zero-rate unsupported child makes the entire group nonexecutable.

Let `w_i` be the independent control for source morph i. For each bone morph b:

```
c_b = w_b + sum_g sum_(entry e in g, e.index=b) w_g * e.rate
T_j = T_raw,j + sum_b sum_(offset e in b, e.index=j) c_b * e.translation
Q_j = normalize(Q_raw,j * product_(b ascending, e source order, e.index=j) power(e.rotation,c_b))
```

Reduction uses group source order, then group entry order. Bone composition uses
source morph order, then source offset order, irrespective of group traversal.
Each normalized offset is canonicalized to `w>=0`; at `w=0`, the first nonzero
XYZ component is positive. For q=(axis*sin(theta/2),cos(theta/2)), define
`power(q,c)=(axis*sin(c*theta/2),cos(c*theta/2))`; identity remains identity.
This gives equivalent signs identical behavior and extrapolates signed weights.
It is an explicit project policy, **not a measured original-MMD equation**.
Duplicate group entries reduce before quaternion power. Multiple noncommuting
bone offsets postmultiply in source order; reversing this order changes results.

Vertex groups are compiled into their own core target. Their independent control
is written to that target once; do not also add it to child vertex weights. Bone
children of the same group contribute only through the reduction above. Thus a
mixed group applies each family once and preserves independent direct controls.

Apply the result before the existing solver: ordered pre-phase IK/append, body
coupling/simulation, post-phase deformation, then skinning and Outline. Existing
append conventions are unchanged. For animated physics, sample raw VMD plus bone
morph inputs at initialization and **each** fixed simulation tick. Resolved joints
must never become the next raw input.

## Playback, handoffs and fallback

[MMD_animation_vmd v5](../MMD_animation_vmd/README.md) retains independent scalar
tracks and original bone inputs. Bone-only tracks determine duration without a
geometry weights channel. Core joint channels include every raw-track or morph-affected joint (all joints with a solver), including
morph-affected joints without VMD bone tracks. Core weights retain compiled vertex
fallback. An aware player replaces the complete matching fallback animation once.
Legacy animation v1–v4 and morph identity v1–v2 semantics are unchanged. Conversion
keeps the vertex-only legacy profile when no nonempty bone offsets need execution;
legacy empty-only bone diagnostics remain unchanged.

Manual changes validate first, pause motion, clear/rebuild physics history at tick
zero, and recompose from the retained raw baseline. VPD apply/reset preserves all
control weights, replacing only raw bone inputs; VPD has no invented morph channel.
Seek/resume reclaims VMD ownership and its independent controls. Stop/reset sets raw inputs to original rest and zero controls, then runs the
selected solver/physics pipeline. Loop crossings replay from the wrapped time and rebuild
physics history. Explicit physics restart reuses the current morphed raw inputs;
disabling physics evaluates the same inputs through the existing solver.

Ordinary loaders see a core snapshot and approximate resolved animation. Adaptive
quarter probes use existing tolerances, FLOAT quantization, strict timestamps,
seams and budgets; physics uses the existing fixed ticks and approximate LINEAR
interpolation. Finite probes do not prove continuous error bounds. Budget/precision
failures reject conversion; no partial file is published by the converter API.

The validator checks source counts, unique references, hierarchy, finite FLOAT
values, unit quaternions (1e-5 input tolerance, converter normalizes), independent
control layout, complete diagnostics and overlapping root/extras/solver identity.
Limits are 65536 identities/bones, 1000000 total group/bone entries, absolute
control/reduced contribution 10000, and 50000000 vertex compilation scalar work.
Dependency diagnostics also cap graph inspection at 1000000 visits.
Animation and physics retain their stricter existing budgets. Invalid contracts
or changed target layouts reject before applying transforms.

## Sources and evidence labels

The [PMX format-author mirror](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
defines type-2 translation/quaternion offsets, type-0 rates and no grouping of
groups; it places bone morph inputs before ordered deformation. It does not settle
the accumulation equation above. [Core glTF](https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc)
provides attribute morph targets and joint TRS/animation, but lacks these independent
bone/group controls. [Three.js r186 quaternion source](https://raw.githubusercontent.com/mrdoob/three.js/r186/src/math/Quaternion.js)
is an implementation reference for XYZW products and closest-sign interpolation;
it does not establish MMD semantics. See the [implementation record](../../docs/bone-morphs.md).
