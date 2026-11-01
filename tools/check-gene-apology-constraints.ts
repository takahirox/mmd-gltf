/** Reproduce the incompatible Gene Apology frame without creating an Ammo world.
 * This is an interval exclusion check, not a simulation or native-MMD oracle. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Bone,Skeleton,SkinnedMesh,BufferGeometry,MeshBasicMaterial,Matrix4,Quaternion,Vector3} from 'three';
import {parsePMX} from './pmx-to-gltf';
import {publicPhysicsSource} from './audit-public-physics';
import {parseVMD,bindMotion,evaluateMotion} from '../packages/mmd-vmd';
import {ComparisonPhysics} from '../examples/comparison-physics';
import manifest from './gene-light-manifest.json';
const canonical=(pose:ReturnType<typeof evaluateMotion>)=>pose.map(b=>{
  const q=b.rotation.map(v=>Math.round(v*1e7+1e-7)/1e7),length=Math.hypot(...q);
  return {...b,translation:b.translation.map(v=>Math.round(v*1e7+1e-7)/1e7) as typeof b.translation,rotation:q.map(v=>v/length) as typeof b.rotation};
});
const source=await Promise.all(['Gene_light.pmx','motion/22_apology.vmd'].map(async path=>{
  const bytes=await readFile(`public/gene-light/${path}`),sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==manifest.files.find(f=>f.path===path)?.sha256)throw new Error(`Unpinned source: ${path}`);
  return {bytes,path,sha256};
}));
const binding={version:1 as const,...publicPhysicsSource(parsePMX(source[0].bytes))},p=binding.physics;
const mat=(f:{translation:ArrayLike<number>;rotation:ArrayLike<number>})=>new Matrix4().compose(new Vector3().fromArray(f.translation),new Quaternion().fromArray(f.rotation),new Vector3(1,1,1));
const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
const nodes=binding.solver.bones.map(b=>{const n=new Bone();n.name=b.name;n.position.fromArray(b.translation).multiplyScalar(12.5);return n;});
binding.solver.bones.forEach((b,i)=>(b.parentIndex<0?mesh:nodes[b.parentIndex]).add(nodes[i]));
mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(nodes));
const physics=new ComparisonPhysics(binding,[mesh]);
const bodies:Record<number,number[]>={};
try {
  const motion=parseVMD(source[1].bytes),vmd=bindMotion({version:1,modelId:'Gene',metersPerPMXUnit:.08,bones:binding.solver.bones},motion,{preserveUnbound:true});
  physics.bindings[0].write(canonical(evaluateMotion(vmd,5/3)),true);
  physics.adapters[0].apply(motion,5/3,'prePhysics',true);
  if(physics.adapters[0].state.error)throw new Error(physics.adapters[0].state.error);
  physics.bindings[0].write(canonical(physics.bindings[0].read(true)),true);
  for(const b of p.bodies.filter(b=>b.mode===0))bodies[b.index]=nodes[b.bone].matrixWorld.clone().multiply(mat(b)).toArray();
} finally {physics.dispose();mesh.skeleton.dispose();mesh.geometry.dispose();mesh.material.dispose();}
const j52=p.joints[52],j53=p.joints[53],j80=p.joints[80];
const ka=new Matrix4().fromArray(bodies[j52.bodyA]).multiply(mat(j52.frameA));
const kb=new Matrix4().fromArray(bodies[j53.bodyA]).multiply(mat(j53.frameA));
const t=ka.clone().invert().multiply(kb),translation=new Vector3().setFromMatrixPosition(t),rotation=new Quaternion().setFromRotationMatrix(t);
// Ideal anchors give A = Ka * R52 * Sa and B = Kb * R53 * Sb.
// Locked joints 75 and 74 connect cloak bodies 64/65 to counterweights 74/75.
const sa=mat(j52.frameB).invert().multiply(mat(p.joints[75].frameA)).multiply(mat(p.joints[75].frameB).invert()).multiply(mat(j80.frameA));
const sb=mat(j53.frameB).invert().multiply(mat(p.joints[74].frameA)).multiply(mat(p.joints[74].frameB).invert()).multiply(mat(j80.frameB));
const ca=new Vector3(sa.elements[8],sa.elements[9],sa.elements[10]),pa=new Vector3().setFromMatrixPosition(sa),pb=new Vector3().setFromMatrixPosition(sb),constant=ca.dot(pa);
type I=[number,number];type V=[I,I,I];
const sum=(a:I,b:I):I=>[a[0]+b[0],a[1]+b[1]];
const mul=(a:I,b:I):I=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...v),Math.max(...v)];};
const neg=(a:I):I=>[-a[1],-a[0]];
const trig=(a:I,cos=false):I=>{
 const lo=a[0]+(cos?Math.PI/2:0),hi=a[1]+(cos?Math.PI/2:0);
 let low=Math.min(Math.sin(lo),Math.sin(hi)),high=Math.max(Math.sin(lo),Math.sin(hi));
 for(let k=Math.ceil((lo-Math.PI/2)/Math.PI);Math.PI/2+k*Math.PI<=hi;k++){if(k%2===0)high=1;else low=-1;}
 return [low,high];
};
const vec=(v:Vector3):V=>v.toArray().map(x=>[x,x]) as V;
function rotate(v:V,angles:I[]):V {
 let result=v;
 for(let k=0;k<3;k++) {
  const a=neg(angles[k]),c=trig(a,true),s=trig(a),[x,y,z]=result;
  if(k===0)result=[x,sum(mul(c,y),neg(mul(s,z))),sum(mul(s,y),mul(c,z))];
  if(k===1)result=[sum(mul(c,x),mul(s,z)),y,sum(neg(mul(s,x)),mul(c,z))];
  if(k===2)result=[sum(mul(c,x),neg(mul(s,y))),sum(mul(s,x),mul(c,y)),z];
 }
 return result;
}
const r=new Matrix4().makeRotationFromQuaternion(rotation).elements;
const transformed=(v:V):V=>[0,1,2].map(k=>sum(sum(mul([r[k],r[k]],v[0]),mul([r[k+4],r[k+4]],v[1])),mul([r[k+8],r[k+8]],v[2]))) as V;
function bound(box:I[]) {
 // Joint 80's local z = (R52 * Sa.z) dot (t + R * R53 * Sb.p)
 //                    - Sa.z dot Sa.p.
 // Interval rotation encloses the whole box, not only its sampled corners.
 const axis=rotate(vec(ca),box.slice(0,3)),b=transformed(rotate(vec(pb),box.slice(3))),delta=b.map((v,k)=>sum(v,[translation.getComponent(k),translation.getComponent(k)])) as V;
 const result=axis.reduce((s,v,k)=>sum(s,mul(v,delta[k])),[-constant,-constant] as I);
 // Inflate well above accumulated floating-point roundoff.
 return [result[0]-1e-8,result[1]+1e-8];
}
const box=[...j52.angularLower,...j53.angularLower].map((lo:number,k:number)=>[lo-.005,[...j52.angularUpper,...j53.angularUpper][k]+.005]) as I[];
const threshold=-4.63;
// Subdivide any box whose upper bound does not yet exclude this threshold.
// Exhausting the queue proves the bound for the entire source-angle domain.
const queue=[box];let count=0,maximum=-Infinity,remaining=0;
while(queue.length) {
 const node=queue.pop()!,upper=bound(node)[1];count++;
 if(upper<threshold){maximum=Math.max(maximum,upper);continue;}
 const width=node.map(v=>v[1]-v[0]),k=width.indexOf(Math.max(...width));
 if(width[k]<1e-5 || count>2000000){remaining++;break;}
 const mid=(node[k][0]+node[k][1])/2,a=node.map(v=>[...v] as I),b=node.map(v=>[...v] as I);a[k][1]=mid;b[k][0]=mid;queue.push(a,b);
}
if(remaining || queue.length)throw new Error('Interval exclusion was inconclusive');
// Each accepted cloak anchor has at most 30 mm on each local translation axis.
const anchorAllowance=2*.03*Math.sqrt(3);
// The two locked counterweight joints each permit at most 2e-5 per linear/
// angular axis in the unchanged tests. Euler composition bounds rotation by
// 3*2e-5 rad. Bound its effect on both positions and the measurement axis.
const tailA=mat(p.joints[75].frameB).invert().multiply(mat(j80.frameA));
const tailB=mat(p.joints[74].frameB).invert().multiply(mat(j80.frameB));
const distance=new Vector3().setFromMatrixPosition(ka).distanceTo(new Vector3().setFromMatrixPosition(kb))+pa.length()+pb.length()+anchorAllowance;
const lockedErrorBound=2*Math.sqrt(3)*2e-5+6e-5*(distance+new Vector3().setFromMatrixPosition(tailA).length()+new Vector3().setFromMatrixPosition(tailB).length());
if(lockedErrorBound>=.01)throw new Error('Counterweight uncertainty exceeds the conservative allowance');
const upper=maximum+anchorAllowance+.01;
if(upper>=j80.linearLower[2]-.0002)throw new Error('Joint 80 exclusion failed');
console.log(JSON.stringify({issue:77,frame:50,ik:true,sourceCommit:manifest.commit,sources:source.map(({path,sha256})=>({path,sha256})),
  method:'Interval subdivision of negative intrinsic ZYX source-angle boxes; includes 0.005 rad per-axis angular slack; no native physics allocation',
  joints:{anchors:[52,53],locked:[74,75],counterweight:80},boxesChecked:count,roundoffInflation:1e-8,
  exactAnchorZUpper:maximum,anchorTranslationAllowance:anchorAllowance,lockedErrorBound,conservativeLockedAllowance:.01,
  joint80ZUpper:upper,joint80SourceLower:j80.linearLower[2],minimumLinearViolation:j80.linearLower[2]-upper,
  allowedLinearViolation:.0002,conclusion:'The unchanged angular and linear gates cannot all hold at this authored pose with fixed source kinematic anchors.'},null,2));
