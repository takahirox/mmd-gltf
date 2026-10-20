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
`doubleSided`. Diffuse alpha below one, a base image, or a subtexture conservatively
selects `BLEND` (depth writes disabled by the plugin); otherwise the material is
`OPAQUE`. This preserves fractional texture opacity without guessing a cutoff.
The converter does not infer alpha-mask intent. The plugin also supports authored
core `MASK` and `alphaCutoff`.

The extension is used, never required, so ordinary glTF viewers can load the
fallback. Geometry is the stored base pose, without bones/skins, SDEF evaluation,
IK, grants, physics, animations or morphs. Outline/edge and shadow flags are kept
in extras but not rendered. Additional UV ZW/unused sets and PMX-specific runtime
features are omitted with a conversion report. PMD, VMD and VPD are unsupported.
Gene Light contains no shared/custom toon or sphere image; the generic conversion
tests exercise those modes using synthetic source material configurations.

## Three.js integration

Use the pinned Three.js version in this repository. The reusable TypeScript
source is [the plugin](../packages/three-mmd-toon/index.ts); no upstream loader
modifications or legacy `MMDLoader`/Phong shaders are used.

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

## Building and Pages

`npm run build` re-verifies all source hashes, regenerates the derivative GLB,
copies both original notices, then builds only `examples/index.html` into
`dist/`. It ships one GLB, notices, manifest, conversion record and application
bundle; no source PMX, duplicate PNGs, conformance runner or original model
archive is needed. `npm run preview` serves the prefixed static build.

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
