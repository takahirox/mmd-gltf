# Outline draft conformance fixtures

These are newly authored, synthetic CPU fixtures for the v0.1 proposal. They
are **not original-MMD observations**. No engine output or screenshot supplied
the expectations. `check.cjs` is a test-only translation of the specification,
not a runtime rendering package, shader or converter.

## Running

From the repository root, with Node.js >=22.12:

```sh
npm ci
npm run test:outline
git diff --check
```

This uses the existing pinned Ajv and Khronos glTF Validator dependencies,
requires no GPU or network after installation, and performs no remote schema
resolution. `npm test` also includes this checker. For the repository's existing
combined documentation/built-example link check, first build its example:

```sh
npm run build
npm run check:links
```

The build downloads the repository's separately documented example assets into
ignored directories; it is unnecessary for the standalone outline checker.
There is no outline web example or GPU implementation in this Issue.

The validator checks all four complete glTF examples, including buffer bytes,
and positive mutated assets (including sparse accessors). Expected notices are
`UNSUPPORTED_EXTENSION`, since the core validator does not implement this draft,
and `UNUSED_OBJECT` for the material-only example. **Zero core errors** is the
core validity gate; Ajv and cross-object/data checks cover the extension.
The material-only JSON code block in the normative README is also compared with
its example file. Schema defaults are checked but not inserted by Ajv.

## Position vectors and independent derivation

[positions.json](positions.json) stores literal expectations. Do not regenerate
them from the checker or a future renderer. The following hand calculations are
an independent audit of the important cases. Arithmetic expressions used while
authoring the JSON were only closed-form calculations below, not evaluator
results. Absolute tolerance is `1e-9` for every numerical field; booleans/nulls
are exact. This tolerance tests CPU double arithmetic, not raster precision or
original-MMD matching. A GPU implementation may need a separately justified
floating-point tolerance.

Matrices in the **fixtures** are row arrays for readability. This differs from
the column-major serialized matrix arrays in glTF. Both use column vectors and
the normative multiplication order. `defaults` are merged with each case.
Morph deltas are already multiplied by their weights. `joints`, when present,
contains the vertex's influences with decoded `weight`, joint `world` matrix
and optional `inverseBind` matrix (identity when omitted). The checker sums
`weight * world * inverseBind` directly; it does not evaluate joint hierarchies.
Without `joints`, the primitive is unskinned and uses the mesh-node `world`
matrix. Omitted mesh-node `world` and `view` are identity; omitted deltas are
zero, material is `{}`, edge scale is 1, viewport origin is `[0,0]`. No lighting
or rasterization is involved in these position tests. `expectedFaces`, when
present, checks fragment culling with the position evaluator's winding correction;
`ccw` and `cw` give the expected discard decision for each projected winding.

The default camera has FOV 90 degrees, aspect 4/3, near 1 and far 9:

```text
P = [ .75  0      0      0    ]
    [ 0    1      0      0    ]
    [ 0    0     -1.25  -2.25 ]
    [ 0    0     -1      0    ]
```

These pixel results follow from the provisional coefficient 1.0, not a pixel
unit intrinsic to PMX `sizeFactor`. For `p=(0,0,-3)`, `n=(1,0,0)`, and viewport
800x600, base clip position is
`(0,0,1.5,3)`; one pixel adds `2*3/800=.0075` to clip X. NDC is
`(.0025,0,.5)`, and pixel coordinates are `(401,300)`.

