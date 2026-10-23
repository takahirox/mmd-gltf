import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateBytes, validateString } from 'gltf-validator';
import { NodeIO } from '@gltf-transform/core';
import { Vector3, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseVPD, createVPDRig, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { bindPose, resolvePose } from '../packages/mmd-vpd';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { syntheticPMX } from '../tools/synthetic-bdef';
import { mappings, rigScale, localPrediction, rotate, vpdPrediction, type RigCase, type PoseCase } from './vpd-oracle';
const near = (a: number[], b: number[], tolerance = 2e-6) => a.forEach((v, i) => assert.ok(Math.abs(v-b[i]) <= tolerance, `${a} != ${b}, axis ${i}`));
const bytes = (name: string) => readFile(`tests/fixtures/${name}`);
const utf8 = (text: string) => new TextEncoder().encode(text);
const record = (name = 'bone 1', translation = '0,0,0', rotation = '0,0,0,1') => `Bone91{${name}\n${translation};\n${rotation};\n}\n`;
const text = (records: string, count = 1) => `Vocaloid Pose Data file\n../../never-fetch.pmx;\n${count};\n${records}`;
const load = (data: Uint8Array) => new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength) as ArrayBuffer, '');
async function fixtures() {
  return { a: parseVPD(await bytes('pose-a.vpd')), b: parseVPD(await bytes('pose-b.vpd'), 'utf-8') };
}

test('VPD byte profile: fatal Shift_JIS/UTF-8, exact names, comments/newlines, counts and strict finite records', async () => {
  const poses = await fixtures();
  const shiftJIS = await bytes('pose-a.vpd');
  assert.ok(shiftJIS.includes(Buffer.from([0x93,0xaf,0x96,0xbc,0x2e,0x8d,0x9c])), 'actual Shift_JIS Japanese name bytes');
  assert.ok(shiftJIS.includes(Buffer.from('\r\n')), 'committed CRLF byte fixture');
  assert.ok(!(await bytes('pose-b.vpd')).includes(Buffer.from('\r')), 'committed UTF-8/LF byte fixture');
  assert.equal(poses.a.records[2].name, '同名.骨 [duplicate]'); assert.equal(poses.a.records[0].id, 99);
  assert.equal(poses.b.parentFile, '../../informational-only.pmx');
  assert.equal(parseVPD(utf8('\uFEFF'+text(record('\uFEFF骨😀e\u0301'))), 'utf-8').records[0].name, '\uFEFF骨😀e\u0301');
  for (const newline of ['\n', '\r', '\r\n']) assert.equal(parseVPD(utf8(text(record(' exact punctuation.[骨] ')).replaceAll('\n', newline)), 'utf-8').records[0].name, ' exact punctuation.[骨] ');
  assert.throws(() => parseVPD(new Uint8Array([0x82])), /malformed shift_jis/);
  assert.throws(() => parseVPD(new Uint8Array([0xff]), 'utf-8'), /malformed utf-8/);
  for (const input of [text(record(), 2), text(record(), 0), text(record()).replace('1;', '-1;'), text(record()).replace('1;', '1.5;'), text(record()).replace('1;', '65537;'), text(record()).replace('1;', '99999999999999999999;'), text(record()).slice(0,-3), 'bad header', text(record()).replace('Bone91{bone 1', 'Bone91{}')]) assert.throws(() => parseVPD(utf8(input), 'utf-8'), /VPD/);
  for (const values of ['NaN,0,0', 'Infinity,0,0', '1e999,0,0', '0,0', '0x1,0,0']) assert.throws(() => parseVPD(utf8(text(record('bone 1', values))), 'utf-8'), /finite decimal/);
  for (const q of ['0,0,0,0', '0,0,0,0.9', '0,0,0,2', 'NaN,0,0,1']) assert.throws(() => parseVPD(utf8(text(record('bone 1','0,0,0',q))), 'utf-8'), /quaternion|finite decimal/);
  assert.equal(parseVPD(utf8(text(record('bone 1','0,0,0','0,0,0,1.000001'))), 'utf-8').records[0].rotation[3], 1);
  assert.throws(() => parseVPD(utf8(text(record()+record(),2)), 'utf-8'), /duplicate record label/);
});

