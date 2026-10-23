# VMD bone-motion contract

Issue #29 adds VMD 0002 solver-free translation/rotation through PMX BDEF conversion,
retained glTF curves, reusable Three.js playback and the built `rig.html` Demo.
It does not complete MMD reproduction. Morph, camera, light, shadow and display/IK
**execution**, advanced skinning, morph deformation, append/IK/deformation ordering,
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

The optional [MMD_animation_vmd v0.1 draft](../extensions/MMD_animation_vmd/README.md)
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
npm run convert -- tests/fixtures/bdef.pmx output/motion.glb --mode bdef --scale 0.2 --vmd tests/fixtures/motion-a.vmd --vmd-map tests/fixtures/motion-a-map.json
npm run convert -- tests/fixtures/vpd-wedge.pmx output/motion.gltf --mode bdef --scale 0.125 --vmd tests/fixtures/motion-b.vmd --vmd-map tests/fixtures/motion-b-map.json
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
const binding = bindVMD(rig, parseVMD(bytes), { mapping });
console.log(binding.unmatched, binding.omitted);
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
