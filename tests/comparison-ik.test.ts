import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Bone, Skeleton, SkinnedMesh, BufferGeometry, MeshBasicMaterial } from 'three';
import { parsePMX } from '../tools/pmx-to-gltf';
import { parseVMD, bindMotion, evaluateMotion } from '../packages/mmd-vmd';
import { comparisonIK } from '../examples/comparison-ik';
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

test('real sources: all ten Uka chains and six Gene chains, exact identities, full XYZ bounds and dependency blocking',async()=>{
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
      if(model==='uka') {assert.equal(op.state.available,true);assert.equal(op.state.supported,10);}
      else {
        assert.equal(op.state.available,false);assert.equal(op.state.supported,5);assert.equal(op.state.unsupported,1);
        assert.match(op.state.reason,/append dependency 35/);op.apply(undefined,0);assert.deepEqual(op.state.executed,[]);
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
        const a=seek(time);assert.equal(op.state.executed.length+op.state.disabledByMotion.length,10);
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
