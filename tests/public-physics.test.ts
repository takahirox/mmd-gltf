import { test } from 'node:test';
import { jointBounds, jointViolations } from './physics-joints';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Bone, Skeleton, SkinnedMesh, BufferGeometry, MeshBasicMaterial } from 'three';
import { parsePMX } from '../tools/pmx-to-gltf';
import { publicPhysicsSource } from '../tools/audit-public-physics';
import { physicsDiagnostics, physicsBindingDiagnostics } from '../packages/mmd-physics';
import { applyBoneMorphs, controlCount } from '../packages/mmd-morph';
import { parseVMD, bindMotion, evaluateMotion } from '../packages/mmd-vmd';
import { loadAmmoNode } from '../packages/three-mmd-physics/node';
import { PhysicsWorld } from '../packages/three-mmd-physics/world';
import { ComparisonPhysics, validatePublicPhysics, type PublicPhysicsBinding } from '../examples/comparison-physics';

for(const [id,file,bodyCount,jointCount,modes] of [['uka','MS_Uka',164,151,[27,0,137]],['gene-light','Gene_light',87,92,[25,9,53]]] as const)
 test(`${id}: pinned full physics source, explicit execution profile and independent deterministic worlds`,async()=>{
  const bytes=await readFile(`public/${id}/${file}.pmx`),model=parsePMX(bytes);
  const manifest=JSON.parse(await readFile(`tools/${id==='uka'?'uka':'gene-light'}-manifest.json`,'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files.find((f:any)=>f.path.endsWith('.pmx')).sha256);
  const binding:PublicPhysicsBinding={version:1,...publicPhysicsSource(model)};
  assert.equal(binding.physics.bodies.length,bodyCount);assert.equal(binding.physics.joints.length,jointCount);
  assert.deepEqual([0,1,2].map(mode=>binding.physics.bodies.filter(b=>b.mode===mode).length),modes);
  assert.equal(binding.solver.bones.filter(b=>b.fixedAxis).length,4);
  assert.deepEqual(physicsDiagnostics(binding.physics,binding.solver,{maxBoneUpdates:100_000_000}).map(d=>d.code),['fixed-axis','fixed-axis','fixed-axis','fixed-axis']);
  assert.deepEqual(physicsBindingDiagnostics(binding.physics,binding.solver),[]);
  validatePublicPhysics(binding);
  for(const [i,b] of binding.physics.bodies.entries()) {
    assert.equal(b.index,i);assert.equal(b.bone,(model.rigidBodies[i] as any).boneIndex);
    assert.equal(b.mask,(model.rigidBodies[i] as any).groupTarget);
    assert.equal(b.group,(model.rigidBodies[i] as any).groupIndex);
    assert.equal(b.mass,(model.rigidBodies[i] as any).weight);
  }
  assert.equal(binding.physics.bodies.filter(b=>b.mode===0 && b.mask===65535).length,id==='uka'?23:24);
  assert.equal(binding.physics.bodies.filter(b=>b.mask===0).length,id==='uka'?0:9);
  // Actual source collider shapes/materials/groups, moved into a controlled
  // overlap. Independent constants identify a torso and an eligible dynamic
  // collider. Gene’s nine source-zero counterweights must make no contact;
  // reversing only their filter provides an actual contacting positive control.
  const {api:contactAPI}=await loadAmmoNode();
  const eligibleCollider=id==='uka'?25:19;
  for(const sourceIndex of [eligibleCollider,...(id==='gene-light'?Array.from({length:9},(_,i)=>72+i):[])])
   for(const complement of [false,true]) {
    const shouldContact=(sourceIndex===eligibleCollider)!==complement;
    const sourcePair=[0,sourceIndex];
    const profile=structuredClone(binding.physics);
    profile.gravity=[0,0,0];profile.joints=[];
    profile.bodies=sourcePair.map((sourceIndex,index)=>({...profile.bodies[sourceIndex],index,bone:-1,mode:index===0?0:1,
      translation:[0,0,0],rotation:[0,0,0,1],mask:complement && index===1?65535-profile.bodies[sourceIndex].mask:profile.bodies[sourceIndex].mask}));
    const solver={version:2 as const,bones:[{index:0,name:'root',parentIndex:-1,translation:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number],layer:0,flags:0}]};
    const world=new PhysicsWorld(contactAPI,profile,solver,solver.bones);
    try {
      for(let tick=0;tick<10;tick++)world.resolve(solver.bones);
      const displacement=Math.hypot(...Array.from(world.bodyTransforms().get(1)!).slice(12,15));
      assert.ok(shouldContact?displacement>1e-3:displacement<1e-7,`${id} body ${sourceIndex}: real collider contact must follow source eligibility`);
    } finally {world.dispose();}
  }
  binding.physics.joints.forEach((j,i)=>{
    assert.equal(j.type,0);assert.equal(j.bodyA,(model.constraints[i] as any).rigidBodyIndex1);assert.equal(j.bodyB,(model.constraints[i] as any).rigidBodyIndex2);
    assert.deepEqual(j.angularLower,(model.constraints[i] as any).rotationLimitation1);
    assert.deepEqual(j.angularUpper,(model.constraints[i] as any).rotationLimitation2);
  });
  const bad=structuredClone(binding);bad.solver.bones.find(b=>b.fixedAxis)!.fixedAxis=[0,0,0];
  assert.throws(()=>validatePublicPhysics(bad),/fixed-axis/);
  const data=await readFile(`public/${id}/model.${id==='uka'?'gltf':'glb'}`);
  const json=id==='uka'?JSON.parse(data.toString()):JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  assert.equal(JSON.stringify(json.extras.publicPhysics),JSON.stringify(binding));
  assert.equal(json.scenes.length,1);assert.equal(json.skins.length,1);assert.equal(json.meshes.length,1);assert.equal(json.animations.length,3);
  assert.ok(!json.extensions?.MMD_physics);assert.ok(!json.animations.some((a:any)=>a.extensions.MMD_animation_vmd.solver));
  const roots=[0,1,2].map(index=>{
    const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
    const nodes=binding.solver.bones.map(b=>{const n=new Bone();n.name=b.name;n.position.fromArray(b.translation).multiplyScalar(index===0?12.5:1);n.userData.pmxBone={index:b.index};return n;});
    binding.solver.bones.forEach((b,i)=>(b.parentIndex<0?mesh:nodes[b.parentIndex]).add(nodes[i]));
    mesh.updateMatrixWorld(true);mesh.bind(new Skeleton(nodes));return mesh;
  });
  const baseline=PhysicsWorld.allocations;
  const physics=new ComparisonPhysics(binding,roots,5000);
  assert.equal(PhysicsWorld.allocations,baseline,'constructing the public binding never allocates a native world');
  const {api}=await loadAmmoNode();physics.setBackend(api);
  try {
    for(const clip of ['02_laugh','22_apology']) {
      const motion=parseVMD(await readFile(`public/${id}/motion/${clip}.vmd`));
      const vmd=bindMotion({version:1,modelId:'physics-test',metersPerPMXUnit:.08,bones:binding.solver.bones},motion,{preserveUnbound:true});
      const rawPose=evaluateMotion(vmd,35/120),morphModel=json.nodes.find((n:any)=>n.extras?.pmxMorph).extras.pmxMorph;
      assert.deepEqual(applyBoneMorphs(morphModel,Array(controlCount(morphModel)).fill(0),rawPose),rawPose,'zero-weight bone morphs must not perturb source quaternions before contacts');
      for(const ik of [false,true]) {
        physics.reset(motion,ik);
        const sample=(t:number)=>{const raw=evaluateMotion(vmd,t);physics.bindings.forEach(b=>b.write(raw));};
        await physics.seek(.25,sample);
        const checkJoints=()=>{
          for(const bodies of physics.bodyTransforms())for(const error of jointViolations(binding.physics,bodies)) {
            const bounds=jointBounds(id,error.index);
            assert.ok(error.linear<bounds.linear,`${id} ${clip} IK ${ik}: joint ${error.index} linear ${error.linear}`);
            assert.ok(error.angular<bounds.angular,`${id} ${clip} IK ${ik}: joint ${error.index} angular ${error.angular}`);
          }
        };
        checkJoints();
        const first=physics.bindings.map(b=>b.read()),created=physics.stats.worldsCreated;
        assert.equal(physics.stats.tick,30);
        assert.equal(physics.adapters[0].state.executed.length,ik?(id==='uka'?10:6):0);
        assert.equal(physics.adapters[0].state.appliedGrants.length,id==='uka'?2:11,'all source grants once, including cloak and IK prerequisites');
        const raw=evaluateMotion(vmd,.25);
        for(const body of binding.physics.bodies.filter(b=>b.mode===2 && b.bone!==-1))
          assert.ok(first[0][body.bone].translation.every((v,k)=>Math.abs(v-raw[body.bone].translation[k])<6e-8),'mode 2 preserves local translation under dynamic parents');
        for(const b of binding.solver.bones.filter(b=>b.flags&0x1000))
          assert.ok(first[0][b.index].translation.every((v,k)=>Math.abs(v-raw[b.index].translation[k])<6e-8),'post-physics authored child offsets survive writeback');
        const writers=binding.physics.bodies.filter(b=>b.mode!==0 && b.bone!==-1);
        assert.ok(writers.some(b=>first[0][b.bone].rotation.some((v,k)=>Math.abs(v-raw[b.bone].rotation[k])>1e-4)));
        for(const pose of first.slice(1))for(const b of pose) {
          const a=first[0][b.index];assert.ok(b.translation.every((v,k)=>Math.abs(v-a.translation[k])<2e-5));
          assert.ok(b.rotation.every((v,k)=>Math.abs(v-a.rotation[k])<2e-5));
        }
        await physics.seek(.251,sample);assert.equal(physics.stats.worldsCreated,created);assert.deepEqual(physics.bindings.map(b=>b.read()),first,'substeps hold without overwriting physical bones');
        await physics.seek(.3,sample);assert.equal(physics.stats.worldsCreated,created,'forward ticks reuse worlds');
        await physics.seek(.1,sample);await physics.seek(.25,sample);
        assert.deepEqual(physics.bindings.map(b=>b.read()),first,'backward reset/replay is deterministic');
        await physics.seek(.5,sample);checkJoints();
        physics.reset(undefined,false);assert.equal(PhysicsWorld.allocations,baseline);
      }
    }
    const controllerMotion=parseVMD(await readFile(`public/${id}/motion/02_laugh.vmd`));
    const controllerBinding=bindMotion({version:1,modelId:'switches',metersPerPMXUnit:.08,bones:binding.solver.bones},controllerMotion,{preserveUnbound:true});
    const switches={...controllerMotion,displays:[0,3,6].map((frame,i)=>({frame,ik:binding.solver.bones.filter(b=>b.ik).map(b=>({name:{text:b.name,terminated:true},enabled:i===1?0:1}))}))} as typeof controllerMotion;
    physics.reset(switches,true);
    const sampleControls=(t:number)=>physics.bindings.forEach(b=>b.write(evaluateMotion(controllerBinding,t)));
    await physics.seek(.15,sampleControls);assert.ok(physics.adapters.every(a=>a.state.executed.length===0));
    await physics.seek(.25,sampleControls);assert.ok(physics.adapters.every(a=>a.state.executed.length===(id==='uka'?10:6)));
    await physics.seek(.05,sampleControls);assert.ok(physics.adapters.every(a=>a.state.executed.length===(id==='uka'?10:6)));
    physics.reset(undefined,false);
    const sample=(t:number)=>physics.bindings.forEach(b=>b.write(binding.solver.bones));
    const pending=physics.seek(1,sample);physics.reset(undefined,false);
    assert.equal(await pending,false,'cancellation cannot publish or retain a stale world');
    assert.equal(PhysicsWorld.allocations,baseline);
    await assert.rejects(()=>physics.seek(31,sample),/30 second replay budget/);
    const invalid=structuredClone(binding.solver.bones);invalid.at(-1)!.rotation[0]=NaN;
    await assert.rejects(()=>physics.seek(0,()=>physics.bindings.forEach(b=>b.write(invalid))),/non-finite pose/);
    physics.reset(undefined,false);assert.equal(PhysicsWorld.allocations,baseline);
    physics.bindings.forEach(b=>b.write(binding.solver.bones));
    const limited=new ComparisonPhysics(binding,roots,0);limited.setBackend(api);
    try {await assert.rejects(()=>limited.seek(0,sample),/work budget/);}finally{limited.dispose();}
    assert.equal(PhysicsWorld.allocations,baseline);
  } finally {physics.dispose();roots.forEach(r=>{r.geometry.dispose();(r.material as MeshBasicMaterial).dispose();});}
  assert.equal(PhysicsWorld.allocations,baseline);
 });
