# Physics validation

## Collision-mask revision (Issue #77)

PMX `groupTarget` now passes unchanged to Bullet. Previous complementing reversed
collision eligibility. The regression uses independently specified asymmetric
floor/ball masks, including group 15, and controlled overlaps of actual Uka torso
0 / dynamic collider 25 and Gene torso 0 / dynamic collider 19. Those contacts
must separate with source filters and remain stationary with the wrong polarity.
Gene’s nine original counterweight colliders additionally remain stationary with
zero filters and separate when their dynamic filters are deliberately inverted.
Pinned source bytes, shapes, masses, material coefficients and groups are retained.
Uka's 23 and Gene's 24 all-eligible kinematic filters remain 65535; Gene's nine
source-zero filters remain zero.

[Mask revision evidence](physics-mask-revision.json) preserves the historical
corrected-mask checks and the excessive joint errors that motivated the subsequent
joint correction below. It is not evidence for the final stabilized runtime.

## Public real-model integration (Issue #77)

### IK-transition acknowledgement revision (Issue #77)

Hosted run `41380557834` passed 106 browser cases but failed both real-model
lifecycle cases while polling `execution.ik` for five seconds, before waiting
for physics replay. Execution diagnostics describe the last completed pose;
changing IK resets and asynchronously replays all three native worlds before
publishing the new execution result. Reporting the checkbox value immediately
would misrepresent that completed execution.

On the unchanged runtime, a local Chrome/SwiftShader measurement with 2× CPU
throttling reproduced the ordering problem for Laugh at frame 15 in both models:

| Model | Still simulating with previous IK-On result | First observed completed IK-Off result |
| --- | ---: | ---: |
| Uka | 8.142 s | 9.150 s |
| Gene | 5.109 s | 6.116 s |

The completed result was Physics On with zero executed IK chains in each of
the three independent panes. These are sampled wall times including polling
and browser automation, not isolated simulation timings or Android evidence.

The lifecycle test now waits for replay completion using its existing 90-second
physics allowance before checking actual IK execution, every pane's executed
chains and unchanged source time. IK-On transitions use the same ordering,
including Gene Apology's synchronous unavailable result. Transition timings and
pending/completed execution are attached to the existing browser evidence.
Subsequent lifecycle replay waits use that same completion allowance rather
than an implicit five-second poll. Runtime reporting, the device work budget,
test-case timeout, source pins and all pose/pixel/joint accuracy gates stay
unchanged. Hosted required CI must pass after downstream publication; this fix
node does not push or merge. Physical Android post-merge verification remains
pending.

Local validation on 2026-11-02 passed: `npm run build` (existing large-chunk
warning), `npm run typecheck`, all 185 `npm test` cases, all eight
`public-physics.spec.ts` browser cases (622.761 s, no failures/skips),
`npm run check:links` (529 targets) and `git diff --check`. The browser run used
Chrome 156.0.8078.74, Playwright 1.56.1, one ANGLE SwiftShader worker, Apple M4
Max / Darwin 27.2.0 and Node 26.12.1, with `MMD_PREVIEW_PORT=43280` to preserve
the existing server on 43180. In that unthrottled run, Uka's four IK transitions
took 5.113–5.261 s; Gene Laugh's Off/On transitions took 4.063 / 4.087 s.
Completed IK-Off snapshots had zero executed chains in every pane; re-enabling
IK restored all ten Uka / six Gene chains. Both full lifecycle cases completed
their subsequent joint, playback, resource-reuse and native-cleanup assertions
with no page errors and zero native handles after Off. These local checks do
not replace required hosted CI on the published revision.

### Replay work slicing revision (Issue #77)

The seven public-physics failures in hosted run `41374803651` exceeded the existing
150 ms slice budget after yielding only between complete pane operations. A local
Chromium CPU profile of Gene Laugh at 0.5 s identified joint position stabilization
as the largest simulation cost. The unsliced replay took 2719.8 ms of measured
work, with a 55.5 ms maximum slice on this Mac; this faster environment did not
reproduce the hosted budget failure. Sampling, native initialization and simulation
now expose separate accumulated CPU, maximum checkpoint cost and call counts.

