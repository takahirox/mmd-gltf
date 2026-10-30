import { type Object3D, type SkinnedMesh } from 'three';
import { CCDIKSolver } from '@takahirox/three-mmd/animation/CCDIKSolver.js';
import type { VMD } from '../packages/mmd-vmd';

export const sleeveNames = ['左腕袖IK','左手袖IK','左手首袖IK','右腕袖IK','右手袖IK','右手首袖IK'] as const;
type SourceBone = {index:number;name:string;flags?:number;layer?:number;ik?:{
  effector:number;iteration:number;maxAngle:number;links:{index:number;angleLimitation:number}[];
}};
/** A deliberately isolated preview operation, not MMD_skeleton_solver execution.
 * Only the six source sleeve links are writable. Authored ancestors (including
 * fixed-axis twist bones) are read unchanged; no grants, foot IK or physics. */
export function sleeveIK(root:Object3D, source:SourceBone[], direct=false) {
  let mesh:SkinnedMesh | undefined;
  root.traverse(n=>{if(!mesh && (n as SkinnedMesh).isSkinnedMesh)mesh=n as SkinnedMesh;});
  if(!mesh)throw new Error('Sleeve IK: missing skin');
  const bones=mesh.skeleton.bones;
  const bone=(index:number)=>direct?bones[index]:bones.find(b=>b.userData.pmxBone?.index===index);
  const selected=source.filter(b=>sleeveNames.includes(b.name as typeof sleeveNames[number]))
    .sort((a,b)=>(a.layer??0)-(b.layer??0)||a.index-b.index);
  if(selected.length!==6 || new Set(selected.map(b=>b.name)).size!==6)throw new Error('Sleeve IK: six unique source controllers required');
  const iks=selected.map(b=>{
    const ik=b.ik, target=bone(b.index);
    if(!ik || !target || ik.links.length!==1 || ik.links.some(l=>l.angleLimitation || !bone(l.index) || (source.find(b=>b.index===l.index)?.flags??0)&0x3fa0))
      throw new Error('Sleeve IK: unsupported link dependency');
    const effector=bone(ik.effector), link=bone(ik.links[0].index)!;
    if(!effector || effector.parent!==link || !Number.isInteger(ik.iteration) || ik.iteration<0 || ik.iteration>1024 || !Number.isFinite(ik.maxAngle) || ik.maxAngle<0)
      throw new Error('Sleeve IK: invalid source chain');
    return {target:bones.indexOf(target),effector:bones.indexOf(effector),iteration:ik.iteration,maxAngle:ik.maxAngle,links:[{index:bones.indexOf(link)}]};
  });
  const solver=new CCDIKSolver(mesh,iks);
  const links=iks.map(ik=>bones[ik.links[0].index]);
  const raw=links.map(b=>b.quaternion.clone());
  return {
    controllers:selected.map(b=>b.index),
    // Restore the prior raw mixer result before evaluating another absolute time.
    // Otherwise untracked sleeve bones accumulate IK, and mixer caches can skip
    // writing a value that equals their previous raw result.
    remember:()=>links.forEach((b,i)=>raw[i].copy(b.quaternion)),
    restore:()=>links.forEach((b,i)=>b.quaternion.copy(raw[i])),
    apply:(motion:VMD | undefined,time:number)=>{
      links.forEach((b,i)=>raw[i].copy(b.quaternion));
      root.updateMatrixWorld(true);
      const switches=new Map<string,boolean>();
      for(const record of [...(motion?.displays??[])].sort((a,b)=>a.frame-b.frame)) if(record.frame<=time*30)
        for(const item of record.ik)if(item.name.terminated && item.name.text)switches.set(item.name.text,item.enabled!==0);
      iks.forEach((ik,i)=>{if(switches.get(selected[i].name)!==false)solver.updateOne(ik);});
      root.updateMatrixWorld(true);
    },
  };
}
