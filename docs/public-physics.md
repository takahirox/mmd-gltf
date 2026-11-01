# Public Uka / Gene physics (Issue #77)

The public **Physics** checkbox is Off initially, beside the independent IK
checkbox. Off creates no Ammo module or native world. On runs the source rigid
bodies and joints in three independent worlds: direct PMX, glTF Toon and glTF
PBR. No pane supplies another pane's pose. The renderer, orbit camera, textures,
geometry and three named animations are reused across toggles and motions.

## Real-source audit and runtime choice

Reproduce the complete [source audit](public-physics-audit.json) with
`npx tsx tools/audit-public-physics.ts` after fetching the allowlists. It includes
original body/joint records, normalized frames, all masses, collision groups and
masks, bone bindings, deformation phases/layers, grants, IK links and limits.
The inventory contains all 302 Uka / 224 Gene bones, including unbound motion names. Original PMX bytes and the [Uka](../tools/uka-manifest.json) /
[Gene](../tools/gene-light-manifest.json) pins remain unchanged.

| Source | Bodies | Joints | Sphere / box / capsule | Modes 0 / 1 / 2 | Free linear / angular axes |
| --- | ---: | ---: | --- | --- | --- |
| Uka | 164 | 151 | 1 / 27 / 136 | 27 / 0 / 137 | 12 / 36 |
| Gene Light | 87 | 92 | 1 / 15 / 71 | 25 / 9 / 53 | 8 / 51 |

All joints are type-0 spring 6DoF with two distinct body endpoints. Inverted
lower/upper ranges are valid free axes and preserve that meaning in Bullet
(the angular backend encoding uses lower 1 / upper -1);
equality locks an axis. Both sources have four fixed-axis twist bones. Neither
has soft bodies, impulse morphs, local-axis or external-parent bindings. Gene
has 38 post-physics bones; none binds a rigid body. Uka has no post-physics bones.
The audit retains every deformation record; no body, joint or solver record is
removed to make the model executable.

`createPhysics` plus the generic `physicsDiagnostics` / `solverDiagnostics`, with
a 100 million bone-update audit budget, report exactly four `fixed-axis`
diagnostics per model. The generic solver remains unable to execute these
profiles. The public comparison therefore supplies an explicit host pose
evaluator to `PhysicsWorld`, rather than invoking that solver alongside the
existing ordered preview adapter. `physicsBindingDiagnostics` checks the full
body/joint numeric, reference, ownership and phase dependencies independently.
`validatePublicPhysics` additionally checks the host's supported operation
space/order and disallows fixed-axis IK writes. Unsupported execution disables
Physics with a visible reason; backend failure restores Off and leaves playback
usable.

The equivalent retained-source runtime binding is `extras.publicPhysics` version
1: complete `solver` version 3 and `physics` version 2 contracts. It is separate
from automatic VMD solver ownership. This preserves one mesh/skin/scene and three
exact retained VMD animations without baking simulation into ordinary glTF.
The original PMX bytes are also retained in `extras.mmdSource`. Core animations
remain approximate, raw, solver-free fallback. Runtime validation compares Toon
and PBR metadata and reconstructs the direct loader's body/joint profile to check
it against the transported records, including every original mode and binding.
The loader's bone-relative body positions are converted back to model space;
its mode-2 compatibility rewrite is reversed using `originalType`. All panes
use the original source modes under the same documented project policy.

## Evaluation, clock and lifetime

At each tick, direct PMX samples its own exact source VMD binding; Toon and PBR
sample their own retained VMD players. The direct mixer still supplies supported
vertex expression weights; its bone result is replaced by the exact raw sampler
while Physics is On. No approximate core glTF action runs concurrently. Each evaluator temporarily uses metre-space skeleton arithmetic, restoring PMX rendering units before drawing. Raw and pre-physics backend inputs have a common 1e-7 m / quaternion-component numerical resolution (then quaternion normalization), including consistent floating-point ties. This avoids amplification of unit-conversion roundoff at constrained IK branches and contacts; each pane computes its own pose. Source payloads are unchanged.
Retained rest is restored before adapter capture, including tiny translations
that a core glTF serializer can omit as near-zero defaults.

All four IK × Physics combinations execute. With Physics Off, the existing IK
adapter and its prerequisite-only grant policy remain in effect. With Physics
On, all two Uka / eleven Gene grants execute once, regardless of the IK checkbox;
IK controls only the ten / six chains, also respecting each VMD controller's
switches. Operations follow phase, layer, source index, with grant before IK at
a shared index. Fixed-axis rotation uses normalized quaternion twist projection
on the reflected source axis. These eight source bones are not IK or physics
writers; their authored rotations are projected before their consumers execute.
Pre-physics raw animation/axis constraints/grants/IK precede body synchronization
and simulation; post-physics grants/IK follow writeback. Post-physics child bones
retain their authored local deformation under the resolved parent.