The host yields after source sampling, native stepping and each complete
stabilization iteration, in addition to pane initialization. It retains the same
128-iteration cap, early convergence rule, numerical operations and source order.
No source body/joint is omitted, no budget or accuracy assertion is relaxed, and
partial ticks remain hidden. Generation checks after every awaited checkpoint
prevent cancelled work from resuming against disposed or replacement worlds.
Synchronous users drain the same generator without event waits. Temporary vectors,
quaternions and the linear block matrix are reused within each joint row instead
of allocating them on every iteration; all numerical operations retain their order.

An initial sliced Gene profile reached On at frame 15: sampling 222.3 ms total /
5.4 ms maximum checkpoint, three world initializations 38.7 / 19.8 ms, simulation
2464.6 / 34.1 ms, and maximum slice 34.1 ms. Total work remained comparable
(2725.6 ms); the improvement is bounded interruption opportunities, not a claim
of faster simulation or realtime playback. Profiling used local Chromium with
ANGLE SwiftShader and the dev build; hosted checks remain necessary after
publication. These timings are observations, not universal device guarantees.

A synthetic native regression compares sliced and synchronous poses and body
transforms exactly at every tick, then interrupts inside stabilization and checks
native cleanup. The existing real-model stale-initialization-error regression
still replaces a request after native allocation, accounting for the new sampling
checkpoint. All original real-model joint, replay, lifetime and browser assertions
are retained.

An additional 4× Chromium CPU-throttling stress check reached On for Gene Laugh
at frame 15 (maximum slice 118.7 ms). Uka still exceeded the unchanged cap in the
combined pre-physics/native-step portion (189.9 ms), recovered visibly to Off and
released all native handles. Its maximum stabilization checkpoint was 7.1 ms;
world initialization peaked at 83.6 ms and source sampling at 25.7 ms. Individual
native operations remain synchronous and can exceed the device budget; this
stress result does not establish Android performance or universal device support.

Final local validation used Apple M4 Max / macOS Darwin 27.2.0, Node 26.12.1,
Chromium 141.0.7390.37, Playwright 1.56.1 and one ANGLE SwiftShader worker.
`npm run build` (existing large-chunk warning), `npm run typecheck`, all 185
`npm test` cases, all 12 public/synthetic physics browser cases (766.0 seconds),
529 link/anchor/built-asset checks and whitespace validation passed, with no
failures or skips in the final runs. The full Uka/Gene lifecycle cases measured
maximum slices of 45.3 / 30.3 ms; maximum stabilization checkpoints were 1.8 /
1.1 ms. Browser assertions and timeouts are unchanged. Initial slicing-only
browser attempts timed out on Uka's five-second IK-transition wait and were
interrupted; scratch-object reuse preceded the successful full rerun.
Hosted current-head browser shards and aggregation remain for downstream
publication; this fix node does not push. Required physical Android post-merge
verification remains pending.

### Continuation integration and device attempt (2026-11-02)

The saved whole-clip gate was published, then integrated with main at `e880fcb`,
preserving its four-shard browser CI and strict coverage aggregation. The new
`public-physics.spec.ts` suite is explicitly assigned to shard 4. A stale example
copy assertion was updated to require default-Off behavior, lazy backend loading
and the unsupported whole-clip reason; all rendering and accuracy assertions stay
intact. The corrected WebGL example case passed locally (39.8 seconds).

On integrated implementation `3ff77e0`, build (existing large-chunk warning),
typecheck, all 184 Node tests, 527 links and whitespace passed. An initial Node
attempt ran before generated fixtures were ready and failed on missing assets;
the complete post-build rerun passed. Hosted validation results are recorded on
PR #79 separately from these local checks. Its first integrated full run passed
99 browser cases, failed nine and skipped two optional native-WebGPU cases.
One failure was the stale copy assertion; all eight public physics cases exceeded
the unchanged 150 ms work budget on Ubuntu. That run measured the public physics
suite at 680.135 seconds (including failure waits), assigned to shard 4.