| Cases | Independent calculation |
| --- | --- |
| Double perspective distance | At Z=-6, clip Z=`7.5-2.25=5.25`, W=6. Clip X displacement doubles to `.015`; dividing by W still gives `.0025`, or one pixel. |
| Off-axis / FOV | At `(1,1,-3)`, base clip XY=`(.75,1)` or `(1.5,2)` for doubled focal coefficients. Add `.0075` only to X. Resulting pixels are `(501,400)` and `(601,500)`. |
| Aspect / resolution | For 1200x600, clip X offset=`6/1200=.005`, pixel X=601. For 1600x1200 it is `.00375`, pixel `(801,600)`. The base viewport center moves but displacement stays one pixel. |
| Sub-viewport origin | Adding origin `(120,30)` to `(401,300)` gives `(521,330)`. |
| Diagonal normal | XY unit direction is `(.6,.8)`. Clip XY=`(6*.6/800,6*.8/600)=(.0045,.008)`; pixels `(400.6,300.8)`. |
| Nonuniform transform | `W=diag(2,1,.5,1)`, p.Z=-6 gives q.Z=-3. Inverse-transpose normal XY is `(.3,.8)`, so direction is `(3,8)/sqrt(73)`, approximately `(.351123441588392,.936329177569045)`. Multiply by `.0075`/`.01` for clip offsets. |
| Negative nonuniform transform | X scale -2 changes the above normal X sign and makes the world determinant negative. Expected pixel X=`400-3/sqrt(73)`. Normal Y and clip Z/W stay unchanged; corrected winding is marked reflected. |
| Orthographic near/far | Orthographic X coefficient `.5`, Z coefficient `-.25`, Z translation `-1.25`, W=1. For p.X=1, clip X=`.5+.0025=.5025`. Z=-3/-7 gives clip Z=-.5/+.5; both have pixel `(601,300)`. |
| Size/scale product | Size 2 times scale .5 gives the default one-pixel result. Scale 2.5 gives X displacement `.01875` in clip space and 2.5 pixels. Size .25 gives .25 pixels. |
| Signed product | Scale -2 gives clip X=-.015 and pixel X=398. Size -2 with scale .5 gives clip X=-.0075 and pixel X=399. Both negative (size -2, scale -.5) give pixel X=401. No absolute value or clamp is applied. |
| Zero and degenerate cases | Zero size/scale, axis normal, zero morphed normal, singular skin, and normalized XY magnitude <=`1e-12` all give zero displacement and effective thickness 0. The equality case at the threshold also gives zero. A `1e-11` XY component instead becomes unit +X. |
| Singular node / foreshortened normal | An unskinned primitive with zero mesh-node X scale is skipped. A unit normal `(.6,0,.8)` still gives XY direction `(1,0)` and the full one-pixel displacement. |
| Near plane / eye | At Z=-.5, clip Z=`.625-2.25=-1.625`, W=.5, clip X offset `.00125`. NDC Z=-3.25 is outside the clip volume; the vertex calculation does not force it onto the near plane. At the eye W=0, the clip offset is zero. Behind the eye at Z=1, W=-1 gives clip X=-.0025; expand before clipping. NDC/pixel fields are null for W<=0. |
| View rotation/translation | A 90-degree Z rotation maps normal +X to +Y, hence clip Y=.01 and pixel Y=301. A view translation -1 in X changes base clip X to -.75, plus .0075 gives -.7425 and pixel X=301. |
| Morph then joint world/bind | Start at `(0,0,-6)`. Morph adds .5 in X and changes normal +X into +Y. The inverse bind translates -.5 in Y; the joint world rotates 90 degrees around Z, then scales `(2,1,.5)`. Thus q=`(1,.5,-3)` and normal direction -X. Base clip XY=`(.75,.5)`; subtract .0075 in X to give pixel `(499,350)`. The mesh-node scale is ignored. Changing the bind/joint order gives a different result. |
| Skinned identity/reflected/singular mesh nodes | With one identity joint and identity inverse bind, `D=I` for mesh-node X scales 1, -1 and 0 alike. All three give default clip `(.0075,0,1.5,3)`, pixel `(401,300)` and thickness 1; none is skipped or has a winding correction. CCW faces are culled and CW faces survive in all three cases. These regressions catch both incorrect mesh-node multiplication and determinant-based culling/suppression. |
| Reflected joint | A joint with X scale -1 changes the normal to -X, giving clip X=-.0075 and pixel X=399. The projected triangle winding determines culling without a determinant repair: CCW is still culled and CW survives. |
| Weighted joint world/bind | Joint 1 translates +1 in X and its inverse bind translates -.5; joint 2 translates -1 with identity bind. Weights .25/.75 give effective translation `.25*(1-.5)+.75*(-1)=-.625`. Base clip X=`-.625*.75=-.46875`; add .0075 for clip X=-.46125 and pixel X=`400-62.5+1=338.5`. |

