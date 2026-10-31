# Public synchronized VMD comparison (Issues #63, #65, #67 and #69)

Uka and Gene Light compare direct PMX rendering from
`@takahirox/three-mmd@0.1.2` against a BDEF skinned glTF conversion.
Both characters offer Rest / manual, their original facial sample, Laugh · 02
and Apology · 22. The facial samples have skeletal keys only at frame zero;
the two added clips animate authored arms, shoulders and upper body over time.
The downloadable animations remain solver-free. The Uka preview additionally offers all ten source IK chains in both panes; native MikuMikuDance parity is unmeasured.

Selection starts paused at frame zero. Play/Pause, Restart, arbitrary forward or
backward seek and Loop use one absolute time in seconds (VMD frame / 30), derived
from a monotonic epoch. Restart preserves the play/pause choice. Rest restores
the base pose and enables Uka's manual blink/smile. All three pinned motions,
PMX mixer clips and both glTF instances are prepared once per character. Selection
stops the old action/players, restores the full original pose and zero weights,
then selects the new action and retained players by animation name. It preserves
camera, material, outline, loop and IK controls without creating a renderer,
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
previous raw IK-link and prerequisite-grant transforms before the mixer evaluates
again, preventing both untracked-link accumulation and Three.js property-cache skips. Retained players
write their full original rest on every seek. Rest also explicitly restores all
PMX bone transforms and clears all weights. Hidden documents, inactive viewers
and cached page suspension pause the same shared clock.

All conversions use `mode:'bdef', solver:'none', physics:'none'`. The public **IK**
checkbox defaults On for Uka (ten chains) and Gene Light (six chains), applied to
three independently loaded skins (PMX, Toon, PBR). Off bypasses every IK chain and
restores raw VMD positions and rotations, including untracked procedural joints.
Rest uses no VMD controller switches. Changing motion clears the previous clip's switches;
each absolute seek derives the current switches from the selected source's display
records at frame ≤ time × 30. Global Off overrides all records.

`examples/comparison-ik.ts` builds chains from each model's metadata. The direct
PMX supplies MMDLoader's actual runtime IK records; the glTF supplies retained
`extras.sourceSolvers` and exact source bone indices. Both use the pinned library's
CCDIKSolver, which supports unrestricted links and full XYZ bounds, after raw
bone/morph motion. No rotations or vertices are copied between skeletons. Source
iteration caps and maximum per-step angles are retained; iteration caps outside
1–1024 are explicitly unavailable. Execution sorts by pre/post-physics phase,
deformation layer, then source index; physics is off, so the phase boundary has
no simulation step. Source link order is unchanged. PMX axial X/Y bounds are
negated and exchanged for reflected right-handed execution; Z bounds are unchanged.
The loader already performs this reflection, so its limits are normalized back
before the shared adapter reflects them once. Source bytes are untouched.

Uka controllers are 8/9/15/16 (foot/toe) and 61/62/63/95/96/97 (sleeve).
The four fixed-axis twist bones 52/54/86/88 are read-only authored ancestors of
sleeve targets, never writable IK links. Their raw VMD transforms remain unchanged;
IK does not project authored twists or enable a general fixed-axis solver.
Eye grants are outside all IK dependency closures and remain off. The general
`MMD_skeleton_solver` v3 executor's fixed-axis limitation is unchanged; this
separate comparison adapter neither strips source flags nor claims full PMX deformation.

Gene has six controllers in execution order: 38 (`右腕xcIK`), 178
(`前クローク2_1xcIK`), 86/87/97/98 (foot/toe). Controller 178 has full XYZ bounds;
controller 38's effector/link ancestry includes append bone 35 (`右肩連`, a
rotation grant from 26 with ratio 1). **All six chains are supported and IK defaults
On.** The required shoulder grant executes before controller 38, in pre-physics
layer 0. Controller 178 follows in layer 0, then 86/87/97/98 in layer 1.
The remaining ten Gene grants are outside the dependency closure and remain off.
The [pinned source graph audit](gene-grant-audit.json) records flags, spaces,
rest transforms, ancestry and source influences. Bone 26 is neither grant-driven
nor an IK-written link; the other five chains read no grant-written ancestor.

Grant execution belongs to IK: Off restores all procedural writes to raw authored
TRS. A motion-disabled controller also skips any grant needed only by that chain.
Ordinary/global grants read the source bone-local translation delta and quaternion;
local grants read accumulated model-space deltas from the bind pose, excluding
mesh placement. Rotation uses shortest-hemisphere weighted quaternion powers,
including negative and extrapolated finite rates; translation adds its weighted
delta. Each write updates matrices before the next downstream consumer. Operations
interleave in source order rather than running all grants first. Cyclic/missing
sources, mismatched flags, nonfinite rates, and later required grant dependencies
are explicitly unavailable; transport remains valid without execution.