Replay now checks cancellation and yields between pane world construction and
simulation operations, while keeping the entire partial tick hidden. Previously
all three constructions and resolves could exceed the slice budget together.
The 150 ms cap, fixed stepping, joint records, stabilization work and numerical
gates are unchanged. CPU accounting excludes the newly introduced event waits.
The first slicing attempt failed the existing native-cleanup assertion during
cancellation; the correction checks generation after each awaited checkpoint.
The whole-clip availability and pending-backend cancellation browser cases then
passed (two cases, 43.6 seconds). All three public physics Node tests passed after
the correction (162.2 seconds), including both real-model deterministic replay,
unchanged joint bounds and native cleanup. Typecheck and final Vite bundling also
passed; links now cover 529 targets. The broader first local browser attempt was
interrupted when that Node cancellation finding was identified.
An additional regression reproduced stale initialization-error cleanup destroying
one replacement world (two worlds remained instead of three). Error cleanup now
checks the request generation before disposing native worlds, preserving the
replacement request. The regression uses a controlled clock to trigger the error
without loosening the real work budget or physics accuracy assertions.

A connected Pixel 7a (Android 17 / Chrome 156.0.8078.73) allowed a limited
[pre-merge device attempt](public-physics-android-attempt.json). Gene reached Ready
with Physics Off and zero native handles, initially without a rendered frame.
Laugh at frame 15 exceeded the 150 ms device budget (386.4 ms slice), recovered
visibly to Off and released every native handle. Gene Apology with IK On showed
the whole-clip restriction. Uka did not reach Ready within 180 seconds. The device
was locked/dozing, so neither reliable load/rendering performance nor successful
Android physics playback was established. Warm loads and the full device matrix
remain unperformed; required post-merge verification remains pending.

### Whole-clip availability revision (Issue #77)

Gene Apology with IK On is now explicitly unavailable for public Physics at every
time, including Rest-to-clip selection, paused enabling and replay intermediates.
The control stays unchecked and disabled with a visible reason and alternatives.
Entering this combination from active Physics cancels replay/backend completion,
disposes worlds and restores raw/IK-only playback. Turning IK Off or choosing a
different motion makes the control available again without enabling it automatically.
This gates the known unsupported combination; source-consistent execution remains
follow-up work. The source pins and existing accuracy bounds remain unchanged.

Node availability coverage spans both models, all motions and both IK states.
The browser regression seeks every authored frame from 0 through 300 before any
backend request, plays through frames 48–54, and checks restart, loop, IK and
motion transitions, raw-pose restoration, native teardown and resource reuse.
Pending backend cancellation also covers entering this combination during loading.
The lower-level Node failure regressions below remain as accuracy guard coverage;
their failing poses are never offered as supported public playback.

Validation on 2026-11-02 passed: `npm run build` (existing large-chunk warning),
final Vite bundling, `npm run typecheck`, `npm test` (180 tests, zero failures or
skips, plus Toon/Outline schema checks), `npm run check:links` (518 links) and
`git diff --check`. With `MMD_PREVIEW_PORT=43280` to avoid an occupied preview
port, the `public-physics`, `gene-ik` and `public-motion` Playwright suites passed
all 16 Chrome/SwiftShader cases in 12.8 minutes, with no failures or skips.
The full browser matrix, physical Android and original Windows MMD verification
were not performed; the existing physical-device plan remains pending.

### Angular-failure recovery revision (Issue #77)

Before publishing a requested Physics pose, the public host now measures every
native joint frame in all three worlds against the existing **0.005 rad** angular
gate. A failure disposes every world, unchecks Physics, restores the raw/IK-only
pose at the requested time and shows the joint, error and timestamp. Diagnostics
retain all failing panes/joints; a valid retry clears them. Source limits, free
axes, the 128-sweep budget and all existing accuracy assertions are unchanged.
Private replay ticks are not published; the guard checks the requested held pose.

