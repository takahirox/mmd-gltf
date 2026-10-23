import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Matrix4, Quaternion, Vector3, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBytes, validateString } from 'gltf-validator';
import { convertModel, parsePMX } from '../tools/pmx-to-gltf';
import { syntheticPMX } from '../tools/synthetic-bdef';
import { MMDSDEFPlugin, evaluateSDEF } from '../packages/three-mmd-sdef';
import { createVPDRig, parseVPD, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { bindVMD, parseVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { mappings, rigScale } from './vpd-oracle';
import { sdefPrediction } from './sdef-oracle';
const close = (a: number[], b: number[], tolerance = 2e-6) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i]) <= tolerance, `${a} != ${b}`));
const meshes = (root: any) => { const result: SkinnedMesh[] = []; root.traverse((n: SkinnedMesh) => { if(n.isSkinnedMesh) result.push(n); }); return result; };
async function load(bytes: Uint8Array) {
  let plugin!: MMDSDEFPlugin;
  const gltf = await new GLTFLoader().register(p => plugin = new MMDSDEFPlugin(p)).parseAsync(bytes.slice().buffer as ArrayBuffer, '');
  return { ...gltf, plugin };
}
test('published parser retains binary SDEF slots and reflected vectors; conversion is deterministic and core-valid', async () => {
  for (const rig of ['box','wedge'] as const) {
    const bytes = await readFile(`tests/fixtures/sdef-${rig}.pmx`);
    assert.deepEqual(bytes, syntheticPMX('mixed-sdef','utf16le',false,rig,true));
    const model = parsePMX(bytes);
    assert.equal(model.vertices[1].type,3);
    assert.deepEqual(model.vertices[1].skinC,[0,0,-0]);
    assert.deepEqual(model.vertices[5].skinC,[0.5,1,-2]);
    assert.deepEqual(model.vertices[5].skinR0,[0.25,0.75,-1.5]);
    assert.deepEqual(model.vertices[5].skinR1,[-0.25,1.25,-2.5]);
    assert.deepEqual(model.vertices[5].skinIndices,[259,2]);
    assert.deepEqual(model.vertices[5].skinWeights,[0.25,0.75]);
    const one = await convertModel(model,'.',{mode:'sdef',scale:rigScale[rig]}), two = await convertModel(model,'.',{mode:'sdef',scale:rigScale[rig]});
    const output = await one.io.writeBinary(one.document);
    assert.deepEqual(output,await two.io.writeBinary(two.document));
    assert.equal((await validateBytes(output)).issues.numErrors,0);
    const json = await readFile(`public/sdef/${rig}/rest.gltf`,'utf8');
    const validation = await validateString(json,{externalResourceFunction:(uri:string)=>readFile(`public/sdef/${rig}/${uri}`)});
    assert.equal(validation.issues.numErrors,0,JSON.stringify(validation.issues.messages));
    const asset = await load(output), list = meshes(asset.scene);
    assert.equal(list.length,2);
    const g = list[0].geometry;
    close([g.getAttribute('mmdSdefC').getX(5),g.getAttribute('mmdSdefC').getY(5),g.getAttribute('mmdSdefC').getZ(5)],[0.5,1,-2].map(v=>v*rigScale[rig]));
    assert.equal(g.getAttribute('skinIndex').getX(2),259); assert.equal(g.getAttribute('skinIndex').getY(2),2);
    assert.equal(g.getAttribute('mmdSkinningType').getX(1),1,'zero centers still select SDEF');
    asset.plugin.dispose();
  }
});
test('SDEF queries and bounds agree with independent combined-motion and VPD predictions on both rigs', async () => {
  let maximum = 0, difference = 0;
  for(const rig of ['box','wedge'] as const) {
    const asset=await load(await readFile(`public/sdef/${rig}/rest.glb`));
    const handle=createVPDRig(asset.scene), list=meshes(asset.scene);
    const check=(state:'rest'|'a'|'b'|'pose-a'|'pose-b',time=0)=>{
      for(const mesh of list) for(let i=0;i<24;i++) {
        const expected=sdefPrediction(rig,state,i,time).p, actual=mesh.getVertexPosition(i,new Vector3());
        maximum=Math.max(maximum,...actual.toArray().map((v,j)=>Math.abs(v-expected.getComponent(j))));
        close(actual.toArray(),expected.toArray());
        assert.ok(mesh.boundingBox?.clone().expandByScalar(2e-6).containsPoint(actual));
        if(state!=='rest') difference=Math.max(difference,expected.distanceTo(sdefPrediction(rig,state,i,time,true).p));
      }
    };
    check('rest');
    for(const pose of ['a','b'] as const) {
      const p=parseVPD(await readFile(`tests/fixtures/pose-${pose}.vpd`),pose==='b'?'utf-8':'shift_jis');
      const bound=bindVPD(handle,p,{mapping:mappings[pose]}); applyVPD(handle,bound); check(`pose-${pose}`);
      resetVPD(handle); check('rest'); applyVPD(handle,bound); check(`pose-${pose}`); resetVPD(handle);
    }
    for(const motion of ['a','b'] as const) {
      const vmd=parseVMD(await readFile(`tests/fixtures/combined-${motion}.vmd`));
      const mapping=JSON.parse(await readFile(`tests/fixtures/motion-${motion}-map.json`,'utf8'));
      const player=createVMDPlayer(handle,bindVMD(handle,vmd,{mapping,morphMapping:{'8fce82a2':1}}));
      for(const time of [...Array.from({length:121},(_,i)=>i*1.5/120),0.371,0.719]) { player.seek(time); check(motion,time); }
      player.stop(); check('rest'); player.dispose();
    }
    asset.plugin.dispose();
  }
  assert.ok(difference>0.001,'SDEF/BDEF2 separation exceeds ten times GPU position tolerance');
  console.log(`SDEF CPU: maximum ${maximum} m; BDEF2 separation ${difference} m.`);
});
test('duplicate SDEF joints produce core-valid GLB/glTF and preserve rigid deformation and fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmd-sdef-duplicates-'));
  try {
    for (const rig of ['box', 'wedge'] as const) for (const weight of [0, 0.25, 1]) {
      const model = parsePMX(await readFile(`tests/fixtures/sdef-${rig}.pmx`));
      // Exercise zero and nonzero centers, both endpoint weights and an
      // asymmetric pair; joint 259 also covers unsigned-short indices.
      const pairs = [[1, 2], [5, 259]];
      for (const [vertex, joint] of pairs) {
        model.vertices[vertex].skinIndices = [joint, joint];
        model.vertices[vertex].skinWeights = [weight, 1 - weight];
      }
      const { document, io } = await convertModel(model, '.', { mode: 'sdef', scale: rigScale[rig] });
      const binary = await io.writeBinary(document);
      assert.equal((await validateBytes(binary)).issues.numErrors, 0);
      await io.write(join(directory, 'model.gltf'), document);
      const unpacked = await readFile(join(directory, 'model.gltf'), 'utf8');
      assert.equal((await validateString(unpacked, { externalResourceFunction: (uri: string) => readFile(join(directory, uri)) })).issues.numErrors, 0);
      const json = JSON.parse(unpacked);
      for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + (await readFile(join(directory, buffer.uri))).toString('base64');
      globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
      for (const input of [binary.slice().buffer as ArrayBuffer, JSON.stringify(json)]) {
        let plugin!: MMDSDEFPlugin;
        const asset = await new GLTFLoader().register(p => plugin = new MMDSDEFPlugin(p)).parseAsync(input, '');
        const fallback = await new GLTFLoader().parseAsync(input, '');
        for (const root of [asset.scene, fallback.scene]) {
          const list = meshes(root);
          for (const [vertex, joint] of pairs) {
            const bone = list[0].skeleton.bones[joint];
            const restPosition = bone.position.clone();
            bone.rotation.z = Math.PI / 2;
            bone.position.add(new Vector3(1, -2, 0.5));
            root.updateMatrixWorld(true);
            for (const mesh of list) {
              const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
              assert.deepEqual([indices.getX(vertex), indices.getY(vertex)], [joint, joint]);
              assert.deepEqual([weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)], [1, 0, 0, 0]);
              // Independent single-bone result: translate to bind joint, rotate
              // 90 degrees about Z, then translate to the posed joint.
              const [x, y, z] = model.vertices[vertex].position.map(v => v * rigScale[rig]);
              const [bx, by] = model.bones[joint].position.map(v => v * rigScale[rig]);
              close(mesh.getVertexPosition(vertex, new Vector3()).toArray(), [bx - (y - by) + 1, by + (x - bx) - 2, z + 0.5]);
            }
            bone.position.copy(restPosition); bone.rotation.z = 0;
            root.updateMatrixWorld(true);
          }
        }
        const geometry = meshes(asset.scene)[0].geometry;
        assert.equal(geometry.getAttribute('mmdSkinningType').getX(1), 1);
        close(new Vector3().fromBufferAttribute(geometry.getAttribute('mmdSdefC'), 5).toArray(), model.vertices[5].skinC!.map(v => v * rigScale[rig]));
        plugin.dispose();
      }
      assert.deepEqual(model.vertices[1].skinWeights, [weight, 1 - weight], 'conversion leaves source weights intact');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SDEF loader accepts interleaved unsigned-byte selectors with accessor offsets', async () => {
  const json = JSON.parse(await readFile('extensions/MMD_skinning_sdef/examples/mixed.gltf', 'utf8'));
  const selector = json.accessors[json.meshes[0].primitives[0].extensions.MMD_skinning_sdef.selector];
  const original = Buffer.from(json.buffers[0].uri.split(',')[1], 'base64');
  const interleaved = Buffer.alloc(selector.count * 4, 255);
  const selection = [0, 1, 1];
  selection.forEach((value, i) => { interleaved[i * 4 + 1] = value; });
  selector.bufferView = json.bufferViews.length;
  selector.byteOffset = 1;
  json.bufferViews.push({ buffer: 0, byteOffset: original.length, byteLength: interleaved.length, byteStride: 4 });
  const bytes = Buffer.concat([original, interleaved]);
  json.buffers[0] = { byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + bytes.toString('base64') };
  const report = await validateString(JSON.stringify(json));
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
  let plugin!: MMDSDEFPlugin;
  const asset = await new GLTFLoader().register(p => plugin = new MMDSDEFPlugin(p)).parseAsync(JSON.stringify(json), '');
  const mesh = meshes(asset.scene)[0], attribute = mesh.geometry.getAttribute('mmdSkinningType');
  assert.deepEqual(Array.from({ length: attribute.count }, (_, i) => attribute.getX(i)), selection);
  close(mesh.getVertexPosition(1, new Vector3()).toArray(), [1, 0, 0]);
  mesh.skeleton.bones[1].rotation.z = Math.PI / 2;
  asset.scene.updateMatrixWorld(true);
  // Rw=(-.1,.25), CR0=(.15,-.075), CR1=(-.05,.025). With
  // weights (.25,.75) and a 90-degree second rotation, correction=(.01875,-.05625).
  close(mesh.getVertexPosition(1, new Vector3()).toArray(), [Math.cos(3 * Math.PI / 8) + 0.01875, Math.sin(3 * Math.PI / 8) - 0.05625, 0]);
  plugin.dispose();
});

