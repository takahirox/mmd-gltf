import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { AnimationMixer, Group, LoopOnce, Vector3, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBytes, validateString } from 'gltf-validator';
import Ajv from 'ajv';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { morphPMX, morphVMD, morphMapping } from '../tools/synthetic-morph';
import { motionMappings } from '../tools/synthetic-vmd';
import { bindMorphMotion, bindMotion, parseVMD, byteName } from '../packages/mmd-vmd';
import { evaluateWeight } from '../packages/mmd-morph';
import { createMorphRig, getMorphModel, getMorphWeights, applyMorphWeights, resetMorphWeights } from '../packages/three-mmd-morph';
import { createVPDRig, getVPDModel, bindVPD, parseVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { bindVMD, createVMDPlayer, getVMDPlayers, MMDVMDPlugin } from '../packages/three-mmd-vmd';
import { validatePayload, payloadMotion, EXTENSION_NAME } from '../packages/mmd-vmd/payload';
import { morphPosition, morphWeights } from './morph-oracle';
import { rigScale } from './vpd-oracle';
import { scalarLocal } from './vmd-oracle';
import { orientationError } from '../tools/vmd-animation';

globalThis.ProgressEvent ??= class extends Event {} as any;
const load = (data: Uint8Array | string, exact = false) => new GLTFLoader()
  .register(p => exact ? new MMDVMDPlugin(p) : { name: 'ordinary' })
  .parseAsync(typeof data === 'string' ? data : data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength) as ArrayBuffer, '');
const meshes = (scene: any) => { const out: Mesh[] = []; scene.traverse((n: Mesh) => { if (n.isMesh) out.push(n); }); return out; };
const snapshot = (scene: any) => { const out: any[] = []; scene.traverse((n: any) => {
  if (n.userData.pmxBone) out.push([n.position.toArray(),n.quaternion.toArray()]);
  if (n.isMesh) out.push([...(n.morphTargetInfluences ?? [])]);
}); return out; };
async function base(shape: 'box'|'wedge' = 'box', mode: 'bdef'|'static' = 'bdef') {
  const result = await convertModel(parsePMX(morphPMX(shape)),'.',{mode,scale:rigScale[shape]});
  const gltf = await load(await result.io.writeBinary(result.document));
  return { result,gltf,morph:createMorphRig(gltf.scene),rig: mode === 'bdef' ? createVPDRig(gltf.scene) : undefined };
}
const options = (motion: 'a'|'b') => ({mapping:motionMappings[motion],morphMapping});

