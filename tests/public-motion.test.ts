import { durationVMD } from './duration-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePMX, type PMXModel } from '../tools/pmx-to-gltf';
import { auditMotion } from '../tools/audit-public-motions';
import { parseVMD, vmdDuration } from '../packages/mmd-vmd';
import { validateString, validateBytes } from 'gltf-validator';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { motionPreview } from '../examples/motion-preview';
import { decodeSource } from '../packages/mmd-diagnostics/bytes';
import { auditTimeline, trackTail } from '../tools/audit-public-timeline';

for(const [id,pmx,bones,morphs] of [['uka','MS_Uka.pmx',301,82],['gene-light','Gene_light.pmx',212,83]] as const)
  test(`${id}: real source matches retained playback and bounded preview`,async()=>{
    const metadata=JSON.parse(await readFile(`public/${id}/motion.json`,'utf8'));
    const bytes=await readFile(`public/${id}/${metadata.path}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
    const source=parseVMD(bytes),model=parsePMX(await readFile(`public/${id}/${pmx}`));
    const audited=auditMotion(model,source);
    assert.equal(metadata.duration,vmdDuration(source));assert.equal(audited.duration,metadata.duration);
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
    const retained=json.animations.find((a:any)=>a.name===metadata.animation).extensions.MMD_animation_vmd;
    assert.equal(json.scenes.length,1);assert.equal(json.skins.length,1);assert.equal(json.meshes.length,1);assert.equal(json.animations.length,3);
    assert.equal(vmdDuration(parseVMD(decodeSource(retained.source))),metadata.duration);
    assert.equal(retained.version,6);assert.equal(retained.tracks.length,bones);
    assert.equal((retained.controls?.tracks ?? retained.morphs[0].tracks).length,morphs);
    assert.ok(!retained.solver);
    assert.deepEqual(Buffer.from(decodeSource(retained.source)),bytes);
    const modelMetadata=(retained.controls?.model ?? json.nodes.find((n:any)=>n.extras?.pmxMorph).extras.pmxMorph).morphs;
    for(const entry of metadata.preview)assert.equal(modelMetadata.find((m:any)=>m.index===entry.sourceIndex).target,entry.target);
  });

for(const [id,pmx] of [['uka','MS_Uka.pmx'],['gene-light','Gene_light.pmx']] as const)
  test(`${id}: shared asset retains all source motions, strict bindings and active vertex targets`,async()=>{
    const model=parsePMX(await readFile(`public/${id}/${pmx}`));
    for(const clip of ['02_laugh','22_apology']) {
      const metadata=JSON.parse(await readFile(`public/${id}/motion-${clip}.json`,'utf8'));
      const bytes=await readFile(`public/${id}/${metadata.path}`);
      assert.equal(bytes.length,metadata.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
      const source=parseVMD(bytes), audited=auditMotion(model,source);
      assert.equal(metadata.duration,vmdDuration(source));assert.equal(audited.duration,metadata.duration);
      assert.deepEqual(metadata.bones,audited.bones);assert.deepEqual(metadata.morphs,audited.morphs);
      for(const name of ['上半身','左腕','右腕'])assert.ok(audited.bones.some(t=>t.name===name && t.status==='matched' && t.changing));
      assert.ok(audited.bones.filter(t=>t.status==='matched' && t.changing).length>=48);
      const artifact=await readFile(`public/${id}/model.${id==='uka'?'gltf':'glb'}`);
      const json=id==='uka'?JSON.parse(artifact.toString()):JSON.parse(artifact.subarray(20,20+artifact.readUInt32LE(12)).toString());
      const report=id==='uka'?await validateString(JSON.stringify(json),{maxIssues:1000,externalResourceFunction:async(uri:string)=>new Uint8Array(await readFile(`public/${id}/${decodeURIComponent(uri)}`))}):await validateBytes(new Uint8Array(artifact),{maxIssues:1000});
      assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
      const retained=json.animations.find((a:any)=>a.name===metadata.animation).extensions.MMD_animation_vmd;
      assert.equal(json.scenes.length,1);assert.equal(json.skins.length,1);assert.equal(json.meshes.length,1);assert.equal(json.animations.length,3);
      assert.equal(vmdDuration(parseVMD(decodeSource(retained.source))),metadata.duration);
      assert.deepEqual(retained.rest,json.animations[0].extensions.MMD_animation_vmd.rest);
      for(const animation of json.animations)assert.deepEqual(animation.extensions.MMD_animation_vmd.owned,animation.channels.map((c:any)=>c.target));
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
    }
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


test('duration audit includes every retained section, even unbound and unexecuted last keys',()=>{
  for(const lastFrame of [0,1,47,91]) {
    const source=parseVMD(durationVMD(lastFrame));
    const inventory={bones:[],morphs:[]} as unknown as Parameters<typeof auditMotion>[0];
    // No binding eligibility may shorten the source duration.
    assert.equal(auditMotion(inventory,source).duration,lastFrame/30);
    assert.equal(vmdDuration(source),lastFrame/30);
  }
  const source=parseVMD(durationVMD(1));
  for(const section of ['bones','morphs','cameras','lights','shadows','displays'] as const) {
    const motion=structuredClone(source);
    const record={...(motion[section][0]??{}),frame:137};
    // These audit-only records need only frame; byte parsing is covered above.
    (motion[section] as {frame:number}[]).push(record);
    if(section==='bones' || section==='morphs')Object.assign(record,source[section][0]);
    record.frame=137;
    assert.equal(auditMotion({bones:[],morphs:[]} as any,motion).duration,137/30,section);
  }
});

test('all six authentic ten-second clips still change bound vertex expressions at frame 300',async()=>{
  const evidence=JSON.parse(await readFile('docs/public-timeline-audit.json','utf8'));
  assert.deepEqual(evidence.clips.map((c:any)=>`${c.model}/${c.animation}`),[
    'uka/04_littlesmile','uka/02_laugh','uka/22_apology',
    'gene-light/01_happy','gene-light/02_laugh','gene-light/22_apology',
  ]);
  for(const clip of evidence.clips) {
    const model=parsePMX(await readFile(`public/${clip.model}/${clip.model==='uka'?'MS_Uka.pmx':'Gene_light.pmx'}`));
    const bytes=await readFile(clip.path),source=parseVMD(bytes),report=auditTimeline(model,source);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.sha256);
    assert.deepEqual(report.families,clip.families);
    assert.equal(report.sourceDuration,10);
    assert.equal(report.families.morphs.lastExecutedValueChangeFrame,300);
    // Independent source-value oracle: an executed, nonempty vertex expression
    // has a nonzero key before 300 and actually returns to zero at 300.
    const audit=auditMotion(model,source);
    const returning=audit.morphs.filter(t=>t.status==='matched' && t.type===1).filter(t=>{
      const keys=source.morphs.filter(r=>r.name.key===t.key).sort((a,b)=>a.frame-b.frame);
      return keys.at(-1)?.frame===300 && keys.at(-1)?.weight===0 && keys.at(-2)!.weight>0;
    });
    assert.ok(returning.length>0,`${clip.model}/${clip.animation}: final key is not padding`);
    assert.ok(returning.some(t=>model.morphs[t.matches[0]].elements.some(e=>e.position?.some(v=>v!==0))),
      'the final weight transition deforms actual vertices');
    for(const family of ['cameras','lights','shadows'] as const)assert.equal(source[family].length,0);
    assert.deepEqual(source.displays.map(r=>r.frame),[0]);
  }
  assert.equal(evidence.clips.length,6);
});

test('tail evidence distinguishes a real final transition from repeated holds and source-only keys',()=>{
  const held=trackTail([{frame:300,weight:1},{frame:0,weight:0},{frame:91,weight:1}],r=>r.weight);
  assert.equal(held.lastValueChangeFrame,91);assert.equal(held.maxFrame,300);assert.equal(held.repeatedTerminalKeys,1);
  assert.equal(trackTail([{frame:0,v:0},{frame:285,v:1},{frame:300,v:0}],r=>r.v).lastValueChangeFrame,300);
  assert.equal(trackTail([{frame:0,v:1},{frame:300,v:1}],r=>r.v).lastValueChangeFrame,null);
  assert.equal(trackTail([],()=>0).maxFrame,null);
  for(const frame of [0,1,91]) {
    const source=parseVMD(durationVMD(frame));
    const model={bones:[{name:'上半身'}],morphs:[{name:'笑い',type:1}]} as unknown as PMXModel;
    const report=auditTimeline(model,source);
    assert.equal(report.sourceDuration,frame/30);
    // The camera extends the source. No preview trimming policy is enabled.
    assert.equal(report.families.bones.maxFrame,Math.max(0,frame-1));
    assert.equal(report.families.morphs.maxFrame,Math.max(0,frame-1));
    source.morphs.push({...source.morphs[0],frame:300,weight:.4});
    source.bones.push({...source.bones[0],frame:200,translation:[1,0,0]});
    const later=auditTimeline(model,source);
    assert.equal(later.families.bones.lastExecutedValueChangeFrame,200);
    assert.equal(later.families.morphs.lastExecutedValueChangeFrame,300);
    assert.equal(auditTimeline({bones:[],morphs:[]} as unknown as PMXModel,source).families.morphs.lastExecutedValueChangeFrame,null);
    // Equal rotations of opposite quaternion sign cannot create a transition.
    source.bones=[source.bones[0],{...source.bones[0],frame:300,rotation:[0,0,0,-1]}];
    assert.equal(auditTimeline(model,source).families.bones.lastValueChangeFrame,null);
  }
});
