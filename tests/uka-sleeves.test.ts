import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseUkaSleeves } from '../tools/diagnose-uka-sleeves';
import manifest from '../tools/uka-manifest.json';

test('real pinned Uka sleeves: IK-only closure, source weights, untouched arms/fixed axes and kinematic dependencies',async()=>{
  const evidence=await diagnoseUkaSleeves();
  assert.equal(evidence.sourceSHA256,manifest.files.find(f=>f.path==='MS_Uka.pmx')!.sha256);
  assert.deepEqual(evidence.chains.map(c=>c.index),[61,62,63,95,96,97]);
  assert.equal(evidence.fixedAxes.length,4);
  assert.deepEqual(evidence.grants.map(g=>g.name),['左目','右目']);
  assert.equal(evidence.physics.bodies,164);assert.equal(evidence.physics.joints,151);
  assert.ok(evidence.physics.dependencies.every(b=>b.mode===0),'relevant bodies follow bones; no dynamics required');
  assert.deepEqual(evidence.influences.map(i=>i.vertices),[413,759,264,0,416,759,264,0]);
  const modified=new Set([57,58,59,60,91,92,93,94]);
  for(const sample of evidence.samples) {
    assert.ok(Math.max(...sample.before.residuals.map(r=>r.metres))>.4);
    assert.ok(Math.max(...sample.after.residuals.map(r=>r.metres))<.00002);
    for(const joint of sample.before.joints)if(!modified.has(joint.index))
      assert.deepEqual(sample.after.joints.find(b=>b.index===joint.index),joint,'authored arm/target trajectories unchanged');
    assert.ok(sample.before.vertices.some((v,i)=>Math.hypot(...v.world.map((c,k)=>c-sample.after.vertices[i].world[k]))>.01));
  }
});