test('SDEF analytical arc, translations, endpoints, quaternion signs and near-identical rotations',()=>{
  const v=new Vector3(1,0,0), n=new Vector3(0,1,0), c=new Vector3(), a=new Matrix4(), b=new Matrix4().makeRotationZ(Math.PI/2);
  const run=(w:number,m=b)=>evaluateSDEF(v,n,c,c,c,a,m,w);
  close(run(0.5).position.toArray(),[Math.SQRT1_2,Math.SQRT1_2,0],1e-12);
  assert.ok(run(0.5).position.distanceTo(new Vector3(0.5,0.5,0))>0.29);
  close(run(1).position.toArray(),[1,0,0]); close(run(0).position.toArray(),[0,1,0]);
  const translated=evaluateSDEF(v,n,new Vector3(2,3,4),new Vector3(-1,2,3),new Vector3(3,1,2),new Matrix4().makeTranslation(1,0,0),new Matrix4().makeTranslation(0,2,0),0.25);
  close(translated.position.toArray(),[1.25,1.5,0]);
  for(const angle of [1e-9,Math.PI-1e-7,Math.PI+1e-7]) {
    const matrix=new Matrix4().makeRotationZ(angle), q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle);
    q.set(-q.x,-q.y,-q.z,-q.w);
    close(run(0.25,matrix).position.toArray(),run(0.25,new Matrix4().makeRotationFromQuaternion(q)).position.toArray(),1e-8);
    const theta=(angle>Math.PI?angle-2*Math.PI:angle)*0.75;
    close(run(0.25,matrix).position.toArray(),[Math.cos(theta),Math.sin(theta),0],1e-8);
    assert.ok(Number.isFinite(run(0.25,matrix).normal.length()));
  }
});
test('SDEF conversion rejects sparse vectors and ordered influences before serialization', async () => {
  const source = parsePMX(await readFile('tests/fixtures/sdef-box.pmx'));
  for (const vertex of [1, 5]) {
    for (const field of ['position', 'normal', 'uv', 'skinC', 'skinR0', 'skinR1', 'skinIndices', 'skinWeights'] as const) {
      for (let component = 0; component < source.vertices[vertex][field]!.length; component++) {
        const model = structuredClone(source);
        delete model.vertices[vertex][field]![component];
        await assert.rejects(convertModel(model, '.', { mode: 'sdef' }), /Vertex \d+: /,
          `vertex ${vertex}, ${field}[${component}] must reject a missing component`);
      }
    }
  }
  for (let component = 0; component < 3; component++) {
    const model = structuredClone(source);
    delete model.bones[0].position[component];
    await assert.rejects(convertModel(model, '.', { mode: 'sdef' }), /Bone 0: /);
  }
});