Gene Apology with IK On at frames 48, 50 and 54 exercises this failure path in
Node. Frame 50 still measures joint 53 at **0.017159219 rad**. Earlier browser coverage
checked a failed enable at frame 50, a failed forward seek at frame 54, visible
Off recovery, raw-pose restoration, zero native allocations and successful retry
at frame 15 without fetching another model or backend. The whole-clip availability
regression above supersedes that browser error-path test.

The [frame-50 feasibility calculation](gene-apology-frame50-feasibility.json)
can be reproduced with `npx tsx tools/check-gene-apology-constraints.ts`. It uses
the pinned PMX/VMD and canonical pre-physics IK/grant pose, without Ammo. Interval
subdivision encloses every allowed orientation for cloak joints 52 and 53,
including the full 0.005 rad angular error allowance. Even allowing 30 mm on
each local translation axis of both anchors, and a conservative 10 mm allowance
for the locked-counterweight errors (calculated bound: 2.16 mm), joint 80's
local z remains at most -4.516807 m. Its lower limit is -4.496000 m: at least
**20.8 mm** of linear violation remains, versus its unchanged **0.2 mm** gate.
Thus these source kinematic anchors cannot simultaneously satisfy the existing
gates at frame 50; shifting the violation to another joint is not a correction.
The PMX remains valid. This conflict depends on the authored animation pose and
fixed kinematic anchors, rather than a source-transport validation error.

This revision fixes false Physics On reporting and recovery. It **does not fix
the underlying Gene Apology constraint conflict** or establish full-clip physics
conformance. The solver work requested by the review remains unresolved; these
error-path tests must not be cited as successful simulation of frames 48–54.

Validation passed: build (existing large-chunk warning), typecheck, all 179 Node
tests plus Toon/Outline schema checks, the interval calculation, 518 local links
and whitespace checks. Sixteen existing selected Chrome/SwiftShader cases passed;
the new recovery case passed on a focused rerun after fixing its initial exact
comparison against the browser's serialized `5/3` input value. The native joint
accuracy assertions were unchanged. Temporary alternate server ports avoided an
occupied port 43179. The full browser matrix, physical Android and original
Windows MMD verification were not performed.

### Later-frame review revision (Issue #77)

The branch incorporates main `855b189`, preserving three-mmd 0.1.3 and its
canonical texture diagnostics alongside the public physics diagnostics.
Half-step linear equality projection reduces the reported Gene / Apology /
IK On frame-60 joint-52 error from 0.035278746 m to 0.025877342 m, below the
existing 0.03 m ceiling. No source limits, test tolerances or iteration budgets
are increased. The revised Node and Chrome 156.0.8078.74 samples agree in all
three independent worlds, with a worst joint error of 0.028384746 m (joint 61)
and maximum angular error of 0.000449409 rad. All unchanged per-joint assertions
pass at that time.
Node regressions check every joint in all three worlds at frames 45, 60 and 75
for both characters, both motions and both IK states. Browser regressions add
those frames with IK On and assert that forward playback reuses the worlds.
An analytical incompatible-anchor fixture also detects the full-step residual
bias independently of the real assets.

A separate exploratory Node scan of 301 samples at 30 fps over each full Gene
clip (0–10 s), with both IK states, exposed an additional **unresolved** limitation: Apology
with IK On exceeds the 0.005 rad angular regression bound around 1.6–1.8 s.
The original stabilizer also fails there (up to 0.017642 rad); equality damping
does not resolve it (up to 0.017185 rad). Before the angular-failure recovery
revision above, Physics continued to report On at those states. The selected
later-frame regressions are not full-timeline
constraint conformance, and this revision does not establish that broader
guarantee. This needs further execution work before claiming full-clip bounds.
For a concrete reproduction in the same Node sampler, frame 50 (5/3 s) gives
joint 53 an angular error of 0.017159219 rad with the revised stabilizer.

