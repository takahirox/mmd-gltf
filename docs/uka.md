# Uka integration example (Issue #52)

Uka is the default unified demo; Gene Light remains selectable for its distinct
static material comparison. The synthetic fixtures remain available for bounded
feature experiments and independent mathematical/GPU conformance checks.

## Rights and acquisition

Source: [mmdagent-ex/uka at 659f0d1a740fec68bb2817dc9c694a35e7a15f12](https://github.com/mmdagent-ex/uka/tree/659f0d1a740fec68bb2817dc9c694a35e7a15f12).
The [English notice and usage guidelines](https://github.com/mmdagent-ex/uka/blob/659f0d1a740fec68bb2817dc9c694a35e7a15f12/README.md)
and [original Japanese notice and guidelines](https://github.com/mmdagent-ex/uka/blob/659f0d1a740fec68bb2817dc9c694a35e7a15f12/README.ja.md)
were both reviewed for this public converter demonstration, automated CI,
verified caching, and redistribution through Pages. Both license repository files
under **CC BY 4.0**, permit modification, and request this exact credit:

> CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society

This is not CC0. The full original notices, including all guidelines and the
derivative-work disclaimer, are preserved byte-for-byte in the verified cache and
published output. They prohibit harmful/exploitative/hateful uses, dangerous
activities, deception, infringement, and harmful conduct toward the MMD community.
This attributed technical demonstration, CI, and cache do not imply endorsement,
change those guidelines, or authorize unrelated uses. Model assets retain their
own terms separately from repository code. The license is linked in the visible
credits and generated glTF includes attribution, source, hashes, notices and a
change record; `conversion.json` records the same derivative-use information.

[The allowlist](../tools/uka-manifest.json) pins exact sizes and SHA-256 for the
PMX, nine referenced PNGs, one selected VMD and both notices. `fetchUka()` follows
the Gene workflow: download missing allowlisted files only, verify every cached
or fetched byte, fail on a mismatch or missing HTTP resource. No whole-repository
archive, implicit texture fallback, additional motions, PMD, or unused `hair.png`
is downloaded. Changing upstream content requires a deliberate manifest review.
The Japanese notice says guidelines may change: review upstream notices again
before changing the pin or reusing these assets in another context.

## Actual source inventory and supported subset

[Machine-readable inventory](uka-inventory.json) is regenerated from the actual
PMX and selected VMD by [the inventory function](../tools/uka-inventory.ts), then
compared in a Node regression test. README counts differ from the pinned PMX; they are not converter support
evidence.

| Actual pinned PMX | Count / handling |
| --- | --- |
| Vertices / triangles / materials | 49,955 / 77,909 / 13 |
| Textures | 9, all referenced by materials; no sphere/shared toon texture resources |
| BDEF1 / BDEF2 | 21,434 / 28,521; normal core BDEF skin conversion |
| BDEF4 / SDEF / QDEF | 0 / 0 / 0; Uka does not test these types |
| Bones / IK chains / append grants | 302 / 10 / 2; hierarchy retained, solver execution disabled |
| Vertex / group / bone / material morphs | 184 / 20 / 7 / 5 |
| Retained morph data | 203 POSITION targets (184 vertex + 19 groups), seven bone controls |
| Unsupported morphs | Material indices 126, 127, 128, 148, 214; group 215 depends on material 214 |
| Rigid bodies / joints | 164 / 151; inventoried, omitted from execution |

The normal `convertModel(parsePMX(originalBytes), directory, {mode:'bdef'})`
converts the unmodified model. There is no special Uka converter or relabelled
source data. The converter reports omitted morph families and omitted solver,
physics, shadow and other behavior in its normal warnings. Bone morphs are
retained as metadata/control data, but this example does not execute them.
Authored normals remain unchanged during vertex morphing; no normal morphs or
recomputation are claimed.

Both `solver:'pre-physics-v1'` and `physics:'rigid-body-v1'` fail at
`MMD_skeleton_solver bones[9]: invalid IK caps/count`. Its source maximum IK angle
is approximately 4 radians, outside the bounded profile; the demo does not clamp
it or alter the general contract. The source includes additional solver records
and fixed/local axes detailed in the inventory. No Uka SDEF, QDEF, IK, append,
physics, or full MMD animation support is claimed.

Selected `motion/03_smile.vmd` has 224 bone keys, 344 morph keys, no camera,
light or shadow keys, and one display/IK record. Its informational model name is
`ジェネ / Gene`. The inventory records every distinct track byte key and exact
name matches, including truncated and unmatched names. No duplicate exact source-name matches
were found. It is fetched
and inventoried, **not played or silently partially bound**. Manual `まばたき`
(source morph 11) and `笑い` (12) are meaningful supported vertex deformation
scenarios without inventing motion/solver support. Both views use the same
weights, camera, scale and directional light. The PMX pane uses Three.js
`MMDLoader`, not the original MikuMikuDance renderer; visual and physical
original-MMD fidelity remains unmeasured.

## Generated output and resource cost

`npm run build` runs the normal pipeline and writes `public/uka/model.gltf` and
`model.bin`, plus the allowlisted source files, manifest, inventory and conversion
record. The glTF references the exact original `tex/` files shared with PMX, so
there is one published copy of each texture. A GLB would embed another copy of
the approximately 72.6 MB of required textures; external glTF avoids that cost.
All 203 supported POSITION targets remain downloadable. Standard lossless sparse
accessors reduce the binary geometry from about 125 MB dense to 5.12 MB by omitting
zero deltas; no target data is discarded. This is ordinary glTF serialization
after normal conversion, with no change to the general conversion contract.

The source allowlist is about 77 MB; generated Uka output is about 83.3 MB decimal
(79.4 MiB), adding no binary files to Git checkout. The approximately 85 MB entire
upstream texture directory is not fetched. The demo retains only blink/smile
attributes for GPU upload and resizes preview textures to at most 1024 px on
**both** views. This explicit preview adaptation changes sampling detail, not
source bytes, download integrity or source model conversion. It avoids allocating
203 full-model morph layers for every rendered primitive. It does not remove
source images from the first-load network cost: the complete sparse converter
geometry and selected source images still download. Static hosting can cache the exact assets; repeat visits
and the Actions source cache avoid unnecessary transfers. Switching between Uka
and Gene disposes the previous comparison renderer before loading the next;
inactive rig rendering remains suspended. Gene’s static preview does not upload
its 180 unused zero-weight morph buffers; its downloadable conversion and
geometry/material appearance remain unchanged.

The workflow uses the existing public Ubuntu 24.04 runner and one Playwright
worker. Both source caches are keyed by pinned manifests and reverified before
use. Generated output remains ignored and reproducible. Pages receives the
existing demo plus the above Uka files; there is no paid runner requirement.

## Validation and browser coverage

The Uka Node integration test verifies the source inventory, rejected optional
profiles, complete allowlist, exact shared image bytes, provenance, deterministic
reconversion, independently decoded sparse blink/smile deltas, and glTF Validator core validity with external resources resolved.
Browser tests require actual source PMX, converted glTF, buffer and textures to
load; visible character pixels; matching base bounds/cameras; independent visible
blink/smile changes in both panes; Toon/PBR and Outline changes/restoration;
mobile fit; comparison replacement/disposal; and missing-texture failure/retry.
A single selected smile image is attached. Failure screenshots are automatic.
Unsupported optional native WebGPU remains explicitly skipped when unavailable.

See [browser coverage and measurements](uka-validation.md) for the matrix audit,
full suite result, timing context and pending deployment verification.
