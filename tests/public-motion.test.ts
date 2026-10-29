import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePMX } from '../tools/pmx-to-gltf';
import { auditMotion } from '../tools/audit-public-motions';
import { parseVMD } from '../packages/mmd-vmd';
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
