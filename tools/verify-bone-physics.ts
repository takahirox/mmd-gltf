/** Original Issue #47 fixtures; backend cross-transport consistency, not original-MMD evidence. */
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3,type SkinnedMesh} from 'three';
import {validateBytes,validateString} from 'gltf-validator';
import {physicsPMX} from './synthetic-physics';
import {boneMorphVMD} from './synthetic-bone-morph';
import {convertModel,parsePMX} from './pmx-to-gltf';
import {MMDVMDPlugin,getVMDPlayers,parseVMD,bindVMD,createVMDPlayer} from '../packages/three-mmd-vmd';
import {createVPDRig} from '../packages/three-mmd-vpd';
import {MMDSolverPlugin} from '../packages/three-mmd-solver';
import {MMDPhysicsPlugin,PhysicsRig} from '../packages/three-mmd-physics';
import {loadAmmoNode} from '../packages/three-mmd-physics/node';
import {validateMorphPayload} from '../packages/mmd-morph/payload';
globalThis.ProgressEvent??=class extends Event{} as any;
const ammo=await loadAmmoNode(), original=boneMorphVMD('a',true),count=original.readUInt32LE(54),rows:Buffer[]=[];
for(let i=0;i<count;i++){const row=Buffer.from(original.subarray(58+i*23,81+i*23));if(row.subarray(0,15).toString().split('\0')[0]==='bone-x'){row.writeFloatLE(row.readUInt32LE(15)/30,19);rows.push(row);}}
const n=Buffer.alloc(4);n.writeUInt32LE(rows.length);const bytes=Buffer.concat([original.subarray(0,54),n,...rows,original.subarray(58+count*23)]);
const schema=new Ajv({strict:false}).compile(JSON.parse(await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json','utf8')));
const cases:object[]=[];let maximumPositionError=0;
for(const shape of ['box','wedge'] as const){
 const source=parsePMX(physicsPMX(shape));source.morphs=[{name:'bone-x',englishName:'Original Issue 47 retained physics probe',type:2,elementCount:2,elements:[{index:0,position:[.2,0,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]},{index:3,position:[0,.2,0],rotation:[0,0,0,1]}]}];source.metadata.morphCount=1;
 const animated=await convertModel(source,'.',{mode:'bdef',scale:.2,physics:'rigid-body-v1',vmd:bytes,vmdBinding:{ikUnmatched:'ignore'}}),plain=await convertModel(source,'.',{mode:'bdef',scale:.2,physics:'rigid-body-v1'});
 const glb=await animated.io.writeBinary(animated.document),json=await animated.io.writeJSON(animated.document);
 if((await validateBytes(glb)).issues.numErrors || (await validateString(JSON.stringify(json.json),{externalResourceFunction:async(u:string)=>json.resources[u]})).issues.numErrors)throw new Error('Core validation failed');
 validateMorphPayload((json.json.extensions as any).MMD_morphs,json.json.nodes!.length);
 if(!schema((json.json.animations![0].extensions as any).MMD_animation_vmd))throw new Error(JSON.stringify(schema.errors));
 for(const b of json.json.buffers??[])b.uri=`data:application/octet-stream;base64,${Buffer.from(json.resources[b.uri!]).toString('base64')}`;
 const load=(data:Uint8Array|string)=>new GLTFLoader().register(p=>new MMDSolverPlugin(p)).register(p=>new MMDPhysicsPlugin(p)).register(p=>new MMDVMDPlugin(p)).parseAsync(typeof data==='string'?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer,'');
 const assets=[await load(await plain.io.writeBinary(plain.document)),await load(glb),await load(JSON.stringify(json.json))],rigs=assets.map(a=>new PhysicsRig(a.scene,ammo.api));
 const handle=createVPDRig(assets[0].scene),players=assets.map((a,i)=>i?getVMDPlayers(a)[0]:createVMDPlayer(handle,bindVMD(handle,parseVMD(bytes),{ikUnmatched:'ignore'})));
 const vertices=(index:number)=>{const result:number[][]=[];assets[index].scene.traverse(n=>{const m=n as SkinnedMesh;if(m.isSkinnedMesh)for(let i=0;i<24;i++)result.push(m.getVertexPosition(i,new Vector3()).toArray());});return result;};
 for(const time of [0,.041,.1,.173]){players.forEach(p=>p.seek(time));const expected=vertices(0);for(const index of [1,2])vertices(index).forEach((p,i)=>p.forEach((v,c)=>maximumPositionError=Math.max(maximumPositionError,Math.abs(v-expected[i][c]))));}
 if(maximumPositionError>2e-6)throw new Error(`Retained physics mismatch ${maximumPositionError}`);
 cases.push({shape,paths:['raw VMD bytes','retained GLB','retained external-buffer glTF'],times:[0,.041,.1,.173],transportVersion:5,solverVersion:2,geometryTargets:0,maximumPositionError,coreValidatorErrors:0,schemas:'passed'});players.forEach(p=>p.dispose());rigs.forEach(p=>p.dispose());
}
await writeFile('docs/bone-morph-physics-retained-validation.json',JSON.stringify({implementationRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),evidenceKind:'Pinned backend cross-transport consistency; independent raw-input numerical checks are recorded in the Node suite, not original-MMD measurements',cases,maximumPositionError},null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,maximumPositionError}));
