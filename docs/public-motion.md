# Public synchronized VMD comparison (Issue #63)

Uka and Gene Light compare the original direct PMX reference from
`@takahirox/three-mmd@0.1.2` against a BDEF skinned glTF conversion. The public
Motion selector offers Rest / manual and one official sample per character.
Selection loads at frame zero, paused. Play/Pause, Restart, timeline seek and Loop
use a single absolute time in seconds (VMD frame / 30). Restart preserves the
play/pause choice. Rest restores the base pose and re-enables Uka manual
expressions; manual weights cannot overwrite a running motion.

## Source and binding audit

[Complete pinned inventory](public-motion-audit.json) enumerates all 40 VMDs in
each repository, with Git blob, SHA-256, size, informational model header and
exact decoded track-name coverage against the corresponding PMX. Selected
motions have full byte-name, source-index, ambiguity and activity records.
Other motions list matched/unmatched/ambiguous names; strict reader failures are
recorded as `executionError`, without rewriting or normalizing source bytes.
Reproduce with `npx tsx tools/audit-public-motions.ts` after fetching both model
allowlists. This audit downloads motions for inspection into the ignored cache;
only manifest entries are ever packaged or fetched by the public runtime.

| Character | Selected official VMD | Terminated bone bindings | Terminated morph name bindings | Active vertex expressions |
| --- | --- | --- | --- | --- |
| Uka | `04_littlesmile.vmd` | 301 / 301 | 111 / 142 | にこり, 下, 笑い, にっこり |
| Gene Light | `01_happy.vmd` | 212 / 222 | 90 / 111 | にこり, 笑い, ワ, 赤み |

Exact decoded names match 301/301 bone and 117/142 morph names for Uka,
and 221/222 bone and 95/111 morph names for Gene. The stricter terminated-name
policy produces the table's binding eligibility counts. Uka's 31 unresolved
morph names include six exact but full-width names and 25 absent names. Gene's
ten unresolved bone names include nine exact but full-width names and one absent
name; its 21 unresolved morph names include five exact but full-width names and
16 absent names. No selected name is ambiguous. Every inventory entry records
both exact coverage and binding eligibility, rather than treating decoded
full-width matches as executable tracks.

These are primarily facial dialogue expressions with an authored skeletal pose.
All selected bone keys are at frame zero; facial keys change over time. Uka's
`01_happy` was also inspected: its active 赤み track is a material morph, so the
vertex-only `04_littlesmile` is preferable for this scope. Gene's own happy
motion has a vertex 赤み. Gene `03_smile` was inspected too. The shared
`03_smile` is not treated as Uka-specific; its historical Uka inventory stays
available separately.

Only unique, terminated, exact decoded names bind, with no inferred aliases or
truncated-name mappings. All ambiguous, undecodable or full-width names stay
unbound. Gene's ten unbound bone tracks are full-width names; 21 morph names do
not bind, and four further name-matched material/UV morphs cannot execute. Its
converter binds 86 supported morph controls. Uka binds 108 supported controls;
three name-matched material controls cannot execute. All omitted selected morph
tracks have zero weights. Generated `motion.json` includes exact source matches,
types, active flags, preview source indices and converter target indices;
`conversion.json` includes the converter's actual binding/omission diagnostics.
Headers are informational and never used as compatibility evidence.

Original motion bytes, notices, usage guidelines, source pins and rights remain
in the existing [Uka](../tools/uka-manifest.json) and
[Gene](../tools/gene-light-manifest.json) allowlists and generated asset extras.
Uka attribution and CC BY 4.0, and Gene's additional retained trademark/design
rights and usage scope, remain in collapsed About & credits and accompanying
English/Japanese notices.

## Deliberate first-phase execution scope

The PMX side loads animation with `MMDLoader.loadAnimation()` and evaluates its
raw bone/vertex tracks through an `AnimationMixer`. It creates no animation
helper, IK solver, grant/append controller, bone/group morph controller or
physics world. The loader’s UV controller is explicitly disabled with `updateMMDUVs(mesh,false)`.
Reference tracks are filtered to the same exact-name policy and
vertex-only morph family. An ordinary mixer is the supported equivalent of a
helper with animation enabled and IK/grant/physics disabled.

