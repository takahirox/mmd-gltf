# MMD_materials_toon

## Status and dependencies

**Version 0.1, draft.** Written against glTF 2.0. This is one proposed,
engine-independent shading model, with MikuMikuDance's standard appearance
(without MME) as its visual target. It is an interoperable approximation, not
an assertion that the unpublished MMD executable uses these exact equations.
The draft may change before release; breaking changes after a stable release
require a new major version. There is no per-material version or profile selector.

The extension is applied to `materials[i].extensions.MMD_materials_toon`.
No other extension is required. `KHR_texture_transform` is optional on
`baseTexture`. The words MUST, MUST NOT, SHOULD, and MAY express normative
requirements, recommendations, and permissions, respectively.

The equations cover one directional light and no self-shadow contribution.
`MMD_materials_outline` is independent. Shadows/shadow maps, special PMX
material flags, PMX 2.1 vertex colors, material-morph animation data,
multiple-light policies, and scene/camera/light storage are outside this draft.
Core `COLOR_0` does not modulate this model. This document defines neither a
runtime nor a converter.

## Material properties

The [JSON Schema](schema/material.MMD_materials_toon.schema.json) is a
self-contained JSON Schema 2020-12 document. All top-level material properties
are optional, so `{}` is valid. Defaults apply when a property is absent;
schema `default` annotations do not insert values. `null` is not omission.

| Property | Type / default | Meaning |
| --- | --- | --- |
| `diffuseFactor` | four finite numbers / `[1,1,1,1]` | PMX diffuse RGB and opacity |
| `ambientFactor` | three finite numbers / `[0,0,0]` | PMX ambient RGB |
| `specularFactor` | three finite numbers / `[0,0,0]` | PMX specular RGB |
| `shininessFactor` | finite number >= 0 / `0` | Specular exponent; zero disables specular |
| `baseTexture` | optional glTF `textureInfo` | Base color/alpha texture, independent of the PBR base texture |
| `sharedToonIndex` | optional integer 0–9 | Implementation-provided `toon01.bmp` through `toon10.bmp` |
| `toonTexture` | optional `{ "index": integer >= 0 }` | Custom toon, referring to `textures[index]` |
| `sphereTexture` | optional `{ "index": integer >= 0 }` | Sphere or additional texture, referring to `textures[index]` |
| `sphereMode` | string / `"none"` | `"none"`, `"multiply"`, `"add"`, or `"subTexture"` (PMX modes 0, 1, 2, 3) |

`sharedToonIndex` and `toonTexture` MUST NOT both be present. Neither present
means no toon operation (identity RGB). A converter MAY explicitly select a
shared neutral toon when appropriate for the source material.

A mode other than `"none"` requires `sphereTexture`. A sphere reference with
mode omitted or `"none"` has no shading effect, but its index must still be valid.
`toonTexture` and `sphereTexture` contain **only** `index`: `texCoord`,
`KHR_texture_transform`, and other members are invalid in these two objects.

`baseTexture` has the glTF `textureInfo` shape: required `index`, optional
nonnegative integer `texCoord` (default 0), `extensions`, and `extras`.
`KHR_texture_transform`, if used, selects its overriding `texCoord` when present
and transforms that UV as specified by that extension. It applies only to the
base texture. The schema mirrors the core textureInfo shape without network
references; extension payloads need their own schemas. The root extension
object accepts glTF `extensions` (an object of extension objects) and arbitrary
`extras`, but rejects other unknown material properties in this draft.

All numeric inputs MUST be finite; JSON's number grammar excludes NaN and
infinities, and loaders MUST reject overflow to non-finite machine values.
RGB factors preserve stored PMX values, including values outside [0,1]; they
MUST NOT be derived from PBR or silently clamped on input. Diffuse alpha is
also unrestricted until the final clamp, allowing the same explicit evaluation
rule for out-of-range factors. Only shininess has a nonnegative constraint.

An omitted base texture contributes `(1,1,1,1)`. An absent toon selector or
inactive sphere mode performs no sampling. A present reference whose texture
or image is missing is an **asset/resource error**, not a white-texture fallback.
All indices MUST address the top-level `textures` array, including inactive
sphere references. Array bounds, image availability, and required vertex
attributes are whole-asset checks beyond the local extension schema.

## Shared toon resources

