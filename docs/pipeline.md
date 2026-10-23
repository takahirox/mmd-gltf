# PMX pipeline

## Conversion

From the repository root, after `npm ci`:

```sh
npm run convert -- path/to/model.pmx output/model.glb --mode static
npm run convert -- path/to/bdef-model.pmx output/rig.glb --mode bdef
npm run convert -- path/to/model.pmx output/model.gltf --textures path/to/textures --scale 0.08
```

The positional arguments are the source PMX and destination `.glb` or `.gltf`.
`--textures` defaults to the PMX directory. Windows texture path separators are
normalized; texture paths must stay within that directory. `.gltf` writes its
buffer and PNG/JPEG resources next to the JSON. `.glb` embeds those resources.
Missing or unsupported images fail conversion; referenced images are never
silently dropped. PNG/JPEG bytes are preserved. BMP/TGA (including BMP-encoded
`.sph`/`.spa`) must be transcoded to PNG/JPEG and their PMX paths updated first.
No shared MMD toon images are downloaded, copied or embedded.

`--scale` is positive meters per PMX unit, default `0.08`; change it for models
with a different scale. `mmd-parser.parsePmx(..., true)` reflects Z for positions
and normals and reverses triangle indices. The result is right-handed, Y-up;
the converter applies no extra node rotation or UV V flip. PMX's top-left UV
convention matches glTF. Normals are normalized, and each PMX material's
contiguous face range becomes a triangle primitive. Additional UV1 XY becomes
`TEXCOORD_1` when a subtexture uses it; missing Additional UV1 fails conversion.
Zero normals, non-finite values and invalid face/index ranges fail clearly.

Extension factors preserve the original diffuse, ambient, specular and
shininess values, including out-of-range RGB/opacity. Shared PMX toon indices
are explicitly zero-based: 0 selects `toon01.bmp`, 9 selects `toon10.bmp`.
Custom toons and sphere textures use asset texture references, including an
inactive sphere reference. Base/subtexture sampling repeats; sphere and custom
toon sampling clamp at the image edges. Custom toons use bilinear base-level
sampling, avoiding a top/bottom ramp seam; base/sphere textures use mip filtering. Sphere modes map 0/1/2/3 to
none/multiply/add/subTexture. A source texture index of -1 means absent; a
sphere flag without a texture is disabled with a warning, retained in extras.

Core PBR is a separate approximation: clamped diffuse RGB is converted from
source sRGB components to linear baseColorFactor, metalness is zero, and
roughness approximates shininess as `sqrt(2/(q+2))`, bounded to `[0.15,1]`.
The base image is shared with the extension where possible. PBR viewers interpret
it as sRGB; MMD views sample encoded components. PMX's double-sided flag maps to
`doubleSided`. Diffuse alpha below one, any nonopaque base-image texel, or any
nonopaque subtexture texel selects `BLEND` (depth writes disabled by the plugin);
otherwise the material is `OPAQUE` with depth writes. PNG alpha is decoded with
pinned `pngjs`; JPEG is opaque. Toon and multiply/add sphere RGB do not contribute
alpha. Classification covers the entire image, conservatively including unused
texels, and preserves fractional opacity without guessing a cutoff.
The converter does not infer alpha-mask intent. The plugin also supports authored
core `MASK` and `alphaCutoff`.

Both extensions are used, never required, so ordinary glTF viewers can load the
fallback. The default `static` mode keeps the stored base-pose geometry and reports omitted
bones/skins and runtime features. The opt-in `bdef` mode is described below.
Neither mode evaluates SDEF, IK, grants or physics. Both retain PMX vertex POSITION morphs. BDEF mode supports synchronized solver-free VMD bones and vertex weights. PMX edge flag `0x10` enables `MMD_materials_outline`; edge RGBA and size are
copied unchanged (defaults `[0,0,0,1]` and `1`). Signed per-vertex `edgeRatio`
becomes a shared FLOAT/SCALAR `_MMD_EDGE_SCALE`, attached only to outlined
primitives, omitted when every stored ratio is exactly one. Zero stays zero.
Material size is never baked into geometry or ratios. Edge fields and shadow
flags remain in extras; shadow flags have no runtime effect. Additional UV ZW/unused sets and PMX-specific runtime
features are omitted with a conversion report. PMD and scene VMD execution are unsupported. Solver-free VPD offsets are supported in BDEF mode below.
Gene Light contains no shared/custom toon or sphere image; the generic conversion
tests exercise those modes using synthetic source material configurations.


