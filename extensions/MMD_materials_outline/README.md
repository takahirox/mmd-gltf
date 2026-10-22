# MMD_materials_outline

**Version 0.1, draft, for glTF 2.0.** This specification targets standard
MikuMikuDance (MMD) outlines. Its rendering choices are provisional where original
MMD behavior has not been verified. MUST, MUST NOT, SHOULD and MAY indicate
normative requirements, prohibitions, recommendations and permissions.

## 1. Extension placement and independence

Attach this extension at `materials[i].extensions.MMD_materials_outline`.
Presence, including `{}`, enables the material's outline; absence disables it.
There is no redundant `enabled` field. It is independent of
`MMD_materials_toon` and compatible with any glTF material. The material system
supplies the diffuse-alpha integration described in chapter 6; Toon support is
not a prerequisite.

Implementations reuse the source primitive's vertices and triangles for an
inverted hull pass. No duplicate pre-expanded mesh is required.

## 2. Material properties

The self-contained [JSON Schema 2020-12](schema/material.MMD_materials_outline.schema.json)
validates the extension object. All properties are optional. Defaults apply on
omission; `null` is invalid. Schema defaults are annotations, not inserted values.

| Property | Type / default | Meaning |
| --- | --- | --- |
| `colorFactor` | four finite numbers / `[0,0,0,1]` | PMX source edge RGBA, stored unchanged |
| `sizeFactor` | finite number / `1.0` | PMX source material edge size, stored unchanged |
| `extensions` | object of extension objects / omitted | glTF extension container |
| `extras` | any JSON / omitted | Application data |

Other unknown properties are invalid in this draft. Numbers MUST remain finite
after decoding; overflowing JSON such as `1e400` MUST be rejected. Color
components have no input [0,1] restriction. There is no nonnegative restriction
on stored size or vertex scale. Preserve representable finite PMX values without
converter-specific color compensation, unit conversion, absolute value or clamp.
Runtime color evaluation is specified in chapter 6.

`sizeFactor` is a source value, **not inherently a number of pixels**, a glTF
length in meters, or a particular engine's thickness parameter. Chapter 5
chooses how this draft renderer converts it to displacement.

PMX material edge flag `0x10` set maps to extension presence; clear maps to
absence. Copy PMX edge RGBA and size directly. Values equal to defaults MAY be
omitted. PMD material edge flag 1 enables the extension, 0 disables it; PMD has
no PMX edge RGBA/size fields, so use defaults unless separately authored source
scene settings are available.

## 3. Per-vertex edge scale

On outlined primitives, `_MMD_EDGE_SCALE` is an optional custom vertex semantic:

| Accessor rule | Requirement |
| --- | --- |
| `componentType` | `5126` (`FLOAT`, 32-bit) only |
| `type` | `SCALAR` |
| `normalized` | absent or `false` |
| `count` | Equal to `POSITION.count`, including unused vertices |
| Decoded values | Finite, signed; no lower or upper clamp |
| Absent attribute | **1.0 for every vertex** |
| Sparse accessor | Allowed under core glTF sparse replacement and bounds rules |

Copy the PMX per-vertex edge multiplier unchanged. PMD vertex edge-invisible
flag 1 maps to scale 0, flag 0 to scale 1. When shared vertices serve several
material primitives, preserve their scale and apply each material's size
separately. Do not bake the material size into this attribute.

```text
edgeSize = sizeFactor * vertexEdgeScale
```

This is the signed source-size product, before conversion to pixel displacement.
Zero scale produces zero vertex displacement. A negative product reverses the
expansion direction in chapter 5; it MUST NOT be clamped, discarded or replaced
with its absolute value. This signed treatment is a draft rendering choice,
not a claim about original MMD's response to negative inputs.

A present sparse accessor without a base `bufferView` starts with **zeros**,
not ones; then apply its replacements. The absent-attribute default is distinct
from this core accessor initialization. Buffer offsets, stride, bounds, alignment
and sparse indices obey glTF 2.0. Validate every decoded value, including unused
vertices, even when rendering is suppressed.

