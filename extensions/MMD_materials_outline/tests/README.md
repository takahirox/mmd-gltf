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

The validator checks all three complete glTF examples, including buffer bytes,
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
Morph deltas are already multiplied by their weights; `skin` is the already
weighted core mesh-local skin matrix. This checker tests their application,
not joint hierarchy evaluation. Omitted `world`, `view` and `skin` are identity;
omitted deltas are zero, material is `{}`, edge scale is 1, viewport origin is
`[0,0]`. No lighting or rasterization is involved in these position tests.

The default camera has FOV 90 degrees, aspect 4/3, near 1 and far 9:

```text
P = [ .75  0      0      0    ]
    [ 0    1      0      0    ]
    [ 0    0     -1.25  -2.25 ]
    [ 0    0     -1      0    ]
```

For `p=(0,0,-3)`, `n=(1,0,0)`, and viewport 800x600, base clip position is
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
| Zero and degenerate cases | Zero size/scale, axis normal, zero morphed normal, singular skin, and normalized XY magnitude <=`1e-12` all give zero displacement and effective thickness 0. A `1e-11` XY component instead becomes unit +X. |
| Singular node / foreshortened normal | A node matrix with zero X scale is skipped altogether. A unit normal `(.6,0,.8)` still gives XY direction `(1,0)` and the full one-pixel displacement. |
| Near plane / eye | At Z=-.5, clip Z=`.625-2.25=-1.625`, W=.5, clip X offset `.00125`. NDC Z=-3.25 is outside the clip volume; the vertex calculation does not force it onto the near plane. At/behind the eye W<=0 and extrusion is zero; NDC/pixel fields are null. |
| View rotation/translation | A 90-degree Z rotation maps normal +X to +Y, hence clip Y=.01 and pixel Y=301. A view translation -1 in X changes base clip X to -.75, plus .0075 gives -.7425 and pixel X=301. |
| Morph then skin then world | Start at `(0,0,-6)`. Morph adds .5 in X and changes normal +X into +Y; skin rotates 90 degrees around Z and translates .5 in X. World scale `(2,1,.5)` then gives q=`(1,.5,-3)` and normal direction -X. Base clip XY=`(.75,.5)`; subtract .0075 in X to give pixel `(499,350)`. Changing the operation order gives a different result. |

## Fragment, flag and asset fixtures

[fragments.json](fragments.json) tests independently selected **covered back-face
samples**, with an NDC depth and a retained scene depth in [0,1]. It does not
pretend to implement hardware triangle coverage. Default NDC depth 0 maps to
depth .5, scene depth defaults to 1, barycentrics are equal thirds, W values and
effective thicknesses are 1, face winding is clockwise without reflection, and
destination is opaque linear black. `ccw` is the actual projected winding before
core negative-node correction. `baseMaterial` and `baseTextureAlpha` deliberately
have no effect in the outline evaluator.

- Default black is opaque. Red with alpha .5 over linear blue gives
  premultiplied RGB `(.5,0,.5)`, alpha 1; sRGB encoding .5 yields
  `.7353569830524495` in red/blue.
- Source gray .5 decodes to `.21404114048223255`. Alpha .5 over black gives
  `.10702057024111628`, encoded `.3607802138332792`. This distinguishes
  decode-before-blend from blending source sRGB components.
- Source `(2,-1,.5,2)` clamps to `(1,0,.5,1)` before decoding. Source `.01292`
  exercises the linear sRGB branch: `.01292/12.92=.001`.
- Half-red over destination premultiplied blue `(0,0,.5)`, alpha .5 gives
  `(.5,0,.25)`, alpha `.5+.5*.5=.75`; straight RGB is `(2/3,0,1/3)`.
  Half-blue drawn after half-red over opaque black gives `(.25,0,.5)`, alpha 1;
  neither outline writes depth to block the other.
- Depth equality survives LEQUAL; NDC .2 maps to depth .6 and fails against
  .5. Samples outside [-1,1] are clipped. No surviving sample writes depth.
- Base MASK holes, base opacity zero and base texture alpha zero do not discard
  outline samples. Zero/negative outline alpha does. Corrected front faces are
  culled, for both reflected and ordinary nodes.
- Mixed effective thicknesses `(0,2,4)`, W `(1,2,4)` and screen barycentrics
  `(.25,.25,.5)` give perspective weights `(.25,.125,.125)`. Interpolated
  thickness is `(0+.25+.5)/(.25+.125+.125)=1.5`, so the sample survives.
- The order fixture has centroid depths 4,5,5,5. Depth 5 draws first; node,
  primitive and triangle indices settle ties. The required index order is
  `[3,2,1,0]`.

[flags.json](flags.json) contains the PMX `0x10` truth table (including unrelated
bits), PMD material/vertex flag polarity, extension presence/absence and whole
draw suppression for zero size/alpha/all-zero scales. These are mapping contract
assertions, not a converter implementation.

[schema.json](schema.json) covers omission, explicit defaults, zero/fractional
sizes, unrestricted source RGBA, metadata, prohibited `enabled`/unknown fields,
wrong types/lengths, negative sizes and non-finite machine numbers. The actual
schema is compiled by Ajv with strict numeric validation; a duplicated hand-coded
schema substitute is not used.

[assets.json](assets.json) applies explicit mutations to a fresh copy of an
example, then checks the real binary accessors. Negative cases cover integer,
normalized/vector accessors, mismatched counts, absent normals, attribute morph
targets, missing extension declarations, bad references/bounds, negative and
non-finite values, and sparse index order/bounds. One invalid attribute occurs
on a zero-size material to prevent skipping validation along with rendering.

For ordinary edge data, `edgeValues` patches three float32 values at byte 72.
The special string `"Infinity"` is intentionally converted to non-finite binary
float32 to test rejection; no invalid JSON numbers are committed. Sparse cases
store an index byte at offset 72 (or 84 after a base scale array), align values
to four bytes and store replacement 2. Index 1 with no base gives `[0,2,0]`;
with base `[1,1,1]` it gives `[1,2,1]`. This independently distinguishes missing
attribute default **1** from sparse zero initialization. Positive cases also
cover explicit `normalized:false`, scales above 1, required-extension support,
triangle strips/fans and optional unsupported-extension fallback data.

This minimal extension checker does not replace a full core validator or test
every possible glTF binary layout. It covers the normative branches used by the
fixtures and validates complete positive assets with the Khronos validator.

## Validation record

Executed on 2026-10-21 with Node.js 24.12.0 and the repository lockfile:

| Check | Actual result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; no dependency changes |
| `npm run test:outline` | Passed: 30 position vectors, 20 fragment vectors, 23 schema cases, 30 asset cases, flags/defaults/skip behavior and triangle ordering |
| Embedded example validation | All three examples: zero Khronos core errors; expected unsupported-extension/unused-material notices as described above |
| `npm test` | Passed: existing toon conformance checker, outline checker and all 8 converter/plugin tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Vite reports the existing bundle-size warning for a chunk larger than 500 kB |
| `npm run check:links` | Passed: 87 local documentation links, anchors and built-example asset links |
| `git diff --cached --check` | Passed |

Original-MMD screenshots/state captures were not performed; the original
Windows application was not executed. No pixel-equivalence claim follows from
these checks. Browser/GPU tests were not run for this specification-only change;
no runtime or rendering implementation was modified. The link checker does not
test external URL availability. No post-merge verification is required.