Revision checks passed: build (existing large-chunk warning), typecheck, all
179 Node tests plus Toon/Outline schema checks, 28 selected Playwright cases
(16.8 minutes, zero case failures/skips), local links and whitespace. Browser
coverage includes public physics/motion, synthetic physics, canonical texture
paths and Uka comparison/recovery. Initial browser startup encountered occupied
port 43180; the completed run used `MMD_PREVIEW_PORT=43181`. The full browser
matrix, physical Android and original Windows MMD validation were not run.

The frame-15 captures, numerical tables and performance measurements below
precede this equality-damping revision and remain historical evidence.

The [complete source audit](public-physics-audit.json),
[runtime policy](public-physics.md), [execution measurements](public-physics-validation.json)
and [sixteen saved canvases](public-physics-captures/README.md) extend the earlier
synthetic evidence to the pinned Uka and Gene Light assets. They establish real
simulation, independent instances, deterministic playback and observable pixels;
they do not establish Windows MMD fidelity.

Measured on Darwin 27.2.0, Apple M4 Max, Node 26.12.1, Chrome 156.0.8078.74,
Playwright 1.56.1, WebGL2/ANGLE SwiftShader, 1200 × 1000 desktop viewport:

| Model / motion, frame 15 (0.5 s) | Changed dynamic bones | Changed PMX / Toon pixels | Changed PBR dynamic-region pixels |
| --- | ---: | ---: | ---: |
| Uka / Laugh | 137 | 16,694 / 16,683 | 16,959 / 43,211 sampled |
| Uka / Apology | 137 | 17,028 / 16,768 | 16,656 / 43,321 sampled |
| Gene / Laugh | 53 | 5,958 / 5,855 | 3,551 / 22,856 sampled |
| Gene / Apology | 47 | 5,500 / 5,285 | 3,349 / 17,932 sampled |

Pixel counts require RGB differences greater than two byte levels. PBR regions
are unions of 41 × 41 pixel squares around projected, actually changed source
dynamic bones. Both material tests require over 100 changed pixels and over ten
changed dynamic bones, alongside independent pose checks. Shading/outline
algorithms remain different; cross-pane raster identity is not claimed.
Across the four states, PMX/Toon/PBR body matrices were identical, world-position
differences were at most 2.22e-16 m and quaternion angular differences 4.22e-8 rad.
The cross-pane bounds are 0.015 m / 0.1 rad; existing raw-body, authored-arm,
sleeve and synthetic CPU/GPU accuracy gates remain unchanged. Strict replay and
Off restoration compare complete independent pose/skin samples exactly.

### Real-model constraint and performance limits

The public host now opts into bounded joint position stabilization and
native-independent mode-2 bone writeback. The [runtime policy](public-physics.md)
describes its fixed iteration budget, rotational gradients, rigid-cluster
conditioning and source-parameter retention. Bullet still allocates and executes
all 164/151 Uka and 87/92 Gene bodies/joints; no records, contact filters, masses or
springs are removed or softened. Native worlds and their velocities persist
between forward ticks. The original v1/synthetic policy and its accuracy gates
remain unchanged.

The regression measures **native body joint frames after final writeback**, in
all three independently simulated panes, for both Laugh and Apology at frame 15
and for IK On and Off. Node checks also sample frame 7.5. It skips only explicit
inverted/free axes and uses Bullet's negative intrinsic ZYX angular coordinates.
All Uka joints and Gene joints outside the cloak network must stay below
**0.2 mm / 0.005 rad**. Gene's nine fully locked counterweight joints (68–76),
including the previously failing joint 75, use **0.02 mm / 0.00002 rad** bounds.
A seven-metre analytical fixture verifies a locked counterweight without moving
its kinematic anchor; another checks that inverted limits remain free. A native
mode-1/mode-2 differential test proves rotation-only bone projection cannot feed
authored translations back into the stabilized native world.