The semantic has an outline effect only on primitives using this extension.
It is static: morph targets MUST NOT contain `_MMD_EDGE_SCALE`. Do not derive
it from vertex colors, weights, UVs or opacity. Ordinary skinning does not change
its stored value.

Outlined primitives MUST have `POSITION` and `NORMAL` and use `TRIANGLES` (4,
including omitted `mode`), `TRIANGLE_STRIP` (5) or `TRIANGLE_FAN` (6). Core glTF
rules govern their types/counts and triangle assembly, including strip winding
alternation. Degenerate triangles generate no fragments. Points and lines are
invalid for this extension, even for suppressed draws.

## 4. Vertex transforms and coordinates

Use column vectors and glTF's right-handed coordinates. A camera looks along
view -Z, with +X right and +Y up. `M` is the node world matrix, `V` is the
core glTF view matrix (inverse of the camera's world translation and rotation,
with camera scale ignored), and `P` is the core glTF perspective or orthographic
projection, with canonical clip volume `-w <= x,y,z <= w`. Implementations with
another clip-depth interval or inverted framebuffer Y MUST adapt at their API
boundary, after the operations here. Do not change signs in this algorithm.
No half-pixel correction is applied. Standard glTF projections have perspective
`clip.w=-view.z` and orthographic `clip.w=1`. The camera's world transform MUST
permit a defined core glTF view matrix; an undefined core camera view is not
given a substitute interpretation by this extension.

First apply core glTF morph target POSITION/NORMAL deltas with their current
weights. Let `p` and `n` be the morphed mesh-local position and normal. Define
the effective mesh-to-world transform `D` separately for each vertex:

