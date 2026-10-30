import { Matrix4, Quaternion, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { CCDIKSolver } from '@takahirox/three-mmd/animation/CCDIKSolver.js';
import type { VMD } from '../packages/mmd-vmd';

/** PMX axial limits remain left handed after mmd-parser reflects positions. */
export type IKSourceBone = {index:number;name:string;flags?:number;layer?:number;grant?:unknown;ik?:{
  effector:number;iteration:number;maxAngle:number;links:{index:number;angleLimitation:number;
    lowerLimitationAngle?:number[];upperLimitationAngle?:number[]}[];
}};
type Grant = {parentIndex:number;ratio:number;isLocal:boolean;affectRotation:boolean;affectPosition:boolean};
const order=(a:IKSourceBone,b:IKSourceBone)=>
  Number(!!((a.flags??0)&0x1000))-Number(!!((b.flags??0)&0x1000)) || (a.layer??0)-(b.layer??0) || a.index-b.index;

/** Only grants in the IK read closure execute, and only while IK is On.
 * Each instance owns its raw pose; no completed pose is copied between skins. */
export function comparisonIK(root:Object3D, source:IKSourceBone[], direct=false) {
  let mesh:SkinnedMesh | undefined;
  root.traverse(n=>{if(!mesh && (n as SkinnedMesh).isSkinnedMesh)mesh=n as SkinnedMesh;});
  if(!mesh)throw new Error('IK: missing skin');
  const bones=mesh.skeleton.bones;
  const bone=(index:number)=>direct?bones[index]:bones.find(b=>b.userData.pmxBone?.index===index);
  const byIndex=new Map(source.map(b=>[b.index,b]));
  const identity=new Map(bones.map(b=>[b,source.find(s=>bone(s.index)===b)]));
  root.updateMatrixWorld(true);
  // Rest is captured before any mixer/player runs. Exclude scene/mesh placement.
  const inverseMesh=new Matrix4().copy(mesh.matrixWorld).invert();
  const rest=new Map(source.filter(s=>bone(s.index)).map(s=>{
    const b=bone(s.index)!;
    const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
    new Matrix4().multiplyMatrices(inverseMesh,b.matrixWorld).decompose(position,rotation,scale);
    return [s.index,{local:b.position.clone(),rotation:b.quaternion.clone(),scale:b.scale.clone(),position,inverseRotation:rotation.invert()}] as const;
  }));
  const ancestry=(index:number)=>{
    const result:number[]=[],seen=new Set<Object3D>();
    let node:Object3D|null|undefined=bone(index);
    while(node && identity.has(node as typeof bones[number]) && !seen.has(node)) {
      seen.add(node);const s=identity.get(node as typeof bones[number]);if(s)result.push(s.index);
      node=node.parent;
    }
    return result;
  };
  const selected=source.filter(b=>b.ik).sort(order);
  const controllers=selected.map(b=>{
    const ik=b.ik!,reasons:string[]=[];
    const dependencies=new Set([b.index,ik.effector,...ik.links.map(l=>l.index)].flatMap(ancestry));
    // Grant sources (and, for local grants, their model-space ancestry) can
    // themselves read grants. Follow the closure before constructing any writes.
    const visiting=new Set<number>(),visited=new Set<number>();
    const visit=(index:number)=>{
      if(visiting.has(index)){reasons.push(`cyclic grant dependency ${index}`);return;}
      if(visited.has(index))return;
      visiting.add(index);
      const s=byIndex.get(index),g=s?.grant as Grant | undefined;
      if(s && (g || (s.flags??0)&0x300)) {
        const flags=s.flags??0;
        if(!g || typeof g.isLocal!=='boolean' || typeof g.affectRotation!=='boolean' || typeof g.affectPosition!=='boolean' ||
          g.isLocal!==!!(flags&0x80) || g.affectRotation!==!!(flags&0x100) || g.affectPosition!==!!(flags&0x200) || !(flags&0x300))
          reasons.push(`unsupported grant flags at ${index}`);
        if(!g || !Number.isInteger(g.parentIndex) || !byIndex.has(g.parentIndex) || !bone(g.parentIndex))
          reasons.push(`missing grant source at ${index}`);
        else {
          if(!Number.isFinite(g.ratio))reasons.push(`invalid grant rate at ${index}`);
          const reads=g.isLocal?ancestry(g.parentIndex):[g.parentIndex];
          if(g.isLocal && reads.includes(index))reasons.push(`local grant ${index} reads its descendant`);
          for(const read of reads) {
            dependencies.add(read);
            const upstream=byIndex.get(read)!;
            // Later procedural source values are ambiguous for this restricted
            // adapter. Preserve transport, but explicitly decline execution.
            if(upstream.grant && order(upstream,s)>0)reasons.push(`invalid grant order ${read} -> ${index}`);
            visit(read);
          }
        }
        if(order(s,b)>0)reasons.push(`invalid grant phase/layer order ${index} -> ${b.index}`);
      }
      visiting.delete(index);visited.add(index);
    };
    [...dependencies].forEach(visit);
    if(source.length!==bones.length || byIndex.size!==source.length || source.some(s=>!Number.isInteger(s.index)||s.index<0 || !bone(s.index)) ||
      new Set(source.map(s=>bone(s.index))).size!==source.length)reasons.push('invalid or duplicate source identity/binding');
    if(!Number.isInteger(ik.iteration) || ik.iteration<1 || ik.iteration>1024 || !Number.isFinite(ik.maxAngle) || ik.maxAngle<=0)
      reasons.push('invalid or unsupported iteration/angle cap');
    if(!bone(b.index) || !bone(ik.effector) || !ik.links.length || new Set(ik.links.map(l=>l.index)).size!==ik.links.length)
      reasons.push('missing binding or invalid chain membership');
    let child=bone(ik.effector);
    const links=ik.links.map(l=>{
      const link=bone(l.index);
      if(!link || child?.parent!==link)reasons.push(`invalid hierarchy at link ${l.index}`);
      child=link;
      const min=l.lowerLimitationAngle,max=l.upperLimitationAngle;
      if(l.angleLimitation!==0 && l.angleLimitation!==1)reasons.push(`invalid limit flag at link ${l.index}`);
      if(l.angleLimitation && (!min || !max || min.length!==3 || max.length!==3 ||
        min.some((v,i)=>!Number.isFinite(v) || !Number.isFinite(max[i]) || v>max[i])))reasons.push(`invalid XYZ bounds at link ${l.index}`);
      return {index:l.index,...(l.angleLimitation && min && max?{lower:[-max[0],-max[1],min[2]],upper:[-min[0],-min[1],max[2]]}:{})};
    });
    for(const index of dependencies) {
      const s=byIndex.get(index);
      if(!s){reasons.push(`missing source identity ${index}`);continue;}
      if(!Number.isInteger(s.layer??0))reasons.push(`invalid deformation layer at ${index}`);
      if(!Number.isInteger(s.flags??0) || (s.flags??0)<0 || (s.flags??0)>0xffff)reasons.push(`invalid flags at ${index}`);
      if((s.flags??0)&0x2000)reasons.push(`external parent dependency ${index} requires a host binding`);
      if((ik.links.some(l=>l.index===index) || s.grant) && (s.flags??0)&0xc00)
        reasons.push(`fixed/local-axis writable link ${index} is unsupported`);
    }
    return {index:b.index,name:b.name,effector:ik.effector,iteration:ik.iteration,maxAngle:ik.maxAngle,
      phase:(b.flags??0)&0x1000?'postPhysics':'prePhysics',layer:b.layer??0,links,
      dependencies:[...dependencies].sort((a,b)=>a-b),reasons:[...new Set(reasons)]};
  });
  const required=new Set(controllers.flatMap(c=>c.dependencies));
  const grants=source.filter(s=>required.has(s.index) && s.grant).sort(order).map(s=>{
    const g=s.grant as Grant;
    return {index:s.index,name:s.name,source:g.parentIndex,sourceName:byIndex.get(g.parentIndex)?.name,
      local:g.isLocal,rotation:g.affectRotation,translation:g.affectPosition,rate:g.ratio,
      phase:(s.flags??0)&0x1000?'postPhysics':'prePhysics',layer:s.layer??0};
  });
  const supported=controllers.filter(c=>!c.reasons.length).length;
  const available=controllers.length>0 && supported===controllers.length;
  const iks=available?controllers.map(c=>({target:bones.indexOf(bone(c.index)!),effector:bones.indexOf(bone(c.effector)!),
    iteration:c.iteration,maxAngle:c.maxAngle,links:c.links.map(l=>({index:bones.indexOf(bone(l.index)!),
      ...(l.lower && l.upper?{rotationMin:new Vector3().fromArray(l.lower),rotationMax:new Vector3().fromArray(l.upper)}:{})}))})):[];
  const solver=new CCDIKSolver(mesh,iks);
  const writes=[...new Set([...iks.flatMap(ik=>ik.links.map(l=>bones[l.index])),...grants.map(g=>bone(g.index)!).filter(Boolean)])];
  const raw=writes.map(b=>({position:b.position.clone(),rotation:b.quaternion.clone(),scale:b.scale.clone()}));
  const schedule=source.filter(s=>selected.includes(s) || grants.some(g=>g.index===s.index)).sort(order)
    .flatMap(s=>[...(grants.some(g=>g.index===s.index)?[{kind:'grant',index:s.index,phase:(s.flags??0)&0x1000?'postPhysics':'prePhysics',layer:s.layer??0}]:[]),
      ...(s.ik?[{kind:'ik',index:s.index,phase:(s.flags??0)&0x1000?'postPhysics':'prePhysics',layer:s.layer??0}]:[])]);
  const state={controllers,grants,schedule,supported,unsupported:controllers.length-supported,available,
    executed:[] as number[],disabledByMotion:[] as number[],appliedGrants:[] as number[],order:[] as typeof schedule,
    grantPolicy:'IK prerequisites only; IK Off restores raw pose',
    error:'',reason:controllers.length===0?'No source IK controllers':controllers.flatMap(c=>c.reasons.map(r=>`${c.name}: ${r}`)).join('; ')};
  const remember=()=>writes.forEach((b,i)=>{raw[i].position.copy(b.position);raw[i].rotation.copy(b.quaternion);raw[i].scale.copy(b.scale);});
  const clear=()=>{state.executed=[];state.disabledByMotion=[];state.appliedGrants=[];state.order=[];state.error='';};
  const restore=()=>{writes.forEach((b,i)=>{b.position.copy(raw[i].position);b.quaternion.copy(raw[i].rotation);b.scale.copy(raw[i].scale);});clear();root.updateMatrixWorld(true);};
  const validatePose=()=>{
    root.updateMatrixWorld(true);state.error='';
    for(const index of required) {
      const b=bone(index),det=b?.matrixWorld.determinant();
      if(!b || !b.matrixWorld.elements.every(Number.isFinite) || !Number.isFinite(det) || Math.abs(det!)<=1e-30 ||
        Math.abs(b.quaternion.lengthSq()-1)>=1e-5 || !b.scale.toArray().every(v=>Number.isFinite(v)&&Math.abs(v)>1e-10))
        state.error='Invalid raw IK/grant pose; no operations executed';
    }
    return !state.error;
  };
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),weighted=new Quaternion();
  const applyGrant=(g:typeof grants[number])=>{
    const target=bone(g.index)!,src=bone(g.source)!,bind=rest.get(g.source)!;
    position.copy(src.position).sub(bind.local);rotation.copy(src.quaternion);
    if(g.local) {
      root.updateMatrixWorld(true);
      inverseMesh.copy(mesh!.matrixWorld).invert();
      new Matrix4().multiplyMatrices(inverseMesh,src.matrixWorld).decompose(position,rotation,scale);
      position.sub(bind.position);rotation.multiply(bind.inverseRotation);
    }
    if(g.translation)target.position.addScaledVector(position,g.rate);
    if(g.rotation) {
      weighted.copy(rotation).normalize();
      if(weighted.w<0)weighted.set(-weighted.x,-weighted.y,-weighted.z,-weighted.w);
      const sine=Math.hypot(weighted.x,weighted.y,weighted.z),angle=Math.atan2(sine,weighted.w)*g.rate;
      if(sine===0)weighted.identity();
      else {const factor=Math.sin(angle)/sine;weighted.set(weighted.x*factor,weighted.y*factor,weighted.z*factor,Math.cos(angle));}
      target.quaternion.multiply(weighted);
    }
    root.updateMatrixWorld(true);
  };
  // Normalized local rest/binding identities are checked separately with numeric
  // tolerances: PMX uses units while glTF uses metres and FLOAT accessors.
  const bindings=[...required].sort((a,b)=>a-b).map(index=>{
    const b=bone(index),r=rest.get(index);
    const parent=b?.parent?bones.indexOf(b.parent as typeof bones[number]):-1;
    const bind=new Matrix4().copy(mesh!.skeleton.boneInverses[bones.indexOf(b!)]??new Matrix4()).invert();
    bind.premultiply(parent<0?mesh!.bindMatrix.clone().invert():mesh!.skeleton.boneInverses[parent]);
    const bindPosition=new Vector3(),bindRotation=new Quaternion(),bindScale=new Vector3();
    bind.decompose(bindPosition,bindRotation,bindScale);
    return {bindTranslation:bindPosition.toArray().map(v=>v*(direct?.08:1)),bindRotation:bindRotation.toArray(),bindScale:bindScale.toArray(),index,name:byIndex.get(index)?.name,parent:b?.parent?identity.get(b.parent as typeof bones[number])?.index??-1:-1,
      translation:r?.local.toArray().map(v=>v*(direct?.08:1)),rotation:r?.rotation.toArray(),scale:r?.scale.toArray()};
  });
  return {state,bindings,validatePose,remember,restore,
    apply:(motion:VMD | undefined,time:number)=>{
      clear();if(!state.available || !validatePose())return;
      remember();
      const switches=new Map<string,boolean>();
      for(const record of [...(motion?.displays??[])].sort((a,b)=>a.frame-b.frame))if(record.frame<=time*30)
        for(const item of record.ik)if(item.name.terminated && item.name.text)switches.set(item.name.text,item.enabled!==0);
      const active=controllers.filter(c=>switches.get(c.name)!==false);
      state.disabledByMotion=controllers.filter(c=>!active.includes(c)).map(c=>c.index);
      const needed=new Set(active.flatMap(c=>c.dependencies));
      try {
        for(const step of schedule) {
          if(step.kind==='grant' && needed.has(step.index)) {applyGrant(grants.find(g=>g.index===step.index)!);state.appliedGrants.push(step.index);}
          else if(step.kind==='ik' && active.some(c=>c.index===step.index)) {
            root.updateMatrixWorld(true);solver.updateOne(iks[controllers.findIndex(c=>c.index===step.index)]);state.executed.push(step.index);
          } else continue;
          state.order.push(step);
          if(!validatePose())throw new Error('Invalid evaluated IK/grant pose');
        }
      } catch(error) {
        restore();state.error=`IK/grant evaluation failed; raw pose restored: ${error instanceof Error?error.message:String(error)}`;
      }
      root.updateMatrixWorld(true);
    },
  };
}

export function comparisonIKCompatible(instances:ReturnType<typeof comparisonIK>[]) {
  const signature=(s:typeof instances[number])=>JSON.stringify({controllers:s.state.controllers,grants:s.state.grants,schedule:s.state.schedule});
  const first=instances[0];
  const close=(a:number[],b:number[])=>a.every((v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])&&Math.abs(v-b[i])<1e-6);
  const sameRotation=(a:number[],b:number[])=>Math.abs(Math.abs(a.reduce((n,v,k)=>n+v*b[k],0))-1)<1e-6;
  return instances.every(s=>signature(s)===signature(first) && s.bindings.length===first.bindings.length && s.bindings.every((b,i)=>{
    const a=first.bindings[i];
    return a.index===b.index && a.name===b.name && a.parent===b.parent && a.translation && b.translation && a.rotation && b.rotation &&
      close(a.translation,b.translation) && sameRotation(a.rotation,b.rotation) &&
      close(a.bindTranslation,b.bindTranslation) && sameRotation(a.bindRotation,b.bindRotation) && close(a.bindScale,b.bindScale) &&
      close(b.translation,b.bindTranslation) && sameRotation(b.rotation,b.bindRotation) && !!b.scale && close(b.scale,b.bindScale);
  }));
}