test('model-scoped VPD binding is exact, explicit for ambiguity, atomic on failure and replaceable from original rest', async () => {
  const conversion = await convertModel(parsePMX(await bytes('bdef.pmx')), '.', { mode: 'bdef', scale: 0.2 });
  const data = await conversion.io.writeBinary(conversion.document), asset = await load(data), other = await load(data);
  const rig = createVPDRig(asset.scene), rig2 = createVPDRig(other.scene), poses = await fixtures();
  const bones: any[] = []; asset.scene.traverse(n => { if (n.userData.pmxBone) bones[n.userData.pmxBone.index] = n; });
  const snapshot = () => bones.map(n => [n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()]);
  const rest = snapshot();
  const inverses: number[][] = []; asset.scene.traverse(n => { const mesh=n as SkinnedMesh; if(mesh.isSkinnedMesh) mesh.skeleton.boneInverses.forEach(m => inverses.push([...m.elements])); });
  const otherModel = await convertModel(parsePMX(await bytes('vpd-wedge.pmx')), '.', {mode:'bdef',scale:0.125});
  const differentRig = createVPDRig((await load(await otherModel.io.writeBinary(otherModel.document))).scene);
  const otherSnapshots = () => [other.scene,differentRig.root].map(root => { const out: number[][] = []; root.traverse(n => { if(n.userData.pmxBone) out.push([...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]); }); return out; });
  const otherRest = otherSnapshots();
  const a = bindVPD(rig, poses.a, { mapping: mappings.a }), b = bindVPD(rig, poses.b, { mapping: mappings.b });
  applyVPD(rig,a); const posed = snapshot();
  for (const attempt of [() => bindVPD(rig,poses.a), () => bindVPD(rig,poses.a,{mapping:{'9':0}}), () => bindVPD(rig,poses.a,{mapping:{'2':-1,'3':259}}), () => bindVPD(rig,poses.a,{mapping:{'2':0,'3':0}}), () => bindVPD(rig,parseVPD(utf8(text(record('English 1'))),'utf-8')), () => applyVPD(rig2,a), () => applyVPD(differentRig,a), () => bindVPD(rig,poses.a,{mapping:[] as any}), () => bindVPD(rig,parseVPD(utf8(text(record('Bone1'))),'utf-8'))]) { assert.throws(attempt, /VPD/); assert.deepEqual(snapshot(),posed); assert.deepEqual(otherSnapshots(),otherRest); }
  for (const name of ['missing', bones[0].name, 'English 1']) {
    const pose = parseVPD(utf8(text(record(name))), 'utf-8');
    assert.throws(() => bindVPD(rig,pose), /unmatched/);
    const partial = bindVPD(rig,pose,{unmatched:'ignore'}); assert.equal(partial.unmatched.length,1);
  }
  const reorder = { ...poses.a, records: [poses.a.records[3], poses.a.records[0], poses.a.records[2], poses.a.records[1]] };
  applyVPD(rig,bindVPD(rig,reorder,{mapping:{'0':259,'2':0}})); assert.deepEqual(snapshot(),posed);
  applyVPD(rig,a); assert.deepEqual(snapshot(),posed);
  applyVPD(rig,b); near(bones[0].position.toArray(), localPrediction('box','b',0)); near(bones[0].quaternion.toArray(),[0,0,0,1],1e-12);
  applyVPD(rig,a); assert.deepEqual(snapshot(),posed);
  bones.forEach(n => { n.position.set(7,8,9); n.quaternion.set(0,0,1,0); n.scale.set(2,3,4); n.updateMatrix(); });
  applyVPD(rig,a); assert.deepEqual(snapshot(),posed);
  const overflow = structuredClone(poses.a); overflow.records[0].translation[0] = 1e308;
  const overflowBinding = bindVPD(rig,overflow,{mapping:mappings.a});
  assert.throws(() => applyVPD(rig,overflowBinding), /numeric range/); assert.deepEqual(snapshot(),posed);
  resetVPD(rig); assert.deepEqual(snapshot(),rest);
  applyVPD(rig,bindVPD(rig,parseVPD(utf8(text(record('missing'))),'utf-8'),{unmatched:'ignore'})); assert.deepEqual(snapshot(),rest);
  // A parsed pose need not be trusted: object-level invalid records also fail atomically.
  const malformed = structuredClone(poses.a); malformed.records[0].translation[0] = NaN;
  assert.throws(() => bindVPD(rig,malformed,{mapping:mappings.a}), /finite translation/); assert.deepEqual(snapshot(),rest);
  const partialPose = parseVPD(utf8(text(record('bone 1')+record('absent').replace('Bone91','Bone92'),2)),'utf-8');
  const partial = bindVPD(rig,partialPose,{unmatched:'ignore'}); assert.equal(partial.appliedRecords,1); assert.equal(partial.unmatched.length,1);
  applyVPD(rig,partial); assert.deepEqual(snapshot(),rest);
  const missing = await load(data); missing.scene.traverse(n => { if (n.userData.mmdPose) delete n.userData.mmdPose; });
  assert.throws(() => createVPDRig(missing.scene), /missing metadata/);
  for (const change of [(n: any) => { n.userData.mmdPose.metersPerPMXUnit=0; }, (n: any) => { n.userData.mmdPose.boneCount++; }, (n: any) => { n.userData.mmdPose.metersPerPMXUnit=0.3; }]) {
    const invalid = await load(data); invalid.scene.traverse(n => { if (n.userData.mmdPose) change(n); }); assert.throws(() => createVPDRig(invalid.scene), /metadata|count/);
  }
  const currentInverses: number[][] = []; asset.scene.traverse(n => { const mesh=n as SkinnedMesh; if(mesh.isSkinnedMesh) mesh.skeleton.boneInverses.forEach(m => currentInverses.push([...m.elements])); }); assert.deepEqual(currentInverses,inverses);
  const invalidRest = await load(data); invalidRest.scene.traverse(n => { if (n.userData.pmxBone?.index===1) n.userData.pmxRest.translation[0]++; }); assert.throws(() => createVPDRig(invalidRest.scene), /inverse binds/);
});