test('binary PMX morph conversion: exact identity, scale/reflection once, target order/defaults, authored normals, unsupported losses and malformed records', async () => {
  for (const shape of ['box','wedge'] as const) {
    assert.deepEqual(await readFile(`tests/fixtures/morph-${shape}.pmx`),morphPMX(shape));
    for (const mode of ['static','bdef'] as const) {
      const {result,gltf,morph} = await base(shape,mode), metadata = getMorphModel(morph);
      assert.deepEqual(metadata.morphs.map(m=>[m.index,m.name,m.type,m.target]),
        [[0,'unsupported',0,4],[1,'笑い',1,0],[2,'overlap',1,1],[3,'笑い',1,2],[4,'untracked',1,3]]);
      assert.deepEqual(getMorphWeights(morph),[0,0,0,0,0]);
      const unpacked = await result.io.writeJSON(result.document);
      assert.equal((await validateString(JSON.stringify(unpacked.json),{externalResourceFunction: async(uri:string)=>unpacked.resources[uri]})).issues.numErrors,0);
      for(const buffer of unpacked.json.buffers ?? []) buffer.uri = `data:application/octet-stream;base64,${Buffer.from(unpacked.resources[buffer.uri!]).toString('base64')}`;
      assert.deepEqual(getMorphWeights(createMorphRig((await load(JSON.stringify(unpacked.json))).scene)),[0,0,0,0,0]);
      const loaded = meshes(gltf.scene); assert.equal(loaded.length,2);
      for (const mesh of loaded) {
        assert.equal(Object.keys(mesh.morphTargetDictionary!).length,5);
        assert.equal(mesh.geometry.morphAttributes.normal,undefined);
        assert.equal(mesh.geometry.morphTargetsRelative,true);
        const delta=mesh.geometry.morphAttributes.position![0];
        assert.ok(Math.abs(delta.getX(0)-0.25*rigScale[shape])<1e-8);
        assert.ok(Math.abs(delta.getZ(0)+0.2*rigScale[shape])<1e-8);
      }
      assert.deepEqual(metadata.morphs[0].group,[{index:1,rate:0.5}]);
      assert.equal((await validateBytes(await result.io.writeBinary(result.document))).issues.numErrors,0);
      applyMorphWeights(morph,[1.3,0.9,0,0,0]);
      loaded.forEach(m => assert.deepEqual(m.morphTargetInfluences,[1.3,0.9,0,0,0]));
      if (mode === 'static') {
        const copy = gltf.scene.clone(true), instance = createMorphRig(copy);
        applyMorphWeights(instance,[-2,3,0,0,0]);
        assert.deepEqual(getMorphWeights(morph),[1.3,0.9,0,0,0]);
        for (const mesh of meshes(copy)) {
          assert.notEqual(mesh.geometry,loaded[0].geometry);
          for (let i=0;i<24;i++) assert.ok(mesh.geometry.boundingBox!.containsPoint(mesh.getVertexPosition(i,new Vector3())));
        }
      }
      resetMorphWeights(morph); assert.deepEqual(getMorphWeights(morph),[0,0,0,0,0]);
    }
  }
  for (const mutate of [
    (m:any)=>m.morphs[1].elements[0].index=24,
    (m:any)=>m.morphs[1].elements[0].position=[0,NaN,0],
    (m:any)=>m.morphs[1].elements[0].position=[0,1e300,0],
    (m:any)=>m.morphs[1].elements[0].position=[0,0],
    (m:any)=>m.morphs[1].elementCount++,
    (m:any)=>m.morphs[1].name=null,
    (m:any)=>m.morphs[1].type=99,
  ]) {
    const m=parsePMX(morphPMX('box'));mutate(m);
    await assert.rejects(convertModel(m,'.'),/Morph/);
  }
  assert.throws(()=>parsePMX(morphPMX('box').subarray(0,-20)));
});

