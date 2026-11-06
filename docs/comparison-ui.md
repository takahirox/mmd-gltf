# Public comparison layout (Issues #83 and #89)

The public page prioritizes the real MMD/glTF comparison. Model, Motion, Display,
Outline, IK and Physics share one toolbar. Uka's Expression selector appears
beside Motion only in Rest / manual mode and stays disabled until loading finishes.
Playback uses one timeline below the shared canvas, with Play/Pause, Restart,
time, fractional seeking and Loop. Reset camera sits at the viewer's top right;
only the button receives pointer events, leaving orbit, pan, zoom and touch
available on the surrounding canvas. It restores the selected model's initial
shared orbit, target and zoom without replacing its renderer.

There is no Details button or sidebar. Above 900px the two panes share the full
available width; each stays at least square to retain complete model framing on
tall windows. At 900px and below the viewers stack vertically. The existing
collapsed About & credits contains model-specific downloads and source links,
a nested collapsed Technical diagnostics disclosure, duration provenance and all
source, rights, backend-license, conversion and fidelity qualifications. Physics
loading, simulation, unavailability and failure messages, IK execution failures
and loading Retry remain above the viewer. Physics stays Off until explicitly
enabled, including the Gene Apology + IK On restriction. Diagnostic DOM IDs and
programmatic state remain available even while the disclosures are closed.
The internal rig deep link and its controls are unchanged.

## Sidebar removal (Issue #89)

The focused layout test checks full-width geometry, complete model framing,
keyboard controls, About/resources/diagnostics and no overflow from 1440px down
to 320px. Real pointer orbit/pan/wheel, mobile-emulated touch orbit/pinch and
keyboard/pointer/touch Reset check synchronization and gesture handling. Existing
rendering, expression, material, Outline, physics and resource-lifetime assertions
remain. Responsive desktop-browser captures (Chromium/SwiftShader, reduced motion):

| Viewport | Sidebar-free comparison |
| --- | --- |
| 1440 × 900 | [Desktop](comparison-ui/sidebar-free-1440.png) |
| 900 × 900 | [Tablet](comparison-ui/sidebar-free-900.png) |
| 390 × 844 | [Mobile](comparison-ui/sidebar-free-390.png) |
| 320 × 844 | [Narrow mobile](comparison-ui/sidebar-free-320.png) |

These images retain Uka's original copyright and license; see the notices below.
They are browser emulation, not physical-device results.

### Local validation (2026-11-06)

Validation used macOS (Darwin 27.2.0), Apple M4 Max, Node 26.12.1,
Playwright 1.56.1, pinned Chromium 141.0.7390.37 and SwiftShader WebGL2,
one worker per shard.

- `npm ci`: passed.
- `npm run build`: passed, including pinned source verification and fixture
  generation. The existing large-chunk warning remains.
- `npm run typecheck`: passed.
- `npm test`: **189 passed**, zero failures/skips, plus Toon/Outline fixture checks.
- Focused layout and touch checks: **2 passed**, zero failures/skips.
- All four required browser shards: **116 passed, 2 optional native-WebGPU skips,
  zero failures or retries**.
- Unfiltered manifest aggregation: **118/118 test IDs exactly once**, 118 attempts,
  no missing or duplicate cases; passed.
- `npm run check:links`: **577** local documentation, anchor and built-asset links passed.
- `git diff --check`: passed.

| Required shard | Passed | Optional skips | Local elapsed |
| --- | --- | --- | --- |
| 1 | 37 | 0 | 759.9 s |
| 2 | 18 | 1 | 725.9 s |
| 3 | 25 | 1 | 713.3 s |
| 4 | 36 | 0 | 1116.4 s |

Full shard commands used `BROWSER_SHARD=1` through `4`,
`PLAYWRIGHT_CHROMIUM_CHANNEL=chromium`, `MMD_PREVIEW_PORT=43181` and
`npm run test:browser`. The unfiltered `--list` manifest and all four summaries
passed `npx tsx tools/browser-aggregate.ts .cache/issue89`. Shards ran sequentially
locally; these times are not hosted CI performance measurements. No workflow,
shard assignment, numerical/raster threshold or optional-skip policy changed.

The only skips were the public comparison and Outline native-WebGPU cases,
both reporting that no native WebGPU adapter was available. Required WebGL2
checks ran independently. Public rendering, expression, Outline, camera,
keyboard/touch, source-duration, IK/Physics, failure/retry, cache restoration and
rig conformance checks all passed. The Gene Apology + IK On test confirms a
visible, accessible Physics restriction with About closed; backend loading and
failure cases also check visible status outside About.

Hosted GitHub Actions validation is not claimed for this worktree-only node.
No push, PR, merge or deployment was performed. Required post-merge verification
remains pending: confirm the exact merged Pages deployment SHA, assets and Ready
desktop/mobile panes. Physical-device and original Windows MMD verification
remain unperformed.

