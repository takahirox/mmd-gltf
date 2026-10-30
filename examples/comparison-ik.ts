import { Vector3, type Object3D, type SkinnedMesh } from 'three';
import { CCDIKSolver } from '@takahirox/three-mmd/animation/CCDIKSolver.js';
import type { VMD } from '../packages/mmd-vmd';

/** Source limits are PMX axial angles, even after mmd-parser reflects positions.
 * The direct loader has already reflected its runtime rotationMin/Max instead. */
export type IKSourceBone = {index:number;name:string;flags?:number;layer?:number;grant?:unknown;ik?:{
  effector:number;iteration:number;maxAngle:number;links:{index:number;angleLimitation:number;
    lowerLimitationAngle?:number[];upperLimitationAngle?:number[]}[];
}};
export function comparisonIK(root:Object3D, source:IKSourceBone[], direct=false) {
  let mesh:SkinnedMesh | undefined;
  root.traverse(n=>{if(!mesh && (n as SkinnedMesh).isSkinnedMesh)mesh=n as SkinnedMesh;});
  if(!mesh)throw new Error('IK: missing skin');
  const bones=mesh.skeleton.bones;
  const bone=(index:number)=>direct?bones[index]:bones.find(b=>b.userData.pmxBone?.index===index);
  const byIndex=new Map(source.map(b=>[b.index,b]));
  const identity=new Map(bones.map(b=>[b,source.find(s=>bone(s.index)===b)]));
  const selected=source.filter(b=>b.ik).sort((a,b)=>
    Number(!!((a.flags??0)&0x1000))-Number(!!((b.flags??0)&0x1000)) || (a.layer??0)-(b.layer??0) || a.index-b.index);
  const controllers=selected.map(b=>{
    const ik=b.ik!;
    const dependencies=new Set<number>();
    for(const index of [b.index,ik.effector,...ik.links.map(l=>l.index)]) {
      let node: Object3D | null | undefined=bone(index);
      while(node && identity.has(node as typeof bones[number])) {
        const s=identity.get(node as typeof bones[number]);if(s)dependencies.add(s.index);
        node=node.parent;
      }
    }
    const reasons:string[]=[];
    if(byIndex.size!==source.length || !Number.isInteger(b.index) || b.index<0)reasons.push('invalid or duplicate source identity');
    if(!Number.isInteger(ik.iteration) || ik.iteration<1 || ik.iteration>1024 || !Number.isFinite(ik.maxAngle) || ik.maxAngle<=0)
      reasons.push('invalid or unsupported iteration/angle cap');
    if(!Number.isInteger(b.layer??0))reasons.push('invalid deformation layer');
    if(!bone(b.index) || !bone(ik.effector) || !ik.links.length || new Set(ik.links.map(l=>l.index)).size!==ik.links.length)
      reasons.push('missing binding or invalid chain membership');
    let child=bone(ik.effector);
    const links=ik.links.map(l=>{
      const link=bone(l.index);
      if(!link || child?.parent!==link)reasons.push(`invalid hierarchy at link ${l.index}`);
      child=link;
      const min=l.lowerLimitationAngle, max=l.upperLimitationAngle;
      if(l.angleLimitation && (!min || !max || min.length!==3 || max.length!==3 ||
        min.some((v,i)=>!Number.isFinite(v) || !Number.isFinite(max[i]) || v>max[i])))reasons.push(`invalid XYZ bounds at link ${l.index}`);
      return {index:l.index,...(l.angleLimitation && min && max ? {
        lower:[-max[0],-max[1],min[2]],upper:[-min[0],-min[1],max[2]],
      }: {})};
    });
    for(const index of dependencies) {
      const s=source.find(b=>b.index===index)!;
      if(s.grant || (s.flags??0)&0x300)reasons.push(`append dependency ${index} requires a separate runtime`);
      if((s.flags??0)&0x2000)reasons.push(`external parent dependency ${index} requires a host binding`);
      // IK only writes link rotations. Fixed-axis ancestors are authored raw pose
      // inputs, not solver writes. Never silently run a fixed-axis writable link.
      if(ik.links.some(l=>l.index===index) && (s.flags??0)&0xc00)
        reasons.push(`fixed/local-axis writable link ${index} is unsupported`);
    }
    return {index:b.index,name:b.name,effector:ik.effector,iteration:ik.iteration,maxAngle:ik.maxAngle,
      phase:(b.flags??0)&0x1000?'postPhysics':'prePhysics',layer:b.layer??0,links,
      dependencies:[...dependencies].sort((a,b)=>a-b),reasons};
  });
  const supported=controllers.filter(c=>!c.reasons.length).length;
  // All-or-nothing across a model. The caller also checks all three instances.
  const available=controllers.length>0 && supported===controllers.length;
  const iks=available?controllers.map(c=>({target:bones.indexOf(bone(c.index)!),effector:bones.indexOf(bone(c.effector)!),
    iteration:c.iteration,maxAngle:c.maxAngle,links:c.links.map(l=>({index:bones.indexOf(bone(l.index)!),
      ...(l.lower && l.upper?{rotationMin:new Vector3().fromArray(l.lower),rotationMax:new Vector3().fromArray(l.upper)}:{})}))})):[];
  const solver=new CCDIKSolver(mesh,iks);
  const links=[...new Set(iks.flatMap(ik=>ik.links.map(l=>bones[l.index])))];
  const raw=links.map(b=>b.quaternion.clone());
  const state={controllers,supported,unsupported:controllers.length-supported,available,executed:[] as number[],disabledByMotion:[] as number[],
    error:'',reason:controllers.length===0?'No source IK controllers':controllers.flatMap(c=>c.reasons.map(r=>`${c.name}: ${r}`)).join('; ')};
  const validatePose=()=>{
    root.updateMatrixWorld(true);
    state.error='';
    for(const ik of iks)for(const index of [ik.target,ik.effector,...ik.links.map(l=>l.index)]) {
      const b=bones[index],det=b.matrixWorld.determinant();
      if(!b.matrixWorld.elements.every(Number.isFinite) || !Number.isFinite(det) || Math.abs(det)<=1e-30 ||
        Math.abs(b.quaternion.lengthSq()-1)>=1e-5 || !b.scale.toArray().every(v=>Number.isFinite(v)&&Math.abs(v)>1e-10))
        state.error='Invalid raw IK pose; no chains executed';
    }
    return !state.error;
  };
  return {
    state,validatePose,
    remember:()=>links.forEach((b,i)=>raw[i].copy(b.quaternion)),
    restore:()=>{links.forEach((b,i)=>b.quaternion.copy(raw[i]));state.executed=[];state.disabledByMotion=[];state.error='';},
    apply:(motion:VMD | undefined,time:number)=>{
      state.executed=[];state.disabledByMotion=[];
      if(!validatePose())return;
      links.forEach((b,i)=>raw[i].copy(b.quaternion));
      root.updateMatrixWorld(true);
      const switches=new Map<string,boolean>();
      for(const record of [...(motion?.displays??[])].sort((a,b)=>a.frame-b.frame))if(record.frame<=time*30)
        for(const item of record.ik)if(item.name.terminated && item.name.text)switches.set(item.name.text,item.enabled!==0);
      iks.forEach((ik,i)=>{
        if(switches.get(controllers[i].name)===false)state.disabledByMotion.push(controllers[i].index);
        else {solver.updateOne(ik);state.executed.push(controllers[i].index);}
      });
      root.updateMatrixWorld(true);
    },
  };
}