`tEffective` is a fixture-only diagnostic: the signed source product when the
normal direction is nonzero, otherwise zero. It is not a fragment varying or
an opacity/coverage input. At the eye it can be nonzero while the clip offset,
which multiplies W=0, is zero. The exact equation also applies behind the eye;
homogeneous clipping, rather than a pre-expansion W test, handles visibility.

## Fragment, flag and asset fixtures

[fragments.json](fragments.json) tests selected **covered back-face samples**,
with NDC depth and a retained depth in [0,1]. It does not implement hardware
triangle coverage. Default NDC depth 0 maps to depth .5, scene depth is 1,
face winding is clockwise without reflection, and destination is opaque encoded
black. `ccw` is actual projected winding before core negative-node correction.
All RGB arrays, including `premultipliedRGB`, are in the selected sRGB encoded
component domain; there is no transfer around the blend.

The checker receives the active material binding through fixture `integration`:
`activeMaterial` defaults to `core`, can select `toon`, or names a custom model
whose binding returns `diffuseAlpha`. These are test inputs, not new glTF fields.
`baseMaterial` supplies the current factor payload after any external material
updates. `baseTextureAlpha` does not enter the factor-level suppression rule.

| Cases | Independent calculation / decision |
| --- | --- |
| Half red over blue | `.5*(1,0,0)+.5*(0,0,1)=(.5,0,.5)`, alpha 1. |
| Gray over black | `.5*.5=.25` encoded in each RGB channel; decode/blend/encode would disagree. |
| Unrestricted stored color | `(2,-1,.5,2)` clamps at evaluation to `(1,0,.5,1)`. Small encoded `.01292` stays `.01292`. |
| Transparent destination | Half red over premultiplied blue `(0,0,.5)`, alpha .5, gives premultiplied `(.5,0,.25)`, alpha `.5+.5*.5=.75`, straight `(2/3,0,1/3)`. |
| Alpha zero vs nonzero | Current core or Toon factor 0 suppresses the outline, including core OPAQUE. Core .25 or tiny `1e-12` leaves edge alpha .4 unchanged, giving red .4 over black. Per-texel alpha 0 with nonzero factor does not suppress it. |
| Material independence | Active Toon uses its own alpha/default 1 even when core factor is 0. Inactive Toon alpha 0 does not override active core. Custom bindings provide current alpha or model-defined default 1; a missing binding errors. Finite negative nonzero custom factor is compared directly, without clamping. |
| Depth/culling/clipping | Depth equality passes LESS_EQUAL and writes depth. NDC .2 maps to .6, failing against .5. Outside [-1,1] is clipped. Corrected front faces are culled. Suppressed/failed samples do not write depth. |

The four `sequences` describe ordinary primitive/sample submission order, with
updated destination color and depth passed from each surviving sample to the
next. They do not sort geometry:

- Half red at NDC -.2 writes depth `.5*(-.2+1)=.4`; half blue at NDC .2
  would have depth .6 and fails. The result stays `(.5,0,0)`.
- Half red followed by half blue at equal depth .5 both pass. The second
  gives `.5*(0,0,1)+.5*(.5,0,0)=(.25,0,.5)` and writes .5 again.
- Zero edge alpha contributes no depth, so later blue at .6 survives.
- Zero base factor alpha likewise contributes no depth; later blue survives.

[flags.json](flags.json) contains the PMX `0x10` truth table (including unrelated
bits), retained PMD flag polarity, extension presence/absence and draw suppression
for zero size/edge alpha/base alpha/all-zero scales. Signed nonzero sizes/scales
still submit the draw. These are source mapping assertions, not a converter.

[schema.json](schema.json) covers omission/defaults, zero/fractional/signed sizes,
unrestricted source RGBA, metadata, prohibited `enabled`/unknown fields, wrong
types/lengths and non-finite machine numbers. Ajv compiles the real schema with
strict numeric validation; defaults are checked without insertion.

[assets.json](assets.json) mutates fresh copies of complete examples, then reads
the real binary accessors. Negative cases cover integer, normalized/vector
accessors, mismatched counts, missing normals, attribute morph targets, missing
extension declarations, bad references/bounds, non-finite values and sparse index
order/bounds. Invalid data on a zero-size material are still rejected.
Signed values in both ordinary and sparse accessors are positive validation cases.