Writable fixed/local-axis links, unresolved external-parent dependencies, malformed
chains/bounds and unsupported caps likewise disable a whole model. Invalid raw
poses are detected before any instance executes. A runtime failure restores all
three skins atomically to raw pose; the next valid evaluation can recover. There
is no silent downselection.

`info.execution` reports `ikState` (`off`, `on`, `unavailable`), actual executed
controller indices, VMD-disabled controller indices, applied grant IDs and actual
phase/layer/source order separately for all three
skins, supported/unsupported counts and reasons. `ik` means at least one chain
actually ran. Executed does not mean a chain necessarily changed a pose or reached
its target; stationary keys and limits can produce no effect or residual error.
The visible control and counts remain compact; full records live in About & credits.

See the [real-source sleeve investigation](uka-sleeves.md) for preserved historical
six-chain measurements. Those measurements alone are not evidence of ten-chain
execution. Unrelated grants, physics, non-vertex morphs and VMD scene controls remain off.
Bullet/Ammo never starts. There is no live upstream runtime fetch or original
Windows MMD numerical parity claim. Public View presets were removed; the shared
OrbitControls camera is initialized once per model and persists across motion,
IK, material and outline changes. Browser evidence uses real pointer orbit gestures under the reduced-motion
preference, which disables inertia for stable captures. Normal viewing keeps
orbit damping. No test camera setters are installed.

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


### Issue #69 observed evidence

[The full-IK acceptance measurements](comparison-ik-evidence.json) summarize the
real browser `motion-evidence.json`, `sleeve-ab.json` and `bone-errors.json`
attachments. They include both PMX source hashes, complete runtime capability
inventories (ten Uka and six Gene identities), per-skin executed controllers,
source parameters/bounds/dependencies and raw/IK pose measurements. Maximum
world errors below are component-wise in metres across all IK targets, effectors
and links; sleeve gaps are Euclidean and the largest of all three skins.

| Clip / frame | Largest raw sleeve gap | Largest IK sleeve gap | Largest PMX/Toon/PBR IK world error |
| --- | ---: | ---: | ---: |
| Laugh / 120 | 0.525222 m | 0.000004561 m | 0.000106991 m |
| Apology / 50 | 0.445486 m | 0.000002800 m | 0.000000962 m |

Non-sleeve leg quaternion components change by up to 0.026177 under IK at these
frames. The public clips mainly animate the upper body; constrained knees/foot
chains still solve their authored target and angle bounds. A chain counted as
executed can also have a stationary target or no net change. Off restores the
full raw local/world pose within 1e-12 in the browser regression. Repeated Off
seeks explicitly exercise the mixer's unchanged-property cache as well as
untracked links. Synthetic Node conformance additionally exercises a genuine XYZ
box, pre/post phase ordering, VMD disabling and invalid-pose rejection.

Validation on 2026-10-30: `npm run build`, final Vite bundling,
`npm run typecheck`, `npm test` (161 passed, zero failed/skipped),
`npm run check:links` (445 local links/anchors/assets) and `git diff --check`
passed. Browser coverage selected `body-motion`, `public-motion`, `sleeve-motion`,
`uka`, `example` and `unified-demo` suites with `MMD_PREVIEW_PORT=43280` because the
default preview port was occupied. The initial six-suite run had 24 passes,
one camera image-comparison failure and one native-WebGPU skip. Settling-poll
experiments then timed out under CPU rendering. The final four camera-related
suites passed 14 cases with the same one WebGPU skip, using real pointer gestures
under reduced motion and retaining exact material/outline pixel assertions;
the unchanged body/public-playback suites contributed 11 passes. All 25 applicable
cases therefore pass. Native WebGPU had no adapter; original Windows MMD parity
remains unmeasured. At the Issue #69 checkpoint Gene's append-dependent IK was
unavailable; Issue #71 below resolves that prerequisite. No post-merge check is required.


### Issue #71 ordered Gene grant evidence

The pinned source audit is reproducible with `npx tsx tools/audit-comparison-grants.ts`
after fetching the public assets. Bone 35 (`右肩連`) has flags `0x101`: ordinary/global,
rotation only, rate 1, pre-physics, layer 0, source 26 (`右肩`). Both bind quaternions
are identity; the audit records their distinct local translations and full ancestry.
Only controller 38 reads grant 35; the five other controllers have no indirect grant
inputs. Uka's grants 34/36 read eye controller 32 at rate 0.0700000003 and remain
outside its ten-chain IK closure.

