import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { Document } from '@gltf-transform/core';
import { addVMDAnimation } from '../tools/vmd-animation';
import { boneMorphPMX, boneMorphVMD } from '../tools/synthetic-bone-morph';
import { Euler, Quaternion, AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { validateBytes, validateString } from 'gltf-validator';
import { convertModel, parsePMX } from '../tools/pmx-to-gltf';
import { solverPMX, solverVMD } from '../tools/synthetic-solver';
import { syntheticVMD, motionMappings } from '../tools/synthetic-vmd';
import { physicsPMX } from '../tools/synthetic-physics';
import { pmx21Fixture } from './pmx21-fixture';
import { validateSolver, solvePose, solverDiagnostics, type SolverProfile } from '../packages/mmd-solver';
import { validatePhysics, physicsDiagnostics, type PhysicsProfile } from '../packages/mmd-physics';
import { MMDDiagnosticError } from '../packages/mmd-diagnostics';
import { decodeSource } from '../packages/mmd-diagnostics/bytes';
import { MMDSolverPlugin, getSolverModel } from '../packages/three-mmd-solver';
import { MMDVPDExporterPlugin } from '../packages/three-mmd-vpd/exporter';
import { MMDPhysicsExporterPlugin } from '../packages/three-mmd-physics/exporter';
import { MMDPhysicsPlugin, getPhysicsModel } from '../packages/three-mmd-physics';
import { PhysicsTimeline, PhysicsWorld } from '../packages/three-mmd-physics/world';
import { loadAmmoNode } from '../packages/three-mmd-physics/node';
import { MMDVMDPlugin, getVMDPlayers, bindVMD, retargetVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { type RestBone } from '../packages/mmd-vpd';
import { createVPDRig, getVPDModel } from '../packages/three-mmd-vpd';
import { parseVMD, evaluateMotion, bindMotion, omittedRecords, type MotionBinding } from '../packages/mmd-vmd';
import { validatePayload, payloadMotion } from '../packages/mmd-vmd/payload';

globalThis.ProgressEvent ??= class extends Event {} as any;
const load=(data:any)=>new GLTFLoader().register(p=>new MMDSolverPlugin(p)).register(p=>new MMDPhysicsPlugin(p)).register(p=>new MMDVMDPlugin(p)).parseAsync(data,'');
const glb=async(r:Awaited<ReturnType<typeof convertModel>>)=>{
  const b=await r.io.writeBinary(r.document);assert.equal((await validateBytes(b)).issues.numErrors,0);
  return load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
};
async function json(r:Awaited<ReturnType<typeof convertModel>>) {
  const out=await r.io.writeJSON(r.document);
  assert.equal((await validateString(JSON.stringify(out.json),{externalResourceFunction:async (uri:string)=>out.resources[uri]})).issues.numErrors,0);
  for(const b of out.json.buffers??[])b.uri=`data:application/octet-stream;base64,${Buffer.from(out.resources[b.uri!]).toString('base64')}`;
  return JSON.parse(JSON.stringify(out.json)) as any;
}
const category=(expected:string)=>(error:unknown)=>error instanceof MMDDiagnosticError && error.diagnostic.category===expected;
async function schema(name:string,p:unknown) {
  const file=await readFile(`extensions/${name}/schema/${name==='MMD_animation_vmd'?'animation':'glTF'}.${name}.schema.json`,'utf8');
  const check=new Ajv({strict:false}).compile(JSON.parse(file));assert.ok(check(p),JSON.stringify(check.errors));
}

test('three-axis and locked IK retain every axis, solve within limits, and survive GLB/glTF reload',async()=>{
  for(const locked of [false,true]) {
    const model=parsePMX(solverPMX('box'));
    model.bones[3].ik!.links[0]={index:1,angleLimitation:1,lowerLimitationAngle:locked?[0,0,0]:[-0.3,-0.2,-0.1],upperLimitationAngle:locked?[0,0,0]:[0.4,0.5,0.6]};
    const r=await convertModel(model,'.',{mode:'bdef',solver:'pre-physics-v1'}),j=await json(r),p=j.extensions.MMD_skeleton_solver as SolverProfile;
    assert.equal(p.version,3);assert.deepEqual(p.bones[3].ik!.links[0].limits,{lower:locked?[0,0,0]:[-0.4,-0.5,-0.1],upper:locked?[0,0,0]:[0.3,0.2,0.6]});
    await schema('MMD_skeleton_solver',p);
    const input=structuredClone(p.bones);input[1].rotation=new Quaternion().setFromEuler(new Euler(0.6,0.7,0.8)).toArray();
    const solved=solvePose(p,input),a=new Euler().setFromQuaternion(new Quaternion(...solved[1].rotation),'XYZ'),limits=p.bones[3].ik!.links[0].limits!;
    [a.x,a.y,a.z].forEach((v,i)=>assert.ok(v>=limits.lower[i]-1e-10&&v<=limits.upper[i]+1e-10));
    for(const asset of [await glb(r),await load(JSON.stringify(j))])assert.deepEqual(getSolverModel(asset.scene)!.profile,p);
  }
});

test('fixed/local/external bones and unsupported orders transport; missing references and cycles remain invalid',async()=>{
  const source=parsePMX(solverPMX('box'));
  source.bones[0].flag!|=0x2c00;source.bones[0].fixAxis=[1,0,0];source.bones[0].localXVector=[1,0,0];source.bones[0].localZVector=[0,0,1];source.bones[0].key=-17;
  const r=await convertModel(source,'.',{mode:'bdef',solver:'pre-physics-v1',vmd:solverVMD('a')});
  const j=await json(r),p=j.extensions.MMD_skeleton_solver as SolverProfile;
  assert.deepEqual(p.bones[0].fixedAxis,[1,0,0]);assert.deepEqual(p.bones[0].localAxes,{x:[1,0,0],z:[0,0,-1]});assert.equal(p.bones[0].externalParent,-17);
  assert.ok(r.diagnostics.some(d=>d.code==='unresolved-external-parent'));
  const asset=await load(JSON.stringify(j)),before=getSolverModel(asset.scene)!.nodes.get(0)!.position.toArray();
  assert.throws(()=>getVMDPlayers(asset)[0].seek(0.1),category('unsupported-capability'));
  assert.deepEqual(getSolverModel(asset.scene)!.nodes.get(0)!.position.toArray(),before);
  // Skeleton-only export exercises node remapping without relying on converter extras.
  const skeleton=getSolverModel(asset.scene)!.nodes.get(0)!.parent!;
  skeleton.traverse(n=>{n.userData={};});
  // Registry is attached to the scene, so retain the full scene and hide mesh geometry for export.
  asset.scene.children.filter(n=>n!==skeleton).forEach(n=>asset.scene.remove(n));
  const encoded=await new GLTFExporter().register(w=>new MMDVPDExporterPlugin(w)).parseAsync(asset.scene,{includeCustomExtensions:true}) as any;
  const reloaded=await load(JSON.stringify(encoded));assert.equal(getSolverModel(reloaded.scene)!.profile.bones[0].externalParent,-17);
  const late=structuredClone(p);late.bones[0].flags=0;delete late.bones[0].fixedAxis;delete late.bones[0].localAxes;delete late.bones[0].externalParent;late.bones[0].layer=100;
  validateSolver(late);assert.ok(solverDiagnostics(late).some(d=>d.code==='solver-order'));
  const missing=structuredClone(late);missing.bones[1].parentIndex=999;assert.throws(()=>validateSolver(missing),category('malformed-data'));
  const cycle=structuredClone(late);cycle.bones[0].parentIndex=1;assert.throws(()=>validateSolver(cycle),/cycle/);
});

test('fixed-axis solver with bone morphs retains motion and untouched rest channels through reload',async()=>{
  for(const maxSamples of [200_000,1]) {
    const source=parsePMX(boneMorphPMX('box')),raw=boneMorphVMD('a');
    source.bones[0].flag!|=0x400;source.bones[0].fixAxis=[1,0,0];
    const r=await convertModel(source,'.',{mode:'bdef',solver:'pre-physics-v1',vmd:raw,vmdBinding:{mapping:motionMappings.a},vmdSampling:{maxSamples}});
    const j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
    assert.ok(p.diagnostics.some((d:any)=>d.code==='fixed-axis'));
    assert.ok(p.diagnostics.some((d:any)=>d.code==='unexecuted-solver-or-physics'));
    assert.deepEqual(decodeSource(p.source),new Uint8Array(raw));
    for(const asset of [await glb(r),await load(JSON.stringify(j))]) {
      assert.deepEqual(getSolverModel(asset.scene)!.profile.bones[0].fixedAxis,[1,0,0]);
      const player=getVMDPlayers(asset)[0];
      assert.deepEqual(decodeSource(player.source!.source!),new Uint8Array(raw));
      assert.throws(()=>player.seek(0.5),category('unsupported-capability'));
    }
    const time=maxSamples===1 ? 0 : 0.5;
    const ordinary=await new GLTFLoader().parseAsync(JSON.stringify(j),'');
    const mixer=new AnimationMixer(ordinary.scene);mixer.clipAction(ordinary.animations[0]).play();mixer.setTime(time);
    const retained=payloadMotion(p,p.morphs),expected=evaluateMotion({...retained,solver:undefined},time);
    const boneNodes=new Map<number,any>();ordinary.scene.traverse(n=>{if(n.userData.pmxBone)boneNodes.set(n.userData.pmxBone.index,n);});
    for(const bone of expected) {
      const actual=boneNodes.get(bone.index)!;
      bone.translation.forEach((v,i)=>assert.ok(Math.abs(v-actual.position.toArray()[i])<2e-6));
      const dot=Math.abs(bone.rotation.reduce((sum,v,i)=>sum+v*actual.quaternion.toArray()[i],0));
      assert.ok(Math.abs(1-dot)<1e-6);
    }
    // The solver owns the full skeleton, including bones absent from sparse sampling.
    assert.equal(j.animations[0].channels.filter((c:any)=>c.target.path==='translation').length,p.rest.length);
  }
});

test('source IK counts and physics counts are distinct from configurable execution budgets',async()=>{
  const model=parsePMX(solverPMX('box'));model.bones[3].ik!.iteration=0x7fffffff;
  const r=await convertModel(model,'.',{mode:'bdef',solver:'pre-physics-v1'}),p=(await json(r)).extensions.MMD_skeleton_solver as SolverProfile;
  validateSolver(p);assert.equal(p.bones[3].ik!.iterations,0x7fffffff);assert.ok(solverDiagnostics(p).some(d=>d.category==='resource-exhaustion'));assert.throws(()=>solvePose(p,p.bones),category('resource-exhaustion'));
  const minimal=JSON.parse(await readFile('extensions/MMD_physics/examples/minimal.gltf','utf8'));
  const physics=minimal.extensions.MMD_physics as PhysicsProfile,solver=minimal.extensions.MMD_skeleton_solver as SolverProfile;
  physics.version=2;
  physics.bodies=Array.from({length:1025},(_,i)=>({...structuredClone(physics.bodies[0]),index:i,bone:-1}));
  const joint={index:0,name:'free',type:0 as const,bodyA:0,bodyB:1,frameA:{translation:[0,0,0],rotation:[0,0,0,1]},frameB:{translation:[0,0,0],rotation:[0,0,0,1]},linearLower:[1,1,1],linearUpper:[-1,-1,-1],angularLower:[1,1,1],angularUpper:[-1,-1,-1],linearSpring:[0,0,0],angularSpring:[0,0,0]} as PhysicsProfile['joints'][number];
  physics.joints=Array.from({length:4097},(_,i)=>({...structuredClone(joint),index:i}));validatePhysics(physics,solver);await schema('MMD_physics',physics);
  assert.ok(physicsDiagnostics(physics,solver).some(d=>d.code==='physics-count-budget'));
  assert.deepEqual(physicsDiagnostics(physics,solver,{maxBodies:2048,maxJoints:8192}),[]);
  const empty=structuredClone(p);empty.bones[3].ik!.links=[];validateSolver(empty);assert.equal(solvePose(empty,empty.bones).length,empty.bones.length);
  const {api}=await loadAmmoNode();assert.throws(()=>new PhysicsTimeline(api,physics,solver),category('resource-exhaustion'));assert.equal(PhysicsWorld.allocations,0);
});

test('inverted joint ranges stay free in transport and execute; long seek/settle limits preserve transport',async()=>{
  const model=parsePMX(physicsPMX('box'));
  const joint=model.constraints[0] as any;joint.translationLimitation1=[1,1,1];joint.translationLimitation2=[-1,-1,-1];joint.rotationLimitation1=[1,1,1];joint.rotationLimitation2=[-1,-1,-1];
  const r=await convertModel(model,'.',{mode:'bdef',physics:'rigid-body-v1',physicsSettle:60});
  assert.ok(r.diagnostics.some(d=>d.code==='physics-seek-budget'));
  const j=await json(r),p=j.extensions.MMD_physics as PhysicsProfile,s=j.extensions.MMD_skeleton_solver as SolverProfile;
  assert.equal(p.version,2);assert.deepEqual(p.joints[0].linearLower,[0.08,0.08,0.08]);assert.deepEqual(p.joints[0].linearUpper,[-0.08,-0.08,-0.08]);await schema('MMD_physics',p);
  for(const a of [await glb(r),await load(JSON.stringify(j))])assert.deepEqual(getPhysicsModel(a.scene)!.profile,p);
  const {api}=await loadAmmoNode(),timeline=new PhysicsTimeline(api,p,s);timeline.seek(0.05,()=>s.bones);const before=timeline.bodyTransforms();
  assert.throws(()=>timeline.seek(31,()=>s.bones),category('resource-exhaustion'));assert.deepEqual(timeline.bodyTransforms(),before);timeline.dispose();
  const extended=new PhysicsTimeline(api,p,s,{maxSeekSteps:4000,maxBoneUpdates:100_000_000});extended.seek(31,()=>s.bones);assert.equal(extended.time,31);extended.dispose();assert.equal(PhysicsWorld.allocations,0);
});

test('backend numeric limits preserve binary PMX physics through GLB/glTF reload', async () => {
  const { api } = await loadAmmoNode();
  for (const { mass, width, scale } of [
    { mass: 0, width: 0.25, scale: 1 },
    { mass: 1e-40, width: 0.25, scale: 1 },
    { mass: 3e38, width: 4, scale: 1 }, // Finite mass/size, overflowing backend inertia bound.
    { mass: 1, width: 3e38, scale: 1 },
    { mass: 1, width: 3e38, scale: 2 }, // Valid source FLOAT scales beyond FLOAT range.
    { mass: 1, width: 1e-44, scale: 0.001 }, // Positive scaled size underflows in Bullet FLOAT.
  ]) {
    const raw = physicsPMX('box');
    // Body 1: two length-prefixed names, filter/shape bytes, size and frame.
    const fields = raw.indexOf('physics body 1') + 'physics body 1'.length + 4 + 'Original Issue 45'.length;
    raw.writeFloatLE(mass, fields + 5 + 12 + 12 + 12);
    raw.writeFloatLE(width, fields + 5);
    const source = parsePMX(raw);
    assert.equal((source.rigidBodies[1] as any).weight, Math.fround(mass));
    assert.equal((source.rigidBodies[1] as any).type, 1);
    const r = await convertModel(source, '.', { mode: 'bdef', physics: 'rigid-body-v1', scale });
    const j = await json(r), p = j.extensions.MMD_physics as PhysicsProfile, s = j.extensions.MMD_skeleton_solver as SolverProfile;
    assert.equal(p.version, 2);
    assert.equal(p.bodies[1].mass, Math.fround(mass));
    assert.equal(p.bodies[1].size[0], Math.fround(width) * scale);
    validatePhysics(p, s);
    await schema('MMD_physics', p);
    const diagnostic = r.diagnostics.find(d => d.code === 'physics-numeric-range')!;
    assert.equal(diagnostic.category, 'unsupported-capability');
    assert.match(diagnostic.path, /bodies\[1\]/);
    assert.throws(() => validatePhysics({ ...p, version: 1 }, s), category('malformed-data'));
    const corrupt = structuredClone(p); corrupt.bodies[1].mass = -1;
    assert.throws(() => validatePhysics(corrupt, s), category('malformed-data'));
    for (const asset of [await glb(r), await load(JSON.stringify(j))]) {
      const retained = getPhysicsModel(asset.scene)!;
      assert.deepEqual(retained.profile, p);
      assert.deepEqual(Buffer.from(asset.userData.mmdSource.data, 'base64'), raw);
      assert.ok(asset.userData.diagnostics.some((d: any) => d.code === 'physics-numeric-range'));
      assert.throws(() => new PhysicsTimeline(api, retained.profile, retained.solver), category('unsupported-capability'));
      assert.equal(PhysicsWorld.allocations, 0);
    }
  }
});

test('version-2 FLOAT overflow in gravity, body values and joint records is an execution limit', async () => {
  const r = await convertModel(parsePMX(physicsPMX('box')), '.', { mode: 'bdef', physics: 'rigid-body-v1' });
  const j = await json(r), original = j.extensions.MMD_physics as PhysicsProfile, solver = j.extensions.MMD_skeleton_solver as SolverProfile;
  assert.equal(solver.version, 2); // Version-1 rejection must exercise physics numeric checks.
  const cases: { path: string; set: (p: PhysicsProfile, value: number) => void }[] = [
    { path: 'profile', set: (p, v) => { p.gravity[0] = v; } },
    { path: 'bodies[1]', set: (p, v) => { p.bodies[1].translation[0] = v; } },
    { path: 'bodies[1]', set: (p, v) => { p.bodies[1].friction = v; } },
    { path: 'joints[0]', set: (p, v) => { p.joints[0].frameA.translation[0] = v; } },
    { path: 'joints[0]', set: (p, v) => { p.joints[0].linearLower[0] = -v; } },
    { path: 'joints[0]', set: (p, v) => { p.joints[0].angularSpring[0] = v; } },
  ];
  for (const { path, set } of cases) {
    const profile = structuredClone(original); profile.version = 2;
    set(profile, Math.fround(3e38) * 2);
    validatePhysics(profile, solver);
    await schema('MMD_physics', profile);
    const diagnostic = physicsDiagnostics(profile, solver).find(d => d.code === 'physics-numeric-range')!;
    assert.equal(diagnostic.category, 'unsupported-capability');
    assert.equal(diagnostic.path, `MMD_physics ${path}`);
    assert.throws(() => validatePhysics({ ...profile, version: 1 }, solver), category('malformed-data'));
    for (const invalid of [NaN, Infinity, -Infinity]) {
      set(profile, invalid);
      assert.throws(() => validatePhysics(profile, solver), category('malformed-data'));
    }
  }
});

test('initial solver overflow retains binary PMX and a safe rest fallback through GLB/glTF reload', async () => {
  const raw = solverPMX('box');
  const bone4 = raw.indexOf('Original bone 4') + 'Original bone 4'.length;
  const bone5 = raw.indexOf('Original bone 5') + 'Original bone 5'.length;
  raw.writeFloatLE(100, bone4);
  raw.writeFloatLE(3e38, bone5 + 12 + 1 + 4 + 2 + 12 + 1);
  const source = parsePMX(raw);
  assert.equal(source.bones[4].position[0], 100);
  assert.equal(source.bones[5].grant!.ratio, Math.fround(3e38));
  const r = await convertModel(source, '.', { mode: 'bdef', solver: 'pre-physics-v1' });
  assert.ok(r.diagnostics.some(d => d.category === 'unsupported-capability' && d.code === 'solver-numeric-range'));
  const j = await json(r), profile = j.extensions.MMD_skeleton_solver as SolverProfile;
  assert.equal(profile.bones[5].append!.rate, Math.fround(3e38));
  for (const asset of [await glb(r), await load(JSON.stringify(j))]) {
    const retained = getSolverModel(asset.scene)!;
    assert.deepEqual(retained.profile, profile);
    assert.deepEqual(Buffer.from(asset.userData.mmdSource.data, 'base64'), raw);
    assert.ok(asset.userData.diagnostics.some((d: any) => d.code === 'solver-numeric-range'));
    for (const bone of profile.bones) {
      const node = retained.nodes.get(bone.index)!;
      assert.deepEqual(node.position.toArray(), bone.translation);
      assert.deepEqual(node.quaternion.toArray(), bone.rotation);
      assert.ok([...node.position.toArray(), ...node.quaternion.toArray()].every(Number.isFinite));
    }
    assert.throws(() => solvePose(profile, profile.bones), error => error instanceof MMDDiagnosticError && error.diagnostic.code === 'solver-numeric-range');
  }
});

test('solver numeric overflow retains binary PMX/VMD and a diagnosed usable fallback through GLB/glTF reload', async () => {
  const rawPMX = solverPMX('box'), rawVMD = solverVMD('a');
  // Bone 4 append ratio follows its position, parent/layer/flags, tail and source index.
  const fields = rawPMX.indexOf('Original bone 4') + 'Original bone 4'.length;
  rawPMX.writeFloatLE(3e38, fields + 12 + 1 + 4 + 2 + 12 + 1);
  const link = rawVMD.indexOf(Buffer.from('link\0'));
  for (const offset of [link, link + 111]) rawVMD.writeFloatLE(100, offset + 15 + 4);
  const source = parsePMX(rawPMX);
  assert.equal(source.bones[4].grant!.ratio, Math.fround(3e38));
  assert.equal(parseVMD(rawVMD).bones.find(b => b.name.text === 'link')!.translation[0], 100);
  const r = await convertModel(source, '.', { mode: 'bdef', solver: 'pre-physics-v1', scale: 0.2, vmd: rawVMD });
  const j = await json(r), p = j.animations[0].extensions.MMD_animation_vmd;
  assert.equal(p.solver.bones[4].append.rate, Math.fround(3e38));
  assert.deepEqual(decodeSource(p.source), new Uint8Array(rawVMD));
  assert.ok(r.diagnostics.some(d => d.category === 'unsupported-capability' && d.code === 'solver-numeric-range'));
  assert.ok(p.diagnostics.some((d: any) => d.code === 'unexecuted-morph-or-solver'));
  for (const asset of [await glb(r), await load(JSON.stringify(j))]) {
    const retained = getSolverModel(asset.scene)!, player = getVMDPlayers(asset)[0];
    assert.equal(retained.profile.bones[4].append!.rate, Math.fround(3e38));
    assert.deepEqual(Buffer.from(asset.userData.mmdSource.data, 'base64'), rawPMX);
    assert.deepEqual(decodeSource(player.source!.source!), new Uint8Array(rawVMD));
    assert.ok(player.diagnostics.some(d => d.code === 'solver-numeric-range'));
    const before = [...retained.nodes.values()].map(n => n.position.toArray());
    assert.throws(() => player.seek(0), error => error instanceof MMDDiagnosticError && error.diagnostic.code === 'solver-numeric-range');
    assert.deepEqual([...retained.nodes.values()].map(n => n.position.toArray()), before);
  }
  const ordinary = await new GLTFLoader().parseAsync(JSON.stringify(j), '');
  const mixer = new AnimationMixer(ordinary.scene);
  mixer.clipAction(ordinary.animations[0]).play(); mixer.setTime(0.5);
  assert.ok(Math.abs(ordinary.scene.getObjectByName('link')!.position.x - 20) < 2e-6);
  ordinary.scene.traverse(n => assert.ok([...n.position.toArray(), ...n.quaternion.toArray()].every(Number.isFinite)));
});

test('impulse morphs, soft bodies, multiple writers and cross-phase dependencies survive conversion without claiming simulation',async()=>{
  const bytes=pmx21Fixture('utf8',1,1,true).bytes,model=parsePMX(bytes);
  assert.equal(model.morphs[0].type,10);assert.equal(model.softBodies!.length,1);
  const r=await convertModel(model,'.',{mode:'qdef',physics:'rigid-body-v1'}),j=await json(r),p=j.extensions.MMD_physics as PhysicsProfile;
  assert.deepEqual(Buffer.from(j.extras.mmdSource.data,'base64'),bytes);assert.equal(p.retained!.impulseMorphs.length,1);assert.equal(p.retained!.softBodies.length,1);assert.ok(r.diagnostics.some(d=>d.code==='retained-physics-features'));
  const a=await glb(r);assert.deepEqual(getPhysicsModel(a.scene)!.profile,p);
  const meshes:any[]=[];a.scene.traverse(n=>{if((n as any).isMesh)meshes.push(n);});meshes.forEach(n=>n.removeFromParent());
  const exported=await new GLTFExporter().register(w=>new MMDPhysicsExporterPlugin(w)).parseAsync(a.scene,{includeCustomExtensions:true});
  assert.deepEqual(getPhysicsModel((await load(JSON.stringify(exported))).scene)!.profile,p);
  const corrupt=structuredClone(p);(corrupt.retained!.softBodies[0] as any).anchors[0].body=999;
  assert.throws(()=>validatePhysics(corrupt,j.extensions.MMD_skeleton_solver),category('malformed-data'));
  const repeated=parsePMX(physicsPMX('box'));(repeated.rigidBodies[2] as any).boneIndex=4;repeated.bones[5].flag!&=~0x1000;
  const unsupported=await convertModel(repeated,'.',{mode:'bdef',physics:'rigid-body-v1'});assert.ok(unsupported.diagnostics.some(d=>d.code==='physics-dependency'));
  const broken=structuredClone(model);(broken.softBodies![0] as any).anchors[0].body=999;await assert.rejects(convertModel(broken,'.',{mode:'qdef'}),category('malformed-data'));
});

test('VMD writer preserves unrelated channels added to the converted Document through GLB/glTF reload', async () => {
  const r = await convertModel(parsePMX(solverPMX('box')), '.', { mode: 'bdef', vmd: solverVMD('a') });
  const doc = r.document, animation = doc.getRoot().listAnimations()[0];
  const ownedCount = animation.listChannels().length;
  const node = doc.createNode('unrelated');
  doc.getRoot().listScenes()[0].addChild(node);
  const buffer = doc.getRoot().listBuffers()[0];
  const input = doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0, 10]));
  const output = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0, 0, 0, 10, 0, 0]));
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
  const j = await json(r), payload = j.animations[0].extensions.MMD_animation_vmd;
  assert.equal(payload.owned.length, ownedCount);
  assert.equal(j.animations[0].channels.length, ownedCount + 1);
  assert.ok(payload.owned.every((c: any) => j.nodes[c.node].name !== 'unrelated'));
  for (const asset of [await glb(r), await load(JSON.stringify(j))]) {
    const clip = asset.animations[0];
    assert.equal(clip.tracks.length, 1);
    assert.equal(clip.tracks[0].name, 'unrelated.position');
    assert.equal(clip.duration, 10);
    const mixer = new AnimationMixer(asset.scene);
    mixer.clipAction(clip).play(); mixer.setTime(5);
    assert.equal(asset.scene.getObjectByName('unrelated')!.position.x, 5);
    getVMDPlayers(asset)[0].seek(0.5);
    assert.equal(asset.scene.getObjectByName('unrelated')!.position.x, 5);
  }
});

