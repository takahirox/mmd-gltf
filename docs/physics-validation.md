# Issue #45 validation

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
  joint-limit drift bound is 0.03 m. Raw PMX exclusion bits exercise asymmetric
  filtering and group 15 through actual Bullet contacts. The wrong-mask control
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
compatibility remain unresolved. No post-merge verification is required.
