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

The measurements below predate this mask correction. Their poses, pixels and
performance are historical evidence, not measurements of the revised filters.
The joint-constraint review finding remains unresolved; matching pane poses or
passing the existing browser tests does not establish constraint accuracy.
[Revision evidence](physics-mask-revision.json) records the corrected-mask checks
and the still-excessive frame-15 joint errors for both models and clips.

## Public real-model integration (Issue #77)

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
| Uka / Laugh | 137 | 15,498 / 15,457 | 15,946 / 40,624 sampled |
| Uka / Apology | 136 | 14,790 / 14,503 | 15,272 / 41,351 sampled |
| Gene / Laugh | 62 | 5,988 / 5,872 | 6,179 / 28,058 sampled |
| Gene / Apology | 62 | 9,473 / 9,323 | 9,630 / 29,718 sampled |

Pixel counts require RGB differences greater than two byte levels. PBR regions
are unions of 41 × 41 pixel squares around projected, actually changed source
dynamic bones. Both material tests require over 100 changed pixels and over ten
changed dynamic bones, alongside independent pose checks. Shading/outline
algorithms remain different; cross-pane raster identity is not claimed.
Across the four states, PMX/Toon/PBR body matrices were identical, world-position
differences were at most 1.78e-15 m and quaternion angular differences 5.17e-8 rad.
The new cross-pane bounds are 0.015 m / 0.1 rad; existing raw-body, authored-arm,
sleeve and synthetic CPU/GPU accuracy gates remain unchanged. Strict replay and
Off restoration compare complete independent pose/skin samples exactly.

### Real-model constraint and performance limits

Actual post-writeback native joint-frame linear residuals (excluding free axes)
were **0.047401 / 0.022157 m** for Uka Laugh / Apology and
**0.379902 / 0.188212 m** for Gene. These include mode-2 origin re-anchoring;
they are not a low-residual constraint-conformance pass. Gene includes long
counterweights: source body 74 has its centre at PMX Y = -78.255 and connects
to body 64 through joint 75, with all axes locked and source springs 100,000.
The entire source still executes; none of these bodies/joints is omitted.
Exploratory increases in solver correction/iterations and removing mode-2
anchoring did not establish an acceptable fidelity improvement. Those changes
were discarded. Further work needs an independent MMD oracle and a validated
policy for coupled mode-2 chains, long counterweights, contact and constraint
correction. Pane agreement alone cannot prove physical accuracy. The public
About & credits explicitly identifies this limitation.

The separate reproducible `tools/measure-public-physics.ts` probe recorded cold /
warm ready times of 20.52 / 18.51 s for Uka and 14.06 / 14.22 s for Gene. The
first On replay to 0.5 s took 1.77 s / 1.09 s elapsed, 1.52 s / 0.84 s Chrome
thread CPU, with maximum slices 73.6 / 56.9 ms. Thus three-world simulation on
this CPU-rendered setup is **not realtime**. The shared clock slows during work;
there is no unbounded catch-up queue. Responsive cancellation and a 150 ms slice
failure guard remain necessary; one native step cannot itself be preempted.

After forced GC, CDP used JS heap was 47.0 / 37.5 MB Off, 53.7 / 44.6 MB On,
and 51.1 / 43.5 MB after Off (Uka / Gene, decimal MB). ArrayBuffer/backing storage
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
| `npm test` | 176 passed, zero failures/skips, plus Toon/Outline schema suites. |
| Relevant Playwright cases | 23 distinct cases ultimately passed across the recorded selection and focused reruns. |
| `npm run check:links` | Passed, including new evidence/capture links. |
| `git diff --check` | Passed. |

The browser selection covers existing public-motion/body-motion failure
recovery, Uka sleeve IK/arm gates, all four synthetic physics GPU/demo cases and
seven new real-model physics cases. It exercises IK × Physics, paused enable,
forward/backward seek, fractional hold, Pause/Resume, Restart, loop reset, motion
A→B→A, Rest/manual expressions, model changes, Toon/PBR, Outline, orbit, backend
corruption/missing responses/retry, pending-load cancellation, repeated toggles,
native teardown and a 390 px **desktop layout**. Node tests additionally exercise
VMD per-controller switches, free-axis/binding retention, post-physics child
translation, no-op bone morphs, cancellation, finite-pose and work-budget failure.

The first 21-case selection had 19 passes and two new strict-equality failures
caused only by IEEE signed zero in pose diagnostics. Canonicalizing zero in the
diagnostic serialization fixed these without changing nonzero values, NaNs or
accuracy tolerances. All five new lifecycle/recovery cases then passed, followed
by both added PBR cases. The final combined run of all seven new public cases
passed in 5.3 minutes. An earlier synthetic attempt used the occupied default
preview port; the successful selection used `MMD_PREVIEW_PORT=43280`. Exact
selection, attempts, outcomes and durations remain in the execution measurements.
The full unrelated browser matrix and optional native-WebGPU cases were not run
for this Issue. Historical synthetic reports below remain their original evidence.

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