test('fallback budget, FLOAT collapse and scene sections retain exact VMD and allow unrelated core channels',async()=>{
  const raw=syntheticVMD('a'),r=await convertModel(parsePMX(await readFile('tests/fixtures/bdef.pmx')),'.',{mode:'bdef',vmd:raw,vmdBinding:{mapping:motionMappings.a},vmdSampling:{maxSamples:1,rotationTolerance:1e-12}}),j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
  assert.equal(p.version,6);assert.deepEqual(decodeSource(p.source),new Uint8Array(raw));assert.ok(p.diagnostics.some((d:any)=>d.category==='fallback-limit'));validatePayload(p,j.nodes.length);await schema('MMD_animation_vmd',p);
  const a=await glb(r),player=getVMDPlayers(a)[0];assert.equal(player.source!.cameras.length,1);assert.equal(player.source!.lights.length,1);assert.equal(player.source!.shadows.length,1);
  player.seek(0.5);
  const foreign=j.nodes.length;j.nodes.push({name:'unrelated'});j.scenes[0].nodes.push(foreign);
  const extra=Buffer.alloc(32);extra.writeFloatLE(10,4);extra.writeFloatLE(1,20);
  const buffer=j.buffers.length,view=j.bufferViews.length,input=j.accessors.length,sampler=j.animations[0].samplers.length;
  j.buffers.push({byteLength:32,uri:'data:application/octet-stream;base64,'+extra.toString('base64')});
  j.bufferViews.push({buffer,byteOffset:0,byteLength:8},{buffer,byteOffset:8,byteLength:24});
  j.accessors.push({bufferView:view,componentType:5126,count:2,type:'SCALAR',min:[0],max:[10]},{bufferView:view+1,componentType:5126,count:2,type:'VEC3'});
  j.animations[0].samplers.push({input,output:input+1,interpolation:'LINEAR'});
  j.animations[0].channels.push({sampler,target:{node:foreign,path:'translation'}});
  const mixed=await load(JSON.stringify(j));assert.equal(mixed.animations[0].tracks.length,1);assert.match(mixed.animations[0].tracks[0].name,/unrelated.position/);assert.equal(mixed.animations[0].duration,10);
  new AnimationMixer(mixed.scene).clipAction(mixed.animations[0]).play().getMixer().setTime(0.5);
  getVMDPlayers(mixed)[0].seek(0.5);
  const bad=structuredClone(j);bad.animations[0].channels.push(structuredClone(bad.animations[0].channels[0]));await assert.rejects(load(JSON.stringify(bad)),/conflicting owned/);
  const motion=payloadMotion(p),exact=evaluateMotion(motion,0.5);
  for(const bone of exact) {
    const index=j.nodes[bone.index].extras.pmxRest.index;let actual:any;
    a.scene.traverse(n=>{if(n.userData.pmxBone?.index===index)actual=n;});
    assert.ok(actual);bone.translation.forEach((v,i)=>assert.ok(Math.abs(v-actual.position.toArray()[i])<1e-6));
  }
  const old=Buffer.concat([Buffer.alloc(30),raw.subarray(30,40),raw.subarray(50)]);old.write('Vocaloid Motion Data file');const parsed=parseVMD(old);assert.equal(parsed.modelName.raw.length,10);assert.equal(parsed.bones.length,7);assert.deepEqual(decodeSource(parsed.source!),new Uint8Array(old));
});

