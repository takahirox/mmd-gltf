import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parsePMX, type PMXModel } from './pmx-to-gltf';
import { parseVMD, byteName, type VMD } from '../packages/mmd-vmd';
import uka from './uka-manifest.json';
import gene from './gene-light-manifest.json';

/** Exact name coverage and conservative binding eligibility are reported separately. */
export function auditMotion(model: PMXModel, motion: VMD) {
  function tracks(kind: 'bones' | 'morphs') {
    return [...new Map(motion[kind].map(r => [r.name.key, r.name])).values()].map(name => {
      const matches = model[kind].flatMap((entry, index) => entry.name === name.text ? [index] : []);
      const records = motion[kind].filter(r => r.name.key === name.key);
      const transforms = records.filter(r => 'translation' in r).map(r => 'translation' in r ? [...r.translation,...r.rotation] : []);
      const changing = transforms.some(t => {
        const first=transforms[0], q=t.slice(3), base=first.slice(3);
        const length=Math.hypot(...q), baseLength=Math.hypot(...base);
        const sign=q.reduce((n,v,i)=>n+v*base[i],0)<0?-1:1;
        return t.slice(0,3).some((v,i)=>Math.abs(v-first[i])>1e-6) ||
          q.some((v,i)=>Math.abs(v/length-sign*base[i]/baseLength)>1e-6);
      });
      const active = kind === 'morphs' ? records.some(r => 'weight' in r && r.weight !== 0)
        : records.some(r => 'translation' in r && (r.translation.some(v => v !== 0) || r.rotation.some((v,i) => v !== (i===3?1:0))));
      return { key: name.key, name: name.text, terminated: name.terminated, matches,
        status: matches.length > 1 ? 'ambiguous' : matches.length === 0 || !name.terminated ? 'unmatched' : 'matched',
        ...(kind === 'morphs' && matches.length === 1 ? { type: model.morphs[matches[0]].type } : {}), active,
        ...(kind === 'bones' ? {changing, records:records.length, keysAfterZero:records.filter(r=>r.frame>0).length, maxFrame:Math.max(...records.map(r=>r.frame))} : {}) };
    });
  }
  const bones=tracks('bones'),morphs=tracks('morphs');
  const coverage=Object.fromEntries(([['bones',bones],['morphs',morphs]] as const).map(([kind,values])=>[kind,{
    tracks:values.length, exactUnique:values.filter(t=>t.matches.length===1).length,
    missing:values.filter(t=>!t.matches.length).length, ambiguous:values.filter(t=>t.matches.length>1).length,
    terminatedBindings:values.filter(t=>t.status==='matched').length,
    fullWidthExact:values.filter(t=>t.matches.length===1 && !t.terminated).length,
  }]));
  return { coverage, modelName: motion.modelName.text, duration: Math.max(0,...[motion.bones,motion.morphs,motion.displays].flatMap(s=>s.map(r=>r.frame/30))),
    bones, morphs };
}

// Read-only upstream inventory. Only reviewed manifest entries are packaged by the build.
async function main() {
  const result: Record<string, unknown> = {};
  for (const [id,manifest,pmx] of [['uka',uka,'MS_Uka.pmx'],['gene-light',gene,'Gene_light.pmx']] as const) {
    const model=parsePMX(await readFile(`.cache/${id}/${pmx}`));
    const response=await fetch(`https://api.github.com/repos/${manifest.repository}/git/trees/${manifest.commit}?recursive=1`);
    if(!response.ok)throw new Error(`Upstream tree: ${response.status}`);
    const tree=await response.json() as {tree:{path:string;sha:string}[]};
    const motions=[];
    for(const entry of tree.tree.filter(e=>/^motion\/.*\.vmd$/.test(e.path))) {
      const url=`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${entry.path}`;
      const response=await fetch(url);if(!response.ok)throw new Error(`${url}: ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      await mkdir(`.cache/${id}/motion`,{recursive:true});await writeFile(`.cache/${id}/${entry.path}`,bytes);
      let motion: VMD, error: string | undefined;
      try { motion=parseVMD(bytes); } catch(e) {
        error=String(e);
        // Inventory names/frames even for files rejected by the strict execution reader.
        // This audit never normalizes or rewrites upstream motion bytes.
        let offset=50;
        const bones:VMD['bones']=[],morphs:VMD['morphs']=[];
        const boneCount=bytes.readUInt32LE(offset);offset+=4;
        for(let i=0;i<boneCount;i++,offset+=111)bones.push({name:byteName([...bytes.subarray(offset,offset+15)]),frame:bytes.readUInt32LE(offset+15),translation:[bytes.readFloatLE(offset+19),bytes.readFloatLE(offset+23),bytes.readFloatLE(offset+27)],rotation:[bytes.readFloatLE(offset+31),bytes.readFloatLE(offset+35),bytes.readFloatLE(offset+39),bytes.readFloatLE(offset+43)],interpolation:[],raw:[]});
        const morphCount=bytes.readUInt32LE(offset);offset+=4;
        for(let i=0;i<morphCount;i++,offset+=23)morphs.push({name:byteName([...bytes.subarray(offset,offset+15)]),frame:bytes.readUInt32LE(offset+15),weight:bytes.readFloatLE(offset+19),raw:[]});
        motion={header:[],modelName:byteName([...bytes.subarray(30,50)]),bones,morphs,cameras:[],lights:[],shadows:[],displays:[]};
      }
      motions.push({path:entry.path,blob:entry.sha,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),executionError:error,...auditMotion(model,motion)});
    }
    result[id]={repository:manifest.repository,commit:manifest.commit,model:pmx,motions};
    console.log(id,motions.length, motions.filter(m=>/0[134]_/.test(m.path)).map(m=>({path:m.path,size:m.size,sha256:m.sha256,bones:m.bones.filter(t=>t.status==='matched').length,morphs:m.morphs.filter(t=>t.status==='matched').length,activeMorphs:m.morphs.filter(t=>t.active)})));
  }
  for(const [id,value] of Object.entries(result)) {
    const group=value as {motions:{path:string;bones:ReturnType<typeof auditMotion>['bones'];morphs:ReturnType<typeof auditMotion>['morphs']}[]};
    for(const m of group.motions) {
      if(m.path===(id==='uka'?'motion/04_littlesmile.vmd':'motion/01_happy.vmd') || /\/(02_laugh|22_apology)\.vmd$/.test(m.path))continue;
      for(const kind of ['bones','morphs'] as const) {
        const tracks=m[kind];
        (m as any)[kind]=Object.fromEntries(['matched','unmatched','ambiguous'].map(status=>[status,tracks.filter(t=>t.status===status).map(t=>t.name)]));
      }
    }
  }
  await writeFile('docs/public-motion-audit.json',JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
