import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { AnimationMixer, LoopOnce, Vector3, type Mesh, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBytes, validateString } from 'gltf-validator';
import Ajv from 'ajv';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { groupPMX, groupVMD, groupMapping } from '../tools/synthetic-group';
import { motionMappings } from '../tools/synthetic-vmd';
import { bindMorphMotion, parseVMD, byteName } from '../packages/mmd-vmd';
import { createMorphRig, getMorphModel, getMorphWeights, applyMorphWeights, resetMorphWeights } from '../packages/three-mmd-morph';
import { createVPDRig, bindVPD, parseVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { bindVMD, createVMDPlayer, getVMDPlayers, MMDVMDPlugin } from '../packages/three-mmd-vmd';
import { validatePayload, EXTENSION_NAME } from '../packages/mmd-vmd/payload';
import { groupPosition, groupWeights } from './group-oracle';
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
  const result = await convertModel(parsePMX(groupPMX(shape)),'.',{mode,scale:rigScale[shape]});
  const gltf = await load(await result.io.writeBinary(result.document));
  return { result,gltf,morph:createMorphRig(gltf.scene),rig: mode === 'bdef' ? createVPDRig(gltf.scene) : undefined };
}
const options = (motion: 'a'|'b') => ({mapping:motionMappings[motion],morphMapping:groupMapping});

test('group API/CLI GLB/unpacked, direct bytes and ordinary fallback against independent weights + morph-before-BDEF at keys and 1201 grid', async () => {
  const directory=await mkdtemp(join(tmpdir(),'mmd-morph-'));
  try {
    for (const rig of ['box','wedge'] as const) for(const motion of ['a','b'] as const) {
      assert.deepEqual(await readFile(`tests/fixtures/group-${motion}.vmd`),groupVMD(motion));
      const opts={mode:'bdef' as const,scale:rigScale[rig],vmd:groupVMD(motion),vmdBinding:options(motion),
        vmdSampling:{translationTolerance:2e-8,rotationTolerance:2e-7}};
      const result=await convertModel(parsePMX(groupPMX(rig)),'.',opts), binary=await result.io.writeBinary(result.document);
      const again=await convertModel(parsePMX(groupPMX(rig)),'.',opts);
      assert.deepEqual(binary,await again.io.writeBinary(again.document));
      assert.equal((await validateBytes(binary)).issues.numErrors,0);
      const path=join(directory,`${rig}-${motion}.gltf`);
      await convertPMX(`tests/fixtures/group-${rig}.pmx`,path,opts);
      const text=await readFile(path,'utf8');
      assert.equal((await validateString(text,{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))})).issues.numErrors,0);
      const json=JSON.parse(text);
      for(const buffer of json.buffers) buffer.uri=`data:application/octet-stream;base64,${(await readFile(join(directory,buffer.uri))).toString('base64')}`;
      const schema=JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8'));
      assert.ok(new Ajv({strict:false}).compile(schema)(json.animations[0].extensions[EXTENSION_NAME]));
      validatePayload(json.animations[0].extensions[EXTENSION_NAME],json.nodes.length);
      const direct=await base(rig), glb=await load(binary,true), unpacked=await load(JSON.stringify(json),true), fallback=await load(binary);
      const player=createVMDPlayer(direct.rig!,bindVMD(direct.rig!,parseVMD(opts.vmd),opts.vmdBinding));
      for(const asset of [glb,unpacked,fallback])assert.deepEqual(getMorphModel(createMorphRig(asset.scene)),getMorphModel(direct.morph));
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
            mesh.morphTargetInfluences!.forEach((w,i)=>{maximumWeightError=Math.max(maximumWeightError,Math.abs(w-groupWeights(motion,t)[i]));});
            const position=mesh.geometry.getAttribute('position');
            for(let i=0;i<position.count;i++) {
              const actual=mesh.getVertexPosition(i,new Vector3()).toArray();
              const expected=groupPosition(rig,motion,i,t,[position.getX(i),position.getY(i),position.getZ(i)]);
              maximumPositionError=Math.max(maximumPositionError,...actual.map((v,j)=>Math.abs(v-expected[j])));
            }
          }
        }
      }
      assert.ok(maximumWeightError<=1e-6,`weight ${maximumWeightError}`);
      assert.ok(maximumPositionError<=2e-6,`position ${maximumPositionError}`);
      assert.ok(maximumRotationError<=1e-4,`rotation ${maximumRotationError}`);
      console.log('Group evidence:',JSON.stringify({rig,motion,maximumWeightError,maximumPositionError,maximumRotationError,grid:1201,paths:4}));
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',`tests/fixtures/group-${rig}.pmx`,join(directory,'cli.glb'),
        '--mode','bdef','--scale',String(opts.scale),'--vmd',`tests/fixtures/group-${motion}.vmd`,'--vmd-map',`tests/fixtures/motion-${motion}-map.json`,
        '--vmd-morph-map','tests/fixtures/group-map.json','--vmd-translation-tolerance','2e-8','--vmd-rotation-tolerance','2e-7'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);assert.deepEqual(await readFile(join(directory,'cli.glb')),Buffer.from(binary));
      const cliText=join(directory,'cli.gltf');
      const cliJSON=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',`tests/fixtures/group-${rig}.pmx`,cliText,
        '--mode','bdef','--scale',String(opts.scale),'--vmd',`tests/fixtures/group-${motion}.vmd`,'--vmd-map',`tests/fixtures/motion-${motion}-map.json`,
        '--vmd-morph-map','tests/fixtures/group-map.json'],{encoding:'utf8'});
      assert.equal(cliJSON.status,0,cliJSON.stderr);
      assert.equal((await validateString(await readFile(cliText,'utf8'),{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))})).issues.numErrors,0);
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