test('retargeting is opt-in, binds against target rest, and rejects ambiguity until explicitly mapped',async()=>{
  const raw=solverVMD('a');
  const a=await glb(await convertModel(parsePMX(solverPMX('box')),'.',{mode:'bdef'}));
  const b=await glb(await convertModel(parsePMX(solverPMX('wedge')),'.',{mode:'bdef'}));
  const ar=createVPDRig(a.scene),br=createVPDRig(b.scene),binding=bindVMD(ar,parseVMD(raw),{morphUnmatched:'ignore'});
  assert.throws(()=>createVMDPlayer(br,binding),/different model/);
  const rebound=retargetVMD(br,binding,{morphUnmatched:'ignore'}),player=createVMDPlayer(br,rebound);player.seek(0.5);player.dispose();
  const ambiguous=getVPDModel(br),name=parseVMD(raw).bones[0].name.text!;
  const target=ambiguous.bones.find(b=>b.name===name)!;
  ambiguous.bones.find(b=>b.index!==target.index)!.name=name;
  assert.throws(()=>bindMotion(ambiguous,parseVMD(raw),{morphUnmatched:'ignore'}),/ambiguous/);
  const mapped=bindMotion(ambiguous,parseVMD(raw),{morphUnmatched:'ignore',mapping:Object.fromEntries(parseVMD(raw).bones.map(r=>[r.name.key,getVPDModel(br).bones.find(b=>b.name===r.name.text)!.index]))});
  assert.ok(mapped.tracks.length>0);
  const bad=decodeSource(parseVMD(raw).source!);bad[0]=0;assert.throws(()=>parseVMD(bad),/header/);
});

