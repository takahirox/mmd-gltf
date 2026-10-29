import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AnimationMixer, LoopOnce, Vector3, type Object3D, type Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBytes, validateString } from 'gltf-validator';
import Ajv from 'ajv';
import { boneMorphPMX, boneMorphVMD } from '../tools/synthetic-bone-morph';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { MMDMorphPlugin, createMorphRig, getMorphModel, getMorphWeights, applyMorphWeights } from '../packages/three-mmd-morph';
import { createVPDRig, getVPDModel, bindVPD, applyVPD, resetVPD, parseVPD } from '../packages/three-mmd-vpd';
import { MMDVMDPlugin, getVMDPlayers, bindVMD, createVMDPlayer, parseVMD } from '../packages/three-mmd-vmd';
import { validateMorphPayload } from '../packages/mmd-morph/payload';
import { applyBoneMorphs, validateMorphModel } from '../packages/mmd-morph';
import { byteName } from '../packages/mmd-vmd';
import { motionMappings } from '../tools/synthetic-vmd';
import { orientationError } from '../tools/vmd-animation';
import { boneControls, bonePalette, bonePrediction, boneLocal, poseBoneLocal, predictedMorphLocal } from './bone-morph-oracle';
import { rigScale, mappings } from './vpd-oracle';
globalThis.ProgressEvent ??= class extends Event {} as any;
const load=(data:Uint8Array|string,exact=true)=>new GLTFLoader().register(p=>exact?new MMDVMDPlugin(p):{name:'ordinary'}).parseAsync(typeof data==='string'?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer,'');
const nodes=(root:Object3D)=>{const map=new Map<number,Object3D>();root.traverse(n=>{if(n.userData.pmxBone)map.set(n.userData.pmxBone.index,n);});return map;};
const snapshot=(root:Object3D)=>[...nodes(root)].map(([i,n])=>[i,n.position.toArray(),n.quaternion.toArray()]);
const close=(a:number[],b:number[],tol=2e-7)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<=tol),`${a} != ${b}`);
async function base(shape:'box'|'wedge'='box',mode:'bdef'|'sdef'|'qdef'='bdef') {
  const result=await convertModel(parsePMX(boneMorphPMX(shape,mode==='bdef'?'bdef':mode==='sdef'?'mixed-sdef':'mixed-qdef')),'.',{mode,scale:rigScale[shape]});
  const asset=await load(await result.io.writeBinary(result.document));
  return {asset,result,rig:createVPDRig(asset.scene),morph:createMorphRig(asset.scene)};
}
test('MMD_morphs standalone bone-only contract, schema and invalid semantics need no POSITION targets or PMX extras',async()=>{
  const json=JSON.parse(await readFile('extensions/MMD_morphs/examples/minimal.gltf','utf8'));
  const schema=JSON.parse(await readFile('extensions/MMD_morphs/schema/glTF.MMD_morphs.schema.json','utf8'));
  assert.ok(new Ajv({strict:false}).compile(schema)(json.extensions.MMD_morphs));
  assert.equal((await validateString(JSON.stringify(json))).issues.numErrors,0);
  validateMorphPayload(json.extensions.MMD_morphs,1);
  for(const p of JSON.parse(await readFile('extensions/MMD_morphs/tests/invalid.json','utf8')))assert.throws(()=>validateMorphPayload(p,1));
  const asset=await new GLTFLoader().register(p=>new MMDMorphPlugin(p)).parseAsync(JSON.stringify(json),'');
  const m=createMorphRig(asset.scene);applyMorphWeights(m,[0.5]);close(asset.scene.children[0].position.toArray(),[0,0.1,0]);
  applyMorphWeights(m,[-1]);close(asset.scene.children[0].position.toArray(),[0,-0.2,0]);
  const rig=createVPDRig(asset.scene);resetVPD(rig);close(asset.scene.children[0].position.toArray(),[0,-0.2,0]);
  const vmd=parseVMD(boneMorphVMD('a',true));vmd.morphs=vmd.morphs.filter(r=>r.name.text==='bone-x');
  for(const r of vmd.morphs) {const raw=Buffer.alloc(15);raw.write('lift');r.name=byteName([...raw]);r.weight=r.frame/30;}
  const player=createVMDPlayer(rig,bindVMD(rig,vmd));assert.equal(player.duration,1);player.seek(0.5);
  close(asset.scene.children[0].position.toArray(),[0,0.1,0]);player.stop();close(asset.scene.children[0].position.toArray(),[0,0,0]);player.dispose();
});
test('both parser paths and all skinning modes preserve reflection/scale once; source diagnostics and failures are atomic',async()=>{
  for(const shape of ['box','wedge'] as const)for(const mode of ['bdef','sdef','qdef'] as const) {
    const b=await base(shape,mode),m=getMorphModel(b.morph);
    assert.equal(m.version,3);assert.deepEqual(m.morphs.map(m=>m.target),[1,0,null,null,null,null,null,null,null]);
    assert.deepEqual(m.morphs.map(m=>m.control),[1,0,2,3,4,null,null,null,5]);
    close(m.morphs[2].bone![0].translation,[0.2,-0.1,-0.3].map(v=>v*rigScale[shape]));
    close(m.morphs[2].bone![0].rotation,[-Math.SQRT1_2,0,0,Math.SQRT1_2]);
    assert.equal(m.morphs[6].unsupported![0].index,5);assert.match(m.morphs[7].unsupported![0].reason,/nested/);
    const raw=getVPDModel(b.rig).bones;
    for(const weights of [[0,0,0,0,0,0],[0.3,0.7,-0.4,1.3,0.5,0],[0,-1,2,-0.5,0,0]]) {
      applyMorphWeights(b.morph,weights);
      b.asset.scene.traverse(n=>{const mesh=n as import('three').SkinnedMesh;if(mesh.isSkinnedMesh) {
        const joint=mesh.skeleton.bones.findIndex(n=>n.userData.pmxBone.index===259);
        close(Array.from(mesh.skeleton.boneMatrices!.slice(joint*16,joint*16+16)),bonePalette(shape,'rest',259,0,weights).elements,2e-6);
        for(let i=0;i<24;i++) {const p=mesh.getVertexPosition(i,new Vector3());assert.ok(mesh.boundingBox!.containsPoint(p));assert.ok(p.distanceTo(mesh.boundingSphere!.center)<=mesh.boundingSphere!.radius+1e-9);}
      }});
      const actual=applyBoneMorphs(m,weights,raw).find(b=>b.index===259)!;
      const expected=predictedMorphLocal(shape,weights,raw.find(b=>b.index===259)!.translation,raw.find(b=>b.index===259)!.rotation);
      close(actual.translation,expected.translation);close(actual.rotation,expected.rotation);
      const opposite=structuredClone(m);opposite.morphs[2].bone![0].rotation=opposite.morphs[2].bone![0].rotation.map(v=>-v) as any;
      close(applyBoneMorphs(opposite,weights,raw).find(b=>b.index===259)!.rotation,actual.rotation);
    }
    const before=snapshot(b.asset.scene);
    assert.throws(()=>applyMorphWeights(b.morph,[0,0,NaN,0,0,0]));assert.deepEqual(snapshot(b.asset.scene),before);
    for(const change of [(s:any)=>s.morphs[2].elements[0].index=999,(s:any)=>s.morphs[2].elements[0].rotation=[0,0,0,0],(s:any)=>s.morphs[2].elementCount=2,(s:any)=>s.morphs[0].elements[0].index=99]) {
      const source=parsePMX(boneMorphPMX(shape,mode==='qdef'?'mixed-qdef':mode==='sdef'?'mixed-sdef':'bdef'));change(source);await assert.rejects(convertModel(source,'.',{mode}));
    }
    const repeated=structuredClone(m);repeated.morphs[2].bone!.push({index:259,translation:[0,0,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]});
    close(applyBoneMorphs(repeated,[0,0,1,0,0,0],raw).find(b=>b.index===259)!.rotation,[-0.5,0.5,0.5,0.5]);
    for(const sign of [-1,1]) {const half=structuredClone(m);half.morphs[2].bone![0].rotation=[sign,0,0,0];close(applyBoneMorphs(half,[0,0,0.5,0,0,0],raw).find(b=>b.index===259)!.rotation,[Math.SQRT1_2,0,0,Math.SQRT1_2]);}
    const bad=structuredClone(m);bad.morphs[6].control=6;assert.throws(()=>validateMorphModel(bad));
  }
});
test('new mixed targets preserve legacy vertex-only group slots even with earlier mixed source indices',async()=>{
  const model=parsePMX(boneMorphPMX('box'));
  model.morphs.push({name:'legacy vertex group',englishName:'Original Issue 47 compatibility probe',type:0,elementCount:1,elements:[{index:1,ratio:0.25}]});
  model.metadata.morphCount=model.morphs.length;
  const result=await convertModel(model,'.',{mode:'bdef',scale:.2});
  const asset=await load(await result.io.writeBinary(result.document)),morph=createMorphRig(asset.scene),metadata=getMorphModel(morph);
  assert.equal(metadata.morphs[1].target,0);assert.equal(metadata.morphs[9].target,1);assert.equal(metadata.morphs[0].target,2);
});
test('bone-only VMD duration, independent controls, manual retained raw baseline, VPD handoffs, ownership and isolation',async()=>{
  for(const shape of ['box','wedge'] as const) {
    const b=await base(shape),other=await base(shape);
    const p=createVMDPlayer(b.rig,bindVMD(b.rig,parseVMD(boneMorphVMD('a')),{mapping:motionMappings.a}));
    p.seek(0.37).play().pause();const weights=boneControls('a',0.37);close(getMorphWeights(b.morph),weights);
    const saved=snapshot(b.asset.scene);applyMorphWeights(b.morph,getMorphWeights(b.morph));assert.deepEqual(snapshot(b.asset.scene),saved);
    p.play();applyMorphWeights(b.morph,[0,0,0.5,0.3,0,0]);assert.equal(p.playing,false);
    for(const pose of ['a','b'] as const) {
      applyMorphWeights(b.morph,[0,0,0.5,0.3,0,0]);
      const bound=bindVPD(b.rig,parseVPD(await readFile(`tests/fixtures/pose-${pose}.vpd`),pose==='a'?'shift_jis':'utf-8'),{mapping:mappings[pose]});
      applyVPD(b.rig,bound);const once=snapshot(b.asset.scene);applyVPD(b.rig,bound);assert.deepEqual(snapshot(b.asset.scene),once);
      for(const [index,node] of nodes(b.asset.scene)) {const expected=poseBoneLocal(shape,pose,index,[0,0,0.5,0.3,0,0]);close(node.position.toArray(),expected.translation);assert.ok(orientationError(node.quaternion.toArray(),expected.rotation as any)<1e-7);}
      assert.deepEqual(getMorphWeights(b.morph),[0,0,0.5,0.3,0,0]);resetVPD(b.rig);resetVPD(b.rig);
      p.seek(0.37);assert.deepEqual(snapshot(b.asset.scene),saved);
    }
    p.loop=true;p.seek(0.99).play().update(0.02);assert.ok(Math.abs(p.time-0.01)<1e-12);
    p.stop();assert.deepEqual(getMorphWeights(b.morph),Array(6).fill(0));
    assert.deepEqual(getMorphWeights(other.morph),Array(6).fill(0));
    const replacement=createVMDPlayer(b.rig,bindVMD(b.rig,parseVMD(boneMorphVMD('b')),{mapping:motionMappings.b}));
    p.play();replacement.seek(0.3);assert.equal(p.playing,false);p.dispose();assert.throws(()=>p.play(),/disposed/);replacement.dispose();
    const source=parsePMX(boneMorphPMX(shape,'bdef',true));
    const result=await convertModel(source,'.',{mode:'bdef',scale:rigScale[shape],vmd:boneMorphVMD('a',true)});
    const encoded=await result.io.writeBinary(result.document);assert.equal((await validateBytes(encoded)).issues.numErrors,0);
    const asset=await load(encoded),player=getVMDPlayers(asset)[0];assert.equal(player.duration,1);player.seek(0.5);
    assert.equal(getMorphWeights(createMorphRig(asset.scene)).length,2);
    assert.equal(result.document.getRoot().listMeshes()[0].listPrimitives()[0].listTargets().length,0);player.stop();player.dispose();
  }
});
test('mixed GLB/external glTF, API/CLI and ordinary fallback match independent noncommuting predictions at keys and 241 probes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mmd-bone-morph-'));
  try {
    for(const shape of ['box','wedge'] as const)for(const motion of ['a','b'] as const) {
      const options={mode:'bdef' as const,scale:rigScale[shape],vmd:boneMorphVMD(motion),vmdBinding:{mapping:motionMappings[motion]},vmdSampling:{translationTolerance:1e-7,rotationTolerance:1e-6}};
      const started=performance.now();
      const result=await convertModel(parsePMX(boneMorphPMX(shape)),'.',options),binary=await result.io.writeBinary(result.document);
      console.log('Bone morph conversion timing',JSON.stringify({shape,motion,ms:performance.now()-started}));
      assert.equal((await validateBytes(binary)).issues.numErrors,0);
      const path=join(directory,`${shape}-${motion}.gltf`);await convertPMX(`tests/fixtures/bone-morph-${shape}.pmx`,path,options);
      const text=await readFile(path,'utf8');assert.equal((await validateString(text,{externalResourceFunction:(u:string)=>readFile(join(directory,u))})).issues.numErrors,0);
      const json=JSON.parse(text);for(const b of json.buffers)b.uri=`data:application/octet-stream;base64,${(await readFile(join(directory,b.uri))).toString('base64')}`;
      const schema=JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8'));
      const check=new Ajv({strict:false}).compile(schema);assert.ok(check(json.animations[0].extensions.MMD_animation_vmd),JSON.stringify(check.errors));
      const direct=await base(shape),glb=await load(binary),gltf=await load(JSON.stringify(json)),fallback=await load(binary,false);
      const player=createVMDPlayer(direct.rig,bindVMD(direct.rig,parseVMD(options.vmd),options.vmdBinding));
      const mixer=new AnimationMixer(fallback.scene),action=mixer.clipAction(fallback.animations[0]);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
      let positionError=0,rotationError=0;
      const probes=[...new Set([0,...parseVMD(options.vmd).morphs.map(k=>k.frame/30),...Array.from({length:241},(_,i)=>player.duration*i/240)])];
      let vertexError=0;
      for(const [asset,seek] of [[direct.asset,(t:number)=>player.seek(t)],[glb,(t:number)=>getVMDPlayers(glb)[0].seek(t)],[gltf,(t:number)=>getVMDPlayers(gltf)[0].seek(t)],[fallback,(t:number)=>{action.paused=false;action.enabled=true;mixer.setTime(t);fallback.scene.updateMatrixWorld(true);}]] as const) {
        const boneNodes=nodes(asset.scene);
        for(const time of probes) {
          seek(time);
          asset.scene.traverse(n=>{const mesh=n as Mesh;if(mesh.isMesh)for(let i=0;i<24;i++)vertexError=Math.max(vertexError,mesh.getVertexPosition(i,new Vector3()).distanceTo(bonePrediction(shape,motion,i,time).p));});
          for(const index of [0,1,2,259]) {
            const n=boneNodes.get(index)!,expected=boneLocal(shape,motion,index,time);
            positionError=Math.max(positionError,...n.position.toArray().map((v,i)=>Math.abs(v-expected.translation[i])));
            rotationError=Math.max(rotationError,orientationError(n.quaternion.toArray(),expected.rotation as any));
          }
        }
      }
      assert.ok(vertexError<=2e-6,`vertex ${vertexError}`);
      assert.ok(positionError<=2e-6,`${positionError}`);assert.ok(rotationError<=1e-4,`${rotationError}`);
      console.log('Bone morph fallback evidence',JSON.stringify({shape,motion,probes:probes.length,vertexError,positionError,rotationError}));
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',`tests/fixtures/bone-morph-${shape}.pmx`,join(directory,'cli.glb'),'--mode','bdef','--scale',String(options.scale),'--vmd',`tests/fixtures/bone-morph-${motion}.vmd`,'--vmd-map',`tests/fixtures/motion-${motion}-map.json`,'--vmd-translation-tolerance','1e-7','--vmd-rotation-tolerance','1e-6'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);assert.deepEqual(await readFile(join(directory,'cli.glb')),Buffer.from(binary));
      for(const mutate of [(j:any)=>j.animations[0].channels.pop(),(j:any)=>j.extensions.MMD_morphs.model.morphs[2].bone[0].index=99,(j:any)=>j.nodes.find((n:any)=>n.extras?.pmxMorph).extras.pmxMorph.modelId='wrong']) {
        const bad=structuredClone(json);mutate(bad);await assert.rejects(load(JSON.stringify(bad)));
      }
      player.dispose();getVMDPlayers(glb)[0].dispose();getVMDPlayers(gltf)[0].dispose();mixer.stopAllAction();
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('bone inputs reach IK/append and pinned physics at initialization/every tick; handoffs restart history and disabled physics uses the solver',async()=>{
  const {physicsPMX}=await import('../tools/synthetic-physics');
  const {loadAmmoNode}=await import('../packages/three-mmd-physics/node');
  const {MMDPhysicsPlugin,PhysicsRig}=await import('../packages/three-mmd-physics');
  const {MMDSolverPlugin}=await import('../packages/three-mmd-solver');
  const {solvePose}=await import('../packages/mmd-solver');
  const ammo=await loadAmmoNode();
  for(const shape of ['box','wedge'] as const) {
    const source=parsePMX(physicsPMX(shape));
    source.morphs=[{name:'bone-x',englishName:'Original Issue 47 physics probe',type:2,elementCount:2,elements:[
      {index:0,position:[0.2,0,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]},
      {index:3,position:[0,0.2,0],rotation:[0,0,0,1]},
    ]}];source.metadata.morphCount=1;
    const result=await convertModel(source,'.',{mode:'bdef',scale:0.2,physics:'rigid-body-v1'});
    const asset=await new GLTFLoader().register(p=>new MMDPhysicsPlugin(p)).register(p=>new MMDSolverPlugin(p)).register(p=>new MMDVMDPlugin(p)).parseAsync((await result.io.writeBinary(result.document)).buffer as ArrayBuffer,'');
    const rig=createVPDRig(asset.scene),model=getVPDModel(rig),morph=createMorphRig(asset.scene),physics=new PhysicsRig(asset.scene,ammo.api);
    const vmd=parseVMD(boneMorphVMD('a',true));vmd.morphs=vmd.morphs.filter(r=>r.name.text==='bone-x');vmd.morphs.forEach(r=>r.weight=r.frame/30);
    const player=createVMDPlayer(rig,bindVMD(rig,vmd,{ikUnmatched:'ignore'}));
    const observed:{time:number;raw:any[]}[]=[],seek=physics.timeline.seek.bind(physics.timeline);
    physics.timeline.seek=(time,sample,controls)=>seek(time,t=>{const raw=sample(t);observed.push({time:t,raw:structuredClone(raw)});return raw;},controls);
    player.seek(0.1);assert.equal(observed.length,13);assert.equal(observed[0].time,0);
    for(const {time,raw} of observed) {
      const root=raw.find(b=>b.index===0),ik=raw.find(b=>b.index===3),rest=model.bones.find(b=>b.index===3)!;
      close(root.translation,[0.04*time,0,0]);close(root.rotation,[0,0,Math.sin(Math.PI*time/4),Math.cos(Math.PI*time/4)]);
      close(ik.translation,rest.translation.map((v,i)=>v+(i===1?0.04*time:0)));
    }
    const bodyBefore=JSON.stringify([...physics.timeline.bodyTransforms()]);
    let changed:Mesh|undefined;asset.scene.traverse(n=>{if(!changed && (n as Mesh).isMesh)changed=n as Mesh;});
    const originalWeights=changed!.morphTargetInfluences;changed!.morphTargetInfluences=[1];
    assert.throws(()=>player.seek(0.2),/Morph/);assert.equal(JSON.stringify([...physics.timeline.bodyTransforms()]),bodyBefore);
    changed!.morphTargetInfluences=originalWeights;
    const one=snapshot(asset.scene);player.seek(0.1);assert.deepEqual(snapshot(asset.scene),one);
    player.loop=true;player.seek(0.99).play().update(0.02);const loop=snapshot(asset.scene);player.seek(0.01);close(nodes(asset.scene).get(0)!.position.toArray(),(loop.find(b=>b[0]===0) as any)[1]);
    applyMorphWeights(morph,[0.5]);assert.equal(player.playing,false);const manual=snapshot(asset.scene);physics.reset();assert.deepEqual(snapshot(asset.scene),manual);
    physics.enabled=false;applyMorphWeights(morph,[0.5]);
    const raw=structuredClone(model.bones);raw.find(b=>b.index===0)!.translation[0]+=0.02;
    raw.find(b=>b.index===0)!.rotation=[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)];raw.find(b=>b.index===3)!.translation[1]+=0.02;
    const expected=solvePose(model.solver,raw);
    for(const b of expected) {const n=nodes(asset.scene).get(b.index)!;close(n.position.toArray(),b.translation);assert.ok(orientationError(n.quaternion.toArray(),b.rotation)<1e-7);}
    assert.notDeepEqual(expected.find(b=>b.index===1)!.rotation,model.bones.find(b=>b.index===1)!.rotation,'IK responds to morph input');
    physics.enabled=true;physics.reset();const restart=snapshot(asset.scene);physics.reset();assert.deepEqual(snapshot(asset.scene),restart);
    player.stop();assert.deepEqual(getMorphWeights(morph),[0]);player.dispose();physics.dispose();
  }
});

test('all generated bone/mixed GLB and external glTF outputs validate across skinning and motions; fallback budgets preserve retained motion',async()=>{
  const morphSchema=JSON.parse(await readFile('extensions/MMD_morphs/schema/glTF.MMD_morphs.schema.json','utf8'));
  const vmdSchema=JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8'));
  const ajv=new Ajv({strict:false}),check=ajv.compile(morphSchema),vmdCheck=ajv.compile(vmdSchema);let count=0;
  for(const shape of ['box','wedge'])for(const mode of ['bdef','sdef','qdef'])for(const state of ['rest','a','b']) {
    const directory=`public/bone/${shape}${mode==='bdef'?'':`-${mode}`}`,text=await readFile(`${directory}/${state}.gltf`,'utf8'),json=JSON.parse(text);
    assert.equal((await validateString(text,{externalResourceFunction:(uri:string)=>readFile(`${directory}/${uri}`)})).issues.numErrors,0);
    assert.equal((await validateBytes(await readFile(`${directory}/${state}.glb`))).issues.numErrors,0);
    assert.ok(check(json.extensions.MMD_morphs),JSON.stringify(check.errors));validateMorphPayload(json.extensions.MMD_morphs,json.nodes.length);
    if(state!=='rest')assert.ok(vmdCheck(json.animations[0].extensions.MMD_animation_vmd),JSON.stringify(vmdCheck.errors));count+=2;
  }
  const directory=await mkdtemp(join(tmpdir(),'mmd-bone-cli-'));let cliCount=0;
  try {
    for(const shape of ['box','wedge'])for(const mode of ['bdef','sdef','qdef'])for(const format of ['glb','gltf']) {
      const source=`public/bone/${shape}${mode==='bdef'?'':`-${mode}`}/source.pmx`,output=join(directory,`${shape}-${mode}.${format}`);
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',source,output,'--mode',mode,'--scale',String(rigScale[shape as 'box'|'wedge']),'--vmd','tests/fixtures/bone-morph-a.vmd','--vmd-map','tests/fixtures/motion-a-map.json'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);
      const bytes=await readFile(output),report=format==='glb'?await validateBytes(bytes):await validateString(bytes.toString('utf8'),{externalResourceFunction:(u:string)=>readFile(join(directory,u))});
      assert.equal(report.issues.numErrors,0);cliCount++;
    }
  } finally {await rm(directory,{recursive:true,force:true});}
  assert.equal(count,36);assert.equal(cliCount,12);console.log('Bone morph generated validation:',JSON.stringify({count,cliCount,errors:0}));
  const limited=await convertModel(parsePMX(boneMorphPMX('box')),'.',{mode:'bdef',scale:.2,vmd:boneMorphVMD('a'),vmdBinding:{mapping:motionMappings.a},vmdSampling:{maxSamples:1}});
  assert.ok((limited.document.getRoot().listAnimations()[0].getExtras() as any).vmd.diagnostics.some((d:any)=>d.category==='fallback-limit'));
});

test('standalone mixed contract scopes controls to explicit mesh references without PMX extras',async()=>{
  const b=await base(),doc=await b.result.io.writeJSON(b.result.document),json=doc.json as any;
  for(const n of json.nodes)delete n.extras;
  for(const buffer of json.buffers)buffer.uri=`data:application/octet-stream;base64,${Buffer.from(doc.resources[buffer.uri]).toString('base64')}`;
  const foreign=structuredClone(json.meshes[0]);foreign.primitives.forEach((p:any)=>p.targets=p.targets.slice(0,1));foreign.weights=[0];foreign.extras.targetNames=foreign.extras.targetNames.slice(0,1);
  const index=json.nodes.length;json.nodes.push({name:'unrelated morph mesh',mesh:json.meshes.length});json.meshes.push(foreign);json.scenes[0].nodes.push(index);
  const asset=await load(JSON.stringify(json)),morph=createMorphRig(asset.scene);
  applyMorphWeights(morph,[0.4,0.5,0.2,-0.1,0.3,0]);
  const unrelated=asset.scene.getObjectByName('unrelated_morph_mesh')??asset.scene.getObjectByName('unrelated morph mesh');
  assert.ok(unrelated);const weights:number[][]=[];unrelated.traverse(n=>{if((n as Mesh).isMesh)weights.push([...(n as Mesh).morphTargetInfluences!]);});
  assert.deepEqual(weights,[[0],[0]]);
});
