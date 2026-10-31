import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Bone, Skeleton, SkinnedMesh, BufferGeometry, MeshBasicMaterial, Vector3, Quaternion } from 'three';
import { parsePMX } from '../tools/pmx-to-gltf';
import { parseVMD, bindMotion, evaluateMotion } from '../packages/mmd-vmd';
import { comparisonIK, comparisonIKCompatible, type IKSourceBone } from '../examples/comparison-ik';
import type { RestBone } from '../packages/mmd-vpd';

async function fixture(model:'uka'|'gene-light') {
  const directory=`.cache/${model}`, source=parsePMX(await readFile(`${directory}/${model==='uka'?'MS_Uka':'Gene_light'}.pmx`));
  const rest:RestBone[]=source.bones.map((b,index)=>({index,name:b.name,parentIndex:b.parentIndex,
    translation:b.position.map((v,k)=>(v-(source.bones[b.parentIndex]?.position[k]??0))*.08) as [number,number,number],
    rotation:[0,0,0,1],scale:[1,1,1]}));
  const bones=rest.map(b=>{const bone=new Bone();bone.name=b.name;bone.position.fromArray(b.translation);bone.userData.pmxBone={index:b.index};return bone;});
  const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
  rest.forEach((b,i)=>(b.parentIndex<0?mesh:bones[b.parentIndex]).add(bones[i]));
  mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(bones));
  const metadata=source.bones.map((b,index)=>({index,name:b.name,flags:b.flag,layer:b.transformationClass,grant:b.grant,ik:b.ik}));
  return {source,rest,bones,mesh,metadata,directory,dispose:()=>{mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}};
}

test('real sources: all ten Uka chains and six Gene chains, exact identities, full XYZ bounds and ordered grant closure',async()=>{
  for(const model of ['uka','gene-light'] as const) {
    const f=await fixture(model);
    try {
      const op=comparisonIK(f.mesh,f.metadata);
      const expected=model==='uka'?[8,9,15,16,61,62,63,95,96,97]:[38,178,86,87,97,98];
      assert.deepEqual(op.state.controllers.map(c=>c.index),expected);
      assert.deepEqual(comparisonIK(f.mesh,f.metadata,true).state,op.state);
      for(const c of op.state.controllers) {
        const b=f.source.bones[c.index],ik=b.ik!;
        assert.equal(c.name,b.name);assert.equal(c.effector,ik.effector);assert.equal(c.iteration,ik.iteration);assert.equal(c.maxAngle,ik.maxAngle);
        assert.equal(c.layer,b.transformationClass);assert.equal(c.phase,'prePhysics');
        assert.deepEqual(c.links.map(l=>l.index),ik.links.map(l=>l.index));
        c.links.forEach((l,i)=>{if(ik.links[i].angleLimitation){
          const min=ik.links[i].lowerLimitationAngle!,max=ik.links[i].upperLimitationAngle!;
          assert.deepEqual(l.lower,[-max[0],-max[1],min[2]]);assert.deepEqual(l.upper,[-min[0],-min[1],max[2]]);
        }});
      }
      if(model==='uka') {assert.equal(op.state.available,true);assert.equal(op.state.supported,10);assert.deepEqual(op.state.grants,[],'eye grants remain outside IK closure');}
      else {
        assert.equal(op.state.available,true);assert.equal(op.state.supported,6);assert.equal(op.state.unsupported,0);
        op.apply(undefined,0);assert.deepEqual(op.state.executed,expected);assert.deepEqual(op.state.appliedGrants,[35]);
        assert.deepEqual(op.state.order.map(s=>[s.kind,s.index]),[['grant',35],...expected.map(i=>['ik',i])]);
        assert.deepEqual(op.state.controllers[1].links[0].lower,[-Math.fround(Math.PI/2),-Math.fround(Math.PI/2),-Math.fround(Math.PI/2)]);
      }
    } finally {f.dispose();}
  }
});