test('comparison fixtures distinguish reverse-engineering evidence from original fidelity',async()=>{
  const evidence=JSON.parse(await readFile('tests/fixtures/mmd-comparison.json','utf8'));
  assert.equal(evidence.reference.originalMMDMeasured,false);
  assert.equal(evidence.cases.length,4);
  assert.ok(evidence.cases.every((c:any)=>c.originalMMDMeasured===false && c.evidence));
});

test('near-UINT32 VMD frames retain exact evaluation when distinct keys collapse to one FLOAT timestamp',async()=>{
  const raw=Buffer.alloc(54+222);raw.write('Vocaloid Motion Data 0002');raw.write('long motion',30);raw.writeUInt32LE(2,50);
  for(let i=0;i<2;i++) {
    const start=54+i*111;raw.write('root',start);raw.writeUInt32LE(0xfffffffe+i,start+15);raw.writeFloatLE(1+i,start+19);raw.writeFloatLE(1,start+43);
    raw.set([20,20,20,20,20,20,20,20,107,107,107,107,107,107,107,107],start+47);
  }
  const r=await convertModel(parsePMX(solverPMX('box')),'.',{mode:'bdef',vmd:raw}),j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
  assert.ok(p.diagnostics.some((d:any)=>d.category==='fallback-limit'));assert.equal(p.tracks[0].keys[0].frame,0xfffffffe);assert.equal(p.tracks[0].keys[1].frame,0xffffffff);
  const asset=await glb(r),player=getVMDPlayers(asset)[0];player.seek((0xfffffffe+0.5)/30);
  let root:any;asset.scene.traverse(n=>{if(n.userData.pmxBone?.index===0)root=n;});assert.ok(Math.abs(root.position.x-0.12)<1e-6);
  assert.deepEqual(decodeSource(player.source!.source!),new Uint8Array(raw));player.dispose();
});

