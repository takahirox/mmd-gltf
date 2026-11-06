# Published three-mmd 0.1.4 upgrade (Issue #91)

The public Uka/Gene comparison pins the npm-published
`@takahirox/three-mmd@0.1.4`. The direct-PMX reference still uses the package's
public root (`updateMMDUVs`), `./loaders/MMDLoader.js` and
`./effects/MMDOutlineEffect.js` exports. The other pane still uses this
repository's converter and glTF plugins. Integration code, scene lights,
camera defaults, textures, shaders, tone mapping, numerical/pixel thresholds
and the four-shard CI configuration are unchanged.

## Published distribution

Verified on 2026-11-06 against the
[official npm registry](https://registry.npmjs.org/@takahirox%2fthree-mmd/0.1.4):

- Version: `0.1.4`; published `gitHead`: `21c18d58f2d05e28efd8c3caa6c96ec151fc56e4`.
- Tarball: `https://registry.npmjs.org/@takahirox/three-mmd/-/three-mmd-0.1.4.tgz`.
- Integrity: `sha512-r663JzXNf3iMMmEY5bXRI8YzDnT/FrjgeJx+KL/cRVcbSNx1uZbTfv+wxFqX8RDjamoNYL2LEFOZ/KvCH5WWQw==`.
- SHA-1: `61d21ae49eff82c869b26958776bd433442e98f7`.
- Peer `three: ~0.186.0` includes the unchanged installed `three@0.186.1`.
- A fresh `npm ci` installed one 0.1.4 copy, with no 0.1.3 duplicate. All 63
  installed files match the downloaded tarball byte for byte. Manifest, root
  lock dependency, resolved URL and integrity agree with registry metadata;
  npm regeneration changed no unrelated lock entries.

Registry `gitHead` is publication metadata, not a provenance attestation. The
official downloaded 63-file tarball differs from installed published 0.1.3 only
in README, package metadata and `MMDToonMaterial` JavaScript/types. In particular,
loader/resource-path, SDEF, animation, physics and Outline files are unchanged.
The [0.1.3 resource-path record](pmx-resource-paths.md) remains dated history.

## Lighting compatibility and reproducible captures

[Upstream PR #119](https://github.com/takahirox/three-mmd-loader/pull/119)
packages [PR #114](https://github.com/takahirox/three-mmd-loader/pull/114) and
[PR #115](https://github.com/takahirox/three-mmd-loader/pull/115). Authored ambient
now contributes at full strength rather than one half; scene indirect diffuse
uses ordinary color multiplication and enters the toon stage. See the
[upstream compatibility equation](https://github.com/takahirox/three-mmd-loader/blob/21c18d58f2d05e28efd8c3caa6c96ec151fc56e4/docs/material-shading.md#implemented-threejs-compatibility-equation).
This demo uses one directional light and no ambient light, so the authored
ambient change is relevant here; the separate scene-indirect correction has no
nonzero indirect-light input in this scene. Brighter or clipped reference pixels
are possible with the same lights. Neither package release nor these captures
establishes original MikuMikuDance parity or equality between the two panes.

The [capture script](../tools/capture-three-mmd-upgrade.mjs) runs the actual built
demo at a fixed 1000×800 viewport/DPR 1 using Playwright Chromium and ANGLE SwiftShader. For
both Uka and Gene it samples Rest and original Apology at 1 second, each with
Toon/PBR and Outline off/on. Physics is Off; IK keeps its normal On default.
Two successive paused captures must be byte-identical. The comparison requires
identical camera, skin/bone pose and execution hashes, decoded texture inventories
and every glTF-pane pixel across versions.

To reproduce, build and serve production preview separately for each published
lockfile (baseline `5c8428acedfafe4762aafabda76110bdf7e258b8` pins 0.1.3), then run:

```sh
npm ci --registry=https://registry.npmjs.org
npm run build
npm run preview -- --port 43180 --strictPort
# In another terminal, with VERSION set to 0.1.3 or 0.1.4:
PLAYWRIGHT_CHROMIUM_CHANNEL=chromium node tools/capture-three-mmd-upgrade.mjs capture .cache/three-mmd-upgrade/$VERSION
# After both captures:
node tools/capture-three-mmd-upgrade.mjs compare \
  .cache/three-mmd-upgrade/0.1.3 .cache/three-mmd-upgrade/0.1.4 \
  docs/three-mmd-0.1.4-evidence
```

Use the same script from this revision when capturing the baseline. It reads
existing diagnostics without patching either package or application. Full
canvas captures stay in the ignored cache; committed contact sheets contain
only the reference pane. Columns are Toon off, Toon on, PBR off, PBR on. Rows
are Rest 0.1.3, Rest 0.1.4, Apology 0.1.3, Apology 0.1.4.

Results on Chromium **141.0.7390.37**: all 16 states repeat exactly and preserve
camera/pose/execution hashes and decoded textures; **zero glTF pixels change**.
The [Uka contact sheet](three-mmd-0.1.4-evidence/uka.png),
[Gene contact sheet](three-mmd-0.1.4-evidence/gene.png) and
[per-state measurements](three-mmd-0.1.4-evidence/comparison.json) show
surface brightening and more saturated highlights, with unchanged silhouettes
and poses. Representative Outline-off rows follow; Toon/PBR selection changes
only the glTF pane, so reference statistics repeat for both material choices.

| Reference state | Changed pixels | Mean foreground RGB, 0.1.3 → 0.1.4 | Foreground pixels with any channel 255, 0.1.3 → 0.1.4 |
| --- | ---: | ---: | ---: |
| Uka Rest | 28,141 | 81.55 → 85.84 | 0 → 930 |
| Uka Apology, 1 s | 24,606 | 90.18 → 94.91 | 0 → 1,442 |
| Gene Rest | 19,956 | 153.60 → 161.65 | 5,314 → 9,771 |
| Gene Apology, 1 s | 16,233 | 169.91 → 177.10 | 8,233 → 10,986 |

Foreground is the union of non-background pixels in the same pane, excluding
its scissor border. RGB statistics use encoded 8-bit display channels, not
linear irradiance; channel-255 counts indicate display clipping, not a measured
HDR value. The increase matches the documented full-strength authored ambient
correction. Gene's white clothing clips more visibly. No scene compensation or
cross-pane pixel-equality assertion was introduced; existing independent shading
and Outline differences remain visible.

Contact sheets use unchanged source models/textures and original motions:
CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1
Avatar Symbiotic Society; CG-CA Gene (c) 2023 by Nagoya Institute of Technology,
Moonshot R&D Goal 1 Avatar Symbiotic Society. These are posed renderer captures
for this technical comparison. See the [Uka notices/rights](uka.md#rights-and-acquisition)
and [Gene Light notices/rights](gene-light.md) for the source, CC BY 4.0 and
retained usage guidelines; no endorsement is implied.

## Validation and limits

The [machine-readable validation record](three-mmd-0.1.4-validation.json)
retains registry/tarball/installed-file hashes and actual local check results.
Clean install, public JavaScript imports, typecheck and build passed. `npm test`
passed the extension checks and all **189 Node tests**, with zero failures/skips.
All **589** local documentation/anchor/built-asset link checks passed. All four
existing browser shards ran locally, sequentially on one host: **118 cases,
116 passed, two optional native-WebGPU adapter-unavailable skips, zero failures
and zero retries**. The unchanged CI aggregation tool passed and verified every
unfiltered test ID exactly once; no suite/shard assignment or assertion changed
apart from the expected credit version and future IK evidence version label.

This includes Uka cold/warm canonical texture requests and decoded images;
missing/corrupt/aborted/unsafe resources and Retry; public Uka/Gene body motion,
three source-derived timelines and terminal movement on desktop/mobile;
Play/Pause/Restart/Loop/seek; IK/grants and sleeve behavior; lazy Ammo, independent
physics worlds, Gene Apology availability, backend failure/cancellation and
disposal; Toon/PBR/Outline; camera reset, touch and responsive layout; model
switching without unnecessary fetches/renderer allocation; and the hidden
BDEF/SDEF/QDEF, VMD/VPD/morph, normal, raster and export/reload conformance suites.
Typecheck and whitespace checks passed, including the final staged new files.

Hosted PR/main checks and Pages publication must
be verified downstream: this implementation node does not push, open a PR,
dispatch CI or merge. After an authorized merge, check required CI and Pages
for that exact SHA, load both published models and verify build provenance
against the 0.1.4 lockfile. Local production preview does not prove deployment.

SwiftShader and mobile viewport tests do not establish native GPU, native
WebGPU, physical Android or original Windows MMD behavior. No physical-device
or subjective human signoff is required by this upgrade.