Vertex morph conversion, retained identity, reusable inspection/application/reset,
linear VMD weights and synchronized VPD/VMD handoff are described in the
[vertex morph contract](vmd.md#vertex-morph-weights-issue-31). Static and BDEF
models share core POSITION targets and authored normals. Bone-only v1 retained
animations remain readable; v2 reuses core LINEAR weight samplers and suppresses
the complete matching fallback to prevent double-driving.

## BDEF conversion and source identity

The converter API accepts `convertModel(parsedModel, textureDirectory,
{ mode: 'bdef', scale: 0.08 })` or `convertPMX(input, output,
{ mode: 'bdef', scale: 0.08, textureDirectory })`. `mode` defaults to `static`;
unknown modes fail. The historical numeric third argument to `convertModel`
continues to select the static scale. `convertModel` expects the right-handed
model returned by `parsePMX`, including already-reflected bone positions.

BDEF emits every source bone in source-index order in one core skin, including
unweighted bones. An identity container gives multiple PMX roots a common glTF
ancestor. Parents may follow children in source order. Each rest rotation is
identity: bone-tail display offsets and deformation layers do not define rest
rotations. Rest translations are scaled absolute source positions minus the
parent's scaled position. Each inverse bind is translation by the negative
scaled absolute position. The mesh node is identity. Geometry and bones receive
the same unit scale, and no second handedness reflection is applied. Invalid
parents, cycles, non-finite positions and unsupported numeric ranges fail.

Each primitive receives `JOINTS_0` as unsigned-short/VEC4 and `WEIGHTS_0` as
FLOAT/VEC4. At most 65,536 bones are supported. BDEF1 expands to one weight of one;
BDEF2 uses the parsed `[w, 1-w]`; BDEF4 uses its four source weights. Repeated
active references merge by summing in first-occurrence order. Zero influences
are discarded, including inactive `-1` references; remaining slots are padded
with joint 0 and weight 0. Negative/non-finite weights, invalid active references
and zero totals fail with the vertex index. Weight sums must be within absolute
`1e-6` of one (a few FLOAT accumulation ulps); only such roundoff errors normalize,
and adjustments are reported with count and up to 32 vertex indices. Materially
non-unit sums fail rather than changing substantial source deformation.

The [PMX format document](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
allows BDEF4 sums other than one, whereas [core glTF skinning](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skins)
§3.7.3.3 says FLOAT sums SHOULD be as close as reasonably possible to one (the
previous wording here incorrectly called this mandatory). The unchanged `1e-6`
rejection/roundoff-normalization policy is this converter's interoperability
choice, including compatibility with Three.js loader normalization, rather than
a core MUST. Original-MMD behavior for abnormal sums remains unresolved; no
original-renderer equivalence is claimed.

Every joint node carries the following application metadata in core `extras`:

```json
{ "pmxBone": { "index": 259, "name": "exact source name", "englishName": "exact English name" } }
```

`index` is the original zero-based PMX bone index and the skin-joint-array index.
Names preserve exact source strings, including duplicates and punctuation.
PMX 2.0 text supports both UTF-16LE (encoding flag `0`) and UTF-8 (flag `1`).
The converter transcodes UTF-8 text buffers to UTF-16LE before calling the pinned
parser, which otherwise ignores that flag; numeric records remain unchanged.
Malformed UTF-8 is rejected rather than replaced with corrupted names.
GLB/glTF reload preserves this data; pinned GLTFLoader exposes it as
`bone.userData.pmxBone`, even when it sanitizes and uniquifies `bone.name`.
Bind future pose/motion data by source index and retained names, never runtime
display names. This metadata does not promise deformation-layer ordering,
IK/append/grants, fixed/local-axis constraints or external-parent semantics.
Those solvers, SDEF/QDEF, non-vertex morph evaluation, physics and scene VMD execution remain
unsupported; VPD supports only the solver-free contract below. They are listed in conversion warnings; parent hierarchy alone does
not implement them. Core skin pose edits are supported with Toon, PBR and Outline
without a new material or skinning extension.

BDEF mode rejects SDEF and any other unsupported source type, reporting mode,
count and up to 32 affected vertex indices. It never falls back to a static mesh
or BDEF approximation. Pinned `mmd-parser@1.1.4` cannot parse type-4 QDEF and
provides no affected vertex index. Additionally, its strict version check rejects
the FLOAT representation of binary PMX 2.1 (`2.0999999046325684`) before vertices
are read. The converter gives an explicit parser limitation error; it does not
reinterpret the file. Valid PMX 2.0 BDEF1/2/4 is the tested input contract.

The [attributed binary fixtures](../tests/fixtures/README.md) and
[validation evidence](validation.md#issue-25-bdef-core-skinning) document numerical
tolerances, parser regressions and independent surface/outline measurements.
The linked `rig.html` demo loads two actual converted rigs and two VPD byte
fixtures, with local file loading, encoding selection, explicit binding maps,
apply/reset, Toon/PBR and Outline controls. This is synthetic solver-free VPD
conformance. The existing Gene comparison remains static.

## VPD bone offsets

The supported input is **bytes**, decoded with fatal WHATWG `TextDecoder`
`shift_jis` by default, or explicitly `utf-8`. There is no encoding guess or
replacement-character recovery. A UTF-8 file BOM is permitted at the start;
U+FEFF inside names is preserved. LF, CRLF and CR line endings, blank lines, and
`//` comments (whole-line or trailing) are accepted. The profile requires:

```text
Vocaloid Pose Data file
informational-parent.pmx;
1; // nonnegative record count, maximum 65536
Bone91{exact source name
0.25,-0.125,0.5;
0,0,0,1;
}
```

Each record occupies four nonblank, noncomment lines. Names are the exact decoded
characters after `{`, including leading/trailing spaces, punctuation, combining
characters and case; no normalization or English aliases are used. Names cannot
contain braces or `//` in this profile. `BoneN` requires a unique nonnegative
safe-integer label; it is **not** a PMX index. The parent filename (without its
`;`) is diagnostic text only, never a file/URL fetch instruction. A count must
match all complete records. Translation has three and quaternion four finite
decimal/exponent values separated by commas, terminated by `;`. Nonfinite values,
truncation, extra tokens/channels, malformed encoding and invalid counts fail
with record/line context. Zero quaternions or lengths differing from one by more
than absolute `1e-5` fail; smaller decimal roundoff is normalized. This permits
six-decimal quaternion export roundoff without accepting material rotations with
invalid magnitude. No animation or morph channels are invented.

The converter and runtime use [one shared resolver](../packages/mmd-vpd/index.ts).
It reflects source translation `(x,y,z)` to `(x,y,-z)` and source quaternion
`(x,y,z,w)` to `(-x,-y,z,w)` exactly once. It scales translation by the model's
retained `metersPerPMXUnit`, adds to ORIGINAL local rest translation, and composes
`qLocal = qRest * qOffset`. PMX tails do not supply rest rotations. All joints are
replaced: omitted bones return to original rest, even if current transforms have
been edited. A→A, A→B→A and dirty-transform→A produce the same A. Original inverse
binds never change. Solvers, append/grants, IK, deformation layers and physics are
not evaluated, so raw offsets are not full MMD pose reproduction.

### Converter workflow

```sh
npm run convert -- tests/fixtures/bdef.pmx output/posed.glb --mode bdef --scale 0.2 --vpd tests/fixtures/pose-a.vpd --vpd-map tests/fixtures/pose-a-map.json
npm run convert -- tests/fixtures/vpd-wedge.pmx output/posed.gltf --mode bdef --scale 0.125 --vpd tests/fixtures/pose-b.vpd --vpd-encoding utf-8 --vpd-map tests/fixtures/pose-b-map.json
```

`convertModel` and `convertPMX` accept `{ mode: 'bdef', scale, vpd: bytes,
vpdEncoding: 'shift_jis' | 'utf-8', vpdBinding: { mapping, unmatched } }`.
VPD in static mode fails. `--vpd-map` reads a JSON object whose keys are zero-based
**record ordinals in file order** and values are original PMX indices; neither
record labels nor traversal order identify bones. Unmapped records match exact
`pmxBone.name`. Multiple candidate bones require an explicit mapping. Invalid
mapping keys/indices and repeated target assignments fail before mutation.
Unmatched records fail by default; opt in with `--vpd-unmatched ignore` or
`unmatched: 'ignore'` to apply a partial pose and report all unmatched records.
An explicit mapping may override the name. The filename never establishes model
identity. Since VPD has no trustworthy model identifier, the same named pose may
be deliberately bound independently to different compatible models.

The pose is serialized as core joint translation/rotation, with original inverse
binds. Ordinary GLTFLoader preserves the resolved pose without a plugin. Both
material drafts remain optional; core PBR remains independent. Geometry, resources,
source comments and attribution follow the existing converter paths. No new
extension is necessary: core glTF expresses the geometry, and application metadata
expresses binding and reset information.

### Metadata and runtime API

The skeleton container's `extras.mmdPose` stores `{ version: 1, modelId,
metersPerPMXUnit, boneCount }`. `modelId` is SHA-256 of the converter's serialized
parsed model and scale; it is a deterministic binding identifier, not an asset
license or cryptographic authenticity claim. Every bone keeps `extras.pmxBone`
and adds `extras.pmxRest` with `{ modelId, metersPerPMXUnit, index, name,
parentIndex, translation, rotation, scale }`. These arrays are original local
RIGHT-HANDED meter-space rest transforms; current posed transforms must never be
captured as rest. Scale is `[1,1,1]`; `parentIndex: -1` denotes the container.
Root extras retain the historical conversion scale/report. Node metadata is
self-contained because GLTFLoader exposes top-level extras separately from scene
extras. Ordinary node `userData` preserves the application metadata on reload.

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseVPD, createVPDRig, bindVPD, applyVPD, resetVPD }
  from './packages/three-mmd-vpd';

const gltf = await new GLTFLoader().loadAsync('posed.glb');
const rig = createVPDRig(gltf.scene);
const response = await fetch('pose.vpd');
if (!response.ok) throw new Error(`Pose fetch failed: ${response.status}`);
const pose = parseVPD(new Uint8Array(await response.arrayBuffer()));
const binding = bindVPD(rig, pose, { mapping: { '2': 0, '3': 259 } });
applyVPD(rig, binding); // replacement, including omitted bones
applyVPD(rig, binding); // identical result
resetVPD(rig); // ORIGINAL rest, including after posed-asset reload
```

Use pinned Three.js `0.186.1`. `createVPDRig` accepts a model-scoped subtree
containing exactly one container and its skin meshes; it recovers and snapshots
rest metadata rather than reading the current pose. Missing/version-mismatched
metadata, inconsistent scale/count/identity/parents and inverse binds disagreeing
with the rest baseline fail clearly. Inverse-bind consistency permits absolute
`2e-6 * max(1, abs(expected))` per component for FLOAT storage; sub-meter fixture
position tests remain bounded by `2e-6` meters. Old converted assets without the
baseline must be reconverted. The runtime never infers source identity from
`BoneN`, display names, English aliases, traversal order or skin array position.
A binding is scoped to a specific rig instance: applying it to another model or
a second load fails; rebind for each instance. Binding returns immutable
`appliedRecords` and `unmatched` diagnostics. All validation and numeric resolution
precedes transform writes. Applying/resetting refreshes matrices, skeletons and
skinned bounds, retaining the original inverse binds.

Serialization must preserve `pmxBone`, `pmxRest`, `mmdPose`, original inverse binds
and current core joint transforms. The browser suite also exports runtime-posed
ordinary Three.js rigs with GLTFExporter to GLB and embedded-resource glTF,
reloads and resets them. With GLTFExporter, use `includeCustomExtensions: true`
to retain unknown material drafts from ordinary GLTFLoader's
`userData.gltfExtensions`, and copy `gltf.userData` into the exported scene's
`userData` to retain root attribution. This is an application export recipe,
not a general Toon/Outline TSL material exporter. Exporting a replaced custom
material requires its own exporter support.

Pose application owns the complete joint TRS while it runs. Stop an animation
mixer/other external joint writer before apply or reset. The reusable VMD player
now participates in automatic model-scoped VPD/VMD ownership: applying VPD pauses
motion; later play/seek resolves motion from ORIGINAL rest. See the
[VMD contract and APIs](vmd.md). Do not reparent/replace bones after creating a
rig handle; reload and rebind instead.

The historical official Three.js r169 [loader](https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/jsm/loaders/MMDLoader.js),
[parser](https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/jsm/libs/mmdparser.module.js),
and [pose helper](https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/jsm/animation/MMDAnimationHelper.js)
provide implementation evidence for decoding, reflection and rest-relative
composition. They are an alternative implementation, not a normative VPD
specification or measured original-MMD oracle. This profile deliberately rejects
ambiguity and reports unmatched records instead of inheriting last-duplicate-wins
and silent skipping. See [fixture provenance](../tests/fixtures/README.md) and the
[per-case validation record](validation.md#issue-27-solver-free-vpd-bone-offsets).

## Three.js integration

Use the pinned Three.js version in this repository. The reusable TypeScript
source is [the plugin](../packages/three-mmd-toon/index.ts); it uses no upstream
loader modifications or legacy shaders.
The comparison independently loads the original PMX with the released
`@takahirox/three-mmd@0.1.2` TSL `MMDLoader`, sharing Three.js `0.186.1` via
its peer dependency (verify with `npm ls three`).

```ts
import { Vector3, WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin, createToonLighting } from './packages/three-mmd-toon';

const renderer = new WebGPURenderer({ forceWebGL: true }); // false: try WebGPU
await renderer.init();
const lighting = createToonLighting(new Vector3(-0.3, 0.8, 1), new Vector3(0.8, 0.8, 0.8));
const loader = new GLTFLoader();
loader.register((parser) => new MMDToonPlugin(parser, { lighting }));
const { scene } = await loader.loadAsync('model.glb');
```

The explicit light adapter provides a world-space direction **toward** the light
and nonnegative source-component RGB times intensity. Its direction must remain
normalized when changed; its uniforms can be updated at runtime. The adapter
transforms that direction into view space. Three.js supplies inverse-transpose
normals, back-face orientation, flat normals for missing vertex normals, and
view direction. Ordinary scene lights affect PBR only. No scene ambient,
normal/occlusion/emissive maps or `COLOR_0` enter the MMD graph.

All extension factors/references are validated before shader construction;
whole-asset checks enforce texture/image bounds, selected base UVs, UV1 for
subtextures, and triangle primitives. Errors from image loading and shared
resolution propagate through `loadAsync` with material context. An unsupported
optional extension with no plugin uses GLTFLoader's ordinary fallback.

Base `texCoord` and `KHR_texture_transform` are applied only to base UVs. Custom
toon/sphere samplers retain glTF state; sphere UVs come from the oriented normal
in glTF's right-handed view frame. Each MMD texture clone has its own GPU source,
`NoColorSpace`, and `flipY=false`, while sharing the decoded image bytes. PBR's
sRGB view therefore cannot cause input decoding in the MMD view. Filtering and
mipmap generation operate on encoded source components. The fragment graph
implements the draft directly, including no Lambert multiplier on the base,
no clamp before toon after sphere addition, specular after texture operations,
and equality surviving alpha cutoff. The final clamped encoded RGB is decoded
once to linear sRGB, with straight coverage, for Three.js's normal output
transfer and linear blending. Use the default linear-sRGB working space and
sRGB output. Toon materials disable fog and tone mapping; conformance disables
shadows, postprocessing and antialiasing as well.

If a model uses shared toons, pass `resolveSharedToon(index, resourceName)`.
It must return a Three.js texture for the **exact** legally obtained MMD 9.32
resource, decoded in top-to-bottom row order. It may load a separately authorized
PNG transcode; Three.js does not decode BMP by itself. The plugin applies
clamp-to-edge, bilinear base-level sampling, no mipmaps and encoded sampling.
A missing resolver/resource is an error, never a synthetic or white substitute.
See the [shared resource terms](../extensions/MMD_materials_toon/README.md#shared-toon-resources).
This repository supplies no such images or rights. The Gene Light example needs
no resolver. Applications should dispose loaded materials/geometries, call the
plugin's asynchronous `dispose()` for its texture views, and dispose any
resolver-owned originals themselves.

## Outline plugin and effect

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDOutlinePlugin, MMDOutlineEffect } from './packages/three-mmd-outline';

let outlinePlugin: MMDOutlinePlugin;
const loader = new GLTFLoader();
loader.register(parser => outlinePlugin = new MMDOutlinePlugin(parser));
// Optionally also register MMDToonPlugin; outlines do not require Toon shading.
const gltf = await loader.loadAsync('model.glb');
scene.add(gltf.scene);
const effect = new MMDOutlineEffect(renderer);
renderer.setAnimationLoop(() => effect.render(scene, camera));
// effect.enabled = false renders the ordinary base scene.
// Before unloading: effect.release(gltf.scene); outlinePlugin!.dispose();
// Dispose application-owned geometry/materials/textures as usual.
// When finished with the effect: effect.dispose();
```

The [outline plugin](../packages/three-mmd-outline/index.ts) uses `beforeRoot`
to validate declarations, payloads, triangle modes, POSITION/NORMAL, decoded
FLOAT edge data (including unused vertices), buffer bounds/stride/alignment,
sparse replacements and their strictly increasing indices. Suppression never
bypasses validation. `afterRoot` uses GLTFLoader's final primitive/material
associations, including cloned node instances and material groups. The custom
semantic is preserved by GLTFLoader as `_mmd_edge_scale`; no source geometry or
PBR material is replaced. The plugin accepts required outlines when declared
in both arrays; omission of an optional plugin still leaves Toon/PBR independent.

The [effect](../packages/three-mmd-outline/effect.ts) targets Three.js r186
`WebGPURenderer`, both its WebGL2 TSL backend and native WebGPU. Initialize the
renderer before calling `render`. Use default linear-sRGB working space and
sRGB canvas output. It renders a complete base scene with `autoClear=true` on
each call; viewport/scissor panes are supported. XR, logarithmic/reversed depth,
external custom render pipelines and accumulation into an existing destination
(`autoClear=false`) are outside this integration. Use an ordinary 2D linear
render target if rendering offscreen. Dispose the effect before the renderer.
Disposal restores no global hooks because hooks are scoped to each call and
restored even on exceptions. `release(root)` frees hull materials for an unloaded
subtree; `dispose()` frees all hull materials, targets and resolve materials.
Plugin disposal removes loaded-scene outline records and its core alpha metadata.
Application-owned resources remain application-owned.

Hull vertices use original geometry, core POSITION/NORMAL morphs, and the
inverse-transpose of the weighted joint-world/inverse-bind transform for skinning.
Raw weights (including additional core joint/weight sets) are kept independently
of GLTFLoader's base-material weight normalization and sampled from owned float
palettes. A skinned mesh's node transform is ignored, including reflected/singular node
transforms. Unskinned reflected nodes use corrected winding; hardware instances
also handle reflected and singular instance transforms. Mixed reflected hardware
instances use equivalent fragment front-face rejection because GPU fixed-function
winding is per draw. Other hulls use fixed-function front-face culling. There is
no face-normal flip, triangle sorting, texture-alpha discard or depth bias.
LESS_EQUAL and depth writes apply even to partial edge alpha. Source material
visibility and geometry groups remain in force. The exact draft expansion uses
the active viewport's render-target pixel width/height, never CSS dimensions or
the full canvas size. Signed/zero scales and the `1e-12` direction threshold are
preserved. The current supported numeric envelope is FLOAT attribute magnitudes up to
`1e8`, size/product magnitudes up to `1e8`, and transform entries/morph weights
up to `1e4`. Owned palettes are at most 1024 by 2048 texels. Larger ranges report unsupported numeric range; storage is never
clamped. Normal evaluation uses scaled cofactors (equivalent to normalized
inverse-transpose) to avoid tiny-determinant division and length overflow.

Material-factor alpha comes from the **active** model. For core OPAQUE materials,
GLTFLoader discards the source opacity; the plugin preserves it in
`material.userData.mmdBaseFactorAlpha`. Update that field when changing its
factor. For core MASK/BLEND, update `material.opacity` as usual. Active
MMDToonPlugin materials expose their current factor through the JSON-compatible
`userData.mmdMaterialModel` / `mmdDiffuseFactor` binding, which survives loader
cloning. Unsupported/inactive Toon JSON never overrides core alpha. Edge alpha
is independent; exactly zero diffuse factor suppresses it, while nonzero partial
factors do not multiply it. Texture opacity and alphaMode coverage do not enter
this test.

For another material model, register
`new MMDOutlinePlugin(parser, { getDiffuseAlpha: material => currentFactor(material) })`.
The callback must return the current finite factor before texture/coverage
handling; return `1` if the model defines no factor. Missing integration reports
an error. For procedural geometry or application-created groups, use exported
`setOutlineRecords(mesh, [{ payload: { colorFactor, sizeFactor }, materialIndex: 0,
getDiffuseAlpha: material => currentFactor(material) }])`; remove these with
`removeOutlineRecords(mesh)`. The geometry must have finite POSITION/NORMAL and
triangle indices; optional scalar scales use `_MMD_EDGE_SCALE` (or loader's lower
case spelling). `payload` factors can be updated without expanding geometry.

Encoded RGB compositing uses scoped offscreen/resolve passes:

1. Render ordinary base materials into a linear half-float target, preserving
   the renderer's sample count. Base shaders and Toon arithmetic remain unchanged.
2. Unpremultiply, apply the ordinary base output tone/color transfer once, and
   premultiply in sRGB encoded components into a **NoColorSpace** half-float target.
   Copy the retained depth with an ALWAYS fullscreen depth write.
3. Draw unlit hulls with straight clamped source RGBA, normal source-over,
   LESS_EQUAL and depth writes. Neither edge RGB nor destination RGB is sRGB
   decoded for blending. This target bypasses automatic sRGB framebuffer blending.
4. Resolve encoded color/depth to the caller's viewport. Unpremultiply and decode
   RGB once, then premultiply for Three's output boundary, whose normal transfer
   preserves the encoded result. Alpha never receives a color transfer.

MSAA uses the renderer's sample count on both internal targets. The base depth
copy uses its resolved depth; sample-specific base depth at coverage boundaries
is not retained. Focused conformance uses one sample (`antialias:false`) to avoid
coverage/resolve ambiguity. Backend floating-point precision and transparent
primitive submission order remain ordinary rasterization limits. Native WebGPU
uses the same TSL graph; it is an explicit validation skip without an adapter.
See the [actual GPU and browser measurements](validation.md#issue-21-outline-pipeline).

## Direct PMX comparison

The two scenes share one scissored `WebGPURenderer`, one perspective camera and
one `OrbitControls` instance. Equal view rectangles sit side by side on desktop
and stack at 700 CSS pixels or less. Drag/pan/zoom in either view moves both;
Front, Side and Back reset a fixed camera and target (including residual damping).
Only the right view switches between extension toon and independent core PBR.
WebGL2 is the default for reproducible diagnostics; `?backend=webgpu` opts in to
WebGPU when available. Both scenes have the same dark blue background, white
0.8 directional source toward normalized `(-0.3, 0.8, 1)`, no ambient scene light,
no shadows, sRGB output and no tone mapping. The extension gets that same direction
and source RGB through its explicit adapter; the PMX/PBR materials use the scene
light. Their distinct equations do not imply identical output.

`MMDLoader.loadAsync` loads the hash-verified original PMX. Its `LoadingManager`
also waits for all original images before reporting ready. The loader already
reflects Z/winding, so only a uniform `0.08` scale is applied. Neither model is
independently centered, rotated or fitted to hide differences. The camera uses
the converted model's bounds for both views. No animation helper, IK/physics
stepping or morph updates are used. The Outline menu toggles the published
three-mmd outline effect on the PMX pane and the v0.1 effect on the glTF pane.
The former uses its legacy thickness law; the latter uses the draft viewport
equation and encoded blending. Differences are labeled, not compensated away. See the [visual investigation](comparison.md) for captures,
remaining shading differences and reproduction steps. The direct PMX reference
is not proof of equivalence to the MikuMikuDance executable.

## Building and Pages

`npm run build` re-verifies all source hashes, regenerates the derivative GLB,
copies the reviewed source allowlist, then builds `examples/index.html` and `examples/rig.html`
into `dist/`. The Gene comparison ships its GLB, the original `Gene_light.pmx`, ten `light/` PNGs,
both notices, manifest, conversion record and application bundle. The generated
`public/gene-light/` directory is cleaned before packaging so stale files cannot
leak into the site. No full Gene, unused textures, motions, conformance runner or
model archive is included. The separate `bdef/` directory contains only the
synthetic source PMX, converter-produced GLB and conversion/attribution record.
The source manifest records all original byte hashes;
the conversion record records the derivative SHA-256 and 0.08 scale.
`npm run preview` serves the prefixed static build.

The [Pages workflow](../.github/workflows/pages.yml) tests pull requests and
builds/deploys a push to `main`, using GitHub's Pages artifact workflow. Enable
**Settings → Pages → Source: GitHub Actions** once. The fixed Vite base is
`/mmd-gltf/`, appropriate for this repository's project site. A fork under a
different repository name must update that base. No isolation headers or server
API are required. The distribution review covers this personal noncommercial
technical demonstration; other use categories require a new review.

After the merge-triggered workflow, perform the required public checks in
[the validation record](validation.md#required-post-merge-verification).
Local preview does not establish publication success.
