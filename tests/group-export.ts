/** Browser export round trips using the existing core GLTFExporter paths. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Vector3, type Mesh } from 'three';
import { MMDVPDExporterPlugin, createVPDRig, parseVPD, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { createMorphRig, getMorphModel, getMorphWeights } from '../packages/three-mmd-morph';
import { parseVMD, bindVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { mappings } from './vpd-oracle';
export async function runGroupExports(base:string) {
  const evidence:object[]=[];let maximumPositionError=0;
  const positions=(root:any)=>{const values:number[][]=[];root.traverse((m:Mesh)=>{if(m.isMesh)for(let i=0;i<24;i++)values.push(m.getVertexPosition(i,new Vector3()).toArray());});return values;};
  for(const rig of ['box','wedge'])for(const motion of ['a','b'])for(const state of ['motion','pose-a','pose-b'])for(const binary of [true,false]) {
    const loader=new GLTFLoader(),asset=await loader.loadAsync(`${base}group/${rig}/rest.glb`),handle=createVPDRig(asset.scene);
    const vmd=parseVMD(new Uint8Array(await(await fetch(`${base}group/group-${motion}.vmd`)).arrayBuffer()));
    const options={mapping:await(await fetch(`${base}vmd/motion-${motion}-map.json`)).json(),morphMapping:await(await fetch(`${base}group/group-map.json`)).json()};
    const player=createVMDPlayer(handle,bindVMD(handle,vmd,options));player.seek(0.719);
    const morph=createMorphRig(asset.scene),metadata=getMorphModel(morph),weights=getMorphWeights(morph);
    const pose=state.slice(-1),vpd=state==='motion'?undefined:parseVPD(new Uint8Array(await(await fetch(`${base}vpd/pose-${pose}.vpd`)).arrayBuffer()),pose==='a'?'shift_jis':'utf-8');
    if(vpd)applyVPD(handle,bindVPD(handle,vpd,{mapping:mappings[pose as 'a'|'b']}));
    const expected=positions(asset.scene);
    const encoded=await new GLTFExporter().register(w=>new MMDVPDExporterPlugin(w)).parseAsync(asset.scene,{binary,includeCustomExtensions:true});
    const text=encoded instanceof ArrayBuffer?undefined:JSON.stringify(encoded);
    const reload=await loader.parseAsync(encoded instanceof ArrayBuffer?encoded:text!,'');
    const rh=createVPDRig(reload.scene),rm=createMorphRig(reload.scene);
    if(JSON.stringify(getMorphModel(rm))!==JSON.stringify(metadata)||JSON.stringify(getMorphWeights(rm))!==JSON.stringify(weights))throw new Error('Group export lost metadata/control weights');
    const check=()=>positions(reload.scene).forEach((p,i)=>p.forEach((v,c)=>{maximumPositionError=Math.max(maximumPositionError,Math.abs(v-expected[i][c]));}));
    check();
    if(vpd) {applyVPD(rh,bindVPD(rh,vpd,{mapping:mappings[pose as 'a'|'b']}));check();resetVPD(rh);}
    const next=createVMDPlayer(rh,bindVMD(rh,vmd,options));next.seek(0.719);
    // Return to exactly the saved motion; repeated application cannot bake the offsets twice.
    player.seek(0.719);const motionExpected=positions(asset.scene);
    positions(reload.scene).forEach((p,i)=>p.forEach((v,c)=>{maximumPositionError=Math.max(maximumPositionError,Math.abs(v-motionExpected[i][c]));}));
    if(maximumPositionError>2e-6)throw new Error(`Group export double deformation ${maximumPositionError}`);
    const bytes=encoded instanceof ArrayBuffer?new Uint8Array(encoded):new TextEncoder().encode(text!);
    const validation=await (window as any).validateGroupExport({rig,motion,state,binary,data:Array.from(bytes)});
    if(validation.errors)throw new Error(`Group export validator errors: ${JSON.stringify(validation)}`);
    evidence.push({rig,motion,state,binary,bytes:bytes.length,validation});player.dispose();next.dispose();
  }
  return {maximumPositionError,cases:evidence};
}
