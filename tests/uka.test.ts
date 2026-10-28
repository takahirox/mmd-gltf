import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { validateString } from 'gltf-validator';
import { fetchUka } from '../tools/fetch-uka';
import { convertModel, parsePMX } from '../tools/pmx-to-gltf';
import { parseVMD } from '../packages/mmd-vmd';
import { inventoryUka } from '../tools/uka-inventory';
import { prepareUka } from '../tools/prepare-uka';
import manifest from '../tools/uka-manifest.json';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('Uka allowlist, real source inventory, supported subset and reproducible normal conversion',async()=>{
  const directory=await fetchUka();
  const source=parsePMX(await readFile(`${directory}/MS_Uka.pmx`));
  const inventory=inventoryUka(source,parseVMD(await readFile(`${directory}/motion/03_smile.vmd`)));
  assert.deepEqual(inventory,JSON.parse(await readFile('docs/uka-inventory.json','utf8')));
  assert.deepEqual(inventory.skinningTypes,{'0':21434,'1':28521});
  assert.deepEqual(inventory.morphTypes,{'0':20,'1':184,'2':7,'8':5});
  for(const options of [{solver:'pre-physics-v1'},{physics:'rigid-body-v1'}] as const)
    await assert.rejects(convertModel(source,directory,{mode:'bdef',...options}),/bones\[9\]: invalid IK caps\/count/);
  const before=JSON.parse(await readFile('public/uka/conversion.json','utf8'));
  await prepareUka();
  const record=JSON.parse(await readFile('public/uka/conversion.json','utf8'));
  assert.deepEqual(record,before,'full normal conversion and provenance must be deterministic');
  const json=JSON.parse(await readFile('public/uka/model.gltf','utf8'));
  assert.equal(json.extras.sourceManifest.commit,manifest.commit);
  assert.match(json.extras.attribution,/CG-CA Uka \(c\) 2023-2024/);
  assert.equal(json.skins[0].joints.length,302);
  assert.equal(json.meshes[0].primitives.length,13);
  assert.equal(json.meshes[0].primitives[0].targets.length,203);
  assert.equal(json.materials.length,13);
  assert.ok(json.extensionsUsed.includes('MMD_materials_toon'));
  assert.ok(json.extensionsUsed.includes('MMD_materials_outline'));
  assert.ok(!json.extensionsUsed.includes('MMD_skeleton_solver'));
  assert.ok(!json.animations?.length);
  assert.match(record.warnings.join('\n'),/"index":215/);
  assert.match(record.warnings.join('\n'),/"type":8/);
  for(const artifact of record.artifacts) {
    const bytes=await readFile(`public/uka/${artifact.path}`);
    assert.equal(bytes.length,artifact.bytes);assert.equal(sha(bytes),artifact.sha256);
  }
  // Images share the original PMX directory; no embedded/re-encoded duplicates.
  assert.equal(json.images.length,9);
  for(const image of json.images)assert.ok(manifest.files.some(f=>f.path===image.uri));
  for(const file of manifest.files) {
    const bytes=await readFile(`public/uka/${file.path}`);
    assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);
  }
  const expected=[...manifest.files.map(f=>f.path),'model.gltf','model.bin','source-manifest.json','inventory.json','conversion.json'].sort();
  const files=(await readdir('public/uka',{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(f=>`${f.parentPath}/${f.name}`.replace(/^public\/uka\//,'')).sort();
  assert.deepEqual(files,expected,'only allowlisted source and generated output may ship');
  // Independently compare the two displayed vertex expressions after sparse
  // serialization/decoding with actual source deltas, including every zero slot.
  const decoded=await new NodeIO().read('public/uka/model.gltf');
  const targets=decoded.getRoot().listMeshes()[0].listPrimitives()[0].listTargets();
  for(const index of [11,12]) {
    const attribute=json.meshes[0].primitives[0].targets[index].POSITION;
    assert.ok(json.accessors[attribute].sparse,'facial targets must avoid dense zero padding');
    const expected=new Float32Array(source.vertices.length*3);
    for(const element of source.morphs[index].elements)
      element.position!.forEach((v,axis)=>{expected[element.index*3+axis]+=v*.08;});
    assert.deepEqual(targets[index].getAttribute('POSITION')!.getArray(),expected);
  }
  const report=await validateString(JSON.stringify(json),{maxIssues:1000,externalResourceFunction:async(uri:string)=>new Uint8Array(await readFile(`public/uka/${decodeURIComponent(uri)}`))});
  assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
  console.log('Uka core glTF Validator:',report.validatorVersion,report.issues.numErrors,'errors;', [...new Set(report.issues.messages.map((m:any)=>m.code))]);
});
