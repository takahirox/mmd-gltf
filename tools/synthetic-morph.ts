/** Original synthetic Issue #31 variants. The original Issue #25/#29 bytes are unchanged. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syntheticPMX } from './synthetic-bdef';
import { syntheticVMD } from './synthetic-vmd';
export const morphMapping = { '8fce82a2': 1 }; // Shift_JIS 笑い; duplicate source name explicitly resolved.
export function morphPMX(shape: 'box' | 'wedge') {
  return syntheticPMX('bdef', 'utf16le', false, shape, true);
}
export function morphVMD(motion: 'a' | 'b', only = false) {
  const original = syntheticVMD(motion), boneCount = original.readUInt32LE(50);
  const end = 54 + boneCount * 111;
  const records: Buffer[] = [];
  const add = (name: Buffer | string, frames: number[], values: number[]) => {
    frames.forEach((frame,i) => {
      const b = Buffer.alloc(23); Buffer.from(name).copy(b,0,0,15);
      b.writeUInt32LE(frame,15); b.writeFloatLE(values[i],19); records.push(b);
    });
  };
  add(Buffer.from('8fce82a2', 'hex'), motion === 'a' ? [6,15,30] : [3,20,45], motion === 'a' ? [0,0.9,1.3] : [0.7,1.2,-0.2]);
  add('overlap', motion === 'a' ? [4] : [0,40], motion === 'a' ? [0.65] : [0.4,0.9]);
  const count = Buffer.alloc(4); count.writeUInt32LE(records.length);
  return Buffer.concat([only ? Buffer.concat([original.subarray(0,50), Buffer.alloc(4)]) : original.subarray(0,end),
    count, ...records.reverse(), original.subarray(end + 4 + 23)]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const shape of ['box', 'wedge'] as const) await writeFile(`tests/fixtures/morph-${shape}.pmx`, morphPMX(shape));
  for (const motion of ['a','b'] as const) await writeFile(`tests/fixtures/combined-${motion}.vmd`, morphVMD(motion));
  await writeFile('tests/fixtures/morph-only.vmd', morphVMD('a', true));
  await writeFile('tests/fixtures/morph-map.json', JSON.stringify(morphMapping, null, 2) + '\n');
}
