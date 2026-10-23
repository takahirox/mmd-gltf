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

`morph-box.pmx` and `morph-wedge.pmx` add four vertex targets and one unsupported
group morph to the distinct box/wedge rigs. Every target references 24 vertices,
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
