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
import { MMDQDEFPlugin, evaluateQDEF } from '../packages/three-mmd-qdef';
import { createVPDRig, parseVPD, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { bindVMD, parseVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { mappings, rigScale } from './vpd-oracle';
import { qdefPrediction } from './qdef-oracle';
const close = (a: number[], b: number[], tolerance = 2e-6) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i]) <= tolerance, `${a} != ${b}`));
const meshes = (root: any) => { const result: SkinnedMesh[] = []; root.traverse((n: SkinnedMesh) => { if(n.isSkinnedMesh) result.push(n); }); return result; };
async function load(bytes: Uint8Array) {
  let plugin!: MMDQDEFPlugin;
  const gltf = await new GLTFLoader().register(p => plugin = new MMDQDEFPlugin(p)).parseAsync(bytes.slice().buffer as ArrayBuffer, '');
  return { ...gltf, plugin };
}
test('QDEF queries and bounds agree with independent combined-motion and VPD predictions on both rigs', async () => {
  let maximum = 0, difference = 0;
  for(const rig of ['box','wedge'] as const) {
    const asset=await load(await readFile(`public/qdef/${rig}/rest.glb`));
    const handle=createVPDRig(asset.scene), list=meshes(asset.scene);
    const check=(state:'rest'|'a'|'b'|'pose-a'|'pose-b',time=0)=>{
      for(const mesh of list) for(let i=0;i<24;i++) {
        const expected=qdefPrediction(rig,state,i,time).p, actual=mesh.getVertexPosition(i,new Vector3());
        maximum=Math.max(maximum,...actual.toArray().map((v,j)=>Math.abs(v-expected.getComponent(j))));
        close(actual.toArray(),expected.toArray());
        assert.ok(mesh.boundingBox?.clone().expandByScalar(2e-6).containsPoint(actual));
        if(state!=='rest') difference=Math.max(difference,expected.distanceTo(qdefPrediction(rig,state,i,time,true).p));
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
  assert.ok(difference>0.001,'QDEF/BDEF4 separation exceeds ten times GPU position tolerance');
  console.log(`QDEF CPU: maximum ${maximum} m; BDEF4 separation ${difference} m.`);
});
test('rigid nonidentity binds, common scene placement, separate instances and disposal preserve query semantics',async()=>{
  const bytes=await readFile('public/qdef/box/pose-a.glb'),a=await load(bytes),b=await load(bytes);
  const bind=new Matrix4().makeRotationY(0.4).setPosition(0.1,-0.2,0.05),inverse=bind.clone().invert();
  const {Matrix3}=await import('three');const direction=new Matrix3().setFromMatrix4(inverse);
  for(const mesh of meshes(a.scene)) {
    mesh.geometry.applyMatrix4(inverse);
    for(const key of ['mmdSdefC','mmdSdefR0','mmdSdefR1']) {const attr=mesh.geometry.getAttribute(key);for(let i=0;i<attr.count;i++){const v=new Vector3().fromBufferAttribute(attr,i).applyMatrix4(inverse);attr.setXYZ(i,v.x,v.y,v.z);}}
    for(const attr of mesh.geometry.morphAttributes.position??[])for(let i=0;i<attr.count;i++){const v=new Vector3().fromBufferAttribute(attr,i).applyMatrix3(direction);attr.setXYZ(i,v.x,v.y,v.z);}
    mesh.bindMatrix.copy(bind);
  }
  a.scene.position.set(2,-1,0.5);a.scene.rotation.z=0.6;a.scene.scale.set(2,3,4);a.scene.updateMatrixWorld(true);
  for(const mesh of meshes(a.scene))for(let i=0;i<24;i++)close(mesh.getVertexPosition(i,new Vector3()).toArray(),qdefPrediction('box','pose-a',i).p.toArray());
  const untouched=meshes(b.scene)[0].getVertexPosition(5,new Vector3()).toArray();
  resetVPD(createVPDRig(b.scene));
  close(meshes(a.scene)[0].getVertexPosition(5,new Vector3()).toArray(),untouched);
  const restored=meshes(b.scene)[0].geometry;a.plugin.dispose();assert.notEqual(meshes(a.scene)[0].geometry,restored);
  close(meshes(b.scene)[0].getVertexPosition(5,new Vector3()).toArray(),qdefPrediction('box','rest',5).p.toArray());b.plugin.dispose();
});

test('QDEF converter validates every generated GLB/glTF motion and pose and accepts shared source materials',async()=>{
  for(const rig of ['box','wedge'])for(const sample of ['rest','a','b','only','legacy-a','legacy-b','pose-a','pose-b'])for(const ext of ['glb','gltf']) {
    const bytes=await readFile(`public/qdef/${rig}/${sample}.${ext}`);
    const result=ext==='glb'?await validateBytes(bytes):await validateString(bytes.toString('utf8'),{externalResourceFunction:(uri:string)=>readFile(`public/qdef/${rig}/${uri}`)});
    assert.equal(result.issues.numErrors,0,`${rig}/${sample}/${ext}: ${JSON.stringify(result.issues.messages)}`);
  }
  const result=await convertModel(parsePMX(await readFile('tests/fixtures/qdef-box.pmx')),'.',{mode:'qdef',scale:0.2});
  const primitives=result.document.getRoot().listMeshes()[0].listPrimitives();primitives[1].setMaterial(primitives[0].getMaterial());
  const asset=await load(await result.io.writeBinary(result.document)),list=meshes(asset.scene);
  assert.notEqual(list[0].material,list[1].material,'material adaptations remain instance-scoped');
  assert.notEqual(list[0].geometry,list[1].geometry);asset.plugin.dispose();
});


test('QDEF CLI matches deterministic API GLB and writes core-valid unpacked glTF',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mmd-qdef-cli-'));
  try {
    const model=parsePMX(await readFile('tests/fixtures/qdef-box.pmx')),api=await convertModel(model,'.',{mode:'qdef',scale:0.2});
    for(const extension of ['glb','gltf']) {
      const output=join(directory,`model.${extension}`);
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts','tests/fixtures/qdef-box.pmx',output,'--mode','qdef','--scale','0.2'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);
      if(extension==='glb')assert.deepEqual(await readFile(output),Buffer.from(await api.io.writeBinary(api.document)));
      else assert.equal((await validateString(await readFile(output,'utf8'),{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))})).issues.numErrors,0);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('actual PMX 2.1 preserves QDEF and SDEF, source metadata, deterministic core-valid GLB/glTF',async()=>{
  for(const rig of ['box','wedge'] as const) {
    const source=await readFile(`tests/fixtures/qdef-${rig}.pmx`);
    assert.deepEqual(source,syntheticPMX('mixed-qdef','utf16le',false,rig,true));
    const model=parsePMX(source);
    assert.equal(model.metadata.version,Math.fround(2.1));assert.equal(model.metadata.encoding,0);
    assert.deepEqual(model.vertices.slice(0,4).map(v=>v.type),[0,3,4,4]);
    assert.deepEqual(model.vertices[2].skinIndices,[0,1,2,259]);
    assert.deepEqual(model.vertices[5].skinC,[0.5,1,-2]);
    const a=await convertModel(model,'.',{mode:'qdef',scale:rigScale[rig]}),b=await convertModel(model,'.',{mode:'qdef',scale:rigScale[rig]});
    assert.deepEqual(await a.io.writeBinary(a.document),await b.io.writeBinary(b.document));
    const bytes=await a.io.writeBinary(a.document),asset=await load(bytes);
    assert.equal((await validateBytes(bytes)).issues.numErrors,0);
    const json=JSON.parse(Buffer.from(bytes).subarray(20,20+Buffer.from(bytes).readUInt32LE(12)).toString());
    assert.ok(json.extensionsUsed.includes('MMD_skinning_qdef'));assert.ok(!json.extensionsRequired?.includes('MMD_skinning_qdef'));
    assert.equal(json.extras.sourcePMXVersion,Math.fround(2.1));assert.ok(a.warnings.some(w=>/approximate BDEF4/.test(w)));
    for(const mesh of meshes(asset.scene)) {
      const joints=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
      assert.deepEqual([joints.getX(3),joints.getY(3),weights.getX(3),weights.getY(3)],[259,2,0.75,0.25]);
      assert.equal(mesh.geometry.getAttribute('mmdQdefSelection').getX(2),1);
      assert.equal(mesh.geometry.getAttribute('mmdSkinningType').getX(1),1);
    }
    asset.plugin.dispose();
    await assert.rejects(convertModel(model,'.',{mode:'bdef'}),/QDEF/);
    await assert.rejects(convertModel(model,'.',{mode:'sdef'}),/QDEF/);
  }
});

test('rigid DQ analytic endpoints, translations, signs, exact ties and near-degenerate profile',()=>{
  const p=new Vector3(1,0,0),n=new Vector3(0,1,0);
  const rotation=(angle:number)=>new Matrix4().makeRotationZ(angle);
  for(const theta of [0,1e-9,Math.PI/2,Math.PI-1e-4,Math.PI+1e-4]) {
    const angle=theta>Math.PI?theta-2*Math.PI:theta;
    const a=evaluateQDEF(p,n,[new Matrix4(),rotation(theta)],[0.5,0.5]);
    close(a.position.toArray(),[Math.cos(angle/2),Math.sin(angle/2),0],1e-8);
    close(a.normal.toArray(),[-Math.sin(angle/2),Math.cos(angle/2),0],1e-8);
    const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),theta);q.set(-q.x,-q.y,-q.z,-q.w);
    close(evaluateQDEF(p,n,[new Matrix4(),new Matrix4().makeRotationFromQuaternion(q)],[0.5,0.5]).position.toArray(),a.position.toArray(),1e-12);
  }
  const translated=evaluateQDEF(p,n,[new Matrix4().makeTranslation(1,2,3),new Matrix4().makeTranslation(-1,0,1)],[0.25,0.75]);
  close(translated.position.toArray(),[0.5,0.5,1.5],1e-12);
  close(evaluateQDEF(p,n,[rotation(0),rotation(Math.PI/2)],[0,1]).position.toArray(),[0,1,0],1e-12);
  // Exact orthogonal quaternion tie: identity and a matrix with exact Z half-turn.
  const half=new Matrix4().set(-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1);
  close(evaluateQDEF(p,n,[new Matrix4(),half],[0.5,0.5]).position.toArray(),[0,1,0],1e-12);
  const first=new Matrix4().makeRotationX(Math.PI).setPosition(1,2,3);
  const near=evaluateQDEF(p,n,[first,new Matrix4().makeRotationY(Math.PI-4e-6),new Matrix4().makeRotationY(-Math.PI+4e-6)],[1e-12,(1-1e-12)/2,(1-1e-12)/2]);
  close(near.position.toArray(),p.toArray(),1e-5);assert.ok(Number.isFinite(near.normal.length()));
  // Canonical signs on either side of the documented component tie band can
  // nearly cancel while both rotations are close to a half-turn. The project
  // limit must select the whole first active transform, including translation.
  const degenerate=[first,new Matrix4().makeRotationY(-Math.PI+2.000002e-6),new Matrix4().makeRotationY(Math.PI+1.999998e-6)];
  const limit=evaluateQDEF(p,n,degenerate,[1e-12,(1-1e-12)/2,(1-1e-12)/2]);
  close(limit.position.toArray(),p.clone().applyMatrix4(first).toArray(),1e-12);
  close(limit.normal.toArray(),n.clone().applyQuaternion(new Quaternion().setFromRotationMatrix(first)).toArray(),1e-12);
  for(const matrix of [new Matrix4().makeScale(2,1,1),new Matrix4().makeScale(-1,1,1),new Matrix4().set(1,0.2,0,0,0,1,0,0,0,0,1,0,0,0,0,1)])assert.throws(()=>evaluateQDEF(p,n,[matrix],[1]),/rigid/);
});

test('QDEF rejects malformed payloads, overlapping selection, influences and nonrigid palettes',async()=>{
  const source=parsePMX(await readFile('tests/fixtures/qdef-box.pmx'));
  for(const mutate of [(m:any)=>m.vertices[2].skinIndices[0]=-1,(m:any)=>m.vertices[2].skinWeights=[0,0,0,0],(m:any)=>m.vertices[2].skinWeights[0]=0.8,(m:any)=>delete m.vertices[2].skinWeights[1]]) {
    const m=structuredClone(source);mutate(m);await assert.rejects(convertModel(m,'.',{mode:'qdef'}),/Vertex 2/);
  }
  const result=await convertModel(source,'.',{mode:'qdef'}),original=(await result.io.writeJSON(result.document)).json;
  const jsonDoc=await result.io.writeJSON(result.document);
  for(const buffer of original.buffers!)buffer.uri='data:application/octet-stream;base64,'+Buffer.from(jsonDoc.resources[buffer.uri!]).toString('base64');
  const extension=(j:any)=>j.meshes[0].primitives[0].extensions.MMD_skinning_qdef;
  globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
  for(const mutate of [(j:any)=>extension(j).selector=999,(j:any)=>extension(j).extra=0,(j:any)=>j.accessors[extension(j).selector].normalized=true,(j:any)=>j.accessors[extension(j).selector].count--,(j:any)=>delete j.nodes[0].skin,(j:any)=>j.meshes[0].primitives[0].attributes.JOINTS_1=0]) {
    const j=structuredClone(original);mutate(j);await assert.rejects(new GLTFLoader().register(p=>new MMDQDEFPlugin(p)).parseAsync(JSON.stringify(j),''));
  }
  const writeComponent=(j:any,accessor:number,vertex:number,component:number,value:number)=>{
    const a=j.accessors[accessor],view=j.bufferViews[a.bufferView],b=Buffer.from(j.buffers[view.buffer].uri.split(',')[1],'base64');
    const sizes:Record<number,number>={5121:1,5123:2,5126:4},size=sizes[a.componentType],components=a.type==='VEC4'?4:1;
    const offset=(view.byteOffset??0)+(a.byteOffset??0)+vertex*(view.byteStride??size*components)+component*size;
    if(a.componentType===5126)b.writeFloatLE(value,offset);else b.writeUIntLE(value,offset,size);
    j.buffers[view.buffer].uri='data:application/octet-stream;base64,'+b.toString('base64');
  };
  for(const mutate of [
    (j:any)=>writeComponent(j,extension(j).selector,1,0,1), // overlap SDEF
    (j:any)=>writeComponent(j,extension(j).selector,2,0,2),
    (j:any)=>writeComponent(j,j.meshes[0].primitives[0].attributes.JOINTS_0,2,1,0),
    (j:any)=>writeComponent(j,j.meshes[0].primitives[0].attributes.JOINTS_0,2,0,999),
    (j:any)=>writeComponent(j,j.meshes[0].primitives[0].attributes.WEIGHTS_0,2,0,-0.1),
    (j:any)=>{j.extensionsUsed=j.extensionsUsed.filter((s:string)=>s!=='MMD_skinning_qdef');},
  ]) {const j=structuredClone(original);mutate(j);await assert.rejects(new GLTFLoader().register(p=>new MMDQDEFPlugin(p)).parseAsync(JSON.stringify(j),''),/MMD_skinning_(qdef|sdef)/);}
  const asset=await load(await result.io.writeBinary(result.document)),mesh=meshes(asset.scene)[0];
  mesh.skeleton.bones[0].scale.x=2;asset.scene.updateMatrixWorld(true);
  assert.throws(()=>mesh.getVertexPosition(2,new Vector3()),/MMD_skinning_qdef.*rigid/);asset.plugin.dispose();
});

test('bounded PMX 2.1 accepts exact UTF-16LE/UTF-8 and every 1/2/4-byte index width through API and CLI',async()=>{
  const {pmx21Fixture}=await import('./pmx21-fixture');
  const directory=await mkdtemp(join(tmpdir(),'mmd-qdef-widths-'));
  try {
    for(const encoding of ['utf16le','utf8'] as const)for(const vw of [1,2,4] as const)for(const bw of [1,2,4] as const) {
      const {bytes}=pmx21Fixture(encoding,vw,bw),model=parsePMX(bytes);
      assert.equal(model.metadata.modelName,'\uFEFF骨😀e\u0301');assert.equal(model.metadata.encoding,encoding==='utf8'?1:0);
      assert.equal(model.metadata.version,Math.fround(2.1));assert.deepEqual(model.vertices[0].position,[0,0,-1]);assert.deepEqual(model.faces[0].indices,[2,1,0]);
      const converted=await convertModel(model,'.',{mode:'qdef',scale:0.125});
      assert.equal((await validateBytes(await converted.io.writeBinary(converted.document))).issues.numErrors,0);
      const input=join(directory,'input.pmx'),output=join(directory,'model.glb');
      const {writeFile}=await import('node:fs/promises');await writeFile(input,bytes);
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',input,output,'--mode','qdef','--scale','0.125'],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);assert.deepEqual(await readFile(output),Buffer.from(await converted.io.writeBinary(converted.document)));
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('PMX 2.1 rejects malformed sections, truncations, counts, references, encodings and versions',async()=>{
  const {pmx21Fixture}=await import('./pmx21-fixture');
  for(const encoding of ['utf16le','utf8'] as const) {
    const {bytes,offsets:o}=pmx21Fixture(encoding,2,2);
    const mutations:[string,(b:Buffer)=>void,RegExp][]=[
      ['flip',b=>b[o.morphType]=9,/PMX/],
      ['impulse',b=>b[o.morphType]=10,/PMX/],
      ['soft body',b=>b.writeInt32LE(1,o.softBodies),/softBodies.*(truncated|count)/],
      ['negative tail',b=>b.writeInt32LE(-1,o.softBodies),/softBodies.*(truncated|count)/],
      ['count',b=>b.writeInt32LE(0x7fffffff,o.boneCount),/bones.*count/],
      ['negative count',b=>b.writeInt32LE(-1,o.vertexCount),/vertices.*count/],
      ['faces',b=>b.writeInt32LE(2,o.faceCount),/faces.*divisible/],
      ['bone reference',b=>b.writeInt16LE(4,o.jointReference),/vertices\[0\].*bones reference/],
      ['vertex reference',b=>b.writeUInt16LE(3,o.vertexReference),/faces\[0\].*vertices reference/],
      ['encoding',b=>b[9]=2,/header.*encoding/],
      ['width',b=>b[11]=3,/header.*width/],
      ['text',b=>{if(encoding==='utf8')b.fill(0xff,o.text+4,o.text+6);else b.writeUInt16LE(0xd800,o.text+4);},/invalid encoded text/],
      ['version',b=>b.writeFloatLE(2.2,4),/version.*not supported/],
    ];
    for(const [name,mutate,pattern] of mutations) {const b=Buffer.from(bytes);mutate(b);assert.throws(()=>parsePMX(b),pattern,name);}
    for(const end of [8,16,o.text+5,o.boneCount+6,o.softBodies,o.softBodies+1,o.softBodies+3])assert.throws(()=>parsePMX(bytes.subarray(0,end)),/PMX 2.1.*(truncated|invalid count)/,`truncated at ${end}`);
    assert.throws(()=>parsePMX(Buffer.concat([bytes,Buffer.from([0])])),/trailing/);
  }
});

test('QDEF schema, semantic cases, required use, complete example and interleaved selection are executable',async()=>{
  const {default:Ajv}=await import('ajv');
  const schema=JSON.parse(await readFile('extensions/MMD_skinning_qdef/schema/mesh.primitive.MMD_skinning_qdef.schema.json','utf8'));
  const validate=new Ajv().compile(schema),fixtures=JSON.parse(await readFile('extensions/MMD_skinning_qdef/tests/semantics.json','utf8'));
  assert.ok(validate({selector:0}));for(const value of fixtures.invalid)assert.equal(validate(value),false);
  for(const c of fixtures.cases)close(evaluateQDEF(new Vector3().fromArray(c.p),new Vector3(0,0,1),c.zAngles.map((a:number)=>new Matrix4().makeRotationZ(a)),c.weights).position.toArray(),c.expected,1e-12);
  const example=JSON.parse(await readFile('extensions/MMD_skinning_qdef/examples/mixed.gltf','utf8'));
  assert.equal((await validateString(JSON.stringify(example))).issues.numErrors,0);
  const selector=example.accessors[example.meshes[0].primitives[0].extensions.MMD_skinning_qdef.selector];
  const original=Buffer.from(example.buffers[0].uri.split(',')[1],'base64'),padding=Buffer.alloc(12,255);
  for(let i=0;i<3;i++)padding[i*4+1]=1;
  selector.bufferView=example.bufferViews.length;selector.byteOffset=1;
  example.bufferViews.push({buffer:0,byteOffset:original.length,byteLength:padding.length,byteStride:4});
  const bytes=Buffer.concat([original,padding]);example.buffers[0]={byteLength:bytes.length,uri:'data:application/octet-stream;base64,'+bytes.toString('base64')};
  example.extensionsRequired=['MMD_skinning_qdef'];
  const asset=await new GLTFLoader().register(p=>new MMDQDEFPlugin(p)).parseAsync(JSON.stringify(example),'');
  assert.deepEqual(Array.from({length:3},(_,i)=>meshes(asset.scene)[0].geometry.getAttribute('mmdQdefSelection').getX(i)),[1,1,1]);
  // All four active joints remain available to the extension, independent of Toon.
  assert.equal(meshes(asset.scene)[0].skeleton.bones.length,4);
});

test('multiple mesh instances get isolated hooks, materials and selectors; disposal restores resources',async()=>{
  const source=parsePMX(await readFile('tests/fixtures/qdef-box.pmx')),result=await convertModel(source,'.',{mode:'qdef',scale:0.2});
  const doc=await result.io.writeJSON(result.document),json=doc.json as any;
  for(const b of json.buffers)b.uri='data:application/octet-stream;base64,'+Buffer.from(doc.resources[b.uri]).toString('base64');
  const meshNode=json.nodes.findIndex((n:any)=>n.mesh===0),copy=structuredClone(json.nodes[meshNode]);copy.translation=[0.1,0.2,0.3];
  json.scenes[0].nodes.push(json.nodes.length);json.nodes.push(copy);
  let plugin!:MMDQDEFPlugin;
  const asset=await new GLTFLoader().register(p=>plugin=new MMDQDEFPlugin(p)).parseAsync(JSON.stringify(json),'');
  const list=meshes(asset.scene);assert.equal(list.length,4);
  assert.equal(new Set(list.map(m=>m.geometry)).size,4);assert.equal(new Set(list.map(m=>m.material)).size,4);
  asset.scene.updateMatrixWorld(true);
  for(let i=0;i<24;i++)close(list[0].getVertexPosition(i,new Vector3()).applyMatrix4(list[0].matrixWorld).toArray(),list[2].getVertexPosition(i,new Vector3()).applyMatrix4(list[2].matrixWorld).toArray());
  list[0].geometry.getAttribute('mmdQdefSelection').setX(2,0);
  assert.equal(list[2].geometry.getAttribute('mmdQdefSelection').getX(2),1);
  const owned=list.map(m=>m.geometry),materials=list.map(m=>m.material);plugin.dispose();plugin.dispose();
  list.forEach((m,i)=>{assert.notEqual(m.geometry,owned[i]);assert.notEqual(m.material,materials[i]);assert.equal(m.geometry.hasAttribute('mmdQdefSelection'),false);});
});

test('historical pinned-parser header failure stays distinct; rejected 2.1 sources emit no output',async()=>{
  const {Parser}=await import('mmd-parser'),source=syntheticPMX('qdef');
  assert.throws(()=>new Parser().parsePmx(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),true),/PMX version 2.0999999046325684 is not supported/);
  assert.equal(parsePMX(source).vertices[0].type,4,'bounded reader consumes genuine source header');
  const {pmx21Fixture}=await import('./pmx21-fixture'),{bytes,offsets}=pmx21Fixture('utf8',1,1);
  const {writeFile,stat}=await import('node:fs/promises'),directory=await mkdtemp(join(tmpdir(),'mmd-qdef-rejection-'));
  try {
    for(const mutate of [(b:Buffer)=>b[offsets.morphType]=9,(b:Buffer)=>b[offsets.morphType]=10,(b:Buffer)=>b.writeInt32LE(1,offsets.softBodies)]) {
      const b=Buffer.from(bytes);mutate(b);const input=join(directory,'input.pmx'),output=join(directory,'never.glb');await writeFile(input,b);
      const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',input,output,'--mode','qdef'],{encoding:'utf8'});
      assert.notEqual(cli.status,0);assert.match(cli.stderr,/PMX 2.1 (materials|morphs|frames|joints|softBodies)/);await assert.rejects(stat(output),/ENOENT/);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('parsed-object API rejects malformed retained 2.1 records before output',async()=>{
  const source=parsePMX(await readFile('tests/fixtures/qdef-box.pmx'));
  for(const version of [1,2.2,NaN,Infinity]) {const m=structuredClone(source);m.metadata.version=version;await assert.rejects(convertModel(m,'.',{mode:'qdef'}),/Unsupported PMX source version/);}
  for(const version of [2,undefined]) {const m=structuredClone(source);m.metadata.version=version;await assert.rejects(convertModel(m,'.',{mode:'qdef'}),/QDEF records require actual PMX 2.1/);}
  for(const mutate of [(m:any)=>m.metadata.softBodyCount=1,(m:any)=>m.morphs[0].type=11,(m:any)=>m.constraints=[{type:1}]]) {
    const m=structuredClone(source);mutate(m);await assert.rejects(convertModel(m,'.',{mode:'qdef'}),/PMX.*(softBodies|morphs\[0\]|joints\[0\])/);
  }
});


test('bounded 2.1 reader consumes optional common records and enforces shared toon byte range',async()=>{
  for(const encoding of ['utf16le','utf8'] as const) {
    const model=parsePMX(syntheticPMX('qdef',encoding,true,'wedge'));
    assert.equal(model.bones[3].name,'\uFEFF骨😀e\u0301');assert.equal(model.bones[3].englishName,'\uFEFFEnglish😀');
    assert.equal(model.materials[1].toonIndex,0);assert.equal(model.morphs.length,9);assert.equal(model.rigidBodies.length,1);assert.equal(model.constraints.length,1);
    assert.equal((model.bones[2] as any).ik.links.length,2);
    const converted=await convertModel(model,'.',{mode:'qdef',scale:0.125});
    assert.equal((await validateBytes(await converted.io.writeBinary(converted.document))).issues.numErrors,0);
    const {pmx21Fixture}=await import('./pmx21-fixture'),{bytes,offsets}=pmx21Fixture(encoding,1,1);
    bytes[offsets.toonFlag]=1;bytes[offsets.toonIndex]=255;
    assert.throws(()=>parsePMX(bytes),/materials\[0\].*shared toon index out of bounds/);
    bytes[offsets.toonIndex]=10;assert.throws(()=>parsePMX(bytes),/materials\[0\].*shared toon index out of bounds/);
  }
});
