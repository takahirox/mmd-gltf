# Testing principles and browser CI on CPU-backed SwiftShader

## Test and CI principles

**Detect the required failures at the lightest appropriate layer, without redundant
execution.** Preserve required correctness, regressions, meaningful integration
coverage and assertion strength when redistributing checks.

1. **Prefer the lightest meaningful layer.** Use `npm test`'s Node and extension
   CPU/schema/asset checks for calculations, branches, malformed inputs and broad
   data combinations. Use Playwright/SwiftShader for shader execution, rendered
   output, browser loading and UI lifecycle; real Uka/Gene models cover integration
   that synthetic fixtures cannot. CPU oracles do not replace shader integration,
   and SwiftShader does not prove hardware GPU behavior. Add tests that catch a
   concrete defect rather than mirror the implementation.
2. **Choose combinations deliberately.** Cover distinct byte/GLB/glTF/export,
   BDEF/SDEF/QDEF, Toon/PBR/Outline, motion and UI paths with representative cases;
   use exhaustive combinations where interactions require them. Follow the
   [coverage allocation](#coverage-allocation) mapping between broad Node matrices
   and retained GPU cases. Preserve required regressions and boundary coverage
   rather than automatically multiplying every model, format, state and backend.
3. **Match validation to the change.** Use the change guidance below for fast local
   feedback, then complete applicable mandatory pre-merge checks. Full regression
   CI and Pages publication have separate responsibilities: PR CI validates;
   deployment waits for asset preparation, typecheck, Node/smoke checks, all browser
   shards and the final build gate on a push to `main`. Keep optional
   diagnostics separate and record genuinely post-merge-only verification as
   pending when the Issue requires it. Pre-merge success does not prove publication.
4. **Reuse work and avoid duplicate execution.** Reuse builds, converted fixtures
   and downloads with keys covering relevant inputs and versions, while isolating
   mutable test state. CI already caches npm and manifest-keyed model downloads.
   When changing CI, avoid equivalent push/PR runs for the same revision, cancel
   superseded validation when safe, and preserve necessary deployment ordering.
   The current workflow validates PRs and `main` pushes and cancels superseded runs
   per ref. Measure resource use before parallelizing independent work; more
   workers do not necessarily improve CPU-backed rendering.
5. **Review added confidence and cost together.** Identify the additional defect a
   new or expanded test detects, assurance already supplied elsewhere, and added
   execution and maintenance cost. Watch repeated fresh browser/renderer or shader
   setup, model downloads/conversion, large fixtures, long simulation loops and
   Cartesian-product growth. Preserve meaningful assertions when removing overlap.
6. **Maintain an execution-time budget using evidence.** Use the recorded
   [Ubuntu browser observation](#successful-ubuntu-pr-validation), **21m19.202s**
   with one SwiftShader worker, as a historical comparison baseline, not a universal
   limit or a current full-CI measurement. Issue #81 targets approximately 20
   minutes or less for full required PR feedback, subject to comparable hosted
   measurements. Compare equivalent environments and
   workloads, monitor growth and investigate overruns against an established target.
   Separate elapsed feedback time, total runner/computation time and queue time;
   do not add overlapping phase timings. Revisit allocation, setup and duplication
   while retaining required coverage. No new benchmark or merge gate is required
   solely to document these principles.

Use [README setup and commands](../README.md) and the
[development validation guidance](development-flow.md#2-implement-and-validate):

| Change | Relevant local validation |
| --- | --- |
| Documentation/templates only | Markdown/template structure, relative links and anchors, consistency, complete diff review and `git diff --check`; no application build or runtime suite solely for prose. |
| UI/example | Typecheck and build; relevant Playwright controls, layout, transport and lifecycle checks, including real-model comparisons when affected. |
| Converter/core/runtime/plugins | Typecheck, `npm test` (prepare `example:assets` first), build and relevant browser/shader integration and regression checks. |
| CI/build | Inspect workflow/configuration and exercise affected setup, build, check and artifact paths; verify publication after merge only when required by the Issue. |

[`pages.yml`](../.github/workflows/pages.yml) currently runs build, typecheck,
`npm test`, the full browser suite, `npm run check:links` and whitespace validation
on PRs and `main` pushes, without change-based selection. This guidance does not
alter those configured checks or waive applicable pre-merge acceptance. The link
command also checks built assets and requires `dist`; documentation-only link and
anchor inspection can use available tooling without building the application.
Full-matrix performance repetitions are opt-in diagnostics via the
`browser-performance` label or dispatch input; native-WebGPU tests explicitly skip
without an adapter. Neither is a routine additional completion gate. The required
shard workflow is described below.

## Four-runner validation and publishing gates (Issue #81)

The workflow keeps every existing test and threshold. It uses explicit stable file
assignments in [browser-shards.json](../tools/browser-shards.json), validated by
[browser-shards.ts](../tools/browser-shards.ts). Each Actions VM runs one Chromium
worker with CPU ANGLE SwiftShader, the supported Ubuntu 24.04 image and pinned
Playwright dependency. The dev/preview servers still use ports 43179/43180 and
refuse to reuse existing servers. All tests now honor the existing optional
`MMD_PREVIEW_PORT` override for isolated local runs; the default remains 43180.
No test assertions, GPU flags, retries or timeouts changed.

The required dependency graph is:

- `typecheck` starts immediately (including whitespace checks).
- `prepare` verifies manifest-pinned sources, prepares all assets once and builds
  `dist`. It uploads an unfiltered `--list` manifest, the Pages artifact and a
  compressed `validated-build` tar containing `dist`, `public`, and the two source
  cache directories. Other jobs use this run's artifacts only; npm is installed
  separately. Model notices, source hashes and built URLs are preserved.
- After preparation, `fast-checks` runs browser integration smoke, Node/extension
  tests and built-site link checks. Smoke covers BDEF, loading/recovery, source transport
  and public assets on the same dev/preview setup; it supplements full shards.
- Four `browser` jobs run in parallel, with matrix fail-fast disabled so one
  failure does not cancel another shard's evidence. There is no `continue-on-error`.
- `build` (the existing required check name) runs after every shard, including
  failures. It checks the four summaries against the unfiltered list, verifies exact ID coverage, mapping,
  attempts, statuses and commit/run/attempt identity, and requires the browser
  matrix, typecheck, fast-checks and preparation results to succeed. Missing
  artifacts or summaries fail validation. The final check also runs when
  preparation fails, so a skipped required check cannot mask that failure
  ([GitHub status-check semantics](https://docs.github.com/en/pull-requests/reference/status-checks)).
- Main push `deploy` needs **all five** required job groups above. GitHub's implicit
  success condition prevents publication on failures, cancellations or skipped
  dependencies. The `github-pages-attempt-N` artifact is the exact build tested by
  the other jobs; deployment neither rebuilds nor runs another browser suite.
  Its name is a preparation-job output, so a deployment-only retry uses that
  same tested artifact.

PRs and dispatches run validation without deploying. Main pushes validate the
merge commit before deploying. Unrelated PR label events skip validation and
retain their separate concurrency group so they cannot cancel a real run.
`browser-performance` labels and the dispatch boolean opt into a separate
`browser-performance` job; ordinary runs never replay full matrices. This optional
job is outside the publication critical path. Existing per-ref cancellation and
PR/main trigger selection remain; no doc-only or path-based bypass was added.

### Measured assignment and baseline

The downloaded `browser-evidence` artifact of [main run
41304304814](https://github.com/takahirox/mmd-gltf/actions/runs/41304304814)
contains 102 cases: 100 passed, two optional native-WebGPU skips, no retries.
The [retained baseline](browser-ci-sharding-baseline.json) records every case's
status/duration, suite totals, workflow/source SHA, timestamp, artifact ID/digest,
environment and job/step timings. The workflow at SHA
`855b189c0d43beeb1ac20ba317ee246b9982d2f3` used Ubuntu image
`20261025.353.1`, Node `v22.23.4`, Chromium `141.0.7390.37`, AMD EPYC 7763
(four logical CPUs), Azure northcentralus; npm cache missed and source cache hit.

Observed baseline browser wall time was **55.13 minutes** (step ~55.15), workflow
wall time **62.97 minutes**, required checks **62.05 minutes** from run creation,
and total unrounded runner execution **62.87 runner-minutes**, including deploy
(62.00 excluding deploy). Initial scheduling delay was ~3 seconds. Job timings
include setup/cleanup; total runner-minutes are execution time, not rounded billing.

Using the actual per-case durations, Playwright's built-in four-way file/test-count
sharding would assign 31/21/26/24 cases and duration sums of
**16.90/12.59/9.42/16.09 minutes**. Greedily assigning the longest measured files to
the least-loaded group gives the following stable plan instead. These are sums of
historical case times, **not measured parallel-run wall times**:

| Shard | Suites (`.spec.ts`) | Cases | Baseline case minutes |
| --- | --- | ---: | ---: |
| 1 | solver, gene-ik, sdef, group | 37 | 14.36 |
| 2 | body-motion, qdef, physics, example | 19 | 14.12 |
| 3 | uka, unified-demo, bone-morph, vpd, outline, public-assets, bdef | 24 | 13.27 |
| 4 | vmd, public-motion, sleeve-motion, bfcache, demo-loading, mmd-resource-path, source-transport | 22 | 13.25 |

The projected worst group is 14.36 minutes, with 55.00 total browser case minutes.
Setup, shared-build packaging/download, server start and queueing add elapsed time
and runner cost; the early smoke intentionally repeats five cases. Four VMs plus
fast checks may increase cost. Sharing conversion avoids four extra builds (~1.92
minutes each in the baseline), but hosted artifact-transfer cost versus rebuilding
still needs measurement. Local macOS packaging took 6.10 seconds for a
294,006,962-byte archive; all 1,107 archived files matched source bytes. These
local numbers do not measure Actions transfer/setup cost.
**Approximately 20 minutes is a target, not an achieved result or guaranteed
fourfold speedup.**

The [downloaded PR comparison](browser-ci-sharding-comparison.json) from [run
41299511791](https://github.com/takahirox/mmd-gltf/actions/runs/41299511791)
has tested merge SHA `e8b659fae23a75c658b79d75a7d1e415fc0b077b` (from checkout
logs), distinct from the API's PR head SHA. Its tree and main's tree are both
`113c57d1ae728606ca41bd46dd49b295abbed09d`; all 102 case titles/statuses,
image, Node/Chromium versions, CPU and cache hit/miss states match. The PR ran in
centralus and took 55.29 browser minutes, 61.98 required-feedback minutes and
61.93 runner-minutes. This identical-tree comparison uses different commits/events.

An **exact-SHA repeat** was then dispatched using the existing serial workflow,
with matrix diagnostics disabled and Pages deployment skipped: [run
41317456944](https://github.com/takahirox/mmd-gltf/actions/runs/41317456944),
[normalized case/environment/timing evidence](browser-ci-sharding-repeat.json).
Checkout logs confirm SHA `855b189c0d43beeb1ac20ba317ee246b9982d2f3`. It passed
100 cases with the same two native skips and no retries. The downloaded ZIPs for
all three runs match the digests in Actions artifact metadata.

The exact-SHA pair observed browser median **55.11 minutes**, range
**55.09–55.13**; required-feedback median **61.83 minutes**, range
**61.60–62.05**; required runner-execution median **61.78 runner-minutes**, range
**61.55–62.00**. The dispatch's whole workflow took 61.60 minutes and used 61.55
runner-minutes, with ~3 seconds initial queueing. Main's 62.97 minutes/62.87
runner-minutes include deployment. Image, Node/Chromium and four logical CPUs
matched; the repeat used Intel Xeon Platinum 8370C in westus3 rather than AMD EPYC
7763 in northcentralus, and npm cache hit rather than missed. Both source caches
hit. Two observations do not characterize long-tail variability or establish a
single cause for the historical 10/31–11/1 slowdown.

Applying the stable groups to the repeat's case durations gives projected case
sums of **14.63/14.16/13.04/13.16 minutes**. These support the initial balance but
remain projections, not observed independent-runner shard wall times.

New-workflow Actions runs, PR-head validation of this change and merged-main
publication cannot be performed before the implementation is published; this node
explicitly prohibits pushes/PRs/merges. There is therefore no achieved
**new-workflow** hosted median/range, worst actual shard, new total runner cost,
or demonstrated deployment result yet. Do not attribute the 10/31–11/1 change
solely to version 0.1.3 or the three new Uka tests. The ~20-minute target requires
published, repeated sharded measurements.

### Evidence, reproduction and redistribution

Each required shard uploads `browser-evidence-N` with `if: always()`, erroring on
missing files. `browser-smoke-evidence` is separate. Summary schema v2 preserves
stable Playwright test IDs, final outcomes, every retry's status/duration/errors,
stdout/stderr, annotations (including skip reasons), attachment references and
phase JSON, plus source/run identity, runner CPU/image and installed browser
version. Screenshot and JSON oracle/phase files remain in the shard artifact.
Only the two exact optional native-WebGPU case titles may skip; hardware adapter
availability may make them pass. Any other skip or expected failure blocks the
aggregate. Unexecuted, interrupted or missing cases cannot pass completeness.

`browser-aggregate` contains `browser-aggregate.json`: all shard summaries and
attempt records, completeness errors, slowest browser wall time and sum of browser
wall times. These browser-only measures exclude installation, queue and build;
use Actions job timings for full required latency and runner cost.

```sh
npm ci
npm run build
# Reproduce one failing shard without competing servers/workers:
BROWSER_SHARD=2 PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser
# If another local worktree uses 43180, also set MMD_PREVIEW_PORT to a free port.
# List all expected IDs; --list never replaces measured summaries:
BROWSER_LIST_PATH=.cache/browser-manifest.json npm run test:browser -- --list
# Download this run's manifest to .cache/browser-shards/browser-manifest.json,
# and shard artifacts into .cache/browser-shards/browser-evidence-{1,2,3,4}/.
npx tsx tools/browser-aggregate.ts
# Read-only collection of actual queue/critical path/job/step/cost timings:
npx tsx tools/browser-ci-metrics.ts RUN_ID RUN_ID_OF_UNCHANGED_COMMIT_REPEAT
```

Validation artifacts replace the previous attempt on a full workflow rerun.
Use **Re-run all jobs** for validation retries: the aggregate deliberately rejects
mixed-attempt browser evidence. Deployment-only retries may reuse the completed
validation and its recorded Pages artifact. For controlled timing repeats, prefer
separate dispatch runs of the same SHA and preserve both sets of artifacts.

Archive each invocation's `test-results` before another Playwright invocation,
which clears it. Set `GITHUB_SHA`, `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` to the
original run when independently rechecking downloaded CI evidence. The metrics
collector writes `.cache/browser-ci-metrics.json`; preserve it with summaries/logs.
It reports actual execution minutes, not a monetary or rounded billing estimate.
Only successful runs enter the feedback median/range; failed/cancelled runs retain
their individual timings and conclusions.
PR API metadata can identify the head rather than the tested synthetic merge;
compare summary `commit`/`workflowSHA`, case IDs and environment before treating
runs as unchanged/equivalent.

New cases in existing files inherit that file's shard automatically. New `.spec.ts`
files fail shard configuration until explicitly assigned; test listing/completeness
still checks the entire registered set. The mapping test models adding a future
`public-physics.spec.ts` (Issue #77/PR #79) to shard 4 and verifies coverage without
depending on that work. Rebalance against new measured durations when a shard's
elapsed time dominates or threatens the ~20-minute target; include the workload,
new mapping and before/after timings in review. Do not change numerical/raster
thresholds or replace GPU/readback and independent pixel oracles with Node checks.

Before claiming the timing goal, run this exact workflow/source SHA at least twice
on Actions, save the environment, caches and region from job logs, compare
median/range of required feedback, worst browser shard, total runner-minutes and
all pass/skip/failure counts. Validate the PR head, then verify the merged main
SHA's matching Pages artifact after merge. With explicit remote authorization,
use a disposable failing-test branch/PR to verify early failure, blocking aggregate
and uploaded artifacts; remove it afterward. Local reporter/aggregate failure
injection tests are useful but do not demonstrate hosted scheduling or deployment.

The [worktree validation record](browser-ci-sharding-validation.json) retains
normalized local case IDs/statuses/durations and checks. All four groups were run
**sequentially** on macOS with one worker: 37/19/24/22 cases, 100 passed and the two
documented native skips, no retries; completeness accepted all 102 IDs. Smoke
passed all five cases. A disposable real-browser failure returned 1 and preserved
its screenshot, assertion, diagnostic output and phase JSON; omitting shard 4 made
the aggregate return 1 and identify all 22 missing IDs. These local checks do not
measure parallel hosted latency or demonstrate an Actions deployment.

A native Node WebGL/WebGPU capture prototype or hardware-GPU runner is a separate,
optional follow-up. Compare identical pixel/vertex/normal, determinism, lifecycle
and shader-compatibility cases at unchanged thresholds first. The experimental
[three.js PR #34572](https://github.com/mrdoob/three.js/pull/34572) is not evidence
of equivalence or an adopted replacement baseline. CPU SwiftShader remains required.

## Browser CI evidence

The following sections retain the historical #54/#57 measurements and workload;
they are not current 102-case full-CI timing claims.

Issue [#54](https://github.com/takahirox/mmd-gltf/issues/54) builds on the merged
[#53](https://github.com/takahirox/mmd-gltf/pull/53). The Uka integration, synthetic
scalar oracles, bitmap capture, and SDEF/QDEF format reductions from #53 remain.
This change reduces the remaining Solver and VMD-family conformance matrices;
it does not attribute #53's improvements to this work.

## Execution and measurement

The default remains one Chromium worker with ANGLE SwiftShader. CI uses four
independent runners with one worker each; local unfiltered runs remain single-worker.
Test timeouts and GPU flags are unchanged. Build production assets first:

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
Each shard artifact retains its summary and per-test attachments.
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
[`measure-browser-ci.sh`](../tools/measure-browser-ci.sh) in a separate opt-in Ubuntu 24.04 diagnostic job. That job first runs its own complete unfiltered default suite, then repeats matrices on that **same** runner. A manual workflow dispatch can also enable
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
fails the job and preserves its evidence. The diagnostic job restores its original complete-suite results even on failure. Required shard evidence is uploaded independently as `browser-evidence-1` through `browser-evidence-4`.
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
