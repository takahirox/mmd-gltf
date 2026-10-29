# Browser CI on CPU-backed SwiftShader

Issue [#54](https://github.com/takahirox/mmd-gltf/issues/54) builds on the merged
[#53](https://github.com/takahirox/mmd-gltf/pull/53). The Uka integration, synthetic
scalar oracles, bitmap capture, and SDEF/QDEF format reductions from #53 remain.
This change reduces the remaining Solver and VMD-family conformance matrices;
it does not attribute #53's improvements to this work.

## Execution and measurement

The default remains one Chromium worker with ANGLE SwiftShader. No extra runners,
higher configured test timeouts, or native GPU are used. Build production assets first:

```sh
npm run build
PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser
```

To replay the previous conformance cross-products with the same instrumentation:

```sh
BROWSER_CONFORMANCE_MATRIX=full PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser
```

Use identical source, Node/Chromium versions and runner provisioning for a pair of
measurements; archive `test-results/browser-summary.json` after each invocation
(the next invocation clears test-results). Repeat the pair to assess variability.
The existing CI artifact upload retains the summary and per-test attachments.
JSON body attachments are explicitly saved under `test-results/attachments` because
the list reporter alone does not persist them. Historical Solver capture JSON and
screenshots are refreshed together only with `UPDATE_SYNTHETIC_EVIDENCE=1`; ordinary
runs retain their oracle evidence in test-results instead of rewriting those files.
The summary records environment, full-run wall time, per-suite sums, pass/skip/fail
statuses and retries, plus phase timing for Solver, VMD, morph and group tests.
A filtered run's duration is not a full-suite speed measurement.

`phase-timing.json` records navigation and explicit page waits separately from
page-side renderer initialization, load/parse/bind (including export for Solver),
vertex render submission/readback, oracle evaluation/baking, first/subsequent
raster render submissions, synchronous canvas readback and pixel comparison.
First means the first sampled state of each newly loaded asset; the labels do
not imply a cold driver cache. Each pass draws the real asset and its independent
baked oracle. Submission can include shader setup, compilation, drawing and JS;
asynchronous driver work can be paid during readback. These measurements do not
isolate shader compilation. Browser waits overlap page-side work and must not be
added to it. Locator action/assertion time and teardown are part of whole-test
time but not exhaustively attributed to phases. Default Solver conformance has
no compositor screenshots; optional evidence screenshots are separately timed.

## Coverage allocation

CPU tests never stand in for shader integration. Node evaluates the broad data
cross-products; SwiftShader still executes each distinct shader family, material,
pass and representative load/export route. UI tests retain their existing
controls, real-frame synchronization, transport, lifecycle and recovery cases.
No test is skipped or removed, and no numerical or raster tolerance changes.

### Solver

Every BDEF/SDEF/QDEF × box/wedge × Toon/PBR combination still runs as an isolated
Playwright case (12 cases). Each retained row runs both surface and Outline
against baked independent scalar geometry, plus RGBA32F GPU position **and normal**
probes on all 24 vertices. Animated rows sample 0.371 (IK on) and 0.719 (IK off);
applied motion exports sample the frozen 0.371 state; VPD rows sample the posed
state. Incorrect-order/disabled negative controls and repeated VPD application
remain. Thresholds stay CPU 2e-6, GPU position 1e-4, normal 5e-4, channel difference
2 and at most 128 mismatched pixels, with nonempty raster checks.

The explicit rows live in [conformance-cases.ts](../tests/conformance-cases.ts).
Each of the following replacements applies separately to all 12 outer cases:

| Source | Retained GPU states | Removed GPU states | Replacement and reason |
| --- | --- | --- | --- |
| bytes | a, b, pose-a, pose-b | none | Canonical raw VMD/VPD binding, both IK states, solver/morph ordering and all skinning families still execute on WebGL. |
| glb | a, pose-b | b, pose-a | Node checks both removed states; WebGL b and pose-a run through bytes and glTF. GLB still exercises both animated and applied-pose plugin loading for every outer case. |
| gltf | b, pose-a | a, pose-b | Node checks both removed states; WebGL a and pose-b run through bytes and GLB. External-buffer glTF still exercises both animated and applied-pose plugin loading for every outer case. |
| export-glb | a, pose-a | b, pose-b | Node exports/reloads both removed states; WebGL b/pose-b run through bytes and export-glTF. Binary exporter, frozen VMD state and resolved VPD state still execute with all three skinning plugins and both materials. |
| export-gltf | b, pose-b | a, pose-a | Node exports/reloads both removed states; WebGL a/pose-a run through bytes and export-GLB. JSON exporter still executes frozen VMD and resolved VPD states with every outer case. |

[solver-formats.test.ts](../tests/solver-formats.test.ts) checks all 120
rig × skinning × source × state combinations without a renderer. It uses actual
production GLTFLoader/plugins and texture-free GLTFExporter, compares all vertices
against `solverVertex` at the original accuracy, repeats seeks, validates all
48 applied exports, and verifies stable reset/reapplication. The FileReader shim
only implements asynchronous Blob IO; it does not emulate a renderer.

[solver.test.ts](../tests/solver.test.ts) retains the independent bone orientation,
IK/append, 1201-point fallback, exact FLOAT switch seams, binding errors, numerical
degeneracies, caps, group weights, bounds and incorrect-order controls. Authored
normal serialization and the independent GPU normal probes remain complementary.
The removed source/state combinations supply different pose/palette data to the
same shader graph, not additional shader branches. All source categories still
reach a real shader with both animation and applied poses on both rigs.

Per outer case: 20 asset loads / 26 sampled states / 52 raster comparisons become
12 / 16 / 32. Across all 12 cases, real raster comparisons decrease from 624 to
384; position/normal probe draws decrease from 624 to 384. Every retained raster
comparison still draws both actual and oracle geometry.

### VMD, vertex morph and group morph

The shared [vmd-gpu.ts](../tests/vmd-gpu.ts) keeps both rigs, both material
primitives, Toon and independent PBR, and surface/Outline passes for each of the
three families. Each row still seeks 0.371 → 0.719 → 0.371, checks scalar bone
rotation, CPU vertex/morph prediction, real oracle pixels, nonempty rendering,
and zero pixel differences on reseek. Thresholds stay rotation 1e-7, weights
1e-6, position 2e-6, channel difference 2 and 128 mismatched pixels.

| Material | Retained source/motion | Removed source/motion | Replacement for each rig and family |
| --- | --- | --- | --- |
| Toon | bytes/a, glb/b, gltf/a | bytes/b, glb/a, gltf/b | The other material executes the exact removed source/motion pair on WebGL; Toon still executes both motions and all sources. |
| PBR | bytes/b, glb/a, gltf/b | bytes/a, glb/b, gltf/a | The other material executes the exact removed pair on WebGL; PBR still executes both motions and all sources. |

Material selection changes shading, while motion identity supplies transforms and
weights. Each source/material still renders each skinning/morph graph on both
rigs; duplicating the other motion adds data permutations rather than a graph
branch. Each family's independent Node suite (`vmd.test.ts`, `morph.test.ts`,
`group.test.ts`) retains both motions × both rigs × byte/GLB/glTF, keys, fractional
and repeated seeks, dense 1201-point fallback grids and malformed/boundary cases.
The 260-bone palette and second material primitive remain in every relevant rig
case. Group applied export round trips (24 cases), extension-only Solver exports
(10 assets), and advanced group-before-SDEF/QDEF GPU probes are unchanged.

Each family's 24 loaded assets / 144 real raster comparisons become 12 / 72.
The group export matrix runs in addition to these raster comparisons.

### Unchanged guarantees outside these matrices

Canonical BDEF, SDEF and QDEF conformance, dual-quaternion stress/edge cases,
advanced bone morphs, VPD, physics, Toon arithmetic, Outline, Uka, actual GLTFLoader
and runtime shader plugins, fallback/export compatibility, load failure recovery,
UI ownership/disposal and delayed real-frame/canvas evidence remain in their
existing Node/WebGL/UI suites. Optional native-WebGPU cases remain explicit skips
when the device is unavailable. SwiftShader tests do not establish behavior on
hardware GPU drivers.

## Validation evidence and remaining gate

The historical full successful CPU-run baselines are
[#69](https://github.com/takahirox/mmd-gltf/actions/runs/40697950655) (73 tests,
approximately 35.75 minutes) and
[#70](https://github.com/takahirox/mmd-gltf/actions/runs/40706428394) (browser step
34m21s). #69's suite times were Solver 8.71, VMD 5.21, QDEF 3.41, bone morph 2.99,
Uka 2.50, SDEF 2.45, group 2.43 and physics 2.38 minutes. Both original summaries report 71 passed and two native-WebGPU skips, with zero
failures. Their exact wall times, environments and per-suite results are retained
in [browser-ci-baselines.json](browser-ci-baselines.json); #70's summary wall time
is 34m19.750s (its enclosing npm step was 34m21s). These are whole-suite
measurements, not shader compilation measurements.

The local pair in [browser-ci-local.json](browser-ci-local.json) ran on macOS
25.6.0 / Apple M4 Max / Node v26.12.1 / Chromium 141.0.7390.37, one worker and
SwiftShader. Both filtered runs passed all 15 cases, with zero skips/failures:

| Filtered conformance cases | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Solver (12 cases) | 612.075 s | 391.494 s | −220.581 s |
| VMD + morph (2 cases) | 111.078 s | 42.973 s | −68.105 s |
| Group (1 case, including unchanged exports) | 34.187 s | 20.712 s | −13.475 s |
| Filtered run wall time | 760.563 s | 457.123 s | −303.440 s (39.9%) |

This is one local pair, with visible per-case variability. It is preliminary
performance evidence for the changed subset, not a full-suite before/after
measurement. The full-matrix switch also passed a Solver/VMD smoke pair on the
new implementation (52 and 144 comparisons respectively).

In the baseline, vertex readback (253.842 s) plus raster readback (329.536 s)
accounted for about 95% of the selected Solver cases' 612.075 s. VMD/morph raster
readback (104.851 s) accounted for about 94% of their 111.078 s. Load/parse/bind/export
and JS oracle phases were much smaller. These are confirmed wall-time charges;
what fraction of the readback wait represents shader compilation, drawing, driver
synchronization or copying is **not** established. The optimization removes
redundant sampled states/readbacks, and does not claim to isolate that split.
The baseline group case has whole-test timing but no phase attachment.

The first full local run completed with 70 passed, two explicit native-WebGPU
skips and one failed unified-demo resumed-motion check. Its five-second poll saw
an empty old render marker. A focused repetition measured a valid current frame
acknowledgement at 6.803 seconds, confirming that the short poll could reject a
correct software-rendered result. That check now uses the normal 30-second page
render acknowledgement wait used elsewhere, requires the current rig, revision
and motion to match the submitted frame, and retains inactive-frame and paused
playback assertions. All three focused repetitions passed; their observations
and the failed full-run summary are retained in browser-ci-local.json. This
synchronization correction does not change configured test timeouts or numerical/
raster thresholds and is not credited to the conformance speed reduction.

Local build, typecheck, all 125 Node tests, the reporter attachment regression
check, documentation/asset links and whitespace checks passed.
Full default local browser validation passed in **35m02.039s**: 73 cases,
71 passed, two explicit native-WebGPU skips, zero failures and zero retries.
The corrected resumed-motion check passed within that complete run. The summary
and explicit skip names are retained in browser-ci-local.json; the reporter also
retained 59 JSON attachments under test-results.

The largest local suite costs were `solver.spec.ts` (8.53 min), `qdef.spec.ts`
(5.80 min), `physics.spec.ts` (3.34 min), and `vmd.spec.ts` (2.94 min).
These remaining shader/raster/UI integration costs have not been profiled on
Ubuntu in this node. The initial failed full run and the successful rerun both
used the representative matrix, so their wall times are **not** a matrix
before/after comparison. Only the matched 15-case pair above measures the
matrix change locally.

A successful full PR workflow and repeatable before/after phase measurements on comparable
Ubuntu 24.04 GitHub-hosted CPU runners remain a mandatory pre-merge gate. The
implementation-stage validation did not produce that external CI evidence.
Local macOS results must not be used
to claim a percentage improvement against #69/#70 or to mark Issue #54 complete.
