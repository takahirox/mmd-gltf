# MMD_skinning_sdef v0.1 draft

**Experimental, unregistered vendor draft.** This runtime-independent primitive
extension adds spherical deformation (SDEF) to core glTF skins. Core joints,
inverse binds, morph targets, animations and material models remain authoritative.
The [schema](schema/mesh.primitive.MMD_skinning_sdef.schema.json),
[complete embedded example](examples/mixed.gltf) and
[semantic fixtures](tests/semantics.json) accompany this draft.

A primitive payload is `{ "selector": 4, "c": 5, "r0": 6, "r1": 7 }`.
All four values are accessor indices. There are no implicit defaults for a
present payload; omission of the extension means ordinary core skinning.
`selector` is non-normalized UNSIGNED_BYTE SCALAR containing only 0 (core) or 1
(SDEF). `c`, `r0`, `r1` are non-normalized FLOAT VEC3. Every accessor has the same
positive count as POSITION. All values must be finite. Sparse/interleaved core
accessor layouts are allowed with core bounds/alignment and sparse ordering.
Selector 1 remains SDEF when every center value is zero. Values at selector 0
are ignored (converters should write zero). Centers cannot be morph targets.

Every instance of the primitive has a core skin. JOINTS_0 is UNSIGNED_BYTE or
UNSIGNED_SHORT VEC4, WEIGHTS_0 is non-normalized FLOAT VEC4; counts match POSITION.
This draft uses only set 0. At selector 1, X and Y are the **ordered** influence
pair, both joint indices must be in range even at endpoint weights, Z/W weights
are zero, and X/Y weights are in [0,1] and sum to one within 1e-6 FLOAT roundoff.
Duplicate indices are legal; implementations must not merge/reorder slots or
replace inactive pair members. This is a stricter policy than core glTF's SHOULD
for FLOAT normalization. Indices address skin.joints, not node indices.

This draft requires TRIANGLES, POSITION and authored FLOAT VEC3 NORMAL, with
matching counts. The reference loader also bounds decoded FLOAT accessor
magnitudes to 1e8, matching its existing Outline integration limit; this is an
implementation limit, not an additional glTF core requirement.

C/R0/R1 are original, uncorrected values in the same metric mesh bind coordinates
as POSITION. They are points, not bone-local offsets. PMX left-handed Z reflection
applies to all three vectors exactly once, then metric scaling exactly once.
For current joint world J, inverse bind I, and mesh bind B, evaluate local
palette `L = inverse(meshWorld) J I B`. Bind transforms must be rigid. Common
scene placement cancels in L; it is applied after deformation. Supported L has a
proper orthonormal rotation plus translation. Scale, shear, reflection, singular
and non-finite deformation are unsupported and must produce diagnostics, not
silently be reduced to rotations. The reference integration checks at load and
before each draw/query (orthonormal residual tolerance 2e-5).

Given morphed position p and normal n in bind coordinates:

```text
w1  = 1 - w0
Rw  = w0 R0 + w1 R1
CR0 = C + (R0 - Rw) / 2
CR1 = C + (R1 - Rw) / 2
q   = shortest-path slerp(rotation(L0), rotation(L1), w1)
p'  = rotate(q, p - C) + w0 transform(L0, CR0) + w1 transform(L1, CR1)
n'  = rotate(q, n)
```

Use normalized quaternions, negate the second when their dot product is negative,
and a normalized linear limit for nearly identical rotations. Quaternion sign
must not affect the result. Morph POSITION and NORMAL are applied **before** SDEF;
centers stay fixed. Normalize final rendered normals. Tangents follow the same
rotation. Identity palettes reproduce p; endpoints reproduce single-bone skinning;
translated pairs reproduce their weighted translation; rotations preserve arcs
that BDEF2 shrinks. The semantic fixtures specify independently calculated cases.

The extension is independent of Toon activation. Toon and plugin-enabled PBR use
identical SDEF positions and rotational normals. Outline uses those same values
before its view/world normal transform and pixel expansion. Selector 0 retains
ordinary Three.js surface weighted-matrix normals and the existing Outline
inverse-transpose convention. Neither material draft is redefined.

An asset may list this extension only in extensionsUsed and supply the same
JOINTS_0/WEIGHTS_0 as an explicitly **approximate BDEF2 fallback**. An ordinary
loader then uses linear skinning; this is not SDEF equivalence. Authors requiring
SDEF must also list extensionsRequired. The converter emits the optional form.

The algorithm follows the identified alternative-renderer
[three-mmd-loader reference](https://github.com/takahirox/three-mmd-loader/blob/5ae203246ccffd86a3e8fb7be0e34b9559c33a46/docs/sdef.md),
which identifies babylon-mmd's center correction. The mirrored
[PMX format-author document](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt)
identifies the fields and need for correction. This is not measured original-MMD
position/normal behavior. QDEF/PMX 2.1, IK/append ordering, physics, other morph
families, scene animation and representative original-MMD fidelity remain overall
work. Both solver-free VMD bone/vertex-morph playback and VPD offsets are supported.