Both Toon and PBR glTF instances register `MMDVMDPlugin`, use their exact retained
`VMDPlayer.seek(t)` and never run a fallback mixer. Both assets are built with
`mode:'bdef', solver:'none', physics:'none'`. Runtime verifies the selected raw
VMD's size/hash, strict parse, useful binding, retained source equality and
absence of solver/physics contracts. Missing/corrupt/unmatched assets fail with
disabled controls and an in-place Retry button. No live upstream fetch occurs.

The shared clock derives time from a monotonic epoch instead of summing frame
deltas. Seek, pause, restart and loop apply the same canonical time to the
reference action and both retained players. Inactive viewer, hidden document and
cached page suspension pause playback. Model changes dispose actions, players,
preview geometry, textures and renderer before replacement. No independent
player clocks advance.

Material, group, bone and UV morph deformation, IK, grant/append, fixed/local
axes, external parents, deformation layers, physics and VMD visibility/camera/
light/shadow execution are outside this public comparison. The selected motions'
non-vertex controls remain zero, so retaining their source and metadata adds no
extra deformation. This is not native MikuMikuDance equivalence.

## Preview resource bound

The complete downloadable conversion retains all supported morph targets and
original texture bytes. The public preview keeps that CPU layout and dictionary
unchanged for the exact player. A render-only geometry projection shares base
attributes and selects five morph buffers per mesh, scattering the original
weights immediately around compilation/drawing and restoring them afterward.
No active target is removed, renamed or rebound. The viewer disables frustum
culling and opts out of per-seek bounds scans (`updateBounds:false`); exact pose,
weights, matrices and skin updates still execute. Default player bounds behavior
for other consumers is unchanged. Uka uploads its four active
expressions plus blink (smile is already active); Gene uploads four active
expressions plus blink. Preview textures are capped at 1024 px. Diagnostics
expose selected target counts and an upper bound on selected buffer bytes across
all three material instances, rather than claiming a measured total GPU heap.

Real-asset browser tests in `public-motion.spec.ts` check changed model pixels in
both independently drawn panes at frames 3/12, repeatable frame zero, pause,
seek/loop times, PBR animation, Rest/manual restoration, replacement cleanup,
missing/corrupt/unmatched VMD failures and retry, and no Ammo/Bullet requests.
Existing suites cover materials/outlines, cameras, mobile stacking, credits and
Back navigation. Generated assets remain ignored and must be built before tests.

The real-asset browser diagnostics report five selected targets per mesh and
80,927,100 bytes for Uka / 46,406,520 bytes for Gene as the sum of selected
attribute byte lengths across the PMX, Toon and PBR instances. Shared buffers are
counted repeatedly in this conservative bound; it is not a total GPU memory
measurement. The complete CPU metadata and downloadable target layouts remain
intact.

## Validation record

Validated locally on macOS arm64 with Node 26.12.1 and Chrome/ANGLE SwiftShader:

- `npm run build`: passed (the existing large-chunk advisory remains).
- `npm run typecheck`: passed.
- `npm test`: 152 passed, including real source/transport identity, skinned assets,
  strict binding coverage and caller-managed-bounds vertex equivalence.
- `npm run test:browser -- tests/browser/public-motion.spec.ts tests/browser/uka.spec.ts tests/browser/example.spec.ts tests/browser/unified-demo.spec.ts`:
  18 passed; one native WebGPU case skipped because no adapter was available.
  All five new real-motion cases passed. The full unrelated browser conformance
  matrix was not rerun; the selected suites cover the public comparison and
  unified internal harness affected by this change.
- `npm run check:links`: passed, 426 local links/anchors/built asset links.
- `git diff --check`: passed.

The source audit enumerated 40 motions per repository. Both copies of
`36_Anxious.vmd` fail the existing strict unit-quaternion tolerance; they are
inventoried with an execution error and are not selected. No parser, converter
or transport tolerance was relaxed. No original-MMD fidelity benchmark or manual
video capture was performed. No post-merge verification is required.
