import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePMX } from './pmx-to-gltf';
import { createSolver } from './pmx-solver';
import { createPhysics } from './pmx-physics';
import { physicsDiagnostics } from '../packages/mmd-physics';
import ukaManifest from './uka-manifest.json';
import geneManifest from './gene-light-manifest.json';
import { BACKEND_SHA256, checkAmmo } from '../packages/three-mmd-physics/ammo';
import { loadAmmoNode } from '../packages/three-mmd-physics/node';
import { solverDiagnostics } from '../packages/mmd-solver';
import type { RestBone } from '../packages/mmd-vpd';

export function publicPhysicsSource(model:ReturnType<typeof parsePMX>) {
  const bones:RestBone[]=model.bones.map((b,index)=>({index,name:b.name,parentIndex:b.parentIndex,
    translation:b.position.map((v,k)=>(v-(model.bones[b.parentIndex]?.position[k]??0))*.08) as RestBone['translation'],
    rotation:[0,0,0,1],scale:[1,1,1]}));
  const solver=createSolver(model,{version:1,modelId:'public-source',metersPerPMXUnit:.08,bones},3);
  const physics=createPhysics(model,solver,.08);
  return {solver,physics};
}
export async function auditPublicPhysics() {
  const backendBytes=await readFile('node_modules/ammojs-typed/ammo/ammo.js');
  const backendHash=createHash('sha256').update(backendBytes).digest('hex');
  if(backendHash!==BACKEND_SHA256)throw new Error('Pinned Ammo artifact mismatch');
  checkAmmo((await loadAmmoNode()).api);
  const results=[];
  for(const [id,file] of [['uka','MS_Uka.pmx'],['gene-light','Gene_light.pmx']]) {
    const bytes=await readFile(`.cache/${id}/${file}`),manifest=id==='uka'?ukaManifest:geneManifest;
    const pin=manifest.files.find(f=>f.path===file)!;
    if(bytes.length!==pin.size || createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw new Error(`${id}: pinned source mismatch`);
    const model=parsePMX(bytes);
    const {solver,physics}=publicPhysicsSource(model);
    const count=(values:(string|number)[])=>Object.fromEntries([...new Set(values)].map(k=>[k,values.filter(v=>v===k).length]));
    const result={id,source:{repository:manifest.repository,commit:manifest.commit,path:file},sha256:createHash('sha256').update(bytes).digest('hex'),
      summary:{bones:solver.bones.length,gravity:physics.gravity,collisionGroups:count(physics.bodies.map(b=>b.group)),massRange:[Math.min(...physics.bodies.map(b=>b.mass)),Math.max(...physics.bodies.map(b=>b.mass))],deformationLayers:count(solver.bones.map(b=>b.layer)),bodies:physics.bodies.length,joints:physics.joints.length,shapes:count(physics.bodies.map(b=>b.shape)),modes:count(physics.bodies.map(b=>b.mode)),
        freeLinearAxes:physics.joints.flatMap(j=>j.linearLower.filter((v,k)=>v>j.linearUpper[k])).length,
        freeAngularAxes:physics.joints.flatMap(j=>j.angularLower.filter((v,k)=>v>j.angularUpper[k])).length,
        fixedAxes:solver.bones.filter(b=>b.fixedAxis).map(b=>b.index),postPhysics:solver.bones.filter(b=>b.flags&0x1000).map(b=>b.index),
        grants:solver.bones.filter(b=>b.append).map(b=>b.index),ik:solver.bones.filter(b=>b.ik).map(b=>b.index),
        impulseMorphs:model.morphs.filter(m=>m.type===10),softBodies:model.softBodies??[]},
      solverDiagnostics:solverDiagnostics(solver,{maxBoneUpdates:100_000_000}),
      physicsDiagnostics:physicsDiagnostics(physics,solver,{maxBoneUpdates:100_000_000}),
      sourceBodies:model.rigidBodies,sourceJoints:model.constraints,solver,physics};
    results.push(result);
    console.log(JSON.stringify({...result,sourceBodies:undefined,sourceJoints:undefined,solver:undefined,physics:undefined}));
  }
  await writeFile('docs/public-physics-audit.json',JSON.stringify({issue:77,backend:{artifact:'ammojs-typed@1.0.6/ammo/ammo.js',sha256:backendHash,capabilityCheck:'checkAmmo passed; no native world created by audit'},budget:{maxBoneUpdates:100_000_000,maxBodies:1024,maxJoints:4096},coordinates:'right handed, metres; original source records are unmodified',models:results},null,2)+'\n');
}
if(process.argv[1]?.endsWith('audit-public-physics.ts'))await auditPublicPhysics();
