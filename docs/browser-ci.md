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

For repeatable Ubuntu evidence, add the `browser-performance` label to the PR
after publishing the measurement workflow. The label event (or a subsequent PR
update while labeled) runs the normal full validation, then
[`measure-browser-ci.sh`](../tools/measure-browser-ci.sh) on that **same**
Ubuntu 24.04 runner. A manual workflow dispatch can also enable
`compare_browser_matrices` once the dispatch trigger is available on the default
branch. Normal unlabeled PR runs do not pay for these diagnostic repetitions.
Remove the label after collecting the evidence.

The script archives the full default run and two matched 15-case Solver/VMD/
morph/group pairs in the `browser-performance` artifact. Pair order is
full → representative, then representative → full to expose ordering/cache
effects. Each directory retains the summary, phase timings, oracle attachments
and command exit code. `commit.txt` and `order.txt` identify the source and
execution order. The full
matrix replays the previous permutations on the instrumented implementation;
it is not an uninstrumented historical-commit measurement. A failed repetition
fails the job and preserves its evidence. The original complete-suite results
are restored for the separate `browser-evidence` artifact even on failure.
Compare both pairs' phase counts/times and variability; use the archived default
run, rather than a filtered repetition, for #69/#70 wall-time and per-suite deltas.
The completed Ubuntu collection and its results are recorded below.

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

## Validation evidence

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
The initial failed full run and the successful rerun both
used the representative matrix, so their wall times are **not** a matrix
before/after comparison. Only the matched 15-case pair above measures the
matrix change locally.

### Successful Ubuntu PR validation

