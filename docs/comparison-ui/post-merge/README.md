# Issue #83 post-merge verification

PR [#84](https://github.com/takahirox/mmd-gltf/pull/84) merged with a merge commit:
`d1958dcc3c1666d4e5116c5f3a7461de1059a485`. Its parents are main
`fc72492e8e6cfa43b48ba1e30b59e8a06ab8bf00` and the unchanged approved head
`8ecd132f9f21b3ccc31520dd359ef26b7db451d6`.

Immediately before merging, Issue #83 was freshly read as open, the PR still had
the approved head, targeted main, was mergeable/CLEAN, and all eight required
current-head checks had succeeded in
[run 41880068914](https://github.com/takahirox/mmd-gltf/actions/runs/41880068914).
The saved exact-head approval was reused; equivalent local suites were not rerun.
The PR's automatic Issue-closing keyword was removed before merge so the required
post-merge checks could finish before closure. No check or review was bypassed.

## Exact-commit deployment and CI

[Merge workflow 41924269865](https://github.com/takahirox/mmd-gltf/actions/runs/41924269865)
passed typecheck, preparation, fast checks, all four browser shards, the final
aggregation/build gate and deployment. Deployment `7560033859` targets the exact
merge SHA in the `github-pages` environment and succeeded at
2026-11-04 22:53:14 UTC.

[CI summary](ci-summary.json): 113 distinct test IDs, 113 attempts, **111 passed,
2 skipped, 0 failed, no retries**. The skips are the two optional native-WebGPU
cases because no adapter was available; required WebGL2 coverage passed. The
optional browser-performance job was skipped, as configured. CI configuration and
sharding were unchanged.

## Public-origin results

The deployed [public site](https://takahirox.github.io/mmd-gltf/) was checked from
22:53:25 to 22:54:15 UTC on 2026-11-04 using headless desktop Chromium
141.0.7390.37 with SwiftShader and reduced motion.

[Machine-readable evidence](public-verification.json) records:

- HTML and all ten loaded CSS/JavaScript bundles matched SHA-256 hashes of the
  prepared `github-pages-attempt-1` artifact from the exact merge workflow.
- Both Uka and Gene Light reported Ready for the overall comparison and each
  MMD/glTF pane. Each model had 13 decoded reference textures with nonzero sizes.
- All 16 combinations of two models, 1440×900 / 900×900 / 390×844 / 320×844
  viewports, and Details closed/open passed. Pane sizes were equal, desktop panes
  were side by side, smaller panes stacked, primary controls stayed in bounds,
  and the document had no horizontal overflow. Details was keyboard-toggleable
  and appeared beside desktop viewers or below the smaller layout.
- Render-callback readback found visible rendered content independently in both
  panes for every combination. There was one comparison canvas. Physics stayed
  Off, with zero native allocations and no Ammo script/WASM requests.
- All 91 observed browser responses were below HTTP 400; there were no failed
  requests, page errors or console errors.

Public-origin captures:

| Model | Desktop | Tablet | Mobile | Narrow |
| --- | --- | --- | --- | --- |
| Uka | [1440 closed](uka-1440-collapsed.png), [open](uka-1440-expanded.png) | [900](uka-900-collapsed.png) | [390](uka-390-collapsed.png) | [320](uka-320-collapsed.png) |
| Gene Light | [1440](gene-1440-collapsed.png) | [900](gene-900-collapsed.png) | [390](gene-390-collapsed.png) | [320](gene-320-collapsed.png) |

Agent inspection of the desktop, expanded desktop, tablet, mobile and narrow
captures found the authentic models visible with clear labels and reachable
controls. This records agent-verifiable layout evidence, not human visual
approval. Screenshot asset rights and technical qualifications remain those in
the [implementation report](../../comparison-ui.md) and public credits.

Physical Android/iOS testing, real-device Physics testing and native Windows MMD
parity remain unperformed/unverified. Responsive desktop viewports do not establish
those results. All required post-merge checks for Issue #83 passed before closure.

Results were [recorded on the Issue](https://github.com/takahirox/mmd-gltf/issues/83#issuecomment-6644263907)
before it was closed as completed at 2026-11-04 22:56:14 UTC. PR #84's description
was updated with the actual exact-head CI and post-merge results.
