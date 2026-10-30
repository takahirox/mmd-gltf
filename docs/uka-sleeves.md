# Uka sleeves and shared-animation acceptance (Issue #67)

Missing sleeve IK explains the detached clothing in the previous raw comparison.
This is measured on the pinned, unmodified Uka source, with physics disabled.
It is not a skin-weight corruption or an eye-grant problem.

## Source and dependencies

Reproduce the source measurements with:

```sh
npx tsx tools/diagnose-uka-sleeves.ts
```

The [machine-readable evidence](uka-sleeve-evidence.json) records the PMX and VMD
SHA-256 hashes, every relevant parent chain, original IK parameters, fixed-axis
flags, grant records, rigid-body dependencies, source-track coverage, actual
weighted source vertex examples, and before/after world transforms at VMD frames
0, 15, 120 (laugh) or 50 (apology), and 300. Coordinates are reflected right-handed
metres at 0.08 m per source unit. The tool builds bones from the actual PMX;
it does not substitute synthetic source rigs or motions.

The two sleeve chains branch at shoulders 50/84, independently of the actual
arm chains. Their proxy bones 57→58→59→60 and 91→92→93→94 do not automatically
inherit the arm's motion. Controllers 61/62/63 and 95/96/97 are children of the
animated twist/wrist bones and target the three sleeve endpoints in order.
Each controller has one unrestricted link, 15 iterations and maximum angle 1 rad.
Execution follows source deformation layer, then source index: upper arm, forearm,
hand on the left, then on the right. No source parameters are rewritten.

| Sleeve bone | Source index | Vertices with positive weight | Representative source vertex and influences |
| --- | ---: | ---: | --- |
| 左腕袖 | 57 | 413 | 18754: 57 × 1 |
| 左ひじ袖 | 58 | 759 | 11902: 58 × 1 |
| 左手首袖 | 59 | 264 | 11862: 58 × 0.64, 59 × 0.36 |
| 左手袖先 | 60 | 0 | Endpoint only |
| 右腕袖 | 91 | 416 | 19834: 91 × 1 |
| 右ひじ袖 | 92 | 759 | 12574: 92 × 1 |
| 右手首袖 | 93 | 264 | 11996: 92 × 0.64, 93 × 0.36 |
| 右手袖先 | 94 | 0 | Endpoint only |

Counts overlap where a vertex has multiple influences. Full-precision weights
and explicit ancestry indices are in the JSON. These are valid BDEF1/BDEF2 weights.
The proxy and arm tracks are retained and bind under the existing exact-name
policy; ordinary hierarchy/skinning alone cannot make a separate sleeve branch
follow the arms. The shared laugh has only 93 uniquely matched Uka bone tracks,
so untouched links must start from rest on each evaluation and clip change.

Uka's only grants are 左目/右目 (34/36), sourced from eye parent 32. They cannot
move the sleeves. The four fixed-axis bones (52, 54, 86, 88) are arm-twist
ancestors of the IK targets, not writable sleeve links. The isolated operation
reads their authored transforms unchanged. Of 164 rigid bodies and 151 joints,
every body on these relevant parent chains is mode 0 (bone-following); no dynamic
body drives a sleeve link. Physics is unnecessary for this measured correction.

## Controlled correction and limits

The downloadable glTF retains the original source and solver-free raw animations.
The **Sleeve IK** preview checkbox defaults on for Uka and controls the same six
chains in both panes. Raw mode remains available for A/B comparison. The PMX
pane uses its independently loaded MMDLoader chain metadata; Toon/PBR use retained
glTF source solver records and source bone identities. Each operates on its own
skin with the pinned library's CCDIKSolver, after the common absolute raw-motion
time. It writes only the six source sleeve link rotations. It never copies
arm transforms or vertices, enables a full helper, or creates a physics world.
VMD sleeve-controller enable switches, if present, are respected.