The reference image set is **MikuMikuDance 9.32 x64**, the ten
`MikuMikuDance_v932x64/Data/toon01.bmp` through `toon10.bmp` resources in the
archive distributed by Yu Higuchi's [VPVP site](https://sites.google.com/view/vpvp/),
section 1.4 (64bitOS Ver). The [official archive link](https://drive.google.com/uc?export=download&id=1Iucxu0tDsD05Siyv8VBGgm9vjD-f-RhM)
was inspected on 2026-10-17 for the version and resource names. This identifies
a reference set, not a license grant or a claim of pixel equivalence to MMD.

| Index | Resource | Index | Resource |
| --- | --- | --- | --- |
| 0 | `toon01.bmp` | 5 | `toon06.bmp` |
| 1 | `toon02.bmp` | 6 | `toon07.bmp` |
| 2 | `toon03.bmp` | 7 | `toon08.bmp` |
| 3 | `toon04.bmp` | 8 | `toon09.bmp` |
| 4 | `toon05.bmp` | 9 | `toon10.bmp` |

Implementations supporting shared selectors MUST provide the corresponding
images through their own resource mechanism. Authors MUST NOT embed these ten
images into glTF/GLB solely because they are shared toons. A resource resolver
that cannot supply the selected image MUST report the missing resource; it
MUST NOT silently substitute another ramp. Shared resources are not entries in
the asset's `textures` array. A material using only a shared selector needs no
`images` or `textures` array.

The image provenance is the MMD distribution, not a Khronos image set. Consult
the archive's `readme.txt` for MMD use/distribution terms; this draft does not
establish a separate redistribution license for its toon images. This
repository grants no rights to redistribute those images and assumes no
redistribution permission from the PMX format description. Implementers must
obtain resources under applicable permission/terms independently. This repository
contains only newly constructed synthetic fixture colors and images; no shared
MMD image bytes are included. Synthetic ramps test the math and orientation,
not the visual contents of the standard images.

Shared images MUST use clamp-to-edge in both dimensions, bilinear filtering at
base level (no mipmaps), and the decoded top-to-bottom orientation below.
Custom toon and sphere textures use their glTF samplers. Changing the shared
sampling rule requires a documented specification revision.

## Compatibility and independent fallback

This is an alternate shading model, like `KHR_materials_unlit` in that respect.
When supported, implementations MUST use the extension model and MUST NOT read
`pbrMetallicRoughness.baseColorFactor`, `baseColorTexture`, `metallicFactor`,
`roughnessFactor`, or core PBR lighting inputs such as `emissiveFactor`,
`emissiveTexture`, `normalTexture`, and `occlusionTexture` as inputs to it.
The same texture index MAY be referenced by the two models independently.
Common glTF state `alphaMode`, `alphaCutoff`, and `doubleSided` still applies.

Authors SHOULD provide a suitable core PBR fallback, list `MMD_materials_toon`
in `extensionsUsed`, and normally omit it from `extensionsRequired` when that
fallback is acceptable. If fallback rendering is unacceptable, the extension
MAY be required; unsupported clients then follow glTF's required-extension
failure behavior. An unsupported optional extension leaves ordinary PBR
rendering. Authors SHOULD NOT combine this extension with another independent
shading-model extension on the same material; their composition is undefined.

## Coordinates, inputs, and sampling

All quantities supplied to evaluation are finite. `Lrgb` is the scene's
nonnegative directional-light RGB times intensity, in the source-component
arithmetic domain defined below; it may exceed one. The scene adapter must
provide these values explicitly. Light storage, physical light units, and
mapping other light models to this input are not specified.

`N` is the normalized shaded geometric/interpolated surface normal, `L` the
unit direction **toward** the directional light, and `V` the unit direction
**toward** the camera. All three MUST use the same orthonormal coordinate space.
A stored light travel direction must therefore be negated to obtain `L`.
Normals follow glTF transforms (including the inverse-transpose normal
transform and normalization); absent vertex normals follow core glTF flat
normal behavior. For a double-sided back face, reverse the normal before
lighting as required by glTF. Zero-length normals and light/view directions
are invalid evaluation inputs. No additional normal map is applied.

`normalView` is that same oriented surface normal, transformed and normalized
in the glTF right-handed view frame: +X right, +Y up, camera looking down -Z.
An engine with different internal axes MUST convert to this frame. It MUST NOT
silently flip/rotate texture coordinates to imitate another renderer.

All UVs use glTF's image convention: `(0,0)` is the **top-left**, +U right,
+V down. Decoded image row 0 is the visual top row, regardless of BMP file-row
storage direction. Texel centers are `((i+0.5)/width, (j+0.5)/height)`.
Addressing and interpolation take place in these UVs; there is no implicit
texture flip. Custom textures follow glTF sampler addressing/filtering,
including mip filters when specified. RGB filtering and mip generation MUST
operate on normalized encoded components in this draft, not decoded linear RGB.
Alpha is filtered as an ordinary linear component. Tests explicitly use base
level sampling and fully specified filters to avoid sampler/LOD ambiguity.

- Base UV: interpolated `TEXCOORD_n`, selected by `baseTexture.texCoord` or
  `KHR_texture_transform` as described above. The selected attribute MUST exist.
- Toon UV: `(0, clamp01(dot(N,L) + 0.5))`. Thus directions with dot product
  <= -0.5 sample the top edge, zero samples the middle, and >= 0.5 the bottom.
  The coefficient is **1**, not the common `0.5 * dot(N,L) + 0.5` mapping.
- Sphere UV: `(0.5 + normalView.x*0.5, 0.5 - normalView.y*0.5)`.
- Subtexture UV: interpolated `TEXCOORD_1.xy`, containing PMX **Additional UV1
  XY**, irrespective of the base texture's set. Each primitive using this mode
  MUST have `TEXCOORD_1`; absence makes the asset invalid. Additional UV1 ZW
  may be preserved by a future vertex-data extension.

## Normative reference evaluator

`D = diffuseFactor.rgb`, `A = ambientFactor`, `P = specularFactor`,
`q = shininessFactor`. Defaults are applied first. `*` between vectors is
componentwise multiplication; `clamp01` is componentwise clamping to [0,1].
`sample` takes an explicit texture reference, UV, and that texture's sampling
state and returns RGBA as specified above. `baseUV` is the resolved base UV;
`uv1` is the interpolated additional UV described above. `shared(i)` resolves
the exact resource name in the table and uses the fixed shared sampling state.

```text
T = (1,1,1,1)
if baseTexture is present:
    T = sample(baseTexture.index, baseUV, baseSampler)

litBase = clamp01(D * Lrgb + A)
surfaceRGB = litBase * T.rgb
alpha = diffuseFactor.a * T.a

sphereUV = (0.5 + normalView.x*0.5, 0.5 - normalView.y*0.5)
if sphereMode == "subTexture":
    require uv1 exists
    S = sample(sphereTexture.index, uv1, sphereSampler)
    surfaceRGB *= S.rgb
    alpha *= S.a
else if sphereMode == "multiply":
    S = sample(sphereTexture.index, sphereUV, sphereSampler)
    surfaceRGB *= S.rgb
else if sphereMode == "add":
    S = sample(sphereTexture.index, sphereUV, sphereSampler)
    surfaceRGB += S.rgb

if sharedToonIndex or toonTexture is present:
    toonUV = (0, clamp01(dot(N,L) + 0.5))
    if sharedToonIndex is present:
        R = sample(shared(sharedToonIndex), toonUV, sharedSampler).rgb
    else:
        R = sample(toonTexture.index, toonUV, toonSampler).rgb
    surfaceRGB *= R

specRGB = (0,0,0)
if q > 0 and length(L + V) > 0:
    H = normalize(L + V)
    specRGB = P * Lrgb * pow(max(dot(N,H), 0), q)

finalRGB = clamp01(surfaceRGB + specRGB)
finalAlpha = clamp01(alpha)

if alphaMode == "OPAQUE":        # glTF default
    coverage = 1
else if alphaMode == "MASK":
    if finalAlpha < alphaCutoff: # default cutoff 0.5; equality survives
        discard fragment
    coverage = 1
else:                          # BLEND
    coverage = finalAlpha
```

There is no Lambert `dot(N,L)` multiplier on `litBase`. Light direction affects
toon and specular; it does not affect the base term when toon/specular are
absent. An exactly zero `L+V` disables specular to avoid an undefined half-vector.
No other intermediate clamp is permitted: in particular sphere-add is not
clamped before toon, and negative specular factors reach the final sum before
clamping. `q=0` always disables the highlight, including at `dot(N,H)=0`.

Base, sphere, subtexture, and toon color affect the diffuse/ambient result,
**not** the final specular term. Sphere multiply/add ignores sampled alpha.
Subtexture multiplies RGB and alpha; toon alpha never affects opacity.
No Phong normalization, Fresnel term, extra ambient coefficient, or map-dependent
`0.2` emissive heuristic is part of this equation.

## Color domain and output

This draft uses the **MMD source-color component domain**. PMX numeric factors
are used as stored. An 8-bit color channel `b` samples as `b/255`, with no sRGB
decoding before filtering or arithmetic. The same rule applies to base, toon,
and sphere RGB. Alpha is always linear coverage and MUST NOT be gamma-converted.

`finalRGB` is the desired **encoded sRGB output component value**, before
quantization; it MUST NOT receive a second sRGB encoding. For an opaque sample
with `finalRGB = (0.5,0.5,0.5)`, an 8-bit sRGB output is approximately
`(128,128,128)`, not `(188,188,188)`. This convention intentionally differs
from core PBR's linear-light equation.

An implementation with a linear framebuffer must first decode each final
component `c` to `linearRGB`, then allow the normal framebuffer sRGB encoding:

```text
srgbDecode(c) = c/12.92                       if c <= 0.04045
                ((c+0.055)/1.055)^2.4        otherwise
srgbEncode(x) = 12.92*x                      if x <= 0.0031308
                1.055*x^(1/2.4)-0.055       otherwise
```

For example, `srgbDecode(0.5) = 0.21404114048223255`, which encodes back to
0.5. An internal linear renderer must reproduce the source-component equation
before this final decode; simply decoding inputs and performing the same
multiplications/additions in linear space changes the model. If an image is
shared with a PBR fallback, the two uses may require distinct sampling views.

`BLEND` uses straight (unassociated) RGB and the evaluated coverage. When
compositing into a linear sRGB framebuffer, source-over color is
`coverage * srgbDecode(finalRGB) + (1-coverage) * backgroundLinearRGB`
for an opaque background, followed by one sRGB encoding. `OPAQUE` and surviving
`MASK` samples use full coverage regardless of `finalAlpha`. Blending does not
change the material's returned `finalRGB` or `finalAlpha`.

Conformance evaluation disables tone mapping, postprocessing, fog, antialiasing,
and shadows. The extension specifies a material calculation, not an entire
output pipeline or identical GPU rasterization.

## Complete JSON examples

### Independent fallback with a shared toon

This is a valid material-only glTF asset with no mesh. The PBR fallback differs
from the extension. The identical file is [material-only.gltf](examples/material-only.gltf).

```json
{
  "asset": {"version": "2.0"},
  "extensionsUsed": ["MMD_materials_toon"],
  "materials": [
    {
      "name": "Example MMD material",
      "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.7, 0.6, 1], "metallicFactor": 0, "roughnessFactor": 1},
      "alphaMode": "BLEND",
      "doubleSided": true,
      "extensions": {
        "MMD_materials_toon": {
          "diffuseFactor": [1, 0.8, 0.7, 0.8],
          "ambientFactor": [0.3, 0.3, 0.3],
          "specularFactor": [0.2, 0.2, 0.2],
          "shininessFactor": 10,
          "sharedToonIndex": 3
        }
      }
    }
  ]
}
```

### Base texture, custom toon, and additional UV1

[subtexture.gltf](examples/subtexture.gltf) is a complete, self-contained triangle
with embedded buffer and newly generated PNGs. `TEXCOORD_0` is the base UV and
`TEXCOORD_1` is PMX Additional UV1 XY. Its three textures are a solid base
`(255,128,64,204)/255`, a top-dark/bottom-white 1x2 toon ramp, and a solid
subtexture `(128,255,128,128)/255`. The PBR fallback uses different factors.
No shared image resources or external files are needed.

```json
{
  "asset": {"version": "2.0"},
  "extensionsUsed": ["MMD_materials_toon"],
  "scene": 0,
  "scenes": [{"nodes": [0]}],
  "nodes": [{"mesh": 0}],
  "meshes": [
    {
      "primitives": [
        {
          "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2, "TEXCOORD_1": 3},
          "material": 0
        }
      ]
    }
  ],
  "buffers": [
    {
      "byteLength": 120,
      "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AACAPgAAQD8AAEA/AABAPwAAgD4AAIA+"
    }
  ],
  "bufferViews": [
    {"buffer": 0, "byteOffset": 0, "byteLength": 36, "target": 34962},
    {"buffer": 0, "byteOffset": 36, "byteLength": 36, "target": 34962},
    {"buffer": 0, "byteOffset": 72, "byteLength": 24, "target": 34962},
    {"buffer": 0, "byteOffset": 96, "byteLength": 24, "target": 34962}
  ],
  "accessors": [
    {
      "bufferView": 0,
      "componentType": 5126,
      "count": 3,
      "type": "VEC3",
      "min": [0, 0, 0],
      "max": [1, 1, 0]
    },
    {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"},
    {"bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC2"},
    {"bufferView": 3, "componentType": 5126, "count": 3, "type": "VEC2"}
  ],
  "samplers": [{"magFilter": 9729, "minFilter": 9729, "wrapS": 33071, "wrapT": 33071}],
  "images": [
    {
      "uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP43+BwBgAGzQKMGQN9IwAAAABJRU5ErkJggg=="
    },
    {
      "uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEElEQVR4nGNwcHD4z/AfCAAV+gW8/wvl6AAAAABJRU5ErkJggg=="
    },
    {
      "uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNo+N/QAAAGggKAgVft1AAAAABJRU5ErkJggg=="
    }
  ],
  "textures": [
    {"sampler": 0, "source": 0},
    {"sampler": 0, "source": 1},
    {"sampler": 0, "source": 2}
  ],
  "materials": [
    {
      "pbrMetallicRoughness": {"baseColorFactor": [0.1, 0.2, 0.9, 1], "metallicFactor": 0, "roughnessFactor": 1},
      "alphaMode": "BLEND",
      "extensions": {
        "MMD_materials_toon": {
          "diffuseFactor": [1, 0.8, 0.7, 0.8],
          "ambientFactor": [0.3, 0.3, 0.3],
          "baseTexture": {"index": 0, "texCoord": 0},
          "toonTexture": {"index": 1},
          "sphereTexture": {"index": 2},
          "sphereMode": "subTexture"
        }
      }
    }
  ]
}
```

## Conformance and design clarifications

The [fixture guide](tests/README.md) describes the hand-calculated shading
vectors, schema cases, whole-asset rejection cases, and executable checks.
Expected components have absolute tolerance **1e-6**; indices, selectors,
discard decisions, and UV-source selection must match exactly (UV numbers
use the numerical tolerance). Test inputs provide normals/light/view values
and synthetic sample grids, so no engine implementation supplies the oracle.

The following clarifications make the Issue's proposal well-defined without
introducing additional shading profiles:

- Defaults make all root fields optional; texture references still require
  `index`. Finite out-of-range alpha is clamped at the specified final point.
- White sampling describes omission, never broken references. Active sphere
  modes require a reference, and missing shared resources are errors.
- Zero `L+V` produces no specular, resolving undefined normalization.
- Source-domain results are already encoded output components. A final decode
  before an sRGB framebuffer transfer prevents double encoding; blending uses
  the decoded result in a linear target.
- The shared resource version and base-level filtering are fixed explicitly;
  no undocumented engine rotation, sampling switch, or resource substitution
  is permitted.

## References and design precedence

1. [Japanese PMX specification](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt):
   primary data-layout reference for material fields, shared Toon indices,
   sphere modes, and Additional UV1. It does not define this entire pixel equation.
2. [PMX Editor readme excerpt](https://w.atwiki.jp/xismo_userpg/pages/114.html):
   context for diffuse/light plus ambient, with toon shading.
3. [Saba MMD fragment shader](https://github.com/benikabocha/saba/blob/master/viewer/Saba/Viewer/resource/shader/mmd.frag):
   composition-order reference, not a normative implementation to copy.
4. [Three.js ambient-color investigation](https://github.com/mrdoob/three.js/issues/28336):
   background on ambient/map ordering and the historical heuristic.
5. [three-mmd material shading](https://github.com/takahirox/three-mmd-loader/blob/main/docs/material-shading.md):
   comparison with a renderer-specific adaptation, whose linear space,
   coefficients, lighting, and specular policy are not imported here.
6. [KHR_materials_unlit](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md):
   alternate-model and optional-fallback structure.
7. [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
   and [KHR_texture_transform](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md):
   core material state, geometry, image/UV conventions, and base UV transforms.

PMX data semantics take precedence for mapping source fields. The equations and
conventions in this draft take precedence for evaluation. PMX 2.1 leaves some
vertex-color computation implementation-defined; this draft specifies its own
material equation and excludes those vertex colors. It claims no numerical
comparison with the original executable.
