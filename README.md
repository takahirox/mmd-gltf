# mmd-gltf

A static, BDEF or mixed SDEF PMX → glTF pipeline, Three.js loader plugins and outline effect for
the [MMD_materials_toon](extensions/MMD_materials_toon/README.md) and
[MMD_materials_outline](extensions/MMD_materials_outline/README.md) v0.1 drafts.
The converter uses `mmd-parser` and glTF Transform, without Three.js scene
serialization. The Gene Light example shows the original PMX loaded directly
with pinned `@takahirox/three-mmd@0.1.2` beside the generated GLB loaded through
`GLTFLoader.register()`. Orbit and zoom stay synchronized; Front/Side/Back presets
use the same camera, scale, static base pose, lighting and renderer. The right
pane also offers the independent PBR fallback. The Outline menu toggles both
implementations; their different thickness laws are labeled in the example.

Original-MMD fidelity is unverified. [Issue #13's research report](docs/original-mmd-research.md)
records the inspected original 9.32 x64 distribution, unresolved shading rules,
synthetic PMX probes and the blocker: original-renderer execution and measured
reference output are unavailable in this runner. Neither browser pane is the
original MikuMikuDance renderer.

Use Node.js 22.12 or later:

```sh
npm ci
npm run assets
npm run convert -- .cache/gene-light/Gene_light.pmx public/gene-light/model.glb
npm run example:assets
npm run dev
```

Open the printed local URL with `/mmd-gltf/` (normally
`http://127.0.0.1:5173/mmd-gltf/`). `example:assets` generates the attributed
example GLB and copies the same verified original PMX, ten PNGs and both notices
for this reviewed personal noncommercial comparison. Downloaded source
files, generated assets, and build output are ignored by Git; the lockfile and
pinned hash manifest make them reproducible.

```sh
npm run typecheck
npm test
npm run build
# Install the Chromium build once if Google Chrome is not installed:
npx playwright install chromium
PLAYWRIGHT_CHROMIUM_CHANNEL=chromium npm run test:browser
npm run check:links
npm run preview
# Preview: http://127.0.0.1:4173/mmd-gltf/
git diff --check
```

`npm test` requires `npm run example:assets` first; browser tests require
`npm run build` first. Browser tests default to the
installed Google Chrome; omit the environment variable to use it. Tests force
WebGL2 through `WebGPURenderer` and SwiftShader for reproducible headless checks.
The example defaults to WebGL2; append `?backend=webgpu` to try native WebGPU,
which tests explicitly skip without an adapter. Views stack on narrow screens.
The direct PMX is a practical reference, not a bit-identical MikuMikuDance oracle;
independent ambient/toon/specular models produce documented shading differences.
Neither Gene view animates or steps IK/physics/morphs. The linked synthetic BDEF
rig loads two VPD poses and two VMD bone motions, two combined bone/morph motions and morph-only motion on two distinct BDEF rigs, supports local files with explicit
encoding/binding maps, and provides pose apply/reset plus motion transport and fractional seeking. It applies raw
bone offsets without solvers; it does not reproduce complete MMD poses.
The browser runner owns a Vite conformance server on port 43179 and a static
preview on port 43180. Both browser tests and
build use the repository prefix `/mmd-gltf/`.

See the [pipeline and plugin guide](docs/pipeline.md),
[Gene Light rights/provenance review](docs/gene-light.md),
[visual investigation and before/after evidence](docs/comparison.md), and
[validation record](docs/validation.md). The Pages example is
`https://takahirox.github.io/mmd-gltf/`; verification of this comparison deployment
remains pending until merge.

- `tools/`: generic PMX converter and verified example acquisition/generation.
- `packages/three-mmd-toon/`: reusable TypeScript GLTFLoader plugin and TSL material.
- `packages/three-mmd-outline/`: independent loader plugin, metadata integration and TSL outline effect.
- `examples/`: static Vite example; its conformance entry is development-only.
- `extensions/`: runtime-independent proposals, schemas and numerical fixtures.
- `tests/`: converter, resource, plugin and browser integration checks.

The independent [MMD_materials_outline v0.1 draft](extensions/MMD_materials_outline/README.md)
defines material edges and `_MMD_EDGE_SCALE`, with embedded glTF examples and
CPU conformance fixtures (`npm run test:outline`). Its pixel normalization is a
proposal; original-MMD pixel equivalence is unverified. The converter emits optional outline payloads and signed vertex scales; the
independent plugin/effect works with core PBR, active Toon or an explicit
other-material alpha binding. See the [outline API and lifecycle](docs/pipeline.md#outline-plugin-and-effect).

The PMX converter defaults to a static base pose. Opt in with `--mode bdef`
to preserve BDEF1/2/4 through core glTF skins, including exact source bone identity.
Use `--mode sdef` for mixed BDEF/SDEF and register `MMDSDEFPlugin` for accurate
deformation; ordinary loaders use an approximate BDEF2 fallback. See the
[SDEF draft](extensions/MMD_skinning_sdef/README.md) and
[runtime/export API](docs/pipeline.md#mixed-sdef-conversion-and-runtime).
The [synthetic rig](examples/rig.html) demonstrates the converter output with
Toon, core PBR and Outline. QDEF/PMX 2.1, deformation layers, IK/append, physics,
non-vertex morph evaluation and scene VMD execution remain unsupported. PMX type-1 vertex morphs convert in static and BDEF modes; VMD weights share the bone transport. Solver-free VPD bone offsets are supported;
see the [VPD contract and APIs](docs/pipeline.md#vpd-bone-offsets). The outline effect
also accepts core POSITION/NORMAL morph deformation from other assets.
Source models and derivatives retain their own rights. Gene Light is
**CC BY 4.0 with additional usage guidelines and retained trademark/design
rights**, for academic/personal noncommercial scope; contact the authors for
other commercial use. It is not licensed as repository code.

Convert PMX plus a byte-based VPD (Shift_JIS default, `--vpd-encoding utf-8`
for UTF-8) with an explicit map when source names are ambiguous:

```sh
npm run convert -- tests/fixtures/bdef.pmx output/posed.glb --mode bdef --scale 0.2 --vpd tests/fixtures/pose-a.vpd --vpd-map tests/fixtures/pose-a-map.json
npm run convert -- tests/fixtures/vpd-wedge.pmx output/posed.gltf --mode bdef --scale 0.125 --vpd tests/fixtures/pose-b.vpd --vpd-encoding utf-8 --vpd-map tests/fixtures/pose-b-map.json
```

The [reusable Three.js VPD API](packages/three-mmd-vpd/index.ts) parses bytes,
binds exact source names within a model, applies offsets from original rest and
resets even after posed-asset reload. Resolved poses use core joint transforms;
versioned `extras` retain source identity, scale and original rest. Missing or
inconsistent metadata fails clearly. Unmatched names fail by default; partial
application is explicit and diagnostic. Parent filenames are informational.
See [provenance and independent synthetic tests](tests/fixtures/README.md) and
[validation results](docs/validation.md#issue-27-solver-free-vpd-bone-offsets).

Solver-free VMD 0002 bone motion is supported in BDEF mode:

```sh
npm run convert -- tests/fixtures/bdef.pmx output/motion.glb --mode bdef --scale 0.2 --vmd tests/fixtures/motion-a.vmd --vmd-map tests/fixtures/motion-a-map.json --vmd-morph-unmatched ignore
```

The optional [retained-curve draft](extensions/MMD_animation_vmd/README.md) preserves
VMD curves with an explicitly approximate core TRS fallback. The
[reusable VMD API](packages/three-mmd-vmd/index.ts) and built Demo support
play/pause, fractional seek, loop, reset, disposal and explicit VPD ownership handoff.
See the [reader/name/evaluation/API contract](docs/vmd.md) and
[measured validation](docs/validation.md#issue-29-vmd-bone-motion).
All known sections are read; bone and vertex-morph tracks execute, while scene
execution is omitted with counts. Unmatched morphs fail by default; legacy samples
explicitly ignore/report their preserved unused records. Continuous adjacent-frame
curves are a project policy, not measured original-MMD equivalence.

PMX vertex targets preserve exact source index/name/type metadata independently
of loader display dictionaries. The [morph contract and APIs](docs/vmd.md#vertex-morph-weights-issue-31)
cover separate byte-name mappings, independent additive weights, model-scoped
inspection/apply/reset and VPD/VMD handoff. See the
[combined synthetic validation](docs/validation.md#issue-31-vertex-morphs-and-combined-motion).

## Contributing

- [Development flow and English collaboration convention](docs/development-flow.md)
- [Review and merge guidelines](docs/review-guidelines.md)
- [Issue template](.github/ISSUE_TEMPLATE/issue.md)
- [Pull request template](.github/pull_request_template.md)

AI agents should start with [AGENTS.md](AGENTS.md).
