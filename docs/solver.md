# Pre-physics IK and append

Issue #43 adds the optional [solver contract](../extensions/MMD_skeleton_solver/README.md).
Existing conversion remains solver-free by default, including its loss reports.
Enable the bounded profile explicitly:

```sh
npm run convert -- model.pmx model.glb --mode bdef --solver pre-physics-v1
npm run convert -- model.pmx model.gltf --mode qdef --solver pre-physics-v1 --vmd motion.vmd
```

The API accepts `{mode: 'bdef'|'sdef'|'qdef', solver: 'pre-physics-v1'}` with
existing VPD/VMD and sampling options. Validation precedes filesystem output;
malformed or unsupported execution fails, with bone/link indices. Legacy output
retains original solver records in root `sourceSolvers`, including flags/layers,
IK identities/links/limit arrays and append data. This does not imply execution.
No simulation, post-physics, external-parent or general multi-axis solver support.

```ts
const loader = new GLTFLoader()
  .register(p => new MMDSolverPlugin(p))
  .register(p => new MMDVMDPlugin(p));
const asset = await loader.loadAsync('model.glb');
const rig = createVPDRig(asset.scene);
applyVPD(rig, bindVPD(rig, parseVPD(poseBytes, 'utf-8')));
const player = createVMDPlayer(rig, bindVMD(rig, parseVMD(motionBytes)));
player.seek(0.371); // original raw inputs → solver → matrices/palette/bounds
player.setIKEnabled(3, false); // explicit instance-local controller override
player.setIKEnabled(3, undefined); // follow motion again
console.log(player.ikStates);
```

Import the solver plugin from `packages/three-mmd-solver`, the motion APIs from
`packages/three-mmd-vmd`, and pose APIs from `packages/three-mmd-vpd`. The pure
`packages/mmd-solver` evaluator depends only on data and scalar maths. Solver
metadata survives without PMX extras when the loader plugin is installed; VPD
then treats translations as metres (one metre/unit), and explicit mappings use
stable profile identities. Converted PMX assets retain their original scale/name
binding metadata. Register the existing SDEF/QDEF plugins for those skinning paths.

Applying/resetting VPD releases active motion, resolves from original rest and
preserves morph weights. Seeking/playing reclaims motion ownership and replaces
the complete pose/owned morph weights. Stop/reset solves original rest rather
than treating current output as input. Bindings belong to a single model instance;
preparation validates before claiming ownership or writing. Disposal releases
ownership and retained references. Loading a solver extension does **not** solve
already resolved core node TRS a second time.

## IK controls and VMD transport version 3

VMD controllers default enabled before their first control. Each named control
holds until the next record for that controller. Keys are right-continuous:
a key at frame 15 takes effect at exactly 0.5 seconds. Bone curves remain
continuous destination-key curves. Controllers bind by exact decoded Shift_JIS
20-byte name, independently of bone-track bindings. Full/truncated/undecodable
names require `ikMapping` (hex byte-name key → stable controller index).
Duplicate target controls within a display frame, duplicate display frames,
ambiguous names and invalid flags fail. Unmatched controls fail by default;
`ikUnmatched: 'ignore'` explicitly preserves/report them without execution.
Solver-free legacy assets continue preserving/reporting all IK controls as omitted.

Version 3 carries `solver`, `ik` and `visibility` in addition to original rest,
raw bone curves and optional core weight samplers. Its embedded solver must match
the root extension by stable bone identity and values. JSON property order and
bone-table order are immaterial; IK link order remains significant. `visibility` retains frame, visible flag and original
display/IK record bytes; it never hides the model. The schema and semantic validator
check references, chronology and binding consistency. The duration includes
control/visibility endpoints. All solver-profile bones have both translation and
rotation fallback channels, including untracked IK and append destinations.
The exact plugin replaces the complete matching animation with an empty core clip
and exposes its exact player through `getVMDPlayers(asset)`.

## Approximate core fallback

Adaptive LINEAR samples probe endpoints and quarter points, including FLOAT
quantization. Default translation tolerance remains 2e-6 m, rotation 2e-5 rad,
and global `maxSamples` 200000. Solver output is sampled after solving, not by
interpolating already solved source keys. All raw key times, start/end and IK
control boundaries seed sampling. Finite probes provide **no continuous guarantee**.

A discontinuous IK switch cannot be represented exactly by a core LINEAR sampler.
The fallback explicitly approximates the switch over the immediately preceding
FLOAT interval, with exact on/off values at its endpoints. The maximum interval
width is `controlTimeTolerance` (default 1e-6 seconds). Orientation/position
error tolerances apply outside that disclosed seam, not within it. Boundary keys
must themselves be exactly representable FLOAT seconds; otherwise conversion
rejects the request. Smaller temporal limits than the preceding FLOAT interval,
unrepresentable spatial/angular accuracy, collapsed timestamps or insufficient
sample budgets also fail. Exact playback always switches at the mathematical key.
Tests probe the boundary, predecessor and both sides; ordinary-loader observations
near a seam are reported as approximation, never original-MMD fidelity.

## Demo and evidence

The built `rig.html` includes solver box/wedge presets, both motions, both poses,
bytes/GLB/glTF sources, transport, controller state/override and applied-state
GLB/glTF export. Export plugins retain original rest plus the solver contract;
reload does not solve an applied state again. Both geometries and hierarchies
differ: the wedge append bone inherits the root, while the box append bone is a
separate root. Surface, Outline, BDEF, SDEF, QDEF and group weights all observe
the resolved joint revision. The [validation record](solver-validation.md)
separates analytical/numerical, rendered and optional original-MMD evidence.