Gene's closed cloak network (joints 51–67) connects separate animated torso and
shoulder anchors and retains finite linear strain. Only those joints receive a
**30 mm** linear ceiling, matching the established synthetic joint-drift ceiling;
their angular bound remains **0.005 rad**. This is a bounded approximation, not
a zero-residual hard-constraint or original-MMD parity claim. It cannot excuse
counterweight drift. Previously joint 75 alone exceeded 0.46 m, with angular
errors up to 0.77 rad. No cross-pane agreement or changed pixels can substitute
for these per-joint assertions.

Fresh frame-15 measurements (worst across all three native worlds, IK On):

| Model / motion | Maximum linear violation (m) | Maximum angular violation (rad) | Gene joint 75 linear violation (m) |
| --- | ---: | ---: | ---: |
| Uka / Laugh | 9.09e-8 | 6.73e-7 | — |
| Uka / Apology | 1.04e-7 | 5.37e-7 | — |
| Gene / Laugh | 0.012130 | 0.000578 | 1.90e-7 |
| Gene / Apology | 0.023254 | 0.001753 | 2.26e-7 |

The execution report retains every per-joint worst-of-three-pane error, rather
than only the global maxima, and summarizes repeated static controller/morph
inventories. IK Off satisfies the same per-joint assertions in the Node and
browser cases. The wider cloak bound applies only to joints 51–67.

The separate reproducible `tools/measure-public-physics.ts` probe recorded cold /
warm ready times of 21.39 / 18.82 s for Uka and 14.10 / 14.32 s for Gene. The
first On replay to 0.5 s took 2.07 s / 2.33 s elapsed, 1.82 s / 2.07 s Chrome
thread CPU, with maximum slices 76.0 / 80.1 ms. Stabilization increases CPU cost;
three-world simulation on
this CPU-rendered setup is **not realtime**. The shared clock slows during work;
there is no unbounded catch-up queue. Responsive cancellation and a 150 ms slice
failure guard remain necessary; one native step cannot itself be preempted.

After forced GC, CDP used JS heap was 47.1 / 37.5 MB Off, 55.1 / 44.8 MB On,
and 51.9 / 43.4 MB after Off (Uka / Gene, decimal MB). ArrayBuffer/backing storage
was 514.5 / 313.1 MB Off and 583.5 / 382.1 MB after loading Ammo. Renderer
resource estimates are reported separately; these figures are not total process
RAM or measured GPU residency. A 64 MiB Ammo heap remains cached after Off.
Owned native handles were 4,416 / 2,463 across exactly three active worlds and
returned to zero after every tested Off, model change and unload. Repeated
toggles/motion changes made no model/texture requests; each successful page
requested Ammo once. Default Off made zero backend requests/native allocations.

### Issue #77 checks and coverage

| Check | Result |
| --- | --- |
| `npm run build` | Passed; existing large-chunk warning. |
| `npm run typecheck` | Passed. |
| `npm test` | 179 passed, zero failures/skips, plus Toon/Outline schema suites. |
| Relevant Playwright cases | 16 distinct relevant cases ultimately passed; the final eight-case rerun passed in 7.8 minutes. |
| `npm run check:links` | Passed; 511 local links, anchors and built asset links. |
| `git diff --check` | Passed. |

This revision's browser selections cover the five existing public-motion and
failure-recovery cases, all four synthetic physics GPU/demo cases and seven
real-model physics cases. It exercises IK × Physics, paused enable,
forward/backward seek, fractional hold, Pause/Resume, Restart, loop reset, motion
A→B→A, Rest/manual expressions, model changes, Toon/PBR, Outline, orbit, backend
corruption/missing responses/retry, pending-load cancellation, repeated toggles,
native teardown and a 390 px **desktop layout**. Node tests additionally exercise
VMD per-controller switches, free-axis/binding retention, post-physics child
translation, no-op bone morphs, cancellation, finite-pose and work-budget failure.

