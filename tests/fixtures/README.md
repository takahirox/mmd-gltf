# Synthetic PMX skinning fixtures

These binary PMX inputs were newly authored for Issue #25 by mmd-gltf
contributors using [the deterministic generator](../../tools/synthetic-bdef.ts).
They contain original synthetic cube geometry and rig data, no third-party
model, image, shared-toon, motion or pose bytes. Attribution is also embedded in
the PMX comment and the demo's GLB extras and conversion record.

Regenerate from the repository root with `npx tsx tools/synthetic-bdef.ts`.
The unit suite checks every committed binary against the generator.

- `bdef.pmx`: UTF-16LE PMX 2.0, 24 face-normal vertices, 12 triangles, two materials,
  BDEF1/2/4, mixed and repeated influences, inactive `-1` padding, and 260 bones.
  Bone 0 has forward parent 1; bones 1 and 2 are roots; bone 259 is a child of 0.
  The other bones are retained despite being unweighted. Bones 0 and 259 share
  exact Japanese and English names with punctuation that GLTFLoader changes.
  Bone positions are nonzero and arbitrary tail offsets must not create rest
  rotations. The converter applies a 0.5 scale for the demo and numerical oracle.
- `bdef-utf8.pmx`: UTF-8 PMX 2.0 with the same geometry and hierarchy, plus
  an unused texture path, all optional bone fields and PMX 2.0 morph record
  layouts, a display frame, rigid body and joint. These extra records exercise
  text transcoding only; their solver/evaluation semantics remain unsupported.
  Names cover odd/even UTF-8 byte lengths, duplicate Japanese/English strings,
  supplementary Unicode, a leading U+FEFF and a combining character. Tests compare
  transcoded bytes against a generated UTF-16LE counterpart, check exact names
  through GLB/glTF reload and pinned GLTFLoader, and reject malformed UTF-8.
- `sdef.pmx`: the same geometry/rig with 24 SDEF vertices. Static conversion
  remains supported with loss reporting; BDEF conversion must reject it and
  identify affected vertices.
- `qdef.pmx`: binary PMX 2.1 with QDEF records. Pinned mmd-parser rejects its
  version header before vertex parsing; the regression also changes only that
  header to 2.0 to exercise the parser's unsupported type-4 error. Neither path
  is accepted or approximated.

[Unit tests](../bdef.test.ts) parse the binary, convert, validate and reload both
GLB and unpacked glTF, checking every bone identity and parent, all rest vertices,
and an analytic 90-degree Z rotation plus three local translations. Maximum
absolute position tolerance is `2e-6` meters: FLOAT weights and inverse binds
introduce small rounding, while this sub-meter pose avoids long rotation chains.
The expected positions use explicit scalar formulas, independent of emitted
inverse binds and joint matrices. Malformed model regressions cover cycles,
parents, non-finite positions, influence counts, active references, weights,
zero totals and materially non-unit sums. A roundoff adjustment is checked
separately. Weight-sum acceptance uses `1e-6`, not the position-test tolerance.

[Browser measurements](../bdef-gpu.ts) load the actual converter output through
the lockfile's GLTFLoader with active Toon and core PBR, then compare surface and
outline rasterizations against independently baked analytic geometry. The baked
surface uses Three.js's weighted normal matrix behavior; the baked outline uses
the draft's inverse transpose. These are deliberately distinct. Rest, deformed
and reset states run for each material path. Position tolerance is `2e-6`; pixel
comparison permits two encoded levels and at most 0.5% boundary pixels for
independent FLOAT raster rounding. Reset must exactly match rest. Existing raw
weight and multiple-influence-set outline coverage remains unchanged.

## Issue #27 VPD fixtures

All new assets are original works by mmd-gltf contributors authored in this
repository; no third-party pose, model or motion data is included. `pose-a.vpd` is
actual Shift_JIS/CRLF bytes with four named bone offsets; `pose-b.vpd` is actual
UTF-8/LF bytes with three differently ordered offsets. Git attributes preserve these encoding/newline bytes across checkouts. Both contain
Japanese punctuated duplicate names; neither parent filename is a resource dependency.
Pose A rotates parent 1 about source +X, child 0 about source +Y, and leaf 259
about +Z, all by 90 degrees, plus translations on four bones. Pose B rotates
parent 1 about -Z, root 2 about +Y and leaf 259 about -X; it omits child 0 and has
different translations. The committed JSON maps address duplicate names using
record ORDINALS, never the unrelated BoneN labels.

