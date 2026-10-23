# Synthetic PMX skinning fixtures

These binary PMX inputs were newly authored for Issue #25 by mmd-gltf
contributors using [the deterministic generator](../../tools/synthetic-bdef.ts).
They contain original synthetic cube geometry and rig data, no third-party
model, image, shared-toon, motion or pose bytes. Attribution is also embedded in
the PMX comment and the demo's GLB extras and conversion record.

Regenerate from the repository root with `npx tsx tools/synthetic-bdef.ts`.
The unit suite checks every committed binary against the generator.

- `bdef.pmx`: UTF-16LE PMX 2.0, 24 face-normal vertices, 12 triangles, two materials,
  BDEF1/2/4, mixed and repeated influences, inactive `-1` padding, and 260 bones.
  Bone 0 has forward parent 1; bones 1 and 2 are roots; bone 259 is a child of 0.
  The other bones are retained despite being unweighted. Bones 0 and 259 share
  exact Japanese and English names with punctuation that GLTFLoader changes.
  Bone positions are nonzero and arbitrary tail offsets must not create rest
  rotations. The converter applies a 0.5 scale for the demo and numerical oracle.
- `bdef-utf8.pmx`: UTF-8 PMX 2.0 with the same geometry and hierarchy, plus
  an unused texture path, all optional bone fields and PMX 2.0 morph record
  layouts, a display frame, rigid body and joint. These extra records exercise
  text transcoding only; their solver/evaluation semantics remain unsupported.
  Names cover odd/even UTF-8 byte lengths, duplicate Japanese/English strings,
  supplementary Unicode, a leading U+FEFF and a combining character. Tests compare
  transcoded bytes against a generated UTF-16LE counterpart, check exact names
  through GLB/glTF reload and pinned GLTFLoader, and reject malformed UTF-8.
- `sdef.pmx`: the same geometry/rig with 24 SDEF vertices. Static conversion
  remains supported with loss reporting; BDEF conversion must reject it and
  identify affected vertices.
- `qdef.pmx`: binary PMX 2.1 with QDEF records. Pinned mmd-parser rejects its
  version header before vertex parsing; the regression also changes only that
  header to 2.0 to exercise the parser's unsupported type-4 error. Neither path
  is accepted or approximated.

[Unit tests](../bdef.test.ts) parse the binary, convert, validate and reload both
GLB and unpacked glTF, checking every bone identity and parent, all rest vertices,
and an analytic 90-degree Z rotation plus three local translations. Maximum
absolute position tolerance is `2e-6` meters: FLOAT weights and inverse binds
introduce small rounding, while this sub-meter pose avoids long rotation chains.
The expected positions use explicit scalar formulas, independent of emitted
inverse binds and joint matrices. Malformed model regressions cover cycles,
parents, non-finite positions, influence counts, active references, weights,
zero totals and materially non-unit sums. A roundoff adjustment is checked
separately. Weight-sum acceptance uses `1e-6`, not the position-test tolerance.

[Browser measurements](../bdef-gpu.ts) load the actual converter output through
the lockfile's GLTFLoader with active Toon and core PBR, then compare surface and
outline rasterizations against independently baked analytic geometry. The baked
surface uses Three.js's weighted normal matrix behavior; the baked outline uses
the draft's inverse transpose. These are deliberately distinct. Rest, deformed
and reset states run for each material path. Position tolerance is `2e-6`; pixel
comparison permits two encoded levels and at most 0.5% boundary pixels for
independent FLOAT raster rounding. Reset must exactly match rest. Existing raw
weight and multiple-influence-set outline coverage remains unchanged.
