/** Original synthetic VMD byte fixtures by mmd-gltf contributors, Issue #29. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const japanese = Buffer.from([
  0x93, 0xaf, 0x96, 0xbc, 0x2e, 0x8d, 0x9c, 0x20, 0x5b, 0x64, 0x75, 0x70, 0x6c, 0x69, 0x63,
]);
export const motionMappings = {
  a: { [japanese.toString('hex')]: 0, [Buffer.from('tip_boundary_15').toString('hex')]: 259 },
  b: { [japanese.toString('hex')]: 259 },
};
export function syntheticVMD(motion: 'a' | 'b') {
  const chunks: Buffer[] = [];
  const bytes = (b: Uint8Array) => chunks.push(Buffer.from(b));
  const fixed = (b: string | Buffer, n: number) => {
    const out = Buffer.alloc(n);
    Buffer.from(b).copy(out, 0, 0, n);
    bytes(out);
  };
  const u8 = (v: number) => bytes(Buffer.from([v]));
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    bytes(b);
  };
  const f = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    bytes(b);
  };
  const floats = (v: number[]) => v.forEach(f);
  fixed('Vocaloid Motion Data 0002', 30);
  fixed('informational.pmx', 20);
  const curves = [
    [20, 5, 100, 120],
    [50, 100, 90, 10],
    [10, 110, 110, 30],
    [35, 0, 90, 127],
  ];
  const interpolation = Buffer.alloc(64);
  curves.forEach((c, j) =>
    c.forEach((v, k) => {
      interpolation[j + 4 * k] = v;
    }),
  );
  // Unused repeated-layout bytes are preserved exactly and do not drive execution.
  interpolation.fill(0xab, 16);
  const records: {
    name: string | Buffer;
    frame: number;
    t: number[];
    axis: number;
    angle: number;
    negative?: boolean;
  }[] = [];
  const add = (
    name: string | Buffer,
    axis: number,
    frames: number[],
    translations: number[][],
    angles: number[],
  ) =>
    frames.forEach((frame, i) =>
      records.push({ name, frame, t: translations[i], axis, angle: angles[i], negative: i === 1 }),
    );
  if (motion === 'a') {
    add(
      'bone 1',
      0,
      [6, 7, 30],
      [
        [0, 0, 0],
        [0.1, -0.1, 0.05],
        [0.25, -0.125, 0.5],
      ],
      [0, 0.2, 0.9],
    );
    add(
      japanese,
      1,
      [0, 30],
      [
        [0.1, 0, 0],
        [-0.125, 0.25, -0.1],
      ],
      [0.1, -0.7],
    );
    add(
      'tip_boundary_15',
      2,
      [3, 30],
      [
        [0, 0.1, 0],
        [0.125, -0.2, 0.25],
      ],
      [-0.2, 0.6],
    );
  } else {
    add(
      'bone 1',
      2,
      [4, 20, 40],
      [
        [-0.125, 0.1, 0.2],
        [0.2, 0, -0.1],
        [-0.25, 0.25, 0],
      ],
      [0.25, -0.8, 0.4],
    );
    add(
      'bone 2',
      1,
      [0, 40],
      [
        [0, 0, 0],
        [0.25, -0.125, 0.125],
      ],
      [-0.1, 0.7],
    );
    add(
      japanese,
      0,
      [8, 40],
      [
        [0.1, 0, 0],
        [-0.125, 0.1, 0.25],
      ],
      [0.3, -0.6],
    );
  }
  // Reverse record order deliberately; binding must sort each track.
  u32(records.length);
  for (const r of records.reverse()) {
    fixed(r.name, 15);
    u32(r.frame);
    floats(r.t);
    const q = [0, 0, 0, Math.cos(r.angle / 2)];
    q[r.axis] = Math.sin(r.angle / 2);
    floats(q.map((v) => (r.negative ? -v : v)));
    bytes(interpolation);
  }
  u32(1);
  fixed('unused morph', 15);
  u32(12);
  f(0.5);
  u32(1);
  u32(13);
  f(-30);
  floats([1, 2, 3]);
  floats([0.1, 0.2, 0.3]);
  bytes(Buffer.alloc(24, 20));
  u32(45);
  u8(1);
  u32(1);
  u32(14);
  floats([1, 0.5, 0.25]);
  floats([2, 3, 4]);
  u32(1);
  u32(15);
  u8(2);
  f(100);
  u32(1);
  u32(16);
  u8(1);
  u32(1);
  fixed('unused IK', 20);
  u8(0);
  return Buffer.concat(chunks);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const motion of ['a', 'b'] as const) {
    await writeFile(`tests/fixtures/motion-${motion}.vmd`, syntheticVMD(motion));
    await writeFile(
      `tests/fixtures/motion-${motion}-map.json`,
      JSON.stringify(motionMappings[motion], null, 2) + '\n',
    );
  }
}