test('scene-only VMD retains source duration/visibility without inventing a bone key',async()=>{
  const raw=Buffer.alloc(54+5*4+9);raw.write('Vocaloid Motion Data 0002');raw.writeUInt32LE(1,70);raw.writeUInt32LE(60,74);raw[78]=0;raw.writeUInt32LE(0,79);
  const r=await convertModel(parsePMX(solverPMX('box')),'.',{mode:'bdef',vmd:raw}),j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
  assert.deepEqual(p.tracks,[]);const asset=await glb(r),player=getVMDPlayers(asset)[0];assert.equal(player.duration,2);player.seek(2);assert.equal(player.visibility,0);assert.equal(player.source!.displays[0].frame,60);
});


test('valid large group bone rates retain PMX/VMD controls and usable core fallback through GLB/glTF reload',async()=>{
  const source=parsePMX(boneMorphPMX('box')),raw=boneMorphVMD('a');
  const mixed=source.morphs.find(m=>m.name==='mixed')!;
  for(const entry of mixed.elements as {index:number;ratio:number}[]) if(source.morphs[entry.index].type===2) entry.ratio=20000;
  const r=await convertModel(source,'.',{mode:'bdef',vmd:raw,vmdBinding:{mapping:motionMappings.a}}),j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
  assert.ok(r.diagnostics.some(d=>d.category==='unsupported-capability' && d.code==='morph-contribution-range'));
  assert.ok(r.diagnostics.some(d=>d.code==='unexecuted-morph-or-solver'));
  const group=p.controls.model.morphs.find((m:any)=>m.name==='mixed');
  assert.ok(group.group.filter((e:any)=>p.controls.model.morphs[e.index].type===2).every((e:any)=>e.rate===20000));
  assert.deepEqual(decodeSource(p.source),new Uint8Array(raw));
  for(const asset of [await glb(r),await load(JSON.stringify(j))]) {
    const player=getVMDPlayers(asset)[0];
    assert.deepEqual(decodeSource(player.source!.source!),new Uint8Array(raw));
    assert.ok(player.diagnostics.some(d=>d.code==='morph-contribution-range'));
    assert.throws(()=>player.seek(0),category('unsupported-capability'));
  }
  const ordinary=await new GLTFLoader().parseAsync(JSON.stringify(j),'');
  const mixer=new AnimationMixer(ordinary.scene);mixer.clipAction(ordinary.animations[0]).play();mixer.setTime(0.5);
  assert.ok(ordinary.animations[0].tracks.some(t=>t.name.includes('morphTargetInfluences')));
  ordinary.scene.traverse(n=>assert.ok([...n.position.toArray(),...n.quaternion.toArray()].every(Number.isFinite)));
});

