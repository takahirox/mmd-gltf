/** Original synthetic geometry authored for Issue #25 by mmd-gltf contributors.
 * No third-party model, texture, pose or motion bytes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function syntheticPMX(mode: 'bdef' | 'sdef' | 'qdef' = 'bdef') {
  const chunks: Buffer[] = [];
  const u8 = (v: number) => chunks.push(Buffer.from([v & 255]));
  const i16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); chunks.push(b); };
  const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); chunks.push(b); };
  const f32 = (v: number) => { const b = Buffer.alloc(4); b.writeFloatLE(v); chunks.push(b); };
  const floats = (values: number[]) => values.forEach(f32);
  const str = (v: string) => { const b = Buffer.from(v, 'utf16le'); i32(b.length); chunks.push(b); };
  chunks.push(Buffer.from('PMX ')); f32(mode === 'qdef' ? 2.1 : 2); u8(8);
  [0, 0, 1, 1, 1, 2, 1, 1].forEach(u8);
  ['Synthetic BDEF conformance', 'Synthetic BDEF conformance',
    'Original synthetic fixture by mmd-gltf contributors; no third-party assets. No original-MMD equivalence claim.', 'Issue #25'].forEach(str);
  // Six independent quad faces, outward winding in source left-handed coordinates.
  const faces = [
    { n: [0, 0, -1], p: [[0, 0, 1], [0, 2, 1], [2, 2, 1], [2, 0, 1]] },
    { n: [0, 0, 1], p: [[2, 0, 3], [2, 2, 3], [0, 2, 3], [0, 0, 3]] },
    { n: [-1, 0, 0], p: [[0, 0, 3], [0, 2, 3], [0, 2, 1], [0, 0, 1]] },
    { n: [1, 0, 0], p: [[2, 0, 1], [2, 2, 1], [2, 2, 3], [2, 0, 3]] },
    { n: [0, 1, 0], p: [[0, 2, 1], [0, 2, 3], [2, 2, 3], [2, 2, 1]] },
    { n: [0, -1, 0], p: [[0, 0, 3], [0, 0, 1], [2, 0, 1], [2, 0, 3]] },
  ];
  i32(24);
  for (const face of faces) face.p.forEach((p, i) => {
    floats(p); floats(face.n); floats([i & 1, i >> 1]);
    const type = mode === 'sdef' ? 3 : mode === 'qdef' ? 4 : [0, 1, 2, 2][i];
    u8(type);
    if (type === 0) i16(259);
    else if (type === 1 || type === 3) { [0, 2].forEach(i16); f32(0.25); }
    else if (i === 3) { [259, 259, -1, 2].forEach(i16); floats([0.25, 0.5, 0, 0.25]); }
    else { [0, 1, 2, 259].forEach(i16); floats([0.1, 0.2, 0.3, 0.4]); }
    if (type === 3) floats([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    f32(1);
  });
  i32(36);
  for (let f = 0; f < 6; f++) [0, 1, 2, 0, 2, 3].forEach(i => u8(f * 4 + i));
  i32(0); // textures
  i32(2);
  for (let m = 0; m < 2; m++) {
    str(`Synthetic material ${m}`); str(`Synthetic material ${m}`);
    floats(m ? [0.2, 0.7, 0.9, 1] : [0.9, 0.5, 0.15, 1]);
    floats([0, 0, 0]); f32(1); floats([0.1, 0.1, 0.1]);
    u8(0x10); floats([0, 0, 0, 1]); f32(3);
    u8(-1); u8(-1); u8(0); u8(0); u8(-1); str('Original synthetic material'); i32(18);
  }
  i32(260);
  for (let i = 0; i < 260; i++) {
    str(i === 0 || i === 259 ? '同名.骨 [duplicate]' : `bone ${i}`);
    str(i === 0 || i === 259 ? 'Exact English. [duplicate]' : `English ${i}`);
    floats(i === 0 ? [1, 1, 2] : i === 259 ? [1, 2, 2] : i === 1 ? [1, 0, 2] : [-1, 0, 1]);
    i16(i === 0 ? 1 : i === 1 || i === 2 ? -1 : i === 259 ? 0 : 2);
    i32(i % 3); i16(0); floats([7, 3, 2]); // arbitrary display tail is NOT a rest rotation
  }
  i32(0); i32(0); i32(0); i32(0); // morphs, display frames, bodies, joints
  if (mode === 'qdef') i32(0); // PMX 2.1 soft bodies
  return Buffer.concat(chunks);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await mkdir('tests/fixtures', { recursive: true });
  for (const mode of ['bdef', 'sdef', 'qdef'] as const) await writeFile(`tests/fixtures/${mode}.pmx`, syntheticPMX(mode));
}