`vpd-wedge.pmx` is generated with
`syntheticPMX('bdef', 'utf16le', false, 'wedge')`: its geometry shears X by
`0.75*x + 0.2*y`, with inverse-transpose source normals. Its leaf 259 is at
`[0.5,1.5,2.5]` in PMX coordinates and parented to root 2, rather than child 0.
It is a distinct rig/geometry, not a text/encoding variant. The earlier
`bdef.pmx` supplies the box rig unchanged. VPD cases use `0.2` meters/unit for
the box and `0.125` for the wedge, exercising scale recovery independently.

[Unit/integration tests](../vpd.test.ts) exercise both poses on both rigs through
API/CLI conversion, GLB and unpacked glTF, ordinary GLTFLoader, repeat application,
switching and reset after reload, including dirty-transform replacement and
failure atomicity. The [scalar oracle](../vpd-oracle.ts) uses explicit quarter
turn formulas, authored hierarchy/offsets and influence patterns, without the
production pose resolver or emitted joint matrices/inverse binds. Numerical
position tolerance remains absolute `2e-6` meters; double-precision quaternion
component/basis comparisons use `1e-12`, sufficient for decimal quaternion
roundoff and JSON serialization of these short chains. Browser pixel comparisons
retain two encoded levels and 128 of 25,600 boundary pixels (0.5%). These limits
are chosen before measurements and do not relax the BDEF baseline.

The built `vpd-conformance.html` tool runs the same independent surface/outline
raster method with Toon and core PBR on runtime-applied assets, converter-posed
GLB/glTF, and runtime GLTFExporter GLB/embedded-resource glTF reloads, then resets
and reapplies. Original-MMD pose reproduction and representative-model fidelity
remain unmeasured; synthetic conformance cannot establish those goals. IK,
append/grants, deformation ordering, morphs, physics, advanced skinning and VMD
remain mandatory outstanding work for the overall project.


## Issue #29 VMD fixtures

`motion-a.vmd` and `motion-b.vmd` are two distinct original VMD 0002 byte fixtures,
authored by mmd-gltf contributors using [synthetic-vmd.ts](../../tools/synthetic-vmd.ts).
No third-party motion/model data. Regenerate with `npx tsx tools/synthetic-vmd.ts`;
`npm test` checks byte equality. Both include bone, morph, camera, light, shadow
and visibility/IK records; only bones execute. Omitted records each have one
entry, including one IK toggle. Deliberately retained interpolation padding is
`0xab` after the first 16 bytes.

A animates X/Y/Z-axis parent/child rotations, with nonzero initial frames and an
adjacent 6→7 frame interval; B changes hierarchy participation, direction, axis
and duration. Both use four different nonlinear curve tuples, negative quaternion
representations, unsorted records, Japanese bytes and full 15-byte names.
`motion-*-map.json` documents exact byte-track to source-index mappings. Both
are exercised on the existing box (`0.2 m/unit`) and wedge (`0.125 m/unit`).