test('group fixtures: exact references, whole-group diagnostics, empty defaults, numeric/count limits and conversion atomicity',async()=>{
  const {validateMorphModel}=await import('../packages/mmd-morph');
  const {Document}=await import('@gltf-transform/core');
  const {createMorphTargets}=await import('../tools/pmx-morph');
  for(const shape of ['box','wedge'] as const) {
    assert.deepEqual(await readFile(`tests/fixtures/group-${shape}.pmx`),groupPMX(shape));
    const b=await base(shape),model=getMorphModel(b.morph);
    assert.equal(model.version,2);
    assert.deepEqual(model.morphs.map(m=>m.target),[4,0,1,2,3,5,6,7,null,null,null,null,null,null]);
    assert.deepEqual(model.morphs[5].group,[{index:1,rate:0.25},{index:1,rate:0.25},{index:2,rate:-0.5},{index:4,rate:0}]);
    assert.deepEqual(model.morphs.slice(9).map(m=>m.unsupported?.map(i=>i.reason)),[
      ['unsupported child family'],['nested group dependency'],['self dependency'],['cyclic group dependency'],['cyclic group dependency']]);
    const list=meshes(b.gltf.scene);
    assert.deepEqual(getMorphWeights(b.morph),Array(8).fill(0));
    for(const mesh of list) {
      const targets=mesh.geometry.morphAttributes.position!;
      assert.ok(Array.from(targets[6].array).every(v=>v===0));
      for(let i=0;i<24;i++) for(let c=0;c<3;c++) {
        assert.ok(Math.abs(targets[4].getComponent(i,c)-0.5*targets[0].getComponent(i,c))<1e-8);
        assert.ok(Math.abs(targets[5].getComponent(i,c)-(0.5*targets[0].getComponent(i,c)-0.5*targets[1].getComponent(i,c)))<1e-8);
      }
    }
    // Required 0.3 + 0.8 * 0.5 example, retaining independent controls.
    applyMorphWeights(b.morph,[0.3,0,0,0,0.8,0,0,0]);
    assert.deepEqual(getMorphWeights(b.morph),[0.3,0,0,0,0.8,0,0,0]);
    for(const mesh of list) for(let i=0;i<24;i++) {
      const p=mesh.geometry.getAttribute('position'),actual=mesh.getVertexPosition(i,new Vector3());
      const expected=[p.getX(i)+0.7*0.25*rigScale[shape],p.getY(i)+0.7*(i%4?0.3:0.1)*rigScale[shape],p.getZ(i)-0.7*0.2*rigScale[shape]];
      assert.ok(actual.distanceTo(new Vector3(...expected as [number,number,number]))<2e-6);
    }
    const vmd=parseVMD(groupVMD('a'));assert.throws(()=>bindMorphMotion(model,vmd),/ambiguous/);
    const unsupported=structuredClone(vmd);unsupported.morphs=[unsupported.morphs[0]];
    unsupported.morphs[0].name=byteName([...Buffer.from('mixed'),...Array(10).fill(0)]);
    assert.throws(()=>bindMorphMotion(model,unsupported),/unsupported/);
    const ignored=bindMorphMotion(model,unsupported,{morphUnmatched:'ignore'});
    assert.equal(ignored.omitted,1);assert.deepEqual(ignored.unmatched,[unsupported.morphs[0].name.key]);
    const badMetadata=structuredClone(model);badMetadata.morphs[9].target=8;
    assert.throws(()=>validateMorphModel(badMetadata),/target/);
    const badReferences=structuredClone(model);badReferences.morphs[0].group![0].index=14;
    assert.throws(()=>validateMorphModel(badReferences),/reference/);
    const badDiagnostic=structuredClone(model);badDiagnostic.morphs[9].unsupported=[];
    assert.throws(()=>validateMorphModel(badDiagnostic),/diagnostics/);
  }
  for(const mutate of [
    (m:any)=>m.metadata.morphCount++, (m:any)=>m.morphs[0].elementCount++,
    (m:any)=>m.morphs[0].elements[0].index=-1, (m:any)=>m.morphs[0].elements[0].index=14,
    (m:any)=>m.morphs[0].elements[0].index=1.5, (m:any)=>m.morphs[0].elements[0].ratio=NaN,
    (m:any)=>m.morphs[0].elements[0].ratio=Infinity,(m:any)=>m.morphs[0].elements[0].ratio=1e300,
    (m:any)=>delete m.morphs[0].elements[0].ratio,
    (m:any)=>m.morphs[13].name=null, (m:any)=>delete m.morphs[1].elements[0].position[0], (m:any)=>delete m.morphs[0].elements[0], (m:any)=>delete m.morphs[13],
  ]) {
    const m=parsePMX(groupPMX('box'));mutate(m);
    const doc=new Document(),buffer=doc.createBuffer(),mesh=doc.createMesh(),node=doc.createNode();
    assert.throws(()=>createMorphTargets(doc,buffer,mesh,node,m,0.2),/Morph/);
    assert.equal(doc.getRoot().listAccessors().length,0);assert.deepEqual(node.getExtras(),{});assert.deepEqual(mesh.getWeights(),[]);
    await assert.rejects(convertModel(m,'.'),/Morph/);
  }
  // Finite source rates/deltas may overflow only the compiled core group target.
  const wide=parsePMX(groupPMX('box'));
  wide.morphs[0].elements[0].ratio=3e38;wide.morphs[1].elements[0].position=[3e38,0,0];
  const result=await convertModel(wide,'.',{scale:0.2}),doc=result.document;
  assert.ok(result.diagnostics.some(d=>d.category==='fallback-limit' && d.code==='morph-target-numeric-range' && d.path==='PMX morphs[0]'));
  const mesh=doc.getRoot().listMeshes()[0],target=mesh.listPrimitives()[0].listTargets()[4];
  assert.ok(target.getAttribute('POSITION')!.getArray()!.every(v=>v===0));
  const vertex=mesh.listPrimitives()[0].listTargets()[0].getAttribute('POSITION')!.getArray()!;
  assert.ok(vertex.every(Number.isFinite));assert.ok(vertex.some(v=>v!==0));
});