Every source body and joint executes. Mode 0 follows its bone, mode 1 writes the
simulated bone transform, and mode 2 writes rotation while preserving authored
local translation, including under a dynamic parent. Mode-2 body origins are
re-anchored in the resolved hierarchy. Collision filters, shapes, masses,
damping, friction, restitution, joint frames and springs use the common
`createPhysics` policy. Gravity is `[0,-9.80665,0]` m/s², scale 0.08 m/PMX unit,
step 1/120 s, Bullet hidden accumulator disabled, spring damping 1, equilibrium
zero, connected-body collision enabled, and explicit converter collision margins.
Collision masks follow the existing extension contract: `(~groupTarget) & 65535`
converts interpreted source exclusion bits into Bullet inclusion bits. Historical
Three.js and reconstructed MMD implementations instead pass the raw field;
native-MMD filter polarity has not been independently measured. These are
disclosed policy differences, not evidence of original-MMD agreement.
This is a consistent project policy, not an assertion of Windows MMD equivalence.

One requested absolute time drives all panes. The displayed source/physics pose
holds `floor(time / fixedStep)`; there is no interpolation or pane clock. On while
paused replays to that time without advancing it; time zero resolves an initial
state without stepping. Off restores the raw/IK-only pose at the requested time.
Forward ticks reuse worlds. Backward seek, Restart, loop wrap, IK change, motion
change and re-enabling reset/replay from source time zero. There is no call to
`PhysicsTimeline.seek` per animation frame. Duplicate input events for the same
pending target are coalesced.

Replay yields to events after approximately 8 ms, checking cancellation between
complete three-world ticks. No partial tick is drawn. Native worlds are limited
to 256 bodies / 256 joints each and replay to 30 seconds (the clips are 10 s).
A slice exceeding 150 ms fails back to Off with an actionable diagnostic. A
single native step cannot be preempted; slower devices can still exceed the
nominal slice target. During live simulation the shared epoch resumes after
completed work, so an overloaded device slows playback instead of building an
unbounded catch-up queue. Pause cancels pending advancement and resolves the
last published time. Off/model change/unload cancel pending work and destroy
all native handles. The successfully loaded backend module is cached until page
unload; its reserved heap is reused, not allocated again per toggle.

The same-origin Ammo artifact is fetched only on first eligible On, with the
pinned SHA-256 enforced by script integrity and checked by asset generation.
Loading/error state is visible; a failed attempt clears the backend promise for
retry. `readMMDComparisonResources` exposes native allocation counts, world/reset/
step counts, CPU timings, backend heap bytes, renderer memory, scene identities
and browser heap where available. `readMMDComparisonPhysics` exposes independent
body transforms and the source binding. These diagnostics are read-only. Pose arrays serialize IEEE signed zero as zero for exact numerical replay comparisons; original source bytes keep their original bit patterns.

## Validation and physical Android plan

[Node tests](../tests/public-physics.test.ts) verify pins, every body/joint binding,
free-axis retention, generic versus host capability checks, conversion identity,
all IK × Physics combinations, both body clips, deterministic replay, forward
world reuse, tick hold and native teardown. Existing synthetic conformance stays
in place. [Browser cases](../tests/browser/public-physics.spec.ts) exercise real
Uka/Gene source and independent PMX/Toon/PBR transforms and pixels. Measured
results and explicit limits are recorded in [physics validation](physics-validation.md).
The measured post-writeback joint residuals are nonzero and can be large for
Gene counterweights; pane agreement is not an accuracy oracle. See the explicit
[constraint and performance limits](physics-validation.md#real-model-constraint-and-performance-limits).
Original Windows MMD parity is **unverified**.

Physical Android Chrome verification is **unperformed**: `adb devices -l` listed
no connected device in the implementation environment. A desktop viewport of
390 px is only a layout check. Required post-merge physical-device procedure:

1. Record device, Android/Chrome versions, RAM, graphics backend and thermal state.
   Remote-debug Chrome and enable network/performance/memory recording.
2. For both characters, cold-load and warm-load with Physics Off. Record resource
   bytes, first usable frame, errors, JS heap/GPU pressure and responsiveness.
   Confirm no Ammo request/world. Play all three motions and orbit the camera.
3. Pause Laugh at frame 15; enable Physics. Record backend request/initialization,
   replay/slice CPU time, heap, native handles and rendered hair/clothes change.
   Repeat for Apology; compare synchronized source times and dynamic regions.
4. Exercise all four IK/Physics states, Pause/Resume, Restart, backward/forward
   seek, loop crossing, A→B→A, Rest/manual expressions, Toon/PBR, Outline and orbit.
   Repeat ten On/Off cycles and switch models while a replay/backend load is
   pending. Confirm handles return to zero on Off and model/texture requests do
   not repeat during toggles/motion changes.
5. Block/corrupt the Ammo response in remote debugging. Confirm Off remains usable,
   visible failure, and successful retry after restoring the resource. Navigate
   away during replay; verify teardown and no accumulating native allocations.
6. Capture screenshots, timings, network counts and memory before/after GC. If
   work budgets are exceeded, record the diagnostic and recovery; report that
   device as unsuitable for Physics On rather than claiming mobile support.
