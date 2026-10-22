# Static PMX pipeline

## Conversion

From the repository root, after `npm ci`:

```sh
npm run convert -- path/to/model.pmx output/model.glb
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
fallback. Geometry is the stored base pose, without bones/skins, SDEF evaluation,
IK, grants, physics, animations or morphs. PMX edge flag `0x10` enables `MMD_materials_outline`; edge RGBA and size are
copied unchanged (defaults `[0,0,0,1]` and `1`). Signed per-vertex `edgeRatio`
becomes a shared FLOAT/SCALAR `_MMD_EDGE_SCALE`, attached only to outlined
primitives, omitted when every stored ratio is exactly one. Zero stays zero.
Material size is never baked into geometry or ratios. Edge fields and shadow
flags remain in extras; shadow flags have no runtime effect. Additional UV ZW/unused sets and PMX-specific runtime
features are omitted with a conversion report. PMD, VMD and VPD are unsupported.
Gene Light contains no shared/custom toon or sphere image; the generic conversion
tests exercise those modes using synthetic source material configurations.

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
copies the reviewed source allowlist, then builds only `examples/index.html`
into `dist/`. It ships one GLB, the original `Gene_light.pmx`, ten `light/` PNGs,
both notices, manifest, conversion record and application bundle. The generated
`public/gene-light/` directory is cleaned before packaging so stale files cannot
leak into the site. No full Gene, unused textures, motions, conformance runner or
model archive is included. The source manifest records all original byte hashes;
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
