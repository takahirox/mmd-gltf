# Public synchronized VMD comparison (Issues #63 and #65)

Uka and Gene Light compare direct PMX rendering from
`@takahirox/three-mmd@0.1.2` against a BDEF skinned glTF conversion.
Both characters offer Rest / manual, their original facial sample, Laugh · 02
and Apology · 22. The facial samples have skeletal keys only at frame zero;
the two added clips animate authored arms, shoulders and upper body over time.
These are solver-free comparisons, not native MikuMikuDance parity claims.

Selection starts paused at frame zero. Play/Pause, Restart, arbitrary forward or
backward seek and Loop use one absolute time in seconds (VMD frame / 30), derived
from a monotonic epoch. Restart preserves the play/pause choice. Rest restores
the base pose and enables Uka's manual blink/smile. Motion selection releases the
old mixer, retained players, preview geometries, textures, effects and renderer,
then rebuilds the selected clip while preserving camera and material/outline
choices. Model changes restore Rest. Missing/corrupt/binding-incompatible files
fail with disabled controls and an in-place Retry for the selected clip.

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

The original downloadable `uka/model.gltf` and `gene-light/model.glb` keep their
original expression animations. Additional `02_laugh.gltf` and `22_apology.gltf`
artifacts retain exact VMD v6 source and curve playback, plus an approximate core
fallback. Static geometry, skin and sparse morph accessors share one
content-addressed binary buffer between the two body clips per model; sampled
fallback animation uses separate buffers. All reference the original external
source images. No source texture re-encoding or extra image copies are needed.
Each body metadata file records artifact buffer hashes and conversion warnings.

The MMD side uses `MMDLoader.loadAnimation()` and a raw `AnimationMixer`, with
tracks filtered to the same exact bone-name policy and vertex-only morph family.
It creates no animation helper, IK solver, append/grant controller, bone/group
morph controller or physics world. `updateMMDUVs(mesh,false)` disables the loader's
UV controller. Both Toon and PBR glTF instances use `MMDVMDPlugin` and exact
retained `VMDPlayer.seek(t)` without a core fallback mixer. All public conversions
use `mode:'bdef', solver:'none', physics:'none'`. Runtime checks source size/hash,
strict parse, useful bindings, retained source equality and solver-free contracts.
There is no live upstream runtime fetch.

Seek, pause, restart and loop apply the same canonical time to the reference and
both retained players. Inactive viewer, hidden document and cached page suspension
pause playback. Material/group/bone/UV deformation, IK, append/grant, fixed/local
axes, external parents, deformation layers, physics and VMD visibility/camera/
light/shadow execution remain outside this comparison. Bullet/Ammo never starts.

## Preview resources and acceptance evidence

The full CPU morph layout, source names, dictionary and retained identities stay
intact. A render-only projection chooses every active vertex target plus manual
blink/smile for the **selected motion**, scatters weights around compilation and
drawing, then restores the full geometry and weights. This means five buffers
per mesh for the original facial samples, four for laugh, three for Uka apology,
and seven for Gene apology. There is no five-target cap that could silently drop
Gene's active targets. Textures are capped at 1024 px for preview. Diagnostics
report selected counts and summed selected attribute byte lengths across the
reference, Toon and PBR instances, a conservative bound rather than total GPU
heap usage. Frustum culling and per-seek conservative bounds scans are disabled;
pose, weight, matrix and skin updates still execute.

`body-motion.spec.ts` tests both clips on both characters at frames 15/120 for
laugh and 15/50 for apology. It independently checks local bone rotations,
world-space hand positions and skin-only vertex positions starting from base
POSITION (excluding facial morphs), changes from Rest and between nonzero times,
and changing rendered pixels in both panes. Reference and Toon/PBR bone local
positions, rotations and world positions are compared in shared reflected axes
and metre scale with tolerances of 1e-5 m for local positions, 0.002 m for
world positions and 0.002 radians for orientation. MMDLoader uses a 15-iteration
approximate Bezier inverse; the exact retained player uses a finer inverse.
Backward seek permits 1e-7 floating-point repeatability error. It also covers backward seek, restart,
pause, looping/endpoints, PBR, Rest, motion/model replacement, mobile controls,
missing/corrupt/binding/retained-source failures and retry, and absent Ammo/Bullet
requests. Existing public-motion, Uka, example and unified-demo suites cover the
original expressions, materials/outlines, cameras, mobile stacking, credits,
suspension and internal synthetic harness. Node tests verify exact retained
source, strict binding, full active target coverage, static buffer sharing,
allowlisted packaging and the explicit vertex-only binding policy.

## Validation record

Validated on macOS arm64 with Node 26.12.1 and Chrome/ANGLE SwiftShader:

- `npm run build`: passed; existing large-chunk advisory remains.
- `npm run typecheck`: passed.
- `npm test`: 156 passed, including all four body transports, their core glTF
  validation, exact source retention, explicit vertex-only binding and projection
  refusal when an animated target would be omitted.
- Targeted real-asset browser checks: 24 distinct cases passed and one native
  WebGPU case skipped because no adapter was available, across the final runs.
  The selected existing suites (`public-motion`, `uka`, `example`, `unified-demo`)
  supplied 18 passes / one skip; four new failure/retry cases passed; both new
  complete body-motion cases passed. The two original expression cases also
  passed again after adding the projection safeguard. The complete unrelated
  browser conformance matrix was not rerun.
- The body cases were repeated after correcting test-only exact `0` versus `-0`
  quaternion comparisons and Playwright range filling for frame 50's fractional
  time. Final body run: two passed, 3.9 minutes. No playback tolerance or source
  parser policy was relaxed to resolve those test-helper failures.
- Maximum measured cross-pane bone errors over the tested samples: 4.77e-9 m
  local position, 0.000251 m world position and 0.000703 radians orientation.
  All three instances showed more than 0.01 m skin-only vertex changes, with
  more than 300 changed body-region pixels independently in each rendered pane.
- `npm run check:links`: passed, 430 local links/anchors/built asset links.
- `git diff --check`: passed.

Generated assets and browser captures remain ignored and are reproduced by the
build and test commands. No native-MMD parity benchmark is claimed. No post-merge
verification is required.
