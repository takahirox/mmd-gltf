# VMD bone and vertex-morph contract

Issue #29 adds VMD 0002 solver-free translation/rotation through PMX BDEF conversion,
retained glTF curves, reusable Three.js playback and the built `rig.html` Demo.
Issue #31 extends this with vertex morphs and synchronized weight playback below.
It does not complete MMD reproduction. Camera, light, shadow and display/IK
**execution**, advanced skinning, other morph families, append/IK/deformation ordering,
physics and representative production-model fidelity remain mandatory overall work.

## Reader and byte names

`parseVMD(Uint8Array)` in [mmd-vmd](../packages/mmd-vmd/reader.ts) accepts the
30-byte zero-padded `Vocaloid Motion Data 0002` signature, a 20-byte informational
model name and a mandatory bone count/section. Other versions fail explicitly.
It reads bone (111 bytes), morph (23), camera (61), light (28), self-shadow (9),
and variable visibility/IK (9-byte prefix, 21 bytes per IK entry) sections in order.
EOF is allowed **only after a complete section**, beginning after the mandatory
bone section. Missing later sections mean zero records. EOF inside a count,
record or IK array is an error. Extra bytes after visibility/IK are an error.
This is a strict bounded project profile, without permissive truncation recovery.

Counts are checked against remaining bytes using the record size **before** any
record array is populated. The input cap is 64 MiB, count cap one million per
section. All floating values, including omitted sections, must be finite.
Executed bone quaternions must have unit length within `1e-5` and are normalized;
executed interpolation bytes (the first 16) must be `0..127`. Remaining bytes of
the 64-byte interpolation field are retained, not interpreted. Camera interpolation,
flag bytes and all unexecuted fields remain in the result with each complete raw
record. `omittedRecords()` reports morph/camera/light/shadow/display and individual
IK counts; binding results and conversion warnings expose these counts explicitly.
No unknown tail or unsupported execution is silently discarded.

VMD names are **fixed-width bytes**, independent of VPD's text grammar and encoding
selection. `ByteName` preserves the entire field in `raw`, a fatal Shift_JIS decoded
`text` (or `null`), `terminated`, and `key`: lowercase hex of bytes before the first
zero, or the entire field if there is no zero. Padding after a zero is retained
but does not distinguish tracks. Bone tracks group by that byte key. A full-width
15-byte name may be truncated, even if decodable or exactly equal to a PMX name,
and always requires an explicit mapping. Undecodable names require a mapping too.

Otherwise, automatic binding requires exactly one identical retained PMX source
name. Duplicate PMX names require a mapping. No sanitized Three.js name, prefix,
English alias or informational model filename establishes identity. The mapping
is `{ "hexByteKey": sourcePMXIndex }`, not a VPD record ordinal. Invalid keys,
invalid indices and multiple tracks targeting one joint fail. If two names collide
within 15 bytes they are one byte track; mapping cannot recover lost identity.
Duplicate frames within a **bound** track fail rather than selecting a winner.
Unmatched tracks fail by default; `{unmatched:'ignore'}` explicitly permits partial
playback with diagnostics. Ambiguity/truncation are never guessed by that policy.
Bindings are scoped to a model instance; rebind when loading another instance.

## Evaluation and serialization

Seconds = frame/30. Keys are sorted; the destination key owns the preceding
interval's four independent curves (translation XYZ and rotation). Each
`[x1,y1,x2,y2]` tuple is divided by 127. Evaluation inverts the Bezier **time**
coordinate and uses its Y coordinate as the interpolation weight. Rotation uses
shortest-path quaternion slerp and treats quaternion signs as equivalent.
Translation is reflected in Z once and scaled once; quaternion reflection is
`[-x,-y,z,w]`. Offsets compose with ORIGINAL local rest (`restRotation * offset`),
never the current pose. Every evaluation restores untracked joints to original
rest. Seeking is independent of playback history; values outside a track clamp
to the nearest key, including nonzero initial frames and single keys.