const coarseMotion=(count:number)=>{
  let reads=0;
  const rest:RestBone[]=Array.from({length:count},(_,index)=>({index,name:`bone-${index}`,parentIndex:-1,get translation():RestBone['translation'] {reads++;return [0,0,0];},rotation:[0,0,0,1],scale:[1,1,1]}));
  const motion:MotionBinding={rest,tracks:rest.map(b=>({index:b.index,keys:[0,30].map(frame=>({frame,translation:[frame/30,0,0],rotation:[0,0,0,1],curves:Array.from({length:4},()=>[0,0,127,127]) as any}))})),duration:1,modelId:'coarse',unmatched:[],unmatchedMorphs:[],omitted:omittedRecords(parseVMD(syntheticVMD('a')))};
  const doc=new Document(),buffer=doc.createBuffer(),nodes=rest.map(b=>doc.createNode(b.name));
  return {motion,doc,buffer,nodes,reads:()=>reads};
};

test('coarse fallback evaluates each shared pose once across all remaining channels',()=>{
  for(const count of [100,300]) {
    const c=coarseMotion(count);
    addVMDAnimation(c.doc,c.buffer,c.motion,c.nodes,{maxSamples:1});
    assert.ok(c.reads()<=count*2,`${count} bones caused ${c.reads()} rest reads`);
    const channels=c.doc.getRoot().listAnimations()[0].listChannels();assert.equal(channels.length,count*2);
    for(const channel of channels) assert.deepEqual([...channel.getSampler()!.getInput()!.getArray()!],[0]);
  }
});

