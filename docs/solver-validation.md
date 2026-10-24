# Issue #43 validation

The bounded pre-physics-v1 profile is validated with original synthetic works by
mmd-gltf contributors. This establishes analytical conformance, not measured
original-MMD or representative-model fidelity. The
[contract](../extensions/MMD_skeleton_solver/README.md) retains the old local-append
assumption, corrected requirement, primary author reference and rationale.
[Fixture provenance](../tests/fixtures/README.md#issue-43-solver-fixtures) and
[asset hashes / machine results](solver-validation.json) identify the inputs.

## Actual command outcomes

Environment: macOS 26.6.2 arm64, Node 24.12.0, npm 11.6.2, Three.js 0.186.1,
Playwright 1.56.1 and Chromium 141.0.7390.37. GPU observations use WebGL2 through
WebGPURenderer with Chromium SwiftShader.

| Command or check | Actual outcome |
| --- | --- |
| `npm ci` | Passed; 47 packages installed. Existing audit findings: one low, one high. No dependency changes. |
| `npm run build` | Passed; fixture generation and production build. Existing large-chunk advisory retained. |
| `npm run typecheck` | Passed. |
| `npm test` | 87 Node passes, zero failures/skips, plus Toon/Outline schema suites. |
| `npx playwright install chromium` | Passed; executable version verified. |
| `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser` | Initial full run: 47 passes, two optional skips, one legacy VMD readiness failure; 46.9 minutes. |
| Focused solver + legacy VMD rerun | All 16 solver cases passed. The former combined legacy VMD case exhausted its 180-second scenario budget; 18.8 minutes total. |
| Per-rig legacy VMD rerun | Both cases passed, including both motions and every source; 2.2 minutes. |
| Mixed solver Demo comparison smoke | Both SDEF/QDEF presets, six precise/approximate/restored states passed; maximum position error 1.30e-8 m. |
| `npm run check:links` | Passed; final count is in the machine record. |
| `git diff --check` | Passed. |

Every current nonoptional browser scenario has a passing result across the full
and focused runs: 49 scenarios after partitioning the former combined lifecycle
case. This is **not** a claim that a second complete-suite command was run.
The two existing optional native-WebGPU cases skipped. Controlled original-MMD
measurements remain uncaptured. No required post-merge verification is added.

## Numerical and rendered results

[Node measurements](solver-node-validation.json) cover both motions on both rigs
through bytes, retained GLB, external-buffer glTF and ordinary-loader fallback.
Each rig/motion has the 1,201-point grid plus 16 boundary/repeat probes, including
exact IK switches and their preceding FLOAT values. Maximum joint orientation
error is 2.41e-7 rad and CPU BDEF vertex error is 6.24e-8 m, within the required
1e-5 rad / 2e-6 m bounds. Both VPD poses are applied, repeated and reset on both
rigs. All 60 generated skinning/rest/motion/pose GLB/glTF files validate without
core errors. In-memory binary limited-link variants cover PMX 2.0/2.1 FLOAT pi;
source limits remain unchanged when execution bounds canonicalize to pi.

The built conformance page measures actual GPU vertices/normals and independent
baked Toon/PBR surface and Outline rasters. Limits remain 1e-4 m GPU position,
5e-4 normal component, two encoded levels and 128 of 25,600 pixels.

| Skinning | Comparisons | Max CPU position (m) | Max GPU position (m) | Max GPU normal component | Max mismatched pixels |
| --- | ---: | ---: | ---: | ---: | ---: |
| BDEF | 208 | 1.74e-8 | 4.67e-8 | 1.86e-7 | 0 |
| SDEF | 208 | 1.21e-8 | 4.25e-5 | 1.05e-4 | 2 |
| QDEF | 208 | 1.73e-8 | 3.68e-5 | 1.05e-4 | 3 |

The 624 comparisons cover both rigs/motions/poses, bytes/GLB/glTF, applied-state
exports and both material paths. CPU probes also check direct/group weights,
updated bounds and the ordinary-loader advanced-skinning approximation. Negative
controls disable IK or deliberately deform using the raw palette before
IK/append. The latter prediction is independently checked against solver-free
conversion; a later joint update cannot repair already deformed vertices. The
smallest per-case maximum negative separation is above 0.39 m, far beyond the
position tolerance. Hinge probes additionally cover off-axis inputs, nonidentity
rest frames, signed quaternion representations, angle wrapping, limits and caps.

[Saved canvases and per-case measurements](solver-captures) capture actual pixels
before renderer disposal. Four Demo records pair predicted joints/vertices with
the acknowledged render revision and canvas. They cover both rigs/motions and
all three source paths, both VPD handoffs, repeat/reset, IK overrides, transport,
looping/endpoints, exported states, failed-load recovery and disposal.
[Additional Demo measurements](solver-ui-validation.json) verify mixed SDEF/QDEF
presets and that comparison controls publish the vertices actually rendered.

## Readiness observation correction and failures

The first Node attempt preceded generated assets and failed on missing
`public/*` files; rebuilding resolved it. Export observations exposed joint
matrices where the solver contract requires TRS, and a hidden PBR scene excluded
by visible-only traversal. The exporter now preserves TRS and the Demo exports
with `onlyVisible: false`. Early post-disposal screenshots were blank; the harness
now saves actual pixels before disposal. None of these findings waived a gate.

The complete browser run's legacy lifecycle failure exposed this old assumption:
“Rest state” identifies completion of the newly selected rig. That label already
existed from the preceding reset. The corrected test waits for the selected
rig's acknowledged rendered revision before checking controls or capturing rest.
Primary evidence: the [load/reset implementation](../examples/rig.ts),
[lifecycle test](../tests/browser/vmd.spec.ts), and a failure snapshot that showed
the selected rig loaded and enabled after the assertion's deadline.

The next focused run passed all solver cases but the legacy combined matrix
exhausted its 180-second budget during material controls. It is now partitioned
per rig, matching existing SDEF/QDEF/group Demo cases. Both retain both motions,
all sources, playback, both VPD handoffs, local recovery and original-rest checks
with the same 180-second budget and five-second control assertions. The existing
30-second rendered-state convention identifies the correct data before those
assertions. Each case requires at least 12 disposals (preserving the former
combined minimum of 24), then explicitly verifies cross-rig replacement and two
further disposals in both directions. No scenarios, precision/raster thresholds
or existing test timeouts were removed or increased. Both final cases passed.