Every positive interval uses continuous curves, including adjacent frames.
Continuous adjacent frames, nearest-key endpoint clamping and duplicate rejection
are explicit **project policies**, whose original-MMD equivalence is unresolved.
[Historical official Three.js](https://github.com/mrdoob/three.js/blob/r169/examples/jsm/loaders/MMDLoader.js)
provides an identified alternative-renderer reference for frame/30,
destination-key curves and quaternion interpolation; its adjacent-frame heuristic
is deliberately not adopted. The reader layouts through display/IK follow
[MMD Tools at the identified commit](https://github.com/MMD-Blender/blender_mmd_tools/blob/e321bd02dd0288a3dc9f1974c06597803c060e11/mmd_tools/core/vmd/__init__.py).
These are implementation references, not original-MMD acceptance measurements.

The optional [MMD_animation_vmd v0.2 draft](../extensions/MMD_animation_vmd/README.md)
defines local glTF values, original-rest node references, curves and complete
replacement of the corresponding fallback animation. Ordinary loaders get
approximate core LINEAR TRS channels; the extension-aware loader removes those
tracks from `gltf.animations` and exposes exact players. This prevents simultaneous
driving through the returned animations. Toon/Outline and core PBR remain independent.

Fallback sampling includes zero, all keys and adaptive endpoint/quarter probes,
with FLOAT input/output quantization. Defaults: `2e-6 m` translation and `2e-5 rad`
orientation probe tolerance, at most 200000 samples total, depth at most 24 per
interval. Conversion fails when those limits, requested accuracy, supported numeric
ranges or strictly increasing FLOAT timestamps cannot be met. Finite probe checks
are not a continuous error proof. The tests separately measure keys and a dense
1201-point off-key grid per motion; see [actual results](validation.md#issue-29-vmd-bone-motion).

## Converter API and CLI

```sh
npm run convert -- tests/fixtures/bdef.pmx output/motion.glb --mode bdef --scale 0.2 --vmd tests/fixtures/motion-a.vmd --vmd-map tests/fixtures/motion-a-map.json --vmd-morph-unmatched ignore
npm run convert -- tests/fixtures/vpd-wedge.pmx output/motion.gltf --mode bdef --scale 0.125 --vmd tests/fixtures/motion-b.vmd --vmd-map tests/fixtures/motion-b-map.json --vmd-morph-unmatched ignore
```

API: `convertModel(model, directory, {mode:'bdef', scale, vmd:bytes,
vmdBinding:{mapping,unmatched}, vmdSampling:{translationTolerance,
rotationTolerance,maxSamples}})`, or `convertPMX(input,output,options)`.
CLI options: `--vmd`, `--vmd-map`, `--vmd-unmatched error|ignore`,
`--vmd-translation-tolerance` (meters), `--vmd-rotation-tolerance` (radians),
`--vmd-max-samples`. Unsupported static mode, SDEF/QDEF and simultaneous VPD/VMD
conversion fail clearly. No implicit VPD/VMD composition. GLB and unpacked glTF
retain original rest, inverse binds, exact source identities, material resources,
source comments and attribution added by the asset preparation path.

## Three.js APIs and ownership

Use the lockfile's Three.js `0.186.1`. For direct bytes:

```ts
import { createVPDRig } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
const rig = createVPDRig(gltf.scene); // validated converter original-rest metadata
const binding = bindVMD(rig, parseVMD(bytes), { mapping, morphUnmatched: 'ignore' }); // explicit legacy partial playback
console.log(binding.unmatched, binding.unmatchedMorphs, binding.omitted);
const player = createVMDPlayer(rig, binding);
player.loop = true;
player.play();
player.update(deltaSeconds); // nonnegative finite elapsed seconds from application loop
player.pause();
player.seek(0.371); // seconds, fractional, clamped to [0,duration]
player.stop(); // paused, time zero, ORIGINAL rest (not first key)
player.reset(); // synonym for stop
player.dispose(); // idempotent; stops/releases ownership, leaves current pose
```

For a converted GLB/glTF, register `parser => new MMDVMDPlugin(parser)` alongside
Toon/Outline as desired, then get the players using `getVMDPlayers(gltf)`.
The plugin validates schema semantics, node references and corresponding fallback
channels before loading players. It does not start motion automatically. No
private Three.js patches or general animation/solver framework are used.

All model-scoped values resolve before mutation. Public bound handles cannot be
reused on another model instance. Play/seek takes ownership and pauses a previous
VMD owner; applying/resetting VPD pauses and releases motion automatically. After
VPD, play or seek re-evaluates VMD from original rest. Stop/reset also claims the
model before restoring rest. Dispose releases its own ownership and does not reset
another owner's pose. Core `AnimationMixer`/other external writers must be stopped
by the caller before VPD/VMD ownership; do not mix in a fallback from another load.
Matrices, skeletons and skinned bounds are refreshed after every write. Outline
meshes use the same joints and the existing outline effect's skin path.

The Demo supports both original motions on both rigs, local VMD byte files,
binding/unmatched diagnostics, converted GLB/glTF samples, time entry, play/pause,
loop and original-rest reset. A failed parse/bind leaves the active state unchanged.
Changing rigs/motions disposes old players; model replacement and page teardown
release outline/material/geometry resources. VPD remains available on the same rigs.

## Vertex morph weights (Issue #31)

PMX type-1 vertex offsets now convert in both static and BDEF modes to additive
core `POSITION` targets. The pinned binary parser reflects offset Z together with
base positions; conversion scales each delta exactly once. All material primitives
share source order and zero default weights. Normals remain the authored base
normals (including the existing surface/outline skin-normal conventions); no
normal recomputation or NORMAL targets are invented. Repeated offsets at a vertex
add. Invalid counts, references, vector lengths, nonfinite values and FLOAT overflow
reject conversion. Bone, UV, material, group/flip and impulse morphs remain
unsupported; they have `target:null`, with source index/name/type loss diagnostics,
rather than fake zero-effect targets. Advanced skinning, solvers, physics and
representative fidelity remain outstanding.

The mesh node's `extras.pmxMorph` version 1 stores a model ID and every exact
`{index,name,englishName,type,target}` identity. Targets are contiguous in source
order. Display dictionary names include source indices because Three.js overwrites
duplicate dictionary names; dictionaries never establish binding identity.
`getMorphModel(createMorphRig(gltf.scene))` returns a defensive snapshot. One
model per handle is required, and every loaded material primitive is validated.
Model IDs agree with original bone metadata in BDEF mode.

VMD morph records have a fixed 15-byte Shift_JIS name, uint32 frame and FLOAT
weight, with no bone interpolation bytes. `morphMapping` is a **separate** hex
byte-name → source PMX morph index object. Japanese exact names bind automatically
only when unique; duplicates, full-width/truncated or undecodable names require
explicit mapping. Invalid keys/indices, target collisions, inconsistent byte
identity and duplicate bound frames fail. `morphUnmatched:'ignore'` explicitly
permits missing/unsupported families and reports `unmatchedMorphs` plus omitted
record counts; ambiguity still fails. The default is error. Existing `motion-a`
and `motion-b` bytes retain their `unused morph`; legacy callers explicitly ignore
and report it. `omittedRecords()` is a raw section inventory; a binding's
`omitted.morphs` counts only records not executed.

Scalar interpolation is linear at frame/30, nearest-key clamping before/after
track endpoints, including nonzero first frames and single keys. Duplicate-bound
frame rejection, endpoint clamping and zero for untracked owned targets are
**project policies**, not measured original-MMD behavior. Weights are independent
additive scalars, including negative values and sums greater than one: no
normalization or silent clamp. Supported weights are finite scalars in `[-10000,10000]`, matching the existing
Outline renderer profile. POSITION deltas must have finite FLOAT rounding
(magnitude up to approximately `3.402823466e38`); the Outline loader additionally
limits decoded geometry magnitude to `1e8`, as in its existing contract;
converted values are FLOAT, so quantization still applies. Weight output is capped
at one million scalars per channel to bound allocation. Frames are uint32.
Distinct source times that collapse to one FLOAT timestamp reject conversion.
Duration includes every executed bone and morph track; morph-only VMD requires
zero bone records, not dummy keys (BDEF model rest is retained).

`MMD_animation_vmd` v0.2 adds payload version 2 with core LINEAR weight sampler
references; bone-only payload version 1 remains readable. Weight outputs are
SCALAR, key-major arrays of `keyCount * targetCount` values. Union key times and
zero include clamped values for each independent target. The loader checks node,
sampler, FLOAT accessor, count/layout, timestamp order, target widths and default
scene membership before exposing a player. It reuses core weights rather than
duplicating them as extension keys. The complete fallback (bones **and** weights)
is removed from returned clips, preventing either property family from being
driven twice. Ordinary GLTFLoader still has usable TRS and weight channels.

```ts
import { createMorphRig, getMorphWeights, applyMorphWeights,
  resetMorphWeights } from '../packages/three-mmd-morph';
const morph = createMorphRig(gltf.scene);
console.log(getMorphWeights(morph));
applyMorphWeights(morph, [1.3, 0.9, 0, 0]); // full target-order vector; pauses VMD
resetMorphWeights(morph); // zero baseline; pauses VMD
const binding = bindVMD(rig, parseVMD(bytes), {mapping, morphMapping});
const player = createVMDPlayer(rig, binding);
```

Play/seek restores original bone rest and zero untracked weights before evaluating
both families under one transport. Stop/reset restores original rest and zero
weights, not initial motion keys. Manual weight apply/reset pauses motion.
VPD apply/reset pauses motion and changes bones **while preserving current weights**,
because VPD has no morph channels. Subsequent VMD play/seek replaces weights again.
Parsing, binding and complete pose/weight preparation validate before ownership or
mutation. Failed operations preserve bones, weights, time and the current owner.
Instance handles cannot be reused across loads; disposal is idempotent and releases
only its own owner. Matrices, skeletons and deformed bounds refresh after writes;
static geometry bounds are private to avoid leaking across instances.

```sh
npm run convert -- tests/fixtures/morph-box.pmx output/combined.glb --mode bdef --scale 0.2 --vmd tests/fixtures/combined-a.vmd --vmd-map tests/fixtures/motion-a-map.json --vmd-morph-map tests/fixtures/morph-map.json --vmd-translation-tolerance 2e-8 --vmd-rotation-tolerance 2e-7
npm run convert -- tests/fixtures/bdef.pmx output/legacy.glb --mode bdef --scale 0.2 --vmd tests/fixtures/motion-a.vmd --vmd-map tests/fixtures/motion-a-map.json --vmd-morph-unmatched ignore
```

The built Demo exposes exact-index morph controls, combined and morph-only samples,
local VMD with separate maps/policies, and the existing synchronized transport.
Both Toon and independent PBR instances have their own weights; Outline follows
the same deformation. The VPD reset button preserves weights; the motion reset
button zeros them. Numeric tests compare independent scalar interpolation and
morph-before-BDEF predictions, not emitted samples. See
[fixture provenance](../tests/fixtures/README.md#issue-31-vertex-morph-fixtures) and
[measured validation](validation.md#issue-31-vertex-morphs-and-combined-motion).


Primary representation references: the
[mirrored format-author PMX specification](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt)
describes vertex-indexed offsets; [core glTF morph targets](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#morph-targets)
define additive deltas, common primitive ordering and morph-before-skinning.
[Official Three.js r186 GLTFLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js)
provides the identified target/weight loading behavior. The historical MMDLoader
and identified MMD Tools source cited above support the bounded linear morph
profile, not original-renderer equivalence. No new specification correction was
established for this Issue; the existing FLOAT skin-weight sum SHOULD correction
and stricter converter interoperability policy remain in force.