test('binary group rates and declared source limits reject malformed data',async()=>{
  const bytes=Buffer.from(groupPMX('box')),name=Buffer.from('Original morph 0','utf16le');
  const offset=bytes.indexOf(name)+name.length+7; // panel/type/count/index precede rate
  bytes.writeFloatLE(NaN,offset);
  await assert.rejects(convertModel(parsePMX(bytes),'.'),/Morph.*FLOAT rate/);
  const model=parsePMX(groupPMX('box'));
  model.morphs=Array(65537).fill(model.morphs[0]);model.metadata.morphCount=65537;
  await assert.rejects(convertModel(model,'.'),/Morph.*limit 65536/);
});

test('group lifecycle: both poses/rigs, manual/reset, ownership, instances, actual loops, endpoint, atomic failures and disposal',async()=>{
  for(const shape of ['box','wedge'] as const) {
    const a=await base(shape),b=await base(shape),rig=a.rig!;
    const p=createVMDPlayer(rig,bindVMD(rig,parseVMD(groupVMD('a')),options('a')));
    const other=snapshot(b.gltf.scene);p.seek(0.5);const desired=snapshot(a.gltf.scene),weights=getMorphWeights(a.morph);
    for(const pose of ['a','b'] as const) {
      p.play();applyVPD(rig,bindVPD(rig,parseVPD(await readFile(`tests/fixtures/pose-${pose}.vpd`),pose==='a'?'shift_jis':'utf-8'),{mapping:pose==='a'?{'2':0,'3':259}:{'0':259}}));
      assert.equal(p.playing,false);assert.deepEqual(getMorphWeights(a.morph),weights);
      resetVPD(rig);assert.deepEqual(getMorphWeights(a.morph),weights);p.seek(0.5);assert.deepEqual(snapshot(a.gltf.scene),desired);
    }
    p.play();const before=snapshot(a.gltf.scene);
    for(const values of [Array(7).fill(0),[0,0,0,0,NaN,0,0,0],new Array<number>(8)]) {
      assert.throws(()=>applyMorphWeights(a.morph,values));assert.equal(p.playing,true);assert.deepEqual(snapshot(a.gltf.scene),before);
    }
    applyMorphWeights(a.morph,[0.3,0,0,0,0.8,0,0,0]);assert.equal(p.playing,false);
    resetMorphWeights(a.morph);assert.deepEqual(getMorphWeights(a.morph),Array(8).fill(0));
    p.seek(0.99).play();p.loop=true;p.update(0.04);assert.ok(Math.abs(p.time-0.03)<1e-12);
    p.update(3);assert.ok(Math.abs(p.time-0.03)<1e-12);
    p.loop=false;p.seek(0.99).play();p.update(0.04);assert.equal(p.time,1);assert.equal(p.playing,false);
    const next=createVMDPlayer(rig,bindVMD(rig,parseVMD(groupVMD('b')),options('b')));
    p.play();next.seek(0.719);assert.equal(p.playing,false);assert.deepEqual(snapshot(b.gltf.scene),other);
    next.dispose();next.dispose();assert.throws(()=>next.seek(0.2),/disposed/);p.dispose();
  }
});

