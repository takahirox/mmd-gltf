# Unified public demo (Issue #49)

The root `/mmd-gltf/` now exposes Gene Light and all 24 synthetic presets without
navigation. **Model** selects the comparison or rigs; **Preset** groups skinning,
morphs, IK/append and physics. The former `rig.html` entry redirects to the root
with `?demo=rig`, preserving backend selection.

The viewport comes before controls. Rig actions live in native keyboard-accessible
Motion, Pose, Morph weights, IK/append, Physics, Skinning comparison and Export
snapshot disclosures. Local VPD/VMD, encoding, explicit bone/morph binding and
unmatched-name policies remain available inside the corresponding workflow.
Only applicable capabilities and sample motions are offered. **Fit view** frames
the current deformed rig after motion or settling.

Each viewer starts on demand and owns one renderer, controls and loop. Inactive
viewers retain their managed scene/camera resources but stop rendering; rig
playback pauses on exit and resets its wall clock on return. Replacing a rig or
retained-curve motion disposes the old players, Ammo rigs, outline/skin plugins,
geometry, materials, textures and skeletons. Page exit releases viewer resources.
Failed comparison startup releases partial resources and supports an in-place
retry. A failed asset fetch keeps the previous rig; a later binding-map failure
keeps the newly loaded rig, selector and diagnostics consistent.
Rendering equations and skin/morph/solver/physics behavior retain their existing
implementation; this change concerns demo layout, integration and lifecycle.

Gene Light's full creator attribution, license, additional usage guidance,
original notices, source hashes and conversion record remain in **About &
credits**, alongside methodology and synthetic source/report links. The visible
fidelity note appears once; detailed qualifications remain in that disclosure.

## Validation

Local pre-merge validation on 2026-10-25 used headless Chrome with SwiftShader
WebGL2 and the built `/mmd-gltf/` prefix.

- `npm run typecheck`: passed.
- `npm test`: all 118 Node tests passed, along with the Toon/Outline fixture checks.
  The initial invocation preceded generated fixtures and failed with missing-file
  errors; the invocation after asset generation passed.
- `npm run build`: passed, including verification of all 13 pinned Gene source
  files. Vite reports its existing large Three.js chunk warning.
- `npm run test:browser -- --reporter=line`: 72 passed, two optional native WebGPU
  checks skipped, one failed in 55.8 minutes. The failure was the new comparison
  retry → rig test's five-second startup wait. UI startup assertions now allow
  a bounded 30 seconds and explicitly require the rig's loaded status.
- The full run passed the independent numerical/conformance harnesses, including
  208 QDEF and 176 SDEF comparisons, and the BDEF, morph, solver, physics, VPD/VMD,
  outline and source-hash checks. Numerical tolerances and expected values were
  not changed.
- Final focused rerun against the final build: **13 passed, one optional WebGPU
  check skipped** (4.5 minutes). This reran the failed startup case successfully
  and covered the late binding-map fix and pending-motion switch case. Command:
  `npm run test:browser -- tests/browser/demo-loading.spec.ts tests/browser/unified-demo.spec.ts tests/browser/example.spec.ts tests/browser/vpd.spec.ts --reporter=line`.
  A subsequent mobile-only rerun passed after resetting page scroll for the
  screenshot capture; application code was unchanged.
- `npm run check:links`: passed, 404 local links, anchors and built asset links.
- `git diff --check`: passed.

The final focused command covers comparison rendering/toggles, all 24 presets,
both-direction switching, paused inactive viewers, resizing/mobile controls,
local files, export, failure/retry, late binding-map failure, and a motion response
that finishes after switching to Gene. Normal-flow tests reject console, shader,
page and network errors; failure tests deliberately inject missing resources.

Native WebGPU was skipped because no adapter was available. WebGL2 ran through
all required paths. Historical numerical evidence files are retained; new UI
captures are stored separately below.

## Visual inspection

Inspected the actual browser PNGs, not only DOM measurements:

| Capture | Findings |
| --- | --- |
| [Desktop landing](unified-demo/landing-desktop.png) | Both full-body references dominate the page; synchronized panes share light-gray backgrounds, with three compact toolbar controls and one fidelity note. |
| [Motion and morphs](unified-demo/morph-desktop.png) | The deformed rig fills the viewport; playback and independent weights are legible in the adjacent scrollable controls. Four-decimal display avoids long float noise. |
| [IK and physics](unified-demo/physics-desktop.png) | After motion, IK override and settling, **Fit view** centers the visible snapshot. Physics, IK, morphs and export remain reachable without a second page. |
| [Mobile landing](unified-demo/landing-mobile.png) | At 390 × 844, both references remain usable in stacked panes; controls wrap without horizontal overflow. Credits and methodology remain in an accessible disclosure. |
| [Mobile rig](unified-demo/rig-mobile.png) | A large viewer precedes compact disclosures. Mode/shape stay visible in the preset label; morph fields and playback controls remain readable. |
| [Resized physics view](unified-demo/physics-resized-mobile.png) | Desktop → narrow resize preserves framing and the selected PBR/Outline/camera state. Physics and export remain accessible below the viewport. |

Visual review caught an off-screen settled fixture in an early capture; the
explicit **Fit view** operation now frames it. Initial model framing also fits
visible geometry, and resizing preserves zoom relative to the short edge. A
full-page screenshot taken while scrolled retained the sticky status bar mid-page;
the final mobile evidence resets scroll to the opening view before capture.

Gene Light screenshots credit CG-CA Gene (c) 2023 by Nagoya Institute of
Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society. Model imagery is
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) with the original
[additional usage guidance and retained rights](gene-light.md). Synthetic rigs
are authored in this repository.

## Required post-merge verification

Pending deployment after merge: record the published commit and Pages workflow
outcome, then open <https://takahirox.github.io/mmd-gltf/> and verify in-place
Gene/rig selection, comparison toggles, representative playback/morph/physics,
notices, and desktop/mobile presentation without runtime or asset failures.
This publication check cannot be completed in the pre-merge worktree.