## Historical evidence for Issue #83

The following captures and validation record describe the earlier sidebar design,
which Issue #89 supersedes; they are retained as historical evidence.

## Layout evidence

Screenshot assets retain their creators' rights: CG-CA Uka (c) 2023-2024 and
CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar
Symbiotic Society. See the [Uka notices and license](uka.md#rights-and-acquisition)
and [Gene Light provenance and terms](gene-light.md). No endorsement is implied.

Captures use the authentic licensed Uka/Gene Light assets, headless desktop Chrome
and reduced motion. Images capture the full page at the listed viewport size.
Before uses Chrome 157.0.8103.38; after uses pinned Chromium 141.0.7390.37.
Widths denote CSS pixels; these are responsive desktop-browser
checks, not physical-device results. Before captures use the upstream HTML, CSS
and runtime at `4175748` with the same pinned assets. After captures come from the
updated built page and the existing Playwright suites.

| Viewport | Before | After, Details closed | After, Details open |
| --- | --- | --- | --- |
| 1440 × 900 | [Desktop](comparison-ui/before-1440.png) | [Desktop](comparison-ui/after-1440-collapsed.png) | [Desktop Details](comparison-ui/after-1440-expanded.png) |
| 900 × 900 | [Tablet](comparison-ui/before-900.png) | [Tablet](comparison-ui/after-900-collapsed.png) | [Tablet Details](comparison-ui/after-900-expanded.png) |
| 390 × 844 | [Mobile](comparison-ui/before-390.png) | [Mobile](comparison-ui/after-390-collapsed.png) | [Mobile Details](comparison-ui/after-390-expanded.png) |
| 320 × 844 | [Narrow](comparison-ui/before-320.png) | [Narrow](comparison-ui/after-320-collapsed.png) | [Narrow Details](comparison-ui/after-320-expanded.png) |

Additional states: [long sample label at 320px](comparison-ui/after-320-sample.png),
[playing](comparison-ui/after-desktop-playing.png),
[visible load error and Retry](comparison-ui/comparison-error-390.png),
[Gene Apology Physics restriction](comparison-ui/gene-apology-unavailable-320.png).

## Validation

Local validation on 2026-11-04 uses macOS, Node 26.12.1, Playwright 1.56.1,
pinned Chromium 141.0.7390.37 and SwiftShader WebGL2, one worker per shard.
`MMD_PREVIEW_PORT=43280` avoids an unrelated process on the default preview port;
repository configuration and shard assignments are unchanged.

- `npm ci`: passed.
- `npm run build`: passed, including all pinned source hashes and generated
  fixtures; the existing large-chunk warning remains.
- `npm run typecheck`: passed.
- `npm test`: 186 passed, zero failures/skips, plus Toon/Outline fixture checks.
- Final focused UI checks: 2 passed; the corrected Gene WebGL comparison also
  passed its focused rerun with every original pixel/precision assertion.
- All four required browser shards: **111 passed, 2 optional native-WebGPU skips,
  0 failed**. Both skips lack an adapter; no required check is skipped.
- Unfiltered manifest aggregation: **113/113 test IDs exactly once**, passed.
- `npm run check:links`: passed, 553 local documentation, anchor and built-asset links.
- `git diff --check`: passed.

| Required shard | Passed | Optional skips | Local elapsed |
| --- | --- | --- | --- |
| 1 | 37 | 0 | 666.4 s |
| 2 | 18 | 1 | 646.4 s |
| 3 | 24 | 1 | 610.1 s |
| 4 | 32 | 0 | 876.8 s |

The shard commands use `BROWSER_SHARD=1` through `4`,
`PLAYWRIGHT_CHROMIUM_CHANNEL=chromium` and `MMD_PREVIEW_PORT=43280` with
`npm run test:browser`. The existing `tools/browser-aggregate.ts` checks the
unfiltered manifest against all four saved summaries. Shards ran sequentially
locally; these elapsed times are not hosted CI performance measurements. No
workflow, shard assignment, assertion threshold or optional-skip policy changed.

Existing shader, precision, motion, physics, teardown and rig assertions remain
in place; behavior tests explicitly open Details when exercising its secondary
controls. The public layout case additionally checks keyboard tab order and Enter/Space activation,
accessible toggle names, equal pane priority, touch target and slider dimensions,
no overflow at all four widths, restored viewer width, both characters' camera
reset (including pending inertia with default damping), persistent orbit across
resizing, one canvas, no static asset refetch on layout/motion/material/expression
changes, and no Physics native allocations while Off. The restriction case checks a visible accessible disabled reason with
Details closed; the retry case checks an announced, visible failure and recovery.

The first Node invocation preceded completed source acquisition/fixture generation
and failed on incomplete/missing inputs; the subsequent complete run passed.
The first UI shard found the internal rig viewport at y=327.5px on mobile, above
its existing <300px limit. Compacting only the rig header and toolbar restores
y=291.5px; the assertion and 44px control heights remain intact. The focused
rerun passed both that workflow and the complete public layout/camera case.
The first built-page run also found an obsolete zero-paragraph assertion: the
new Rest-mode expression help exists inside the hidden Uka section. Gene now
asserts that entire section is hidden, while retaining the original rendering,
pixel and precision checks. An in-progress solver shard was interrupted for the
final rebuild and restarted.

Required post-merge verification remains pending: confirm the exact merged commit's
Pages deployment, assets and both Ready panes. No deployment or remote write is
performed by this implementation. Physical mobile-device tests are unperformed.

### Physics replay CI correction (2026-11-05)

[Hosted shard 4, run 41852145132](https://github.com/takahirox/mmd-gltf/actions/runs/41852145132/job/126651966753)
failed because the Uka 9.9-second seek exceeded the test's 90-second poll. Its
`physics-failure.json` artifact records a completed replay in **113,651.9 ms**:
Physics On, tick **1188**, time **9.9**, no constraint failures, and a maximum
work slice of **62.8 ms**, below the unchanged 150 ms device limit. This was a
test wait-budget failure; the artifact does not show a stalled replay.

Only that long seek now gets a 180-second poll. Ordinary seeks retain 90 seconds,
the overall test retains 600 seconds, and all physics accuracy, pixel, world
reuse, cancellation and teardown assertions remain. The completed long seek also
checks the reference and both glTF clocks at exactly 9.9 seconds. No runtime,
solver, replay step, shard assignment or publishing gate changes.

Revision validation used the same local browser configuration above. `npm ci`,
build, typecheck, all **186 Node tests**, Toon/Outline fixture checks, links and
whitespace checks passed. All four required browser shard commands passed:
**111 passed, 2 optional native-WebGPU skips, no failures or retries**. Aggregation
passed with **113/113 unique test IDs**. Shards 1–4 took approximately 670, 649,
610 and 885 seconds respectively; these are local timings, not hosted measurements.
The Uka long seek completed locally in **52,368 ms**, at tick 1188 and time 9.9,
with no constraint failures or browser errors and zero native allocations after
cleanup. A hosted CI rerun for this correction remains pending publication;
this revision does not push or merge.

### Tablet framing correction (2026-11-05)

Details now opens below the timeline through 1200px. Above the 900px stacking
breakpoint, the stage height is capped relative to its width so each pane stays
at least square. This preserves Uka's complete default framing on tall tablets
without changing the camera or resetting an existing orbit. Closing the desktop
sidebar still restores the full viewer width.

The layout regression now includes 901 × 900, 1024 × 1366, and both sides of the
1200px sidebar breakpoint, with Details open and closed. It projects the full
rest bounds into both actual render cameras and requires them to fit, preserving
camera position and target across resizing and checking Reset at both reported
tablet sizes. The original layout fails this check with Details open on a tall
window. Captures: [901 × 900](comparison-ui/after-901-expanded.png) and
[1024 × 1366](comparison-ui/after-1024-expanded.png).

Revision validation: `npm ci`, `npm run build` plus the final CSS Vite rebuild,
typecheck, all **186 Node tests**, Toon/Outline fixture checks, **555 link checks**
and `git diff --check` passed. The focused `example`, `uka` and `unified-demo`
browser suites passed **18 cases**, with one optional native-WebGPU skip (no
adapter), zero failures and no retries, in 8.7 minutes. They used pinned Chromium
141.0.7390.37, SwiftShader and `MMD_PREVIEW_PORT=43181`. All existing pixel,
precision, controls and lifecycle assertions remain. The four full browser
shards were not repeated locally for this CSS revision; hosted verification is
recorded below. Required post-merge Pages verification and physical-device tests
remain unperformed.

### Hosted CI verification (2026-11-05)

The previously queued required
[`build` gate for run 41872129359](https://github.com/takahirox/mmd-gltf/actions/runs/41872129359/job/126740578189)
completed successfully for PR #84 head `fd523b72659143916699f3d1b3dc37cfb31f81a8`
(tested PR merge commit `def59d35f1d92af42b0979100ca2fd69c3f89d65`). Its log
confirms successful aggregation: **113/113 test IDs, 113 attempts, 111 passed,
2 optional skips**. The final prerequisite check also passed with `prepare`,
`typecheck`, `fast-checks` and all browser shards reporting success. No code or
workflow correction was needed. This resolves the pending pre-merge CI finding
for #83; required post-merge Pages verification remains pending.
