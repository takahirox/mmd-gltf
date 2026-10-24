/** Independent scalar oracle for the authored Issue #37 rigs. Palette transforms
 * derive from the VMD/VPD authoring predictions, never production bones or QDEF.
 * Expanded scalar dual products/point equations intentionally avoid evaluator code. */
import { Matrix4, Matrix3, Quaternion, Vector3 } from 'three';
import { sourceVertex, oraclePalette, sdefPrediction, type SDEFState } from './sdef-oracle';
import { morphPoint } from './morph-oracle';
import type { RigCase } from './vpd-oracle';
export type QDEFState = SDEFState;
export function qdefInfluences(index: number): [number[],number[]] {
  const slot=index%4, face=Math.floor(index/4);
  if(slot===0)return [[259],[1]];
  if(slot===1)return [[259,2],[0.25,0.75]];
  if(slot===3)return [[259,2],[0.75,0.25]];
  if(face%3===1)return [[259],[1]];
  if(face%3===2)return [[1,2,259],[0.3,0.3,0.4]];
  return [[0,1,2,259],[0.1,0.2,0.3,0.4]];
}
export function qdefPrediction(rig:RigCase,state:QDEFState,index:number,time=0,approximation=false,pointTransform?: (point: number[]) => number[]) {
  let {position:p,normal:n}=sourceVertex(rig,index);
  if(state==='a'||state==='b')p.fromArray(pointTransform ? pointTransform(p.toArray()) : morphPoint(rig,state,index,time,p.toArray()));
  const [joints,weights]=qdefInfluences(index), matrices=joints.map(j=>oraclePalette(rig,state,j,time));
  if(approximation||index%4===0) {
    const position=new Vector3(),normal=new Vector3();
    matrices.forEach((m,i)=>{position.addScaledVector(p.clone().applyMatrix4(m),weights[i]);normal.addScaledVector(n.clone().applyMatrix3(new Matrix3().setFromMatrix4(m)),weights[i]);});
    return {p:position,n:normal.normalize()};
  }
  if(index%4===1)return sdefPrediction(rig,state,index,time,false,pointTransform);
  return scalarDq(p,n,matrices,weights);
}
export function scalarDq(p:Vector3,n:Vector3,matrices:Matrix4[],weights:number[]) {
  const quaternions=matrices.map(m=>{
    const q=new Quaternion().setFromRotationMatrix(m).toArray();
    if(([q[3],...q.slice(0,3)].find(v=>Math.abs(v)>1e-6)??1)<0)return q.map(v=>-v);
    return q;
  });
  const r=[0,0,0,0],d=[0,0,0,0];
  quaternions.forEach((q,i)=>{
    const dot=q.reduce((s,v,k)=>s+v*quaternions[weights.findIndex(w=>w>0)][k],0), w=weights[i]*(dot < -1e-6 ? -1 : 1);
    const [x,y,z,a]=q, e=matrices[i].elements,tx=e[12],ty=e[13],tz=e[14];
    const pair=[(tx*a+ty*z-tz*y)/2,(-tx*z+ty*a+tz*x)/2,(tx*y-ty*x+tz*a)/2,-(tx*x+ty*y+tz*z)/2];
    q.forEach((v,k)=>{r[k]+=w*v;d[k]+=w*pair[k];});
  });
  const length=Math.hypot(...r);
  if(length<=1e-8) {const first=weights.findIndex(w=>w>0);return {p:p.clone().applyMatrix4(matrices[first]),n:n.clone().applyQuaternion(new Quaternion().fromArray(quaternions[first])).normalize()};} for(let k=0;k<4;k++){r[k]/=length;d[k]/=length;}
  // Translation from d * conjugate(r); the component along r cancels exactly,
  // so an explicit Study projection is unnecessary in this independent formula.
  const [x,y,z,a]=r,[u,v,w,b]=d;
  const shift=[2*(-b*x+a*u-v*z+w*y),2*(-b*y+u*z+a*v-w*x),2*(-b*z-u*y+v*x+a*w)];
  const rotate=(value:number[])=>{
    const [px,py,pz]=value;
    return [(1-2*(y*y+z*z))*px+2*(x*y-a*z)*py+2*(x*z+a*y)*pz,
      2*(x*y+a*z)*px+(1-2*(x*x+z*z))*py+2*(y*z-a*x)*pz,
      2*(x*z-a*y)*px+2*(y*z+a*x)*py+(1-2*(x*x+y*y))*pz];
  };
  return {p:new Vector3().fromArray(rotate(p.toArray()).map((v,k)=>v+shift[k])),n:new Vector3().fromArray(rotate(n.toArray())).normalize()};
}
