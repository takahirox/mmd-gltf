/** Independently authored Issue #47 equations. No production morph reducer,
 * quaternion helper, solver, emitted joint matrices or attribute deltas. */
import { scalarLocal } from './vmd-oracle';
import { localPrediction, rigScale, type RigCase, type PoseCase } from './vpd-oracle';
export function boneControls(motion:'a'|'b',time:number) {
  const mid=motion==='a'?0.5:2/3,end=motion==='a'?1:1.5;
  const f=Math.max(0,Math.min(end,time));
  const line=(a:number,b:number,c:number)=>f<=mid?a+(b-a)*f/mid:b+(c-b)*(f-mid)/(end-mid);
  return motion==='a' ? [line(0,0.2,-0.1),line(0.8,-0.4,1.2),line(-0.2,0.6,0.3),line(0,0.4,-0.3),line(0.3,-0.1,0.2),0] :
    [line(0.3,0,-0.2),line(-0.5,0.7,0.2),line(0.4,-0.3,0.8),line(0.2,0.5,-0.1),line(-0.4,0.2,0.1),0];
}
export function predictedMorphLocal(rig:RigCase,weights:number[],translation:number[],q:number[]) {
  // The duplicate mixed entries total 1*group; the shared bone-only group has no target.
  const x=weights[2]+weights[1]-0.5*weights[4],y=weights[3]-0.25*weights[1]+0.75*weights[4];
  const a=-Math.PI*x/4,b=-Math.PI*y/4;
  // Reflected source X then Y quarter turns: qx(a)*qy(b). Reversing changes z's sign.
  const r=[Math.sin(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)*Math.sin(b),Math.cos(a)*Math.cos(b)];
  const [u,v,s,t]=q,[i,j,k,l]=r;
  return {translation:translation.map((v,i)=>v+rigScale[rig]*([0.2,-0.1,-0.3][i]*x+[-0.1,0.2,0.05][i]*y)),
    rotation:[u*l+t*i+v*k-s*j,v*l+t*j+s*i-u*k,s*l+t*k+u*j-v*i,t*l-u*i-v*j-s*k]};
}
export function boneLocal(rig:RigCase,motion:'a'|'b',index:number,time:number) {
  const base=scalarLocal(rig,motion,index,time);
  return index===259 ? predictedMorphLocal(rig,boneControls(motion,time),base.translation,base.rotation) : base;
}
export function poseBoneLocal(rig:RigCase,pose:PoseCase,index:number,weights:number[]) {
  const rotations=pose==='a'?new Map([[1,[-Math.SQRT1_2,0,0,Math.SQRT1_2]],[0,[0,-Math.SQRT1_2,0,Math.SQRT1_2]],[259,[0,0,Math.SQRT1_2,Math.SQRT1_2]]]):
    pose==='b'?new Map([[1,[0,0,-Math.SQRT1_2,Math.SQRT1_2]],[2,[0,-Math.SQRT1_2,0,Math.SQRT1_2]],[259,[Math.SQRT1_2,0,0,Math.SQRT1_2]]]):new Map();
  const base={translation:localPrediction(rig,pose,index),rotation:rotations.get(index)??[0,0,0,1]};
  return index===259?predictedMorphLocal(rig,weights,base.translation,base.rotation):base;
}
import { Matrix4, Matrix3, Quaternion, Vector3 } from 'three';
import { restWorld } from './vpd-oracle';
import { parent } from './vmd-oracle';
import { sourceVertex } from './sdef-oracle';
import { qdefInfluences, scalarDq } from './qdef-oracle';
export function bonePalette(rig:RigCase,state:'a'|'b'|'pose-a'|'pose-b'|'rest',index:number,time:number,controls?:number[]):Matrix4 {
  const weights=controls??(state==='a'||state==='b'?boneControls(state,time):Array(6).fill(0));
  const world=(index:number):Matrix4=>{
    const local=state==='a'||state==='b'?boneLocal(rig,state,index,time):poseBoneLocal(rig,state==='rest'?'rest':state.slice(-1) as 'a'|'b',index,weights);
    const m=new Matrix4().compose(new Vector3().fromArray(local.translation),new Quaternion().fromArray(local.rotation),new Vector3(1,1,1));
    const p=parent(rig,index);return p===-1?m:world(p).multiply(m);
  };
  return world(index).multiply(new Matrix4().makeTranslation(...restWorld(rig,index).map(v=>-v) as [number,number,number]));
}
export function bonePrediction(rig:RigCase,state:'a'|'b'|'pose-a'|'pose-b'|'rest',vertex:number,time:number,mode:'bdef'|'sdef'|'qdef'='bdef',hull=false,controls?:number[]) {
  const weights=controls??(state==='a'||state==='b'?boneControls(state,time):Array(6).fill(0));
  const {position:p,normal:n}=sourceVertex(rig,vertex),amount=weights[0]+weights[1]*0.5,s=rigScale[rig];
  p.add(new Vector3(0.25,vertex%4>0?0.3:0.1,-0.2).multiplyScalar(s*amount));
  const palette=(index:number)=>bonePalette(rig,state,index,time,weights);
  const bdefPatterns=[[[259],[1]],[[0,2],[0.25,0.75]],[[0,1,2,259],[0.1,0.2,0.3,0.4]],[[259,2],[0.75,0.25]]];
  if(mode==='bdef' || vertex%4===0) {
    const [joints,rates]=(mode==='bdef'?bdefPatterns[vertex%4]:[[259],[1]]) as [number[],number[]];
    const blend=new Matrix4();blend.elements.fill(0);
    joints.forEach((j,i)=>palette(j).elements.forEach((v,k)=>blend.elements[k]+=rates[i]*v));
    return {p:p.applyMatrix4(blend),n:n.applyMatrix3(hull?new Matrix3().getNormalMatrix(blend):new Matrix3().setFromMatrix4(blend)).normalize()};
  }
  if(mode==='qdef' && vertex%4!==1) {
    const [joints,rates]=qdefInfluences(vertex);return scalarDq(p,n,joints.map(palette),rates);
  }
  const a=palette(259),b=palette(2),w=vertex%4===1?0.25:vertex%4===2?0:1;
  const zero=vertex<4,c=new Vector3(...(zero?[0,0,0]:[0.5,1,-2]).map(v=>v*s) as [number,number,number]);
  const d=new Vector3(...(zero?[0,0,0]:[0.5,-0.5,1]).map(v=>v*s) as [number,number,number]);
  const qa=new Quaternion().setFromRotationMatrix(a),qb=new Quaternion().setFromRotationMatrix(b);
  if(qa.dot(qb)<0)qb.set(-qb.x,-qb.y,-qb.z,-qb.w);
  const angle=Math.acos(Math.min(1,qa.dot(qb))),u=1-w;
  const ca=angle<1e-8?1-u:Math.sin((1-u)*angle)/Math.sin(angle),cb=angle<1e-8?u:Math.sin(u*angle)/Math.sin(angle);
  const q=new Quaternion(qa.x*ca+qb.x*cb,qa.y*ca+qb.y*cb,qa.z*ca+qb.z*cb,qa.w*ca+qb.w*cb).normalize();
  const correction=d.clone().applyMatrix3(new Matrix3().setFromMatrix4(a)).sub(d.clone().applyMatrix3(new Matrix3().setFromMatrix4(b))).multiplyScalar(w*(1-w)/2);
  return {p:p.sub(c).applyQuaternion(q).addScaledVector(c.clone().applyMatrix4(a),w).addScaledVector(c.clone().applyMatrix4(b),1-w).add(correction),n:n.applyQuaternion(q).normalize()};
}