[The independent oracle](../vmd-oracle.ts) restates authoring parameters and uses
scalar polynomial Newton inversion, axis-angle rotations, hierarchical point and
vector transforms, BDEF scalar sums and inverse-transpose normals. It does not
import the production motion evaluator, sample its output or use emitted fallback
samples as expected values. Byte FLOAT authoring rounding is intentionally left
in the measured error. Exact rotation tolerance is declared `1e-7 rad` before
measurement; exact skin positions retain `2e-6 m`. Fallback local translation
and orientation limits are `1e-5 m` and `1e-4 rad`, measured at keys and a uniform
1201-point time grid (1200 subdivisions of last frame/30), without claiming a
continuous bound. See [actual validation](../../docs/validation.md#issue-29-vmd-bone-motion).

## Issue #31 vertex morph fixtures

All new bytes are original synthetic works by mmd-gltf contributors, authored in
this repository with [synthetic-morph.ts](../../tools/synthetic-morph.ts) and the
optional `vertexMorphs` argument of [synthetic-bdef.ts](../../tools/synthetic-bdef.ts).
Regenerate with `npx tsx tools/synthetic-morph.ts`. No third-party assets. The
existing PMX/VPD/VMD fixtures remain byte-identical, including the intentionally
unexecuted `unused morph` records in both original VMDs. Their callers explicitly
ignore/report unmatched morphs; bone assertions are retained.

`morph-box.pmx` and `morph-wedge.pmx` add four vertex targets and one group
morph (now supported by Issue #41) to the distinct box/wedge rigs. Every target references 24 vertices,
with overlapping XYZ offsets across both materials. Two exact Japanese names
`笑い` deliberately collide, resolved by source PMX index in `morph-map.json`.
`combined-a.vmd` and `combined-b.vmd` retain the respective distinct bone motions
and replace the old morph section with distinct scalar tracks. A has nonzero
first frames, a single-key overlapping track and independent weights summing above
one; B has different keys, a longer morph duration than bones, signed weights and
nonzero initial values. Two untracked owned vertex targets must remain zero.
`morph-only.vmd` has zero bone records, no dummy keys, and A's morph records.

The [independent morph oracle](../morph-oracle.ts) restates decimal authoring
parameters and scalar interpolation without importing production evaluators or
emitted samples. It adds weighted reflected/scaled deltas **before** the existing
independent scalar BDEF predictor. Byte FLOAT rounding is left in measured error.
Tests compare direct byte playback, retained GLB, unpacked glTF and ordinary
GLTFLoader core fallback at all keys and the uniform 1201-point time grid. Limits
are weight error `1e-6`, position error `2e-6 m`, existing exact bone orientation
`1e-7 rad`, and existing fallback orientation `1e-4 rad`. Combined fixture exports
request `2e-8 m`/`2e-7 rad` bone sampling probes so core fallback also meets the
combined skin-position bound. This is bounded synthetic evidence, not a continuous
error proof or original-MMD/representative-model fidelity measurement.

The same built VMD conformance entry with `?morph` bakes independent predictions
for 144 Toon/PBR/Outline comparisons across both rigs/motions and all three source
paths. Raster limits remain two encoded levels and 128 mismatched pixels out of
160×160. Browser lifecycle tests additionally cover visible manual weight changes,
seek/reset, play/pause/loop, switching, local VMD ambiguity/recovery, morph-only
motion, VPD weight preservation and disposal.

## Issue #33 mixed SDEF variants

`sdef-box.pmx` and `sdef-wedge.pmx` are original synthetic derivatives of the
existing distinct box/branched wedge families, authored by mmd-gltf contributors.
Regenerate with `npx tsx tools/synthetic-sdef.ts`; the generator deliberately keeps
the earlier rejection-only `sdef.pmx` unchanged. Each new variant has 24 vertices,
260 joints, two materials and the existing five source morphs (four vertex
POSITION targets and one group now supported by Issue #41). Every quad has BDEF1 followed by
SDEF with ordered [259,2] pairs and X weights .25, 0, 1. The first face has zero
C/R0/R1; subsequent faces have nonzero asymmetric values. Scale is 0.2 m/unit for
the box, 0.125 m/unit for the wedge; extents are bounded below one metre.

Both combined VMD files and both VPD files are reused with their existing exact
name maps. `tests/sdef-oracle.ts` derives transforms from independent scalar
VMD/VPD authoring predictions, restates source geometry and uses an expanded
center correction. No runtime SDEF evaluator, loaded joints or emitted positions
supply expectations. The standalone semantic corpus also has a one-metre arc:
identity/90-degree Z palettes give (.7071067812,.7071067812,0), whereas BDEF2
produces (.5,.5,0). This separation is far above ten times the 1e-4 m GPU limit.
The TSL adaptation is attributed to pinned three-mmd-loader; its MIT notice is
retained in `packages/three-mmd-sdef/THIRD_PARTY_LICENSE`. That reference is
alternative-renderer evidence and supplies no original-MMD measurement.

## Issue #37 bounded QDEF variants

`qdef-box.pmx` and `qdef-wedge.pmx` are original mmd-gltf contributor derivatives
of the two earlier rigs, authored in this repository with no third-party model
bytes. Regenerate with `npx tsx tools/synthetic-qdef.ts`. Both are actual binary
PMX 2.1 with mandatory zero soft-body tails, four active QDEF influences, inactive
-1 references, duplicate source influences, endpoints, BDEF1 and ordered SDEF,
two materials, 260 joints and the existing vertex morphs. Box/wedge geometry and
hierarchies remain distinct. Both use `combined-a.vmd`, `combined-b.vmd`,
`pose-a.vpd` and `pose-b.vpd` with the original attribution and binding maps.

`pmx21-fixture.ts` is an independent small binary writer used by Node tests to
cover both encodings and all 1/2/4-byte vertex/other index-width combinations,
plus unsupported sections, invalid references/counts and truncated tails.
The original `qdef.pmx` remains byte-identical: the old pinned-parser failure
is historical evidence; it now enters the bounded reader without relabeling.
The header-modified probe remains invalid 2.0 input.

The [QDEF oracle](../qdef-oracle.ts) expands scalar dual-quaternion equations
from authored transforms independently of production deformation. The built
conformance page measures actual GPU positions/normals and independent surface/
Outline rasters. The [guide](../../docs/qdef.md) and
[validation record](../../docs/validation.md#issue-37-bounded-pmx-21-qdef)
state the profile choices, source hashes, numerical/raster results and limits.
Original-MMD QDEF deformation remains unmeasured; these are synthetic
project-profile fixtures, not representative MMD compatibility evidence.


## Issue #41 vertex-group fixtures

`tools/synthetic-group.ts` deterministically authors `group-box.pmx`,
`group-wedge.pmx`, `group-a.vmd`, `group-b.vmd` and `group-map.json`, using the
original geometry/bones of `tools/synthetic-bdef.ts` and the independently
attributed bone bytes of `tools/synthetic-vmd.ts`. All additions are original work
by mmd-gltf contributors; no third-party model/motion bytes or original-MMD capture.
The box and sheared wedge retain distinct hierarchies/scales and both materials.
Existing fixture bytes remain unchanged.

There are four vertex targets, followed by four supported group targets. Source
0 forward-references vertex 1 at 0.5. Source 5 shares children and preserves the
ordered entries `(1,.25),(1,.25),(2,-.5),(4,0)`. Source 6 is empty. Source 7 duplicates
source 0's exact name but references vertex 2. Source 8 is a bone morph; 9 mixes a
vertex and that unsupported child; 10 nests group 0; 11 references itself; 12/13
form a cycle. These last groups remain wholly unsupported with retained entries.
`group-map.json` maps exact byte keys for duplicate `group` and Japanese vertex
names. Variants generated in memory also exercise mixed SDEF/QDEF.

Group A has frames 0/15/30: direct weights 0/.3/.3, first group .8/.8/-.4,
shared group 0/.2/-.1. Group B has frames 0/20/45: direct -.2/.6/.1,
first group 1.2/-.5/.4, shared .3/0/.7. At Group A's frame 0 only a group
moves vertices. Separate manual probes exercise exactly `.3 + .8 * .5 = .7`.
`tests/group-oracle.ts` independently authors decimal scalar interpolation and
expanded combined coefficients; it reads neither production group deltas nor
emitted animation. Existing scalar bone predictions supply morph-before-BDEF
positions. Advanced probes pass independently computed group points to the
existing independent SDEF/QDEF predictions.

## Issue #43 solver fixtures

`tools/synthetic-solver.ts` authors all `solver-*` bytes as original works by
mmd-gltf contributors, without third-party models/motions or original-MMD capture.
Six PMX variants combine two distinct geometries/hierarchies with BDEF, SDEF and
actual PMX 2.1 QDEF (mandatory zero soft-body tail). The wedge shears its geometry,
uses a length-two +Y IK chain and parents its append bone under the animated root;
the box uses a length-one +X chain and a separate append root. Both have seven
bones, a vertex/group morph, noncommuting input/append rotations, translation
append, signed chained append, local append of an appending source, an IK-updated
append source and layer/index ties. Scale is 0.2 m/unit for both.

`solver-a.vmd` and `solver-b.vmd` contain distinct continuously changing raw inputs plus
IK enabled/disabled/re-enabled controls at frames 0/15/30 and last bone frame 45.
Visibility switches are preserved but not executed. A varies root X and append Y rotations while moving the goal; B varies root Z
and append Z rotations along a different goal trajectory. Both include a link
translation, animated append translation, direct vertex weights (.1→.2 / -.15→.05)
and group weights (.6→.8 / -.4→-.2).
Linear raw curves generate nonlinear solved trajectories.
`solver-a.vpd` / `solver-b.vpd` contain the corresponding raw bone offsets in
UTF-8. Reproduce with `npx tsx tools/synthetic-solver.ts`.

`tests/solver-oracle.ts` independently calculates shortest arcs geometrically,
uses authored rest geometry and transforms, and applies independent BDEF sums,
expanded SDEF center correction and the independent scalar QDEF oracle. It never
imports the production evaluator, source parser or emitted sample values.
Node fixtures separately predict hinge limits, unreachable, zero-length,
antiparallel and capped/disabled behavior. Numerical limits remain orientation
1e-5 rad and CPU position 2e-6 m; GPU position 1e-4 m and normal components 5e-4.
Toon/PBR surface and Outline comparisons keep two encoded levels / 128 of 25600
boundary pixels. Negative controls disable IK and deliberately use the raw joint palette
from before IK/append when deforming vertices. Saved measurements are linked from the solver validation record.

Issue #45 adds `physics-{box,wedge}-{bdef,sdef,qdef}.pmx`, original synthetic
physics variants generated by `tools/synthetic-physics.ts` using the optional
physics branch of the existing solver generator. Their distinct geometry and
hierarchy, vertex/group targets and mixed weights come from the attributed
Issue #43 works. The original fixtures and generator defaults remain unchanged.
The variants add sphere/box/capsule bodies, modes 0/1/2, an unbound group-15 body,
asymmetric exclusion bits, a translated/rotated spring joint with asymmetric
limits, and a post-physics local append consumer. They reuse both original
`solver-{a,b}.vmd` motions and both `solver-{a,b}.vpd` poses without changing those
bytes. All are repository-authored works by mmd-gltf contributors; no third-party
fixture bytes or original-MMD measurements are included.