test('model-scoped morph binding: Japanese duplicates, byte names, invalid maps/collisions, unsupported/unmatched, frame policies and numeric limits', async () => {
  const b=await base(), model=getMorphModel(b.morph), vmd=parseVMD(morphVMD('a'));
  const bound=bindMorphMotion(model,vmd,{morphMapping});assert.equal(bound.tracks.length,2);
  assert.throws(()=>bindMorphMotion(model,vmd),/ambiguous/);
  for (const opts of [{morphMapping:{missing:1}}, {morphMapping:{'8fce82a2':99}}, {morphMapping:[]}, {morphMapping:null}, {morphUnmatched:'bad'}])
    assert.throws(()=>bindMorphMotion(model,vmd,opts as any),/VMD/);
  const one=structuredClone(vmd); one.morphs=[one.morphs.find(r=>r.name.text==='overlap')!];
  const name=(raw:number[])=>{one.morphs[0].name=byteName(raw);};
  for(const raw of [[0x82,...Array(14).fill(0)],[...Buffer.from('123456789012345')]]) {
    name(raw); assert.throws(()=>bindMorphMotion(model,one),/explicit mapping/);
    assert.equal(bindMorphMotion(model,one,{morphMapping:{[one.morphs[0].name.key]:2}}).tracks[0].index,1);
  }
  name([...Buffer.from('unsupported'),...Array(4).fill(0)]);
  assert.equal(bindMorphMotion(model,one).tracks[0].index,4);
  const legacyModel=structuredClone(model);legacyModel.version=1;legacyModel.morphs[0].target=null;
  delete legacyModel.morphs[0].group;delete legacyModel.morphs[0].unsupported;
  assert.throws(()=>bindMorphMotion(legacyModel,one),/unsupported/);
  assert.equal(bindMorphMotion(legacyModel,one,{morphUnmatched:'ignore'}).omitted,1);
  name([...Buffer.from('missing'),...Array(8).fill(0)]);
  assert.equal(bindMorphMotion(model,one,{morphUnmatched:'ignore'}).unmatched.length,1);
  name([...Buffer.from('overlap'),...Array(8).fill(0)]);
  one.morphs.push(structuredClone(one.morphs[0]));
  assert.throws(()=>bindMorphMotion(model,one),/duplicate morph frame/);
  one.morphs[1].name=byteName([...Buffer.from('other'),...Array(10).fill(0)]);
  assert.throws(()=>bindMorphMotion(model,one,{morphMapping:{other:2}}),/mapping byte-key/);
  assert.throws(()=>bindMorphMotion(model,one,{morphMapping:{[one.morphs[1].name.key]:2}}),/repeated morph/);
  for(const value of [NaN,Infinity,1e300,10000.1,-10000.1]) {
    const bad=structuredClone(vmd);bad.morphs[0].weight=value;
    assert.throws(()=>bindMorphMotion(model,bad,{morphMapping}),/numeric range/);
  }
  const limits=structuredClone(vmd);limits.morphs.forEach((r,i)=>{r.weight=i%2?10000:-10000;});
  assert.equal(bindMorphMotion(model,limits,{morphMapping}).tracks.length,2);
  const track={index:0,keys:[{frame:6,weight:-1},{frame:30,weight:2}]};
  assert.equal(evaluateWeight(track,-100),-1);assert.equal(evaluateWeight(track,100),2);
  assert.equal(evaluateWeight(track,0.6),0.5);
  assert.equal(evaluateWeight({index:0,keys:[{frame:5,weight:1.5}]},99),1.5);
  assert.throws(()=>evaluateWeight(track,NaN),/finite/);
  const legacy=parseVMD(await readFile('tests/fixtures/motion-a.vmd'));
  assert.throws(()=>bindMotion(getVPDModel(b.rig!),legacy,{mapping:motionMappings.a}),/unmatched.*morph/);
});

test('combined lifecycle: atomic failures, manual pause, VPD preserves weights, zero untracked baseline, switching, bounds, instances and disposal', async () => {
  const a=await base(), b=await base(), rig=a.rig!, binding=bindVMD(rig,parseVMD(morphVMD('a')),options('a'));
  const p=createVMDPlayer(rig,binding), rest=snapshot(a.gltf.scene), other=snapshot(b.gltf.scene);
  assert.throws(()=>createVMDPlayer(b.rig!,binding),/different model instance/);
  p.seek(0.371); const desired=snapshot(a.gltf.scene);
  p.seek(0.719).seek(0).seek(0.371); assert.deepEqual(snapshot(a.gltf.scene),desired);
  p.play(); const before=snapshot(a.gltf.scene), time=p.time;
  for(const values of [[1,2],[0,0,NaN,0,0],[0,0,0,1e300,0]]) {
    assert.throws(()=>applyMorphWeights(a.morph,values));
    assert.equal(p.playing,true);assert.equal(p.time,time);assert.deepEqual(snapshot(a.gltf.scene),before);
  }
  assert.throws(()=>p.seek(NaN));assert.equal(p.playing,true);
  const damaged=meshes(a.gltf.scene)[1].morphTargetInfluences!;
  const last=damaged.pop()!;
  const invalidState=snapshot(a.gltf.scene);
  assert.throws(()=>p.seek(0.9),/weight count/);
  assert.equal(p.playing,true);assert.equal(p.time,time);assert.deepEqual(snapshot(a.gltf.scene),invalidState);
  damaged.push(last);
  applyMorphWeights(a.morph,[1.3,0.9,-0.1,0.2,0]);assert.equal(p.playing,false);
  const weights=getMorphWeights(a.morph);
  applyVPD(rig,bindVPD(rig,parseVPD(await readFile('tests/fixtures/pose-b.vpd'),'utf-8'),{mapping:{'0':259}}));
  assert.deepEqual(getMorphWeights(a.morph),weights);
  resetVPD(rig);assert.deepEqual(getMorphWeights(a.morph),weights);
  p.seek(0.371); assert.deepEqual(snapshot(a.gltf.scene),desired);
  meshes(a.gltf.scene).forEach(m=> {
    const mesh=m as SkinnedMesh, point=new Vector3();
    for(let i=0;i<24;i++)assert.ok(mesh.boundingBox!.containsPoint(mesh.getVertexPosition(i,point)));
  });
  const next=createVMDPlayer(rig,bindVMD(rig,parseVMD(morphVMD('b')),options('b')));
  p.play();next.seek(0.5);assert.equal(p.playing,false);
  next.stop();assert.deepEqual(snapshot(a.gltf.scene),rest);assert.deepEqual(snapshot(b.gltf.scene),other);
  p.reset(); next.dispose();next.dispose();assert.throws(()=>next.play(),/disposed/);p.dispose();
});

