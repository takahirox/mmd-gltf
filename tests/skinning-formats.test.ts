import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Vector3, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDSDEFPlugin } from '../packages/three-mmd-sdef';
import { MMDQDEFPlugin } from '../packages/three-mmd-qdef';
import { MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { sdefPrediction } from './sdef-oracle';
import { qdefPrediction } from './qdef-oracle';

globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
for(const profile of ['sdef','qdef'] as const) test(`${profile} all GLB/glTF pose and motion reloads match independent scalar geometry in Node`,async()=>{
  for(const rig of ['box','wedge'] as const) for(const state of ['pose-a','pose-b','a','b'] as const) for(const format of ['glb','gltf']) {
    const directory=`public/${profile}/${rig}`;
    const bytes=await readFile(`${directory}/${state}.${format}`);
    let data:string|ArrayBuffer;
    if(format==='glb') data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
    else {
      const json=JSON.parse(bytes.toString('utf8'));
      for(const buffer of json.buffers) buffer.uri=`data:application/octet-stream;base64,${(await readFile(join(directory,buffer.uri))).toString('base64')}`;
      data=JSON.stringify(json);
    }
    let plugin!:MMDSDEFPlugin;
    const asset=await new GLTFLoader()
      .register(p=>new MMDVMDPlugin(p))
      .register(p=>plugin=profile==='sdef'?new MMDSDEFPlugin(p):new MMDQDEFPlugin(p)).parseAsync(data,'');
    const players=getVMDPlayers(asset), posed=state.startsWith('pose-');
    assert.equal(players.length,posed?0:1);
    let count=0;
    for(const time of posed?[0]:[0.371,0.719]) {
      players.forEach(p=>p.seek(time));asset.scene.updateMatrixWorld(true);
      asset.scene.traverse(object=>{
        const mesh=object as SkinnedMesh;if(!mesh.isSkinnedMesh)return;
        count++;
        for(let vertex=0;vertex<24;vertex++) {
          const expected=(profile==='sdef'?sdefPrediction:qdefPrediction)(rig,state,vertex,time).p;
          const actual=mesh.getVertexPosition(vertex,new Vector3());
          assert.ok(actual.distanceTo(expected)<2e-6,`${profile}/${rig}/${state}/${format}/${time}/${vertex}`);
          const normal=new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'),vertex);
          const originalNormal=(profile==='sdef'?sdefPrediction:qdefPrediction)(rig,'rest',vertex).n;
          assert.ok(normal.distanceTo(originalNormal)<2e-6,'serialization must preserve authored normals');
        }
      });
    }
    assert.equal(count,posed?2:4,'both material primitives must execute');
    players.forEach(p=>p.dispose());plugin.dispose();
  }
});
