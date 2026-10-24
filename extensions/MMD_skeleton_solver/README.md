# MMD_skeleton_solver

Draft, optional, root-level glTF extension. Version 1 specifies the bounded
`pre-physics-v1` project policy. It transports original inputs and solver behavior
that core glTF joints, TRS and sampled animation cannot represent. Core node TRS
and animations always contain resolved output; an ordinary loader needs no solver.
This is analytical conformance, not measured original-MMD fidelity.

[Schema](schema/glTF.MMD_skeleton_solver.schema.json),
[minimal valid glTF](examples/minimal.gltf), and
[invalid semantic fixtures](tests/invalid.json) run in `npm test`.
The minimal example has no PMX extras, skin, mesh or material extension dependency.
It rotates a one-metre +X link to +Y; resetting through the optional plugin
recomputes that resolved state from identity original rest.

## References and status

The format author's [PMX document mirror](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
describes bone records and pre/post-physics, layer/index evaluation. The author's
[0216b amendment](https://kkhk22.seesaa.net/article/312703073.html) describes local
append and supersedes its struck-through exception. Old assumption: local append
is ignored when its source also appends. Corrected requirement: local append takes
priority, including when its source appends. Rationale: the author's amendment
explicitly supersedes the exception. Local editing axes are a separate feature.
Original-MMD adoption remains unresolved.

[Core glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) provides
resolved joints/TRS and animation. Three.js's
[CCDIKSolver](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/animation/CCDIKSolver.js)
is related implementation machinery, not a fidelity reference. The equations,
numerical caps, singular-case choices, dependency restrictions and switch seams
below are **project policies**, not original-MMD measurements.

## Contract

The extension object is `{ "version": 1, "bones": [...] }`. Each bone requires:

| Property | Meaning |
| --- | --- |
| `index` | Stable rig-local identity, integer 0..65535; PMX imports retain the source ordinal. |
| `node` | Index into glTF `nodes`; unique within the profile. |
| `name` | Exact source name, independent of sanitized runtime names. |
| `parentIndex` | Stable bone identity, or -1 for a model root. Must match core hierarchy. |
| `translation`, `rotation`, `scale` | **Original local rest**, not current posed TRS. Quaternion XYZW, unit length; scale explicitly [1,1,1]. |
| `layer` | Signed 32-bit evaluation layer. Ties use stable `index`, never emitted node order. |
| `flags` | Original 16-bit bone flags; bit 0x1000 records the unsupported post-physics phase. |
| `append` | Optional `{source,rate,local,rotation,translation}`. `source` references a stable bone identity. |
| `ik` | Optional `{effector,iterations,angle,links}` on the controller/goal bone. |

All rest values and behavior operate in model space using glTF right-handed
metres and radians. Rest is immutable across pose application, reset and export.
Root-level model placement is outside the solver coordinate system. Source PMX
positions/translations reflect Z and scale metres/unit. Quaternions reflect
`(x,y,z,w)` to `(-x,-y,z,w)`. X/Y hinge bounds reflect and swap endpoints;
Z hinge bounds are unchanged. The pinned parser leaves IK limits unreflected, so
the importer performs this conversion explicitly. PMX FLOAT pi canonicalizes to
mathematical pi; larger angle caps fail. Other source flags, axes and original
limit arrays are retained in the asset's `sourceSolvers` diagnostics.

Optional append/IK records mean no append/IK. All fields inside a present record
are explicit; there are no implicit hinge axes, append rates or iteration counts.
PMX API imports default missing layer/flags to zero. There are 1..65536 bones,
1..256 links per chain, and a work cap of 20,000,000 estimated bone updates
(sum of (iterations + 1) × links × bone count). Non-finite/FLOAT-overflow values fail.

## Evaluation policy

Each call takes a complete **raw** local input pose relative to original rest.
Never feed a previous resolved pose back as raw input. Inputs are cloned; no
profile, binding or other instance is mutated. Evaluation sorts ascending layer,
then stable index. At each bone's turn, apply its append, refresh world transforms,
then solve its IK. Solver contributions remain separate from future raw input.
Matrices, skin palettes and deformation bounds refresh after committing results.

Quaternion multiplication is Hamilton composition, with `qA*qB` applying B then
A. Input VPD/VMD rotation is `rest * reflectedOffset`. An append destination uses
`inputRotation * pow(sourceDelta, rate)` and
`inputTranslation + rate*sourceTranslationDelta`. There is no clamp on finite
signed rates: zero, negative and >1 rates are meaningful. Quaternion power uses
the shortest canonical representative (W nonnegative; at W=0 the first nonzero
XYZ component is positive), axis-angle angle multiplied by the rate.

Non-local append uses the source's current local rotation delta
`inverse(sourceRestRotation) * sourceResolvedRotation`, and its current local
translation minus original local translation. Thus input, chained append and IK
contributions participate, while ordinary hierarchy inheritance does not.
Local append uses the current model-space rigid deformation of the source:
`Q = sourceWorldRotation * inverse(sourceOriginalWorldRotation)` and
`T = sourceWorldPosition - Q * sourceOriginalWorldPosition`.
It includes inherited parent deformation even when the source itself appends.
Rotation and translation rates operate on Q and T separately. These composition
and translation decomposition equations are explicit unmeasured project choices.

IK snapshots the controller's current world position at its turn. CCD visits
links in stored effector-to-root order, at most `iterations` (0..255) sweeps;
each update is capped by `angle` (0..pi). Unconstrained updates use the shortest
arc between link-to-effector and link-to-goal vectors in the link's current
coordinates, postmultiplying the current local rotation. The solver refreshes
world transforms after each update; it stops at residual <1e-10 metres.

A limited link has `hinge: {axis,min,max}`. Axis is 0/X, 1/Y or 2/Z in original
local-rest coordinates; angles are in [-pi,pi], min <= max. At each active update, first project the input quaternion onto its
rest-relative axial twist and clamp it to the interval, discarding off-axis
components. Compute the projected signed CCD angle with atan2 of cross/dot in
the original-rest frame. Among equivalent angles modulo 2pi, choose the feasible
orientation with least angular residual, then the shortest feasible angle path
(ties use the lower angle). Follow that path with the per-update angle cap.
Initial constraint projection precedes the capped CCD step; it may repair an
out-of-range input by more than that cap. A zero axial quaternion pair projects
to zero angle, independently of quaternion sign. Import requires exactly one nonzero PMX limit axis and zeros on the other
two. General Euler boxes and fully locked triples are explicitly rejected.

Link/goal vectors shorter than 1e-12 metres skip the update. Projected hinge
vectors shorter than 1e-12 keep the projected/clamped input and skip the CCD step. Unconstrained antiparallel vectors choose a
deterministic perpendicular: cross the effector direction with the least-aligned
positive cardinal axis (X/Y/Z tie order). An unreachable goal uses the result
of the bounded sweeps, not an assertion of zero residual. Zero iterations or
angle means no IK update. Repeated evaluations use the same original inputs.

## Supported dependencies

Parents and append sources must precede their consumers by layer/index. Hierarchy
and append cycles fail. IK links must be unique, already evaluated ancestors of
the effector in effector-to-root order; the controller cannot descend from a link.
An append consuming an IK-updated link must follow that controller. All roots
share one model coordinate system. Unit-scale TRS only; no matrices/shear.

Post-physics, fixed-axis-dependent evaluation and external parents fail execution
requests with indexed diagnostics. Their original records remain available in
legacy solver-free conversion, with explicit loss reports. General multi-axis
limits, physics and scene VMD execution remain mandatory overall work, outside
this bounded profile. Local editing axes do not redefine the solver frame.

## VMD and loading

`MMD_animation_vmd` version 3 embeds the identical root solver contract, raw
curves, bound IK tracks and preserved visibility bytes. It replaces the complete
matching fallback, including resolved TRS channels for **every profile bone**.
Exact playback evaluates raw curves then solves once. No fallback track drives
the same joints concurrently. Model visibility is preserved but does not execute;
its omitted count is explicit. Versions 1/2 keep their existing solver-free
semantics. See the [runtime guide](../../docs/solver.md) for binding and sampling.