test('Uka all-chain IK changes legs and sleeves, restores every raw joint, seeks deterministically and obeys VMD switches',async()=>{
  const f=await fixture('uka');
  const op=comparisonIK(f.mesh,f.metadata,true),read=()=>f.bones.map(b=>b.quaternion.toArray());
  try {
    for(const id of ['04_littlesmile','02_laugh','22_apology']) {
      const vmd=parseVMD(await readFile(`${f.directory}/motion/${id}.vmd`));
      const binding=bindMotion({version:1,modelId:'ik-test',metersPerPMXUnit:.08,bones:f.rest},vmd,{preserveUnbound:true});
      const seek=(time:number)=>{
        op.restore();
        for(const p of evaluateMotion(binding,time)){f.bones[p.index].position.fromArray(p.translation);f.bones[p.index].quaternion.fromArray(p.rotation);}
        const raw=read();op.apply(vmd,time);return {raw,solved:read()};
      };
      for(const time of [0,4,10,.5,4,0]) {
        const a=seek(time);assert.equal(op.state.executed.length+op.state.disabledByMotion.length,10);assert.deepEqual(op.state.appliedGrants,[]);
        assert.ok([5,6,12,13].some(i=>a.raw[i].some((v,k)=>Math.abs(v-a.solved[i][k])>1e-6)),'bounded knee/foot IK has an effect, even for stationary leg keys');
        const b=seek(time);assert.deepEqual(a,b);
        op.restore();assert.deepEqual(read(),a.raw,'IK Off restores all writable links');
      }
      seek(4);op.restore();
      const off={...vmd,displays:[{frame:0,ik:f.metadata.filter(b=>b.ik).map(b=>({name:{text:b.name,terminated:true},enabled:0}))}]} as typeof vmd;
      const before=read();op.apply(off,1);assert.deepEqual(op.state.executed,[]);assert.equal(op.state.disabledByMotion.length,10);assert.deepEqual(read(),before);
      // Backwards absolute time clears all switches from later records.
      op.restore();op.apply({...off,displays:off.displays.map(r=>({...r,frame:30}))},0);assert.equal(op.state.executed.length,10);
    }
    const invalid=f.metadata.map(b=>({...b}));invalid[57].flags=(invalid[57].flags??0)|0x400;
    const blocked=comparisonIK(f.mesh,invalid,true);assert.equal(blocked.state.available,false);assert.match(blocked.state.reason,/fixed\/local-axis writable link/);
  } finally {f.dispose();}
});

test('IK adapter executes a genuine XYZ box and retains phase/layer/source order',()=>{
  const bones=[new Bone(),new Bone(),new Bone(),new Bone()];
  const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
  mesh.add(bones[0],bones[2],bones[3]);bones[0].add(bones[1]);bones[1].position.set(0,1,0);
  bones[2].position.set(.3,.9,.3).normalize();bones[3].position.copy(bones[2].position);
  mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(bones));
  const metadata=[{index:0,name:'link'},{index:1,name:'effector'},
    {index:2,name:'post',flags:0x1000,layer:-1,ik:{effector:1,iteration:40,maxAngle:.4,
      links:[{index:0,angleLimitation:1,lowerLimitationAngle:[-.6,-.6,-.6],upperLimitationAngle:[.6,.6,.6]}]}},
    {index:3,name:'pre',layer:2,ik:{effector:1,iteration:40,maxAngle:.4,links:[{index:0,angleLimitation:0}]}}];
  try {
    const op=comparisonIK(mesh,metadata,true);
    assert.equal(op.state.available,true);assert.deepEqual(op.state.controllers.map(c=>c.index),[3,2]);
    // Exercise the bounded chain by disabling only the earlier unrestricted chain.
    const motion={displays:[{frame:0,ik:[{name:{text:'pre',terminated:true},enabled:0}]}]} as unknown as ReturnType<typeof parseVMD>;
    const before=bones[1].position.distanceTo(bones[2].position);
    op.apply(motion,0);
    const effector=bones[1].position.clone().applyQuaternion(bones[0].quaternion);
    assert.ok(effector.distanceTo(bones[2].position)<before*.001);
    assert.ok(Math.abs(bones[0].quaternion.x)>.01 && Math.abs(bones[0].quaternion.z)>.01,'not a one-axis link shortcut');
    assert.deepEqual(op.state.executed,[2]);assert.deepEqual(op.state.disabledByMotion,[3]);
    op.restore();assert.deepEqual(bones[0].quaternion.toArray(),[0,0,0,1]);
    bones[0].scale.setScalar(0);assert.equal(op.validatePose(),false);op.apply(undefined,0);assert.deepEqual(op.state.executed,[]);
  } finally {mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}
});

