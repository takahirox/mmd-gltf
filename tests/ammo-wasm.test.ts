import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { checkAmmo, WASM_BACKEND, type AmmoAPI } from '../packages/three-mmd-physics/ammo';
import { loadAmmoNode } from '../packages/three-mmd-physics/node';
import { PhysicsWorld } from '../packages/three-mmd-physics/world';
import { parsePMX } from '../tools/pmx-to-gltf';
import { publicPhysicsSource } from '../tools/audit-public-physics';
import { directContactSpring } from './physics-backend';

test('pinned browser Wasm matches the JavaScript reference for contacts, springs and both real models',async()=>{
  assert.deepEqual(JSON.parse(await readFile('extensions/MMD_physics/backend.json','utf8')).browser,WASM_BACKEND);
  const script=await readFile('public/runtime/ammo.js');
  const binary=await readFile('public/runtime/ammo.wasm.wasm');
  assert.equal(createHash('sha256').update(script).digest('hex'),WASM_BACKEND.scriptSHA256);
  assert.equal(createHash('sha256').update(binary).digest('hex'),WASM_BACKEND.binarySHA256);
  // Load the actual packaged browser artifact with its checked binary. No
  // compiler substitution, network request or generated mock Bullet world.
  const module={exports:{} as (options:{wasmBinary:Buffer})=>Promise<AmmoAPI>};
  runInNewContext(script.toString(),{module,exports:module.exports,require:createRequire(import.meta.url),
    __dirname:process.cwd(),process,console,Buffer,setTimeout,clearTimeout});
  const wasm=checkAmmo(await module.exports({wasmBinary:binary}));
  const {api:reference}=await loadAmmoNode();
  assert.deepEqual(await directContactSpring(wasm),await directContactSpring(reference));
  const baseline=PhysicsWorld.allocations;
  for(const [id,name] of [['uka','MS_Uka'],['gene-light','Gene_light']]) {
    const {physics,solver}=publicPhysicsSource(parsePMX(await readFile(`public/${id}/${name}.pmx`)));
    const evaluator={validate:()=>{},evaluate:(pose:typeof solver.bones)=>structuredClone(pose)};
    const worlds=[wasm,reference].map(api=>new PhysicsWorld(api,physics,solver,solver.bones,new Map(),
      {maxBodies:256,maxJoints:256},evaluator,128));
    try {
      // Initial stabilization, moving kinematic colliders, all source bodies /
      // joints and native forces execute in both independently allocated worlds.
      for(let tick=0;tick<=60;tick++) {
        const raw=structuredClone(solver.bones);
        raw[0].translation[0]+=Math.sin(tick/10)*.01;
        const poses=worlds.map(w=>w.resolve(raw,new Map(),tick!==0));
        assert.deepEqual(poses[0],poses[1],`${id} tick ${tick} bone writeback`);
        assert.deepEqual(worlds[0].bodyTransforms(),worlds[1].bodyTransforms(),`${id} tick ${tick} native transforms`);
      }
    } finally {worlds.forEach(w=>w.dispose());}
  }
  assert.equal(PhysicsWorld.allocations,baseline);
});