This is an isolated preview operation, not execution of MMD_skeleton_solver v3.
That full executor still diagnoses Uka's fixed axes as unsupported. No source
flags or records are removed to bypass that diagnostic. Eye grants, foot IK,
fixed-axis projection of authored twists, non-vertex morphs and physics remain
outside this comparison. Native Windows MMD parity is unmeasured; no full-library
helper or Windows MMD reference is claimed. General v3 fixed-axis support remains
separate follow-up scope; it is not needed to rotate the six unrestricted sleeve
links measured here.

| Motion / frame | Largest raw endpoint-to-controller gap | With sleeve IK |
| --- | ---: | ---: |
| Laugh / 15 | 0.525219 m | 0.00000322 m |
| Laugh / 120 | 0.525222 m | 0.00000322 m |
| Apology / 15 | 0.428119 m | 0.00000278 m |
| Apology / 50 | 0.445486 m | 0.00000280 m |

The source tool also measures endpoints 0/300. All measured corrected gaps are
below 0.0000033 m. Non-sleeve arm and controller transforms remain exactly
unchanged in the A/B source measurements. Weighted sleeve vertices move by more
than 0.01 m. Browser regression separately measures both loaded panes, compares
PMX/Toon/PBR sleeve joints, checks backward seek and repeats the same pose to
catch accumulated rotations or mixer-cache errors.

## Rendered A/B evidence

Reproduce checked-in front/side captures with:

```sh
UPDATE_SLEEVE_EVIDENCE=1 npm run test:browser -- tests/browser/sleeve-motion.spec.ts
```

Each image contains the direct PMX pane on the left and independently loaded
converted Toon glTF on the right. Laugh is frame 120; apology is frame 50.

| Motion / view | Raw (sleeve IK off) | Six sleeve chains only |
| --- | --- | --- |
| Laugh / front | [Raw](images/uka-sleeves/02_laugh-front-raw.png) | [Corrected](images/uka-sleeves/02_laugh-front-sleeve-ik.png) |
| Laugh / side | [Raw](images/uka-sleeves/02_laugh-side-raw.png) | [Corrected](images/uka-sleeves/02_laugh-side-sleeve-ik.png) |
| Apology / front | [Raw](images/uka-sleeves/22_apology-front-raw.png) | [Corrected](images/uka-sleeves/22_apology-front-sleeve-ik.png) |
| Apology / side | [Raw](images/uka-sleeves/22_apology-side-raw.png) | [Corrected](images/uka-sleeves/22_apology-side-sleeve-ik.png) |

