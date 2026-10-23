# MMD_animation_vmd v0.1 (draft)

An optional, runtime-independent **animation-level** extension retaining solver-free
VMD bone curves, alongside approximate core glTF TRS fallback. It is independent
of Toon, Outline and PBR. This is a project proposal, not a Khronos ratified extension.

The [schema](schema/animation.MMD_animation_vmd.schema.json),
[valid example](tests/valid.json) and [invalid fixtures](tests/invalid.json) are
checked by `npm test`. Semantic validation additionally checks unique/in-range
node references, unit quaternions, key ordering and numeric limits. The converter
builds complete examples for both rigs and motions in `public/vmd` with `npm run build`.
The self-contained [minimal glTF example](examples/bone-curve.gltf) animates one
original synthetic triangle joint with retained curves and sampled core TRS;
`npm test` validates and reloads it without PMX/VPD metadata or material drafts.

`version` is required and equals `1`. `rest` lists every joint owned by this
motion as `{node, translation, rotation}`. `node` references the root glTF node
array, never a display name. Rest translation is in meters, rotation is XYZW in
glTF coordinates. Rest is ORIGINAL local rest, even when loading a posed asset.
Scale defaults to `[1,1,1]`; only unit-scale TRS joints are supported. No matrix
nodes. Rest entries and track targets are unique. A track target must appear in
rest. Nodes must belong to the default scene. No cross-model retargeting is implied.

`tracks` contains `{node, keys}`; each key contains `frame`, `translation`,
`rotation` and `curves`. Frames are integers in `[0, 4294967295]`, sorted strictly
increasing. Seconds = frame / 30. Translation/rotation are **absolute local glTF
TRS** after reflecting source Z once, scaling source translation once and
composing original rest. They are not additional offsets. Quaternion values
must be finite and unit length within `1e-5`; evaluation normalizes and uses
shortest-path slerp. Rotations `q` and `-q` are equivalent.

`curves` has four control points sets, in X/Y/Z/rotation order. Each is
`[x1,y1,x2,y2]`, integer byte values `[0,127]`, divided by 127 to get normalized
control points. Endpoints are `(0,0)` and `(1,1)`. The **destination** key owns
each positive interval's curves. Solve Bezier X(s)=normalized time, then use
Bezier Y(s) as interpolation weight. Translation axes use separate weights;
rotation uses a fourth weight for quaternion slerp. At/before first and at/after
last key clamp to the nearest key, including nonzero first frames and single
keys. This continuous profile includes adjacent frames. Continuous adjacent
frames, endpoint clamping and duplicate rejection are project policies whose
original-MMD equivalence remains unresolved. No adjacent-frame hold heuristic.

All fields are required, except implicit unit scale. All numbers must be finite
and representable in FLOAT; quaternion/curve/order restrictions are semantic.
Limits: 65536 owned joints, one million total retained keys. An implementation
must validate the complete payload before mutation. Untracked owned joints are
restored to original rest during every evaluation. Stop/reset restores all rest
entries, not the first motion key.

The containing animation MUST have exactly one core translation and one rotation
channel for each track target, and no other channels. An extension-aware consumer
**replaces the entire corresponding fallback animation**, never plays both.
The supplied GLTFLoader plugin returns an empty-track clip in `gltf.animations`
and exposes a VMDPlayer through `getVMDPlayers(gltf)`. Ordinary loaders ignore the
optional extension and play core channels. Do not manually mix a fallback from a
separate load with the exact player on the same model. Each motion exclusively
owns its listed joints; starting another player pauses the previous owner.

Core fallback uses adaptive LINEAR samples with default probe tolerances `2e-6 m`
and `2e-5 rad`, checked at endpoints and quarter points in each candidate interval
including FLOAT input/output rounding. This is finite sampling, not a continuous
error proof. Keys and zero are included. Strictly increasing FLOAT timestamps,
per-key quantization error and a global 200000-sample budget are checked; failures
reject conversion. Requested tolerances must be finite/positive, sample limits
1..200000. Duration is the last bound frame/30; a zero-duration motion is legal.

[Reader, APIs, name handling and CLI](../../docs/vmd.md) ·
[Actual validation results](../../docs/validation.md#issue-29-vmd-bone-motion)
