# Public synchronized VMD comparison (Issues #63, #65 and #67)

Uka and Gene Light compare direct PMX rendering from
`@takahirox/three-mmd@0.1.2` against a BDEF skinned glTF conversion.
Both characters offer Rest / manual, their original facial sample, Laugh · 02
and Apology · 22. The facial samples have skeletal keys only at frame zero;
the two added clips animate authored arms, shoulders and upper body over time.
The downloadable animations remain solver-free. The Uka preview additionally offers isolated sleeve IK in both panes; native MikuMikuDance parity is unmeasured.

Selection starts paused at frame zero. Play/Pause, Restart, arbitrary forward or
backward seek and Loop use one absolute time in seconds (VMD frame / 30), derived
from a monotonic epoch. Restart preserves the play/pause choice. Rest restores
the base pose and enables Uka's manual blink/smile. All three pinned motions,
PMX mixer clips and both glTF instances are prepared once per character. Selection
stops the old action/players, restores the full original pose and zero weights,
then selects the new action and retained players by animation name. It preserves
camera, material, outline, loop and sleeve-mode controls without creating a renderer,
canvas, model or GPU layout. A model change rebuilds the character and restores Rest.
Missing/corrupt/binding-incompatible inputs fail preload with disabled controls
and an in-place Retry. Preload settles all requests before releasing failed resources.

## Source and binding audit

The [pinned inventory](public-motion-audit.json) enumerates all 40 VMDs in each
repository with Git blob, SHA-256, byte length, informational header, exact decoded
coverage and conservative terminated-name binding eligibility against each PMX.
The six selected model/motion pairs include complete byte keys, source indices,
ambiguity, activity, bone record counts, keys after frame zero, maximum bone
frame and changing-transform flags (translation/normalized quaternion component differences greater than 1e-6,
ignoring quaternion sign).
Reproduce with `npx tsx tools/audit-public-motions.ts` after fetching both model
allowlists. Unselected motions stay in the ignored audit cache; only allowlisted
assets ship. Both `36_Anxious.vmd` files fail strict quaternion validation and
remain inventoried with an execution error. No parser tolerance was relaxed.

| Character | VMD | Bytes | Eligible bone tracks | Eligible morph names | Active vertex tracks | Active omitted morphs |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Uka | `04_littlesmile` | 40,719 | 301 / 301 | 111 / 142 | 4 | None |
| Uka | `02_laugh` | 70,076 | 93 / 222 | 112 / 178 | 3 | None |
| Uka | `22_apology` | 68,546 | 302 / 302 | 112 / 144 | 2 | 困る, 口締め (group) |
| Gene Light | `01_happy` | 33,008 | 212 / 222 | 90 / 111 | 4 | None |
| Gene Light | `02_laugh` | 70,076 | 212 / 222 | 136 / 178 | 3 | None |
| Gene Light | `22_apology` | 89,061 | 212 / 222 | 136 / 178 | 6 | None |

Only unique, terminated, exact decoded names bind. No inferred aliases,
truncated-name mappings or normalization are used. All ambiguous, undecodable,
full-width or absent names remain unbound. In particular the shared laugh's Gene
header does not prove compatibility with Uka: only 93 bone tracks bind there,
but these include the changing arms, shoulders and upper body. Gene's ten
unbound bone tracks include nine full-width exact names and one absent name.
Each selected generated `motion*.json` lists the precise bone/morph bindings,
active omissions, source indices, preview target indices and execution policy.
The toolbar summarizes bound/changing bones, active vertex expressions and
active omitted morphs.

Uka apology's active 困る and 口締め group morphs are deliberately omitted on
**both** renderers. Its facial result therefore omits their contribution; this
is a disclosed partial facial comparison. 真面目 and まばたき still execute.
The converter's explicit `vmdBinding.morphTypes:[1]` policy restricts execution
to source vertex morphs while retaining every original VMD byte and the full PMX
morph metadata. Gene apology's six active vertex expressions, including
頬全消し, all execute. Material/group/bone/UV morphs are never silently claimed
as executed. The other selected non-vertex records have zero weight.

The identical laugh bytes in both official repositories have SHA-256
`714c04a833285aacc7b75039d872fc852c6df75025296bae0a707e5bbb3e159e`;
this is a shared official asset, not a distinct or uniquely Uka-authored file.
Apology uses each model's own version: Uka SHA-256
`c9d1673a727c8d78954a3e69abe5ef109bc560e4ba9452918b753d647f0164e1`,
Gene SHA-256
`65f02aabe34e5b7ef502e47ffbaf06068f523b3522a58ad2382de29b61daf282`.
Original files, source pins, hashes, notices and usage policies remain in the
[Uka](../tools/uka-manifest.json) and [Gene](../tools/gene-light-manifest.json)
allowlists and generated asset extras. Both require CC BY 4.0 attribution;
Gene additionally retains trademark/design restrictions and usage guidance.
Full English/Japanese notices and model-specific credits remain in the collapsed
About & credits.

## Conversion and execution

