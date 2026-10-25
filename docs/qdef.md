# Bounded PMX 2.1 QDEF pipeline

Issue #37 adds an opt-in `qdef` mode and the
[MMD_skinning_qdef draft](../extensions/MMD_skinning_qdef/README.md). The project
profile is `rigid-dq-v1`: general dual-quaternion deformation with explicit sign,
tie, normalization and degeneracy policies. It does not claim original-MMD fidelity.

## Input boundary

`parsePMX(bytes)` dispatches actual binary FLOAT 2.1 (`Math.fround(2.1)`) to the
bounded reader in [pmx21.ts](../tools/pmx21.ts). PMX 2.0 retains the pinned parser
and its existing UTF-8 text adapter. No version bytes are relabeled. Exact names,
including BOM characters, combining sequences and astral characters, survive fatal
UTF-16LE/UTF-8 decoding. The header must contain eight global bytes, 0..4 extra
UV channels and 1/2/4-byte indices. Vertex 8/16-bit references are unsigned; other
indices and 32-bit vertex indices follow the signed source layout.

The 2.1 reader accepts existing triangle/material/bone/morph/display/rigid-body
and type-zero joint layouts, plus type-four QDEF. It reads the mandatory soft-body
count and **requires zero**. It rejects flip/impulse/unknown morph records, drawing
flags 0x20/0x40/0x80 (vertex-color/point/line), nonzero joint types, invalid table
references/counts, unsupported encodings/versions, nonfinite numeric records,
truncated sections and unexplained trailing bytes. Shared-Toon indices are bytes
in 0..9; the optional common record layouts are exercised in both encodings. Errors name the section and
record index when available. Unsupported records fail before any output is written.
This is a bounded 2.1 input profile, not general 2.1 support. Parsed-object API
callers must retain explicit `metadata.softBodyCount: 0`; `convertModel()` repeats
the section exclusions so modified objects cannot bypass them. Existing parsed morph
families 0 and 2..8 remain explicit conversion losses, as in 2.0. Display frames,
IK/append, local axes, deformation layers and physics do not execute. Their source
records are parsed, but the warning report describes omissions. Only POSITION
vertex morphs execute. The profile does not silently reinterpret unknown layouts.

Both readers reflect position/normal/vector Z and triangle winding together;
conversion scales coordinates, inverse binds, vertex-morph deltas and SDEF vectors
once to metres. Core weights/joints remain available as an approximate fallback.
Root extras preserve `sourcePMXVersion`, `sourcePMXEncoding`, scale and loss report.
Static remains the default. Strict BDEF and SDEF modes still reject QDEF vertices.

## Converter and runtime

```sh
npm run convert -- tests/fixtures/qdef-box.pmx output/qdef.glb --mode qdef --scale 0.2
npm run convert -- tests/fixtures/qdef-wedge.pmx output/qdef.gltf --mode qdef --scale 0.125 --vmd tests/fixtures/combined-b.vmd --vmd-map tests/fixtures/motion-b-map.json --vmd-morph-map tests/fixtures/morph-map.json
npm run convert -- tests/fixtures/qdef-box.pmx output/posed.glb --mode qdef --scale 0.2 --vpd tests/fixtures/pose-a.vpd --vpd-map tests/fixtures/pose-a-map.json
```

The API uses `convertModel(model, textureDirectory, { mode: 'qdef', ... })` or
`convertPMX(input, output, options)`. Existing VMD/VPD encoding, binding, diagnostics
and fallback sampling options are unchanged. QDEF and SDEF selection are separate
optional primitive extensions; ordinary glTF viewers retain approximate BDEF4
(and BDEF2 for SDEF). A required extension is an authoring choice; see the draft.

```ts
import { MMDQDEFPlugin, MMDQDEFExporterPlugin } from '../packages/three-mmd-qdef';
import { MMDSDEFExporterPlugin } from '../packages/three-mmd-sdef';

let deformation: MMDQDEFPlugin;
const loader = new GLTFLoader()
  .register(parser => deformation = new MMDQDEFPlugin(parser))
  .register(parser => new MMDVMDPlugin(parser))
  .register(parser => new MMDOutlinePlugin(parser));
// Register MMDToonPlugin for Toon; omit it for plugin-enabled PBR shading.
const asset = await loader.loadAsync('qdef.glb');
const exporter = new GLTFExporter()
  .register(writer => new MMDSDEFExporterPlugin(writer))
  .register(writer => new MMDQDEFExporterPlugin(writer));
const posed = await exporter.parseAsync(asset.scene, {
  binary: true, includeCustomExtensions: true,
});
// When unloading: outlineEffect.release(asset.scene), deformation.dispose(),
// then release source resources and the other plugins owned by the caller.
```