PR workflow [#75](https://github.com/takahirox/mmd-gltf/actions/runs/40814007482)
completed successfully on October 29, 2026. It validated PR head
`9b078e6de9e250af75a5624d36d55bbce6cf1ae1` through GitHub's merge commit
`2f8206706775cbc73cf14ff99611a57ea30afebf`; the GitHub comparison reports no
file differences between them. This replaces the pending #74 validation, which
was superseded when the performance label started #75. Build, typecheck, all
125 Node tests (zero failures/skips), the full browser suite, 435 documentation/
asset link checks, whitespace checks and all four measurement repetitions passed.

[browser-ci-ubuntu.json](browser-ci-ubuntu.json) retains the run/commit identities,
artifact IDs and verified ZIP digests, original summary hashes, environment,
per-suite outcomes, conformance case durations, all aggregated phase counts/times,
skip names and validation-step timestamps. The complete default summary in the
`browser-performance` artifact is byte-identical to the one in `browser-evidence`.
The temporary `browser-performance` label was removed after collection.

The entire collection used the **same** GitHub-hosted Ubuntu 24.04.5 runner
(image `20261025.353.1`, AMD EPYC 9V45, four logical CPUs), Node v22.23.4,
Chromium 141.0.7390.37, ANGLE SwiftShader and one Playwright worker. Historical
#69 also used image `20261025.353.1`; #70 used `20261012.334.1`, both Ubuntu
24.04.5. Their summaries did not record CPU models. No additional runners,
workers, configured test-timeout increases or hardware GPU were used.

The complete browser summary reports **21m19.202s**, with 73 cases: **71 passed,
two explicit native-WebGPU skips, zero failures and zero retries**. This is
14m25.876s (40.4%) below #69's 35m45.078s and 13m00.548s (37.9%) below #70's
34m19.750s summaries. The enclosing npm browser step took **21m20s**, versus
#70's **34m21s**. The two historical full-suite summaries differ by 85.328s;
there is one new complete-suite observation, not a repeated full-suite estimate.
The diagnostic repetitions add 11m09s to this labeled job and are excluded from
the default browser time; ordinary PR CI does not run them.

All suite durations and deltas below are seconds, summed over cases (wall time
also includes runner/startup overhead). Case counts and pass/skip outcomes match
the historical suites; only example and Outline each have one native-WebGPU skip.

| Suite | #69 | #70 | #75 | Delta vs #69 | Delta vs #70 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `bdef.spec.ts` | 1.935 | 1.860 | 1.299 | −0.636 | −0.561 |
| `bone-morph.spec.ts` | 179.478 | 177.678 | 107.122 | −72.356 | −70.556 |
| `demo-loading.spec.ts` | 4.622 | 4.485 | 3.084 | −1.538 | −1.401 |
| `example.spec.ts` | 85.208 | 83.519 | 49.834 | −35.374 | −33.685 |
| `group.spec.ts` | 145.529 | 143.326 | 78.514 | −67.015 | −64.812 |
| `outline.spec.ts` | 6.105 | 5.787 | 4.421 | −1.684 | −1.366 |
| `physics.spec.ts` | 142.989 | 138.482 | 89.695 | −53.294 | −48.787 |
| `qdef.spec.ts` | 204.317 | 193.729 | 129.549 | −74.768 | −64.180 |
| `sdef.spec.ts` | 147.080 | 139.680 | 88.089 | −58.991 | −51.591 |
| `solver.spec.ts` | 522.703 | 497.622 | 272.728 | −249.975 | −224.894 |
| `uka.spec.ts` | 150.209 | 135.390 | 98.381 | −51.828 | −37.009 |
| `unified-demo.spec.ts` | 131.901 | 123.495 | 84.996 | −46.905 | −38.499 |
| `vmd.spec.ts` | 312.521 | 310.776 | 201.072 | −111.449 | −109.704 |
| `vpd.spec.ts` | 56.605 | 54.024 | 37.324 | −19.281 | −16.700 |
| `bfcache.spec.ts` | 47.143 | 43.912 | 29.049 | −18.094 | −14.863 |

Unchanged suites also became faster across these runs. The historical comparison
establishes the observed full-suite improvement on comparable hosted Ubuntu CPU
runners; it does **not** attribute all 37.9–40.4% to this patch. The matched
measurements below isolate the matrix selection on one runner and source tree.
The earlier #53 reductions are already present in both historical baselines.

### Repeated Ubuntu phase comparison

After the complete default suite, the workflow ran the same 15 conformance cases
in recorded order full-1 → representative-1 → representative-2 → full-2. Each
invocation passed all 15 cases, with zero skips, failures or retries and exit code
zero. Full replays the previous permutations with current instrumentation; it is
not a checkout of the historical implementation. Both modes retain the shader,
oracle, stress and format guarantees mapped above, including the 260-bone palette,
position/normal probes, Toon/PBR/Outline, byte/GLB/glTF and applied exports.

| Measured subset (seconds) | Full 1 | Representative 1 | Representative 2 | Full 2 |
| --- | ---: | ---: | ---: | ---: |
| Solver, 12 cases | 161.686 | 98.052 | 99.424 | 177.015 |
| VMD + vertex morph, two cases | 19.311 | 9.780 | 9.787 | 20.580 |
| Group, one case including unchanged exports | 17.776 | 13.754 | 13.008 | 18.096 |
| Filtered wall time | 200.832 | 123.629 | 124.279 | 217.725 |

The paired wall-time reductions are **77.203s (38.4%)** and **93.446s (42.9%)**;
the mean saving is 85.324s across these selected cases. The two full repetitions
span 16.893s (8.1% of their mean), while representative repetitions span 0.650s
(0.5%). Two pairs expose variability and order effects but do not establish a
confidence interval or an exact whole-suite saving from the matrix change.

Selected page-side phases below are seconds. Counts are full → representative
and are identical across repetitions of each mode. Browser navigation/waits,
renderer initialization and scalar oracle/baking phases are also retained in
the JSON. Browser waits overlap the page phases and must not be added to them.
These filtered cases take no screenshots.

| Phase | Count | Full 1 | Representative 1 | Representative 2 | Full 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Solver load/parse/bind/export | 240 → 144 | 3.850 | 2.393 | 2.344 | 4.103 |
| Solver vertex render submission | 624 → 384 | 12.079 | 7.232 | 7.217 | 12.705 |
| Solver vertex readback | 624 → 384 | 57.744 | 34.515 | 35.284 | 62.884 |
| Solver first raster submission | 960 → 576 | 13.243 | 8.262 | 8.307 | 13.503 |
| Solver subsequent raster submission | 288 → 192 | 0.358 | 0.259 | 0.263 | 0.397 |
| Solver raster readback | 1248 → 768 | 68.360 | 40.554 | 41.181 | 76.937 |
| Solver pixel comparison | 624 → 384 | 0.451 | 0.272 | 0.392 | 0.514 |
| VMD + morph load/parse/bind | 48 → 24 | 0.837 | 0.432 | 0.425 | 0.834 |
| VMD + morph first raster submission | 192 → 96 | 2.375 | 1.319 | 1.408 | 2.398 |
| VMD + morph subsequent raster submission | 384 → 192 | 0.610 | 0.329 | 0.334 | 0.652 |
| VMD + morph raster readback | 576 → 288 | 13.892 | 6.655 | 6.566 | 15.020 |
| VMD + morph pixel comparison | 384 → 192 | 0.214 | 0.126 | 0.120 | 0.195 |
| Group raster readback | 288 → 144 | 6.701 | 3.431 | 3.322 | 6.830 |
| Group exports (unchanged) | 1 → 1 | 8.197 | 8.488 | 7.962 | 8.327 |

Solver vertex plus raster readback accounts for 78–79% of its full-matrix test
time; VMD/morph raster readback accounts for 72–73%. Reducing sampled states and
readbacks therefore removes a confirmed major cost. Load/parse/bind/export and
scalar work are much smaller; render submission is also measurable. The split
of readback waits into shader compilation, rendering, synchronization and copying
remains unmeasured. No phase is claimed to isolate shader compilation.

The complete run's remaining hot spots are Solver (4.55 min), VMD (3.35 min),
QDEF (2.16 min), bone morph (1.79 min) and Uka (1.64 min). The selected conformance
rows account for only 1.68 min of Solver and 0.18 min of VMD in that run; their
remaining UI/lifecycle/rendering cases still cost time. Group's unchanged exports
take about eight seconds in each repetition. The full suite retains the other
stress, numerical edge, format/export, recovery and synchronization tests listed
above. SwiftShader remains CPU-backed, and this evidence does not establish
hardware GPU driver behavior.
