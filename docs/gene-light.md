# Gene Light provenance and distribution review

Reviewed 2026-10-20 for Issue #7, before preparing a distributable static artifact.
Source: [mmdagent-ex/gene at c7eace43dffaccff6ad0597433ef85fa57c91e03](https://github.com/mmdagent-ex/gene/tree/c7eace43dffaccff6ad0597433ef85fa57c91e03).
The exact source allowlist, sizes, Git blob SHA-1s and SHA-256s are preserved in
[the acquisition manifest](../tools/gene-light-manifest.json), copied from
[three-mmd-loader's manifest](https://github.com/takahirox/three-mmd-loader/blob/main/scripts/gene-light-manifest.json).
Only `Gene_light.pmx`, its ten referenced `light/` PNGs, and the original English
and Japanese READMEs are acquired: 13 files, 6,384,644 bytes. Every cached or
newly downloaded file is hash-checked; a mismatch fails without overwriting it.
No archive, full Gene model, motions or unrelated textures are fetched.

The source [English notice](https://github.com/mmdagent-ex/gene/blob/c7eace43dffaccff6ad0597433ef85fa57c91e03/README.md#license)
and [Japanese notice](https://github.com/mmdagent-ex/gene/blob/c7eace43dffaccff6ad0597433ef85fa57c91e03/README.ja.md)
were read, including their license, usage guideline, disclaimer and contact
sections. They specify CC BY 4.0 for repository files, while retaining trademark
and design rights and permitting academic and personal noncommercial use.
Other commercial use requires contacting the authors; the Japanese notice also
requests contact for other uses outside the listed categories. Preserve the
full original guidelines against harmful, deceptive, rights-infringing and
unauthorized uses; do not infer unrestricted commercial permission or endorsement.

The [upstream rights review](https://github.com/takahirox/three-mmd-loader/blob/main/examples/gene-light.md)
records the [maintainer's personal noncommercial showcase scope](https://github.com/takahirox/three-mmd-loader/issues/57#issuecomment-6160526383).
Our proposed public artifact is another static technical demonstration in the
same maintainer's personal open-source repository. On that basis, this review
infers that its use fits the same published personal noncommercial category.
CC BY 4.0 permits attributed adaptation and redistribution with changes
identified. No new permission from the authors or broader use category is
asserted. Review again before changing the site's purpose or commercial scope.

Required attribution is displayed directly in the example and retained in the
GLB metadata:

> CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society

The build copies both original English/Japanese notices **byte-for-byte** beside
the GLB. It also copies the manifest and writes a conversion record containing
the generated GLB's SHA-256, size, pinned source commit, and conversion warnings.
The GLB embeds source provenance, attribution, rights, original PMX comments and
an adaptation notice. Changes: static PMX geometry/material conversion,
right-handed coordinates and meter scale, omitted animation/skin/morph/physics/
outline data, and a separate PBR approximation. Texture image bytes are unchanged.
The derivative remains subject to Gene's terms; neither model nor GLB is
relicensed as repository code. No MMD shared toon image bytes are distributed.

The generated GLB and notices may be served together in `dist/` for this reviewed
purpose. The original PMX and duplicate source PNGs are excluded from the static
artifact. Generated outputs and source downloads are ignored by Git. Hashes are
rechecked whenever the site is built, including in Pages CI.

Publication and its verification remain pending until merge/deployment. This
local distribution review does not claim that a public deployment has occurred.
