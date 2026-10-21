# MMD_materials_outline

## Status and dependencies

**Version 0.1, draft, for glTF 2.0.** The visual target is the standard,
unmodified MikuMikuDance renderer, without MME. **Pixel-equivalence to original
MMD has not been established.** This document defines one reproducible proposal,
including deliberately chosen normalization and rasterization rules where
original-MMD evidence is incomplete. Passing its fixtures establishes draft
conformance, not MMD fidelity. There are no selectable profiles or per-material
versions. The draft may change before a stable release.

The extension attaches to `materials[i].extensions.MMD_materials_outline`.
It requires no other extension, works with any core material, and MUST NOT read
`MMD_materials_toon` factors. MUST, MUST NOT, SHOULD and MAY indicate normative
requirements, prohibitions, recommendations and permissions.

Only material data and a custom vertex attribute are stored. Implementations
reuse the source primitive's vertices and triangles for an inverted hull pass;
assets MUST NOT need a duplicate expanded mesh. This specification supplies no
loader, shader, converter or browser demo implementation.

## Material properties

The self-contained [JSON Schema 2020-12](schema/material.MMD_materials_outline.schema.json)
validates the extension object. All properties are optional. Defaults apply on
omission; `null` is invalid. Schema defaults are annotations, not inserted values.

| Property | Type / default | Meaning |
| --- | --- | --- |
| `colorFactor` | four finite numbers / `[0,0,0,1]` | Independent source-component RGBA edge color |
| `sizeFactor` | finite number >= 0 / `1` | Material edge size; one unit is one framebuffer pixel of vertex displacement when the vertex multiplier is 1 |
| `extensions` | object of extension objects / omitted | glTF extension container |
| `extras` | any JSON / omitted | Application data |

Presence, including `{}`, enables the material's outline. Absence disables it.
There is no `enabled` property. Other unknown properties are invalid in this
draft. All numbers MUST remain finite after decoding; JSON such as `1e400`
that overflows a loader's numeric representation MUST be rejected.

RGBA components have **no input [0,1] restriction**, independently of core PBR.
Stored PMX values are preserved; all four components are clamped to [0,1] at
evaluation. RGB is treated as sRGB source components, decoded to linear before
blending; alpha is a linear opacity and is never gamma converted. These are
explicit draft color rules, not measured original-MMD transfer behavior.