test('coarse recovery respects work already spent by adaptive solver sampling',async()=>{
  const r=await convertModel(parsePMX(solverPMX('box')),'.',{mode:'bdef',solver:'pre-physics-v1'}),solver=(await json(r)).extensions.MMD_skeleton_solver as SolverProfile;
  solver.version=3;
  solver.bones.find(b=>b.ik)!.ik!.iterations=Math.floor(20_000_000/solver.bones.length)-2;
  const motion=bindMotion({version:1,modelId:'budget',metersPerPMXUnit:0.08,bones:solver.bones,solver},parseVMD(solverVMD('a')),{preserveUnbound:true});
  motion.ik=solver.bones.filter(b=>b.ik).map(b=>({index:b.index,keys:[{frame:0,enabled:false}]}));
  const doc=new Document(),buffer=doc.createBuffer(),nodes=solver.bones.map(b=>doc.createNode(b.name));
  addVMDAnimation(doc,buffer,motion,nodes);
  const diagnostics=(doc.getRoot().listAnimations()[0].getExtras() as any).vmd.diagnostics;
  assert.ok(diagnostics.some((d:any)=>d.code==='fallback-evaluation-budget'));
  assert.ok(diagnostics.some((d:any)=>d.code==='fallback-rest-pose'));
  for(const channel of doc.getRoot().listAnimations()[0].listChannels()) assert.equal(channel.getSampler()!.getInput()!.getCount(),1);
});

