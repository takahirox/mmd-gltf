# MMD_skinning_qdef (draft)

Status: experimental, runtime-independent `rigid-dq-v1` project profile. This is
four-influence dual-quaternion deformation, not evidence of original-MMD fidelity.
The PMX format-author document identifies QDEF but leaves algorithm choices open.
This draft fixes those choices. It reuses core joints, inverse binds, morph targets
and animation; it adds only per-vertex selection. No general deformation framework
or general PMX 2.1 support is implied.

## Selection and layout

The primitive extension is `{ "selector": 5 }`, referring to an accessor, and must
be declared in `extensionsUsed`. See the [schema](schema/mesh.primitive.MMD_skinning_qdef.schema.json)
and [complete self-contained example](examples/mixed.gltf). The accessor is
non-normalized UNSIGNED_BYTE SCALAR, exactly POSITION.count entries. Values 0
(default core skinning) and 1 (QDEF) are the only valid values. Omitting the
extension selects core behavior. Offsets, buffer strides and sparse layouts follow
core accessor rules. This profile requires TRIANGLES, FLOAT VEC3 POSITION and
NORMAL, core skin, and one JOINTS_0/WEIGHTS_0 pair (unsigned byte/short VEC4 joints,
FLOAT VEC4 weights). Tangents, if present, rotate as directions; their handedness
component is retained. POSITION morph deltas apply before deformation; authored
normals and optional core normal morphs precede the rotation too.

All four joint indices must address the instance's skin, including padding slots.
Weights must be finite, nonnegative and sum to one within 1e-6 for this profile.
Positive-weight joint indices must be unique. Zero-weight slots have no effect on
sign reference, blending or transformation. Converter policy merges duplicates in
first-occurrence order, normalizes only roundoff-sized unit-sum deviations (1e-6),
and replaces inactive source indices with core joint zero. This normalization is
our converter/profile policy, not a mandatory PMX rule or a general restriction on
FLOAT glTF weights. Materially non-unit sums fail rather than being guessed.

SDEF may coexist on the same primitive, through its own extension. A vertex may
select at most one of SDEF and QDEF; overlapping selectors are invalid. A consumer
must dispatch QDEF, SDEF or linear skinning once, after morphs. It must never apply
core skinning followed by QDEF. Neither extension depends on Toon or Outline.

## Spaces and rigid transforms

Let M be the mesh world transform and J_i the current world joint transform. In
mesh-local coordinates the effective palette is T_i = inverse(M) J_i IBM_i, where
IBM_i is the core inverse bind. Transform the deformed result by M for world
placement. This cancels common scene placement, including a common scene scale.
A runtime with an additional bind-space mapping B, such as Three.js, uses
inverseBindPlacement J_i IBM_i B on positions expressed in its corresponding local
space. B and every effective T_i must be finite proper rigid affine transforms.
Nonidentity rigid binds are supported. Scale, shear and reflection in effective
palettes are errors; do not silently discard them during quaternion extraction.
The integration accepts orthonormal/determinant/affine residuals at most 2e-5 to
absorb stored FLOAT roundoff. Translation is in the same units as POSITION (metres
for this converter). Common scene placement is removed before rigidity checks.

## Exact deformation equation

Quaternions below use XYZW Hamilton products; vectors are column vectors. For each
active rigid T_i, extract a unit rotation r_i and translation t_i. Matrix extraction
uses the positive-trace branch, otherwise the greatest diagonal branch with strict
X > Y and X > Z, then Y > Z, otherwise Z (the standard Three.js extraction order).
The positive-trace branch sets w = sqrt(1 + trace)/2 and xyz from the antisymmetric
matrix terms divided by 4w. The other branches set the selected vector component
positive from sqrt(1 + selected diagonal - other diagonals)/2, then obtain the other
components from symmetric terms and w from antisymmetric terms. Normalize r_i.

Canonicalize its sign: inspect w, x, y, z in that order, skip components with
absolute value <= 1e-6, and make the first remaining component positive. This
finite tie band is a project policy to keep CPU/FLOAT matrix noise at half-turns
from choosing opposite canonical signs. It does not clamp quaternion components.

The reference is the canonical rotation of the **first positive-weight slot**.
Build d_i = (t_i,0) r_i / 2. If dot(reference,r_i) < -1e-6, negate both r_i and d_i.
Otherwise retain both signs, including exact zero and the entire tie band. Thus
inactive slots never choose the hemisphere, and exact orthogonal ties retain the
canonical sign. Temporal sign tracking is not used. Outside the tie band this is
the usual antipodality correction. Near tie boundaries the profile may be
discontinuous; it does not claim continuity or MMD's choice at those boundaries.

Let R = sum(w_i r_i), D = sum(w_i d_i), and L = length(R). If L <= 1e-8, use the
entire first active rigid transform (position and rotational normal/tangent), not
BDEF4 or an unnormalized quaternion. Otherwise r = R/L,
d0 = D/L, d = d0 - r dot(r,d0). This Study projection enforces the dual constraint.
The translation is 2 xyz(d conjugate(r)). The output is:

```
p' = rotate(r, morphedPosition) + 2 xyz(d conjugate(r))
n' = rotate(r, morphedNormal)
tangentXYZ' = rotate(r, morphedTangentXYZ)
```

Rotation uses v + 2 r.xyz cross(r.xyz cross v + r.w v). Normalize normals for
lighting; do not transform selected normals with the weighted linear matrix or
its inverse transpose. Outline consumes the same deformed positions/normals.

## Fallback, required use and validation

The converter emits an optional extension and usable core BDEF4 data. Ordinary
loaders therefore show an **approximation** with measurable volume/position loss.
An author requiring QDEF must also list it in `extensionsRequired`; unsupported
loaders must then reject according to core glTF. Mixed SDEF should independently
be required when its behavior is essential. Core glTF validation does not validate
our extension semantics; loader validation and [semantic fixtures](tests/semantics.json)
run under `npm test`, and actual GPU/raster fixtures under `npm run test:browser`.
Exporter adapters rebuild accessor references, never copying stale JSON indices.

## References and scope

- [PMX format-author document (mirror)](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
- [Kavan's general DQS reference shader](https://users.cs.utah.edu/~ladislav/dq/dqs.cg)
- [Core glTF specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Three.js r186 skinning](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Skinning.js)
- [Pipeline and bounded PMX input](../../docs/qdef.md)

The implementation is original equation-based code; the shared matrix/TSL SDEF
helpers retain their existing adapted-code [notice](../../packages/three-mmd-sdef/THIRD_PARTY_LICENSE).
Kavan's shader is a general-algorithm reference, not copied source and not an
original-MMD measurement. Synthetic conformance cannot establish representative
asset compatibility, solver ordering, physics or parity.
