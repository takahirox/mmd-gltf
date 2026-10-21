# Synthetic conformance fixtures

These fixtures specify v0.1 material evaluation, not an MMD screenshot match.
They are newly constructed data. No engine output, existing shader test results,
or standard MMD toon image bytes were used to obtain the expected numbers.
`check.cjs` is a test-only translation of the normative evaluator and a small
base-level sampler; it is not a runtime, converter, or shader package.

## Running the checks

Use Node.js 22.12 or later. Install the repository's pinned dependencies and run:

```sh
npm ci
npm run example:assets
npm test
npm run build
npm run test:browser
git diff --check
```

`npm test` runs this reference checker plus converter/plugin tests. The browser
suite executes the production TSL graph against all 43 independent numerical
fixtures on WebGL2, then loads/renders the generated Gene GLB and toggles its PBR
fallback. See the [setup guide](../../../README.md) for browser installation and
native WebGPU capability skips. Expectations below remain independent of the
runtime implementation.

Run from the repository root. Ajv validates the actual JSON Schema, including
negative cases; its strict numeric checking also rejects JSON numbers such as
`1e400` that overflow the host's number representation. No remote schema
resolution is needed. Defaults are applied by the evaluator, not by Ajv.

The Khronos glTF Validator validates both complete example files and their
embedded resources. The runner also verifies that both JSON code blocks in the
specification match those files. `UNSUPPORTED_EXTENSION` is expected: the core
validator does not implement this draft. `UNUSED_OBJECT` notices are expected
for the unreferenced material in the material-only asset and texture/UV data
used only by the extension. Zero core errors does not validate extension math;
Ajv, the numerical vectors, and cross-object checks cover that separately.

## Shading fixture contract

[shading.json](shading.json) contains explicit expected results. They are literal
hand calculations from the documented equation, independent of the test
implementation. Do not regenerate expectations by running `check.cjs` or an
engine under test. The calculation notes below provide an independent audit.

- Each case supplies a complete `material` (including the extension and optional
  fallback/common state), plus any changes to the evaluation environment.
- Environment defaults are `N=L=V=normalView=(0,0,1)`, `Lrgb=(1,1,1)`, and
  `TEXCOORD_0=(0.5,0.5)`. All supplied direction vectors are already normalized.
  No transform, rasterization, shadows, fog, tone mapping, postprocessing, or
  antialiasing is involved. `uvs` are interpolated values, after any upstream
  base UV transformation; the numerical sampler does not implement transforms.
- `textures` are synthetic grids of RGBA tuples in rows from top to bottom.
  Values are normalized source components unless `encoding` is `"unorm8"`,
  which divides each byte by 255. Alpha is never gamma converted.
  `filter` is explicit; addressing defaults to clamp-to-edge, with an explicit
  repeat-addressed grid for the base sampler case. All tests use base level.
- For nearest sampling, use `floor(U*width), floor(V*height)` then address the
  texel indices. For bilinear sampling, use `x=U*width-0.5`,
  `y=V*height-0.5`, interpolate the four addressed adjacent texels.
- `sharedSyntheticTexture` injects a synthetic ramp into a shared selector.
  `sharedMapping` independently lists all ten required resource names.
  The mapping check includes endpoints 0 and 9, without asserting image colors.
- Expected `rgb` and `alpha` are `finalRGB` and `finalAlpha`. `coverage` is 1
  for opaque or surviving masked fragments and the evaluated alpha for blend;
  the test harness records coverage 0 for a discarded fragment. `sphereUV` is
  the actual UV used for the sphere/subtexture sample, or null if inactive.
- Expected fields are a subset of the evaluator trace. Numerical fields have
  absolute tolerance `1e-6`. Names, null values, and discard booleans are exact.
  `linearRGB` and `encodedRGB` check the final output boundary; blend tests use
  an explicitly supplied opaque linear background.

## Independent calculation notes