// Independent oracle: the pinned library's own grant solver and ordered PMX
// helper, with physics explicitly disabled. No production adapter calculations
// are used to obtain the expected rotations or effector positions.
async function oracle(f:Awaited<ReturnType<typeof fixture>>) {
  const { MMDAnimationHelper }=await import('@takahirox/three-mmd/animation/MMDAnimationHelper.js');
  const { CCDIKSolver }=await import('@takahirox/three-mmd/animation/CCDIKSolver.js');
  const data=f.source.bones.map((b,index)=>({index,name:b.name,parent:b.parentIndex,pos:f.rest[index].translation,
    rotq:f.rest[index].rotation,scl:f.rest[index].scale,flag:b.flag,transformationClass:b.transformationClass,rigidBodyType:-1,
    grant:b.grant?{index,...b.grant,transformationClass:b.transformationClass}:undefined,
    ik:b.ik?{target:index,effector:b.ik.effector,iteration:b.ik.iteration,maxAngle:b.ik.maxAngle,links:b.ik.links.map(l=>({index:l.index,
      ...(l.angleLimitation?{rotationMin:new Vector3(-l.upperLimitationAngle![0],-l.upperLimitationAngle![1],l.lowerLimitationAngle![2]),
        rotationMax:new Vector3(-l.lowerLimitationAngle![0],-l.lowerLimitationAngle![1],l.upperLimitationAngle![2])}:{})}))}:undefined}));
  const mesh=f.mesh as unknown as Parameters<InstanceType<typeof MMDAnimationHelper>['createGrantSolver']>[0];
  mesh.geometry.userData.MMD={format:'pmx',iks:data.flatMap(b=>b.ik?[b.ik]:[]),rigidBodies:[],constraints:[],bones:data,grants:data.flatMap(b=>b.grant?[b.grant]:[])};
  const helper=new MMDAnimationHelper({pmxAnimation:true});helper.enable('physics',false);
  const grants=helper.createGrantSolver(mesh),iks=new CCDIKSolver(mesh,data.flatMap(b=>b.ik?[b.ik]:[]));
  return (motion:ReturnType<typeof parseVMD>|undefined,time:number,prerequisitesOnly=false)=>{
    const switches=new Map<string,boolean>();
    for(const r of [...(motion?.displays??[])].sort((a,b)=>a.frame-b.frame))if(r.frame<=time*30)
      for(const item of r.ik)if(item.name.terminated && item.name.text)switches.set(item.name.text,!!item.enabled);
    const ordered=data.map(b=>({...b,grant:prerequisitesOnly && (b.index!==35 || switches.get('右腕xcIK')===false)?undefined:b.grant,ik:switches.get(b.name)===false?undefined:b.ik})).sort((a,b)=>
      ((a.flag??0)&0x1000)-((b.flag??0)&0x1000)||(a.transformationClass??0)-(b.transformationClass??0)||a.index-b.index);
    // This is the reference library's ordered, non-recursive execution path.
    const animate=helper as unknown as {_animatePMXMesh:(...args:unknown[])=>void};
    animate._animatePMXMesh(mesh,ordered,iks,grants,false,false);
    animate._animatePMXMesh(mesh,ordered,iks,grants,true,false);
  };
}

