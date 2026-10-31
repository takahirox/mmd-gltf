import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePMX } from './pmx-to-gltf';
import manifest from './gene-light-manifest.json';

const bytes=await readFile('.cache/gene-light/Gene_light.pmx');
const pinned=manifest.files.find(f=>f.path==='Gene_light.pmx')!;
if(bytes.length!==pinned.size || createHash('sha256').update(bytes).digest('hex')!==pinned.sha256)throw new Error('Gene source integrity mismatch');
const model=parsePMX(bytes),bones=model.bones;
const ancestry=(index:number)=>{const a:number[]=[];while(bones[index] && !a.includes(index)){a.push(index);index=bones[index].parentIndex;}return a;};
const ordered=(a:number,b:number)=>((bones[a].flag??0)&0x1000)-((bones[b].flag??0)&0x1000)||
  (bones[a].transformationClass??0)-(bones[b].transformationClass??0)||a-b;
const label=(index:number)=>({index,name:bones[index].name});
const rest=(index:number)=>({translationPMX:bones[index].position.map((v,k)=>v-(bones[bones[index].parentIndex]?.position[k]??0)),
  translationMetres:bones[index].position.map((v,k)=>(v-(bones[bones[index].parentIndex]?.position[k]??0))*.08),quaternion:[0,0,0,1]});
const controllers=bones.flatMap((b,i)=>b.ik?[i]:[]).sort(ordered).map(index=>{
  const ik=bones[index].ik!,dependencies=new Set([index,ik.effector,...ik.links.map(l=>l.index)].flatMap(ancestry));
  for(const i of dependencies)if(bones[i].grant)for(const s of bones[i].grant!.isLocal?ancestry(bones[i].grant!.parentIndex):[bones[i].grant!.parentIndex])dependencies.add(s);
  return {...label(index),phase:(bones[index].flag??0)&0x1000?'postPhysics':'prePhysics',layer:bones[index].transformationClass,
    effector:label(ik.effector),links:ik.links.map(l=>label(l.index)),dependencies:[...dependencies].sort((a,b)=>a-b).map(label),
    requiredGrants:[...dependencies].filter(i=>bones[i].grant).sort(ordered)};
});
const grants=bones.flatMap((b,index)=>{
  if(!b.grant)return [];
  const g=b.grant,reads=g.isLocal?ancestry(g.parentIndex):[g.parentIndex];
  return [{destination:label(index),source:label(g.parentIndex),flags:b.flag,flagsHex:`0x${b.flag!.toString(16)}`,
    space:g.isLocal?'local (accumulated model space)':'ordinary/global (source bone-local pose)',rotation:g.affectRotation,translation:g.affectPosition,rate:g.ratio,
    phase:(b.flag??0)&0x1000?'postPhysics':'prePhysics',layer:b.transformationClass,
    ...(controllers.some(c=>c.requiredGrants.includes(index))?{destinationRest:rest(index),sourceRest:rest(g.parentIndex),destinationAncestry:ancestry(index).map(label),sourceAncestry:ancestry(g.parentIndex).map(label),
    sourceGrantInfluences:reads.filter(i=>bones[i].grant).map(label),
    sourceIKInfluences:controllers.filter(c=>bones[c.index].ik!.links.some(l=>reads.includes(l.index))).map(c=>label(c.index))}:{}),
    requiredByControllers:controllers.filter(c=>c.requiredGrants.includes(index)).map(c=>c.index)}];
});
await writeFile('docs/gene-grant-audit.json',JSON.stringify({issue:71,source:{repository:manifest.repository,commit:manifest.commit,sha256:pinned.sha256},
  coordinates:'mmd-parser right handed; Z position reflected; PMX bind local quaternion identity; PMX local axes do not rotate the rest skeleton',
  policy:'IK On executes only dependency-closure grants in phase/layer/source-index order, grant before IK at a shared index. IK Off restores raw authored TRS. No simulation between phases.',
  schedule:[{kind:'grant',index:35,phase:'prePhysics',layer:0},...controllers.map(c=>({kind:'ik',index:c.index,phase:c.phase,layer:c.layer}))],
  controllers,grants},null,2)+'\n');
console.log(`Audited ${grants.length} Gene grants and ${controllers.length} controllers; only grant 35 is in the IK closure.`);
