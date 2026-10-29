# MMD_physics

## Version 2: source transport

Version 2 separates retained physics data from executor capabilities. Inverted
joint bounds denote free axes and retain their original values. Larger counts,
multiple writers, cross-phase dependencies, other joint types, impulse morphs
and soft bodies can transport without claiming simulation support. It accepts
solver versions 2/3. See [source transport and execution](../../docs/source-transport.md)
for the new fields, diagnostics, configurable runtime budgets and comparison evidence.
Version 1 retains its bounded serialized meaning; the following version-1 caps
and dependency exclusions do not define MMD source validity.

Draft optional root glTF extension, version 1, `rigid-body-v1` project profile.
It requires [MMD_skeleton_solver version 2](../MMD_skeleton_solver/README.md).
It has no dependency on PMX extras, skinning, meshes, or material extensions.
[Schema](schema/glTF.MMD_physics.schema.json), [minimal glTF](examples/minimal.gltf)
and [invalid fixtures](tests/invalid.json) run in `npm test`. Semantic validation
also checks references, dependencies, quaternion lengths and ordered limits.
Core joint TRS and animation contain resolved output for ordinary loaders.
Loading this extension never starts simulation or overwrites the core snapshot.

## Scope and references

The [format-author PMX document](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
defines body fields, exclusion bits, coupling modes, type-0 joints and deformation
phases. It describes format/editor behavior, not measured original-MMD execution.
[Core glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines
metres, node TRS, skins and sampled animation. Historical official
[MMDPhysics](https://github.com/mrdoob/three.js/blob/r169/examples/jsm/animation/MMDPhysics.js)
is an integration reference; its gravity and timing heuristic are not adopted.
The equations and numerical policies below are **project policies**.
Original-MMD fidelity, including mode 2 and springs, is unmeasured.

Preserved correction: old assumption: local append is ignored when its source
also appends. Corrected requirement: local append takes priority. Source: the
[author's 0216b amendment](https://kkhk22.seesaa.net/article/312703073.html).
Rationale: this amendment supersedes the struck-through exception; local editing
axes are separate. Original-MMD adoption remains unresolved.

Collision reconciliation: old assumption considered during implementation: pass the
parser field `groupTarget` directly as Bullet's collision inclusion mask.
Corrected requirement: raw PMX bits are **exclusions**; use `(~raw) & 65535`.
Primary reference: PMX body record's `非衝突グループフラグ`. Rationale: Bullet
requires inclusion bits. Tests feed raw bits through actual conversion and
Bullet contact filtering, including asymmetric masks and group 15. No claim
about historical MMD's implementation follows from the parser field name.

## Contract

All arrays have explicit length and finite FLOAT-representable numbers. There
are no inferred bodies or implicit endpoints. Maximum: 1,024 bodies, 4,096 joints;
identities are unique integer 0..65535 in each respective table. Root fields:

| Field | Meaning |
| --- | --- |
| `version` | 1 |
| `gravity` | Explicit model-space acceleration in m/s² |
| `fixedStep` | Seconds per simulation tick, 1/240..1/30 |
| `bodies` | Nonempty body table |
| `joints` | Possibly empty joint table |

Bodies and joints are inserted in serialized array order (PMX source order). That
order is part of reproducible simulation and is preserved on export. Body-driven
bones are applied in hierarchy order, with parents resolved before children.

Every body requires these fields:

| Field | Meaning |
| --- | --- |
| `index`, `name` | Stable body identity and exact source name; PMX ordinal retained |
| `bone` | Solver bone identity, or -1 for unbound model-space body |
| `mode` | 0 bone-driven kinematic; 1 dynamic bone writer; 2 dynamic rotation with bone-position alignment |
| `translation`, `rotation` | Body frame **relative to original-rest bone world frame**, XYZW unit quaternion; unbound uses model frame |
| `shape`, `size` | `sphere`: [radius,0,0]; `box`: half extents [x,y,z]; `capsule`: [radius,cylinderHeight,0], local +Y axis |
| `group`, `mask` | Group index 0..15; unsigned 16-bit **inclusion** mask. Both bodies must include the other's group |
| `mass` | Kilograms; nonnegative; modes 1/2 require positive mass; mode 0 uses zero simulation mass |
| `linearDamping`, `angularDamping` | Bullet exponential damping parameters, [0,1] |
| `friction`, `restitution` | Nonnegative Bullet friction; restitution [0,1] |
| `margin` | Metres, nonnegative and <= minimum box half extent or capsule radius; spheres require their radius as Bullet margin |

Each joint requires `index`, `name`, `type:0`, distinct existing `bodyA`/`bodyB`,
`frameA`/`frameB` (each `{translation,rotation}` relative to the respective
original body frame), `linearLower`, `linearUpper` in metres, `angularLower`,
`angularUpper` in radians [-pi,pi], and nonnegative `linearSpring`/`angularSpring`.
All six limit/spring fields are XYZ triples. Lower <= upper; equality locks
an axis. Inverted/free-axis interval encodings are outside this profile.
Joint frames are independent of the current pose. Linear reference frame A is
used. Nonzero stiffness enables that axis; equilibrium is explicit zero in
joint coordinates and spring damping is 1. Connected bodies retain collision
filtering (joint creation does not silently suppress contacts).

## Import and units

Opt in with `{physics:'rigid-body-v1',mode:'bdef'|'sdef'|'qdef'}` or
`--physics rigid-body-v1`. This selects solver v2 without changing legacy
solver-free or pre-physics-v1 behavior. `physicsSettle` / `--physics-settle`
(default 0, maximum 30 seconds) resolves static/VPD snapshots. Both GLB and
external-buffer glTF use the same writer. Validation finishes before output.
Malformed counts, references, unsupported kinds and ambiguous writers fail with
body/joint/bone indices. Impulse morphs, soft bodies, external parents, fixed-axis
solver dependencies and general multi-axis IK remain explicit exclusions.

Both PMX readers call pinned mmd-parser 1.1.4's `leftToRightModel` exactly once.
Physics API inputs must explicitly declare `metadata.coordinateSystem:'right'`;
use `parsePMX` to get that state. Positions already reflect Z. Euler X/Y are
already negated; reflected linear Z and angular X/Y limit endpoints have already
been negated and swapped. Never repeat these operations. Import uses XYZ Euler
composition, metres-per-unit scale s on positions, half extents, radius, cylinder
height and linear limits. Bone-rest transforms determine body offsets and
original body transforms determine joint-local frames. These are immutable.
Mass stays unchanged; Bullet computes shape inertia in kg·m². Damping, friction,
restitution and linear spring stiffness are passed unchanged. Angular spring
stiffness scales by s² (mass-preserving torque unit conversion). These mappings
are unmeasured dimensional policies, not an original-MMD calibration. PMX FLOAT
pi canonicalizes to mathematical pi. Sphere margin is its radius; capsules use min(0.004 m, 0.1 × radius), and boxes use min(0.004 m, 0.1 × minimum half extent). Box dimensions retain outer half extents
when Bullet's margin changes. Capsule height excludes its two hemispheres.

## Phases and coupling

Sample **raw** inputs from original rest; evaluate pre-phase append/IK; update
bone-driven bodies; step Bullet; write body-driven bones; evaluate post-phase
append/IK; refresh hierarchy, skeleton palettes and bounds. Surface, outline,
CPU vertex queries and snapshot export then use those same node transforms.
Never solve a resolved pose again or run an AnimationMixer over the same bones.
Retained VMD players consume raw curves and replace complete fallback clips.

Let B be a bone world transform and O its immutable body offset. Mode 0 writes
`body=B*O`. Mode 1 writes `boneWorld=body*inverse(O)` and converts through the
**currently resolved parent** to local TRS. Multiple body writers on one bone
fail. Mode 2 uses the simulated body rotation to recover bone rotation, keeps
the sampled animated bone world origin, and aligns body center to
`animatedBoneOrigin + simulatedBoneRotation*O.translation` before and after a
tick. It clears linear velocity on alignment and retains angular velocity.
Unbound bodies simulate and participate in contacts/joints but never write a
bone; unbound mode 0 is fixed in model space. Model placement is outside the
physics frame. Rigs require unit local scales; no sheared physics frames.

Writer bones must be plain pre-phase bones. A pre-phase append cannot consume a
body writer (including writer ancestry for local append). Such consumers must
be post-phase. IK cannot rewrite body writers, cross phases, or post-phase
ancestors of body writers. Existing bounded IK/append restrictions still apply;
unsupported dependencies fail before runtime ownership is registered.

## Clock and lifecycle

Imported default gravity is [0,-9.80665,0] m/s², step 1/120 s. The timeline owns
absolute requested time and the fractional remainder. For time t, evaluate
floor(t/h) complete ticks, sampling motion at each tick. Tick 0 initializes from
raw pose with zero velocities/forces. Fractional display holds the last complete
tick; no extrapolation or hidden Bullet interpolation. Bullet receives
`stepSimulation(h,0,h)`, disabling its internal accumulator. A tiny 1e-9 tick
roundoff allowance handles ordinary floating-point frame partitioning.

Every seek builds a candidate world and resets/replays at most 3,600 ticks from
zero. Replay also caps cached input at 1,000,000 bone poses and estimated solver work at 20,000,000 bone updates; smaller models can use longer histories. Validation and budget failures preserve visible state; native initialization
failures dispose the candidate. The previous world is released only after
successful resolution. Forward/backward seeks never simulate negative delta.
An update may request at most 240 ticks; larger deltas fail, with no dropped time.
Pause holds time; resume continues requested time; stop/reset initializes original
rest. Looping resets/replays the wrapped motion time. VPD apply/reset releases
motion ownership, clears velocities/forces by constructing a new world, and
initializes from that raw pose. `PhysicsRig.step(seconds)` settles the current
VPD/rest pose explicitly. After motion, stepping freezes its last sampled raw pose, starts a new static history, and returns IK controls to pose defaults. Reset repeats the stored raw pose without accumulating results.
Changing the enable flag takes effect on the next seek/reset; disabled physics
still solves ordered pre/post deformation. Pose and motion sessions are exclusive.

`PhysicsRig.dispose()` is idempotent: remove constraints, remove bodies, destroy
all owned constructed native handles in reverse order and release model references
and ownership. Borrowed Ammo getters are never destroyed; their JavaScript binding-cache wrappers are evicted when their owner is disposed. The artifact IDL marks transform.getRotation() as an allocating value return; the implementation avoids it by reading a borrowed basis into an owned quaternion. Worlds do not share
bodies, constraints or scratch memory. The caller owns the loaded Ammo module;
Node retains one explicitly requested module for process lifetime because this
artifact installs process handlers. Browser callers may reuse one module across
isolated rigs. Async backend failure registers no rig owner.

## Fallback and export

Physics VMD conversion samples every simulation tick into core LINEAR TRS for
every bone, retaining raw motion in MMD_animation_vmd v4 with solver v2. Legacy
payload versions retain their meanings. Ordinary core interpolation between ticks
differs from the live last-tick hold. The numerical report measures finite
between-tick probes; there is no continuous interpolation guarantee. Existing
nonphysics adaptive tolerances are unchanged. Morph/group weights keep their
existing independent LINEAR channels.

Register `MMDPhysicsExporterPlugin` alongside the existing pose and SDEF/QDEF
exporters. Export writes **the applied snapshot**, immutable original rest,
bodies and joints. It exports no velocities, forces, time accumulator or native
solver state. Reload preserves the visible snapshot and never double-simulates.
Explicit simulation enabling starts a new run from original raw rest/motion/pose;
it does not resume a checkpoint.

See [backend provenance](backend.json), [license](BACKEND-LICENSE.txt),
[runtime usage](../../docs/physics.md) and
[measured Node evidence](../../docs/physics-node-validation.json).
