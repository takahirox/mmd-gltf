/** Original Issue #47 synthetic fixtures by mmd-gltf contributors.
 * Reuses the attributed box/wedge geometry and two motions; no third-party bytes. */
import { syntheticPMX } from './synthetic-bdef';
import { syntheticVMD } from './synthetic-vmd';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function boneMorphPMX(shape:'box'|'wedge', mode:'bdef'|'mixed-sdef'|'mixed-qdef'='bdef',only=false) {
  return syntheticPMX(mode,'utf16le',false,shape,only?'bones-only':'bones');
}
export const boneMorphValues={
  a:{'mixed':[0.8,-0.4,1.2],'vertex':[0,0.2,-0.1],'bone-x':[-0.2,0.6,0.3],'bone-y':[0,0.4,-0.3],'shared':[0.3,-0.1,0.2]},
  b:{'mixed':[-0.5,0.7,0.2],'vertex':[0.3,0,-0.2],'bone-x':[0.4,-0.3,0.8],'bone-y':[0.2,0.5,-0.1],'shared':[-0.4,0.2,0.1]},
};
export function boneMorphVMD(motion:'a'|'b',only=false) {
  const original=syntheticVMD(motion),end=54+original.readUInt32LE(50)*111;
  const records:Buffer[]=[],frames=motion==='a'?[0,15,30]:[0,20,45];
  for(const [name,values] of Object.entries(boneMorphValues[motion])) {
    if(only && name!=='bone-x' && name!=='bone-y')continue;
    frames.forEach((frame,i)=>{const b=Buffer.alloc(23);Buffer.from(name).copy(b);b.writeUInt32LE(frame,15);b.writeFloatLE(values[i],19);records.push(b);});
  }
  const header=Buffer.from(original.subarray(0,54));if(only)header.writeUInt32LE(0,50);
  const count=Buffer.alloc(4);count.writeUInt32LE(records.length);
  return Buffer.concat([header,...(only?[]:[original.subarray(54,end)]),count,...records.reverse(),original.subarray(end+27)]);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  for(const shape of ['box','wedge'] as const)await writeFile(`tests/fixtures/bone-morph-${shape}.pmx`,boneMorphPMX(shape));
  for(const motion of ['a','b'] as const)await writeFile(`tests/fixtures/bone-morph-${motion}.vmd`,boneMorphVMD(motion));
}