Each character has one logical asset: `uka/model.gltf` (external original
images and one binary buffer) or `gene-light/model.glb`. Each contains one scene,
one skin, one mesh with the original material primitives and three named animations:
`04_littlesmile` / `02_laugh` / `22_apology` for Uka, `01_happy` / `02_laugh` /
`22_apology` for Gene. The old per-motion model outputs are removed during the
allowlist rebuild; the visible demo and downloads use the shared asset. Original
VMD files and per-motion audit JSON remain available at their existing paths.

The converter's `vmds` API adds motions to the same Document, skeleton, morph
identities and accessors. Each entry has `name`, `bytes`, optional `binding` and
`sampling`; omitted options inherit `vmdBinding` and `vmdSampling`. Names must be
unique and nonempty. The existing single `vmd` API remains unchanged; combining
`vmd` and `vmds`, or VPD and motions, is rejected. For example:

```ts
await convertModel(model, directory, {
  mode: 'bdef',
  vmds: [
    { name: 'laugh', bytes: laughBytes },
    { name: 'apology', bytes: apologyBytes },
  ],
  vmdBinding: { morphTypes: [1] },
});
```

Each animation owns its exact VMD v6 payload, original source bytes, original rest,
tracks, morph bindings, diagnostics and generated fallback channels. A normal
GLTFLoader can play its approximate sampled core channels. MMDVMDPlugin removes
only extension-owned fallback tracks and creates a named `VMDPlayer` per payload.
The demo never runs a core fallback mixer on the right. Both Toon and PBR instances
select one player by name, independent of animation array ordering. Stop resets
full shared rest and weights before another player claims the root.

The MMD side uses cached `MMDLoader.loadAnimation()` clips and a raw
`AnimationMixer`, filtered to exact bone names and vertex-only morphs.
`updateMMDUVs(mesh,false)` disables extra UV execution. Absolute seek restores
previous raw sleeve rotations before the mixer evaluates again, preventing both
untracked-link accumulation and Three.js property-cache skips. Retained players
write their full original rest on every seek. Rest also explicitly restores all
PMX bone transforms and clears all weights. Hidden documents, inactive viewers
and cached page suspension pause the same shared clock.

All conversions use `mode:'bdef', solver:'none', physics:'none'`. Uka's separately
controllable **Sleeve IK** preview operation runs only its six source chains,
after raw motion on each independently loaded skeleton, using the pinned reference
library's CCD executor. Direct PMX chains come from MMDLoader metadata; glTF chains
come from retained `extras.sourceSolvers` and source bone identities. This does not
enable the full `MMD_skeleton_solver` v3 executor or alter its fixed-axis diagnostic.
See the [real-source sleeve investigation](uka-sleeves.md) for measurements,
rendered evidence and limits. Foot IK, eye grants, physics, non-vertex morphs and
VMD scene controls remain off. Bullet/Ammo never starts. There is no live upstream
runtime fetch.

## Preview resources and acceptance evidence

The full CPU morph layout, source names, dictionary and retained identities stay
intact. A render-only projection chooses every active vertex target plus manual
blink/smile for the **union of all three motions**, scatters weights around
compilation and drawing, then restores the full geometry and weights. This uploads
seven targets per mesh for Uka and ten for Gene, regardless of selection. The
projection is compiled once; changing clips cannot invalidate its layout or omit
an active target. Textures are capped at 1024 px for preview. Diagnostics
report union counts and summed projected attribute byte lengths across the
reference, Toon and PBR instances, a conservative bound rather than total GPU
heap usage. Frustum culling and per-seek conservative bounds scans are disabled;
pose, weight, matrix and skin updates still execute.

`body-motion.spec.ts` tests both clips on both characters at frames 15/120 for
laugh and 15/50 for apology. It independently checks local bone rotations,
world-space hand positions and skin-only vertex positions starting from base
POSITION (excluding facial morphs), changes from Rest and between nonzero times,
and changing rendered pixels in both panes. Reference and Toon/PBR bone local
positions, rotations and world positions are compared in shared reflected axes
and metre scale for the arm/upper-body and sleeve joints with tolerances of 1e-5 m for local positions, 0.002 m for
world positions and 0.002 radians for orientation. MMDLoader uses a 15-iteration
approximate Bezier inverse; the exact retained player uses a finer inverse.
Backward seek permits 1e-7 floating-point repeatability error. It also covers backward seek, restart,
pause, looping/endpoints, PBR, Rest, motion switching/model replacement, mobile controls,
missing/corrupt/binding/retained-source preload failures and retry, and absent Ammo/Bullet
requests. Existing public-motion, Uka, example and unified-demo suites cover the
original expressions, materials/outlines, cameras, mobile stacking, credits,
suspension and internal synthetic harness. Node tests verify exact retained
source, strict binding, full active target coverage, shared rest/channel ownership,
allowlisted packaging and the explicit vertex-only binding policy.

## Validation record

Issue #67 validation and measured lifecycle/resource results are recorded in
[the sleeve and playback acceptance record](uka-sleeves.md). Browser attachments
are reproduced in ignored `test-results/`; the representative sleeve figures and
source measurements are checked in. Full original-Windows-MMD parity remains
unmeasured. No post-merge verification is required.
