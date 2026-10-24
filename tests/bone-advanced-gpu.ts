import { probe } from './gpu-vertex-probe';
/** Focused actual GPU group-before-SDEF/QDEF probes; unchanged advanced tolerances. */
import { WebGPURenderer, OrthographicCamera, Mesh, RenderTarget, FloatType, NoColorSpace, Vector3, type SkinnedMesh } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDSDEFPlugin } from '../packages/three-mmd-sdef';
import { MMDQDEFPlugin } from '../packages/three-mmd-qdef';
import { createVPDRig } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { bonePrediction } from './bone-morph-oracle';
import { MMDVMDPlugin } from '../packages/three-mmd-vmd';
async function run() {
  const renderer=new WebGPURenderer({forceWebGL:true,antialias:false});await renderer.init();
  const camera=new OrthographicCamera(-1,1,1,-1,0.1,20);
  const target=new RenderTarget(24,1,{type:FloatType});target.texture.colorSpace=NoColorSpace;
  const evidence:object[]=[];let maximumPosition=0,maximumNormal=0;
  const base=import.meta.env.BASE_URL;
  for(const rig of ['box','wedge'] as const)for(const mode of ['sdef','qdef'] as const)for(const motion of ['a','b'] as const) {
    let plugin!:MMDSDEFPlugin|MMDQDEFPlugin;
    const asset=await new GLTFLoader().register(p=>new MMDVMDPlugin(p)).register(p=>plugin=mode==='sdef'?new MMDSDEFPlugin(p):new MMDQDEFPlugin(p)).loadAsync(`${base}bone/${rig}-${mode}/rest.glb`);
    const handle=createVPDRig(asset.scene);
    const player=createVMDPlayer(handle,bindVMD(handle,parseVMD(new Uint8Array(await(await fetch(`${base}bone/bone-morph-${motion}.vmd`)).arrayBuffer())),{
      mapping:await(await fetch(`${base}vmd/motion-${motion}-map.json`)).json()}));
    const time=0.719;player.seek(time);
    const list:SkinnedMesh[]=[];asset.scene.traverse(n=>{if((n as SkinnedMesh).isSkinnedMesh)list.push(n as SkinnedMesh);});
    for(const mesh of list) {
      const positions=await probe(renderer,target,camera,mesh,false),normals=await probe(renderer,target,camera,mesh,true);
      for(let i=0;i<24;i++) {
        const expected=bonePrediction(rig,motion,i,time,mode);
        for(let c=0;c<3;c++) {
          maximumPosition=Math.max(maximumPosition,Math.abs(positions[i*4+c]-expected.p.getComponent(c)));
          maximumNormal=Math.max(maximumNormal,Math.abs(normals[i*4+c]-expected.n.getComponent(c)));
        }
        if(positions[i*4+3]!==1||normals[i*4+3]!==1)throw new Error('Missing group GPU probe coverage');
        if(mesh.getVertexPosition(i,new Vector3()).distanceTo(expected.p)>2e-6)throw new Error('Group advanced CPU mismatch');
      }
    }
    evidence.push({rig,mode,motion,time,maximumPosition,maximumNormal});
    player.dispose();plugin.dispose();
    asset.scene.traverse(n=>{const m=n as Mesh;if(m.isMesh){m.geometry.dispose();for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose();}});
  }
  target.dispose();renderer.dispose();
  if(maximumPosition>1e-4||maximumNormal>5e-4)throw new Error(`Group GPU range ${maximumPosition} / ${maximumNormal}`);
  return {evidence,maximumPosition,maximumNormal};
}
run().then(result=>Object.assign(window,{boneAdvanced:result})).catch(error=>Object.assign(window,{boneAdvancedError:String(error)}));