test('SDEF rejects malformed vectors, ordered references, weights, QDEF and runtime nonrigid joints',async()=>{
  const source=parsePMX(await readFile('tests/fixtures/sdef-box.pmx'));
  for(const change of [(m:any)=>m.vertices[1].skinC.pop(),(m:any)=>m.vertices[1].skinR0[0]=Infinity,(m:any)=>m.vertices[1].skinR1[0]=1e40,(m:any)=>m.vertices[2].skinIndices[0]=-1,(m:any)=>m.vertices[1].skinWeights=[0.1,0.5],(m:any)=>m.vertices[1].type=4]) {
    const m=structuredClone(source);change(m);await assert.rejects(convertModel(m,'.',{mode:'sdef'}));
  }
  await assert.rejects(convertModel(source,'.',{mode:'bdef'}),/SDEF/);
  await assert.rejects(convertModel(parsePMX(syntheticPMX('qdef')),'.',{mode:'sdef'}),/QDEF/);
  const asset=await load(await readFile('public/sdef/box/rest.glb')), mesh=meshes(asset.scene)[0];
  mesh.skeleton.bones[2].scale.x=2;asset.scene.updateMatrixWorld(true);
  assert.throws(()=>mesh.getVertexPosition(1,new Vector3()),/rigid/);
  asset.plugin.dispose();
});

