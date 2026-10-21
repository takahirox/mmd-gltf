# mmd-gltf

A static PMX → glTF pipeline and Three.js loader plugin for the
[MMD_materials_toon v0.1 draft](extensions/MMD_materials_toon/README.md).
The converter uses `mmd-parser` and glTF Transform, without Three.js scene
serialization. The Gene Light example shows the original PMX loaded directly
with pinned `@takahirox/three-mmd@0.1.2` beside the generated GLB loaded through
`GLTFLoader.register()`. Orbit and zoom stay synchronized; Front/Side/Back presets
use the same camera, scale, static base pose, lighting and renderer. The right
pane also offers the independent PBR fallback.

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
Neither view animates or steps IK/physics/morphs/outlines.
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
- `examples/`: static Vite example; its conformance entry is development-only.
- `extensions/`: runtime-independent proposals, schemas and numerical fixtures.
- `tests/`: converter, resource, plugin and browser integration checks.

The independent [MMD_materials_outline v0.1 draft](extensions/MMD_materials_outline/README.md)
defines material edges and `_MMD_EDGE_SCALE`, with embedded glTF examples and
CPU conformance fixtures (`npm run test:outline`). Its pixel normalization is a
proposal; original-MMD pixel equivalence is unverified. The current converter,
plugin and browser example do not implement outlines.

The current runtime scope excludes animation, skins, IK, grants, physics, morphs and
outlines. Source models and derivatives retain their own rights. Gene Light is
**CC BY 4.0 with additional usage guidelines and retained trademark/design
rights**, for academic/personal noncommercial scope; contact the authors for
other commercial use. It is not licensed as repository code.

## Contributing

- [Development flow and English collaboration convention](docs/development-flow.md)
- [Review and merge guidelines](docs/review-guidelines.md)
- [Issue template](.github/ISSUE_TEMPLATE/issue.md)
- [Pull request template](.github/pull_request_template.md)

AI agents should start with [AGENTS.md](AGENTS.md).