test('Gene: all three pinned motions match independent ordered PMX oracle; grant materially changes arm IK, Off and backward seeks restore raw',async()=>{
  const f=await fixture('gene-light'),reference=await fixture('gene-light'),without=await fixture('gene-light');
  const op=comparisonIK(f.mesh,f.metadata),referenceApply=await oracle(reference);
  // A deliberately missing prerequisite is an ablation, never the public runtime.
  const noGrant=without.metadata.map(b=>b.index===35?{...b,grant:undefined,flags:b.flags!&~0x300}:b);
  const ablation=comparisonIK(without.mesh,noGrant);
  const samples:Record<string,unknown>[]=[];
  let materialEffect=0;
  try {
    for(const id of ['01_happy','02_laugh','22_apology']) {
      const vmd=parseVMD(await readFile(`${f.directory}/motion/${id}.vmd`));
      const binding=bindMotion({version:1,modelId:'gene-ik',metersPerPMXUnit:.08,bones:f.rest},vmd,{preserveUnbound:true});
      const seek=(time:number)=>{
        op.restore();ablation.restore();
        const poses=evaluateMotion(binding,time);
        for(const skin of [f,reference,without])for(const p of poses) {
          skin.bones[p.index].position.fromArray(p.translation);skin.bones[p.index].quaternion.fromArray(p.rotation);
        }
        const raw=f.bones.map(b=>({position:b.position.toArray(),rotation:b.quaternion.toArray()}));
        op.apply(vmd,time);referenceApply(vmd,time);ablation.apply(vmd,time);
        assert.equal(op.state.error,'');assert.equal(op.state.executed.length+op.state.disabledByMotion.length,6);
        assert.deepEqual(op.state.appliedGrants,[35]);
        let error=0;
        for(const i of [35,36,37,38,...f.metadata.filter(b=>b.ik).flatMap(b=>[b.index,b.ik!.effector,...b.ik!.links.map(l=>l.index)])]) {
          error=Math.max(error,f.bones[i].getWorldPosition(new Vector3()).distanceTo(reference.bones[i].getWorldPosition(new Vector3())));
          assert.ok(f.bones[i].quaternion.angleTo(reference.bones[i].quaternion)<1e-7);
        }
        assert.ok(error<1e-10);
        const expected=new Quaternion().fromArray(raw[35].rotation).multiply(new Quaternion().fromArray(raw[26].rotation));
        assert.ok(f.bones[35].quaternion.angleTo(expected)<1e-7,'ordinary append uses source local quaternion before controller 38');
        const effect=f.bones[37].getWorldPosition(new Vector3()).distanceTo(without.bones[37].getWorldPosition(new Vector3()));
        materialEffect=Math.max(materialEffect,effect);
        const solved=f.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
        op.restore();assert.deepEqual(f.bones.map(b=>({position:b.position.toArray(),rotation:b.quaternion.toArray()})),raw);
        return {solved,error,effect,raw};
      };
      for(const time of [0,.5,4,50/30,10,4,0]) {
        const a=seek(time),b=seek(time);assert.deepEqual(a,b);
        if(time===({"01_happy":.5,"02_laugh":4,"22_apology":50/30}[id]))samples.push({clip:id,time,oracleMaxWorldErrorMetres:a.error,grantAblationEffectorDistanceMetres:a.effect,
          raw35:a.raw[35],raw26:a.raw[26],solved35:a.solved[35],solved36:a.solved[36],solved37:a.solved[37]});
      }
      const off={...vmd,displays:[{frame:0,ik:[{name:{text:'右腕xcIK',terminated:true},enabled:0}]}]} as typeof vmd;
      // Applicable-grant oracle policy also follows VMD controller switches.
      reference.bones.forEach((b,i)=>{b.position.copy(f.bones[i].position);b.quaternion.copy(f.bones[i].quaternion);});
      op.apply(off,4);referenceApply(off,4,true);
      assert.deepEqual(op.state.disabledByMotion,[38]);assert.equal(op.state.executed.length,5);
      assert.deepEqual(op.state.appliedGrants,[],'a VMD-disabled arm does not run its prerequisite');
      f.bones.forEach((b,i)=>assert.ok(b.getWorldPosition(new Vector3()).distanceTo(reference.bones[i].getWorldPosition(new Vector3()))<1e-10));
      op.restore();
    }
    assert.ok(materialEffect>.001,`grant ablation must visibly move effector 37, measured ${materialEffect} m`);
    if(process.env.MMD_IK_EVIDENCE)await writeFile('docs/gene-grant-node-evidence.json',JSON.stringify({
      oracle:'@takahirox/three-mmd@0.1.2 MMDAnimationHelper._animatePMXMesh + GrantSolver + CCDIKSolver, physics=false; all source grants',
      policy:'Adapter executes only grant 35; oracle executes all grants. IK dependency poses agree.',materialEffect,samples:[...new Map(samples.map(s=>[s.clip,s])).values()]},null,2)+'\n');
  } finally {f.dispose();reference.dispose();without.dispose();}
});