An initial sixteen-case run passed fourteen cases; an experimental global
mode-2 change failed the BDEF/QDEF synthetic palette gates. The final change
selects stabilization explicitly for the public host and retains generic v1
behavior. After rebuilding assets, all 179 Node tests and all four synthetic
browser gates passed with their existing bounds. Both real-model lifecycle and
PBR cases also reran against that final build. No accuracy tolerance was widened
in the existing synthetic tests. Exact selections and outcomes are retained in
the execution report. The unrelated full browser matrix and optional native
WebGPU cases were not run. Original Issue #45 reports below remain historical.

Physical Android Chrome and original Windows MMD measurements are **unperformed**.
`adb devices -l` reported no connected device. Follow the
[physical-device test plan](public-physics.md#validation-and-physical-android-plan)
for the Issue's required post-merge verification when hardware is available.
Desktop CI and viewport checks do not establish Android support.

## Original Issue #45 validation

The bounded rigid-body profile spans the runtime-independent contract, both PMX
parser paths, converter API/CLI, reusable Three.js ownership/lifecycle and the
production Demo. It is synthetic/backend conformance, not original-MMD fidelity.

## Environment and reproducibility

Validated on macOS/Darwin 25.6.0, arm64, Node v24.12.0, npm 11.6.2,
Playwright 1.56.1 and Chromium 141.0.7390.37. Browser checks use the existing
SwiftShader WebGL fallback flags. The exact backend is ammojs-typed 1.0.6,
package gitHead 9c7d8107dc04cbb0c39ed3f86a4c9179d54f77fa, artifact SHA-256
`422b87333fec6272a592088f96bd672dc8f62b9649b12d44e493fd427e89fff8`.
[Provenance and ABI](../extensions/MMD_physics/backend.json) distinguish the
recoverable artifact identity from its unrecovered embedded Bullet revision.
The resource is self-contained JavaScript, not an external WASM download.

[Asset hashes](physics-assets.json) record 104 generated/runtime/fixture files,
including every physics GLB, external-buffer glTF and buffer, both original
motions/poses, the backend and its license. Generated `public`/`dist` outputs
follow the repository's existing build/ignore convention; `npm run build`
reconstructs them. The six attributed physics PMX variants are committed fixtures.

## Required checks

| Command | Actual result |
| --- | --- |
| `npm ci` | Passed with the final pinned dependency lock. npm reported two dependency advisories (one low, one high); no unrelated upgrades were applied. |
| `npm run build` | Passed before generated-asset-dependent tests. The existing large-chunk warning remains. |
| `npm run typecheck` | Passed. |
| `npm test` | 108 passes, zero failures/skips, plus Toon/Outline schema suites. |
| `npx playwright install chromium` | Passed. |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | 62 passes, zero failures, two optional native-WebGPU skips; complete 64-case run, 59.3 minutes. |
| Focused browser capture/physics run | Five passes: complete group-box/A recovery plus all four physics browser tests. |
| `npm run check:links` | Passed; 383 local documentation links, anchors and built example asset links. |
| `git diff --check` | Passed; repeated before commit. |

The [execution report](physics-execution.json) records exact check outcomes and
separates the complete run from earlier failed/interrupted attempts. Across the
physics renders, measured maxima were CPU position 1.13e-8 m, GPU position
2.62e-5 m, normal component 9.05e-5 and zero raster pixels beyond the existing
two-byte-level comparison threshold.

## Evidence and numerical bounds

[Node measurements](physics-node-validation.json) separate the following evidence:

- Analytical constant-gravity motion uses the selected build's measured
  semi-implicit Euler free-motion recurrence: `y(n)=y(0)+g*h²*n*(n+1)/2`.
  At 60 ticks, h=1/120 s, the absolute position error is below 2e-6 m.
  Offset composition, rotated offsets, modes 0/1/2, nonzero mode-2 spring
  rotation, unbound bodies, fixed-step partitioning and fractional holds execute.
- Independently authored direct-Ammo contact/spring cases test the selected
  integrator separately from the adapter. The floor-contact bound is 0.01 m;
  joint-limit drift bound is 0.03 m. Corrected raw PMX eligibility bits exercise
  asymmetric filtering and group 15 through actual Bullet contacts. The wrong-mask control
  falls through the floor; it is observably separate from contact.
- A second direct-Ammo rig reference creates its own world/bodies/constraints,
  shares the already-tested pre-IK algorithm, and authors coupling and the
  fixture's post-local-append equation separately. Adapter poses compare within
  3e-6 m and 2e-5 radians. This is backend conformance, not an independent
  original-MMD oracle.
- Both motions on both rigs, both VPD handoffs, all skinning modes, retained
  GLB/glTF, ordinary fallback, replay, loop, pause/resume/reset/stop, invalid
  budgets, disabled physics, incorrect order, async failure, separate instances
  and disposal execute. All 60 built model assets validate with zero glTF errors;
  custom extension schema and semantic validation execute separately.
- Fallback interpolation is explicitly approximate. Three finite between-tick
  probes measure translation, rotation and morph-weight errors. Their maxima
  are saved without claiming a continuous guarantee or changing any existing
  nonphysics tolerance. Live rendering holds the last full physics tick;
  ordinary core LINEAR interpolation has different between-tick behavior.
- The allocating `[Value]` transform quaternion getter is forbidden by an
  executable guard. Repeated reset/disposal returns owned native-handle counts
  and borrowed binding-wrapper cache counts to zero. Borrowed native references
  are never destroyed. The caller-owned backend module has process/page lifetime.

The [BDEF](physics-bdef-browser-validation.json),
[SDEF](physics-sdef-browser-validation.json) and
[QDEF](physics-qdef-browser-validation.json) reports pair independent supplied
resolved palettes with actual GPU readbacks and Toon/PBR surface/outline rasters.
The unchanged bounds are position <=1e-4 m, normal component <=5e-4, CPU position
<=2e-6 m, and at most 128 raster pixels differing by more than two byte levels.
[Saved canvases](physics-canvas/README.md) retain those rendered states.
Motion and VPD snapshots export as GLB/glTF, validate, reload, preserve visible
vertices and immutable rest, and do not start a second simulation.

The [built Demo report](physics-demo-validation.json) covers both rigs/motions
through bytes, GLB and glTF; both VPD handoffs for each; enable/reset/settle;
transport/replay; materials/outline; focused SDEF/QDEF; recovery, replacement,
disposal and the actual export buttons. Its transforms and queried vertices
match the acknowledged rendered revision. [Demo canvases](physics-demo-canvas/README.md)
retain the matching visual states.

## Failed attempts and corrections

Earlier Node attempts exposed errors in test setup: explicit unmatched-morph
policy was missing in the separate reference, a reference array was compared by
traversal order rather than stable identity, and a combined morph contribution
was mistaken for the two independently retained target weights. Those test
expectations were corrected; no production algorithm or tolerance was weakened.

An earlier full browser attempt was interrupted after 26.4 minutes to correct
canvas observation: 14 passes, nine screenshot-equality failures, two optional
native-WebGPU skips, one interrupted SDEF case and 38 unperformed cases. The
13.2-minute existing QDEF GPU conformance case passed. That attempt is not a
complete-suite pass. The correction, initial invalid blank-buffer probe, primary
references and measured rationale are retained in the
[canvas observation record](physics.md#canvas-restoration-observation-correction).
The replacement reads a nonempty bitmap in the actual render callback, tags its
revision, preserves screen captures and still requires exact PNG equality.
The complete group-box/A rerun passed with this observation contract.

No controlled original-MMD measurements or optional native-WebGPU validation
were performed. Original-MMD adoption/fidelity and representative integrated
compatibility remain unresolved. Issue #45 required no post-merge verification;
Issue #77's physical Android verification is described above.