test('SDEF schema, semantic vectors and complete example are executable',async()=>{
  const {default:Ajv}=await import('ajv');
  const schema=JSON.parse(await readFile('extensions/MMD_skinning_sdef/schema/mesh.primitive.MMD_skinning_sdef.schema.json','utf8'));
  const validate=new Ajv().compile(schema);
  assert.ok(validate({selector:0,c:1,r0:2,r1:3}));
  const fixtures=JSON.parse(await readFile('extensions/MMD_skinning_sdef/tests/semantics.json','utf8'));
  for(const invalid of fixtures.invalid)assert.equal(validate(invalid),false);
  for(const c of fixtures.cases){const v=(a:number[])=>new Vector3().fromArray(a);const result=evaluateSDEF(v(c.p),new Vector3(0,0,1),v(c.c),v(c.r0),v(c.r1),new Matrix4().makeRotationZ(c.zAngles[0]),new Matrix4().makeRotationZ(c.zAngles[1]),c.w0);close(result.position.toArray(),c.expected,1e-12);}
  const example=await readFile('extensions/MMD_skinning_sdef/examples/mixed.gltf','utf8');
  assert.equal((await validateString(example)).issues.numErrors,0);
  globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
  const loaded=await new GLTFLoader().register(p=>new MMDSDEFPlugin(p)).parseAsync(example,'');
  assert.equal(meshes(loaded.scene).length,1);
});

test('rigid nonidentity binds, common scene placement, separate instances and disposal preserve query semantics',async()=>{
  const bytes=await readFile('public/sdef/box/pose-a.glb'),a=await load(bytes),b=await load(bytes);
  const bind=new Matrix4().makeRotationY(0.4).setPosition(0.1,-0.2,0.05),inverse=bind.clone().invert();
  const {Matrix3}=await import('three');const direction=new Matrix3().setFromMatrix4(inverse);
  for(const mesh of meshes(a.scene)) {
    mesh.geometry.applyMatrix4(inverse);
    for(const key of ['mmdSdefC','mmdSdefR0','mmdSdefR1']) {const attr=mesh.geometry.getAttribute(key);for(let i=0;i<attr.count;i++){const v=new Vector3().fromBufferAttribute(attr,i).applyMatrix4(inverse);attr.setXYZ(i,v.x,v.y,v.z);}}
    for(const attr of mesh.geometry.morphAttributes.position??[])for(let i=0;i<attr.count;i++){const v=new Vector3().fromBufferAttribute(attr,i).applyMatrix3(direction);attr.setXYZ(i,v.x,v.y,v.z);}
    mesh.bindMatrix.copy(bind);
  }
  a.scene.position.set(2,-1,0.5);a.scene.rotation.z=0.6;a.scene.scale.set(2,3,4);a.scene.updateMatrixWorld(true);
  for(const mesh of meshes(a.scene))for(let i=0;i<24;i++)close(mesh.getVertexPosition(i,new Vector3()).toArray(),sdefPrediction('box','pose-a',i).p.toArray());
  const untouched=meshes(b.scene)[0].getVertexPosition(5,new Vector3()).toArray();
  resetVPD(createVPDRig(b.scene));
  close(meshes(a.scene)[0].getVertexPosition(5,new Vector3()).toArray(),untouched);
  const restored=meshes(b.scene)[0].geometry;a.plugin.dispose();assert.notEqual(meshes(a.scene)[0].geometry,restored);
  close(meshes(b.scene)[0].getVertexPosition(5,new Vector3()).toArray(),sdefPrediction('box','rest',5).p.toArray());b.plugin.dispose();
});