- For an unskinned primitive, `D = M`.
- For a skinned primitive, `D = sum_i(weight_i * jointWorld_i * inverseBind_i)`
  over all nonzero core glTF joint influences, with identity inverse bind
  matrices when omitted. Use the core decoded joint weights. As required by
  [core glTF skinning](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc#skinned-mesh-primitives),
  the instantiating mesh node's `M` is ignored: do not multiply by or invert it.
  Changing that node's transform while joint-world matrices remain unchanged
  MUST NOT change the skinned outline's positions, normals, culling or draw
  suppression. Node/ancestor transforms still contribute through `jointWorld_i`
  when they affect joints. A primitive without skinning attributes is unskinned
  even if its node references a skin.

Define `T = V D`, with affine bottom row `(0,0,0,1)`. Use the inverse transpose
of its upper-left 3x3 for the normal:

```text
q = T * vec4(p, 1)
a = transpose(inverse(mat3(T))) * n
nView = a / length(a)
c = P * q
```

No intermediate normalization of morphed normals is necessary. The normal
matrix is essential under nonuniform scaling; transforming normals as positions
is incorrect. If `mat3(T)` is singular or `a` is zero, define `nView=(0,0,0)`
for that vertex. If `M` is singular, skip only unskinned primitives; a singular
mesh-node transform MUST NOT suppress skinned outlines. This supplies
deterministic degeneracy behavior, not a different skinning profile.
MMD SDEF/QDEF/IK/physics are not introduced here. If converted
to core glTF animation/skins/morphs, the resulting core deformation is used.

PMX-to-glTF handedness conversion is the converter’s responsibility.

Do not flip vertex normals on back faces or multiply them by a determinant sign.
For unskinned primitives, use the core glTF winding correction for a negative
determinant of `mat3(M)` when determining front/back faces. For skinned primitives,
use counterclockwise front-face winding without a mesh-node determinant
correction. Negative joint transforms and local skin folds may invert individual
triangles; their actual deformed winding is used, without per-joint or per-vertex
determinant repairs. Cull front faces of the **expanded** triangles, regardless
of source material `doubleSided`. Triangle vertices shared across material
groups get the same deformation/scale but a separate extrusion for each draw.

## 5. Provisional expansion equation

Let `W,H` be the positive integer width and height of the active viewport in
render-target pixels, before subsequent image scaling. They are neither CSS
pixels nor necessarily the full render-target dimensions. A sub-viewport uses
its own width/height. For material size `s`, decoded vertex scale `v`, normalized
view-space normal `nView`, and unexpanded clip position `c`, use exactly:

```text
e = s * v
n = nView.xy / length(nView.xy)    if length(nView.xy) > 1e-12, else (0,0)
cOutline.x = c.x + c.w * (2 * e * n.x / W)
cOutline.y = c.y + c.w * (2 * e * n.y / H)
cOutline.z = c.z
cOutline.w = c.w
```

The provisional thickness coefficient is **1.0**. The direction threshold is
applied after 3D normal normalization. A zero normal, view-axis normal or singular
vertex transform gives direction `(0,0)`. A zero size or scale also gives no
displacement. No distance attenuation, depth bias, model-unit conversion or
additional thickness clamp is applied. Arithmetic is over real numbers;
implementations MUST avoid overflow/NaN for supported assets, or report an
unsupported numeric range instead of silently clamping.

For `c.w>0`, the NDC displacement is `(2*e*n.x/W, 2*e*n.y/H)` and the pixel
displacement is `e*n`. Thus the chosen equation converts the source product to
a signed pixel displacement **in this draft renderer**. It does not assign a
pixel unit to the stored PMX field. Pixel coordinates for bottom-left viewport
origin `(ox,oy)` are:

```text
pixel = (ox + (cOutline.x/cOutline.w + 1)*W/2,
         oy + (cOutline.y/cOutline.w + 1)*H/2)
```

This describes vertex displacement, not guaranteed rasterized contour width.
In this formula, perspective distance, FOV, orthographic magnification and
viewport resizing do not change displacement length in render-target pixels.
The viewport origin does not affect it; subsequent image scaling scales it
with the image. Orthographic projection uses the same equation with `c.w=1`.
**Original MMD's distance/FOV/viewport law and absolute coefficient are not
verified.** Revise this draft if original-MMD evidence contradicts the rule.

Apply the equation before homogeneous triangle clipping, including to vertices
with `c.w<=0`. At `c.w=0` the clip offset is naturally zero; do not divide there.
Clip the expanded triangles against `-w<=x,y,z<=w`, including near/far planes.
Do not clamp NDC, force vertices onto the near plane, or discard an entire
triangle because one vertex is behind the eye. No caps are added by this rule.

## 6. Outline draw state and alpha

These are **provisional MMD-inspired choices**, not verified original-MMD
render states. Draw ordinary base-material passes first and retain their depth.
Render enabled outline hulls using ordinary mesh/primitive-level submission
and depth behavior. No triangle-level sorting is required or performed by this
extension. It prescribes no new mesh/primitive sorting algorithm; overlapping
translucent results can depend on the renderer's submission order.

| State | Required draft behavior |
| --- | --- |
| Geometry | Expanded inverted hull using deformed positions/normals |
| Culling | Front-face culling; render expanded back faces, regardless of base `doubleSided` |
| Depth | `LESS_EQUAL` against current depth; **depth writes enabled**, no depth bias |
| Color | Unlit `colorFactor`; no lighting, shadow, fog or tone adjustment to edge RGB |
| Blend | Conventional straight-alpha source-over in the selected encoded/gamma RGB domain below |
| Coverage | Ordinary sample coverage; no base per-texel alpha test or alpha-to-coverage for the hull |

At evaluation, clamp all four edge color components to [0,1]. This draft treats
stored RGB as sRGB encoded source components and alpha as linear coverage.
Preserve the stored values; do not compensate them in the converter. Set
`edgeRGB=clamp(colorFactor.rgb,0,1)` and `edgeAlpha=clamp(colorFactor.a,0,1)`.

### Diffuse-alpha integration

Obtain a finite material-level `diffuseAlpha` from the **active base material
model**, after any material-factor updates, before texture sampling or
`alphaMode` coverage handling:

| Active material model | `diffuseAlpha` |
| --- | --- |
| Core glTF metallic-roughness/PBR, including its core fallback | `pbrMetallicRoughness.baseColorFactor[3]`, default 1 |
| Supported, active `MMD_materials_toon` | `diffuseFactor[3]`, default 1, supplied by that material's integration |
| Other material model | An explicit integration supplies its current diffuse/base factor alpha, default 1 if that model defines no such factor |

An outline implementation MUST implement the core mapping. It MUST NOT assume
Toon fields exist or consult an unsupported/inactive Toon payload. A renderer
supporting Toon uses the Toon mapping through its material system. For another
material model, the minimum integration contract is a documented callback or
equivalent binding returning this scalar. Arbitrary material programs do not
have a universal diffuse factor: if no mapping is available, report unsupported
material-alpha integration rather than infer Toon data or invent a value.
This is an implementation integration limitation, not an extension dependency
or additional asset field.

If `diffuseAlpha` is **exactly zero**, suppress the outline. Otherwise use
`edgeAlpha` as-is; do not multiply it by diffuse alpha. Compare the finite
current factor directly, without a tolerance or preliminary clamp. This rule
also applies when the base uses `alphaMode: OPAQUE`. Zero edge alpha suppresses
the outline regardless of base alpha. Per-texel base texture alpha, vertex
color alpha, MASK cutoff and final shaded opacity do not enter this factor-level
test; a texture hole does not cut the outline. If an integration evaluates PMX
material morphs, use its current morphed diffuse alpha and edge color/size,
without baking changes into the stored source values. Core POSITION/NORMAL
morphing does not change material factors. This extension defines no new material
morph representation or evaluation algorithm.

Skip the outline draw if size is zero, edge alpha is zero, diffuse alpha is zero,
or all decoded vertex scales are zero. Otherwise retain zero-scale vertices and
all triangles in the ordinary primitive draw. Scale is used only for vertex
displacement: do not interpolate it to discard fragments, including fragments
between positive and negative scales. Cull/clip normally and discard failed
depth samples. A surviving covered sample writes depth even for partial edge
alpha; a suppressed draw contributes neither color nor depth.

### Encoded-domain source-over

The selected RGB component domain for this draft is sRGB encoded. The retained
destination RGB MUST be presented in that same domain for outline blending.
For an opaque destination:

```text
outRGB = edgeRGB * edgeAlpha + dstRGB * (1 - edgeAlpha)
outAlpha = edgeAlpha + dstAlpha * (1 - edgeAlpha)
```

For a transparent destination, let `dstPremultipliedRGB` be destination RGB
premultiplied by its alpha **in the same encoded domain**:

```text
outPremultipliedRGB = edgeRGB * edgeAlpha + dstPremultipliedRGB * (1 - edgeAlpha)
outAlpha = edgeAlpha + dstAlpha * (1 - edgeAlpha)
outRGB = outPremultipliedRGB / outAlpha if outAlpha > 0, else (0,0,0)
```

Source RGB is straight, not premultiplied; alpha is never gamma converted.
For example, gray .5 at alpha .5 over opaque black yields encoded RGB .25.
Do not decode edge/destination RGB to linear for this operation. Render-target
sRGB automatic decode/blend/encode must be bypassed or equivalently arranged
to produce these encoded-component equations, with no implicit double sRGB
conversion. If the base renderer holds linear RGB, its integration must present
an encoded destination and preserve this blend result through output; this
specification does not require a particular scene tone-mapping/compositing stage.

### Reference pseudocode

```text
validate material payloads, declarations and all accessor/data constraints
render ordinary base-material passes; retain current depth
make destination RGB available in the selected encoded component domain
for each outlined mesh node/primitive in ordinary renderer submission order:
    skinned = node references skin and primitive has core skinning attributes
    if not skinned and determinant(mat3(M)) == 0: continue
    reflected = not skinned and determinant(mat3(M)) < 0
    m = extension with defaults, after supported material-factor updates
    edgeRGB = clamp(m.colorFactor.rgb, 0, 1)
    edgeAlpha = clamp(m.colorFactor.a, 0, 1)
    diffuseAlpha = active material integration's current finite factor alpha
    scales[] = decode accessor including sparse, or array filled with 1
    if m.sizeFactor == 0 or edgeAlpha == 0 or diffuseAlpha == 0: continue
    if every scale == 0: continue
    for each vertex:
        p,normal = core morph result
        D = sum(weight_i * jointWorld_i * inverseBind_i) if skinned else M
        T = V * D
        q = T * vec4(p,1)
        c = P * q
        a = transpose(inverse(mat3(T))) * normal if invertible else (0,0,0)
        nView = a / length(a) if length(a) > 0 else (0,0,0)
        n = nView.xy / length(nView.xy) if length(nView.xy) > 1e-12 else (0,0)
        e = m.sizeFactor * scales[vertex]
        cOutline = c + (c.w*2*e*n.x/W, c.w*2*e*n.y/H, 0, 0)
    draw primitive with expanded clip positions:
        assemble/clip triangles; correct winding where reflected is true
        cull front faces; rasterize back faces
        depth test LESS_EQUAL; write depth on surviving covered samples
        blend straight edgeRGB/edgeAlpha by encoded-domain source-over
preserve encoded blend result without an additional unintended transfer
```

## 7. Fallback and examples

This complete material-only glTF asset is valid without geometry:

```json
{
  "asset": { "version": "2.0" },
  "extensionsUsed": ["MMD_materials_outline"],
  "materials": [{
    "pbrMetallicRoughness": {
      "baseColorFactor": [0.8, 0.8, 0.8, 1],
      "metallicFactor": 0,
      "roughnessFactor": 1
    },
    "extensions": {
      "MMD_materials_outline": {
        "colorFactor": [0, 0, 0, 1],
        "sizeFactor": 1
      }
    }
  }]
}
```

[edge-scale.gltf](examples/edge-scale.gltf) is a complete embedded triangle asset
with normals and scales `[0,1,2]`.
[signed-scale.gltf](examples/signed-scale.gltf) uses scales `[-1,0,2]` to preserve
signed source data. [default-scale.gltf](examples/default-scale.gltf) omits the
attribute and uses `{}` on its material. Each geometry example includes a scene,
node and perspective camera. These are data examples, not silhouette reference
images. None requires Toon support.

Assets MUST list `MMD_materials_outline` in `extensionsUsed`. Normally omit it
from `extensionsRequired` when omission is an acceptable fallback. An unsupported
implementation ignores **only this optional extension** and its outline semantic;
other supported extensions, including `MMD_materials_toon`, continue normally.
Otherwise normal glTF fallback rules apply. An asset unusable without outlines
lists the name in both arrays; unsupported readers must report unsupported
required functionality. No duplicate expanded mesh is required.

Core validation cannot check this unknown extension. Validate schema, declarations,
triangle modes, required attributes, accessor counts/types and all decoded/sparse
data even for suppressed draws. Invalid data are errors, not missing defaults.
See the [CPU checker and independent fixture calculations](tests/README.md).

## 8. Limitations and evidence

Original-MMD fidelity remains unresolved for thickness/camera behavior,
depth/draw state, alpha/material coupling and color-domain/compositing.
Conformance to this v0.1 draft does not imply pixel-identical rendering by the
original MMD executable. Controlled original-MMD captures/state observations
are optional validation for a later fidelity correction.

**Primary MMD/format evidence:** the [PMX format description (mirrored)](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt)
describes the material flag `0x10`, edge RGBA/size and floating-point vertex
multiplier. It does not specify this rendering pipeline. The original
[VPVP MMD distribution](https://sites.google.com/view/vpvp/) readme records
historical distance/FOV thickness changes and a material-morph transparency fix;
these do not establish the present equation or states. The repository's
[primary-evidence record](../../docs/original-mmd-research.md#primary-evidence-collected)
contains archive hashes and reproducible inspection details; no executable
rendering measurement was made here.

**Secondary implementations:** Saba's [edge vertex shader](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/viewer/Saba/Viewer/resource/shader/mmd_edge.vert)
inspires the view-normal XY / clip-W / viewport equation. The
[three-mmd outline effect](https://github.com/takahirox/three-mmd-loader/blob/main/src/effects/MMDOutlineEffect.ts)
is another adaptation. Neither proves original-MMD coefficients or fidelity.
[Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
is the normative basis for core coordinates, deformation, accessors and fallback.
