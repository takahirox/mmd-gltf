# Issue #7 validation record

Local validation on 2026-10-20, Node.js 24.12.0, macOS, Google Chrome headless.
This record covers the pre-merge worktree, not a published deployment.

- TypeScript checks pass (`npm run typecheck`).
- The original conformance checker passes: 43 shading vectors, 10 shared mappings,
  56 schema cases, 10 whole-asset cases, and 2 complete example assets.
- Converter/plugin tests pass (`npm test`): deterministic pinned-source conversion,
  Khronos glTF Validator with zero errors, geometry/index/UV checks, unchanged
  image hashes, separate PBR factors, material modes, shared/custom selectors,
  unpacked glTF resources, invalid inputs and missing resource/error paths.
- WebGL2 browser checks pass using the actual production TSL graph and generated
  Gene Light GLB (`npm run test:browser`). All 43 independent numerical material
  vectors pass against float-target readback, including linear compositing and
  an actual sRGB output check. Numerical tolerance is 2e-6 for GPU floats and
  2/255 at the quantized canvas boundary. Existing fixture expectations are
  unchanged. Full GLTFLoader tests also cover PNG decoding, simultaneous PBR
  use of the same image, and deliberately contradictory core material factors.
- The built static example renders 13 mesh primitives, switches toon/PBR/back, and
  serves notices/manifest/conversion record without asset, shader or runtime
  errors. A screenshot was inspected locally; no MMD visual-equivalence claim
  is made. Browser artifacts live in ignored `test-results/`.
- Native WebGPU: capability skip; no adapter is available in this headless
  environment. The renderer's WebGL2 backend is tested with SwiftShader.
- Static build and repository-prefix link/anchor checks pass (`npm run build`,
  `npm run check:links`). The static output contains no conformance entry,
  source PMX or duplicate source textures. Vite reports a large-bundle warning
  for the Three.js renderer bundle (approximately 999 kB, 274 kB gzip).
- `git diff --check` passes.

Generic CLI GLB: 4,767,780 bytes, SHA-256
`c760c80e6b50ec6b66a686b31f44790491db4d3ed5225f16b56e475ea91b9efb`.
Attributed example GLB: 4,770,644 bytes, SHA-256
`6c753b5ccf1f95875fb4cfe1aeb0bbdf3058d9f4cb93d1b88e1cb508433596b5`.
The extra bytes are provenance/rights/conversion metadata. Both are reproducible
from the pinned source with this dependency lockfile. The validator reports
`UNSUPPORTED_EXTENSION` for the draft; extension-specific tests provide its
validation. Source counts: 28,646 vertices, 47,106 triangles, 13 materials and
10 images. Shared MMD image bytes are absent.

The Gene source has a sphere-mode flag with texture index -1 on one material;
conversion disables that absent operation and reports it, retaining the flag
in extras. The [pipeline limitations](pipeline.md) and
[distribution review](gene-light.md) apply. Optional visual comparison against
the upstream animated MMD demo was not performed.

## Required post-merge verification

Verified on 2026-10-20 at 09:49 UTC after merging PR #8 with a merge commit.
Issue #7 was re-read and confirmed open immediately before the merge; GitHub
enforced the approved PR head `e5044c080d618853398c457a909ecd4602227d45`.

- Deployed commit: `fbda16657e9db445414f824e381a14326e08437c`.
- [Workflow run 39403163895](https://github.com/takahirox/mmd-gltf/actions/runs/39403163895):
  **success**, including build and deploy. Deployment 7196605822 reports success.
  Pages was initially disabled; GitHub Actions was enabled as its source before
  the deployment job ran. No workflow bypass or rerun was needed.
- [Public example](https://takahirox.github.io/mmd-gltf/) returns HTTP 200.
  Chrome 155.0.8059.85 headless with SwiftShader verified the actual public
  `?backend=webgl` page: 13 mesh primitives rendered, toon/PBR/toon switching
  changed the rendered image, and drag orbit and wheel zoom changed the view.
  The full-page toon screenshot was inspected and the character is visible.
- The generated GLB, both original notices, source manifest and conversion
  record all return HTTP 200 under `/mmd-gltf/gene-light/`. Both notice hashes
  match the pinned source manifest exactly; the published manifest matches the
  repository manifest. Attribution, usage terms, original-notice links and the
  adaptation notice are present in the page footer.
- Published GLB: 4,770,644 bytes, SHA-256
  `c88172af4754af87aa309b1c7504c0f224a9c1308f24ba4dd9b06a139a2896cf`,
  matching the published conversion record and pinned source commit.
- No asset, shader, console or JavaScript runtime errors occurred. Screenshot
  readback produced GPU-stall performance warnings. Native WebGPU was skipped
  after the browser reported no available adapter; WebGL2 passed.
- Browser script, JSON report and screenshots are retained in ignored
  `test-results/` in this worktree. This checked-in record preserves the outcome
  independently of those local artifacts.

Cross-platform reproducibility limitation: regenerating the example on macOS
with the same lockfile reproduces the earlier macOS hash above, while Linux CI
produces the published hash. Comparing the GLBs found identical binary chunk
headers/payloads and only one JSON value difference: material 12's PBR base-color
red factor is `0.0908417000288922` on macOS and `0.09084170002889219` on Linux.
The extension values are identical. Conversion is repeatable within the tested
environment, but byte-identical output across these platforms is not established.