test('mesh-rooted morph handles pause the model owner and reject sparse vectors atomically', async () => {
  for (const shape of ['box', 'wedge'] as const) {
    const a = await base(shape), b = await base(shape);
    const instances = new Group(); instances.add(a.gltf.scene, b.gltf.scene);
    let morphNode: Object3D = a.gltf.scene;
    a.gltf.scene.traverse(node => { if (node.userData.pmxMorph) morphNode = node; });
    const morph = createMorphRig(morphNode);
    const p = createVMDPlayer(a.rig!, bindVMD(a.rig!, parseVMD(morphVMD('a')), options('a')));
    const other = createVMDPlayer(b.rig!, bindVMD(b.rig!, parseVMD(morphVMD('a')), options('a')));
    p.seek(0.371).play(); other.play();
    const before = snapshot(a.gltf.scene), time = p.time;
    const partial = [0, 0, 0, 0, 0]; delete partial[2];
    for (const handle of [a.morph, morph]) for (const values of [new Array<number>(5), partial]) {
      assert.throws(() => applyMorphWeights(handle, values), /weight count or FLOAT numeric range/);
      assert.equal(p.playing, true); assert.equal(p.time, time);
      assert.deepEqual(snapshot(a.gltf.scene), before);
    }
    const manual = [1.3, 0.9, -0.1, 0.2, 0];
    applyMorphWeights(morph, manual);
    assert.equal(p.playing, false); assert.equal(other.playing, true);
    p.update(0.1); assert.deepEqual(getMorphWeights(a.morph), manual);
    p.play(); resetMorphWeights(morph);
    assert.equal(p.playing, false); assert.deepEqual(getMorphWeights(a.morph), [0, 0, 0, 0, 0]);
    p.dispose(); other.dispose();
  }
});