For ordinary edge data, `edgeValues` patches three float32 values at byte 72.
The string `"Infinity"` deliberately produces non-finite float32 for rejection;
no invalid JSON numbers are committed. Sparse cases store an index byte at offset
72 (or 84 after a base scale array), align values to four bytes and replace index
1. Without a base, replacement 2 gives `[0,2,0]`, replacement -1 gives `[0,-1,0]`;
with base `[1,1,1]`, replacement 2 gives `[1,2,1]`. This distinguishes the missing
attribute default 1 from core sparse zero initialization. Complete examples
include `[0,1,2]`, omitted scales (all 1), and `[-1,0,2]`. Positive asset cases
also cover zero/large scales, signed material size, explicit `normalized:false`,
triangle strip/fan modes, required-extension declaration and optional fallback.

The test-only checker does not replace full core validation or test every binary
layout. All complete examples and positive mutated assets are separately checked
with the Khronos validator. No renderer, converter or runtime API is supplied.

## Reproducing an independent numerical audit

The following uses Python standard-library rational arithmetic and literal
closed-form calculations, independently of the checker. It checks the changed
position/blend expectations without generating them from an evaluator:

```sh
python3 - <<'PY_AUDIT'
import json
from fractions import Fraction as F
from pathlib import Path
root = Path('extensions/MMD_materials_outline/tests')
pos = {c['name']: c for c in json.loads((root/'positions.json').read_text())['cases']}
frag = {c['name']: c for c in json.loads((root/'fragments.json').read_text())['cases']}
# Perspective clip W=3; +X direction; viewport width 800.
for name, product in [('negative-vertex-scale', -2),
                      ('negative-material-size', -1),
                      ('both-size-and-scale-negative', 1)]:
    clip_x = F(2 * 3 * product, 800)
    assert pos[name]['expected']['clip'][0] == float(clip_x)
    assert pos[name]['expected']['pixel'][0] == 400 + product
assert pos['behind-eye']['expected']['clip'][0] == float(F(2 * -1, 800))
assert frag['encoded-gray-over-black']['expected']['straightRGB'] == [float(F(1,4))]*3
assert frag['transparent-destination']['expected']['alpha'] == float(F(1,2)+F(1,2)**2)
assert frag['transparent-destination']['expected']['straightRGB'] == [float(F(2,3)),0,float(F(1,3))]
assert frag['partial-base-does-not-multiply-edge-alpha']['expected']['premultipliedRGB'] == [float(F(2,5)),0,0]
seq = json.loads((root/'fragments.json').read_text())['sequences']
assert seq[0]['expected']['depth'] == float((1-F(1,5))/2)
assert seq[0]['expected']['premultipliedRGB'] == [float(F(1,2)),0,0]
assert seq[1]['expected']['premultipliedRGB'] == [float(F(1,2)**2),0,float(F(1,2))]
print('PASS: independent rational position, encoded blend, alpha and depth audit')
PY_AUDIT
```

## Validation record

Executed on 2026-10-22 with Node.js 24.12.0 and the repository lockfile:

| Check | Actual result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; no dependency changes |
| `npm run test:outline` | Passed: 39 position vectors, 28 fragment cases, 24 schema cases, 33 asset cases, source flags/draw suppression and 4 depth/blend sequences |
| Embedded asset validation | Four examples and all positive asset mutations: zero Khronos core errors; expected unsupported-extension/unused-material notices |
| Independent rational audit above | Passed; no checker/evaluator was used to calculate expectations |
| Regression sensitivity | Six in-memory checker mutations were rejected: negative-scale rejection, disabled depth writes, linear-light blending, multiplying edge alpha by the base factor, omitting zero-base suppression and discarding negative draw scales |
| `npm test` | Passed: Toon checker, outline checker and all 8 converter/plugin tests |
| `npm run build` | Passed; existing Vite warning for a chunk larger than 500 kB |
| `npm run check:links` | Passed: 95 local documentation links, anchors and built-example asset links |
| `git diff --check` | Passed |

Original-MMD execution, screenshots/state captures and browser/GPU tests were
not performed. The original executable was not available for rendering here;
original-MMD comparison is optional for this specification revision. No runtime
implementation changed. The link checker checks local paths/anchors and built
assets, not external URL availability. No post-merge verification is required.