test('grant graph/metadata failures are unavailable, evaluation is atomic and recovers',async()=>{
  const f=await fixture('gene-light');
  try {
    const bad=(edit:(m:typeof f.metadata)=>void,reason:RegExp)=>{
      const m=structuredClone(f.metadata);edit(m);const op=comparisonIK(f.mesh,m);
      assert.equal(op.state.available,false);assert.match(op.state.reason,reason);
      const before=f.bones.map(b=>b.quaternion.toArray());op.apply(undefined,0);assert.deepEqual(op.state.executed,[]);
      assert.deepEqual(f.bones.map(b=>b.quaternion.toArray()),before);
    };
    bad(m=>{m.splice(35,1);},/invalid or duplicate source identity/);
    bad(m=>{m[35].grant!.parentIndex=9999;},/missing grant source/);
    bad(m=>{m[35].grant!.parentIndex=35;},/cyclic grant/);
    bad(m=>{m[26].flags=m[26].flags!|0x100;m[26].grant={...m[35].grant!,parentIndex:35};},/cyclic grant/);
    bad(m=>{m[35].grant!.ratio=NaN;},/invalid grant rate/);
    bad(m=>{m[35].grant!.isLocal=true;},/unsupported grant flags/);
    bad(m=>{m[35].flags=m[35].flags!|0x1000;},/invalid grant phase\/layer order/);
    bad(m=>{m[35].layer=2;},/invalid grant phase\/layer order/);
    bad(m=>{m[26].flags=m[26].flags!|0x2000;},/external parent/);
    bad(m=>{m[38].ik!.links[0].index=35;},/invalid hierarchy/);
    bad(m=>{m[35].grant=undefined;},/unsupported grant flags/);
    bad(m=>{m[35].flags=m[35].flags!|0x80;m[35].grant!.isLocal=true;m[35].grant!.parentIndex=37;},/descendant/);
    const op=comparisonIK(f.mesh,f.metadata),other=comparisonIK(f.mesh,f.metadata);
    assert.equal(comparisonIKCompatible([op,other]),true);
    other.state.grants[0].rate=.5;assert.equal(comparisonIKCompatible([op,other]),false);
    other.state.grants[0].rate=1;
    other.bindings[0].bindTranslation[0]+=.1;assert.equal(comparisonIKCompatible([op,other]),false);other.bindings[0].bindTranslation[0]-=.1;
    other.bindings[0].translation![0]+=.1;assert.equal(comparisonIKCompatible([op,other]),false);
    f.bones[26].quaternion.setFromAxisAngle(new Vector3(0,0,1),.4);
    const raw=f.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
    let mutatedBeforeFailure=false;
    // Fail after the append write, rather than only failing preflight.
    const original=f.bones[36].updateMatrixWorld;
    f.bones[36].updateMatrixWorld=function(force){if(op.state.appliedGrants.length){mutatedBeforeFailure=f.bones[35].quaternion.angleTo(new Quaternion())>.3;throw new Error('injected downstream failure');}return original.call(this,force);};
    op.apply(undefined,0);f.bones[36].updateMatrixWorld=original;
    assert.equal(mutatedBeforeFailure,true);assert.match(op.state.error,/raw pose restored/);assert.deepEqual(op.state.executed,[]);assert.deepEqual(op.state.appliedGrants,[]);
    assert.deepEqual(f.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]),raw);
    op.restore();op.apply(undefined,0);assert.equal(op.state.error,'');assert.equal(op.state.executed.length,6);op.restore();
  } finally {f.dispose();}
});