test('cumulative physics replay work is bounded before each seek and retains long motion',async(t)=>{
  const raw=solverVMD('a');
  // Stretch bone keys to 20 seconds, within the per-seek limit.
  for(let i=0;i<raw.readUInt32LE(50);i++) {
    const offset=54+i*111+15;
    raw.writeUInt32LE(raw.readUInt32LE(offset)===0 ? 0 : 600,offset);
  }
  let resolutions=0,seeks=0;
  // Seven bones and one 16-iteration single-link IK cost 126 updates per pose.
  const maxResolutions=Math.floor(20_000_000/126);
  t.mock.method(PhysicsWorld.prototype,'resolve',(pose:RestBone[])=>{
    resolutions++;
    assert.ok(resolutions<=maxResolutions,'cumulative physics replay exceeded the conversion work budget');
    return pose;
  });
  const seek=PhysicsTimeline.prototype.seek;
  t.mock.method(PhysicsTimeline.prototype,'seek',function(this:PhysicsTimeline,...args:Parameters<PhysicsTimeline['seek']>) {
    seeks++;
    const replayPoses=Math.floor(args[0]/this.profile.fixedStep+1e-9)+1;
    assert.ok(resolutions+replayPoses<=maxResolutions,'over-budget physics replay must be rejected before execution');
    return seek.apply(this,args);
  });
  const r=await convertModel(parsePMX(physicsPMX('box')),'.',{mode:'bdef',physics:'rigid-body-v1',vmd:raw});
  assert.ok(seeks>1);assert.ok(resolutions>seeks);assert.ok(resolutions<=maxResolutions);
  assert.ok(r.diagnostics.some(d=>d.code==='fallback-evaluation-budget'));
  assert.ok(r.diagnostics.some(d=>d.code==='physics-fallback-reduced'));
  const j=await json(r),p=j.animations[0].extensions.MMD_animation_vmd;
  assert.deepEqual(decodeSource(p.source),new Uint8Array(raw));
  assert.equal(Math.max(...p.tracks.flatMap((track:any)=>track.keys.map((key:any)=>key.frame))),600);
  assert.ok(j.animations[0].samplers.every((s:any)=>j.accessors[s.input].count>0));
  for(const asset of [await glb(r),await load(JSON.stringify(j))]) {
    const player=getVMDPlayers(asset)[0];assert.equal(player.duration,20);
    assert.deepEqual(decodeSource(player.source!.source!),new Uint8Array(raw));
    assert.ok(player.diagnostics.some(d=>d.code==='fallback-evaluation-budget'));
  }
  assert.equal(PhysicsWorld.allocations,0);
});

test('physics carries the configured solver budget through capability checks and pre/post execution',async()=>{
  const source=parsePMX(physicsPMX('box'));source.bones[3].ik!.iteration=4_000_000;
  const r=await convertModel(source,'.',{mode:'bdef',physics:'rigid-body-v1'}),j=await json(r),p=j.extensions.MMD_physics as PhysicsProfile,s=j.extensions.MMD_skeleton_solver as SolverProfile;
  const budget={maxBoneUpdates:100_000_000};
  assert.deepEqual(solverDiagnostics(s,budget),[]);assert.deepEqual(physicsDiagnostics(p,s,budget),[]);
  assert.ok(physicsDiagnostics(p,s).some(d=>d.code==='solver-work-budget'));
  const {api}=await loadAmmoNode();assert.throws(()=>new PhysicsTimeline(api,p,s),category('resource-exhaustion'));
  const timeline=new PhysicsTimeline(api,p,s,budget);
  try {
    const disabled=new Map(s.bones.filter(b=>b.ik).map(b=>[b.index,false]));
    const pose=timeline.seek(p.fixedStep,()=>s.bones,()=>disabled);
    assert.equal(pose.length,s.bones.length);assert.ok(pose.every(b=>[...b.translation,...b.rotation].every(Number.isFinite)));
    assert.throws(()=>timeline.preflight(1),category('resource-exhaustion'));
  } finally {timeline.dispose();}
  assert.equal(PhysicsWorld.allocations,0);
});

test('solver-free visibility uses the latest qualifying frame in unsorted retained records',async()=>{
  const raw=Buffer.alloc(54+5*4+18);raw.write('Vocaloid Motion Data 0002');raw.writeUInt32LE(2,70);
  raw.writeUInt32LE(60,74);raw[78]=0;raw.writeUInt32LE(0,79);
  raw.writeUInt32LE(0,83);raw[87]=1;raw.writeUInt32LE(0,88);
  const r=await convertModel(parsePMX(solverPMX('box')),'.',{mode:'bdef',vmd:raw}),j=await json(r);
  for(const asset of [await glb(r),await load(JSON.stringify(j))]) {
    const player=getVMDPlayers(asset)[0];
    assert.deepEqual(player.source!.displays.map(k=>k.frame),[60,0]);
    player.seek(0);assert.equal(player.visibility,1);player.seek(1);assert.equal(player.visibility,1);player.seek(2);assert.equal(player.visibility,0);
    assert.deepEqual(player.source!.displays.map(k=>k.frame),[60,0]);
  }
});
