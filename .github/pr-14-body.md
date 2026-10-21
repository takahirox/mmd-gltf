## Summary

Original-MMD fidelity has not been established for the v0.1 material equations. This research checkpoint inspects the author's MikuMikuDance 9.32 x64 distribution and embedded effects, audits conflicting secondary ambient implementations, and records an evidence matrix and controlled capture protocol in `docs/original-mmd-research.md`.

Adds a reproducible generator for 80 synthetic PMX/GLB probe pairs and six synthetic textures, with validated assets, input hashes and explicitly uncaptured observations. Updates the specification, fixture guide, README, Gene Light comparison report and demo to state the fidelity limitation.

## Outcome and pre-merge acceptance

The agent-verifiable research checkpoint is complete: evidence provenance and limitations are documented, the current scope is audited, reproducible probe inputs are validated, and applicable automated checks pass.

Per [Issue #13's verification follow-up](https://github.com/takahirox/mmd-gltf/issues/13#issuecomment-6307160015), manual original-MMD verification is pending after merge. It is not an Issue completion criterion or a merge gate for this checkpoint.

This is partial progress toward Issue #13, with implementation still outstanding. No original-MMD execution, controlled captures, measured reference pixels or active no-shadow D3D9 state trace was available. Neither ambient coefficient 1 nor 0.5 is established. Equations, schema defaults, production plugin behavior, converter mappings and numerical expectations remain unchanged. Evidence-dependent spec/plugin/adapter corrections, independent measured fixtures and GPU comparisons remain implementation work once primary observations support them. Deferring manual verification does not establish corrected fidelity. Existing Gene Light captures remain secondary diagnostics.

## Validation

The implementation node recorded these passing checks in `docs/validation.md`:

- `npm ci`, `npm run typecheck` and `npm test`: eight converter/plugin tests, 43 draft shading vectors, ten shared mappings, 56 schema cases, ten asset cases and two complete glTF examples.
- `npx tsx tools/generate-mmd-probes.ts`: all 80 PMXs reparse; all 80 GLBs pass Khronos validation with zero errors; manifest hashes independently checked.
- `npm run build`: passes with the existing large-bundle warning.
- `npm run test:browser`: three passed; native WebGPU skipped because no adapter was available. WebGL2 production TSL and Gene Light navigation/toon-PBR checks pass.
- `npm run check:links` and `git diff --check`: pass.

Existing npm audit findings (one low, one high) remain; dependencies were not changed. These checks establish draft consistency and input preparation, not original-MMD fidelity. Optional native WebGPU validation remains unavailable.

For the verification-gate documentation revision, `npm ci --no-audit --no-fund`, `npm run build`, `npm run check:links` (74 links/anchors and built asset links), and `git diff --check` pass. The build retains its existing large-bundle warning. The first link-check attempt lacked local dependencies; lockfile installation and the build resolved it. Markdown, links and gate/status wording were reviewed across the complete documentation diff. Type, unit and browser suites were not repeated for this documentation-only revision.

## Required post-merge verification

Pending manual original-MMD verification: execute the identified renderer with recorded build/settings and capture provenance; obtain lossless frames, independent interior-pixel measurements and relevant D3D9 state observations following `docs/original-mmd-research.md`. Specifically distinguish ambient 0.5 versus 1 and RGB/alpha color-domain behavior, with evidence supporting comparison tolerances. Record actual results and resulting correction work when available; no observations are claimed here.

Pending after merge and Pages deployment: record the deployed commit/workflow; verify the public Gene Light example renders, toon/PBR switching works, notices/source assets load, and no shader/runtime/network errors occur. No merge or deployment verification is claimed.

These pending checks do not gate this research checkpoint's merge or Issue completion.

## Related Issues

Closes #13

This PR remains a draft: evidence-supported spec/plugin/adapter corrections, independent measured fixtures and GPU comparisons are outstanding.