test('ordinary/local rotation and translation grants match library with nonidentity rest, negative and extrapolated weights',async()=>{
  const f=await fixture('gene-light');
  try {
    f.mesh.position.set(.8,-.2,.1);f.mesh.rotation.y=.4;f.mesh.scale.setScalar(1.3);
    for(const isLocal of [false,true])for(const [affectRotation,affectPosition] of [[true,false],[false,true],[true,true]])for(const ratio of [-.5,0,.4,1.7]) {
      f.rest.forEach((r,i)=>{f.bones[i].position.fromArray(r.translation);f.bones[i].quaternion.fromArray(r.rotation);});
      for(const i of [7,26,35]) {
        f.bones[i].quaternion.setFromAxisAngle(new Vector3(.2,.6,.3).normalize(),.25);
        f.rest[i].rotation=f.bones[i].quaternion.toArray();
      }
      f.mesh.updateMatrixWorld(true);f.mesh.bind(f.mesh.skeleton);
      const grant={parentIndex:26,isLocal,affectRotation,affectPosition,ratio};
      const flags=(f.metadata[35].flags!&~0x380)|(isLocal?0x80:0)|(affectRotation?0x100:0)|(affectPosition?0x200:0);
      f.metadata[35]={...f.metadata[35],grant,flags};f.source.bones[35]={...f.source.bones[35],grant,flag:flags};
      const op=comparisonIK(f.mesh,f.metadata),applyReference=await oracle(f);
      assert.equal(op.state.available,true);
      f.bones[26].position.x+=.035;
      f.bones[26].quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7));
      f.bones[7].quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.2));
      const initial=f.bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()}));
      op.apply(undefined,0);
      const actual={p:f.bones[35].position.clone(),q:f.bones[35].quaternion.clone(),effector:f.bones[37].getWorldPosition(new Vector3())};
      initial.forEach((r,i)=>{f.bones[i].position.copy(r.p);f.bones[i].quaternion.copy(r.q);});f.mesh.updateMatrixWorld(true);
      applyReference(undefined,0);
      assert.ok(actual.p.distanceTo(f.bones[35].position)<1e-12);
      assert.ok(actual.q.angleTo(f.bones[35].quaternion)<1e-7);
      assert.ok(actual.effector.distanceTo(f.bones[37].getWorldPosition(new Vector3()))<1e-10);
    }
  } finally {f.dispose();}
});

test('IK -> grant -> IK interleaving reads the earlier solved source, not an all-grants-first pose',()=>{
  const bones=Array.from({length:8},()=>new Bone()),mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
  mesh.add(bones[0],bones[3],bones[7]);bones[0].add(bones[1],bones[4]);bones[1].add(bones[2]);bones[4].add(bones[5]);bones[5].add(bones[6]);
  bones[2].position.y=1;bones[6].position.y=1;bones[3].position.set(.6,.8,0);bones[7].position.set(.8,.6,0);
  mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(bones));
  const source:IKSourceBone[]=bones.map((_,index)=>({index,name:`bone-${index}`}));
  source[3].ik={effector:2,iteration:8,maxAngle:1,links:[{index:1,angleLimitation:0}]};
  source[4].flags=0x100;source[4].grant={parentIndex:1,ratio:1,isLocal:false,affectRotation:true,affectPosition:false};
  source[7].ik={effector:6,iteration:8,maxAngle:1,links:[{index:5,angleLimitation:0}]};
  try {
    const op=comparisonIK(mesh,source,true);assert.equal(op.state.available,true);op.apply(undefined,0);
    assert.deepEqual(op.state.order.map(s=>[s.kind,s.index]),[['ik',3],['grant',4],['ik',7]]);
    assert.ok(bones[4].quaternion.angleTo(bones[1].quaternion)<1e-7);
    assert.ok(bones[4].quaternion.angleTo(new Quaternion())>.5);
    op.restore();assert.ok(bones[4].quaternion.angleTo(new Quaternion())<1e-7);
  } finally {mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}
});
