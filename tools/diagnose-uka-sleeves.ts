/** Reproducible source-weight and raw/isolated-IK measurements. No source mutation. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Bone, Skeleton, SkinnedMesh, BufferGeometry, MeshBasicMaterial, Vector3, Matrix4 } from 'three';
import { parsePMX } from './pmx-to-gltf';
import { fetchUka } from './fetch-uka';
import { parseVMD, bindMotion, evaluateMotion } from '../packages/mmd-vmd';
import { sleeveIK, sleeveNames } from '../examples/sleeve-ik';
import type { RestBone } from '../packages/mmd-vpd';
export async function diagnoseUkaSleeves() {
const directory=await fetchUka(), bytes=await readFile(`${directory}/MS_Uka.pmx`), model=parsePMX(bytes);
const rest:RestBone[]=model.bones.map((b,index)=>({index,name:b.name,parentIndex:b.parentIndex,
  translation:b.position.map((v,k)=>(v-(model.bones[b.parentIndex]?.position[k]??0))*.08) as [number,number,number],
  rotation:[0,0,0,1],scale:[1,1,1]}));
const bones=rest.map(b=>{const bone=new Bone();bone.name=b.name;bone.position.fromArray(b.translation);return bone;});
const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
rest.forEach((b,i)=>(b.parentIndex<0?mesh:bones[b.parentIndex]).add(bones[i]));
mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(bones));
const source=model.bones.map((b,index)=>({index,name:b.name,flags:b.flag,layer:b.transformationClass,ik:b.ik}));
const operation=sleeveIK(mesh,source,true);
const controllers=operation.controllers;
const sleeveIndices=model.bones.flatMap((b,i)=>/袖/.test(b.name) && !b.ik?[i]:[]);
const ancestry=(i:number):number[]=>i<0?[]:[i,...ancestry(model.bones[i].parentIndex)];
const influences=sleeveIndices.map(index=>{
  const vertices=model.vertices.flatMap((v,i)=>{const weight=v.skinIndices?.reduce((n,b,k)=>n+(b===index?v.skinWeights![k]:0),0)??0;return weight>0?[{index:i,weight}]:[];});
  const strongest=vertices.reduce((a,b)=>b.weight>a.weight?b:a,{index:-1,weight:0});
  return {index,name:model.bones[index].name,chain:ancestry(index),vertices:vertices.length,
    weightRange:vertices.length?[Math.min(...vertices.map(v=>v.weight)),Math.max(...vertices.map(v=>v.weight))]:[],
    example:strongest.index<0?null:{...strongest,influences:model.vertices[strongest.index].skinIndices!.map((bone,k)=>({bone,weight:model.vertices[strongest.index].skinWeights![k]})).filter(v=>v.weight>0)}};
});
const samples=[];
const world=(i:number)=>bones[i].getWorldPosition(new Vector3()).toArray();
const skinVertex=(index:number)=>{
  const vertex=model.vertices[index],position=new Vector3().fromArray(vertex.position).multiplyScalar(.08),result=new Vector3();
  vertex.skinIndices!.forEach((i,k)=>{
    const weight=vertex.skinWeights![k];if(!weight)return;
    const matrix=new Matrix4().multiplyMatrices(bones[i].matrixWorld,mesh.skeleton.boneInverses[i]);
    result.addScaledVector(position.clone().applyMatrix4(matrix),weight);
  });return result.toArray();
};
for(const id of ['02_laugh','22_apology']) {
  const vmdBytes=await readFile(`${directory}/motion/${id}.vmd`),vmd=parseVMD(vmdBytes);
  const binding=bindMotion({version:1,modelId:'source-diagnostic',metersPerPMXUnit:.08,bones:rest},vmd,{preserveUnbound:true});
  for(const frame of [0,15,id==='02_laugh'?120:50,300]) {
    const raw=evaluateMotion(binding,frame/30);
    raw.forEach(b=>{bones[b.index].position.fromArray(b.translation);bones[b.index].quaternion.fromArray(b.rotation);});mesh.updateMatrixWorld(true);
    const read=()=>({
      residuals:controllers.map(index=>({controller:index,metres:Math.hypot(...world(index).map((v,k)=>v-world(model.bones[index].ik!.effector)[k]))})),
      joints:[50,51,52,53,54,55,57,58,59,60,61,62,63,84,85,86,87,88,89,91,92,93,94,95,96,97].map(index=>({index,world:world(index),rotation:bones[index].quaternion.toArray()})),
      vertices:influences.filter(v=>v.example).map(v=>({index:v.example!.index,world:skinVertex(v.example!.index)})),
    });
    const before=read();operation.apply(vmd,frame/30);const after=read();
    samples.push({motion:id,sha256:createHash('sha256').update(vmdBytes).digest('hex'),frame,before,after});
  }
}
const involved=new Set(controllers.flatMap(index=>[...ancestry(index),...ancestry(model.bones[index].ik!.effector)]));
const evidence={sourceSHA256:createHash('sha256').update(bytes).digest('hex'),units:'metres; reflected right-handed PMX; frame / 30 seconds',
  policy:'Raw authored bones versus six source sleeve CCD IK chains (layer then index). No grants, foot IK or physics. No original Windows MMD parity claim.',
  chains:controllers.map(index=>({index,...model.bones[index],ancestry:ancestry(index)})),influences,
  fixedAxes:model.bones.flatMap((b,index)=>(b.flag??0)&0x400?[{index,name:b.name,axis:b.fixAxis,modified:false}]:[]),
  grants:model.bones.flatMap((b,index)=>b.grant?[{index,name:b.name,grant:b.grant}]:[]),
  physics:{bodies:model.rigidBodies.length,joints:model.constraints.length,dependencies:model.rigidBodies.flatMap((b:any,index)=>involved.has(b.boneIndex)?[{index,bone:b.boneIndex,mode:b.type}]:[])},
  tracks:await Promise.all(['02_laugh','22_apology'].map(async id=>{const v=parseVMD(await readFile(`${directory}/motion/${id}.vmd`));return {motion:id,bones:model.bones.flatMap((b,index)=>involved.has(index)?[{index,name:b.name,records:v.bones.filter(k=>k.name.terminated && k.name.text===b.name).length,hasNonRestKeys:v.bones.filter(k=>k.name.terminated && k.name.text===b.name).some(k=>k.rotation.some((v,i)=>Math.abs(v-(i===3?1:0))>1e-6)||k.translation.some(v=>Math.abs(v)>1e-6))}]:[])};})),samples};
mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
return evidence;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const evidence=await diagnoseUkaSleeves();
  await writeFile('docs/uka-sleeve-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence.samples.map(s=>({motion:s.motion,frame:s.frame,
    maxRaw:Math.max(...s.before.residuals.map(r=>r.metres)),maxSleeveIK:Math.max(...s.after.residuals.map(r=>r.metres))})),null,2));
}