[Node reference measurements](gene-grant-node-evidence.json) use the pinned
`@takahirox/three-mmd@0.1.2` helper's ordered PMX path with its own GrantSolver and
CCDIKSolver, with physics disabled. The reference processes all source grants;
the comparison processes only grant 35. All six chains' dependency poses agree
within 1e-10 m at the tested frames of Happy, Laugh and Apology. The reference
also verifies the applicable-grant policy when VMD disables the arm controller.
Removing grant 35 changes effector 37 by **0.00767045 m at Laugh frame 120** and
**0.02708785 m at Apology frame 50**. Happy's static shoulder produces zero append
rotation, so it alone would not detect a stub.

The general pure solver was considered, but its execution profiles impose
additional fixed-axis and graph constraints that do not describe this raw public
comparison. The public transport stays `solver:'none', physics:'none'`. The
comparison adapter implements the small required grant composition, checked
against the independent pinned library. Synthetic cases cover local/model-space
and ordinary grants, rotation/translation, nonidentity rest, negative and
extrapolated rates, and a genuine IK → grant → IK schedule. No unrelated PMX
features are enabled, and no Windows MMD or MikuDanceStudio parity is claimed.

Real browser conformance measures all three independently loaded skins, including
bone 35's appended rotation, controller 38's link 36 (`右腕xca`) and effector 37
(`右腕xcb`), and every other controller's target/link/effector. The browser uses
normalized quaternions for angular measurements because raw FLOAT VMD keys can
have small length errors. The reference loader's approximate Bezier inverse and
the retained player's finer inverse still produce small cross-pane differences.

| Clip / frame | Shoulder grant angle | Largest effector 37 IK On/Off displacement | Largest controller target/link/effector PMX/glTF error |
| --- | ---: | ---: | ---: |
| Happy / 15 | 0 rad | 0 m | 0.00000000414 m |
| Laugh / 120 | 0.284545 rad | 0.0126202 m | 0.000104076 m |
| Apology / 50 | 0.440000 rad | 0.237755 m | 0.0000003223 m |

These On/Off displacements include both grant and IK; the Node ablation above
isolates grant's contribution. Independent left-PMX and right-Toon/PBR pixels
change under IK. Repeated/backward seeks, paused Off→On→Off, A→B→A, Rest, Loop,
material changes and Uka↔Gene model round trips retain raw-pose ownership and the
shared clock. Clip/material/IK changes issue no asset requests and preserve model
roots and GPU geometry/texture counts. Physics stays off throughout.

At 1200 × 1000 browser viewport size, pixel changes under On/Off were:

| Motion | PMX pixels | Toon pixels | PBR pixels |
| --- | ---: | ---: | ---: |
| Happy / 15 | 259 | 270 | 291 |
| Laugh / 120 | 28,883 | 28,617 | 30,659 |
| Apology / 50 | 27,255 | 27,188 | 27,715 |

These are canvas pixels with any RGB change, measured independently per half;
Toon and PBR use separate loaded skeletons. Happy's small change comes from the
remaining IK, not a nonzero shoulder grant. The [full acceptance record](comparison-ik-evidence.json)
includes per-pane grant/link angles, effector positions, execution IDs/order,
per-half pixels, source hashes, and the remeasured Uka sleeve regression.
Regenerate the Node measurements with
`MMD_IK_EVIDENCE=1 npx tsx --test tests/comparison-ik.test.ts`.

Validation on 2026-10-31: final `npm run build`, `npm run typecheck`, `npm test`
(165 passed; no failures/skips), `npm run check:links` (448 links/anchors/assets),
and Git whitespace checks passed. The seven browser suites `gene-ik`,
`body-motion`, `public-motion`, `sleeve-motion`, `uka`, `example` and `unified-demo`
passed 27 cases with one native-WebGPU skip. After the final binding/inventory
checks and added missing-source fixture, the rebuilt app's three Gene cases all
passed, yielding 28 unique applicable browser passes and one skip overall.
Use `MMD_PREVIEW_PORT=43182`; the default preview port was occupied. The first
focused attempt failed an angular assertion on nonunit FLOAT quaternion inputs;
normalizing the measurement resolved it. Production grant inputs already used
normalization. The final full and focused runs exited normally with no failures.
Native WebGPU had no adapter; WebGL2 used Chrome / ANGLE SwiftShader. No Bullet or
Ammo requests occurred. Original Windows MMD / MikuDanceStudio parity remains
unmeasured. No post-merge check is required.
