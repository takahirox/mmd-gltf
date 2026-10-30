import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePMX } from '../tools/pmx-to-gltf';
import { auditMotion } from '../tools/audit-public-motions';
import { parseVMD } from '../packages/mmd-vmd';
import { validateString } from 'gltf-validator';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { motionPreview } from '../examples/motion-preview';
import { decodeSource } from '../packages/mmd-diagnostics/bytes';

for(const [id,pmx,bones,morphs] of [['uka','MS_Uka.pmx',301,108],['gene-light','Gene_light.pmx',212,86]] as const)
  test(`${id}: real source matches retained playback and bounded preview`,async()=>{
    const metadata=JSON.parse(await readFile(`public/${id}/motion.json`,'utf8'));
    const bytes=await readFile(`public/${id}/${metadata.path}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
    const source=parseVMD(bytes),model=parsePMX(await readFile(`public/${id}/${pmx}`));
    const audited=auditMotion(model,source);
    assert.deepEqual(metadata.bones,audited.bones);assert.deepEqual(metadata.morphs,audited.morphs);
    assert.equal(metadata.bones.filter((t:any)=>t.status==='matched').length,bones);
    const active=audited.morphs.filter(t=>t.active && t.status==='matched');
    assert.equal(audited.coverage.morphs.exactUnique,id==='uka'?117:95);
    assert.ok(audited.morphs.filter(t=>t.active).every(t=>t.status==='matched' && t.type===1));
    assert.equal(active.length,4);assert.ok(active.every(t=>t.type===1));
    assert.ok(source.morphs.some(r=>r.frame>0 && r.weight>0));
    assert.equal(metadata.preview.length,5);
    for(const entry of metadata.preview)assert.equal(model.morphs[entry.sourceIndex].name,entry.name);
    const artifact=await readFile(`public/${id}/model.${id==='uka'?'gltf':'glb'}`);
    const json=id==='uka'?JSON.parse(artifact.toString()):JSON.parse(artifact.subarray(20,20+artifact.readUInt32LE(12)).toString());
    assert.ok(!json.extensions?.MMD_skeleton_solver);assert.ok(!json.extensions?.MMD_physics);
    const retained=json.animations[0].extensions.MMD_animation_vmd;
    assert.equal(retained.version,6);assert.equal(retained.tracks.length,bones);
    assert.equal((retained.controls?.tracks ?? retained.morphs[0].tracks).length,morphs);
    assert.ok(!retained.solver);
    assert.deepEqual(Buffer.from(decodeSource(retained.source)),bytes);
    const modelMetadata=(retained.controls?.model ?? json.nodes.find((n:any)=>n.extras?.pmxMorph).extras.pmxMorph).morphs;
    for(const entry of metadata.preview)assert.equal(modelMetadata.find((m:any)=>m.index===entry.sourceIndex).target,entry.target);
  });

for(const [id,pmx] of [['uka','MS_Uka.pmx'],['gene-light','Gene_light.pmx']] as const)
  test(`${id}: both body transports retain exact source, strict bindings and all active vertex targets`,async()=>{
    const model=parsePMX(await readFile(`public/${id}/${pmx}`));
    const staticBuffers:string[]=[];
    for(const clip of ['02_laugh','22_apology']) {
      const metadata=JSON.parse(await readFile(`public/${id}/motion-${clip}.json`,'utf8'));
      const bytes=await readFile(`public/${id}/${metadata.path}`);
      assert.equal(bytes.length,metadata.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
      const source=parseVMD(bytes), audited=auditMotion(model,source);
      assert.deepEqual(metadata.bones,audited.bones);assert.deepEqual(metadata.morphs,audited.morphs);
      for(const name of ['上半身','左腕','右腕'])assert.ok(audited.bones.some(t=>t.name===name && t.status==='matched' && t.changing));
      assert.ok(audited.bones.filter(t=>t.status==='matched' && t.changing).length>=48);
      const json=JSON.parse(await readFile(`public/${id}/${metadata.artifact}`,'utf8'));
      const report=await validateString(JSON.stringify(json),{maxIssues:1000,externalResourceFunction:async(uri:string)=>new Uint8Array(await readFile(`public/${id}/${decodeURIComponent(uri)}`))});
      assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
      const retained=json.animations[0].extensions.MMD_animation_vmd;
      assert.deepEqual(Buffer.from(decodeSource(retained.source)),bytes);
      assert.equal(retained.tracks.length,audited.bones.filter(t=>t.status==='matched').length);
      assert.ok(!retained.solver);assert.ok(!json.extensions?.MMD_skeleton_solver);assert.ok(!json.extensions?.MMD_physics);
      const controls=retained.controls;
      const morphModel=controls?.model ?? json.nodes.find((n:any)=>n.extras?.pmxMorph).extras.pmxMorph;
      const tracks=controls?.tracks ?? retained.morphs[0].tracks;
      for(const track of tracks)assert.equal(morphModel.morphs.find((m:any)=>(controls?m.control:m.target)===track.index).type,1);
      const active=audited.morphs.filter(t=>t.status==='matched' && t.type===1 && t.active);
      for(const track of active)assert.ok(metadata.preview.some((t:any)=>t.name===track.name));
      assert.equal(metadata.preview.length,id==='gene-light' && clip==='22_apology'?7:clip==='02_laugh'?4:3);
      assert.equal(metadata.omittedActiveMorphs.length,id==='uka' && clip==='22_apology'?2:0);
      for(const entry of metadata.preview) {
        assert.equal(model.morphs[entry.sourceIndex].name,entry.name);
        assert.equal(morphModel.morphs.find((m:any)=>m.index===entry.sourceIndex).target,entry.target);
      }
      // Animation accessors live separately; both clips reference the same static buffer.
      const primitive=json.meshes[0].primitives[0];
      const accessor=json.accessors[primitive.attributes.POSITION];
      staticBuffers.push(json.buffers[json.bufferViews[accessor.bufferView].buffer].uri);
      for(const artifact of metadata.artifacts) {
        const data=await readFile(`public/${id}/${artifact.path}`);
        assert.equal(createHash('sha256').update(data).digest('hex'),artifact.sha256);
      }
      assert.ok(json.images.every((image:any)=>!image.uri.startsWith('data:')));
    }
    assert.equal(staticBuffers[0],staticBuffers[1]);
  });


test('preview preserves CPU identities and refuses to hide an animated target',()=>{
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([0,0,0],3));
  geometry.morphAttributes.position=[0,1,2].map(i=>new Float32BufferAttribute([i,0,0],3));
  const mesh=new Mesh(geometry,new MeshBasicMaterial());
  const dictionary=mesh.morphTargetDictionary, weights=mesh.morphTargetInfluences!;
  weights.splice(0,3,0,.5,.25);
  const projection=motionPreview(mesh,()=>[1,2]);
  projection.begin();
  const compact=mesh.geometry;
  assert.notEqual(compact,geometry);assert.equal(compact.getAttribute('position'),geometry.getAttribute('position'));
  assert.equal(compact.morphAttributes.position![0],geometry.morphAttributes.position[1]);
  assert.deepEqual(mesh.morphTargetInfluences,[.5,.25]);assert.equal(mesh.morphTargetDictionary,dictionary);
  projection.end();assert.equal(mesh.geometry,geometry);assert.equal(mesh.morphTargetInfluences,weights);
  weights[0]=.1;
  assert.throws(()=>projection.begin(),/animated target omitted/);
  assert.equal(mesh.geometry,geometry);assert.equal(mesh.morphTargetInfluences,weights);
  let disposed=0;compact.addEventListener('dispose',()=>disposed++);
  projection.dispose();assert.equal(disposed,1);
  assert.equal(geometry.morphAttributes.position.length,3);
  geometry.dispose();mesh.material.dispose();
});