Uka model and official motions: CG-CA Uka (c) 2023–2024 Nagoya Institute of
Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society, CC BY 4.0.
[Original pinned source](https://github.com/mmdagent-ex/uka/tree/659f0d1a740fec68bb2817dc9c694a35e7a15f12).
Changes: rendered PMX/glTF comparison, BDEF conversion, bounded preview textures,
vertex-only expressions and optional isolated sleeve IK. No endorsement implied.
See [source rights and inventory](uka.md) and original English/Japanese notices.

## Resources and validation

The published Uka glTF is 10,642,829 bytes of JSON plus its 7,983,848-byte
binary buffer; original images remain external and shared with the direct PMX
loader. Gene's single GLB is 15,040,772 bytes. Lossless sparse morph serialization
reduces that GLB from 75,792,812 bytes with dense zero padding (about 80% smaller),
while retaining every downloadable target and exact source payload. Original
source image bytes total 72,639,890 for Uka and 3,556,337 for Gene; Uka's first
load therefore remains relatively large. Motion switching requests none of these
resources again. Source files, texture pixels, pins and hashes are unchanged.

The fixed render-only union uses seven vertex targets per Uka mesh and ten per
Gene mesh. Summing projected attribute lengths over all reference/Toon/PBR
primitives gives conservative bounds of 113,297,940 and 92,813,040 bytes,
respectively; shared attributes can be counted more than once. These layouts
never change during clip selection. Preview image dimensions are capped at
1024 pixels. CPU metadata and downloadable targets remain complete.

After warming both Toon and PBR once, the first complete lifecycle measurement
reported the following. These are Three.js renderer accounting values, not a
measurement of total physical GPU memory:

| Character | Accounted bytes before / after clip cycle | New requests during switching | Canvas / scene roots |
| --- | --- | ---: | --- |
| Uka | 353,372,669 / 353,372,669 | 0 | Same canvas and all three roots |
| Gene Light | 312,693,079 / 312,693,079 | 0 | Same canvas and all three roots |

The tests also preserve the old capture closure, compare complete Rest bone
transforms and zero weights, check shared time, play/pause, restart, loops,
endpoints, backward seek, active vertex weights, Toon/PBR, outlines, camera,
model changes and 390px layout. Source/binding/retained-payload failures now fail
preload and retry the character rather than destroying a working viewer on
selection. Separate real-asset ordinary-GLTFLoader tests inspect all three named
fallback clips and hash each retained source. Synthetic GLB and unpacked glTF
reload tests also reverse animation order, check per-animation ownership,
mutually exclusive players, rest restoration and absence of double playback.

The pinned MMDLoader's Bezier inversion remains approximate, whereas retained
playback uses a finer inverse. The comparison tolerances apply to the established
arm/upper-body joints plus sleeve joints (1e-5 m local position, 0.002 m world
position, 0.002 radians orientation). The read-only pose probe also exposes all
bones for reset inspection; a diagnostic broader Gene bone probe
reached 0.00457 m world difference at apology frame 50, so the arm tolerance is
not a claim about every bone or original-MMD equivalence. The cause of that
broader discrepancy was not isolated by this sleeve-only investigation.

The [playback evidence](uka-playback-evidence.json) records asset/source hashes,
initial requests/transfers, switch timings, renderer accounting, heap samples and
arm/sleeve errors. Browser attachments retain full sampled poses, resource snapshots,
request lists, synchronous selection timing and JavaScript heap samples. Heap
samples include garbage collection variability. Captures and source measurements
above are checked in. No post-merge check is required.

On macOS arm64, Node 26.12.1, Chrome with ANGLE SwiftShader:

- `npm run build`: passed; existing large-chunk advisory remains.
- `npm run typecheck`: passed.
- `npm test`: 158 passed, zero failed or skipped.
- `npm run check:links`: 443 links/anchors/built asset links passed.
- `git diff --check`: passed.

Development checks initially exposed outdated single-animation packaging assertions,
resource measurements taken before the first PBR upload, a port-specific favicon
filter and a test-only Vite module URL. Those checks were corrected; source pins,
parser validation and established arm comparison tolerances were preserved.
The complete unrelated browser conformance matrix was not rerun; the full Node
synthetic/converter conformance suite was run.

The broad browser selection ran 30 cases: 28 passed, one native-WebGPU case was
skipped for lack of an adapter, and one stale credit-text assertion failed.
After updating that assertion for the disclosed sleeve mode, the final focused
run passed all three selected cases (both complete playback cycles plus the
full WebGL rendering/navigation/outline case). Thus 29 distinct browser cases
passed on the final assets, with one explicit native-WebGPU skip. The final
playback cycles additionally compare per-target morph weights and record network
transfer sizes; they preserve every Rest bone/weight and the established pose
comparison tolerances.

In that final run, synchronous body-clip selection took 5.6–6.1 ms for Uka and
3.6–4.1 ms for Gene; automation round trips including a rendered capture took
0.59–0.76 s. Initial load plus Toon/PBR warm-up took 26.7 s and 19.0 s,
respectively, on this CPU renderer. These are local samples, not performance
service guarantees. Resource Timing reported 236,051,946 first-load transfer bytes
for Uka (48 request events, including 27 image requests) and 20,675,277 for Gene
(50 events, including 10 image requests and embedded-image blob requests).
Each character issued one PMX request and one model glTF/GLB request. Independent
image loads and local preview caching make Uka's measured transfer larger than
its unique source-image bytes; this first-load cost remains a limitation. The
switch cycle issued **zero** further requests and changed no renderer accounting
values. JavaScript heap samples were 649,476,902 → 633,283,691 bytes for Uka and
392,399,965 → 397,881,208 for Gene; these include garbage collection variation.