| Cases | Calculation and expected result |
| --- | --- |
| Defaults | `clamp((1,1,1)*(1,1,1)+(0,0,0))=(1,1,1)`; omitted textures and alpha are identity. |
| Diffuse/ambient ordering | `(.4,.2,.6)*(.5,1,.25)+(.1,.2,.05)=(.3,.4,.2)`. Multiplying by `(.25,.5,.75)` gives `(.075,.2,.15)`; alpha `.8*.5=.4`. |
| Dark red / black map | The same lit base times `(.1,0,0)` gives `(.03,0,0)`. Black gives zero, including the ambient contribution. |
| No Lambert factor | With no toon or highlight, reversing L leaves `(.2,.4,.6)` unchanged. |
| Vertical RGB toon | A 1x3 grid has row centers V=`1/6,1/2,5/6`. Dot products `-1,-.25,0,.25,1` give V=`0,.25,.5,.75,1`. At V=.25, `y=.25`, so the red/green mix is `(.75,.25,0)`; at .75 the green/blue mix is `(0,.25,.75)`. Top/middle/bottom are red/green/blue. |
| Sphere none | The referenced color and zero alpha are unused: RGB `(.4,.4,.4)`, alpha `.8`. Omitted mode is also none. |
| Sphere multiply / add | `(.4,.4,.4)*(.5,.25,.75)=(.2,.1,.3)`; addition followed by final clamp gives `(.9,.65,1)`. Sampled alpha zero does not change `.8`. |
| View normal | `normalView=(.6,.8,0)` gives UV `(.8,.1)`, selecting the grid's top-right `(.8,.6,.4,.2)`. Its alpha is ignored. |
| Additional UV1 | UV1 `(.25,.75)` selects bottom-left `(.1,.3,.5,.25)`, whereas sphere UV would select top-right. Base color is `(.1,.2,.3)`; result `(.01,.06,.15)`, alpha `.8*.5*.25=.1`. |
| Base set and repeat | Choosing set 1 `(.25,.75)` selects blue and alpha `.25`. Repeat at `(1.75,-.75)` resolves to `(.75,.25)`, green with alpha `.5`. |
| Specular after layers | With N=L=V=+Z and q=2, the highlight is exactly P. Black base still yields `(.2,.3,.4)`. A colored sphere/toon produces surface `(0,0,.3)`, then specular yields `(.2,.3,.7)`. |
| Nontrivial half vector | L=+X, V=+Z, N=+Z gives `dot(N,H)^2=1/2`. `(.2,.4,.6)*(.5,1,2)/2=(.05,.2,.6)`. |
| Disabled specular | q=0, an exactly zero L+V, or a nonpositive normal/half-vector dot (with q>0) gives zero highlight. |
| Initial clamp | `(2,-1,.5)+(0,0,1)` clamps to `(1,0,1)` before the base sample, giving `(.25,0,.75)`. Alpha `3*.5` clamps to 1. |
| No sphere-add clamp | `(.8,.8,.8)+(.5,.25,.75)=(1.3,1.05,1.55)`. Toon `(.75,.25,0)` gives `(.975,.2625,0)`, with no intermediate clamp. |
| Negative specular | `(.4,.4,.4)+(-.5,.2,1)=(-.1,.6,1.4)` finally clamps to `(0,.6,1)`. |
| Source components | `.5*(.5,.25,.75)=(.25,.125,.375)` with no gamma decoding. The byte sample times .5 is `(64/255,32/255,1/2)` and alpha is `64/255`. |
| Output boundary | Decode `.5` with `((.5+.055)/1.055)^2.4=.21404114048223255`; encode once returns `.5`. Blend with coverage .25 over linear black gives `.05351028512055814`. |
| Alpha modes | Opaque keeps full coverage at alpha 0. Mask discards .499 below default .5, retains .5 at equality, and retains .25 at an explicit .25 cutoff. Blend coverage is the clamped alpha, including negative/over-one inputs. |
| Transparent sample | A zero-alpha white base still has RGB `(1,1,1)` and full opaque coverage; zero alpha alone does not discard. |
| Independent fallback | Two deliberately different PBR fallbacks, one with maps and emissive/normal/occlusion inputs, both leave extension RGB `(.2,.4,.6)` and alpha `.8`. |

## Schema and whole-asset fixtures

[schema.json](schema.json) supplies positive and negative **local extension
objects**: defaults, unrestricted factors, valid references, selector endpoints,
custom/shared mutual exclusion, required indices, type/array-length/range checks,
invalid enum values, active modes requiring a sphere reference, and prohibited
UV/transform members on generated-coordinate references. `invalidNumericJSON`
contains standard JSON syntax whose numbers overflow JavaScript to infinity;
these must also fail. Schemas validate without mutating the fixture objects.

[assets.json](assets.json) describes small mutations of the complete examples.
`changes` assigns a `value` at an array of object/array path keys.
`expectedError` is a required substring for rejected cases; omission/null means
extension-specific cross-object validation must succeed. Positive cases include
the original two examples and a base texture transform overriding an otherwise
missing UV set. Rejected cases cover out-of-range texture/image references,
an inactive but invalid sphere reference, absent UV1 for subtexture, and a
missing base UV attribute. The runner also rejects missing UV1 directly in the
evaluator. These targeted checks supplement, rather than replace, a full glTF
validator; local JSON Schema cannot check top-level array bounds or mesh use.

No comparison with original MikuMikuDance has been performed. Original-renderer
observations are required to resolve Issue #13; that verification is blocked,
not waived by these tests. See the [research report and capture protocol](../../../docs/original-mmd-research.md)
and [synthetic PMX probe generator](../../../tools/generate-mmd-probes.ts).
These checks establish arithmetic/asset consistency with the draft, not original
executable equivalence, GPU rasterization, or rights to shared resources.