test('rest-relative quaternion multiplication preserves nonidentity rest and never accumulates', () => {
  const s = Math.SQRT1_2;
  const model = { version: 1 as const, modelId:'nonidentity', metersPerPMXUnit:0.125, bones:[{ index:0,name:'joint',parentIndex:-1,translation:[1,2,3] as [number,number,number],rotation:[0,0,s,s] as [number,number,number,number],scale:[1,1,1] as [number,number,number] }] };
  const pose = parseVPD(utf8(text(record('joint','1,2,3',`${s},0,0,${s}`))), 'utf-8');
  const result = resolvePose(model,bindPose(model,pose))[0];
  near(result.translation,[1.125,2.25,2.625],1e-12); near(result.rotation,[-0.5,-0.5,0.5,0.5],1e-12);
  assert.throws(() => resolvePose({...model,modelId:'wrong'},bindPose(model,pose)), /different model/);
});

test('two poses × two distinct rigs: deterministic converter/CLI, validator, scalar geometry, ordinary GLTFLoader, reload and reset', async () => {
  const directory = await mkdtemp(join(tmpdir(),'mmd-vpd-'));
  try {
    const poses = await fixtures();
    for (const rigCase of ['box','wedge'] as RigCase[]) {
      const source = rigCase==='box' ? 'bdef.pmx' : 'vpd-wedge.pmx';
      if(rigCase==='wedge') assert.deepEqual(await bytes(source),syntheticPMX('bdef','utf16le',false,'wedge'));
      const model = parsePMX(await bytes(source)), scale = rigScale[rigCase];
      const base = await convertModel(model,'.',{mode:'bdef',scale});
      const runtime = await load(await base.io.writeBinary(base.document)), handle = createVPDRig(runtime.scene);
      for (const poseCase of ['a','b'] as const) {
        const options = { mode:'bdef' as const,scale,vpd:await bytes(`pose-${poseCase}.vpd`),vpdEncoding:poseCase==='a'?'shift_jis' as const:'utf-8' as const,vpdBinding:{mapping:mappings[poseCase]} };
        const result = await convertModel(model,'.',options), binary = await result.io.writeBinary(result.document);
        const repeat = await convertModel(model,'.',options); assert.deepEqual(binary,await repeat.io.writeBinary(repeat.document));
        assert.deepEqual(result.document.getRoot().listSkins()[0].getInverseBindMatrices()!.getArray(),base.document.getRoot().listSkins()[0].getInverseBindMatrices()!.getArray());
        applyVPD(handle,bindVPD(handle,poses[poseCase],{mapping:mappings[poseCase]}));
        const output = join(directory,`${rigCase}-${poseCase}.gltf`); await convertPMX(`tests/fixtures/${source}`,output,options);
        assert.equal((await validateBytes(binary)).issues.numErrors,0);
        const validation = await validateString(await readFile(output,'utf8'),{externalResourceFunction:(uri:string)=>readFile(join(directory,uri))}); assert.equal(validation.issues.numErrors,0,JSON.stringify(validation.issues.messages));
        const jsonDoc = await new NodeIO().read(output);
        for (const loaded of [await load(binary),await load(await new NodeIO().writeBinary(jsonDoc)),runtime]) {
          const rig = loaded===runtime ? handle : createVPDRig(loaded.scene);
          function check(state: PoseCase) {
            loaded.scene.updateMatrixWorld(true);
            loaded.scene.traverse(n => {
              if(n.userData.pmxBone) {
                const index = n.userData.pmxBone.index;
                near(n.position.toArray(),localPrediction(rigCase,state,index));
                const s = Math.SQRT1_2;
                const expected = state==='a' ? index===1?[-s,0,0,s]:index===0?[0,-s,0,s]:index===259?[0,0,s,s]:[0,0,0,1] : state==='b' ? index===1?[0,0,-s,s]:index===2?[0,-s,0,s]:index===259?[s,0,0,s]:[0,0,0,1] : [0,0,0,1];
                near(n.quaternion.toArray(),expected,1e-12);
                // Independent basis-vector rotations discriminate quaternion sign/axis/composition.
                near(new Vector3(0.2,0.3,0.4).applyQuaternion(n.quaternion).toArray(),rotate(state,index,[0.2,0.3,0.4]),1e-12);
              }
              const mesh = n as SkinnedMesh;
              if(!mesh.isSkinnedMesh)return;
              mesh.skeleton.update();
              const p=mesh.geometry.getAttribute('position');
              for(let i=0;i<p.count;i++) near(mesh.getVertexPosition(i,new Vector3()).toArray(),vpdPrediction(rigCase,state,[p.getX(i),p.getY(i),p.getZ(i)],[0,0,1],i,false).p);
            });
          }
          check(poseCase); resetVPD(rig); check('rest'); applyVPD(rig,bindVPD(rig,poses[poseCase],{mapping:mappings[poseCase]})); check(poseCase);
        }
        const cli = spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/pmx-to-gltf.ts',`tests/fixtures/${source}`,join(directory,'cli.glb'),'--mode','bdef','--scale',String(scale),'--vpd',`tests/fixtures/pose-${poseCase}.vpd`,'--vpd-encoding',options.vpdEncoding,'--vpd-map',`tests/fixtures/pose-${poseCase}-map.json`],{encoding:'utf8'});
        assert.equal(cli.status,0,cli.stderr); assert.deepEqual(await readFile(join(directory,'cli.glb')),Buffer.from(binary));
        console.log(`VPD ${rigCase}/${poseCase}: GLB + glTF validator zero errors; deterministic CLI/API; runtime/reload/reset scalar position <=2e-6m, quaternion <=1e-12.`);
      }
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});