test('SDEF loader rejects malformed decoded accessors, selection, slot weights and missing skins',async()=>{
  const original=JSON.parse(await readFile('extensions/MMD_skinning_sdef/examples/mixed.gltf','utf8'));
  globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
  for(const change of [(j:any)=>j.accessors[4].count=2,(j:any)=>j.accessors[4].normalized=true,(j:any)=>j.meshes[0].primitives[0].extensions.MMD_skinning_sdef.c=99,(j:any)=>delete j.nodes[0].skin,(j:any)=>j.meshes[0].primitives[0].attributes.JOINTS_1=2,(j:any)=>j.meshes[0].primitives[0].mode=1,
    (j:any)=>{const bytes=Buffer.from(j.buffers[0].uri.split(',')[1],'base64');bytes[j.bufferViews[4].byteOffset+1]=2;j.buffers[0].uri='data:application/octet-stream;base64,'+bytes.toString('base64');},
    (j:any)=>{const bytes=Buffer.from(j.buffers[0].uri.split(',')[1],'base64');bytes.writeFloatLE(0.5,j.bufferViews[3].byteOffset+16+8);j.buffers[0].uri='data:application/octet-stream;base64,'+bytes.toString('base64');}
  ]) {const json=structuredClone(original);change(json);await assert.rejects(new GLTFLoader().register(p=>new MMDSDEFPlugin(p)).parseAsync(JSON.stringify(json),''));}
});

test('SDEF converter validates every generated GLB/glTF motion and pose and accepts shared source materials',async()=>{
  for(const rig of ['box','wedge'])for(const sample of ['rest','a','b','only','legacy-a','legacy-b','pose-a','pose-b'])for(const ext of ['glb','gltf']) {
    const bytes=await readFile(`public/sdef/${rig}/${sample}.${ext}`);
    const result=ext==='glb'?await validateBytes(bytes):await validateString(bytes.toString('utf8'),{externalResourceFunction:(uri:string)=>readFile(`public/sdef/${rig}/${uri}`)});
    assert.equal(result.issues.numErrors,0,`${rig}/${sample}/${ext}: ${JSON.stringify(result.issues.messages)}`);
  }
  const result=await convertModel(parsePMX(await readFile('tests/fixtures/sdef-box.pmx')),'.',{mode:'sdef',scale:0.2});
  const primitives=result.document.getRoot().listMeshes()[0].listPrimitives();primitives[1].setMaterial(primitives[0].getMaterial());
  const asset=await load(await result.io.writeBinary(result.document)),list=meshes(asset.scene);
  assert.notEqual(list[0].material,list[1].material,'material adaptations remain instance-scoped');
  assert.notEqual(list[0].geometry,list[1].geometry);asset.plugin.dispose();
});


test('SDEF CLI matches deterministic API GLB and writes core-valid unpacked glTF',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mmd-sdef-cli-'));
  try {
    const model=parsePMX(await readFile('tests/fixtures/sdef-box.pmx')),api=await convertModel(model,'.',{mode:'sdef',scale:0.2});
    for(const extension of ['glb','gltf']) {
      const output=join(directory,`model.${extension}`);
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts','tests/fixtures/sdef-box.pmx',output,'--mode','sdef','--scale','0.2'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);
      if(extension==='glb')assert.deepEqual(await readFile(output),Buffer.from(await api.io.writeBinary(api.document)));
      else assert.equal((await validateString(await readFile(output,'utf8'),{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))})).issues.numErrors,0);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