test('extension weights affect only the referenced node primitives, excluding nested glTF nodes', async () => {
  const source = JSON.parse(await readFile('extensions/MMD_animation_vmd/examples/mixed-weights.gltf', 'utf8'));
  for (const primitiveCount of [1, 2]) for (const childHasTargets of [true, false]) {
    const json = structuredClone(source);
    while (json.meshes[0].primitives.length < primitiveCount)
      json.meshes[0].primitives.push(structuredClone(json.meshes[0].primitives[0]));
    let childMesh = 0; // Reuse the same mesh definition to require node-instance identity.
    if (!childHasTargets) {
      childMesh = 1;
      json.meshes.push({ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] });
    }
    json.nodes[0].children = [1];
    json.nodes.push({ name: 'Nested wrapper', children: [2] }, { name: 'Unanimated child', mesh: childMesh });
    const text = JSON.stringify(json), report = await validateString(text);
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    const exact = await load(text, true), core = await load(text);
    const player = getVMDPlayers(exact)[0], mixer = new AnimationMixer(core.scene);
    mixer.clipAction(core.animations[0]).play(); mixer.setTime(0.5); player.seek(0.5);
    const child = exact.scene.getObjectByName('Unanimated_child')!;
    const coreChild = core.scene.getObjectByName('Unanimated_child')!;
    assert.ok(child); assert.ok(coreChild);
    const childWeights = meshes(child).map(m => m.morphTargetInfluences ? [...m.morphTargetInfluences] : undefined);
    assert.deepEqual(childWeights, meshes(coreChild).map(m => m.morphTargetInfluences));
    const owned = meshes(exact.scene).filter(m => !meshes(child).includes(m));
    assert.equal(owned.length, primitiveCount);
    owned.forEach(m => assert.deepEqual(m.morphTargetInfluences, [1.5]));
    player.stop(); owned.forEach(m => assert.deepEqual(m.morphTargetInfluences, [0]));
    assert.deepEqual(meshes(child).map(m => m.morphTargetInfluences), childWeights);
    player.dispose(); mixer.stopAllAction();
  }
});