Register `MMDQDEFPlugin` **instead of** `MMDSDEFPlugin` for mixed QDEF assets. It
handles both extension payloads through the existing instance-scoped SDEF
integration, with one morph-before-deformation dispatch. Register it before Outline
so cloned surface materials retain their associations. Toon and PBR are independent
surface choices; skinning works without Toon. Source accessors remain untouched;
the owned QDEF GPU selector uses floats internally to match the TSL input type,
while serialized selectors are UNSIGNED_BYTE. Export adapters resolve newly written
accessor references and strip internal attributes. Use both exporters for mixed
SDEF/QDEF. Core joints, binds, morph weights and rest metadata survive posed export.

`evaluateQDEF(position, normal, matrices, weights)` evaluates the project equation.
`applyQDEF(mesh, index, morphedPosition, optionalNormal)` evaluates a mesh vertex.
`getVertexPosition`, bounds and ray queries share the installed CPU skin hook;
existing VMD/VPD/morph APIs refresh bounds. For direct joint writes, refresh the
whole hierarchy and recompute bounding box/sphere. Joint palettes and binds must
be proper rigid transforms; effective scale/shear/reflection fail, including when
introduced after loading. Common scene placement cancels before palette checks.
Uniform-buffer and bone-texture paths follow the pinned Three.js r186 selection.

Dispose the deformation plugin after releasing Outline hulls and before disposing
source geometry/materials. Its restoration hook releases only owned clones and
restores the original per-instance hooks. Core skeletons remain caller-owned;
when unloading their last owner, dispose each shared skeleton once to release any
bone texture. Replacement in the Demo disposes players,
hulls, materials, geometry and plugin hooks using the existing lifecycle.

## Fixtures, Demo and evidence

`qdef-box.pmx` and `qdef-wedge.pmx` are original repository-authored derivatives of
the earlier two synthetic rigs, with distinct geometry/hierarchy, two primitives,
260 joints and vertex morphs. They mix BDEF1, SDEF ordered pairs and QDEF four-slot
weights. They exercise duplicate merging, inactive -1 references, endpoint weights
and four distinct active joints. `pmx21-fixture.ts` independently writes small
binaries for both text encodings and all nine vertex/other-index-width combinations.
No third-party model bytes were added.

The built [unified demo](../examples/index.html), under **Synthetic rigs**, offers both QDEF rigs, both combined VMD
motions, both VPD poses, byte/GLB/glTF sources, fractional transport, morphs,
Toon/PBR, Outline and an explicitly approximate linear-skinning comparison. Its
rendered-state acknowledgement updates only after submitting the frame; browser
checks also compare canvas images, restoration, error recovery and replacement.
The comparison disables both SDEF and QDEF selectors, then restores both exactly.

The [independent oracle](../tests/qdef-oracle.ts) expands scalar dual products and
point rotation using authored VMD/VPD predictions, without calling production
skinning or reading runtime bone palettes. Node checks cover dense time samples,
queries/bounds, bindings, malformed data and deterministic validator-clean outputs.
The GPU harness reads actual vertex positions and normalized normals through float
render targets and compares surface/Outline rasters against independently baked
geometry, including posed export with active morphs. Additional GPU cases exercise
inactive leading slots, exact/near half-turns, translations and noncommuting axes;
the 1100-joint stress case forces a bone texture, nonidentity bind and placement.

See [validation](validation.md#issue-37-bounded-pmx-21-qdef) and the machine-readable
[qdef-validation.json](qdef-validation.json) for executed results, limits and source
hashes. Required limits remain CPU <=2e-6 m, GPU components <=1e-4 m, normalized
normal components <=5e-4, and <=128 pixels differing by more than two encoded RGB
levels per 160x160 image. Existing SDEF thresholds remain unchanged.

## Specification reconciliation

The old assumption was that QDEF first failed at a vertex. Prior pinned-parser
regressions establish an earlier FLOAT-version comparison failure, separately
from its missing type-four branch. See the retained
[historical correction](validation.md#parser-evidence-correction-for-the-coordinator).
The invalid header-modified 2.0 probe remains a rejection regression. The corrected
implementation reads genuine 2.1 bytes through a separate bounded reader and
preserves their version; it addresses both failures without approximating QDEF.
The primary layout reference is the
[format-author document mirror](https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt).

An initial implementation used sign decisions at exact floating zero. Measured
quarter-turn compositions gave equivalent half-turn palettes residual w values of
0 versus 2.36e-16, selecting opposite blend arcs and a large synthetic position
error. The finalized draft explicitly defines a 1e-6 canonical/sign tie band for
CPU/FLOAT stability; tolerances were not relaxed. This is an unresolved-algorithm
project policy, not a measured MMD rule. The independent scalar fixtures and actual
GPU checks use that documented policy.

IK/append ordering, physics, remaining morph families, scene animation and lawful
representative QDEF compatibility remain overall work. Native WebGPU and controlled
original-MMD measurements are optional here and separately reported. Neither test
presence, a successful local build nor merge status establishes MMD parity.