`sizeFactor` is dimensionless source data with the pixel normalization above;
it is neither glTF meters nor a Three.js thickness. No source model unit or
PMX-to-meter conversion is multiplied into it. The coefficient of **1 pixel**
is a draft convention, not a recovered MMD constant. The
[evidence and rationale](#evidence-and-rationale) explain its limits.

If size is zero, clamped alpha is zero, or every decoded vertex multiplier is
zero, the entire outline draw MUST be skipped. The base material still draws.
Otherwise zero multiplier vertices remain unexpanded; they do not remove
adjacent triangles containing a nonzero multiplier.

## Vertex data and source mapping

On primitives using this extension, `_MMD_EDGE_SCALE` is an optional custom
vertex semantic with exactly one `SCALAR` per vertex:

| Accessor rule | Requirement |
| --- | --- |
| `componentType` | `5126` (`FLOAT`) only |
| `type` | `SCALAR` |
| `normalized` | absent or `false`; integer and normalized accessors are invalid |
| `count` | Equal to `POSITION.count`, including vertices not referenced by indices |
| Decoded values | Finite and >= 0; values above 1 are legal, with no upper clamp |
| Omitted attribute | Multiplier 1 at every vertex |
| Sparse accessor | Allowed, using core glTF sparse replacement and bounds rules |

A present sparse accessor without a base `bufferView` starts with **zeros**,
not ones. Apply sparse replacements before interpreting values. The absent
attribute default is distinct from that core accessor initialization. Buffer
offsets, stride, bounds, alignment and sparse indices obey glTF 2.0. Every
decoded value, including unused vertices, MUST meet this table.

The semantic is interpreted **only by this extension**, never by core PBR.
On primitives without the extension it has no outline effect. It is static:
glTF morph targets MUST NOT contain `_MMD_EDGE_SCALE`; ordinary animation and
skinning do not change its values. An implementation MUST NOT derive it from
vertex colors, weights, UVs or material opacity.

Outlined primitives MUST have `POSITION` and `NORMAL` and use `TRIANGLES` (4,
including omitted `mode`), `TRIANGLE_STRIP` (5) or `TRIANGLE_FAN` (6). Core glTF
rules govern their types and counts. Explicit normals avoid an unspecified
normal-generation policy. Points and lines are invalid for this extension.
These validity rules apply even when the outline would be skipped. Strip/fan
triangle ordinal means the order obtained by core assembly, including strip
winding alternation; degenerate triangles generate no fragments.

Mapping from PMX/PMD (requirements for preserving supported source values):

- PMX material flag `0x10` set: attach the extension; clear: omit it. Copy edge
  RGBA to `colorFactor`, edge size to `sizeFactor`, and the vertex edge scale
  directly to `_MMD_EDGE_SCALE`. Omit values equal to defaults if desired.
  Preserve a scale when shared vertices serve several material primitives;
  each primitive applies its own material size/color. No material-size product
  is baked into the vertex scale.
- PMD material edge flag 1 enables the extension, 0 disables it. PMD vertex
  edge-invisible flag 1 maps to scale 0, flag 0 to scale 1. PMD has no PMX edge
  RGBA/size fields: use the extension defaults unless separately authored
  source scene settings are available. This is a documented PMD fallback,
  not a reconstruction of a PMM model-level edge control.
- Negative/non-finite source sizes/scales cannot be represented by this draft.
  A converter MUST report that loss or reject the conversion; it MUST NOT
  silently take an absolute value or claim lossless preservation. PMX material
  morphs affecting edge color/size, PMM controls and MMD-specific skinning/morph
  extensions are outside this version.

## Vertex transforms and coordinate conventions

Use column vectors and glTF's right-handed coordinates. A camera looks along
view -Z, with +X right and +Y up. `W` is the node world matrix, `V` is the
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
weights, then ordinary glTF joint skinning, then the node and camera transforms.
More explicitly, let `p` and `n` be the morphed mesh-local position and normal.
Let `S` be the weighted sum of the core joint matrices in mesh-local space
(including inverse bind matrices and the inverse node world transform), or
identity without skinning. Define `T = V W S`, with affine bottom row `(0,0,0,1)`.
Use the inverse transpose of its upper-left 3x3 for the normal:

```text
q = T * vec4(p, 1)
a = transpose(inverse(mat3(T))) * n
nView = a / length(a)
c = P * q
```

No intermediate normalization of morphed normals is necessary. The normal
matrix is essential under nonuniform scaling; transforming normals as positions
is incorrect. If `mat3(T)` is singular or `a` is zero, define `nView=(0,0,0)`
for that vertex. If the node world matrix itself is singular, skip the node's
outline. This supplies deterministic degeneracy behavior, not a different
skinning profile. MMD SDEF/QDEF/IK/physics are not introduced here. If converted
to core glTF animation/skins/morphs, the resulting core deformation is used.

Do not flip vertex normals on back faces or multiply them by a determinant sign.
Use the core glTF winding correction for a negative determinant of `mat3(W)`
when determining front/back faces. Cull front faces of the **expanded** triangles,
regardless of source material `doubleSided`. Negative joint transforms and local
skin folds may invert individual triangles; their actual deformed winding is
used, without per-joint winding repairs. Triangle vertices shared across material
groups get the same deformation/scale but a separate extrusion for each draw.

## Expansion equation

Let `(B,H)` be the positive integer width and height of the active framebuffer
viewport, in physical render-target pixels before later upscaling/downscaling.
These are not CSS/display pixels or the complete render target when rendering
into a sub-viewport. Let `s` be the material size and `e` the decoded vertex
scale, defaulting to 1. Define:

```text
r = nView.xy
u = r / length(r)                  if length(r) > 1e-12, else (0,0)
t = s * e                         in pixels, with no upper clamp
delta = (2*t*u.x/B, 2*t*u.y/H)
cOutline = (c.x + c.w*delta.x, c.y + c.w*delta.y, c.z, c.w)
```

If `c.w <= 0`, use `cOutline=c` and an effective displacement `tEffective=0`.
Otherwise `tEffective=t` when `u` is nonzero, and 0 when `u` is zero. A zero
normal, a normal parallel to the view axis, a singular vertex transform, zero
size or zero scale therefore produces no displacement. The length threshold
is applied **after 3D normal normalization**, before 2D normalization. No other
thickness clamp, distance attenuation, depth bias, normal offset, or projection
of a second position is applied. Arithmetic is specified over real numbers;
implementations MUST avoid overflow/NaN for supported input assets, or report
an unsupported numeric range instead of silently clamping.

For `c.w>0`, the NDC offset is exactly `delta`; pixel displacement is `t*u`.
Pixel coordinates with bottom-left viewport origin `(ox,oy)` are:

```text
pixel = (ox + (cOutline.x/cOutline.w + 1)*B/2,
         oy + (cOutline.y/cOutline.w + 1)*H/2)
```

This is a vertex displacement, not a guarantee that every rasterized contour
has that width. Perspective depth changes alter `c.w` and the clip offset
together, leaving the pixel displacement unchanged. Orthographic cameras use
the same rule. Changing FOV, orthographic magnification or aspect ratio changes
base projection but not displacement length. Changing viewport dimensions keeps
the displacement in physical pixels fixed; post-render image scaling scales it
with the image. Sub-viewport origin does not affect thickness.

`z` and `w` are unchanged. Clip the resulting triangles with ordinary homogeneous
clipping, including near/far planes; do not clamp NDC, force vertices in front
of the near plane, or discard a whole triangle merely because one vertex has
`w<=0`. That vertex's unexpanded position participates in clipping. Vertices
in front of the eye but before the near plane still use the formula. Clipping
can expose open hull ends; no caps are added.

## Drawing, depth, alpha and color

The following is a single draft draw contract, independent of the source
material's shading and transparency. Render the scene's ordinary base-material
passes first, including its normal opaque/mask depth writes and transparent
composition. Outline compositing takes place in display-linear scene color
after any base-scene exposure/tone mapping and before final output encoding.
Retain the scene depth buffer. Draw all enabled outline
triangles, sorted back to front by **unexpanded view-space centroid depth**
`-(q0.z+q1.z+q2.z)/3`. Larger depth draws first. Break exact ties by ascending
node index, primitive index, then assembled triangle ordinal. Each node has one
mesh; node index distinguishes mesh instances. Include opaque outlines in this
same ordering. No camera-distance sort using Euclidean length is substituted.

| State | Required behavior |
| --- | --- |
| Geometry | Inverted hull from the same triangles and transformed normals |
| Culling | Cull front faces; keep back faces; ignore `doubleSided` for this pass |
| Depth | Test less-or-equal against retained scene depth, **no depth writes**, no bias |
| Blend | Straight-alpha source-over in linear RGB, for all outline opacities |
| Shadows / lighting | Outlines neither cast nor receive shadows, and ignore lighting, fog and exposure/tone mapping |
| Coverage | Ordinary triangle/sample coverage; no alpha-to-coverage or source alpha test |

An outline fragment MUST be discarded if clamped outline alpha is zero or its
perspective-correct interpolated `tEffective <= 0`. Triangles whose three
`tEffective` values are zero can be skipped. Failed clipping, front-face culling,
sample coverage or depth testing produces no contribution. There is no discard
based on base `alphaMode`, `alphaCutoff`, base factor/texture alpha, `COLOR_0`,
toon factors, or a texture lookup. A zero scale suppresses displacement at that
vertex; it does not punch a hole in the base surface.

For each RGB component `x=clamp(colorFactor.rgb,0,1)`, decode sRGB as
`x/12.92` if `x<=0.04045`, otherwise `((x+0.055)/1.055)^2.4`, obtaining `C`.
With `A=clamp(colorFactor.a,0,1)`, use source-over on the linear framebuffer:

```text
outPremultipliedRGB = A*C + (1-A)*destinationPremultipliedRGB
outAlpha = A + (1-A)*destinationAlpha
```

A straight-alpha framebuffer must convert to/from premultiplied RGB at this
boundary (zero alpha gives zero straight RGB). On an opaque background this
reduces to `A*C+(1-A)*backgroundRGB`. Encode linear RGB to sRGB exactly once
when writing an sRGB output; do not encode alpha. For a linear output, retain
linear values. The sRGB encoding is `12.92*x` for `x<=0.0031308`, otherwise
`1.055*x^(1/2.4)-0.055`. Apply no outline-specific lighting or additional clamp.

Overlapping materials share the retained base depth. Outlines never change
depth, so translucent outlines compose in the ordering above; equal-depth
outlines also compose rather than suppressing one another. A base MASK hole
does not mask the hull. A base BLEND surface usually has no depth write, so
its hull may show through the surface or other transparent objects. These are
specified limitations of independence, not an implicit copying of source alpha
state. The MMD readme's material-morph transparency fix does not establish any
mapping to glTF `alphaMode`; source material morph coupling is outside v0.1.

## Reference pseudocode

```text
validate material payloads and whole-asset attribute/accessor constraints
draw scene with ordinary base materials; finish base-scene exposure/tone mapping
retain display-linear scene color and scene depth
triangles = []
for each nonsingular mesh node and primitive with this extension:
    m = apply defaults to extension
    A = clamp(m.colorFactor.a, 0, 1)
    e[] = decode accessor including sparse, or array filled with 1
    if m.sizeFactor == 0 or A == 0 or every e == 0: continue
    for each vertex:
        p,n = core morph result
        T = V * W * coreSkinMatrixOrIdentity
        q,c,nView = transform as specified above
        u = normalize(nView.xy) if length(nView.xy) > 1e-12 else (0,0)
        tEffective = m.sizeFactor * e if c.w > 0 and u != (0,0) else 0
        cOutline = c + (2*tEffective*u.x*c.w/B,
                        2*tEffective*u.y*c.w/H, 0, 0)
    assemble triangles; omit those with all tEffective == 0
    append triangles with centroid sort key and node/primitive/triangle indices
sort triangles as specified; correct reflected node winding
for each triangle:
    clip expanded positions; cull front faces; rasterize back faces
    depth test LEQUAL, depth writes off
    discard fragment if interpolated tEffective <= 0 or A == 0
    blend decoded outline RGB and A using linear source-over
perform the output color transfer once
```

## Example and fallback

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

[edge-scale.gltf](examples/edge-scale.gltf) is a self-contained triangle asset
with normals and scales `[0,1,2]`. [default-scale.gltf](examples/default-scale.gltf)
uses the same geometry without the attribute and with `{}` on its material.
Both have embedded buffers, a scene, node and perspective camera. They are small
data examples, not an assertion that a single open triangle has a closed
character silhouette. No toon extension is involved.

Assets using the extension MUST list `MMD_materials_outline` in `extensionsUsed`.
Normally omit it from `extensionsRequired`: an unsupported reader ignores the
optional payload and custom attribute and renders the ordinary base material
without outlines. Author a useful core PBR fallback independently. If the asset
is unusable without outlines, list the name in **both** arrays; readers lacking
support must then report unsupported required functionality instead of silently
rendering a fallback. This does not make an invalid payload valid.

Core validation alone cannot check an unknown extension. Check schema, extension
declarations, triangle modes, required attributes, accessor counts/types, all
decoded values and sparse data. Missing data or invalid payloads are asset
errors, not occasions to substitute defaults. Validate even skipped draws.
See the [CPU checker and fixture derivations](tests/README.md).

## Evidence and rationale

Investigated on 2026-10-21; source precedence is the original application, then
format documentation, with compatibility implementations as secondary evidence.

| Source | Concrete evidence and limit |
| --- | --- |
| Yu Higuchi's [VPVP site](https://sites.google.com/view/vpvp/) and its [9.32 x64 archive](https://drive.google.com/uc?export=download&id=1Iucxu0tDsD05Siyv8VBGgm9vjD-f-RhM) | Directly inspected bundled readme: Ver.2.01 (2008/04/08) changed thickness by distance; Ver.7.13 (2010/11/01) made thickness unaffected by FOV; Ver.7.14 (2010/11/04) changed the thickness equation again. None gives coefficients or viewport normalization. Ver.9.25 (2014/12/16) fixes edge following material-morph transparency when self-shadow display is off. |
| Same original executable's readable effect resources 117/118 | Hash-checked and searched for outline/edge/viewport declarations; no outline expansion function was found in those sources. This does not exclude another application rendering path. No executable was run, and no active outline state trace or frame was captured. |
| [PMX format description](https://github.com/hirakuni45/glfw3_app/blob/master/glfw3_app/docs/PMX_spec.txt) | Vertex record ends with a floating-point multiplier of material edge size; material record has edge flag `0x10`, RGBA and size. Establishes stored fields and their product, not a complete camera equation. |
| [PMD reader's field definitions](https://github.com/rintrint/mmdbridge/blob/master/src/MikuMikuFormats/Pmd.h) | Distinguishes vertex edge-invisible and material edge fields. Secondary format implementation; not proof of original draw states. |
| Saba's [edge vertex shader](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/viewer/Saba/Viewer/resource/shader/mmd_edge.vert) | Normalizes view-normal XY and offsets clip XY with inverse half-viewport dimensions, edge size and clip W. Supports a reproducible pixel-based proposal, but its uploaded edge-size mapping and original-MMD equivalence are not established here. |
| [three-mmd outline effect](https://github.com/takahirox/three-mmd-loader/blob/main/src/effects/MMDOutlineEffect.ts), inspected blob `10d4611070967203f9bebf006c75d0924a0f9d01` | Uses two projected positions, a thickness uniform and clip W. Explicitly an adaptation; it does not verify the original equation or the normalization in this draft. |
| Khronos [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) and [extension conventions](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos) | Basis for extension declarations, custom semantics, accessor/sparse data, transforms and core fallback. |

The original archive SHA-256 is
`7edccd3a29fae3bfd217b2e75e526d13ac844828c7dbc927e959e3eecee29874`,
and executable SHA-256 is
`07516fd3bf1e6b1339836b6773a156f61bdd6f848eeb621fdda012375df313a1`.
The repository's [original-MMD investigation](../../docs/original-mmd-research.md#primary-evidence-collected)
records reproducible download/resource inspection, resource hashes and exact
byte ranges. Repeating it and searching the bundled readme for `エッジ` reproduces
the historical entries above. Downloaded bytes remain ignored; no MMD source,
executable or model bytes are redistributed in these fixtures.

The proposal preserves the PMX size/vertex product and chooses FOV-independent
pixel displacement, consistent with the documented FOV change and illustrated
by Saba. **Neither constant pixel thickness at all depths nor one pixel per size
unit is established by original-MMD evidence.** The older distance note does not
determine the post-7.14 law. View-normal XY, normal-matrix correction, degeneracy
rules, winding, draw order, depth, color transfer and alpha independence are
explicit interoperable draft choices. No Three.js thickness constant is imported.
The original executable's CPU normalization, current distance law, viewport/DPI
behavior, depth adjustment and actual blend/color states remain unverified.

This first draft deliberately supplies a single testable equation in that gap.
Controlled original-MMD captures varying distance, FOV, viewport/aspect, edge
size/scale and transparency, plus active render-state/uniform observations, are
needed before claiming MMD accuracy or correcting these rules. They are optional
validation for this draft, not a gate requiring a Windows executable here.

## Limitations

Inverted hulls can crack at split normals, intersect at concave surfaces, expose
open/back-facing geometry, and overlap at material boundaries. View-axis normals
have no expansion. Triangle-centroid ordering is deterministic but cannot solve
intersecting translucent hulls. Sample positions and antialiasing are host raster
conventions, so the numerical fixtures test vertex/sample decisions, not bitwise
raster images. Base alpha masks do not cut outline textures. Model-level PMM
controls, dynamic edge-material morphs, MME effects and MMD-specific deformation
are outside v0.1. No post-merge verification is required for this proposal.
