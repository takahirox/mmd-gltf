/** Original Issue #41 assets by mmd-gltf contributors; no third-party bytes. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syntheticPMX } from './synthetic-bdef';
import { syntheticVMD } from './synthetic-vmd';
export const groupMapping = { '8fce82a2': 1, '67726f7570': 0 }; // exact duplicate names
export function groupPMX(shape: 'box'|'wedge', mode: 'bdef'|'mixed-sdef'|'mixed-qdef' = 'bdef') {
  return syntheticPMX(mode, 'utf16le', false, shape, 'groups');
}
export function groupVMD(motion: 'a'|'b') {
  const original=syntheticVMD(motion), end=54+original.readUInt32LE(50)*111;
  const frames=motion==='a'?[0,15,30]:[0,20,45];
  const records:Buffer[]=[];
  for(const [name,values] of [
    [Buffer.from('8fce82a2','hex'),motion==='a'?[0,0.3,0.3]:[-0.2,0.6,0.1]],
    ['group',motion==='a'?[0.8,0.8,-0.4]:[1.2,-0.5,0.4]],
    ['shared',motion==='a'?[0,0.2,-0.1]:[0.3,0,0.7]],
  ] as const) frames.forEach((f,i)=>{
    const b=Buffer.alloc(23);Buffer.from(name).copy(b,0,0,15);b.writeUInt32LE(f,15);b.writeFloatLE(values[i],19);records.push(b);
  });
  const count=Buffer.alloc(4);count.writeUInt32LE(records.length);
  return Buffer.concat([original.subarray(0,end),count,...records.reverse(),original.subarray(end+27)]);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  for(const rig of ['box','wedge'] as const) await writeFile(`tests/fixtures/group-${rig}.pmx`,groupPMX(rig));
  for(const motion of ['a','b'] as const) await writeFile(`tests/fixtures/group-${motion}.vmd`,groupVMD(motion));
  await writeFile('tests/fixtures/group-map.json',JSON.stringify(groupMapping,null,2)+'\n');
}
