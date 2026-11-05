import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseVMD, vmdDuration, type VMD } from '../packages/mmd-vmd';
import { parsePMX, type PMXModel } from './pmx-to-gltf';
import { auditMotion } from './audit-public-motions';

/** Value changes, not last-key times. Equal endpoints cannot move under VMD's
 * linear morph / Bezier translation and shortest-path quaternion interpolation.
 * No visual epsilon: even tiny unequal values conservatively count as changes.
 * This is evidence, not a rule for trimming playback or settling physics. */
export function trackTail<T extends {frame:number}>(records: T[], value: (record:T)=>unknown) {
  const keys=[...records].sort((a,b)=>a.frame-b.frame);
  const values=keys.map(record=>JSON.stringify(value(record)));
  const changes=keys.flatMap((key,i)=>i && values[i]!==values[i-1]?[key.frame]:[]);
  let repeatedTerminalKeys=0;
  for(let i=keys.length-1;i>0 && values[i]===values[i-1];i--)repeatedTerminalKeys++;
  return {records:keys.length,maxFrame:keys.at(-1)?.frame??null,
    lastValueChangeFrame:changes.at(-1)??null,repeatedTerminalKeys,
    terminal:keys.slice(-3).map(record=>({frame:record.frame,value:value(record)}))};
}

export function auditTimeline(model: PMXModel, source: VMD) {
  const binding=auditMotion(model,source);
  const bones=[...new Set(source.bones.map(r=>r.name.key))].map(key=>{
    const track=binding.bones.find(t=>t.key===key)!;
    return {key,name:track.name,executed:track.status==='matched',binding:track.status,
      ...trackTail(source.bones.filter(r=>r.name.key===key),r=>{
        const length=Math.hypot(...r.rotation);
        // Canonicalize equivalent q/-q without discarding small actual rotations.
        const sign=[...r.rotation].reverse().find(v=>v!==0)!<0?-1:1;
        return {translation:r.translation,rotation:r.rotation.map(v=>v/length*sign)};
      })};
  });
  const morphs=[...new Set(source.morphs.map(r=>r.name.key))].map(key=>{
    const track=binding.morphs.find(t=>t.key===key)!;
    return {key,name:track.name,executed:track.status==='matched' && track.type===1,
      binding:track.status,type:track.type,
      ...trackTail(source.morphs.filter(r=>r.name.key===key),r=>r.weight)};
  });
  const scene={
    cameras:trackTail(source.cameras,r=>({distance:r.distance,position:r.position,rotation:r.rotation,fov:r.fov,perspective:r.perspective})),
    lights:trackTail(source.lights,r=>({color:r.color,position:r.position})),
    shadows:trackTail(source.shadows,r=>({mode:r.mode,distance:r.distance})),
    displays:trackTail(source.displays,r=>({visible:r.visible,ik:r.ik.map(k=>({key:k.name.key,enabled:k.enabled}))})),
  };
  function summary(tracks: (ReturnType<typeof trackTail> & {executed:boolean})[]) {
    const maximum=(values:(number|null)[])=>values.some(v=>v!==null)?Math.max(...values.filter((v):v is number=>v!==null)):null;
    return {tracks:tracks.length,records:tracks.reduce((n,t)=>n+t.records,0),
      maxFrame:maximum(tracks.map(t=>t.maxFrame)),lastValueChangeFrame:maximum(tracks.map(t=>t.lastValueChangeFrame)),
      lastExecutedValueChangeFrame:maximum(tracks.filter(t=>t.executed).map(t=>t.lastValueChangeFrame)),
      repeatedTerminalKeys:tracks.reduce((n,t)=>n+t.repeatedTerminalKeys,0)};
  }
  return {sourceDuration:vmdDuration(source),families:{bones:summary(bones),morphs:summary(morphs),...scene},
    bones,morphs};
}

async function main() {
  const clips=[];
  for(const [model,pmx,sample] of [['uka','MS_Uka.pmx','04_littlesmile'],['gene-light','Gene_light.pmx','01_happy']]) {
    const parsed=parsePMX(await readFile(`public/${model}/${pmx}`));
    for(const animation of [sample,'02_laugh','22_apology']) {
      const path=`public/${model}/motion/${animation}.vmd`,bytes=await readFile(path);
      const {bones,morphs,...summary}=auditTimeline(parsed,parseVMD(bytes));
      clips.push({model,animation,path,sha256:createHash('sha256').update(bytes).digest('hex'),...summary,
        changingBones:bones.filter(t=>t.lastValueChangeFrame!==null),
        changingMorphs:morphs.filter(t=>t.lastValueChangeFrame!==null)});
    }
  }
  await writeFile('docs/public-timeline-audit.json',JSON.stringify({
    policy:'Full source duration. Bone/vertex-morph value-change evidence does not trim held poses, scene keys, or physics settling. Camera/light/shadow and visibility remain retained without execution. Source IK switches govern applicable chains while UI IK is enabled.',clips,
  },null,2)+'\n');
  console.log(clips.map(c=>({model:c.model,animation:c.animation,duration:c.sourceDuration,bones:c.families.bones,morphs:c.families.morphs})));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
