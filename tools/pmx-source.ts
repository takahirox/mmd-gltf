import type { PMXModel } from './pmx-to-gltf';
import { createSolver } from './pmx-solver';
import { diagnosticError } from '../packages/mmd-diagnostics';
/** Validate retained, unexecuted PMX records too; omission from playback is not validation. */
export function validateRetainedPMX(model: PMXModel) {
  const fail=(path:string,message:string):never=>diagnosticError('malformed-data','invalid-pmx-record',`PMX ${path}`,path.startsWith("morphs") ? `Morph: ${message}` : message);
  const vec=(v:unknown,n=3):v is number[]=>Array.isArray(v)&&v.length===n&&Array.from(v).every(x=>typeof x==='number'&&Number.isFinite(x));
  const ref=(v:number,n:number,optional=false)=>Number.isInteger(v)&&v>=(optional?-1:0)&&v<n;
  for(const [table,records] of [['bones',model.bones],['morphs',model.morphs],['rigidBodies',model.rigidBodies],['joints',model.constraints],['softBodies',model.softBodies??[]]] as const) {
    const pending:{value:unknown;depth:number;path:string;exit?:boolean}[]=[{value:records,depth:0,path:table}],active=new WeakSet<object>();
    while(pending.length) {
      const {value,depth,path,exit}=pending.pop()!;
      if(exit){active.delete(value as object);continue;}
      if(depth>64) diagnosticError('resource-exhaustion','source-record-depth-budget',`PMX ${table}`,'source record nesting exceeds parser budget');
      if(typeof value==='number' && !Number.isFinite(value))fail(path,/^bones\[\d+\]\.position/.test(path) ? `Bone ${path.match(/\d+/)![0]}: non-finite source value` : table==='morphs' ? 'non-finite source value or group FLOAT rate' : 'non-finite source value');
      if(value && typeof value==='object') {
        if(active.has(value))fail(path,'cyclic source record');
        active.add(value);pending.push({value,depth,path,exit:true});
        for(const [key,child] of Object.entries(value))pending.push({value:child,depth:depth+1,path:Array.isArray(value)?`${path}[${key}]`:`${path}.${key}`});
      }
    }
  }
  Array.from(model.bones).forEach((b,i)=>{
    if(!b || !ref(b.parentIndex,model.bones.length,true))fail(`bones[${i}]`,`Bone ${i}: invalid parent ${b?.parentIndex}`);
    if(!vec(b.position))fail(`bones[${i}]`,`Bone ${i}: non-finite or invalid position`);
  });
  // Neutral rest validates source metadata/graphs without imposing glTF unit/range limits.
  if(model.bones.length) createSolver(model,{version:1,modelId:'source-structure',metersPerPMXUnit:1,bones:model.bones.map((b,index)=>({index,name:b.name,parentIndex:b.parentIndex,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}))},3);
  Array.from(model.rigidBodies).forEach((v,i)=>{
    const b=v as {boneIndex:number;shapeType:number;type:number;groupIndex:number;groupTarget:number;position:number[];rotation:number[]};
    if(!b || !ref(b.boneIndex,model.bones.length,true) || ![0,1,2].includes(b.shapeType) || ![0,1,2].includes(b.type) || !ref(b.groupIndex,16) || !ref(b.groupTarget,65536) || !vec(b.position)||!vec(b.rotation))fail(`rigidBodies[${i}]`,'invalid body reference, shape, mode, filter or transform');
  });
  Array.from(model.morphs).forEach((m,i)=>{
    if(!m || !Array.isArray(m.elements) || m.elementCount!==m.elements.length || !Number.isInteger(m.type) || m.type<0 || m.type>10)fail(`morphs[${i}]`,'invalid morph type/count');
    m.elements.forEach((e:any,j:number)=>{
      const n=m.type===0||m.type===9 ? model.morphs.length : m.type===2 ? model.bones.length : m.type===8 ? model.materials.length : m.type===10 ? model.rigidBodies.length : model.vertices.length;
      if(!e || !ref(e.index,n,m.type===8))fail(`morphs[${i}].elements[${j}]`,'invalid source reference');
      if((m.type===0||m.type===9) && !Number.isFinite(e.ratio) || m.type===10 && (![0,1].includes(e.local)||!vec(e.velocity)||!vec(e.torque)))fail(`morphs[${i}].elements[${j}]`,'invalid retained morph record or group/flip FLOAT rate');
    });
  });
  Array.from(model.constraints).forEach((v,i)=>{
    const j=v as any;
    if(!j || !Number.isInteger(j.type)||j.type<0||j.type>5 || !ref(j.rigidBodyIndex1,model.rigidBodies.length,true) || !ref(j.rigidBodyIndex2,model.rigidBodies.length,true) ||
        ![j.position,j.rotation,j.translationLimitation1,j.translationLimitation2,j.rotationLimitation1,j.rotationLimitation2,j.springPosition,j.springRotation].every(v=>vec(v)))fail(`joints[${i}]`,'invalid joint type, reference or vectors');
  });
  if((model.metadata.softBodyCount??0)!==(model.softBodies?.length??0))fail('softBodies','count mismatch');
  Array.from(model.softBodies??[]).forEach((v,i)=>{
    const b=v as any;
    if(!b || !ref(b.material,model.materials.length) || ![0,1].includes(b.shape) || !vec(b.config,12)||!vec(b.cluster,6)||!vec(b.stiffness,3)||!Array.isArray(b.anchors)||!Array.isArray(b.pins))fail(`softBodies[${i}]`,'invalid soft-body records');
    for(const a of b.anchors)if(!a || !ref(a.body,model.rigidBodies.length)||!ref(a.vertex,model.vertices.length)||![0,1].includes(a.near))fail(`softBodies[${i}]`,'invalid anchor reference/flag');
    for(const p of b.pins)if(!ref(p,model.vertices.length))fail(`softBodies[${i}]`,'invalid pin reference');
  });
}