test('combined API/CLI GLB/unpacked, direct bytes and ordinary fallback against independent weights + morph-before-BDEF at keys and 1201 grid', async () => {
  const directory=await mkdtemp(join(tmpdir(),'mmd-morph-'));
  try {
    for (const rig of ['box','wedge'] as const) for(const motion of ['a','b'] as const) {
      assert.deepEqual(await readFile(`tests/fixtures/combined-${motion}.vmd`),morphVMD(motion));
      const opts={mode:'bdef' as const,scale:rigScale[rig],vmd:morphVMD(motion),vmdBinding:options(motion),
        vmdSampling:{translationTolerance:2e-8,rotationTolerance:2e-7}};
      const result=await convertModel(parsePMX(morphPMX(rig)),'.',opts), binary=await result.io.writeBinary(result.document);
      const again=await convertModel(parsePMX(morphPMX(rig)),'.',opts);
      assert.deepEqual(binary,await again.io.writeBinary(again.document));
      assert.equal((await validateBytes(binary)).issues.numErrors,0);
      const path=join(directory,`${rig}-${motion}.gltf`);
      await convertPMX(`tests/fixtures/morph-${rig}.pmx`,path,opts);
      const text=await readFile(path,'utf8');
      assert.equal((await validateString(text,{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))})).issues.numErrors,0);
      const json=JSON.parse(text);
      for(const buffer of json.buffers) buffer.uri=`data:application/octet-stream;base64,${(await readFile(join(directory,buffer.uri))).toString('base64')}`;
      const schema=JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8'));
      assert.ok(new Ajv({strict:false}).compile(schema)(json.animations[0].extensions[EXTENSION_NAME]));
      validatePayload(json.animations[0].extensions[EXTENSION_NAME],json.nodes.length);
      const direct=await base(rig), glb=await load(binary,true), unpacked=await load(JSON.stringify(json),true), fallback=await load(binary);
      const player=createVMDPlayer(direct.rig!,bindVMD(direct.rig!,parseVMD(opts.vmd),opts.vmdBinding));
      assert.equal(player.duration,motion === 'a' ? 1 : 1.5);
      const mixer=new AnimationMixer(fallback.scene),action=mixer.clipAction(fallback.animations[0]);
      action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
      const times=[...new Set([...parseVMD(opts.vmd).bones,...parseVMD(opts.vmd).morphs].map(k=>k.frame/30)),
        ...Array.from({length:1201},(_,i)=>player.duration*i/1200)];
      let maximumWeightError=0,maximumPositionError=0,maximumRotationError=0;
      const paths=[{asset:direct.gltf,seek:(t:number)=>player.seek(t)},
        {asset:glb,seek:(t:number)=>getVMDPlayers(glb)[0].seek(t)},
        {asset:unpacked,seek:(t:number)=>getVMDPlayers(unpacked)[0].seek(t)},
        {asset:fallback,seek:(t:number)=>{action.paused=false;action.enabled=true;mixer.setTime(t);fallback.scene.updateMatrixWorld(true);}}];
      assert.equal(glb.animations[0].tracks.length,0);assert.ok(fallback.animations[0].tracks.some(t=>t.name.includes('morphTargetInfluences')));
      for(const {asset,seek} of paths) {
        for(const t of times) {
          seek(t);
          asset.scene.traverse(n=>{if(n.userData.pmxBone) {
            const error=orientationError(n.quaternion.toArray(),scalarLocal(rig,motion,n.userData.pmxBone.index,t).rotation as any);
            assert.ok(error <= (asset === fallback ? 1e-4 : 1e-7));
            maximumRotationError=Math.max(maximumRotationError,error);
          }});
          for(const mesh of meshes(asset.scene)) {
            mesh.morphTargetInfluences!.forEach((w,i)=>{maximumWeightError=Math.max(maximumWeightError,Math.abs(w-morphWeights(motion,t)[i]));});
            const position=mesh.geometry.getAttribute('position');
            for(let i=0;i<position.count;i++) {
              const actual=mesh.getVertexPosition(i,new Vector3()).toArray();
              const expected=morphPosition(rig,motion,i,t,[position.getX(i),position.getY(i),position.getZ(i)]);
              maximumPositionError=Math.max(maximumPositionError,...actual.map((v,j)=>Math.abs(v-expected[j])));
            }
          }
        }
      }
      assert.ok(maximumWeightError<=1e-6,`weight ${maximumWeightError}`);
      assert.ok(maximumPositionError<=2e-6,`position ${maximumPositionError}`);
      assert.ok(maximumRotationError<=1e-4,`rotation ${maximumRotationError}`);
      console.log('Morph evidence:',JSON.stringify({rig,motion,maximumWeightError,maximumPositionError,maximumRotationError,grid:1201,paths:4}));
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',`tests/fixtures/morph-${rig}.pmx`,join(directory,'cli.glb'),
        '--mode','bdef','--scale',String(opts.scale),'--vmd',`tests/fixtures/combined-${motion}.vmd`,'--vmd-map',`tests/fixtures/motion-${motion}-map.json`,
        '--vmd-morph-map','tests/fixtures/morph-map.json','--vmd-translation-tolerance','2e-8','--vmd-rotation-tolerance','2e-7'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);assert.deepEqual(await readFile(join(directory,'cli.glb')),Buffer.from(binary));
      for(const mutate of [
        (j:any)=>j.animations[0].channels.pop(),
        (j:any)=>j.animations[0].extensions[EXTENSION_NAME].weights[0].sampler=999,
        (j:any)=>j.animations[0].samplers.at(-1).interpolation='STEP',
        (j:any)=>j.meshes[0].primitives[1].targets.pop(),
        (j:any)=>j.animations[0].channels.push(j.animations[0].channels.at(-1)),
      ]) {const bad=structuredClone(json);mutate(bad);await assert.rejects(load(JSON.stringify(bad),true),/MMD_animation_vmd/);}
      player.dispose();getVMDPlayers(glb)[0].dispose();getVMDPlayers(unpacked)[0].dispose();mixer.stopAllAction();
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('morph-only VMD needs no dummy bone keys and restores original rest and zero weights',async()=>{
  assert.deepEqual(await readFile('tests/fixtures/morph-only.vmd'),morphVMD('a',true));
  const b=await base(),vmd=parseVMD(morphVMD('a',true));assert.equal(vmd.bones.length,0);
  const result=await convertModel(parsePMX(morphPMX('box')),'.',{mode:'bdef',scale:0.2,vmd:morphVMD('a',true),vmdBinding:{morphMapping}});
  const binary=await result.io.writeBinary(result.document);assert.equal((await validateBytes(binary)).issues.numErrors,0);
  const loaded=await load(binary,true),p=getVMDPlayers(loaded)[0];
  assert.equal(p.duration,1);p.seek(0.5);assert.ok(getMorphWeights(createMorphRig(loaded.scene))[0]>0);
  p.stop();assert.deepEqual(snapshot(loaded.scene),snapshot(b.gltf.scene));p.dispose();
  const unpacked=await result.io.writeJSON(result.document);
  assert.equal((await validateString(JSON.stringify(unpacked.json),{externalResourceFunction:async(uri:string)=>unpacked.resources[uri]})).issues.numErrors,0);
  for(const buffer of unpacked.json.buffers??[]) buffer.uri=`data:application/octet-stream;base64,${Buffer.from(unpacked.resources[buffer.uri!]).toString('base64')}`;
  const reloaded=await load(JSON.stringify(unpacked.json),true),q=getVMDPlayers(reloaded)[0];
  q.seek(0.5);assert.ok(getMorphWeights(createMorphRig(reloaded.scene))[0]>0);
  q.stop();assert.deepEqual(snapshot(reloaded.scene),snapshot(b.gltf.scene));q.dispose();
  const bad=parseVMD(morphVMD('a',true));bad.morphs=bad.morphs.filter(r=>r.name.text==='笑い');
  bad.morphs[0].frame=0xffffffff;bad.morphs[1].frame=0xfffffffe;
  // The writer must reject distinct source keys that collapse to one FLOAT time.
  const {addVMDAnimation}=await import('../tools/vmd-animation');
  const bound=bindMotion(getVPDModel(b.rig!),bad,{morphMapping},getMorphModel(b.morph));
  addVMDAnimation(b.result.document,b.result.document.getRoot().listBuffers()[0],bound,[],{},b.result.document.getRoot().listNodes()[0]);
  assert.ok((b.result.document.getRoot().listAnimations().at(-1)!.getExtras() as any).vmd.diagnostics.some((d:any)=>d.code==='weight-sampling'));
});

test('morph-only real player: exact/multiple crossings, independent weights, original-rest bones, pause and endpoint', async () => {
  for (const shape of ['box', 'wedge'] as const) {
    const direct = await base(shape);
    const converted = await convertModel(parsePMX(morphPMX(shape)), '.', {
      mode: 'bdef', scale: rigScale[shape], vmd: morphVMD('a', true), vmdBinding: { morphMapping },
    });
    const glb = await load(await converted.io.writeBinary(converted.document), true);
    const players = [
      { asset: direct.gltf, player: createVMDPlayer(direct.rig!, bindVMD(direct.rig!, parseVMD(morphVMD('a', true)), { morphMapping })) },
      { asset: glb, player: getVMDPlayers(glb)[0] },
    ];
    for (const { asset, player } of players) {
      const bones = () => { const out: object[] = []; asset.scene.traverse(n => {
        if (n.userData.pmxBone) out.push([n.position.toArray(), n.quaternion.toArray()]);
      }); return out; };
      const rest = bones(), morph = createMorphRig(asset.scene);
      const check = (time: number, playing: boolean) => {
        assert.ok(Math.abs(player.time - time) < 1e-14);
        assert.equal(player.playing, playing);
        getMorphWeights(morph).forEach((w, i) => assert.ok(Math.abs(w - morphWeights('a', time)[i]) < 1e-7));
        assert.deepEqual(bones(), rest);
      };
      player.loop = true;
      player.seek(0).play().update(1); check(0, true);
      player.seek(0.99).update(0.01); check(0, true);
      player.seek(0.9).update(3.45); check(0.35, true);
      player.pause().update(10); check(0.35, false);
      player.loop = false;
      player.play().update(4); check(1, false);
      player.update(2); check(1, false);
      // A one-second periodic state can evade Playwright's default polling
      // schedule under delayed delivery for its five-second budget. Crossings still occurred.
      player.loop = true;
      player.seek(0.99).play();
      const polls = [0, 0.95, 1.95, 2.95, 3.95, 4.95];
      let previous = 0, crossings = 0;
      const sampled: number[] = [];
      for (const elapsed of polls) {
        const delta = elapsed - previous;
        crossings += Math.floor(player.time + delta);
        player.update(delta); previous = elapsed; sampled.push(player.time);
      }
      assert.ok(crossings >= 4);
      assert.ok(sampled.every(t => t >= 0.5), JSON.stringify(sampled));
      check(0.94, true);
      console.log('Morph loop polling evidence:', JSON.stringify({ shape, path: asset === glb ? 'glb' : 'bytes', polls, sampled, crossings }));
      player.stop(); assert.deepEqual(bones(), rest); assert.deepEqual(getMorphWeights(morph), [0, 0, 0, 0, 0]);
      player.dispose();
    }
  }
});

test('standalone v2 mixed draft example and schema; v1 remains readable without PMX metadata',async()=>{
  const text=await readFile('extensions/MMD_animation_vmd/examples/mixed-weights.gltf','utf8');
  const report=await validateString(text);assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
  const payload=JSON.parse(await readFile('extensions/MMD_animation_vmd/tests/valid-mixed.json','utf8'));
  const schema=JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8'));
  assert.ok(new Ajv({strict:false}).compile(schema)(payload));validatePayload(payload,1);
  assert.throws(()=>payloadMotion(payload),/resolved core weight/);
  for(const mutate of [
    (p:any)=>p.weights.push(p.weights[0]),(p:any)=>p.weights[0].node=1,
    (p:any)=>p.weights[0].sampler=-1,(p:any)=>p.version=1,
    (p:any)=>p.weights=[],(p:any)=>p.weights[0].extra=1,
  ]) {const bad=structuredClone(payload);mutate(bad);assert.throws(()=>validatePayload(bad,1));}
  const gltf=await load(text,true), player=getVMDPlayers(gltf)[0];
  player.seek(0.5);assert.equal(meshes(gltf.scene)[0].morphTargetInfluences![0],1.5);
  player.stop();assert.equal(meshes(gltf.scene)[0].morphTargetInfluences![0],0);player.dispose();
  const only=JSON.parse(text);
  only.animations[0].extensions[EXTENSION_NAME].rest=[];
  only.animations[0].extensions[EXTENSION_NAME].tracks=[];
  only.animations[0].channels=only.animations[0].channels.filter((c:any)=>c.target.path==='weights');
  const staticMorph=await load(JSON.stringify(only),true),staticPlayer=getVMDPlayers(staticMorph)[0];
  staticPlayer.seek(0.5);assert.equal(meshes(staticMorph.scene)[0].morphTargetInfluences![0],1.5);
  staticPlayer.stop();staticPlayer.dispose();
  for (const fault of ['negative-time','duplicate-time','nan-time','infinite-weight','large-weight','normalized','fractional-count']) {
    const json=JSON.parse(text), sampler=json.animations[0].samplers[2];
    if (fault==='normalized') json.accessors[sampler.output].normalized=true;
    else if (fault==='fractional-count') json.accessors[sampler.input].count=1.5;
    else {
      const data=Buffer.from(json.buffers[0].uri.split(',')[1],'base64');
      const a=json.accessors[fault.endsWith('weight') ? sampler.output : sampler.input];
      const offset=json.bufferViews[a.bufferView].byteOffset+(a.byteOffset??0);
      data.writeFloatLE(fault==='negative-time'?-1:fault==='nan-time'?NaN:fault==='infinite-weight'?Infinity:fault==='large-weight'?10001:0,
        offset+(fault==='duplicate-time'?4:0));
      json.buffers[0].uri=`data:application/octet-stream;base64,${data.toString('base64')}`;
    }
    await assert.rejects(load(JSON.stringify(json),true),/MMD_animation_vmd/);
  }
});