test('compiled groups precede mixed SDEF/QDEF with independent scalar predictions',async()=>{
  const {groupPoint}=await import('./group-oracle');
  const {sdefPrediction}=await import('./sdef-oracle');const {qdefPrediction}=await import('./qdef-oracle');
  const {MMDSDEFPlugin}=await import('../packages/three-mmd-sdef');const {MMDQDEFPlugin}=await import('../packages/three-mmd-qdef');
  let maximum=0;
  for(const shape of ['box','wedge'] as const) for(const mode of ['sdef','qdef'] as const) for(const motion of ['a','b'] as const) {
    const result=await convertModel(parsePMX(groupPMX(shape,mode==='sdef'?'mixed-sdef':'mixed-qdef')),'.',{mode,scale:rigScale[shape]});
    const binary=await result.io.writeBinary(result.document);assert.equal((await validateBytes(binary)).issues.numErrors,0);
    const asset=await new GLTFLoader().register(p=>mode==='sdef'?new MMDSDEFPlugin(p):new MMDQDEFPlugin(p)).parseAsync(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength) as ArrayBuffer,'');
    const rig=createVPDRig(asset.scene);const player=createVMDPlayer(rig,bindVMD(rig,parseVMD(groupVMD(motion)),options(motion)));
    for(const time of [0,0.371,0.5,0.719,1]) {
      player.seek(time);
      for(const m of meshes(asset.scene)) for(let i=0;i<24;i++) {
        const oracle=mode==='sdef'?sdefPrediction:qdefPrediction;
        const expected=oracle(shape,motion,i,time,false,(point)=>groupPoint(shape,motion,i,time,point));
        maximum=Math.max(maximum,(m as SkinnedMesh).getVertexPosition(i,new Vector3()).distanceTo(expected.p));
      }
    }
    player.dispose();
  }
  assert.ok(maximum<2e-6,`group advanced skinning ${maximum}`);console.log('Group advanced CPU evidence:',JSON.stringify({maximumPositionError:maximum}));
});

test('legacy vertex-only metadata remains readable',async()=>{
  const {validateMorphModel}=await import('../packages/mmd-morph');
  validateMorphModel({version:1,modelId:'legacy',morphs:[{index:0,name:'vertex',englishName:'vertex',type:1,target:0}]});
});

test('all built group assets pass the glTF validator',async()=>{
  for(const rig of ['box','wedge']) {
    for(const sample of ['rest','a','b','sdef','qdef'])for(const ext of sample==='sdef'||sample==='qdef'?['glb']:['glb','gltf']) {
      const bytes=await readFile(`public/group/${rig}/${sample}.${ext}`);
      const report=ext==='glb'?await validateBytes(bytes):await validateString(bytes.toString(),{externalResourceFunction:(uri:string)=>readFile(`public/group/${rig}/${uri}`)});
      assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
    }
  }
});
