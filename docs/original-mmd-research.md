# Original MMD material investigation (Issue #13)

**Research checkpoint complete; original-renderer verification pending post-merge.**
Research performed on 2026-10-21. No original MMD frame, measured pixel, saved
MMD scene, or D3D9 state trace has been obtained. No shading equation, schema
default, converter mapping, light adapter, or numerical expectation is changed
by this investigation. In particular, neither ambient coefficient 1 nor 0.5
has been established for the requested rendering path. Passing draft tests
does not establish either coefficient or original-MMD fidelity.

## Primary evidence collected

The author's [VPVP page](https://sites.google.com/view/vpvp/), section 1.4,
links the [Japanese x64 archive](https://drive.google.com/uc?export=download&id=1Iucxu0tDsD05Siyv8VBGgm9vjD-f-RhM).
The archive was downloaded directly from that link, without executing it.
These identifiers describe the inspected bytes, not an executed configuration:

| Item | Observation |
| --- | --- |
| Archive SHA-256 | `7edccd3a29fae3bfd217b2e75e526d13ac844828c7dbc927e959e3eecee29874` |
| Archive contents | 86 ZIP entries under `MikuMikuDance_v932x64/` |
| Executable | `MikuMikuDance.exe`, 1,722,368 bytes, PE machine `0x8664` (AMD64) |
| Executable SHA-256 | `07516fd3bf1e6b1339836b6773a156f61bdd6f848eeb621fdda012375df313a1` |
| Bundled readme | UTF-8 with BOM; identifies Ver.9.32 x64; version entry dated 2019/12/08 |
| Graphics API | Readme describes DirectX 9; executable import names include `d3d9.dll`, `d3dx9_43.dll`, and effect creation from resources |
| Shared resources | All ten `Data/toon01.bmp` through `toon10.bmp` are present; none is copied into this repository or the probes |

Two readable effect sources were found in the executable's PE resources, type
10 (RCDATA), language 1033. Offsets are **file offsets**, not virtual addresses;
hashes cover the complete resource bytes, before decoding CP932:

| Resource ID | Offset | Size | SHA-256 |
| --- | --- | --- | --- |
| 117 | `0x1947f8` | 28,656 | `4c85f35aefb4955d95d337b103580d98e7e7bda2216e878488a3e6b25d48be05` |
| 118 | `0x19b7e8` | 28,856 | `ea3f75e47dbb2143b2d1f55c75895ea89228e7a0dcc3c89d753d665749c76f85` |

Resource 117 declares shader-model-2 techniques and 118 shader-model-3
techniques. Both include `BufferShadow` and `DiffuseBufferShadow` families.
In 117, `BufferShadow_PS` computes a half-vector highlight from the normal,
negated `LightDir`, camera-relative direction and `SpcColor`; it adds the
highlight to `EgColor` outside the shadow-map region. `DiffuseBufferShadow_VS`
instead constructs a color from `EgColor` plus a componentwise nonnegative
product of `DifColor` and the normal/light dot product. Texture variants compose sampled colors and
the highlight. These are direct observations of embedded source, **not proof
that these shadow techniques execute with self-shadow disabled**.

The resources do not compute `EgColor`, `DifColor`, or `SpcColor` from PMX
material fields. Those uniforms are CPU inputs. Their names do not identify
an ambient multiplier, light-color mapping or arithmetic domain. Static source
also does not establish fixed-function texture stages or the active no-shadow
path. A bounded `objdump -d` inspection did not establish these mappings.
No sRGB state declarations were found in either resource; that absence does
not establish the states set by the application elsewhere.

The readme's historical Ver.6.18 entry describes replacing zero material
shininess with 0.1 to avoid black output on some PCs. This is a primary lead
against assuming the draft's zero-exponent policy is historical behavior.
Its application to 9.32's particular no-shadow path is still unverified.

Reproduce the archive/source inspection locally (downloaded materials remain
in ignored `.cache/`; do not commit or publish the executable or its resources):

```sh
mkdir -p .cache/mmd-research
curl --location --fail --max-time 60 \
  'https://drive.google.com/uc?export=download&id=1Iucxu0tDsD05Siyv8VBGgm9vjD-f-RhM' \
  -o .cache/mmd-research/official-download
python3 - <<'PY'
from pathlib import Path
import hashlib, zipfile
root = Path('.cache/mmd-research')
archive = (root / 'official-download').read_bytes()
assert hashlib.sha256(archive).hexdigest() == '7edccd3a29fae3bfd217b2e75e526d13ac844828c7dbc927e959e3eecee29874'
with zipfile.ZipFile(root / 'official-download') as z:
    prefix = 'MikuMikuDance_v932x64/'
    print(z.read(prefix + 'readme.txt').decode('utf-8-sig').splitlines()[0])
    exe = z.read(prefix + 'MikuMikuDance.exe')
assert hashlib.sha256(exe).hexdigest() == '07516fd3bf1e6b1339836b6773a156f61bdd6f848eeb621fdda012375df313a1'
for resource, offset, size in [(117, 0x1947f8, 28656), (118, 0x19b7e8, 28856)]:
    data = exe[offset:offset + size]
    print(resource, hashlib.sha256(data).hexdigest())
    (root / f'resource-{resource}.fx').write_text(data.decode('cp932'))
PY
```

The fixed offsets apply only to the hash-checked executable above. Review
`BufferShadow_PS`, `DiffuseBufferShadow_VS` and texture variants in the two
local files. No extracted source is presented as a redistributable fixture.

## Secondary reports and the ambient conflict

The following are evidence about those projects' implementations only. Saba and
nanoem links pin the revisions inspected through code search; the other
documents record their inspected file blob identifiers.

- [Babylon-mmd's material documentation](https://github.com/noname0310/babylon-mmd/blob/main/docs/docs/reference/loader/mmd-model-loader/mmd-standard-material/index.md)
  (inspected file blob `9c974ff329c73c50654df7b0ad616b6a814fdf39`)
  instructs using scene ambient RGB 0.5. It folds scene-scaled ambient into
  diffuse before light evaluation. The inspected document supplies no
  original-MMD capture, measured pixels or D3D state trace for that coefficient.
- Saba's [PMX material assignment](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/src/Saba/Model/MMD/PMXModel.cpp),
  [CPU uniform upload](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/viewer/Saba/GL/Model/MMD/GLMMDModelDrawer.cpp)
  and [fragment shader](https://github.com/benikabocha/saba/blob/29b8efa8b31c8e746f9a88020fb0ad9dcdcf3332/viewer/Saba/Viewer/resource/shader/mmd.frag)
  together show source ambient copied to the material, uploaded without a
  multiplier, and added separately from light-scaled diffuse before clamping.
  The inspected base/upload path supplies no hidden scene-ambient 0.5 factor.
- nanoem's [material initialization](https://github.com/hkrn/nanoem/blob/30acffaa29f5d2eb9e997d69418f2e4b97b5894f/emapp/src/model/Material.cc),
  [uniform upload](https://github.com/hkrn/nanoem/blob/30acffaa29f5d2eb9e997d69418f2e4b97b5894f/emapp/src/ModelProgramBundle.cc)
  and [model shader](https://github.com/hkrn/nanoem/blob/30acffaa29f5d2eb9e997d69418f2e4b97b5894f/emapp/resources/shaders/src/core/model_color.hlsl)
  similarly pass ambient without that multiplier in the inspected base path.
  Its shader performs the base clamp in the vertex stage and differs in
  toon/alpha composition. Neither project settles original MMD behavior.
- [three-mmd's shading notes](https://github.com/takahirox/three-mmd-loader/blob/main/docs/material-shading.md)
  (inspected blob `a865211474aeadb0e5510c52e40d5a47890b80d7`)
  explicitly describe an adaptation: decoded linear RGB, 0.5 ambient, Three
  light normalization, fallback toon and normalized specular. Consequently
  Gene Light's left pane cannot discriminate historical MMD equations.

These are different pipelines, not equivalent ambient expressions with a
demonstrated common output. Choosing the majority expression, or adjusting
until Gene Light matches three-mmd, would not resolve the conflict.

[Microsoft's D3D9 gamma documentation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/gamma)
describes separate texture-read and render-target-write sRGB controls, both
defaulting off, plus hardware-dependent filtering/blending behavior and a
presentation conversion option. API defaults are not evidence of MMD's actual
state. Both state inspection and pixel measurements are still required.

## Evidence matrix and scope audit

Every row below remains an open verification item. No new normative mathematical
assertion follows from this report. The current draft remains a proposal.

| Current draft rule / question | Original-MMD observation or lead | Required discrimination / reference | Confidence and limitation |
| --- | --- | --- | --- |
| `clamp(D*Lrgb+A)`, ambient coefficient, initial/final clamps | Embedded effects consume CPU colors; no PMX-to-uniform mapping established | Ambient-only sweeps under white, dim, colored and zero light; mixed D/A with dark texture | Unresolved; neither 1 nor 0.5 verified |
| Source-component RGB, encoded filtering and one final transfer | Effects have texture samples, no explicit sRGB declarations | Midgray factors/textures; actual sampler, write, blend, surface-format and presentation states | Unresolved; D3D9 defaults alone insufficient |
| No Lambert factor even when toon is absent | Separate constant-color and normal-dependent effect families exist | No-toon vs white-toon across controlled normals with shadows disabled; record selected path | Source families verified; active scope path unknown |
| One light, direction sign, RGB and intensity | Effects negate `LightDir`; CPU inputs unknown | Record UI RGB/direction, uploaded values and coordinate transforms | Partial source lead; defaults and mapping unobserved |
| Toon omission, `dot(N,L)+0.5`, top-down rows and filtering | No original no-shadow toon measurements | Colored custom ramp at nine dot products; absent vs white vs shared resource, if legally available | Unresolved; synthetic white is not a replacement shared toon |
| Half-vector specular, order, exponent zero and degenerate vector | Embedded half-vector highlight; historical zero-to-0.1 readme note | Zero/nonzero powers, oblique view/light, black base, colored toon/sphere, opposite light/view | Partial source lead; uniforms, active path and degeneracies unknown |
| Base then sphere/subtexture then toon then specular | Embedded texture variants are leads, not a complete no-shadow trace | Isolate each layer with asymmetric RGB/alpha and Additional UV1 | Unresolved for declared scope |
| Alpha multiplication, straight linear source-over, zero alpha, depth behavior | No original alpha/render-state observation | Material/texture alpha over black/white, overlapping layers; blend/depth/alpha-test states | Unresolved; glTF common-state choices are not verified MMD states |
| Normal transforms, back-face reversal, culling | Effects normalize normals; no actual sidedness trace | Front/back normal, reverse camera, single/double-sided geometry | Partial source lead; glTF rules do not prove original-MMD behavior |
| PBR independence, schema defaults, shared selectors | Repository tests establish draft/asset contracts | Retain those contracts unless a demonstrated mapping correction requires revision | Verified internally only, not historical rendering evidence |

## Reproducible probe inputs

Run the newly authored [probe generator](../tools/generate-mmd-probes.ts) after
`npm ci`:

```sh
npx tsx tools/generate-mmd-probes.ts
```

It writes 80 PMX/GLB pairs, six synthetic PNGs and `manifest.json` to ignored
`.cache/mmd-reference/`. It reparses every PMX, checks material factors and
selectors, and validates every converted GLB with the Khronos validator.
This validates input preparation, **not acceptance by MMD or rendered output**.
The generator and synthetic assets use no downloaded model or shared toon bytes;
they are newly authored repository material for redistribution with the probes.
Its UTF-16LE PMX uses a single static root and a 10-by-10 quad centered at
(0,10,0), facing -Z, with explicit normals and constant Additional UV1.
The converter reflects Z and winding; factors are preserved as float32.

The manifest records per-case material values, requested light RGB and unit
direction toward the light in PMX coordinates, texture rows/alpha, file hashes
and requested camera. `originalMMD` fields remain null and status is
`uncaptured`. There are no fabricated observations or expected-pixel fixtures.
Generated inputs cover ambient/light sweeps, no/white/colored toon versus
normal angle, texture colors, clamping, specular powers/angle, sphere modes,
material/texture alpha and normal/sidedness. To test actual back faces, capture
the single/double-sided probes again from the reverse camera. Overlapping
transparent surfaces, spatial sphere/subtexture UV patterns and shared-toon
sampling still need additional controlled captures; solid maps cannot establish
coordinate orientation or filtering.

## Capture request and blocker

The available runner reports Darwin ARM64. No `wine`, `wine64`,
`qemu-system-x86_64`, `prlctl` or `VBoxManage` command was found. The original
AMD64 Windows executable was not launched; no Windows desktop, D3D9 GPU session
or original-MMD remote execution tool is available in this node. Installing an
unverified compatibility renderer would not provide the requested Windows/D3D9
baseline. The archive is accessible; **execution and primary measurements are
the blocker**, not acquisition, dependency allowance or user approval.

To unblock, run the hash-identified original executable in a Windows/D3D9
environment, or supply equivalent first-hand state traces and controlled
captures from it. Return the following evidence with the probe inputs:

1. Actual executable hash, About version, Windows build, GPU/driver, D3D
   runtime/device type, render-target format, resolution and presentation mode.
   Record untouched startup light/camera/scene settings first; they are
   **unknown here**, not the probe manifest's requested settings. Save the
   startup and controlled PMM scenes and all modified light keyframes.
2. Use a clean MMD distribution without MME or injected effects. Disable
   self/ground shadows, outlines, physics, antialiasing and scene overlays;
   record actual menu settings and material flags. View the quad interior from
   the manifest's requested camera, with no selected-bone overlays. Match each
   requested light, recording the actual UI values and the mapping to PMX
   direction/RGB. Do not assume the browser demo light is MMD's default.
3. Save unscaled lossless rendered frames, preferably backbuffer readback plus
   MMD image export to cross-check export/presentation transfer. Preserve
   original bytes and hashes. Record pixel dimensions, export method, PNG
   gamma/ICC metadata, display/HDR/OS color management and all capture settings.
   Do not use JPEG, resized screenshots or display-picked colors as an oracle.
4. Record interior sample coordinates (origin top-left), raw RGB(A) bytes and
   a small interior region's min/max values. Avoid edges, triangle seams and
   any selection overlay. Repeat each capture to measure variability. Capture
   material/texture alpha against both black and white; capture overlapping
   layers separately to inspect ordering/depth behavior.
5. Where feasible, trace the active no-shadow draw's shaders/fixed-function
   stages, PMX-derived material/uniform values, light state,
   `D3DSAMP_SRGBTEXTURE`, `D3DRS_SRGBWRITEENABLE`, blend factors/operations,
   depth-write/test and alpha-test states, texture/surface formats, sampler
   addressing/filtering, and presentation flags. Trace rather than substitute
   shader code; compare uninstrumented and instrumented frames.

Useful **hypothesis discriminators**, not measured expectations: with D=P=0,
A=0.25, no textures and white light, source-component ambient coefficients
1 and 0.5 predict about 64 and 32 in an 8-bit channel. Encoding raw linear
0.25 predicts about 137; decoding 0.25 first, halving it, and re-encoding
predicts about 44. Light-color sweeps distinguish ambient inside/outside the
light product. With final encoded RGB 0.5 and alpha 0.5 over black, encoded
blending predicts about 64 versus about 92 for decode/blend/encode. Colored
ramps and quarter-angle normals distinguish toon coordinate slopes.

Choose tolerances only after measuring repeated original-MMD captures and
quantization; 1–2 channel steps may be an initial diagnostic budget for flat
8-bit interiors, not a validated acceptance threshold. The existing 1e-6 CPU,
2e-6 GPU float and 2/255 canvas draft tolerances cannot establish MMD accuracy.
Preserve observations independently of the plugin, then add GPU comparisons
and change each demonstrated rule with an evidence-matrix entry. Revisit all
rows, including alpha/color transfer, before claiming corrected fidelity.

## Completion and follow-up

Research, input preparation and explicit fidelity-status corrections are
complete for this checkpoint. Its agent-verifiable pre-merge acceptance covers
the primary/secondary evidence distinction and provenance, the scope audit,
reproducible validated probe inputs with uncaptured observations, and applicable
automated checks in the [validation record](validation.md).

Per [Issue #13's verification follow-up](https://github.com/takahirox/mmd-gltf/issues/13#issuecomment-6307160015),
manual original-MMD execution, captures, measurements and state observations
described in the [capture protocol](#capture-request-and-blocker) are pending
post-merge verification. They are not Issue completion criteria or a merge gate
for this research checkpoint. The absence of these observations still limits
what can be claimed about fidelity; deferral supplies no evidence for an
ambient coefficient or any other equation.

Evidence-dependent normative corrections, independent measured fixtures and
corresponding plugin/converter/adapter changes and GPU comparisons remain
implementation work once primary observations support them. This checkpoint
does not implement those corrections or complete Issue #13; keep the Issue
open for that remaining implementation. Existing Gene Light captures remain
secondary diagnostics, as recorded in the [comparison](comparison.md).
Deployed-commit/workflow and public-example verification also remain pending
post-merge work; no publication was attempted during this investigation.
